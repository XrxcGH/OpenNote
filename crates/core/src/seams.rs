//! Seams that let work packages test without each other (plan 4.5).
//!
//! Production code uses [`crate::format::CanonicalCodec`] for [`Codec`] and `ops::apply::OpsApplier` for
//! [`Applier`]. Tests use `testing::fakes::RegistryCodec` and `testing::fakes::ScriptApplier` until those land.
//! The third seam, the file system, is [`crate::store::fs::Fs`].

use crate::error::{ApplyError, FormatError};
use crate::format::{DecodedSegment, ReadPage, ReadableState, SegmentHeader};
use crate::id::{AssetId, PageId, StrokeId};
use crate::limits::Limits;
use crate::model::{InkRecord, NotebookFile, NotebookTree, Page, SectionFile, SegmentRef, TrashItemFile, VersionsFile};
use crate::ops::{AppliedChanges, Txn};

/// Every byte format of the spec, as pure functions over bytes.
pub trait Codec: Send + Sync + 'static {
    /// Reads `page.json`, upgrading older versions in memory.
    fn read_page(&self, bytes: &[u8], limits: &Limits) -> Result<ReadPage, FormatError>;
    /// Writes `page.json` in canonical form (spec 2.2).
    fn write_page(&self, page: &Page) -> Vec<u8>;
    /// Reads `section.json`.
    fn read_section(&self, bytes: &[u8], limits: &Limits) -> Result<SectionFile, FormatError>;
    /// Writes `section.json`.
    fn write_section(&self, file: &SectionFile) -> Vec<u8>;
    /// Reads `notebook.json`.
    fn read_notebook(&self, bytes: &[u8], limits: &Limits) -> Result<NotebookFile, FormatError>;
    /// Writes `notebook.json`.
    fn write_notebook(&self, file: &NotebookFile) -> Vec<u8>;
    /// Reads a Trash item's `item.json`.
    fn read_trash_item(&self, bytes: &[u8], limits: &Limits) -> Result<TrashItemFile, FormatError>;
    /// Writes a Trash item's `item.json`.
    fn write_trash_item(&self, file: &TrashItemFile) -> Vec<u8>;
    /// Reads `.history/versions.json`.
    fn read_versions(&self, bytes: &[u8], limits: &Limits) -> Result<VersionsFile, FormatError>;
    /// Writes `.history/versions.json`.
    fn write_versions(&self, file: &VersionsFile) -> Vec<u8>;
    /// Encodes an ink segment file (spec 9.1).
    fn encode_segment(&self, header: &SegmentHeader, records: &[InkRecord]) -> Vec<u8>;
    /// Decodes an ink segment file, reporting damage instead of failing where it can (spec 9.6).
    fn decode_segment(
        &self,
        bytes: &[u8],
        expect: &SegmentRef,
        page: PageId,
        limits: &Limits,
    ) -> Result<DecodedSegment, FormatError>;
    /// Decodes an ink segment file like [`decode_segment`](Codec::decode_segment), but may skip the point checks
    /// (spec 9.4) of strokes that `check` turns down. Minor compaction reads the base segment this way: the page
    /// checked all of its strokes when it opened, and the merge needs only the few that later segments change.
    fn decode_segment_checking(
        &self,
        bytes: &[u8],
        expect: &SegmentRef,
        page: PageId,
        limits: &Limits,
        check: &dyn Fn(StrokeId) -> bool,
    ) -> Result<DecodedSegment, FormatError> {
        let _ = check;
        self.decode_segment(bytes, expect, page, limits)
    }
    /// Encodes records in the segment record format, for journal blobs and the page envelope.
    fn encode_records(&self, records: &[InkRecord]) -> Vec<u8>;
    /// Decodes records in the segment record format.
    fn decode_records(&self, bytes: &[u8], limits: &Limits) -> Result<Vec<InkRecord>, FormatError>;
    /// Renders `page.md` with its checksum (spec 11.1).
    fn render_page_md(&self, page: &Page, links: &dyn LinkResolver) -> Vec<u8>;
    /// Renders `ink.svg` (spec 11.3).
    fn render_ink_svg(&self, page: &Page) -> Vec<u8>;
    /// Renders `index.md` (spec 11.4).
    fn render_index_md(&self, tree: &NotebookTree) -> Vec<u8>;
    /// Tells a readable copy on disk apart: missing, damaged, ours, or edited (spec 11.2).
    fn classify_readable(&self, bytes: &[u8]) -> ReadableState;
}

/// Applies transactions to a page, all or nothing.
pub trait Applier: Send + Sync + 'static {
    /// Applies every operation, or none, and reports what changed.
    fn apply(&self, page: &mut Page, txn: &Txn) -> Result<AppliedChanges, ApplyError>;
}

/// Turns links between pages and assets into relative paths for `page.md` (spec 11.1).
pub trait LinkResolver {
    /// The relative path from one page's `page.md` to another's, if the target is in the same notebook.
    fn page_md(&self, from: PageId, to: PageId) -> Option<String>;
    /// The file name of an asset of the page being rendered.
    fn asset_file(&self, asset: AssetId) -> Option<String>;
}
