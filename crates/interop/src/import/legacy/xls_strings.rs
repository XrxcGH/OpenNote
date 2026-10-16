//! The strings of an Excel 97-2003 workbook ([MS-XLS] 2.5.293 and 2.4.265).
//!
//! The shared string table (SST) can be longer than one record, so it continues in CONTINUE records. A string's
//! characters may break across that boundary, and each continuation then starts with a new flag byte that says
//! whether the rest is one or two bytes a character. [`Segments`] reads across those boundaries.

use super::bytes::{u16_at, utf16};

/// The most shared strings kept, and the most text in them.
const MAX_STRINGS: usize = 4_000_000;
const MAX_STRING_BYTES: usize = 64 << 20;

/// Reads across the record data of a record and its continuations.
pub(super) struct Segments<'a> {
    parts: Vec<&'a [u8]>,
    part: usize,
    pos: usize,
}

impl<'a> Segments<'a> {
    pub fn new(parts: Vec<&'a [u8]>) -> Segments<'a> {
        Segments { parts, part: 0, pos: 0 }
    }

    /// Moves to the next segment when this one is used up. Returns false at the end.
    fn ready(&mut self) -> bool {
        while self.parts.get(self.part).is_some_and(|p| self.pos >= p.len()) {
            self.part += 1;
            self.pos = 0;
        }
        self.part < self.parts.len()
    }

    pub fn u8(&mut self) -> Option<u8> {
        if !self.ready() {
            return None;
        }
        let byte = self.parts.get(self.part)?.get(self.pos).copied();
        self.pos += 1;
        byte
    }

    pub fn u16(&mut self) -> Option<u16> {
        Some(u16::from_le_bytes([self.u8()?, self.u8()?]))
    }

    pub fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes([self.u8()?, self.u8()?, self.u8()?, self.u8()?]))
    }

    /// Skips bytes, across segments.
    pub fn skip(&mut self, mut count: usize) -> Option<()> {
        while count > 0 {
            if !self.ready() {
                return None;
            }
            let left = self.parts.get(self.part)?.len() - self.pos;
            let step = left.min(count);
            self.pos += step;
            count -= step;
        }
        Some(())
    }

    /// Reads `count` characters. When they cross into a new segment, it starts with a fresh flag byte.
    fn chars(&mut self, count: usize, mut wide: bool) -> Option<String> {
        let mut out = String::new();
        let mut left = count;
        while left > 0 {
            if !self.ready() {
                return None;
            }
            let part = *self.parts.get(self.part)?;
            let room = (part.len() - self.pos) / if wide { 2 } else { 1 };
            if room == 0 {
                // A wide character cannot split; a damaged file ends the string here.
                return None;
            }
            let take = room.min(left);
            let bytes = part.get(self.pos..self.pos + take * if wide { 2 } else { 1 })?;
            if wide {
                out.push_str(&utf16(bytes));
            } else {
                out.extend(bytes.iter().map(|b| char::from(*b)));
            }
            self.pos += bytes.len();
            left -= take;
            if left > 0 {
                self.part += 1;
                self.pos = 0;
                wide = self.u8()? & 1 != 0;
            }
        }
        Some(out)
    }

    /// An `XLUnicodeRichExtendedString`: a length, flags, the characters, then formatting runs and phonetic data
    /// that are skipped.
    pub fn rich_string(&mut self) -> Option<String> {
        let count = usize::from(self.u16()?);
        let flags = self.u8()?;
        let runs = if flags & 0x08 != 0 { usize::from(self.u16()?) } else { 0 };
        let extra = if flags & 0x04 != 0 { self.u32()? as usize } else { 0 };
        let text = self.chars(count, flags & 1 != 0)?;
        self.skip(runs * 4)?;
        self.skip(extra)?;
        Some(text)
    }
}

/// The shared strings, from the SST record and its continuations.
pub(super) fn shared_strings(parts: Vec<&[u8]>) -> Vec<String> {
    let mut segments = Segments::new(parts);
    let (Some(_total), Some(unique)) = (segments.u32(), segments.u32()) else {
        return Vec::new();
    };
    let unique = (unique as usize).min(MAX_STRINGS);
    let mut out = Vec::with_capacity(unique.min(65_536));
    let mut bytes = 0usize;
    while out.len() < unique {
        let Some(text) = segments.rich_string() else {
            break;
        };
        bytes += text.len();
        if bytes > MAX_STRING_BYTES {
            break;
        }
        out.push(text);
    }
    out
}

/// An `XLUnicodeString` in one record: a two-byte length, a flag byte, and the characters.
pub(super) fn unicode_string(data: &[u8], at: usize) -> Option<String> {
    let count = usize::from(u16_at(data, at)?);
    let flags = *data.get(at + 2)?;
    let start = at + 3;
    if flags & 1 != 0 {
        Some(utf16(data.get(start..start + 2 * count)?))
    } else {
        Some(data.get(start..start + count)?.iter().map(|b| char::from(*b)).collect())
    }
}

/// A `ShortXLUnicodeString`: a one-byte length, a flag byte, and the characters.
pub(super) fn short_string(data: &[u8], at: usize) -> Option<String> {
    let count = usize::from(*data.get(at)?);
    let flags = *data.get(at + 1)?;
    let start = at + 2;
    if flags & 1 != 0 {
        Some(utf16(data.get(start..start + 2 * count)?))
    } else {
        Some(data.get(start..start + count)?.iter().map(|b| char::from(*b)).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_string_split_across_records_switches_width() {
        // Two strings: "ab" in one byte a character, then "cdé" that starts narrow and continues wide.
        let first = [2u8, 0, 0, 0, 2, 0, 0, 0, 2, 0, 0, b'a', b'b', 3, 0, 0, b'c'];
        let second = [1u8, b'd', 0, 0xE9, 0];
        let strings = shared_strings(vec![&first, &second]);
        assert_eq!(strings, ["ab", "cdé"]);
    }

    #[test]
    fn short_or_lying_tables_stop_without_panicking() {
        let lying = [0u8, 0, 0, 0, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 1];
        assert!(shared_strings(vec![&lying]).is_empty());
        assert_eq!(unicode_string(&[5, 0, 0, b'a'], 0), None);
        assert_eq!(short_string(&[2, 1, b'h', 0, b'i', 0], 0).as_deref(), Some("hi"));
    }
}
