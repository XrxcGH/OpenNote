//! Page history (spec 13): writing, listing, opening, and thinning saved versions. Owned by WP4.

use crate::error::CoreError;
use crate::format::ReadPage;
use crate::id::RevisionId;
use crate::limits::Limits;
use crate::model::{Page, VersionReason, VersionsFile};
use crate::store::PageFiles;
use crate::time::Timestamp;

/// How long versions are kept (spec 13.3).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Retention {
    /// 30 days.
    Days30,
    /// 1 year, the default.
    Year1,
    /// Forever.
    Forever,
}

/// What thinning did.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ThinReport {
    /// Versions kept.
    pub kept: u32,
    /// Versions dropped.
    pub dropped: Vec<RevisionId>,
}

/// Saves `page_bytes`, the exact bytes of `page.json` at this revision, as a version.
pub fn write_version(
    _files: &PageFiles<'_>,
    _page_bytes: &[u8],
    _page: &Page,
    _reason: VersionReason,
    _name: Option<String>,
) -> Result<(), CoreError> {
    unimplemented!("WP4: write_version")
}

/// Reads `versions.json`, rebuilding it from the snapshots if it is missing or damaged.
pub fn list_versions(_files: &PageFiles<'_>, _limits: &Limits) -> Result<VersionsFile, CoreError> {
    unimplemented!("WP4: list_versions")
}

/// Reads one version, upgrading it in memory if it is older.
pub fn open_version(_files: &PageFiles<'_>, _rev: RevisionId, _limits: &Limits) -> Result<ReadPage, CoreError> {
    unimplemented!("WP4: open_version")
}

/// Thins the versions of a page (spec 13.3). `utc_offset_minutes` places day boundaries in local time.
pub fn thin(
    _files: &PageFiles<'_>,
    _now: Timestamp,
    _utc_offset_minutes: i32,
    _keep: Retention,
    _protected: &[RevisionId],
) -> Result<ThinReport, CoreError> {
    unimplemented!("WP4: thin")
}
