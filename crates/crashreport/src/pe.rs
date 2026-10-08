//! The debug id of a Windows program or library, read from its headers.
//!
//! A code offset in a crash report means something only for the build that crashed. Every Windows build has a
//! debug id: the GUID and age that its linker wrote into the build's debug information record and into the
//! matching `.pdb` file. A symbol table for that build carries the same id, so a report is only ever matched to
//! symbols of the build that made it. The id says which build crashed. It says nothing about the person.
//!
//! This module only reads bytes it is given, through a function, so the same code runs on a mapped module in
//! the running program and on a synthetic image in a test. It never reads outside the image the headers
//! describe.

/// The size of the DOS header, whose last field points to the PE headers.
const DOS_HEADER: usize = 64;
/// The `MZ` that starts every program and library.
const DOS_MAGIC: [u8; 2] = *b"MZ";
/// The `PE\0\0` that starts the PE headers.
const PE_MAGIC: [u8; 4] = *b"PE\0\0";
/// The bytes of PE headers read: the signature, the file header, and the whole optional header.
const NT_HEADERS: usize = 4 + 20 + 240;
/// Where the PE headers may start. Real programs have them within the first kilobyte.
const MAX_NT_OFFSET: usize = 0x1_0000;
/// The index of the debug directory among the data directories.
const DEBUG_DIRECTORY: usize = 6;
/// The size of one entry of the debug directory.
const DEBUG_ENTRY: usize = 28;
/// The entry type of a CodeView record, which holds the GUID and age.
const CODEVIEW: u32 = 2;
/// The most debug directory entries looked at.
const MAX_ENTRIES: usize = 16;

/// Reads `length` bytes at `offset` from the start of the image, or `None` when they are not available.
pub trait ImageReader {
    /// The bytes, or `None` when any part of them lies outside the image.
    fn read(&self, offset: usize, length: usize) -> Option<Vec<u8>>;
}

impl<F: Fn(usize, usize) -> Option<Vec<u8>>> ImageReader for F {
    fn read(&self, offset: usize, length: usize) -> Option<Vec<u8>> {
        self(offset, length)
    }
}

fn u16_at(bytes: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?))
}

fn u32_at(bytes: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?))
}

/// The debug id of the image, such as `3E5F3F0C8C2147B3B2C3B3F6F3E6F7E71`: the GUID in hexadecimal capitals,
/// then the age in hexadecimal without leading zeros. This is the form Breakpad symbol files use. `None` when
/// the headers are not a PE image, or the image has no debug information record.
pub fn debug_id(image: &dyn ImageReader) -> Option<String> {
    let dos = image.read(0, DOS_HEADER)?;
    if dos.get(..2)? != DOS_MAGIC {
        return None;
    }
    let nt_offset = usize::try_from(u32_at(&dos, 0x3C)?)
        .ok()
        .filter(|&at| at <= MAX_NT_OFFSET)?;
    let nt = image.read(nt_offset, NT_HEADERS)?;
    if nt.get(..4)? != PE_MAGIC {
        return None;
    }
    let optional = 4 + 20;
    let directories = match u16_at(&nt, optional)? {
        0x10B => optional + 96,
        0x20B => optional + 112,
        _ => return None,
    };
    let size_of_image = usize::try_from(u32_at(&nt, optional + 56)?).ok()?;
    let entry = directories + DEBUG_DIRECTORY * 8;
    let table = usize::try_from(u32_at(&nt, entry)?).ok()?;
    let table_size = usize::try_from(u32_at(&nt, entry + 4)?).ok()?;
    let inside = |at: usize, length: usize| at.checked_add(length).is_some_and(|end| end <= size_of_image);
    if table == 0 || !inside(table, table_size) {
        return None;
    }
    let count = (table_size / DEBUG_ENTRY).min(MAX_ENTRIES);
    let entries = image.read(table, count * DEBUG_ENTRY)?;
    (0..count).find_map(|i| {
        let entry = entries.get(i * DEBUG_ENTRY..(i + 1) * DEBUG_ENTRY)?;
        if u32_at(entry, 12)? != CODEVIEW {
            return None;
        }
        let size = usize::try_from(u32_at(entry, 16)?).ok()?;
        let rva = usize::try_from(u32_at(entry, 20)?).ok()?;
        if size < 24 || !inside(rva, 24) {
            return None;
        }
        codeview_id(&image.read(rva, 24)?)
    })
}

/// The id in a CodeView record that starts `RSDS`, a GUID, and an age.
fn codeview_id(record: &[u8]) -> Option<String> {
    if record.get(..4)? != b"RSDS" {
        return None;
    }
    let guid = record.get(4..20)?;
    let age = u32_at(record, 20)?;
    Some(format!(
        "{:08X}{:04X}{:04X}{}{:X}",
        u32_at(guid, 0)?,
        u16_at(guid, 4)?,
        u16_at(guid, 6)?,
        guid[8..].iter().map(|b| format!("{b:02X}")).collect::<String>(),
        age
    ))
}

/// Whether `text` could be a debug id: one to forty hexadecimal capitals or digits.
pub fn is_debug_id(text: &str) -> bool {
    (1..=40).contains(&text.len()) && text.bytes().all(|b| matches!(b, b'0'..=b'9' | b'A'..=b'F'))
}

#[cfg(test)]
#[path = "pe_tests.rs"]
mod tests;
