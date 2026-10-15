//! A small ZIP reader and writer for Anki packages: stored and deflated entries, no encryption and no ZIP64.
//! Packages are small, so each file is held whole in memory, with limits on what an entry may expand to.

use std::io::{Read, Write};

use flate2::{read::DeflateDecoder, write::DeflateEncoder, Compression};

/// The most one entry may expand to, so a crafted package can't fill memory.
pub const MAX_ENTRY_BYTES: u64 = 256 * 1024 * 1024;

/// The most all entries together may expand to, so many entries at the per-entry limit can't fill memory either.
pub const MAX_TOTAL_BYTES: u64 = 512 * 1024 * 1024;

const TOO_LARGE: &str = "A file in the package is too large.";

pub struct Entry {
    pub name: String,
    pub data: Vec<u8>,
}

fn u16_at(bytes: &[u8], at: usize) -> Option<usize> {
    Some(u16::from_le_bytes(bytes.get(at..at + 2)?.try_into().ok()?) as usize)
}

fn u32_at(bytes: &[u8], at: usize) -> Option<usize> {
    Some(u32::from_le_bytes(bytes.get(at..at + 4)?.try_into().ok()?) as usize)
}

/// Every file in the archive, in the order of its central directory.
pub fn read(bytes: &[u8]) -> Result<Vec<Entry>, String> {
    read_within(bytes, MAX_TOTAL_BYTES)
}

/// [`read`] with the package-wide expansion budget as a parameter.
fn read_within(bytes: &[u8], budget: u64) -> Result<Vec<Entry>, String> {
    let mut left = budget;
    let bad = || "The package isn't a valid ZIP file.".to_owned();
    let start = bytes.len().saturating_sub(22 + 65_535);
    let eocd = (start..bytes.len().saturating_sub(21))
        .rev()
        .find(|&at| bytes[at..].starts_with(&[0x50, 0x4b, 0x05, 0x06]))
        .ok_or_else(bad)?;
    let count = u16_at(bytes, eocd + 10).ok_or_else(bad)?;
    let mut at = u32_at(bytes, eocd + 16).ok_or_else(bad)?;
    let mut entries = Vec::with_capacity(count);
    for _ in 0..count {
        if !bytes
            .get(at..)
            .is_some_and(|rest| rest.starts_with(&[0x50, 0x4b, 0x01, 0x02]))
        {
            return Err(bad());
        }
        let method = u16_at(bytes, at + 10).ok_or_else(bad)?;
        let compressed = u32_at(bytes, at + 20).ok_or_else(bad)?;
        let name_len = u16_at(bytes, at + 28).ok_or_else(bad)?;
        let extra_len = u16_at(bytes, at + 30).ok_or_else(bad)?;
        let comment_len = u16_at(bytes, at + 32).ok_or_else(bad)?;
        let local = u32_at(bytes, at + 42).ok_or_else(bad)?;
        let name = String::from_utf8_lossy(bytes.get(at + 46..at + 46 + name_len).ok_or_else(bad)?).into_owned();
        at += 46 + name_len + extra_len + comment_len;
        if name.ends_with('/') {
            continue;
        }
        if !bytes
            .get(local..)
            .is_some_and(|rest| rest.starts_with(&[0x50, 0x4b, 0x03, 0x04]))
        {
            return Err(bad());
        }
        let skip = u16_at(bytes, local + 26).ok_or_else(bad)? + u16_at(bytes, local + 28).ok_or_else(bad)?;
        let data_at = local + 30 + skip;
        let packed = bytes.get(data_at..data_at + compressed).ok_or_else(bad)?;
        let data = match method {
            0 if packed.len() as u64 <= left.min(MAX_ENTRY_BYTES) => packed.to_vec(),
            0 => return Err(TOO_LARGE.to_owned()),
            8 => {
                let limit = left.min(MAX_ENTRY_BYTES);
                let mut out = Vec::new();
                DeflateDecoder::new(packed)
                    .take(limit + 1)
                    .read_to_end(&mut out)
                    .map_err(|_| bad())?;
                if out.len() as u64 > limit {
                    return Err(TOO_LARGE.to_owned());
                }
                out
            }
            _ => return Err("The package uses a compression this app can't read.".to_owned()),
        };
        left -= data.len() as u64;
        entries.push(Entry { name, data });
    }
    Ok(entries)
}

/// An archive of the files, deflated where that makes them smaller.
pub fn write(files: &[(String, Vec<u8>)]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut central = Vec::new();
    for (name, data) in files {
        let crc = crc32fast::hash(data);
        let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(data).expect("writing to memory");
        let packed = encoder.finish().expect("writing to memory");
        let (method, body) = if packed.len() < data.len() {
            (8u16, packed)
        } else {
            (0u16, data.clone())
        };
        let offset = out.len() as u32;
        let name_bytes = name.as_bytes();
        // Local header, then the data. Bit 11 says the name is UTF-8.
        out.extend_from_slice(&[0x50, 0x4b, 0x03, 0x04]);
        out.extend_from_slice(&20u16.to_le_bytes());
        out.extend_from_slice(&0x0800u16.to_le_bytes());
        out.extend_from_slice(&method.to_le_bytes());
        out.extend_from_slice(&[0, 0, 0x21, 0]);
        out.extend_from_slice(&crc.to_le_bytes());
        out.extend_from_slice(&(body.len() as u32).to_le_bytes());
        out.extend_from_slice(&(data.len() as u32).to_le_bytes());
        out.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(name_bytes);
        out.extend_from_slice(&body);
        central.extend_from_slice(&[0x50, 0x4b, 0x01, 0x02]);
        central.extend_from_slice(&20u16.to_le_bytes());
        central.extend_from_slice(&20u16.to_le_bytes());
        central.extend_from_slice(&0x0800u16.to_le_bytes());
        central.extend_from_slice(&method.to_le_bytes());
        central.extend_from_slice(&[0, 0, 0x21, 0]);
        central.extend_from_slice(&crc.to_le_bytes());
        central.extend_from_slice(&(body.len() as u32).to_le_bytes());
        central.extend_from_slice(&(data.len() as u32).to_le_bytes());
        central.extend_from_slice(&(name_bytes.len() as u16).to_le_bytes());
        central.extend_from_slice(&[0; 12]);
        central.extend_from_slice(&offset.to_le_bytes());
        central.extend_from_slice(name_bytes);
    }
    let central_at = out.len() as u32;
    out.extend_from_slice(&central);
    out.extend_from_slice(&[0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0]);
    out.extend_from_slice(&(files.len() as u16).to_le_bytes());
    out.extend_from_slice(&(files.len() as u16).to_le_bytes());
    out.extend_from_slice(&(central.len() as u32).to_le_bytes());
    out.extend_from_slice(&central_at.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_what_it_writes() {
        let files = vec![
            ("collection.anki2".to_owned(), b"hello hello hello hello hello".to_vec()),
            ("0".to_owned(), vec![1, 2, 3]),
            ("media".to_owned(), Vec::new()),
        ];
        let entries = read(&write(&files)).unwrap();
        assert_eq!(entries.len(), 3);
        for (entry, (name, data)) in entries.iter().zip(&files) {
            assert_eq!(&entry.name, name);
            assert_eq!(&entry.data, data);
        }
    }

    #[test]
    fn refuses_a_package_whose_entries_together_expand_past_the_budget() {
        let files: Vec<_> = (0..4).map(|n| (n.to_string(), vec![0u8; 1000])).collect();
        let package = write(&files);
        assert!(read_within(&package, 4000).is_ok());
        assert_eq!(read_within(&package, 3999).err().as_deref(), Some(TOO_LARGE));
    }

    #[test]
    fn refuses_text_that_is_not_a_zip() {
        assert!(read(b"not a zip file at all, only some text").is_err());
        assert!(read(&[]).is_err());
    }
}
