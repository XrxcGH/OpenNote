//! Ink segment files and the segment record format (spec 9.1, 9.2, 9.3, 9.5, and 9.6). Owned by WP1.

use crate::error::FormatError;
use crate::format::{DecodedSegment, SegmentHeader};
use crate::id::PageId;
use crate::limits::Limits;
use crate::model::{InkRecord, SegmentRef};

/// Encodes a segment file: header, records, and footer.
pub fn encode_segment(_header: &SegmentHeader, _records: &[InkRecord]) -> Vec<u8> {
    unimplemented!("WP1: encode_segment")
}

/// Decodes a segment file, checking it against its `page.json` entry. Reports damaged records instead of
/// failing where it can (spec 9.6), and never panics.
pub fn decode_segment(
    _bytes: &[u8],
    _expect: &SegmentRef,
    _page: PageId,
    _limits: &Limits,
) -> Result<DecodedSegment, FormatError> {
    unimplemented!("WP1: decode_segment")
}

/// Encodes records without a segment header or footer, for journal blobs and the page envelope.
pub fn encode_records(_records: &[InkRecord]) -> Vec<u8> {
    unimplemented!("WP1: encode_records")
}

/// Decodes records without a segment header or footer.
pub fn decode_records(_bytes: &[u8], _limits: &Limits) -> Result<Vec<InkRecord>, FormatError> {
    unimplemented!("WP1: decode_records")
}
