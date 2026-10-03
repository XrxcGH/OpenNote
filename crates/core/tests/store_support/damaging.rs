//! [`DamagingCodec`]: the registry codec, reporting one stroke's records as damaged when it decodes segments.

use opennote_core::error::FormatError;
use opennote_core::format::{DamagedRecord, DecodedSegment, ReadPage, ReadableState, SegmentHeader};
use opennote_core::limits::Limits;
use opennote_core::model::{InkRecord, NotebookFile, NotebookTree, Page, SectionFile, SegmentRef};
use opennote_core::model::{TrashItemFile, VersionsFile};
use opennote_core::seams::{Codec, LinkResolver};
use opennote_core::testing::RegistryCodec;
use opennote_core::{PageId, StrokeId};

/// The registry codec, with every record of one stroke reported as damaged in every segment. A bad sector, or
/// a sync tool that cut a file short, leaves segments like that.
pub struct DamagingCodec {
    pub inner: RegistryCodec,
    pub stroke: StrokeId,
}

impl Codec for DamagingCodec {
    fn read_page(&self, bytes: &[u8], limits: &Limits) -> Result<ReadPage, FormatError> {
        self.inner.read_page(bytes, limits)
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
        let records = std::mem::take(&mut decoded.records);
        for (index, record) in records.into_iter().enumerate() {
            if record.stroke_id() == self.stroke {
                decoded.damaged.push(DamagedRecord {
                    index: u32::try_from(index).unwrap(),
                    offset: 0,
                    stroke: Some(self.stroke),
                    reason: "test damage".into(),
                });
            } else {
                decoded.records.push(record);
            }
        }
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
