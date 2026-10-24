//! A small ZIP writer, enough for Office files: named entries, deflated when that helps, no ZIP64.

use std::io::Write as _;

use flate2::write::DeflateEncoder;
use flate2::Compression;

use crate::error::{InteropError, Result};

const LOCAL_HEADER: u32 = 0x0403_4b50;
const CENTRAL_HEADER: u32 = 0x0201_4b50;
const END_RECORD: u32 = 0x0605_4b50;
/// 1980-01-01, the earliest DOS date, so the same input always gives the same bytes.
const DOS_DATE: u16 = 0x0021;
const UTF8_NAMES: u16 = 0x0800;

struct Entry {
    name: String,
    method: u16,
    crc: u32,
    packed: u32,
    size: u32,
    offset: u32,
}

/// Collects entries and writes the ZIP file.
#[derive(Default)]
pub struct ZipWriter {
    out: Vec<u8>,
    entries: Vec<Entry>,
}

impl ZipWriter {
    /// An empty archive.
    pub fn new() -> ZipWriter {
        ZipWriter::default()
    }

    /// Adds a file. Fails if the file or the archive passes 4 GiB, which this writer does not support.
    pub fn add(&mut self, name: &str, data: &[u8]) -> Result<()> {
        let too_big = || InteropError::TooBig(format!("the file {name} in a ZIP archive"));
        let size = u32::try_from(data.len()).map_err(|_| too_big())?;
        let (method, packed_data) = pack(data);
        let packed = u32::try_from(packed_data.len()).map_err(|_| too_big())?;
        let offset = u32::try_from(self.out.len()).map_err(|_| too_big())?;
        let entry = Entry {
            name: name.to_owned(),
            method,
            crc: crc32fast::hash(data),
            packed,
            size,
            offset,
        };
        self.local_header(&entry);
        self.out.extend_from_slice(&packed_data);
        self.entries.push(entry);
        Ok(())
    }

    fn local_header(&mut self, entry: &Entry) {
        self.u32(LOCAL_HEADER);
        self.u16(20);
        self.u16(UTF8_NAMES);
        self.entry_fields(entry);
        self.u16(0);
        self.out.extend_from_slice(entry.name.as_bytes());
    }

    /// The fields that the local header and the central directory share, from the method to the name length.
    fn entry_fields(&mut self, entry: &Entry) {
        self.u16(entry.method);
        self.u16(0);
        self.u16(DOS_DATE);
        self.u32(entry.crc);
        self.u32(entry.packed);
        self.u32(entry.size);
        self.u16(entry.name.len() as u16);
    }

    /// Writes the central directory and returns the finished archive.
    pub fn finish(mut self) -> Result<Vec<u8>> {
        let directory_start =
            u32::try_from(self.out.len()).map_err(|_| InteropError::TooBig("a ZIP archive".into()))?;
        let entries = std::mem::take(&mut self.entries);
        for entry in &entries {
            self.u32(CENTRAL_HEADER);
            self.u16(20);
            self.u16(20);
            self.u16(UTF8_NAMES);
            self.entry_fields(entry);
            for _ in 0..4 {
                self.u16(0);
            }
            self.u32(0);
            self.u32(entry.offset);
            self.out.extend_from_slice(entry.name.as_bytes());
        }
        let directory_size = self.out.len() as u32 - directory_start;
        let count = u16::try_from(entries.len()).map_err(|_| InteropError::TooBig("a ZIP archive".into()))?;
        self.u32(END_RECORD);
        self.u16(0);
        self.u16(0);
        self.u16(count);
        self.u16(count);
        self.u32(directory_size);
        self.u32(directory_start);
        self.u16(0);
        Ok(self.out)
    }

    fn u16(&mut self, value: u16) {
        self.out.extend_from_slice(&value.to_le_bytes());
    }

    fn u32(&mut self, value: u32) {
        self.out.extend_from_slice(&value.to_le_bytes());
    }
}

/// Deflates the data when that makes it smaller. Returns the ZIP method (8 for deflate, 0 for stored) and the bytes.
fn pack(data: &[u8]) -> (u16, Vec<u8>) {
    let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
    let deflated = encoder.write_all(data).and_then(|()| encoder.finish());
    match deflated {
        Ok(bytes) if bytes.len() < data.len() => (8, bytes),
        _ => (0, data.to_vec()),
    }
}

/// Reads the entries of an archive that this writer made, for tests.
#[cfg(any(test, feature = "testing"))]
pub fn read_entries(zip: &[u8]) -> Vec<(String, Vec<u8>)> {
    use std::io::Read as _;

    let u16_at = |at: usize| usize::from(u16::from_le_bytes([zip[at], zip[at + 1]]));
    let u32_at = |at: usize| u32::from_le_bytes([zip[at], zip[at + 1], zip[at + 2], zip[at + 3]]) as usize;
    let end = zip.len() - 22;
    assert_eq!(u32_at(end), END_RECORD as usize, "the archive ends with an end record");
    let (count, mut at) = (u16_at(end + 10), u32_at(end + 16));
    let mut out = Vec::new();
    for _ in 0..count {
        let (method, packed, name_len) = (u16_at(at + 10), u32_at(at + 20), u16_at(at + 28));
        let local = u32_at(at + 42);
        let name = String::from_utf8(zip[at + 46..at + 46 + name_len].to_vec()).expect("UTF-8 names");
        let start = local + 30 + u16_at(local + 26) + u16_at(local + 28);
        let raw = &zip[start..start + packed];
        let data = if method == 8 {
            let mut data = Vec::new();
            flate2::read::DeflateDecoder::new(raw)
                .read_to_end(&mut data)
                .expect("valid deflate data");
            data
        } else {
            raw.to_vec()
        };
        out.push((name, data));
        at += 46 + name_len + u16_at(at + 30) + u16_at(at + 32);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entries_read_back_whether_stored_or_deflated() {
        let repeated = "abc".repeat(500).into_bytes();
        let mut zip = ZipWriter::new();
        zip.add("a/big.txt", &repeated).expect("adds");
        zip.add("tiny.bin", b"x").expect("adds");
        let bytes = zip.finish().expect("finishes");
        let entries = read_entries(&bytes);
        assert_eq!(
            entries,
            vec![
                ("a/big.txt".to_owned(), repeated),
                ("tiny.bin".to_owned(), b"x".to_vec())
            ]
        );
    }
}
