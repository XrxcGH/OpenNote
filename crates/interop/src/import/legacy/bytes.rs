//! Little-endian reads that check every offset, for the binary readers. Each returns `None` past the end.

/// The bytes `at..at + len`, or `None` when they are not all there.
pub(super) fn slice(data: &[u8], at: usize, len: usize) -> Option<&[u8]> {
    data.get(at..at.checked_add(len)?)
}

pub(super) fn u8_at(data: &[u8], at: usize) -> Option<u8> {
    data.get(at).copied()
}

pub(super) fn u16_at(data: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(slice(data, at, 2)?.try_into().ok()?))
}

pub(super) fn u32_at(data: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(slice(data, at, 4)?.try_into().ok()?))
}

pub(super) fn i32_at(data: &[u8], at: usize) -> Option<i32> {
    Some(i32::from_le_bytes(slice(data, at, 4)?.try_into().ok()?))
}

pub(super) fn u64_at(data: &[u8], at: usize) -> Option<u64> {
    Some(u64::from_le_bytes(slice(data, at, 8)?.try_into().ok()?))
}

pub(super) fn f64_at(data: &[u8], at: usize) -> Option<f64> {
    Some(f64::from_le_bytes(slice(data, at, 8)?.try_into().ok()?))
}

/// A `u32` from the file as an index or length.
pub(super) fn index(value: u32) -> usize {
    usize::try_from(value).unwrap_or(usize::MAX)
}

/// UTF-16LE text, with unpaired surrogates replaced. A trailing odd byte is dropped.
pub(super) fn utf16(data: &[u8]) -> String {
    let units = data.as_chunks::<2>().0.iter().map(|p| u16::from_le_bytes(*p));
    char::decode_utf16(units)
        .map(|c| c.unwrap_or(char::REPLACEMENT_CHARACTER))
        .collect()
}

/// A cursor over a record's bytes.
pub(super) struct Cursor<'a> {
    pub data: &'a [u8],
    pub pos: usize,
}

impl<'a> Cursor<'a> {
    pub fn new(data: &'a [u8]) -> Cursor<'a> {
        Cursor { data, pos: 0 }
    }

    pub fn take(&mut self, len: usize) -> Option<&'a [u8]> {
        let bytes = slice(self.data, self.pos, len)?;
        self.pos += len;
        Some(bytes)
    }

    pub fn u8(&mut self) -> Option<u8> {
        Some(*self.take(1)?.first()?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_past_the_end_are_none() {
        let data = [1u8, 0, 0, 0];
        assert_eq!(u32_at(&data, 0), Some(1));
        assert_eq!(u32_at(&data, 1), None);
        assert_eq!(slice(&data, usize::MAX, 2), None);
        let mut cursor = Cursor::new(&data);
        assert_eq!(cursor.u8(), Some(1));
        assert_eq!(cursor.take(4), None);
        assert_eq!(utf16(&[0x41, 0, 0x00, 0xD8, 0x42]), "A\u{FFFD}");
    }
}
