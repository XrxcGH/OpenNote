//! What a device knows: every path in the notes folder with its content, its version vector, and whether it was
//! deleted. A head is one device's whole manifest, which is compressed and then sealed.

use std::collections::BTreeMap;
use std::io::{Read, Write};

use flate2::read::DeflateDecoder;
use flate2::write::DeflateEncoder;
use flate2::Compression;
use serde::{Deserialize, Serialize};

use crate::error::{Result, SyncError};

/// A version vector: how many changes of each device a version has seen.
pub type Vv = BTreeMap<String, u64>;

/// Whether `a` has seen everything `b` has.
pub fn dominates(a: &Vv, b: &Vv) -> bool {
    b.iter()
        .all(|(device, count)| a.get(device).copied().unwrap_or(0) >= *count)
}

/// Whether neither has seen the other.
pub fn concurrent(a: &Vv, b: &Vv) -> bool {
    !dominates(a, b) && !dominates(b, a)
}

/// The smallest vector that dominates both.
pub fn join(a: &Vv, b: &Vv) -> Vv {
    let mut out = a.clone();
    for (device, count) in b {
        let slot = out.entry(device.clone()).or_insert(0);
        *slot = (*slot).max(*count);
    }
    out
}

/// A file's bytes, by reference: its keyed hash, its size, and its chunks in order.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct Content {
    /// The keyed BLAKE2b hash of the whole file, in hex.
    pub id: String,
    /// Bytes.
    pub size: u64,
    /// Chunk names' hashes, in hex.
    pub chunks: Vec<String>,
}

/// One path's version. A deleted path keeps the content it had last, so an edit elsewhere can bring it back.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Entry {
    /// The version vector.
    pub vv: Vv,
    /// The content, or the last content before the delete.
    pub content: Content,
    /// A tombstone.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub deleted: bool,
}

impl Entry {
    /// Whether the path holds a file.
    pub fn live(&self) -> bool {
        !self.deleted
    }
}

/// Paths and their versions.
pub type Manifest = BTreeMap<String, Entry>;

/// A head: the manifest a device published, with the generations it had seen of the other devices.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Head {
    /// The format version, 1.
    pub v: u32,
    /// The device's tag.
    pub device: String,
    /// The head's generation: 1, 2, 3, and so on.
    pub generation: u64,
    /// The newest generation of each other device that this one had merged.
    #[serde(default)]
    pub seen: BTreeMap<String, u64>,
    /// When the device wrote it, in Unix milliseconds; 0 in heads written before this was kept.
    #[serde(default)]
    pub at: i64,
    /// Every path.
    pub entries: Manifest,
}

/// The largest manifest read: about 3 million files.
const MAX_HEAD: u64 = 512 * 1024 * 1024;

/// Compresses a head for sealing.
pub fn encode(head: &Head) -> Result<Vec<u8>> {
    let json = serde_json::to_vec(head).map_err(|_| SyncError::Local("the manifest could not be written".into()))?;
    let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(&json).map_err(SyncError::local)?;
    encoder.finish().map_err(SyncError::local)
}

/// Reads a head. Anything malformed is `None`: a sealed head that opens but doesn't read was not written here.
pub fn decode(bytes: &[u8]) -> Option<Head> {
    let mut json = Vec::new();
    DeflateDecoder::new(bytes).take(MAX_HEAD).read_to_end(&mut json).ok()?;
    let head: Head = serde_json::from_slice(&json).ok()?;
    let ids_ok = head
        .entries
        .values()
        .all(|e| is_id(&e.content.id) && e.content.chunks.iter().all(|c| is_id(c)));
    (head.v == 1 && ids_ok).then_some(head)
}

/// Whether a content or chunk ID is what this crate writes: 64 lowercase hex characters, a 32-byte keyed hash.
/// Anything else came from a buggy or hostile device, and names a blob it shouldn't.
pub fn is_id(id: &str) -> bool {
    id.len() == 64 && id.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f'))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vv(pairs: &[(&str, u64)]) -> Vv {
        pairs.iter().map(|(d, c)| (d.to_string(), *c)).collect()
    }

    #[test]
    fn version_vectors_order_by_what_each_has_seen() {
        let a = vv(&[("a", 2), ("b", 1)]);
        let b = vv(&[("a", 1), ("b", 1)]);
        let c = vv(&[("a", 1), ("b", 2)]);
        assert!(dominates(&a, &b) && !dominates(&b, &a));
        assert!(concurrent(&a, &c));
        assert!(dominates(&a, &a), "a vector dominates itself");
        assert!(dominates(&a, &Vv::new()));
        assert_eq!(join(&a, &c), vv(&[("a", 2), ("b", 2)]));
        assert_eq!(join(&a, &c), join(&c, &a));
    }

    #[test]
    fn heads_round_trip_and_garbage_is_refused() {
        let mut entries = Manifest::new();
        entries.insert(
            "Biology/s/p/page.json".into(),
            Entry {
                vv: vv(&[("a", 1)]),
                content: Content {
                    id: "ab".repeat(32),
                    size: 3,
                    chunks: vec!["cd".repeat(32)],
                },
                deleted: false,
            },
        );
        let head = Head {
            v: 1,
            device: "a".into(),
            generation: 4,
            seen: BTreeMap::new(),
            at: 1_800_000_000_000,
            entries,
        };
        assert_eq!(decode(&encode(&head).expect("encodes")).expect("decodes"), head);
        assert!(decode(b"not deflate").is_none());
        let newer = Head { v: 2, ..head.clone() };
        assert!(decode(&encode(&newer).expect("encodes")).is_none());
        // A chunk ID that isn't 64 hex characters, such as one that starts with a character of several bytes, would
        // name a blob outside `c/`, or split a character when it is cut for the folder name.
        for bad in ["é".repeat(32), "AB".repeat(32), "ab".into(), "../".repeat(21) + "a"] {
            let mut odd = head.clone();
            for entry in odd.entries.values_mut() {
                entry.content.chunks = vec![bad.clone()];
            }
            assert!(decode(&encode(&odd).expect("encodes")).is_none(), "{bad}");
            let mut odd = head.clone();
            for entry in odd.entries.values_mut() {
                entry.content.id = bad.clone();
            }
            assert!(decode(&encode(&odd).expect("encodes")).is_none(), "{bad}");
        }
    }
}
