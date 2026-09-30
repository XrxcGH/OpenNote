//! The byte formats of the note format specification, as pure functions over bytes.
//!
//! Nothing here touches the file system. Readers never panic on bad input: the lints below forbid the usual
//! ways to panic, because the release build aborts on a panic.

#![deny(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]

pub mod gzip;
pub mod header;
pub mod history_json;
pub mod json;
pub mod markdown;
pub mod migrate;
pub mod names;
pub mod page_json;
pub mod points;
pub mod readable;
pub mod segment;
pub mod trash_json;
pub mod tree_json;

use crate::error::FormatError;
use crate::id::{PageId, RevisionId, SegmentId, StrokeId};
use crate::limits::Limits;
use crate::model::{
    InkRecord, NotebookFile, NotebookTree, Page, SectionFile, SegmentRef, TrashItemFile, VersionsFile, Warning,
};
use crate::seams::{Codec, LinkResolver};
use crate::time::Timestamp;

/// The `kind` of each JSON file (spec 4, 5, 12, and 13).
pub mod kinds {
    /// `notebook.json`.
    pub const NOTEBOOK: &str = "opennote.notebook";
    /// `section.json`.
    pub const SECTION: &str = "opennote.section";
    /// `page.json`.
    pub const PAGE: &str = "opennote.page";
    /// A Trash item's `item.json`.
    pub const TRASH_ITEM: &str = "opennote.trash-item";
    /// `.history/versions.json`.
    pub const HISTORY: &str = "opennote.history";
}

/// A page as read, with the problems the reader worked around.
#[derive(Clone, Debug, PartialEq)]
pub struct ReadPage {
    /// The page. Its ink holds the segment list only, until the segments are read.
    pub page: Page,
    /// Problems the reader worked around.
    pub warnings: Vec<Warning>,
}

/// The header fields of an ink segment that a writer chooses (spec 9.1).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SegmentHeader {
    /// The segment's ID, which names its file.
    pub id: SegmentId,
    /// The page it belongs to.
    pub page: PageId,
    /// When it was written.
    pub created: Timestamp,
}

/// A decoded ink segment, with any damage it had (spec 9.6).
#[derive(Clone, Debug, PartialEq)]
pub struct DecodedSegment {
    /// The header.
    pub header: SegmentHeader,
    /// The records that decoded, in order.
    pub records: Vec<InkRecord>,
    /// Records that failed their checks.
    pub damaged: Vec<DamagedRecord>,
    /// Records of kinds, flags, or mask bits this version doesn't know. The page opens read-only.
    pub unknown_records: u32,
    /// Whether the footer was present and matched.
    pub footer_ok: bool,
}

/// A record of a segment that failed its checks.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DamagedRecord {
    /// The record's index in the segment, as far as the walk could tell.
    pub index: u32,
    /// The record's byte offset in the file.
    pub offset: u64,
    /// The stroke, when its ID could be read.
    pub stroke: Option<StrokeId>,
    /// What was wrong.
    pub reason: String,
}

/// What a readable copy on disk is (spec 11.2).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReadableState {
    /// No file.
    Missing,
    /// Empty, holding a zero byte, or not UTF-8: left by a power cut.
    Damaged,
    /// Written by OpenNote, at this revision.
    Ours {
        /// The revision in its front matter or comment.
        revision: RevisionId,
    },
    /// Edited by a person or another tool.
    Edited,
}

/// The production [`Codec`]: every format of the spec, through the functions of this module's submodules.
#[derive(Clone, Copy, Debug, Default)]
pub struct CanonicalCodec;

impl Codec for CanonicalCodec {
    fn read_page(&self, bytes: &[u8], limits: &Limits) -> Result<ReadPage, FormatError> {
        page_json::read_page(bytes, limits)
    }

    fn write_page(&self, page: &Page) -> Vec<u8> {
        page_json::write_page(page)
    }

    fn read_section(&self, bytes: &[u8], limits: &Limits) -> Result<SectionFile, FormatError> {
        tree_json::read_section(bytes, limits)
    }

    fn write_section(&self, file: &SectionFile) -> Vec<u8> {
        tree_json::write_section(file)
    }

    fn read_notebook(&self, bytes: &[u8], limits: &Limits) -> Result<NotebookFile, FormatError> {
        tree_json::read_notebook(bytes, limits)
    }

    fn write_notebook(&self, file: &NotebookFile) -> Vec<u8> {
        tree_json::write_notebook(file)
    }

    fn read_trash_item(&self, bytes: &[u8], limits: &Limits) -> Result<TrashItemFile, FormatError> {
        trash_json::read_trash_item(bytes, limits)
    }

    fn write_trash_item(&self, file: &TrashItemFile) -> Vec<u8> {
        trash_json::write_trash_item(file)
    }

    fn read_versions(&self, bytes: &[u8], limits: &Limits) -> Result<VersionsFile, FormatError> {
        history_json::read_versions(bytes, limits)
    }

    fn write_versions(&self, file: &VersionsFile) -> Vec<u8> {
        history_json::write_versions(file)
    }

    fn encode_segment(&self, header: &SegmentHeader, records: &[InkRecord]) -> Vec<u8> {
        segment::encode_segment(header, records)
    }

    fn decode_segment(
        &self,
        bytes: &[u8],
        expect: &SegmentRef,
        page: PageId,
        limits: &Limits,
    ) -> Result<DecodedSegment, FormatError> {
        segment::decode_segment(bytes, expect, page, limits)
    }

    fn encode_records(&self, records: &[InkRecord]) -> Vec<u8> {
        segment::encode_records(records)
    }

    fn decode_records(&self, bytes: &[u8], limits: &Limits) -> Result<Vec<InkRecord>, FormatError> {
        segment::decode_records(bytes, limits)
    }

    fn render_page_md(&self, page: &Page, links: &dyn LinkResolver) -> Vec<u8> {
        readable::render_page_md(page, links)
    }

    fn render_ink_svg(&self, page: &Page) -> Vec<u8> {
        readable::render_ink_svg(page)
    }

    fn render_index_md(&self, tree: &NotebookTree) -> Vec<u8> {
        readable::render_index_md(tree)
    }

    fn classify_readable(&self, bytes: &[u8]) -> ReadableState {
        readable::classify_readable(bytes)
    }
}

/// The CRC-32 stored in a segment's footer (spec 9.1), which `page.json` lists for the segment.
///
/// Returns `None` when the file is too short or has no footer magic. This reads the stored value only. The
/// segment decoder checks it against the bytes.
pub fn segment_footer_crc(bytes: &[u8]) -> Option<u32> {
    let start = bytes.len().checked_sub(8)?;
    let footer = bytes.get(start..)?;
    let (crc, magic) = footer.split_at_checked(4)?;
    if magic != b"ONKE" {
        return None;
    }
    Some(u32::from_le_bytes(crc.try_into().ok()?))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn reads_the_footer_crc_of_the_spec_vector() {
        let mut file = vec![0u8; 168];
        file.extend_from_slice(&[0xa0, 0xa2, 0x45, 0xc4]);
        file.extend_from_slice(b"ONKE");
        assert_eq!(segment_footer_crc(&file), Some(0xc445_a2a0));
        assert_eq!(segment_footer_crc(b"short"), None);
        assert_eq!(segment_footer_crc(b"12345678"), None);
    }
}
