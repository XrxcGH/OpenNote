//! The files of the file system workload: a page file, immutable segments, a readable copy, and an append-only
//! journal per page. Every byte is derived from the page number and a sequence number, so the verifier can
//! check each file without knowing what the writer did.
//!
//! - `<notebook>/pages/p<k>/page.json` holds the last sequence number the page includes, with a checksum line.
//! - `<notebook>/pages/p<k>/ink/s<seq>.seg` is a segment, written once with `create_durable`.
//! - `<notebook>/pages/p<k>/page.md` is a readable copy, written with `write_derived`.
//! - `<data>/journal/p<k>.<generation>.log` holds records. Each is a length, a sequence number, the payload,
//!   and a CRC-32 checksum, in little-endian order.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::rng::Rng;

/// Pages in the workload's notebook.
pub const PAGES: usize = 4;
/// Segments a page file refers to at most. Older ones are deleted after a save.
pub const KEEP_SEGMENTS: usize = 4;

/// Where the workload's files are.
#[derive(Clone, Debug)]
pub struct Layout {
    /// The notebook folder.
    pub notebook: PathBuf,
    /// The device-local data folder, which holds the journals.
    pub data: PathBuf,
}

impl Layout {
    /// A page's folder.
    pub fn page_dir(&self, page: usize) -> PathBuf {
        self.notebook.join("pages").join(format!("p{page}"))
    }

    /// A page's page file.
    pub fn page_json(&self, page: usize) -> PathBuf {
        self.page_dir(page).join("page.json")
    }

    /// A page's readable copy.
    pub fn page_md(&self, page: usize) -> PathBuf {
        self.page_dir(page).join("page.md")
    }

    /// A page's segment folder.
    pub fn ink_dir(&self, page: usize) -> PathBuf {
        self.page_dir(page).join("ink")
    }

    /// A segment.
    pub fn segment(&self, page: usize, seq: u64) -> PathBuf {
        self.ink_dir(page).join(format!("s{seq:010}.seg"))
    }

    /// The journal folder.
    pub fn journal_dir(&self) -> PathBuf {
        self.data.join("journal")
    }

    /// A journal generation.
    pub fn journal(&self, page: usize, generation: u64) -> PathBuf {
        self.journal_dir().join(format!("p{page}.{generation:06}.log"))
    }
}

/// The generations of a page's journal in `names`, oldest first.
pub fn generations(names: &[String], page: usize) -> Vec<u64> {
    let prefix = format!("p{page}.");
    let mut found: Vec<u64> = names
        .iter()
        .filter_map(|name| name.strip_prefix(&prefix)?.strip_suffix(".log")?.parse().ok())
        .collect();
    found.sort_unstable();
    found
}

/// A page file.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PageFile {
    /// The page.
    pub page: usize,
    /// The last journal sequence number the page includes.
    pub seq: u64,
    /// The segments it refers to: sequence number and length.
    pub segments: Vec<(u64, u64)>,
    /// Filler, so the file has a realistic size.
    pub body: String,
}

impl PageFile {
    /// The file's bytes: JSON and a checksum line.
    pub fn encode(&self) -> Vec<u8> {
        let json = serde_json::to_vec(self).unwrap_or_default();
        let mut bytes = json.clone();
        bytes.extend_from_slice(format!("\n#crc={:08x}\n", crc32fast::hash(&json)).as_bytes());
        bytes
    }

    /// Reads a page file, or says what is wrong with it.
    pub fn decode(bytes: &[u8]) -> Result<PageFile, String> {
        let text = std::str::from_utf8(bytes).map_err(|_| "not UTF-8".to_owned())?;
        let (json, crc) = text.rsplit_once("\n#crc=").ok_or("no checksum line")?;
        let crc = u32::from_str_radix(crc.trim_end(), 16).map_err(|_| "a bad checksum line")?;
        if crc32fast::hash(json.as_bytes()) != crc {
            return Err("the checksum doesn't match".into());
        }
        serde_json::from_str(json).map_err(|err| format!("bad JSON: {err}"))
    }

    /// The filler for a page at `seq`: 2 to 10 KB.
    pub fn body_for(page: usize, seq: u64) -> String {
        let len = 2_000 + (seq as usize * 37 + page * 101) % 8_000;
        "Lorem ipsum dolor sit amet. ".chars().cycle().take(len).collect()
    }
}

/// A segment's bytes.
pub fn segment_bytes(page: usize, seq: u64, len: u64) -> Vec<u8> {
    let mut bytes = vec![0u8; len as usize];
    Rng::derive(0x5e9, &[page as u64, seq]).fill(&mut bytes);
    bytes
}

/// A journal record's payload: 16 to 79 bytes.
pub fn payload(page: usize, seq: u64) -> Vec<u8> {
    let mut bytes = vec![0u8; 16 + (seq % 64) as usize];
    Rng::derive(0x10c, &[page as u64, seq]).fill(&mut bytes);
    bytes
}

/// A whole journal record.
pub fn record(page: usize, seq: u64) -> Vec<u8> {
    let payload = payload(page, seq);
    let mut body = seq.to_le_bytes().to_vec();
    body.extend_from_slice(&payload);
    let mut bytes = (payload.len() as u32).to_le_bytes().to_vec();
    bytes.extend_from_slice(&body);
    bytes.extend_from_slice(&crc32fast::hash(&body).to_le_bytes());
    bytes
}

/// A journal generation, read up to its first incomplete or damaged record.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct JournalRead {
    /// The sequence numbers of the whole records, in order.
    pub seqs: Vec<u64>,
    /// Whether bytes after the last whole record were left over.
    pub torn: bool,
    /// Records whose payload isn't the one their sequence number gives.
    pub wrong: Vec<u64>,
}

/// Reads a journal generation of `page`.
pub fn read_journal(page: usize, bytes: &[u8]) -> JournalRead {
    let mut read = JournalRead::default();
    let mut rest = bytes;
    while !rest.is_empty() {
        let Some(record) = next_record(rest) else {
            read.torn = true;
            break;
        };
        let (seq, payload_bytes, len) = record;
        if payload_bytes != payload(page, seq) {
            read.wrong.push(seq);
        }
        read.seqs.push(seq);
        rest = &rest[len..];
    }
    read
}

/// The next whole record: its sequence number, payload, and length in bytes.
fn next_record(bytes: &[u8]) -> Option<(u64, &[u8], usize)> {
    let len = u32::from_le_bytes(bytes.get(..4)?.try_into().ok()?) as usize;
    let total = 4 + 8 + len + 4;
    let body = bytes.get(4..4 + 8 + len)?;
    let crc = u32::from_le_bytes(bytes.get(12 + len..total)?.try_into().ok()?);
    if crc32fast::hash(body) != crc {
        return None;
    }
    let seq = u64::from_le_bytes(body.get(..8)?.try_into().ok()?);
    Some((seq, body.get(8..)?, total))
}

/// The readable copy of a page at `seq`.
pub fn page_md(page: usize, seq: u64) -> Vec<u8> {
    format!("# Page {page}\n\nSaved through edit {seq}.\n").into_bytes()
}

/// The parent folders a workload needs.
pub fn make_dirs(layout: &Layout) -> std::io::Result<()> {
    for page in 0..PAGES {
        std::fs::create_dir_all(layout.ink_dir(page))?;
    }
    std::fs::create_dir_all(layout.journal_dir())
}

/// The names in a folder, or none if it can't be read.
pub fn names(dir: &Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .map(|entries| entries.filter_map(|e| e.ok()?.file_name().into_string().ok()).collect())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_files_round_trip_and_catch_damage() {
        let page = PageFile {
            page: 2,
            seq: 41,
            segments: vec![(30, 900), (41, 12)],
            body: PageFile::body_for(2, 41),
        };
        let bytes = page.encode();
        assert_eq!(PageFile::decode(&bytes).unwrap(), page);
        assert!(PageFile::decode(&bytes[..bytes.len() / 2]).is_err());
        assert!(PageFile::decode(b"").is_err());
        let mut flipped = bytes.clone();
        flipped[10] ^= 1;
        assert!(PageFile::decode(&flipped).is_err());
    }

    #[test]
    fn journals_read_whole_records_and_notice_torn_tails() {
        let mut bytes = record(1, 5);
        bytes.extend(record(1, 6));
        assert_eq!(read_journal(1, &bytes).seqs, [5, 6]);
        let mut torn = bytes.clone();
        torn.extend(&record(1, 7)[..9]);
        let read = read_journal(1, &torn);
        assert_eq!((read.seqs.len(), read.torn), (2, true));
        let mut zeros = bytes.clone();
        zeros.extend([0u8; 30]);
        assert!(read_journal(1, &zeros).torn);
        assert_eq!(
            read_journal(2, &bytes).wrong,
            [5, 6],
            "records of another page are wrong"
        );
        assert_eq!(
            generations(
                &["p1.000002.log".into(), "p1.000001.log".into(), "p2.000009.log".into()],
                1
            ),
            [1, 2]
        );
    }
}
