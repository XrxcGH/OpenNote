//! Deleting segments and assets that nothing refers to (spec 19). Owned by WP4.

use std::collections::HashSet;
use std::time::Duration;

use crate::error::CoreError;
use crate::id::{AssetId, SegmentId};
use crate::store::PageFiles;
use crate::time::Timestamp;

/// Segments and assets that something outside the page folder still needs, such as a journal base snapshot.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RefSet {
    /// Segments.
    pub segments: HashSet<SegmentId>,
    /// Assets.
    pub assets: HashSet<AssetId>,
}

/// What garbage collection did.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct GcReport {
    /// Segments deleted.
    pub segments: Vec<SegmentId>,
    /// Assets deleted.
    pub assets: Vec<AssetId>,
    /// Bytes freed.
    pub bytes: u64,
}

/// Deletes unreferenced segments and assets of a page that is not open, once they are older than `grace`.
pub fn collect_garbage(
    _files: &PageFiles<'_>,
    _extra: &RefSet,
    _now: Timestamp,
    _grace: Duration,
) -> Result<GcReport, CoreError> {
    unimplemented!("WP4: collect_garbage")
}
