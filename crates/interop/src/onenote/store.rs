//! The revision store file ([MS-ONESTORE] 2.3 and 2.4): its header, its transaction log, and its file node lists.
//!
//! A file node list is a chain of fragments, each a run of file nodes. The transaction log says how many nodes
//! of each list were committed; nodes past that count belong to a write that never finished and are left out.

use std::cell::Cell;
use std::collections::{HashMap, HashSet};

use super::bytes::{Chunk, Damage, Guid, Read, Reader};
use super::limits;

/// `guidFileType` of a section file (`.one`), [MS-ONESTORE] 2.3.1.
pub(crate) const ONE_FILE: Guid = Guid::new(
    0x7B5C_52E4,
    0xD88C,
    0x4DA7,
    [0xAE, 0xB1, 0x53, 0x78, 0xD0, 0x29, 0x96, 0xD3],
);
/// `guidFileType` of a table of contents file (`.onetoc2`), [MS-ONESTORE] 2.3.1.
pub(crate) const TOC_FILE: Guid = Guid::new(
    0x43FF_2FA1,
    0xEFD9,
    0x4C76,
    [0x9E, 0xE2, 0x10, 0xEA, 0x57, 0x22, 0x76, 0x5F],
);
/// `guidFileFormat` of a revision store file, [MS-ONESTORE] 2.3.1.
pub(crate) const REVISION_STORE: Guid = Guid::new(
    0x109A_DD3F,
    0x911B,
    0x49F5,
    [0xA5, 0xD0, 0x17, 0x91, 0xED, 0xC8, 0xAE, 0xD8],
);
/// `guidFileFormat` of the alternative packaging that servers keep, [MS-ONESTORE] 2.8.1.
pub(crate) const PACKAGE_STORE: Guid = Guid::new(
    0x638D_E92F,
    0xA6D4,
    0x4BC1,
    [0x9A, 0x36, 0xB3, 0xFC, 0x25, 0x11, 0xA5, 0xB7],
);

/// `FileNodeListHeader.uintMagic`, [MS-ONESTORE] 2.4.2.
pub(crate) const LIST_MAGIC: u64 = 0xA456_7AB1_F5F7_F4C4;
/// `FileNodeListFragment.footer`, [MS-ONESTORE] 2.4.1.
pub(crate) const LIST_FOOTER: u64 = 0x8BC2_15C3_8233_BA4B;
/// `ChunkTerminatorFND`, [MS-ONESTORE] 2.4.3.
const CHUNK_TERMINATOR: u16 = 0x0FF;
/// The `srcID` that ends a transaction, [MS-ONESTORE] 2.3.3.2.
const SENTINEL: u32 = 1;
/// The size of the header, [MS-ONESTORE] 2.3.1.
pub(crate) const HEADER_SIZE: usize = 1024;

/// What a file with the OneNote header is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FileKind {
    /// A section in the revision store format, which this reader reads.
    Section,
    /// A notebook's table of contents (`.onetoc2`), which holds no pages.
    TableOfContents,
    /// A section in the server packaging of [MS-ONESTORE] 2.8, which this reader does not read.
    Packaged,
}

/// Says what kind of OneNote file the bytes are, from the header alone.
pub(crate) fn file_kind(data: &[u8]) -> Read<FileKind> {
    let mut header = Reader::new(data);
    let file_type = header.guid()?;
    header.bytes(32)?;
    let format = header.guid()?;
    match (file_type, format) {
        (ONE_FILE, REVISION_STORE) => Ok(FileKind::Section),
        (TOC_FILE, REVISION_STORE) => Ok(FileKind::TableOfContents),
        (ONE_FILE | TOC_FILE, PACKAGE_STORE) => Ok(FileKind::Packaged),
        _ => Err(Damage::new("it is not a OneNote section file")),
    }
}

/// One file node ([MS-ONESTORE] 2.4.3): its type and its data.
#[derive(Clone, Copy, Debug)]
pub(crate) struct Node<'a> {
    /// `FileNodeID`.
    pub id: u16,
    stp_format: u8,
    cb_format: u8,
    /// `fnd`: everything after the 4-byte header.
    pub fnd: &'a [u8],
}

impl<'a> Node<'a> {
    /// The data, from the start.
    pub(crate) fn data(&self) -> Reader<'a> {
        Reader::new(self.fnd)
    }

    /// Reads the FileNodeChunkReference at the start of the data ([MS-ONESTORE] 2.2.4.2), and the rest after it.
    /// `None` stands for `fcrNil`. Which node types start with a reference is decided by the node's ID, not by its
    /// `BaseType`: see the format notes in README.md.
    pub(crate) fn reference(&self) -> Read<(Option<Chunk>, Reader<'a>)> {
        let mut r = self.data();
        let (stp, nil) = match self.stp_format {
            0 => {
                let v = r.u64()?;
                (v, v == u64::MAX)
            }
            1 => {
                let v = r.u32()?;
                (u64::from(v), v == u32::MAX)
            }
            2 => {
                let v = r.u16()?;
                (u64::from(v) * 8, v == u16::MAX)
            }
            _ => {
                let v = r.u32()?;
                (u64::from(v) * 8, v == u32::MAX)
            }
        };
        let cb = match self.cb_format {
            0 => u64::from(r.u32()?),
            1 => r.u64()?,
            2 => u64::from(r.u8()?) * 8,
            _ => u64::from(r.u16()?) * 8,
        };
        let chunk = Chunk { stp, cb };
        Ok(((!(nil && cb == 0)).then_some(chunk), r))
    }
}

/// A FileChunkReference64x32 ([MS-ONESTORE] 2.2.4.4); `None` for `fcrNil`.
pub(crate) fn chunk64x32(r: &mut Reader<'_>) -> Read<Option<Chunk>> {
    let stp = r.u64()?;
    let cb = u64::from(r.u32()?);
    Ok((!(stp == u64::MAX && cb == 0)).then_some(Chunk { stp, cb }))
}

/// An open revision store file.
pub(crate) struct Store<'a> {
    /// The whole file.
    pub data: &'a [u8],
    /// The committed node count of each file node list, by `FileNodeListID`. Empty when the log is unreadable.
    committed: HashMap<u32, u32>,
    root: Option<Chunk>,
    /// File nodes read so far, against [`limits::NODES`].
    nodes: Cell<usize>,
}

impl<'a> Store<'a> {
    /// Opens a section file: checks the header and reads the transaction log.
    pub(crate) fn open(data: &'a [u8]) -> Read<Store<'a>> {
        if data.len() < HEADER_SIZE {
            return Err(Damage::new("the file is shorter than a OneNote header"));
        }
        let mut header = Reader::new(&data[96..100]);
        let transactions = header.u32()?;
        let mut at_log = Reader::new(&data[160..172]);
        let log = chunk64x32(&mut at_log)?;
        let mut at_root = Reader::new(&data[172..184]);
        let root = chunk64x32(&mut at_root)?;
        // A damaged log only loses the protection against half-written changes, so the reader goes on without it.
        let committed = log
            .map(|log| read_log(data, log, transactions).unwrap_or_default())
            .unwrap_or_default();
        Ok(Store {
            data,
            committed,
            root,
            nodes: Cell::new(0),
        })
    }

    /// The root file node list ([MS-ONESTORE] 2.1.14).
    pub(crate) fn root_list(&self) -> Read<Vec<Node<'a>>> {
        let root = self.root.ok_or_else(|| Damage::new("the file has no root list"))?;
        self.list(root)
    }

    /// Reads a file node list from its first fragment.
    pub(crate) fn list(&self, first: Chunk) -> Read<Vec<Node<'a>>> {
        let mut nodes = Vec::new();
        let mut seen = HashSet::new();
        let mut list_id = None;
        let mut next = Some(first);
        while let Some(chunk) = next.take() {
            if chunk.is_empty() {
                break;
            }
            if !seen.insert(chunk.stp) || seen.len() > limits::FRAGMENTS {
                return Err(Damage::new("a list of records loops back on itself"));
            }
            let fragment = chunk.slice(self.data)?;
            if fragment.len() < 36 {
                return Err(Damage::new("a list fragment is too short"));
            }
            let mut header = Reader::new(fragment);
            if header.u64()? != LIST_MAGIC {
                return Err(Damage::new("a list fragment has the wrong signature"));
            }
            let id = header.u32()?;
            if *list_id.get_or_insert(id) != id {
                return Err(Damage::new("a list continues with a fragment of another list"));
            }
            let limit = self.committed.get(&id).map(|n| *n as usize);
            let body_end = fragment.len() - 20;
            let full = self.read_nodes(&fragment[16..body_end], limit, &mut nodes)?;
            if full {
                break;
            }
            let mut tail = Reader::new(&fragment[body_end..]);
            next = chunk64x32(&mut tail)?;
            if tail.u64()? != LIST_FOOTER {
                return Err(Damage::new("a list fragment has the wrong footer"));
            }
        }
        Ok(nodes)
    }

    /// Reads the nodes of one fragment. Returns whether the list has all of its committed nodes.
    fn read_nodes(&self, body: &'a [u8], limit: Option<usize>, nodes: &mut Vec<Node<'a>>) -> Read<bool> {
        let mut pos = 0;
        while body.len() - pos >= 4 {
            if limit.is_some_and(|limit| nodes.len() >= limit) {
                return Ok(true);
            }
            let word = u32::from_le_bytes([body[pos], body[pos + 1], body[pos + 2], body[pos + 3]]);
            let id = (word & 0x3FF) as u16;
            let size = ((word >> 10) & 0x1FFF) as usize;
            if id == CHUNK_TERMINATOR {
                return Ok(false);
            }
            // Padding: a zero word, or a size that cannot hold its own header, ends the fragment.
            if size < 4 || pos + size > body.len() {
                return Ok(false);
            }
            let used = self.nodes.get() + 1;
            if used > limits::NODES {
                return Err(Damage::new("the file holds more records than OpenNote reads"));
            }
            self.nodes.set(used);
            nodes.push(Node {
                id,
                stp_format: ((word >> 23) & 3) as u8,
                cb_format: ((word >> 25) & 3) as u8,
                fnd: &body[pos + 4..pos + size],
            });
            pos += size;
        }
        Ok(limit.is_some_and(|limit| nodes.len() >= limit))
    }
}

/// Reads the transaction log ([MS-ONESTORE] 2.3.3): the committed node count of each list after the last
/// committed transaction.
fn read_log(data: &[u8], first: Chunk, transactions: u32) -> Read<HashMap<u32, u32>> {
    let mut committed = HashMap::new();
    let mut pending = Vec::new();
    let mut done = 0u32;
    let mut seen = HashSet::new();
    let mut next = Some(first);
    while let Some(chunk) = next.take() {
        if done >= transactions || chunk.cb < 12 || !seen.insert(chunk.stp) || seen.len() > limits::FRAGMENTS {
            break;
        }
        let fragment = chunk.slice(data)?;
        let (entries, tail) = fragment.split_at(fragment.len() - 12);
        for entry in entries.as_chunks::<8>().0 {
            let src = u32::from_le_bytes([entry[0], entry[1], entry[2], entry[3]]);
            let count = u32::from_le_bytes([entry[4], entry[5], entry[6], entry[7]]);
            if src == SENTINEL {
                committed.extend(pending.drain(..));
                done += 1;
                if done >= transactions {
                    return Ok(committed);
                }
            } else {
                pending.push((src, count));
            }
        }
        next = chunk64x32(&mut Reader::new(tail))?;
    }
    Ok(committed)
}
