//! The bytes of a revision store file ([MS-ONESTORE] 2.3, 2.4, 2.6), for test files.

use std::collections::HashMap;

use crate::onenote::bytes::{ExGuid, Guid};
use crate::onenote::store::{LIST_FOOTER, LIST_MAGIC, ONE_FILE, REVISION_STORE};

/// A file chunk reference: where something was written.
#[derive(Clone, Copy, Debug)]
pub(super) struct At {
    pub stp: u64,
    pub cb: u32,
}

/// One file node: its ID, whether it starts with a reference, and its data after the reference.
pub(super) struct FileNode {
    pub id: u16,
    pub reference: Option<At>,
    pub data: Vec<u8>,
}

impl FileNode {
    pub(super) fn plain(id: u16, data: Vec<u8>) -> FileNode {
        FileNode {
            id,
            reference: None,
            data,
        }
    }

    pub(super) fn pointing(id: u16, at: At, data: Vec<u8>) -> FileNode {
        FileNode {
            id,
            reference: Some(at),
            data,
        }
    }

    fn bytes(&self) -> Vec<u8> {
        let mut fnd = Vec::new();
        if let Some(at) = self.reference {
            fnd.extend_from_slice(&at.stp.to_le_bytes());
            fnd.extend_from_slice(&at.cb.to_le_bytes());
        }
        fnd.extend_from_slice(&self.data);
        let size = (fnd.len() + 4) as u32;
        // StpFormat 0 (8 bytes) and CbFormat 0 (4 bytes); BaseType 1 when there is a reference; Reserved 1.
        let base = u32::from(self.reference.is_some());
        let header = u32::from(self.id) | (size << 10) | (base << 27) | (1 << 31);
        let mut out = header.to_le_bytes().to_vec();
        out.extend(fnd);
        out
    }
}

/// A file being written: a 1024-byte header, then lists and data in any order.
pub(super) struct Layout {
    buf: Vec<u8>,
    next_list: u32,
    /// The committed node count of each list, for the transaction log.
    counts: Vec<(u32, u32)>,
}

impl Layout {
    pub(super) fn new() -> Layout {
        Layout {
            buf: vec![0; 1024],
            next_list: 0x10,
            counts: Vec::new(),
        }
    }

    /// Writes bytes, padded to 8, and says where.
    pub(super) fn blob(&mut self, bytes: &[u8]) -> At {
        let stp = self.buf.len() as u64;
        self.buf.extend_from_slice(bytes);
        while !self.buf.len().is_multiple_of(8) {
            self.buf.push(0);
        }
        At {
            stp,
            cb: bytes.len() as u32,
        }
    }

    /// Writes a file node list as one fragment. `uncommitted` nodes follow, past the count in the log.
    pub(super) fn list(&mut self, nodes: &[FileNode], uncommitted: &[FileNode]) -> At {
        let id = self.next_list;
        self.next_list += 1;
        self.counts.push((id, nodes.len() as u32));
        let mut fragment = LIST_MAGIC.to_le_bytes().to_vec();
        fragment.extend_from_slice(&id.to_le_bytes());
        fragment.extend_from_slice(&0u32.to_le_bytes());
        for node in nodes.iter().chain(uncommitted) {
            fragment.extend(node.bytes());
        }
        fragment.extend_from_slice(&u64::MAX.to_le_bytes());
        fragment.extend_from_slice(&0u32.to_le_bytes());
        fragment.extend_from_slice(&LIST_FOOTER.to_le_bytes());
        self.blob(&fragment)
    }

    /// Writes the transaction log and the header, and returns the file.
    pub(super) fn finish(mut self, root: At) -> Vec<u8> {
        let mut log = Vec::new();
        for (id, count) in &self.counts {
            log.extend_from_slice(&id.to_le_bytes());
            log.extend_from_slice(&count.to_le_bytes());
        }
        log.extend_from_slice(&1u32.to_le_bytes());
        log.extend_from_slice(&0u32.to_le_bytes());
        log.extend_from_slice(&u64::MAX.to_le_bytes());
        log.extend_from_slice(&0u32.to_le_bytes());
        let log = self.blob(&log);
        let len = self.buf.len() as u64;
        let h = &mut self.buf;
        h[0..16].copy_from_slice(&ONE_FILE.0);
        h[16..32].copy_from_slice(&Guid::new(0x1234_5678, 1, 2, [3; 8]).0);
        h[48..64].copy_from_slice(&REVISION_STORE.0);
        for at in [64, 68, 72, 76] {
            h[at..at + 4].copy_from_slice(&0x2Au32.to_le_bytes());
        }
        h[88..92].copy_from_slice(&u32::MAX.to_le_bytes());
        h[96..100].copy_from_slice(&1u32.to_le_bytes());
        h[112..116].copy_from_slice(&u32::MAX.to_le_bytes());
        put_chunk(h, 148, None);
        put_chunk(h, 160, Some(log));
        put_chunk(h, 172, Some(root));
        put_chunk(h, 184, None);
        h[196..204].copy_from_slice(&len.to_le_bytes());
        self.buf
    }
}

/// A FileChunkReference64x32 at `at`; `None` writes `fcrNil`.
fn put_chunk(header: &mut [u8], at: usize, chunk: Option<At>) {
    let (stp, cb) = chunk.map_or((u64::MAX, 0), |c| (c.stp, c.cb));
    header[at..at + 8].copy_from_slice(&stp.to_le_bytes());
    header[at + 8..at + 12].copy_from_slice(&cb.to_le_bytes());
}

/// The bytes of an ExtendedGUID.
pub(super) fn exguid(id: ExGuid) -> Vec<u8> {
    let mut out = id.guid.0.to_vec();
    out.extend_from_slice(&id.n.to_le_bytes());
    out
}

/// A property set being written ([MS-ONESTORE] 2.6.7), with the IDs it points to.
#[derive(Default)]
pub(crate) struct Props {
    prids: Vec<u32>,
    data: Vec<u8>,
    objects: Vec<ExGuid>,
    spaces: Vec<ExGuid>,
}

impl Props {
    fn prid(id: u32, kind: u32) -> u32 {
        (id & 0x03FF_FFFF) | (kind << 26)
    }

    pub(crate) fn flag(mut self, id: u32, value: bool) -> Props {
        self.prids.push(Props::prid(id, 2) | (u32::from(value) << 31));
        self
    }

    pub(crate) fn u16(mut self, id: u32, value: u16) -> Props {
        self.prids.push(Props::prid(id, 4));
        self.data.extend_from_slice(&value.to_le_bytes());
        self
    }

    pub(crate) fn u32(mut self, id: u32, value: u32) -> Props {
        self.prids.push(Props::prid(id, 5));
        self.data.extend_from_slice(&value.to_le_bytes());
        self
    }

    pub(crate) fn u64(mut self, id: u32, value: u64) -> Props {
        self.prids.push(Props::prid(id, 6));
        self.data.extend_from_slice(&value.to_le_bytes());
        self
    }

    pub(crate) fn bytes(mut self, id: u32, value: &[u8]) -> Props {
        self.prids.push(Props::prid(id, 7));
        self.data.extend_from_slice(&(value.len() as u32).to_le_bytes());
        self.data.extend_from_slice(value);
        self
    }

    /// A WzInAtom: UTF-16, then a zero unit.
    pub(crate) fn text(self, id: u32, value: &str) -> Props {
        let bytes: Vec<u8> = value.encode_utf16().chain([0]).flat_map(u16::to_le_bytes).collect();
        self.bytes(id, &bytes)
    }

    pub(crate) fn objects(mut self, id: u32, ids: &[ExGuid]) -> Props {
        self.prids.push(Props::prid(id, 9));
        self.data.extend_from_slice(&(ids.len() as u32).to_le_bytes());
        self.objects.extend_from_slice(ids);
        self
    }

    pub(crate) fn object(mut self, id: u32, target: ExGuid) -> Props {
        self.prids.push(Props::prid(id, 8));
        self.objects.push(target);
        self
    }

    pub(crate) fn spaces(mut self, id: u32, ids: &[ExGuid]) -> Props {
        self.prids.push(Props::prid(id, 0xB));
        self.data.extend_from_slice(&(ids.len() as u32).to_le_bytes());
        self.spaces.extend_from_slice(ids);
        self
    }

    /// An ArrayOfPropertyValues of property sets.
    pub(crate) fn sets(mut self, id: u32, sets: Vec<Props>) -> Props {
        self.prids.push(Props::prid(id, 0x10));
        self.data.extend_from_slice(&(sets.len() as u32).to_le_bytes());
        if !sets.is_empty() {
            self.data.extend_from_slice(&Props::prid(0, 0x11).to_le_bytes());
        }
        for set in sets {
            self.data.extend(set.body());
            self.objects.extend(set.objects);
            self.spaces.extend(set.spaces);
        }
        self
    }

    fn body(&self) -> Vec<u8> {
        let mut out = (self.prids.len() as u16).to_le_bytes().to_vec();
        for prid in &self.prids {
            out.extend_from_slice(&prid.to_le_bytes());
        }
        out.extend_from_slice(&self.data);
        out
    }

    /// Every GUID the set points to, for the global identification table.
    pub(super) fn guids(&self) -> impl Iterator<Item = Guid> + '_ {
        self.objects.iter().chain(&self.spaces).map(|id| id.guid)
    }

    /// The ObjectSpaceObjectPropSet ([MS-ONESTORE] 2.6.1), with CompactIDs from `table`.
    pub(super) fn encode(&self, table: &HashMap<Guid, u32>) -> Vec<u8> {
        let compact = |id: &ExGuid| (table[&id.guid] << 8) | (id.n & 0xFF);
        let no_spaces = self.spaces.is_empty();
        let mut out = ((self.objects.len() as u32) | (u32::from(no_spaces) << 31))
            .to_le_bytes()
            .to_vec();
        out.extend(self.objects.iter().flat_map(|id| compact(id).to_le_bytes()));
        if !no_spaces {
            out.extend_from_slice(&(self.spaces.len() as u32).to_le_bytes());
            out.extend(self.spaces.iter().flat_map(|id| compact(id).to_le_bytes()));
        }
        out.extend(self.body());
        out
    }
}
