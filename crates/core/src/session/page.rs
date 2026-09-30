//! An open page: edits, undo, saves, history, and conflicts (plan 9.2 and 9.4). Owned by WP5.

use std::collections::BTreeMap;
use std::ops::Range;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{CoreError, EditError};
use crate::id::{AssetId, BlockId, ClientId, PageId, RevisionId};
use crate::limits::Limits;
use crate::model::{Asset, DeviceRef, Page, Rect, Revision, VersionEntry};
use crate::ops::resolve::{StrokeTxnMeta, TxnRequest};
use crate::order::OrderKey;
use crate::seams::Codec;
use crate::store::assets::AssetSource;
use crate::store::fs::Fs;
use crate::store::page_store::{LoadError, LoadedPage};
use crate::time::Timestamp;
use crate::wire::envelope::Envelope;
use crate::wire::frames::AppliedFrame;

/// The answer to an applied edit (plan 11.4).
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TxnAck {
    /// The journal sequence number of the transaction.
    pub seq: u64,
    /// The order keys the core made for new blocks.
    pub order_keys: BTreeMap<BlockId, OrderKey>,
    /// Whether the client can undo.
    pub can_undo: bool,
    /// Whether the client can redo.
    pub can_redo: bool,
}

/// Bytes of an asset for the asset protocol.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AssetBytes {
    /// The media type.
    pub mime: String,
    /// The asset's whole size.
    pub total: u64,
    /// The range returned, for range requests.
    pub range: Option<Range<u64>>,
    /// The bytes.
    pub bytes: Vec<u8>,
}

/// A saved revision, for the interface.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RevisionInfo {
    /// The revision.
    pub revision: RevisionId,
    /// When it was saved.
    pub saved_at: Timestamp,
    /// Whether the save is confirmed on disk.
    pub confirmed: bool,
}

/// What restoring a version did.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum RestoreResult {
    /// The page now holds the version, as a new revision.
    Restored {
        /// The new revision.
        revision: RevisionInfo,
    },
    /// The version became a new page.
    Copied {
        /// The new page.
        page: PageId,
    },
}

/// An open conflict of a page (spec 14.1).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictInfo {
    /// The other version's revision.
    pub revision: RevisionId,
    /// The device that saved it.
    pub device: DeviceRef,
    /// When it was saved.
    pub saved_at: Timestamp,
}

/// How a conflict is resolved.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictChoice {
    /// Keep this device's version.
    KeepMine,
    /// Keep the other version.
    KeepTheirs,
    /// Keep both as separate pages.
    KeepBoth,
}

/// An open page. Cloning shares its session.
#[derive(Clone)]
pub struct PageHandle {
    _session: Arc<()>,
}

impl PageHandle {
    /// The page envelope (plan 11.3), with the strokes that meet `viewport` first.
    pub fn envelope(&self, _viewport: Option<Rect>) -> Result<Envelope, CoreError> {
        unimplemented!("WP5: PageHandle::envelope")
    }

    /// Resolves, applies, and journals an edit request.
    pub fn apply(&self, _req: TxnRequest) -> Result<TxnAck, EditError> {
        unimplemented!("WP5: PageHandle::apply")
    }

    /// Adds strokes sent as binary records.
    pub fn add_strokes(&self, _meta: StrokeTxnMeta, _records: &[u8]) -> Result<TxnAck, EditError> {
        unimplemented!("WP5: PageHandle::add_strokes")
    }

    /// Journals a progress record of a stroke still being drawn.
    pub fn ink_progress(&self, _client: &ClientId, _record: &[u8]) -> Result<(), EditError> {
        unimplemented!("WP5: PageHandle::ink_progress")
    }

    /// Undoes the client's last step.
    pub fn undo(&self, _client: &ClientId) -> Result<Option<AppliedFrame>, EditError> {
        unimplemented!("WP5: PageHandle::undo")
    }

    /// Redoes the client's last undone step.
    pub fn redo(&self, _client: &ClientId) -> Result<Option<AppliedFrame>, EditError> {
        unimplemented!("WP5: PageHandle::redo")
    }

    /// Imports a file as an asset of the page.
    pub fn import_asset(&self, _source: AssetSource) -> Result<Asset, CoreError> {
        unimplemented!("WP5: PageHandle::import_asset")
    }

    /// Reads an asset, or a byte range of it.
    pub fn asset_bytes(&self, _asset: AssetId, _range: Option<Range<u64>>) -> Result<AssetBytes, CoreError> {
        unimplemented!("WP5: PageHandle::asset_bytes")
    }

    /// Saves the page now.
    pub fn save_now(&self) -> Result<RevisionInfo, CoreError> {
        unimplemented!("WP5: PageHandle::save_now")
    }

    /// The page's saved versions.
    pub fn history(&self) -> Result<Vec<VersionEntry>, CoreError> {
        unimplemented!("WP5: PageHandle::history")
    }

    /// A saved version, read-only.
    pub fn open_version(&self, _rev: RevisionId) -> Result<Envelope, CoreError> {
        unimplemented!("WP5: PageHandle::open_version")
    }

    /// Restores a version, or makes it a new page.
    pub fn restore_version(&self, _rev: RevisionId, _as_copy: bool) -> Result<RestoreResult, CoreError> {
        unimplemented!("WP5: PageHandle::restore_version")
    }

    /// Names a version, or marks it to keep forever.
    pub fn name_version(&self, _rev: RevisionId, _name: Option<String>, _keep: bool) -> Result<(), CoreError> {
        unimplemented!("WP5: PageHandle::name_version")
    }

    /// The page's open conflicts.
    pub fn conflicts(&self) -> Result<Vec<ConflictInfo>, CoreError> {
        unimplemented!("WP5: PageHandle::conflicts")
    }

    /// The other version of a conflict, read-only.
    pub fn open_conflict(&self, _rev: RevisionId) -> Result<Envelope, CoreError> {
        unimplemented!("WP5: PageHandle::open_conflict")
    }

    /// Resolves a conflict.
    pub fn resolve_conflict(&self, _rev: RevisionId, _choice: ConflictChoice) -> Result<RevisionInfo, CoreError> {
        unimplemented!("WP5: PageHandle::resolve_conflict")
    }

    /// Repairs damaged ink (spec 9.6).
    pub fn repair_ink(&self) -> Result<RevisionInfo, CoreError> {
        unimplemented!("WP5: PageHandle::repair_ink")
    }

    /// Clears the read-only attribute of `page.json`.
    pub fn make_editable(&self) -> Result<(), CoreError> {
        unimplemented!("WP5: PageHandle::make_editable")
    }

    /// Waits until the journal record `seq` is on disk.
    pub fn wait_durable(&self, _seq: u64, _timeout: Duration) -> Result<(), CoreError> {
        unimplemented!("WP5: PageHandle::wait_durable")
    }

    /// Closes the page for a client, saving it when the last client leaves.
    pub fn close(self, _client: &ClientId) -> Result<(), CoreError> {
        unimplemented!("WP5: PageHandle::close")
    }
}

/// Reads a page folder without a session, for importers, exporters, and tools.
pub fn read_page_dir(_fs: &dyn Fs, _codec: &dyn Codec, _dir: &Path, _limits: &Limits) -> Result<LoadedPage, LoadError> {
    unimplemented!("WP5: read_page_dir")
}

/// Writes a page folder without a session or a journal (spec 17.7, the writer without a journal).
pub fn write_page_dir(_fs: &dyn Fs, _codec: &dyn Codec, _dir: &Path, _page: &Page) -> Result<Revision, CoreError> {
    unimplemented!("WP5: write_page_dir")
}
