//! Importing Word 97-2003 documents (`.doc`, [MS-DOC]).
//!
//! A `.doc` file is a compound file. Its WordDocument stream starts with the File Information Block (FIB), which
//! says where everything else is. The text is stored in pieces, listed by the piece table in the table stream,
//! each piece either one byte (Windows-1252) or two bytes (UTF-16) a character. This reader walks the main text
//! piece by piece, looks up each paragraph's and run's properties by file position, and hands the text to a
//! [`Flow`]. It brings over headings, paragraphs, bold, italic, underline, strikethrough, raised text, lowered
//! text, web links, lists, and tables. Pictures, drawings, notes, and comments are counted in the report.

use super::bytes::{index, slice, u16_at, u32_at};
use super::cfb::Compound;
use super::doc_props::{Chars, Para, Places, Props, Run};
use super::flow::{hyperlink, Flow};
use super::Problem;
use crate::doc::Marks;

/// The most characters of main text read. Longer documents are cut, and the report says so.
const MAX_CHARS: u32 = 16 << 20;
/// The most pieces in a piece table.
const MAX_PIECES: usize = 1 << 20;
/// The deepest nesting of fields followed, and the longest field instruction kept.
const MAX_FIELD_DEPTH: usize = 32;
const MAX_INSTRUCTION: usize = 2_048;

/// The parts of the FIB this reader uses.
struct Fib {
    table_stream: &'static str,
    text_chars: u32,
    places: Places,
    clx: (u32, u32),
}

/// Reads a `.doc` file that is already open as a compound file.
pub(super) fn read(file: &Compound) -> Result<Flow, Problem> {
    let word = file.stream("WordDocument").ok_or(Problem::Damaged(
        "it is not a Word document: it has no WordDocument stream",
    ))??;
    let fib = fib(&word)?;
    let table = file
        .stream(fib.table_stream)
        .ok_or(Problem::Damaged("the document's table stream is missing"))??;
    let pieces = pieces(&table, fib.clx)?;
    let props = Props::read(&word, &table, &fib.places);
    let mut walker = Walker::new(&props);
    let mut left = fib.text_chars.min(MAX_CHARS);
    walker.flow.losses.cut_text = fib.text_chars > MAX_CHARS;
    for piece in &pieces {
        if left == 0 {
            break;
        }
        let count = (piece.end - piece.start).min(left);
        left -= count;
        walker.piece(&word, piece, count);
    }
    Ok(walker.flow)
}

fn fib(word: &[u8]) -> Result<Fib, Problem> {
    let short = Problem::Damaged("its header is cut short");
    if u16_at(word, 0) != Some(0xA5EC) {
        return Err(Problem::Damaged("it is not a Word document"));
    }
    let version = u16_at(word, 2).ok_or(short)?;
    if version < 0x00C1 {
        return Err(Problem::Unsupported(
            "This file is from Word 95 or older. Open it in Word or LibreOffice, save it as .docx, and import that.",
        ));
    }
    let flags = u16_at(word, 0x0A).ok_or(short)?;
    if flags & 0x0100 != 0 || flags & 0x8000 != 0 {
        return Err(Problem::Unsupported(
            "This document is locked with a password. Open it in Word, remove the password, save it, and import it \
             again.",
        ));
    }
    let words = usize::from(u16_at(word, 32).ok_or(short)?);
    let longs_at = 34 + 2 * words;
    let longs = usize::from(u16_at(word, longs_at).ok_or(short)?);
    let text_chars = u32_at(word, longs_at + 2 + 12).ok_or(short)?;
    let pairs_at = longs_at + 2 + 4 * longs;
    let pairs = usize::from(u16_at(word, pairs_at).ok_or(short)?);
    let pair = |i: usize| -> (u32, u32) {
        if i >= pairs {
            return (0, 0);
        }
        let at = pairs_at + 2 + 8 * i;
        (u32_at(word, at).unwrap_or(0), u32_at(word, at + 4).unwrap_or(0))
    };
    Ok(Fib {
        table_stream: if flags & 0x0200 != 0 { "1Table" } else { "0Table" },
        text_chars,
        places: Places {
            styles: pair(1),
            chars: pair(12),
            paras: pair(13),
            lists: pair(73),
            overrides: pair(74),
        },
        clx: pair(33),
    })
}

/// A piece of text: its character positions and where its bytes are.
struct Piece {
    start: u32,
    end: u32,
    fc: u32,
    compressed: bool,
}

/// The piece table, from the complex part (CLX) of the table stream.
fn pieces(table: &[u8], (fc, lcb): (u32, u32)) -> Result<Vec<Piece>, Problem> {
    let damaged = Problem::Damaged("its piece table is damaged");
    let clx = slice(table, index(fc), index(lcb)).ok_or(damaged)?;
    let mut pos = 0usize;
    // Property groups come first, each with a two-byte size, then the piece table itself.
    while clx.get(pos) == Some(&1) {
        pos += 3 + usize::from(u16_at(clx, pos + 1).ok_or(damaged)?);
    }
    if clx.get(pos) != Some(&2) {
        return Err(damaged);
    }
    let plc = slice(clx, pos + 5, index(u32_at(clx, pos + 1).ok_or(damaged)?)).ok_or(damaged)?;
    let n = (plc.len().saturating_sub(4) / 12).min(MAX_PIECES);
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let (Some(start), Some(end), Some(raw)) = (
            u32_at(plc, 4 * i),
            u32_at(plc, 4 * i + 4),
            u32_at(plc, 4 * (n + 1) + 8 * i + 2),
        ) else {
            break;
        };
        if end <= start {
            continue;
        }
        let compressed = raw & 0x4000_0000 != 0;
        let fc = raw & 0x3FFF_FFFF;
        out.push(Piece {
            start,
            end,
            fc: if compressed { fc / 2 } else { fc },
            compressed,
        });
    }
    out.sort_by_key(|p| p.start);
    Ok(out)
}

/// A field being read: its instruction so far, whether its result has started, and the link it makes.
struct Field {
    instruction: String,
    in_result: bool,
    link: Option<String>,
}

/// Walks the text and hands it to the flow.
struct Walker<'p, 'a> {
    props: &'p Props<'a>,
    flow: Flow,
    fields: Vec<Field>,
    deep_fields: usize,
    chars: Chars,
    char_run: Option<Run>,
    text: String,
    text_marks: Marks,
    high_surrogate: Option<u16>,
    nested: bool,
}

impl<'p, 'a> Walker<'p, 'a> {
    fn new(props: &'p Props<'a>) -> Walker<'p, 'a> {
        Walker {
            props,
            flow: Flow::default(),
            fields: Vec::new(),
            deep_fields: 0,
            chars: Chars::default(),
            char_run: None,
            text: String::new(),
            text_marks: Marks::none(),
            high_surrogate: None,
            nested: false,
        }
    }

    /// Reads `count` characters of a piece.
    fn piece(&mut self, word: &[u8], piece: &Piece, count: u32) {
        let width = if piece.compressed { 1 } else { 2 };
        for i in 0..count {
            let Some(fc) = piece.fc.checked_add(i.saturating_mul(width)) else {
                return;
            };
            let unit = if piece.compressed {
                word.get(index(fc)).map(|b| cp1252(*b))
            } else {
                u16_at(word, index(fc))
            };
            let Some(unit) = unit else {
                return;
            };
            self.character(fc, unit);
        }
    }

    fn character(&mut self, fc: u32, unit: u16) {
        if !Props::covers(self.char_run, fc) {
            self.char_run = self.props.char_run(fc);
            self.chars = self.props.characters(self.char_run);
        }
        match unit {
            0x0C..=0x0E => self.paragraph_mark(fc, false),
            0x07 => self.paragraph_mark(fc, true),
            0x13 => self.field_begin(),
            0x14 => self.field_separator(),
            0x15 => self.field_end(),
            _ if !self.showing() => self.instruction(unit),
            _ if self.chars.hidden => {}
            0x0B => {
                self.flush();
                self.flow.line_break();
            }
            0x01 | 0x08 | 0x02 | 0x05 if self.chars.special => self.special(unit),
            0x09 => self.push('\t'),
            0x1E => self.push('-'),
            0x00..=0x1F => {}
            _ => self.push_unit(unit),
        }
    }

    fn special(&mut self, unit: u16) {
        let losses = &mut self.flow.losses;
        match unit {
            0x01 => losses.pictures += 1,
            0x08 => losses.drawings += 1,
            0x02 => losses.notes += 1,
            _ => losses.comments += 1,
        }
    }

    /// Whether text is shown here: outside fields, or in the result of every field around it.
    fn showing(&self) -> bool {
        self.fields.iter().all(|f| f.in_result)
    }

    fn push_unit(&mut self, unit: u16) {
        if (0xD800..0xDC00).contains(&unit) {
            self.high_surrogate = Some(unit);
            return;
        }
        let units = match self.high_surrogate.take() {
            Some(high) if (0xDC00..0xE000).contains(&unit) => vec![high, unit],
            _ => vec![unit],
        };
        for c in char::decode_utf16(units) {
            self.push(c.unwrap_or(char::REPLACEMENT_CHARACTER));
        }
    }

    fn push(&mut self, c: char) {
        let mut marks = self.chars.marks.clone();
        marks.link = self.fields.iter().rev().find_map(|f| f.link.clone());
        if marks != self.text_marks {
            self.flush();
            self.text_marks = marks;
        }
        self.text.push(c);
    }

    fn flush(&mut self) {
        if !self.text.is_empty() {
            let text = std::mem::take(&mut self.text);
            self.flow.text(&text, &self.text_marks);
        }
    }

    fn paragraph_mark(&mut self, fc: u32, cell_mark: bool) {
        self.flush();
        let para: Para = self.props.paragraph(self.props.para_run(fc));
        if para.depth >= 2 {
            // A table inside a table: its cells and rows become lines of the outer cell.
            if !self.nested {
                self.flow.losses.nested_tables += 1;
                self.nested = true;
            }
            self.flow.end_paragraph(&para.props);
            return;
        }
        self.nested = false;
        if cell_mark && para.row_end {
            self.flow.end_row();
        } else if cell_mark && para.props.in_table {
            self.flow.end_cell();
        } else {
            self.flow.end_paragraph(&para.props);
        }
    }

    fn field_begin(&mut self) {
        self.flush();
        if self.fields.len() >= MAX_FIELD_DEPTH {
            self.deep_fields += 1;
            return;
        }
        self.fields.push(Field {
            instruction: String::new(),
            in_result: false,
            link: None,
        });
    }

    fn field_separator(&mut self) {
        if self.deep_fields > 0 {
            return;
        }
        self.flush();
        if let Some(field) = self.fields.last_mut() {
            field.in_result = true;
            field.link = hyperlink(&field.instruction);
            let kind = field.instruction.trim_start();
            if kind.starts_with("INCLUDEPICTURE") || kind.starts_with("EMBED") {
                self.flow.losses.drawings += 1;
            }
        }
    }

    fn field_end(&mut self) {
        if self.deep_fields > 0 {
            self.deep_fields -= 1;
            return;
        }
        self.flush();
        self.fields.pop();
    }

    fn instruction(&mut self, unit: u16) {
        if self.deep_fields > 0 {
            return;
        }
        if let Some(field) = self.fields.last_mut().filter(|f| !f.in_result) {
            if field.instruction.len() < MAX_INSTRUCTION {
                field.instruction.push(char::from_u32(u32::from(unit)).unwrap_or(' '));
            }
        }
    }
}

/// A Windows-1252 byte as one unit of UTF-16 text. Bytes 0x80 to 0x9F hold punctuation there, not control characters.
fn cp1252(byte: u8) -> u16 {
    const HIGH: [u16; 32] = [
        0x20AC, 0x81, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8D,
        0x017D, 0x8F, 0x90, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A,
        0x0153, 0x9D, 0x017E, 0x0178,
    ];
    match byte {
        0x80..=0x9F => HIGH.get(usize::from(byte - 0x80)).copied().unwrap_or(0xFFFD),
        _ => u16::from(byte),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn windows_1252_punctuation_maps_to_unicode() {
        assert_eq!(cp1252(0x93), 0x201C);
        assert_eq!(cp1252(b'a'), 0x61);
        assert_eq!(cp1252(0xE9), 0xE9);
    }

    #[test]
    fn a_header_that_is_not_word_is_refused() {
        assert!(matches!(fib(&[0u8; 64]), Err(Problem::Damaged(_))));
        let mut old = vec![0u8; 64];
        old[0..2].copy_from_slice(&0xA5ECu16.to_le_bytes());
        old[2..4].copy_from_slice(&0x0065u16.to_le_bytes());
        assert!(matches!(fib(&old), Err(Problem::Unsupported(_))));
    }

    #[test]
    fn a_piece_table_without_pieces_is_an_error() {
        assert!(pieces(&[0u8; 8], (0, 8)).is_err());
        assert!(pieces(&[1, 0xFF, 0xFF], (0, 3)).is_err());
        let empty = pieces(&[2, 4, 0, 0, 0, 0, 0, 0, 0], (0, 9)).expect("an empty table");
        assert!(empty.is_empty());
    }
}
