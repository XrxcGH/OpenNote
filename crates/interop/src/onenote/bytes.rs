//! Reading little-endian values from a OneNote file without ever reading past the end.
//!
//! Every read checks its bounds and returns [`Damage`] instead of panicking, so a damaged or hostile file can
//! only make the reader stop with an error. The identifiers follow [MS-ONESTORE] 2.2.1 (ExtendedGUID) and
//! 2.2.2 (CompactID), and GUIDs use the byte order of [MS-DTYP].

use std::fmt;

/// Why a file could not be read. The text says where the reader stopped.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Damage(pub String);

impl Damage {
    pub(crate) fn new(what: impl Into<String>) -> Damage {
        Damage(what.into())
    }
}

/// The result of a read.
pub(crate) type Read<T> = Result<T, Damage>;

/// A GUID, kept as its 16 bytes in file order.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub(crate) struct Guid(pub [u8; 16]);

impl Guid {
    /// The all-zero GUID.
    pub(crate) const ZERO: Guid = Guid([0; 16]);

    /// A GUID from its written form `{d1-d2-d3-d4}`, as [MS-DTYP] lays out the fields.
    pub(crate) const fn new(d1: u32, d2: u16, d3: u16, d4: [u8; 8]) -> Guid {
        let a = d1.to_le_bytes();
        let b = d2.to_le_bytes();
        let c = d3.to_le_bytes();
        Guid([
            a[0], a[1], a[2], a[3], b[0], b[1], c[0], c[1], d4[0], d4[1], d4[2], d4[3], d4[4], d4[5], d4[6], d4[7],
        ])
    }

    /// Reads `{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}`, with or without the braces.
    pub(crate) fn parse(text: &str) -> Option<Guid> {
        let text = text.trim().trim_start_matches('{').trim_end_matches('}');
        let hex: String = text.chars().filter(|c| *c != '-').collect();
        if hex.len() != 32 || text.len() != 36 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
            return None;
        }
        let byte = |i: usize| u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).ok();
        let mut written = [0u8; 16];
        for (i, slot) in written.iter_mut().enumerate() {
            *slot = byte(i)?;
        }
        let d1 = u32::from_be_bytes([written[0], written[1], written[2], written[3]]);
        let d2 = u16::from_be_bytes([written[4], written[5]]);
        let d3 = u16::from_be_bytes([written[6], written[7]]);
        let mut d4 = [0u8; 8];
        d4.copy_from_slice(&written[8..]);
        Some(Guid::new(d1, d2, d3, d4))
    }
}

impl fmt::Display for Guid {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let b = &self.0;
        write!(
            f,
            "{{{:08X}-{:04X}-{:04X}-{:02X}{:02X}-{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}}}",
            u32::from_le_bytes([b[0], b[1], b[2], b[3]]),
            u16::from_le_bytes([b[4], b[5]]),
            u16::from_le_bytes([b[6], b[7]]),
            b[8],
            b[9],
            b[10],
            b[11],
            b[12],
            b[13],
            b[14],
            b[15]
        )
    }
}

/// An ExtendedGUID ([MS-ONESTORE] 2.2.1): a GUID and a number.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub(crate) struct ExGuid {
    pub guid: Guid,
    pub n: u32,
}

impl ExGuid {
    /// `{{00000000-0000-0000-0000-000000000000}, 0}`, which stands for "none".
    pub(crate) const ZERO: ExGuid = ExGuid { guid: Guid::ZERO, n: 0 };

    pub(crate) fn is_zero(self) -> bool {
        self == ExGuid::ZERO
    }
}

/// A place in the file and a size: a file chunk reference ([MS-ONESTORE] 2.2.4).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct Chunk {
    pub stp: u64,
    pub cb: u64,
}

impl Chunk {
    /// `fcrZero`, or an empty chunk.
    pub(crate) fn is_empty(self) -> bool {
        self.cb == 0
    }

    /// The bytes of the chunk, when they lie inside the file.
    pub(crate) fn slice(self, data: &[u8]) -> Read<&[u8]> {
        let start = usize::try_from(self.stp).map_err(|_| Damage::new("a reference points past the end"))?;
        let len = usize::try_from(self.cb).map_err(|_| Damage::new("a reference is too large"))?;
        let end = start
            .checked_add(len)
            .ok_or_else(|| Damage::new("a reference is too large"))?;
        data.get(start..end)
            .ok_or_else(|| Damage::new(format!("a reference points past the end ({start}+{len})")))
    }
}

/// A cursor over a byte slice. Every read is checked.
#[derive(Clone)]
pub(crate) struct Reader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> Reader<'a> {
    pub(crate) fn new(data: &'a [u8]) -> Reader<'a> {
        Reader { data, pos: 0 }
    }

    pub(crate) fn remaining(&self) -> usize {
        self.data.len() - self.pos
    }

    pub(crate) fn bytes(&mut self, len: usize) -> Read<&'a [u8]> {
        let end = self
            .pos
            .checked_add(len)
            .filter(|end| *end <= self.data.len())
            .ok_or_else(|| Damage::new(format!("a record ends early (wanted {len} more bytes)")))?;
        let out = &self.data[self.pos..end];
        self.pos = end;
        Ok(out)
    }

    fn array<const N: usize>(&mut self) -> Read<[u8; N]> {
        let mut out = [0u8; N];
        out.copy_from_slice(self.bytes(N)?);
        Ok(out)
    }

    pub(crate) fn u8(&mut self) -> Read<u8> {
        Ok(self.array::<1>()?[0])
    }

    pub(crate) fn u16(&mut self) -> Read<u16> {
        Ok(u16::from_le_bytes(self.array()?))
    }

    pub(crate) fn u32(&mut self) -> Read<u32> {
        Ok(u32::from_le_bytes(self.array()?))
    }

    pub(crate) fn u64(&mut self) -> Read<u64> {
        Ok(u64::from_le_bytes(self.array()?))
    }

    pub(crate) fn guid(&mut self) -> Read<Guid> {
        Ok(Guid(self.array()?))
    }

    pub(crate) fn exguid(&mut self) -> Read<ExGuid> {
        Ok(ExGuid {
            guid: self.guid()?,
            n: self.u32()?,
        })
    }

    /// A StringInStorageBuffer ([MS-ONESTORE] 2.2.3): a count of UTF-16 units, then the units.
    pub(crate) fn storage_string(&mut self) -> Read<String> {
        let units = self.u32()? as usize;
        let bytes = self.bytes(
            units
                .checked_mul(2)
                .ok_or_else(|| Damage::new("a string is too long"))?,
        )?;
        Ok(utf16(bytes))
    }
}

/// UTF-16LE text up to its first NUL, with unpaired surrogates replaced.
pub(crate) fn utf16(bytes: &[u8]) -> String {
    let units: Vec<u16> = bytes
        .as_chunks::<2>()
        .0
        .iter()
        .map(|c| u16::from_le_bytes(*c))
        .take_while(|u| *u != 0)
        .collect();
    String::from_utf16_lossy(&units)
}

/// A CompactID ([MS-ONESTORE] 2.2.2): `n` in the low 8 bits, the table index in the high 24.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct CompactId {
    pub n: u8,
    pub index: u32,
}

impl CompactId {
    pub(crate) fn from_u32(value: u32) -> CompactId {
        CompactId {
            n: (value & 0xFF) as u8,
            index: value >> 8,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn guids_read_and_print_in_the_written_form() {
        let text = "{7B5C52E4-D88C-4DA7-AEB1-5378D02996D3}";
        let guid = Guid::parse(text).expect("parses");
        // The first bytes of a .one file, as the header of the test files and [MS-ONESTORE] 2.3.1 show them.
        assert_eq!(&guid.0[..4], &[0xE4, 0x52, 0x5C, 0x7B]);
        assert_eq!(guid.to_string(), text);
        assert_eq!(Guid::parse("{nothex}"), None);
    }

    #[test]
    fn reads_past_the_end_are_damage_not_panics() {
        let mut reader = Reader::new(&[1, 2, 3]);
        assert_eq!(reader.u16(), Ok(0x0201));
        assert!(reader.u32().is_err());
        assert!(reader.bytes(usize::MAX).is_err());
        assert!(Chunk { stp: u64::MAX, cb: 2 }.slice(&[0; 4]).is_err());
        assert!(Chunk { stp: 2, cb: u64::MAX }.slice(&[0; 4]).is_err());
    }

    #[test]
    fn compact_ids_split_into_n_and_index() {
        assert_eq!(CompactId::from_u32(0x0000_0203), CompactId { n: 3, index: 2 });
    }
}
