//! Fakes for the seams (plan 4.5), so storage and session code can be tested before the real codec and
//! applier land.
//!
//! [`RegistryCodec`] keeps each value it writes in an in-memory registry and writes a short token with a
//! checksum instead of the real format. Reading the token returns the value, so storage logic round-trips
//! without WP1. Segment tokens end with a real footer (spec 9.1), so code that reads the footer's CRC-32 works
//! on them. [`ScriptApplier`] applies only `SetPage`, `AddStrokes`, and `RemoveStrokes`, which is enough for
//! journal tests before WP3 lands.

use std::sync::{Arc, Mutex, PoisonError};

use crate::error::{FormatError, FormatErrorKind};
use crate::format::{segment_footer_crc, DecodedSegment, ReadPage, ReadableState, SegmentHeader};
use crate::id::{AssetId, PageId, RevisionId};
use crate::limits::Limits;
use crate::model::{
    Ink, InkRecord, NotebookFile, NotebookTree, Page, SectionFile, SegmentRef, TrashItemFile, VersionsFile,
};
use crate::seams::{Codec, LinkResolver};
use crate::session::events::{CoreEvent, EventSink, IndexHint, IndexSink};

mod applier;

pub use applier::ScriptApplier;

/// One value the registry holds.
#[derive(Clone, Debug)]
enum Entry {
    Page(Box<Page>),
    Section(SectionFile),
    Notebook(NotebookFile),
    TrashItem(TrashItemFile),
    Versions(VersionsFile),
    Segment(SegmentHeader, Vec<InkRecord>),
    Records(Vec<InkRecord>),
}

impl Entry {
    fn kind(&self) -> &'static str {
        match self {
            Entry::Page(_) => "page",
            Entry::Section(_) => "section",
            Entry::Notebook(_) => "notebook",
            Entry::TrashItem(_) => "trash-item",
            Entry::Versions(_) => "versions",
            Entry::Segment(..) => "segment",
            Entry::Records(_) => "records",
        }
    }
}

/// A [`Codec`] that stores values in memory and writes tokens. Clones share the registry.
#[derive(Clone, Debug, Default)]
pub struct RegistryCodec {
    entries: Arc<Mutex<Vec<Entry>>>,
}

impl RegistryCodec {
    /// An empty registry.
    pub fn new() -> RegistryCodec {
        RegistryCodec::default()
    }

    /// How many values were written.
    pub fn len(&self) -> usize {
        self.entries.lock().unwrap_or_else(PoisonError::into_inner).len()
    }

    /// Whether nothing was written.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Stores a value and returns its token: `registry:<kind>:<index>:<crc32>` and a newline.
    fn store(&self, entry: Entry) -> Vec<u8> {
        let kind = entry.kind();
        let mut entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        entries.push(entry);
        let body = format!("registry:{kind}:{}", entries.len() - 1);
        format!("{body}:{:08x}\n", crc32fast::hash(body.as_bytes())).into_bytes()
    }

    /// Finds the value a token names. Checks the token's kind and checksum first.
    fn load(&self, bytes: &[u8], kind: &str) -> Result<Entry, FormatError> {
        let syntax = |detail: &str| FormatError::new(FormatErrorKind::Syntax, detail.to_owned());
        let text = std::str::from_utf8(bytes).map_err(|_| syntax("not a registry token"))?;
        let (body, crc) = text
            .trim_end_matches('\n')
            .rsplit_once(':')
            .ok_or_else(|| syntax("no checksum"))?;
        if format!("{:08x}", crc32fast::hash(body.as_bytes())) != crc {
            return Err(FormatError::new(FormatErrorKind::Checksum, "registry token checksum"));
        }
        let mut parts = body.split(':');
        let (Some("registry"), Some(found), Some(index)) = (parts.next(), parts.next(), parts.next()) else {
            return Err(syntax("not a registry token"));
        };
        if found != kind {
            return Err(FormatError::new(
                FormatErrorKind::WrongKind,
                format!("{found}, not {kind}"),
            ));
        }
        let index: usize = index.parse().map_err(|_| syntax("bad index"))?;
        let entries = self.entries.lock().unwrap_or_else(PoisonError::into_inner);
        entries.get(index).cloned().ok_or_else(|| syntax("unknown token"))
    }
}

/// Appends a segment footer: the CRC-32 of every byte before it, then `ONKE` (spec 9.1).
fn with_footer(mut bytes: Vec<u8>) -> Vec<u8> {
    let crc = crc32fast::hash(&bytes);
    bytes.extend_from_slice(&crc.to_le_bytes());
    bytes.extend_from_slice(b"ONKE");
    bytes
}

/// The text a readable copy holds, so `classify_readable` can tell it apart.
fn readable(file: &str, revision: RevisionId, title: &str) -> Vec<u8> {
    format!("registry {file}\nrevision: {revision}\ntitle: {title}\n").into_bytes()
}

impl Codec for RegistryCodec {
    fn read_page(&self, bytes: &[u8], _limits: &Limits) -> Result<ReadPage, FormatError> {
        let Entry::Page(page) = self.load(bytes, "page")? else {
            unreachable!("the kind was checked")
        };
        let mut page = *page;
        // Like the real reader, the page holds its segment list but no strokes until the segments are read.
        let segments = page.ink.segments().to_vec();
        let empty = vec![Vec::new(); segments.len()];
        page.ink = Ink::replay(segments, empty).0;
        Ok(ReadPage {
            page,
            warnings: Vec::new(),
        })
    }

    fn write_page(&self, page: &Page) -> Vec<u8> {
        self.store(Entry::Page(Box::new(page.clone())))
    }

    fn read_section(&self, bytes: &[u8], _limits: &Limits) -> Result<SectionFile, FormatError> {
        match self.load(bytes, "section")? {
            Entry::Section(file) => Ok(file),
            _ => unreachable!("the kind was checked"),
        }
    }

    fn write_section(&self, file: &SectionFile) -> Vec<u8> {
        self.store(Entry::Section(file.clone()))
    }

    fn read_notebook(&self, bytes: &[u8], _limits: &Limits) -> Result<NotebookFile, FormatError> {
        match self.load(bytes, "notebook")? {
            Entry::Notebook(file) => Ok(file),
            _ => unreachable!("the kind was checked"),
        }
    }

    fn write_notebook(&self, file: &NotebookFile) -> Vec<u8> {
        self.store(Entry::Notebook(file.clone()))
    }

    fn read_trash_item(&self, bytes: &[u8], _limits: &Limits) -> Result<TrashItemFile, FormatError> {
        match self.load(bytes, "trash-item")? {
            Entry::TrashItem(file) => Ok(file),
            _ => unreachable!("the kind was checked"),
        }
    }

    fn write_trash_item(&self, file: &TrashItemFile) -> Vec<u8> {
        self.store(Entry::TrashItem(file.clone()))
    }

    fn read_versions(&self, bytes: &[u8], _limits: &Limits) -> Result<VersionsFile, FormatError> {
        match self.load(bytes, "versions")? {
            Entry::Versions(file) => Ok(file),
            _ => unreachable!("the kind was checked"),
        }
    }

    fn write_versions(&self, file: &VersionsFile) -> Vec<u8> {
        self.store(Entry::Versions(file.clone()))
    }

    fn encode_segment(&self, header: &SegmentHeader, records: &[InkRecord]) -> Vec<u8> {
        with_footer(self.store(Entry::Segment(*header, records.to_vec())))
    }

    fn decode_segment(
        &self,
        bytes: &[u8],
        expect: &SegmentRef,
        page: PageId,
        _limits: &Limits,
    ) -> Result<DecodedSegment, FormatError> {
        let checksum = |detail: &str| FormatError::new(FormatErrorKind::Checksum, detail.to_owned());
        let body = bytes.get(..bytes.len().saturating_sub(8)).unwrap_or_default();
        let footer = segment_footer_crc(bytes).ok_or_else(|| checksum("no footer"))?;
        if footer != crc32fast::hash(body) || footer != expect.crc32 || bytes.len() as u64 != expect.bytes {
            return Err(checksum("the segment doesn't match its entry"));
        }
        let Entry::Segment(header, records) = self.load(body, "segment")? else {
            unreachable!("the kind was checked")
        };
        if header.id != expect.id || header.page != page {
            return Err(FormatError::new(
                FormatErrorKind::Validation,
                "the segment belongs elsewhere",
            ));
        }
        Ok(DecodedSegment {
            header,
            records,
            damaged: Vec::new(),
            unknown_records: 0,
            footer_ok: true,
        })
    }

    fn encode_records(&self, records: &[InkRecord]) -> Vec<u8> {
        self.store(Entry::Records(records.to_vec()))
    }

    fn decode_records(&self, bytes: &[u8], _limits: &Limits) -> Result<Vec<InkRecord>, FormatError> {
        match self.load(bytes, "records")? {
            Entry::Records(records) => Ok(records),
            _ => unreachable!("the kind was checked"),
        }
    }

    fn render_page_md(&self, page: &Page, _links: &dyn LinkResolver) -> Vec<u8> {
        readable("page.md", page.revision.id, &page.title)
    }

    fn render_ink_svg(&self, page: &Page) -> Vec<u8> {
        readable("ink.svg", page.revision.id, &page.title)
    }

    fn render_index_md(&self, tree: &NotebookTree) -> Vec<u8> {
        readable("index.md", RevisionId::ZERO, &tree.title)
    }

    fn classify_readable(&self, bytes: &[u8]) -> ReadableState {
        let Ok(text) = std::str::from_utf8(bytes) else {
            return ReadableState::Damaged;
        };
        if text.is_empty() || text.contains('\0') {
            return ReadableState::Damaged;
        }
        let revision = text.strip_prefix("registry ").and_then(|rest| rest.lines().nth(1));
        match revision
            .and_then(|line| line.strip_prefix("revision: "))
            .map(RevisionId::parse)
        {
            Some(Ok(revision)) => ReadableState::Ours { revision },
            _ => ReadableState::Edited,
        }
    }
}

/// An [`EventSink`] that keeps every event, for assertions.
#[derive(Clone, Debug, Default)]
pub struct CollectingSink {
    events: Arc<Mutex<Vec<CoreEvent>>>,
}

impl CollectingSink {
    /// Every event so far.
    pub fn events(&self) -> Vec<CoreEvent> {
        self.events.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }
}

impl EventSink for CollectingSink {
    fn emit(&self, event: CoreEvent) {
        self.events.lock().unwrap_or_else(PoisonError::into_inner).push(event);
    }
}

/// An [`EventSink`] that drops every event.
#[derive(Clone, Copy, Debug, Default)]
pub struct NullSink;

impl EventSink for NullSink {
    fn emit(&self, _event: CoreEvent) {}
}

/// An [`IndexSink`] that keeps every hint, for assertions.
#[derive(Clone, Debug, Default)]
pub struct CollectingIndex {
    hints: Arc<Mutex<Vec<IndexHint>>>,
}

impl CollectingIndex {
    /// Every hint so far.
    pub fn hints(&self) -> Vec<IndexHint> {
        self.hints.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }
}

impl IndexSink for CollectingIndex {
    fn page_saved(&self, hint: &IndexHint) {
        self.hints
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(hint.clone());
    }
}

/// A [`LinkResolver`] that resolves nothing, so every link stays as it is.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoLinks;

impl LinkResolver for NoLinks {
    fn page_md(&self, _from: PageId, _to: PageId) -> Option<String> {
        None
    }

    fn asset_file(&self, _asset: AssetId) -> Option<String> {
        None
    }
}

#[cfg(test)]
mod tests;
