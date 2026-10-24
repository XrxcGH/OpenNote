//! The paragraph and character properties of a Word 97-2003 file ([MS-DOC] 2.4.6 and 2.6).
//!
//! Properties live in 512-byte pages (FKPs) of the WordDocument stream, keyed by file position. Each page lists
//! runs of positions and, for each run, a list of property changes (SPRMs). This module reads the pages into
//! sorted runs that point into the stream, so no property bytes are copied.
//!
//! It reads the few properties the importer uses:
//! - bold, italic, underline, strikethrough, raised text, lowered text, and hidden text
//! - table marks and list membership
//! - the style, which names headings

use super::bytes::{i32_at, index, slice, u16_at, u32_at, u8_at};
use super::flow::{ListProps, ParaProps};
use crate::doc::{Marks, Script};

const PAGE: usize = 512;
/// The most styles, lists, and list overrides read. Real files hold a few hundred at most.
const MAX_STYLES: usize = 4_096;
const MAX_LISTS: usize = 4_096;

/// A run of file positions and where its properties are in the WordDocument stream.
#[derive(Clone, Copy, Debug)]
pub(super) struct Run {
    start: u32,
    end: u32,
    at: usize,
    len: usize,
    istd: u16,
}

/// What the paragraph mark at a position says.
#[derive(Clone, Debug, Default)]
pub(super) struct Para {
    pub props: ParaProps,
    /// The mark ends a table row.
    pub row_end: bool,
    /// How deep in tables the paragraph is: 0 outside, 1 in a table, 2 in a table inside a table.
    pub depth: u32,
}

/// What a character run says.
#[derive(Clone, Debug, Default, PartialEq)]
pub(super) struct Chars {
    pub marks: Marks,
    pub hidden: bool,
    /// The character is a special one: a picture, a note mark, or a drawing.
    pub special: bool,
}

/// One style: whether it is a heading.
#[derive(Clone, Copy, Debug, Default)]
struct Style {
    heading: Option<u8>,
}

/// The list levels of each list, by list ID, and the list ID of each override.
#[derive(Default)]
struct Lists {
    defs: Vec<(i32, Vec<(u8, i32)>)>,
    overrides: Vec<i32>,
}

/// The table-stream positions the FIB gives for the property tables.
pub(super) struct Places {
    pub styles: (u32, u32),
    pub chars: (u32, u32),
    pub paras: (u32, u32),
    pub lists: (u32, u32),
    pub overrides: (u32, u32),
}

/// The properties of a document.
pub(super) struct Props<'a> {
    word: &'a [u8],
    paras: Vec<Run>,
    chars: Vec<Run>,
    styles: Vec<Style>,
    lists: Lists,
}

impl<'a> Props<'a> {
    /// Reads every table it can. A damaged table leaves its properties out instead of failing the import.
    pub fn read(word: &'a [u8], table: &[u8], places: &Places) -> Props<'a> {
        Props {
            word,
            paras: runs(word, table, places.paras, true),
            chars: runs(word, table, places.chars, false),
            styles: styles(table, places.styles),
            lists: lists(table, places.lists, places.overrides),
        }
    }

    pub fn para_run(&self, fc: u32) -> Option<Run> {
        find(&self.paras, fc)
    }

    pub fn char_run(&self, fc: u32) -> Option<Run> {
        find(&self.chars, fc)
    }

    /// Whether a run covers a position.
    pub fn covers(run: Option<Run>, fc: u32) -> bool {
        run.is_some_and(|r| r.start <= fc && fc < r.end)
    }

    fn grpprl(&self, run: &Run) -> &[u8] {
        slice(self.word, run.at, run.len).unwrap_or(&[])
    }

    /// The paragraph properties of a run.
    pub fn paragraph(&self, run: Option<Run>) -> Para {
        let mut para = Para::default();
        let Some(run) = run else {
            return para;
        };
        para.props.heading = self.styles.get(usize::from(run.istd)).and_then(|s| s.heading);
        let (mut in_table, mut level, mut override_index) = (false, 0u8, 0i16);
        for_each_sprm(self.grpprl(&run), &mut |sprm, op| {
            let byte = op.first().copied().unwrap_or(0);
            match sprm {
                0x2416 => in_table = byte != 0,
                0x2417 => para.row_end = byte != 0,
                0x6649 => para.depth = u32_at(op, 0).unwrap_or(0),
                0x244C if byte != 0 => para.row_end = true,
                0x260A => level = byte,
                0x460B => override_index = u16_at(op, 0).map_or(0, |v| v as i16),
                0x2640 if byte < 6 => para.props.heading = Some(byte + 1),
                _ => {}
            }
        });
        if in_table && para.depth == 0 {
            para.depth = 1;
        }
        para.props.in_table = para.depth > 0;
        if override_index > 0 && para.props.heading.is_none() {
            para.props.list = Some(self.list(override_index, level));
        }
        para
    }

    fn list(&self, override_index: i16, level: u8) -> ListProps {
        let found = usize::try_from(override_index - 1)
            .ok()
            .and_then(|i| self.lists.overrides.get(i))
            .and_then(|lsid| self.lists.defs.iter().find(|(id, _)| id == lsid))
            .and_then(|(_, levels)| levels.get(usize::from(level)).or(levels.first()));
        let (format, start) = found.copied().unwrap_or((0x17, 1));
        ListProps {
            // 0x17 is a bullet and 0xFF is no number.
            ordered: format != 0x17 && format != 0xFF,
            level,
            start: u64::try_from(start).unwrap_or(1),
        }
    }

    /// The character properties of a run.
    pub fn characters(&self, run: Option<Run>) -> Chars {
        let mut chars = Chars::default();
        let Some(run) = run else {
            return chars;
        };
        for_each_sprm(self.grpprl(&run), &mut |sprm, op| {
            // Toggles: 0 off, 1 on, 0x80 the style's value, 0x81 the opposite of the style's value.
            let on = matches!(op.first(), Some(1 | 0x81));
            match sprm {
                0x0835 => chars.marks.strong = on,
                0x0836 => chars.marks.emphasis = on,
                0x0837 | 0x2A53 => chars.marks.strike = on,
                0x2A3E => chars.marks.underline = op.first().is_some_and(|k| *k != 0),
                0x2A48 => {
                    chars.marks.script = match op.first() {
                        Some(1) => Some(Script::Sup),
                        Some(2) => Some(Script::Sub),
                        _ => None,
                    }
                }
                0x083C => chars.hidden = on,
                0x0855 => chars.special = on,
                _ => {}
            }
        });
        chars
    }
}

fn find(runs: &[Run], fc: u32) -> Option<Run> {
    let after = runs.partition_point(|r| r.start <= fc);
    let run = *runs.get(after.checked_sub(1)?)?;
    (fc < run.end).then_some(run)
}

/// Calls `f` with each property change and its operand. A change cut short ends the list.
pub(super) fn for_each_sprm(grpprl: &[u8], f: &mut dyn FnMut(u16, &[u8])) {
    let mut pos = 0usize;
    while let Some(sprm) = u16_at(grpprl, pos) {
        let operand_at = pos + 2;
        let len = match sprm >> 13 {
            0 | 1 => 1,
            2 | 4 | 5 => 2,
            3 => 4,
            7 => 3,
            // Table definitions give a two-byte size, one more than the bytes after it.
            _ if sprm == 0xD608 || sprm == 0xD606 => u16_at(grpprl, operand_at).map_or(0, usize::from) + 1,
            _ => u8_at(grpprl, operand_at).map_or(0, usize::from) + 1,
        };
        let Some(operand) = slice(grpprl, operand_at, len) else {
            return;
        };
        let value = if sprm >> 13 == 6 {
            operand.get(1..).unwrap_or(&[])
        } else {
            operand
        };
        f(sprm, value);
        pos = operand_at + len;
    }
}

/// The plex at `(fc, lcb)` in the table stream: `n + 1` positions and `n` values of `size` bytes.
fn plex(table: &[u8], (fc, lcb): (u32, u32), size: usize) -> Option<(&[u8], usize)> {
    let data = slice(table, index(fc), index(lcb))?;
    let n = data.len().checked_sub(4)? / (4 + size);
    Some((data, n))
}

/// The runs of every property page that the bin table at `place` lists.
fn runs(word: &[u8], table: &[u8], place: (u32, u32), paragraphs: bool) -> Vec<Run> {
    let Some((plex, n)) = plex(table, place, 4) else {
        return Vec::new();
    };
    let pages = n.min(word.len() / PAGE + 1);
    let mut out = Vec::new();
    for i in 0..pages {
        let Some(pn) = u32_at(plex, 4 * (n + 1) + 4 * i) else {
            break;
        };
        let start = index(pn & 0x3F_FFFF).saturating_mul(PAGE);
        if let Some(page) = slice(word, start, PAGE) {
            page_runs(page, start, paragraphs, &mut out);
        }
    }
    out.sort_by_key(|r| r.start);
    out
}

/// The runs of one property page. `base` is the page's place in the stream.
fn page_runs(page: &[u8], base: usize, paragraphs: bool, out: &mut Vec<Run>) {
    let count = usize::from(u8_at(page, PAGE - 1).unwrap_or(0));
    // Each run takes its position and an entry of 13 bytes for paragraphs or 1 byte for characters.
    let entry = if paragraphs { 13 } else { 1 };
    if 4 * (count + 1) + entry * count > PAGE - 1 {
        return;
    }
    for i in 0..count {
        let (Some(start), Some(end)) = (u32_at(page, 4 * i), u32_at(page, 4 * i + 4)) else {
            return;
        };
        let offset = usize::from(u8_at(page, 4 * (count + 1) + entry * i).unwrap_or(0)) * 2;
        let (at, len, istd) = if offset == 0 {
            (0, 0, 0)
        } else if paragraphs {
            paragraph_props(page, offset)
        } else {
            let len = usize::from(u8_at(page, offset).unwrap_or(0));
            (offset + 1, len, 0)
        };
        if at + len > PAGE || start >= end {
            continue;
        }
        let at = if len == 0 { 0 } else { base + at };
        out.push(Run {
            start,
            end,
            at,
            len,
            istd,
        });
    }
}

/// Where a paragraph's property changes are on its page, how long they are, and its style.
fn paragraph_props(page: &[u8], offset: usize) -> (usize, usize, u16) {
    let cb = usize::from(u8_at(page, offset).unwrap_or(0));
    let (at, len) = if cb != 0 {
        (offset + 1, (2 * cb).saturating_sub(1))
    } else {
        (offset + 2, 2 * usize::from(u8_at(page, offset + 1).unwrap_or(0)))
    };
    let istd = u16_at(page, at).unwrap_or(0);
    // The style comes first; the property changes follow it.
    (at + 2, len.saturating_sub(2), istd)
}

/// Which styles are headings, by style index, from the style sheet.
fn styles(table: &[u8], (fc, lcb): (u32, u32)) -> Vec<Style> {
    let Some(sheet) = slice(table, index(fc), index(lcb)) else {
        return Vec::new();
    };
    let info_len = usize::from(u16_at(sheet, 0).unwrap_or(0));
    let count = usize::from(u16_at(sheet, 2).unwrap_or(0)).min(MAX_STYLES);
    let base_len = usize::from(u16_at(sheet, 4).unwrap_or(10));
    let mut pos = 2 + info_len;
    let mut out = Vec::with_capacity(count);
    for _ in 0..count {
        let Some(len) = u16_at(sheet, pos) else {
            break;
        };
        let len = usize::from(len);
        let std = slice(sheet, pos + 2, len).unwrap_or(&[]);
        out.push(Style {
            heading: heading_of(std, base_len),
        });
        pos += 2 + len;
    }
    out
}

/// The heading level of a style, from its built-in identifier or its name.
fn heading_of(std: &[u8], base_len: usize) -> Option<u8> {
    let builtin = u16_at(std, 0)? & 0x0FFF;
    if (1..=9).contains(&builtin) {
        return Some(builtin.min(6) as u8);
    }
    // 62 is Title.
    if builtin == 62 {
        return Some(1);
    }
    let chars = usize::from(u16_at(std, base_len)?);
    let name = super::bytes::utf16(slice(std, base_len + 2, chars * 2)?).to_ascii_lowercase();
    let level: u8 = name.strip_prefix("heading ")?.trim().parse().ok()?;
    (1..=9).contains(&level).then(|| level.min(6))
}

/// The list definitions and the list overrides that paragraphs name.
fn lists(table: &[u8], lists: (u32, u32), overrides: (u32, u32)) -> Lists {
    let mut out = Lists::default();
    if let Some(plf) = slice(table, index(lists.0), index(lists.1)) {
        let count = usize::from(u16_at(plf, 0).unwrap_or(0)).min(MAX_LISTS);
        // The levels follow the list table in the stream, outside its stated size.
        let mut pos = index(lists.0).saturating_add(2 + 28 * count);
        for i in 0..count {
            let (Some(lsid), Some(flags)) = (i32_at(plf, 2 + 28 * i), u8_at(plf, 2 + 28 * i + 26)) else {
                break;
            };
            let level_count = if flags & 1 != 0 { 1 } else { 9 };
            let mut levels = Vec::with_capacity(level_count);
            for _ in 0..level_count {
                let Some((format, start, next)) = level(table, pos) else {
                    break;
                };
                levels.push((format, start));
                pos = next;
            }
            out.defs.push((lsid, levels));
        }
    }
    if let Some(lfo) = slice(table, index(overrides.0), index(overrides.1)) {
        let count = index(u32_at(lfo, 0).unwrap_or(0)).min(MAX_LISTS);
        out.overrides = (0..count).map_while(|i| i32_at(lfo, 4 + 16 * i)).collect();
    }
    out
}

/// A list level at `pos`: its number format, its first number, and where the next level starts.
fn level(table: &[u8], pos: usize) -> Option<(u8, i32, usize)> {
    let start = i32_at(table, pos)?;
    let format = u8_at(table, pos + 4)?;
    let chpx = usize::from(u8_at(table, pos + 24)?);
    let papx = usize::from(u8_at(table, pos + 25)?);
    let text_at = pos + 28 + papx + chpx;
    let text_len = usize::from(u16_at(table, text_at)?);
    Some((format, start, text_at + 2 + 2 * text_len))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn property_changes_are_split_by_their_operand_sizes() {
        let mut seen = Vec::new();
        // Bold on, underline 1, a variable operand of 2 bytes, then a change cut short.
        let grpprl = [0x35, 0x08, 1, 0x3E, 0x2A, 1, 0x00, 0xC6, 2, 9, 9, 0x0B, 0x46, 1];
        for_each_sprm(&grpprl, &mut |sprm, op| seen.push((sprm, op.to_vec())));
        assert_eq!(seen, vec![(0x0835, vec![1]), (0x2A3E, vec![1]), (0xC600, vec![9, 9])]);
    }

    #[test]
    fn a_page_with_too_many_runs_is_ignored() {
        let mut page = vec![0u8; PAGE];
        page[PAGE - 1] = 200;
        let mut out = Vec::new();
        page_runs(&page, 0, true, &mut out);
        assert!(out.is_empty());
    }

    #[test]
    fn style_names_give_heading_levels() {
        let mut std = vec![0u8; 10];
        std[0] = 0xFE;
        std[1] = 0x0F;
        let name: Vec<u8> = "Heading 2".encode_utf16().flat_map(u16::to_le_bytes).collect();
        std.extend(9u16.to_le_bytes());
        std.extend(name);
        assert_eq!(heading_of(&std, 10), Some(2));
        assert_eq!(heading_of(&[1, 0], 10), Some(1));
    }
}
