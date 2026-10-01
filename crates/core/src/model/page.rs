//! A page (spec 5): its fields, its revision, and what the reader found in the file.

use std::collections::BTreeMap;

use serde::Serialize;

use super::{Asset, Blocks, Ink, JsonMap, PageView};
use crate::id::{AssetId, BlockId, DeviceId, PageId, RevisionId};
use crate::time::Timestamp;

/// One page: the content of `page.json`, plus its live ink.
#[derive(Clone, Debug, PartialEq)]
pub struct Page {
    /// The page's identity, which also names its folder.
    pub id: PageId,
    /// Plain text, at most 1,000 characters. May be empty.
    pub title: String,
    /// When the page was made.
    pub created: Timestamp,
    /// The last change to the content.
    pub modified: Timestamp,
    /// Tags, as typed. A `/` nests them.
    pub tags: Vec<String>,
    /// Layout, paper, and background.
    pub view: PageView,
    /// The page's blocks.
    pub blocks: Blocks,
    /// The asset table.
    pub assets: BTreeMap<AssetId, Asset>,
    /// The segment list and the live strokes.
    pub ink: Ink,
    /// Reserved for audio recordings (spec 5.6), kept byte for byte.
    pub recordings: Option<serde_json::Value>,
    /// Reserved for encrypted sections (spec 5.7), kept byte for byte.
    pub encryption: Option<serde_json::Value>,
    /// The saved revision this page was read from, or will be written as.
    pub revision: Revision,
    /// Unknown top-level keys.
    pub extra: JsonMap,
    /// What the reader found. Never written.
    pub format: FormatInfo,
}

impl Page {
    /// An empty page with the default view.
    pub fn new(id: PageId, created: Timestamp, revision: Revision) -> Page {
        Page {
            id,
            title: String::new(),
            created,
            modified: created,
            tags: Vec::new(),
            view: PageView::default(),
            blocks: Blocks::default(),
            assets: BTreeMap::new(),
            ink: Ink::default(),
            recordings: None,
            encryption: None,
            revision,
            extra: JsonMap::new(),
            format: FormatInfo::default(),
        }
    }

    /// Block IDs in reading order (spec 6.2), with `view.reading_order` first.
    pub fn reading_order(&self) -> Vec<BlockId> {
        self.blocks.reading_order(&self.view.reading_order)
    }
}

/// A saved revision (spec 5.3).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Revision {
    /// New on every save.
    pub id: RevisionId,
    /// The revision this one was made from. Empty for a page's first revision.
    pub parents: Vec<RevisionId>,
    /// Up to 32 earlier revisions, newest first, including the parents.
    pub ancestors: Vec<RevisionId>,
    /// When this revision was written.
    pub saved_at: Timestamp,
    /// The device that wrote it.
    pub device: DeviceRef,
    /// The app and version that wrote it.
    pub writer: String,
    /// Unknown keys.
    #[serde(skip)]
    pub extra: JsonMap,
}

impl Revision {
    /// A first revision, with no parents.
    pub fn new(id: RevisionId, saved_at: Timestamp, device: DeviceRef, writer: impl Into<String>) -> Revision {
        Revision {
            id,
            parents: Vec::new(),
            ancestors: Vec::new(),
            saved_at,
            device,
            writer: writer.into(),
            extra: JsonMap::new(),
        }
    }
}

/// A device's ID and the label its person chose (spec 5.3).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct DeviceRef {
    /// The device's ID, from `device.json`.
    pub id: DeviceId,
    /// For example `Windows device GWGM`. Never the computer or account name.
    pub label: String,
}

/// What the reader found in a file. It is never written.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatInfo {
    /// The file's `formatVersion`.
    pub version_read: u32,
    /// The file's `minReaderVersion`.
    pub min_reader: u32,
    /// Whether the file may be changed.
    pub access: Access,
    /// Problems the reader worked around.
    pub warnings: Vec<Warning>,
}

impl Default for FormatInfo {
    fn default() -> FormatInfo {
        FormatInfo {
            version_read: crate::FORMAT_VERSION,
            min_reader: crate::MIN_READER_VERSION,
            access: Access::ReadWrite,
            warnings: Vec::new(),
        }
    }
}

/// Whether a file, page, section, or notebook may be changed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "access", content = "reason", rename_all = "camelCase")]
pub enum Access {
    /// It may be changed.
    ReadWrite,
    /// It is shown but not changed.
    ReadOnly(ReadOnlyReason),
}

impl Access {
    /// Whether it may not be changed.
    pub fn is_read_only(&self) -> bool {
        matches!(self, Access::ReadOnly(_))
    }
}

/// Why something is read-only. The interface picks the notice from this.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ReadOnlyReason {
    /// A newer version of OpenNote wrote the file (spec 15.2).
    NewerFormat,
    /// The file failed to read or validate (spec 16).
    Damaged,
    /// Some strokes are damaged (spec 9.6).
    DamagedInk {
        /// How many strokes are affected.
        strokes: u32,
    },
    /// Ink records or flags from a newer version (spec 9.6).
    UnknownInkData,
    /// Files the page needs haven't arrived yet (spec 14.5).
    WaitingForSync,
    /// Another OpenNote process has the notebook open (spec 20.3).
    LockedElsewhere,
    /// The notebook's drive is gone (spec 17.6).
    Offline,
    /// The file is marked read-only (spec 17.6).
    ReadOnlyFile,
    /// Windows blocked writes to the folder (spec 17.6).
    Blocked,
    /// A cloud file that isn't downloaded, while offline (spec 14.5).
    CloudPlaceholder,
    /// Journal records wait for recovery (spec 20.4).
    PendingJournal,
    /// A save may have replaced a change made at the same moment (spec 17.9).
    SuspectOverwrite,
    /// The section is encrypted (spec 5.7).
    Encrypted,
}

/// A problem a reader worked around.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Warning {
    /// A stable code, such as `"ink.strokeCount"`.
    pub code: &'static str,
    /// A description for logs and diagnostics.
    pub detail: String,
}

impl Warning {
    /// A new warning.
    pub fn new(code: &'static str, detail: impl Into<String>) -> Warning {
        Warning {
            code,
            detail: detail.into(),
        }
    }
}

/// A rectangle in page units.
#[derive(Clone, Copy, Debug, PartialEq, Default, Serialize, serde::Deserialize)]
pub struct Rect {
    /// Left edge.
    pub x: f64,
    /// Top edge.
    pub y: f64,
    /// Width.
    pub w: f64,
    /// Height.
    pub h: f64,
}

impl Rect {
    /// Whether the two rectangles overlap or touch.
    pub fn intersects(&self, other: &Rect) -> bool {
        self.x <= other.x + other.w
            && other.x <= self.x + self.w
            && self.y <= other.y + other.h
            && other.y <= self.y + self.h
    }
}
