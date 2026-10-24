//! Importing Excel binary workbooks (`.xlsb`, [MS-XLSB]).
//!
//! An `.xlsb` file is a ZIP archive laid out like an `.xlsx` file, but its parts are records instead of XML. A
//! record starts with its type and its size, each written 7 bits a byte. This reader takes the sheet list and
//! date system from the workbook part, the shared strings, the number formats, and each sheet's cells.

use std::collections::HashMap;
use std::io::{Read, Seek};

use super::super::workbook::GridBuilder;
use super::super::xlsx::{number_text, Formats};
use super::super::zipxml::{read_rels, resolve, Parts};
use super::book::{Book, Sheet, SheetKind, MAX_SHEETS};
use super::bytes::{f64_at, index, slice, u16_at, u32_at, utf16, Cursor};
use super::xls::{bool_or_error, rk};
use crate::error::InteropError;

/// A record's type and data, and where the next record starts.
fn record(data: &[u8], pos: usize) -> Option<(u32, &[u8], usize)> {
    let mut cursor = Cursor::new(data);
    cursor.pos = pos;
    let first = cursor.u8()?;
    let kind = if first & 0x80 != 0 {
        u32::from(first & 0x7F) | (u32::from(cursor.u8()? & 0x7F) << 7)
    } else {
        u32::from(first)
    };
    let mut size = 0usize;
    for shift in [0, 7, 14, 21] {
        let byte = cursor.u8()?;
        size |= usize::from(byte & 0x7F) << shift;
        if byte & 0x80 == 0 {
            break;
        }
    }
    let body = cursor.take(size)?;
    Some((kind, body, cursor.pos))
}

/// Every record of a part, in order.
fn records(data: &[u8]) -> impl Iterator<Item = (u32, &[u8])> {
    let mut pos = 0usize;
    std::iter::from_fn(move || {
        let (kind, body, next) = record(data, pos)?;
        pos = next;
        Some((kind, body))
    })
}

/// An `XLWideString` at `at`: a four-byte count of UTF-16 characters, then the characters.
fn wide_string(data: &[u8], at: usize) -> Option<(String, usize)> {
    let count = index(u32_at(data, at)?);
    if count == 0xFFFF_FFFF {
        return Some((String::new(), at + 4));
    }
    let bytes = slice(data, at + 4, count.checked_mul(2)?)?;
    Some((utf16(bytes), at + 4 + bytes.len()))
}

/// Reads an opened `.xlsb` file.
pub(super) fn read<R: Read + Seek>(parts: &mut Parts<R>, name: &str) -> Result<Book, InteropError> {
    let missing = || InteropError::format(name, "it is not an Excel binary workbook: it has no xl/workbook.bin");
    let workbook = parts.bytes("xl/workbook.bin").ok_or_else(missing)?;
    let rels = parts
        .xml("xl/_rels/workbook.bin.rels")?
        .map(|r| read_rels(&r))
        .unwrap_or_default();
    let strings = parts
        .bytes("xl/sharedStrings.bin")
        .map(|d| shared_strings(&d))
        .unwrap_or_default();
    let formats = parts.bytes("xl/styles.bin").map(|d| formats(&d)).unwrap_or_default();
    let mut date1904 = false;
    let mut list = Vec::new();
    for (kind, body) in records(&workbook) {
        match kind {
            153 => date1904 = u32_at(body, 0).is_some_and(|f| f & 1 != 0),
            156 if list.len() < MAX_SHEETS => {
                let state = u32_at(body, 0).unwrap_or(0);
                let Some((rel, next)) = wide_string(body, 8) else {
                    continue;
                };
                let Some((title, _)) = wide_string(body, next) else {
                    continue;
                };
                list.push((state, rel, title));
            }
            _ => {}
        }
    }
    let mut book = Book {
        drawings: !parts.names_under("xl/drawings/").is_empty() || !parts.names_under("xl/charts/").is_empty(),
        ..Book::default()
    };
    let context = Context {
        strings,
        formats,
        date1904,
    };
    for (state, rel, title) in list {
        let target = rels.get(&rel).map(|t| resolve("xl", &t.0));
        let kind = match target {
            _ if state != 0 => SheetKind::Hidden,
            Some(part) if part.contains("/worksheets/") => match parts.bytes(&part) {
                Some(data) => SheetKind::Cells(sheet(&data, &context).finish()),
                None => SheetKind::NoCells,
            },
            _ => SheetKind::NoCells,
        };
        book.sheets.push(Sheet { title, kind });
    }
    Ok(book)
}

/// What every sheet's cells need.
struct Context {
    strings: Vec<String>,
    formats: Formats,
    date1904: bool,
}

fn shared_strings(data: &[u8]) -> Vec<String> {
    records(data)
        .filter(|(kind, _)| *kind == 19)
        .map(|(_, body)| wide_string(body, 1).map(|s| s.0).unwrap_or_default())
        .take(4_000_000)
        .collect()
}

fn formats(data: &[u8]) -> Formats {
    let mut custom = HashMap::new();
    let mut ids = Vec::new();
    let mut in_cell_formats = false;
    for (kind, body) in records(data) {
        match kind {
            44 => {
                if let (Some(id), Some((code, _))) = (u16_at(body, 0), wide_string(body, 2)) {
                    custom.insert(u32::from(id), code);
                }
            }
            617 => in_cell_formats = true,
            618 => in_cell_formats = false,
            47 if in_cell_formats => ids.push(u32::from(u16_at(body, 2).unwrap_or(0))),
            _ => {}
        }
    }
    Formats::from_ids(ids.into_iter(), &custom)
}

fn sheet(data: &[u8], context: &Context) -> GridBuilder {
    let mut grid = GridBuilder::default();
    let mut row = 0usize;
    for (kind, body) in records(data) {
        if grid.is_full() {
            break;
        }
        match kind {
            0 => row = index(u32_at(body, 0).unwrap_or(0)),
            1..=11 => cell(kind, body, row, context, &mut grid),
            176 => grid.grid.merged += 1,
            _ => {}
        }
    }
    grid
}

fn cell(kind: u32, body: &[u8], row: usize, context: &Context, grid: &mut GridBuilder) {
    let (Some(col), Some(style)) = (u32_at(body, 0), u32_at(body, 4)) else {
        return;
    };
    let (col, style) = (index(col), index(style & 0x00FF_FFFF));
    let number = |value: f64, grid: &mut GridBuilder| {
        let (text, other) = number_text(value, context.formats.kind(style), context.date1904);
        grid.grid.other_formats += usize::from(other);
        grid.push(row, col, text);
    };
    grid.grid.formulas += usize::from((8..=11).contains(&kind));
    match kind {
        2 => {
            if let Some(value) = u32_at(body, 8) {
                number(rk(value), grid);
            }
        }
        5 | 9 => {
            if let Some(value) = f64_at(body, 8) {
                number(value, grid);
            }
        }
        3 | 11 => grid.push(row, col, bool_or_error(body.get(8).copied().unwrap_or(0), 1)),
        4 | 10 => grid.push(row, col, bool_or_error(body.get(8).copied().unwrap_or(0), 0)),
        6 | 8 => grid.push(row, col, wide_string(body, 8).map(|s| s.0).unwrap_or_default()),
        7 => {
            let text = u32_at(body, 8).and_then(|i| context.strings.get(index(i))).cloned();
            grid.push(row, col, text.unwrap_or_default());
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn record_headers_use_seven_bits_a_byte() {
        // Type 617 is written 0xE9 0x04; a size of 2; then the body.
        let data = [0xE9, 0x04, 0x02, 7, 8, 0x00, 0x00];
        let got: Vec<(u32, Vec<u8>)> = records(&data).map(|(k, b)| (k, b.to_vec())).collect();
        assert_eq!(got, vec![(617, vec![7, 8]), (0, vec![])]);
        // A size that runs past the end stops the records.
        assert_eq!(records(&[5, 0xFF, 0xFF, 0xFF, 0x7F]).count(), 0);
    }

    #[test]
    fn wide_strings_check_their_length() {
        let mut data = 2u32.to_le_bytes().to_vec();
        data.extend([b'h', 0, b'i', 0]);
        assert_eq!(wide_string(&data, 0), Some(("hi".to_owned(), 8)));
        assert_eq!(wide_string(&[9, 0, 0, 0, b'a', 0], 0), None);
        assert_eq!(wide_string(&0xFFFF_FFF0u32.to_le_bytes(), 0), None);
    }
}
