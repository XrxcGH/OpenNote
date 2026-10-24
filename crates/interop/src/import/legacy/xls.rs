//! Importing Excel 97-2003 workbooks (`.xls`, the BIFF8 format of [MS-XLS]).
//!
//! An `.xls` file is a compound file whose Workbook stream is a list of records: a type, a length, and data. The
//! first part of the stream describes the workbook: its sheets and where they start, the shared strings, and the
//! number formats. Each sheet then has its own part with a record for each cell. A formula cell keeps its last
//! calculated value, which this reader shows. Cells go into a [`GridBuilder`], which keeps only what a page holds.

use std::collections::{HashMap, HashSet};

use super::super::workbook::GridBuilder;
use super::super::xlsx::{number_text, trim_float, Formats};
use super::book::{Book, Sheet, SheetKind, MAX_SHEETS};
use super::bytes::{f64_at, index, slice, u16_at, u32_at};
use super::cfb::Compound;
use super::xls_strings::{shared_strings, short_string, unicode_string};
use super::Problem;

const BOF: u16 = 0x0809;
const EOF: u16 = 0x000A;
const CONTINUE: u16 = 0x003C;

/// What the workbook part says.
#[derive(Default)]
struct Globals {
    sheets: Vec<(usize, u8, u8, String)>,
    strings: Vec<String>,
    formats: Formats,
    date1904: bool,
    drawings: bool,
}

/// Reads an `.xls` file that is already open as a compound file.
pub(super) fn read(file: &Compound) -> Result<Book, Problem> {
    if file.has("Book") && !file.has("Workbook") {
        return Err(Problem::Unsupported(
            "This workbook is from Excel 95 or older. Open it in Excel or LibreOffice, save it as .xlsx, and import \
             that.",
        ));
    }
    let stream = file.stream("Workbook").ok_or(Problem::Damaged(
        "it is not an Excel workbook: it has no Workbook stream",
    ))??;
    let globals = globals(&stream)?;
    let mut book = Book {
        drawings: globals.drawings,
        ..Book::default()
    };
    // Each sheet's part is read once, and all of them together read at most a few times the stream.
    let mut budget = stream.len().saturating_mul(4);
    let mut seen = HashSet::new();
    for (offset, state, kind, title) in globals.sheets.iter().take(MAX_SHEETS) {
        let kind = match (state, kind) {
            (1 | 2, _) => SheetKind::Hidden,
            (_, 0) if seen.insert(*offset) => {
                let (grid, drawn) = sheet(&stream, *offset, &globals, &mut budget);
                book.drawings |= drawn;
                SheetKind::Cells(grid.finish())
            }
            _ => SheetKind::NoCells,
        };
        book.sheets.push(Sheet {
            title: title.clone(),
            kind,
        });
    }
    Ok(book)
}

/// The records from `offset` on: each one's type and data. Stops at a record that runs past the stream.
fn records(stream: &[u8], offset: usize) -> impl Iterator<Item = (u16, &[u8])> {
    let mut pos = offset;
    std::iter::from_fn(move || {
        let kind = u16_at(stream, pos)?;
        let len = usize::from(u16_at(stream, pos + 2)?);
        let data = slice(stream, pos + 4, len)?;
        pos += 4 + len;
        Some((kind, data))
    })
}

fn globals(stream: &[u8]) -> Result<Globals, Problem> {
    let mut found = Globals::default();
    let mut xf_formats = Vec::new();
    let mut custom = HashMap::new();
    let mut iter = records(stream, 0).peekable();
    match iter.next() {
        Some((BOF, data)) if u16_at(data, 0) == Some(0x0600) => {}
        Some((BOF, _)) => {
            return Err(Problem::Unsupported(
                "This workbook is from an Excel version before 97. Save it as .xlsx in Excel, and import that.",
            ))
        }
        _ => return Err(Problem::Damaged("its workbook stream does not start with a BOF record")),
    }
    while let Some((kind, data)) = iter.next() {
        match kind {
            EOF => break,
            0x002F => {
                return Err(Problem::Unsupported(
                    "This workbook is locked with a password. Open it in Excel, remove the password, save it, and \
                     import it again.",
                ))
            }
            0x0022 => found.date1904 = u16_at(data, 0) == Some(1),
            0x0085 => {
                if let (Some(offset), Some(title)) = (u32_at(data, 0), short_string(data, 6)) {
                    let state = data.get(4).copied().unwrap_or(0) & 3;
                    let sheet_kind = data.get(5).copied().unwrap_or(0);
                    found.sheets.push((index(offset), state, sheet_kind, title));
                }
            }
            0x041E => {
                if let (Some(id), Some(code)) = (u16_at(data, 0), unicode_string(data, 2)) {
                    custom.insert(u32::from(id), code);
                }
            }
            0x00E0 => xf_formats.push(u32::from(u16_at(data, 2).unwrap_or(0))),
            0x00FC => {
                let mut parts = vec![data];
                while let Some((CONTINUE, more)) = iter.peek() {
                    parts.push(more);
                    iter.next();
                }
                found.strings = shared_strings(parts);
            }
            0x00EB => found.drawings = true,
            _ => {}
        }
    }
    found.formats = Formats::from_ids(xf_formats.into_iter(), &custom);
    Ok(found)
}

/// The cells of the sheet whose part starts at `offset`, and whether it has drawings.
fn sheet(stream: &[u8], offset: usize, globals: &Globals, budget: &mut usize) -> (GridBuilder, bool) {
    let mut grid = GridBuilder::default();
    let mut drawn = false;
    let mut depth = 0usize;
    let mut pending_string: Option<(usize, usize)> = None;
    for (kind, data) in records(stream, offset) {
        *budget = budget.saturating_sub(4 + data.len());
        if *budget == 0 || grid.is_full() {
            break;
        }
        match kind {
            BOF => depth += 1,
            EOF => {
                depth = depth.saturating_sub(1);
                if depth == 0 {
                    break;
                }
            }
            0x00EC => drawn = true,
            0x00E5 => grid.grid.merged += usize::from(u16_at(data, 0).unwrap_or(0)),
            0x0207 => {
                if let (Some((row, col)), Some(text)) = (pending_string.take(), unicode_string(data, 0)) {
                    grid.push(row, col, text);
                }
            }
            _ if depth == 1 => {
                pending_string = cell(kind, data, globals, &mut grid);
            }
            _ => {}
        }
    }
    (grid, drawn)
}

/// Adds the cells of one record. Returns the place of a formula whose text value is in the next STRING record.
fn cell(kind: u16, data: &[u8], globals: &Globals, grid: &mut GridBuilder) -> Option<(usize, usize)> {
    let row = usize::from(u16_at(data, 0)?);
    let col = usize::from(u16_at(data, 2)?);
    let style = usize::from(u16_at(data, 4)?);
    let number = |value: f64, grid: &mut GridBuilder, col: usize, style: usize| {
        let (text, other) = number_text(value, globals.formats.kind(style), globals.date1904);
        grid.grid.other_formats += usize::from(other);
        grid.push(row, col, text);
    };
    match kind {
        0x00FD => {
            let text = globals
                .strings
                .get(index(u32_at(data, 6)?))
                .cloned()
                .unwrap_or_default();
            grid.push(row, col, text);
        }
        0x0204 | 0x00D6 => grid.push(row, col, unicode_string(data, 6)?),
        0x0203 => number(f64_at(data, 6)?, grid, col, style),
        0x027E => number(rk(u32_at(data, 6)?), grid, col, style),
        0x00BD => {
            let count = data.len().saturating_sub(6) / 6;
            for i in 0..count {
                let at = 4 + 6 * i;
                let style = usize::from(u16_at(data, at)?);
                number(rk(u32_at(data, at + 2)?), grid, col + i, style);
            }
        }
        0x0205 => grid.push(row, col, bool_or_error(*data.get(6)?, *data.get(7)?)),
        0x0006 => {
            grid.grid.formulas += 1;
            let value = slice(data, 6, 8)?;
            if value.get(6..8) != Some(&[0xFF, 0xFF]) {
                number(f64_at(data, 6)?, grid, col, style);
                return None;
            }
            match value.first()? {
                0 => return Some((row, col)),
                1 => grid.push(row, col, bool_or_error(*value.get(2)?, 0)),
                2 => grid.push(row, col, bool_or_error(*value.get(2)?, 1)),
                _ => {}
            }
        }
        _ => {}
    }
    None
}

/// An RK number: a compact integer or the high half of a float, either one perhaps divided by 100.
pub(super) fn rk(value: u32) -> f64 {
    let number = if value & 2 != 0 {
        f64::from((value as i32) >> 2)
    } else {
        f64::from_bits(u64::from(value & 0xFFFF_FFFC) << 32)
    };
    if value & 1 != 0 {
        number / 100.0
    } else {
        number
    }
}

/// The text of a truth value, or of an error code.
pub(super) fn bool_or_error(value: u8, error: u8) -> String {
    if error == 0 {
        return if value != 0 { "TRUE" } else { "FALSE" }.to_owned();
    }
    match value {
        0x00 => "#NULL!",
        0x07 => "#DIV/0!",
        0x0F => "#VALUE!",
        0x17 => "#REF!",
        0x1D => "#NAME?",
        0x24 => "#NUM!",
        0x2A => "#N/A",
        _ => return trim_float(f64::from(value), 0),
    }
    .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rk_numbers_decode() {
        assert_eq!(rk((5 << 2) | 2), 5.0);
        assert_eq!(rk((1234 << 2) | 3), 12.34);
        assert_eq!(rk(0x3FF0_0000), 1.0);
        assert_eq!(rk(((-3i32) << 2) as u32 | 2), -3.0);
    }

    #[test]
    fn a_stream_of_garbage_is_refused_and_lying_lengths_stop_the_records() {
        assert!(globals(&[1, 2, 3]).is_err());
        let mut stream = vec![0x09, 0x08, 4, 0, 0, 6, 0x10, 0];
        stream.extend([0x85, 0, 0xFF, 0xFF]);
        let found = globals(&stream).expect("reads");
        assert!(found.sheets.is_empty());
        assert_eq!(records(&stream, 0).count(), 1);
    }
}
