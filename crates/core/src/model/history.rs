//! Page history (spec 13): `.history/versions.json` and its entries.

use serde::Serialize;

use super::{named_enum, DeviceRef, FormatInfo, JsonMap, Named};
use crate::id::{AssetId, PageId, RevisionId, SegmentId};
use crate::time::Timestamp;

named_enum! {
    /// Why a save was kept as a version (spec 13.2).
    VersionReason {
        /// The first save of a session over a revision from elsewhere.
        BeforeEdit = "beforeEdit",
        /// The page was closed or left after edits.
        Closed = "closed",
        /// Every 10 minutes while editing continues.
        Interval = "interval",
        /// The app exited with edits.
        Exit = "exit",
        /// The person saved a version.
        Named = "named",
        /// Before an older version was restored.
        BeforeRestore = "beforeRestore",
        /// Before the first save in a newer format version.
        BeforeUpgrade = "beforeUpgrade",
        /// Before a change that removes many blocks or strokes.
        BeforeLargeDelete = "beforeLargeDelete",
        /// Before damaged ink was repaired.
        BeforeRepair = "beforeRepair",
        /// The version not kept when a conflict was resolved.
        Conflict = "conflict",
        /// After crash recovery replayed a journal.
        Recovered = "recovered",
    }
}

/// The content of `.history/versions.json`.
#[derive(Clone, Debug, PartialEq)]
pub struct VersionsFile {
    /// The page's ID.
    pub page: PageId,
    /// The versions, oldest first.
    pub versions: Vec<VersionEntry>,
    /// Unknown keys.
    pub extra: JsonMap,
    /// What the reader found. Never written.
    pub format: FormatInfo,
}

/// One saved version (spec 13.1).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VersionEntry {
    /// The revision, which names the snapshot file.
    pub revision: RevisionId,
    /// When that revision was saved.
    pub saved_at: Timestamp,
    /// Why it was kept. Unknown after a rebuild of the list.
    pub reason: Named<VersionReason>,
    /// A name the person gave it.
    pub name: Option<String>,
    /// The person asked to keep it forever.
    pub keep: bool,
    /// The device that saved it.
    pub device: DeviceRef,
    /// The snapshot file's size.
    pub bytes: u64,
    /// The segments the version refers to.
    pub segments: Vec<SegmentId>,
    /// The assets the version refers to.
    pub assets: Vec<AssetId>,
    /// Unknown keys.
    #[serde(skip)]
    pub extra: JsonMap,
}
