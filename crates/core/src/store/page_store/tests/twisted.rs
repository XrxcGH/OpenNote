//! The registry codec, with switches that damage segments or change pages as they are read.

use std::sync::{Arc, Mutex};

use crate::error::FormatError;
use crate::format::{DamagedRecord, DecodedSegment, ReadPage, ReadableState, SegmentHeader};
use crate::id::{PageId, SegmentId, StrokeId};
use crate::limits::Limits;
use crate::model::{InkRecord, NotebookFile, NotebookTree, Page, SectionFile, SegmentRef, TrashItemFile, VersionsFile};
use crate::seams::{Codec, LinkResolver};
use crate::testing::RegistryCodec;

/// Damage in one segment, or in any segment with `None`.
pub(crate) type Damage = (Option<SegmentId>, StrokeId);

/// The registry codec, with switches that damage decoded segments or change pages as they are read.
#[derive(Clone, Default)]
pub(crate) struct Twisted {
    pub inner: RegistryCodec,
    /// Strokes whose records decoded segments report as damaged: in one segment, or in any with `None`.
    pub damage: Arc<Mutex<Vec<Damage>>>,
    /// A title that every read page gets, as a serializer bug would do.
    pub retitle: Arc<Mutex<Option<String>>>,
}

impl Codec for Twisted {
    fn read_page(&self, bytes: &[u8], limits: &Limits) -> Result<ReadPage, FormatError> {
        let mut read = self.inner.read_page(bytes, limits)?;
        if let Some(title) = self.retitle.lock().unwrap().clone() {
            read.page.title = title;
        }
        Ok(read)
    }
    fn write_page(&self, page: &Page) -> Vec<u8> {
        self.inner.write_page(page)
    }
    fn read_section(&self, bytes: &[u8], limits: &Limits) -> Result<SectionFile, FormatError> {
        self.inner.read_section(bytes, limits)
    }
    fn write_section(&self, file: &SectionFile) -> Vec<u8> {
        self.inner.write_section(file)
    }
    fn read_notebook(&self, bytes: &[u8], limits: &Limits) -> Result<NotebookFile, FormatError> {
        self.inner.read_notebook(bytes, limits)
    }
    fn write_notebook(&self, file: &NotebookFile) -> Vec<u8> {
        self.inner.write_notebook(file)
    }
    fn read_trash_item(&self, bytes: &[u8], limits: &Limits) -> Result<TrashItemFile, FormatError> {
        self.inner.read_trash_item(bytes, limits)
    }
    fn write_trash_item(&self, file: &TrashItemFile) -> Vec<u8> {
        self.inner.write_trash_item(file)
    }
    fn read_versions(&self, bytes: &[u8], limits: &Limits) -> Result<VersionsFile, FormatError> {
        self.inner.read_versions(bytes, limits)
    }
    fn write_versions(&self, file: &VersionsFile) -> Vec<u8> {
        self.inner.write_versions(file)
    }
    fn encode_segment(&self, header: &SegmentHeader, records: &[InkRecord]) -> Vec<u8> {
        self.inner.encode_segment(header, records)
    }
    fn decode_segment(
        &self,
        bytes: &[u8],
        expect: &SegmentRef,
        page: PageId,
        limits: &Limits,
    ) -> Result<DecodedSegment, FormatError> {
        let mut decoded = self.inner.decode_segment(bytes, expect, page, limits)?;
        let damage = self.damage.lock().unwrap().clone();
        let mut kept = Vec::new();
        for (index, record) in decoded.records.drain(..).enumerate() {
            let hit = damage
                .iter()
                .any(|(segment, id)| *id == record.stroke_id() && segment.is_none_or(|s| s == expect.id));
            if hit {
                decoded.damaged.push(DamagedRecord {
                    index: index as u32,
                    offset: 0,
                    stroke: Some(record.stroke_id()),
                    reason: "test damage".into(),
                });
            } else {
                kept.push(record);
            }
        }
        decoded.records = kept;
        Ok(decoded)
    }
    fn encode_records(&self, records: &[InkRecord]) -> Vec<u8> {
        self.inner.encode_records(records)
    }
    fn decode_records(&self, bytes: &[u8], limits: &Limits) -> Result<Vec<InkRecord>, FormatError> {
        self.inner.decode_records(bytes, limits)
    }
    fn render_page_md(&self, page: &Page, links: &dyn LinkResolver) -> Vec<u8> {
        self.inner.render_page_md(page, links)
    }
    fn render_ink_svg(&self, page: &Page) -> Vec<u8> {
        self.inner.render_ink_svg(page)
    }
    fn render_index_md(&self, tree: &NotebookTree) -> Vec<u8> {
        self.inner.render_index_md(tree)
    }
    fn classify_readable(&self, bytes: &[u8]) -> ReadableState {
        self.inner.classify_readable(bytes)
    }
}
