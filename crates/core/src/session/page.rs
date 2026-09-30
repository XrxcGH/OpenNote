//! An open page: edits, undo, saves, history, and conflicts (plan 9.2 and 9.4). Owned by WP5.
//!
//! A [`PageHandle`] is one client's view of a page session. Every client with the page open shares the
//! session, which holds the page, one undo stack per client, the save state, the journal, and the fingerprint
//! of `page.json`. The session lives while any client has the page open.

use std::collections::{BTreeMap, HashMap};
use std::ops::Range;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{CoreError, EditError};
use crate::id::{AssetId, BlockId, ClientId, PageId, RevisionId};
use crate::limits::Limits;
use crate::model::{Asset, DeviceRef, Page, Rect, Revision, VersionEntry};
use crate::ops::resolve::{StrokeTxnMeta, TxnRequest};
use crate::ops::AppliedChanges;
use crate::order::OrderKey;
use crate::seams::{Codec, LinkResolver};
use crate::store::assets::AssetSource;
use crate::store::fs::Fs;
use crate::store::notebook_store::{next_revision, read_page_files, write_page_files};
use crate::store::page_store::{LoadError, LoadedPage};
use crate::store::PageFiles;
use crate::time::{SystemClock, Timestamp};
use crate::wire::envelope::Envelope;
use crate::wire::frames::AppliedFrame;

mod edits;
pub(crate) mod save;
pub(crate) mod state;
mod versions;
pub(crate) mod view;

#[cfg(test)]
mod tests;

pub(crate) use state::{Opening, PageSession};

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

/// An open page, for one client. Cloning shares its session.
#[derive(Clone)]
pub struct PageHandle {
    pub(crate) session: Arc<PageSession>,
    pub(crate) client: ClientId,
}

impl std::fmt::Debug for PageHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("PageHandle")
            .field("page", &self.session.id)
            .field("client", &self.client)
            .finish()
    }
}

impl PageHandle {
    /// The page's ID.
    pub fn id(&self) -> PageId {
        self.session.id
    }

    /// The client this handle was opened for.
    pub fn client(&self) -> &ClientId {
        &self.client
    }

    /// The page envelope (plan 11.3), with the strokes that meet `viewport` first.
    pub fn envelope(&self, viewport: Option<Rect>) -> Result<Envelope, CoreError> {
        self.session.envelope(&self.client, viewport)
    }

    /// The strokes that didn't fit in an envelope for `viewport`, as messages for the page's channel.
    pub fn remaining_ink(&self, viewport: Rect) -> Vec<Vec<u8>> {
        self.session.ink_chunks(viewport)
    }

    /// Resolves, applies, and journals an edit request.
    pub fn apply(&self, req: TxnRequest) -> Result<TxnAck, EditError> {
        if req.page != self.session.id {
            return Err(EditError::NotFound(format!("page {}", req.page)));
        }
        self.session.apply(&req)
    }

    /// Adds strokes sent as binary records.
    pub fn add_strokes(&self, meta: StrokeTxnMeta, records: &[u8]) -> Result<TxnAck, EditError> {
        self.session.add_strokes(&meta, records)
    }

    /// Journals a progress record of a stroke still being drawn.
    pub fn ink_progress(&self, _client: &ClientId, record: &[u8]) -> Result<(), EditError> {
        self.session.ink_progress(record)
    }

    /// Undoes the client's last step.
    pub fn undo(&self, client: &ClientId) -> Result<Option<AppliedFrame>, EditError> {
        self.session.undo_redo(client, false)
    }

    /// Redoes the client's last undone step.
    pub fn redo(&self, client: &ClientId) -> Result<Option<AppliedFrame>, EditError> {
        self.session.undo_redo(client, true)
    }

    /// The frame that pushes changes another window made to this client (`core:txn-applied`).
    pub fn changes_frame(&self, changes: &AppliedChanges) -> Result<AppliedFrame, EditError> {
        let st = self.session.state();
        self.session.frame(&st, &self.client, (st.seq, changes, None))
    }

    /// Imports a file as an asset of the page.
    pub fn import_asset(&self, source: AssetSource) -> Result<Asset, CoreError> {
        self.session.import_asset(source)
    }

    /// Reads an asset, or a byte range of it.
    pub fn asset_bytes(&self, asset: AssetId, range: Option<Range<u64>>) -> Result<AssetBytes, CoreError> {
        self.session.asset_bytes(asset, range)
    }

    /// Saves the page now.
    pub fn save_now(&self) -> Result<RevisionInfo, CoreError> {
        match self.session.save(save::Why::Now)? {
            Some(info) => Ok(info),
            None => Ok(self.session.current_revision()),
        }
    }

    /// Why the page is read-only, if it is.
    pub fn read_only(&self) -> Option<crate::model::ReadOnlyReason> {
        self.session.read_only()
    }

    /// Whether the page has changes that aren't saved yet.
    pub fn has_unsaved(&self) -> bool {
        self.session.state().dirty.is_some()
    }

    /// The page's saved versions, newest first.
    pub fn history(&self) -> Result<Vec<VersionEntry>, CoreError> {
        self.session.history()
    }

    /// A saved version, read-only.
    pub fn open_version(&self, rev: RevisionId) -> Result<Envelope, CoreError> {
        self.session.open_version(rev)
    }

    /// Restores a version, or makes it a new page.
    pub fn restore_version(&self, rev: RevisionId, as_copy: bool) -> Result<RestoreResult, CoreError> {
        self.session.restore_version(rev, as_copy)
    }

    /// Names a version, or marks it to keep forever.
    pub fn name_version(&self, rev: RevisionId, name: Option<String>, keep: bool) -> Result<(), CoreError> {
        self.session.name_version(rev, name, keep)
    }

    /// The page's open conflicts.
    pub fn conflicts(&self) -> Result<Vec<ConflictInfo>, CoreError> {
        self.session.conflicts()
    }

    /// The other version of a conflict, read-only.
    pub fn open_conflict(&self, rev: RevisionId) -> Result<Envelope, CoreError> {
        self.session.open_conflict(rev)
    }

    /// Resolves a conflict.
    pub fn resolve_conflict(&self, rev: RevisionId, choice: ConflictChoice) -> Result<RevisionInfo, CoreError> {
        self.session.resolve_conflict(rev, choice)
    }

    /// Repairs damaged ink (spec 9.6).
    pub fn repair_ink(&self) -> Result<RevisionInfo, CoreError> {
        self.session.repair_ink()
    }

    /// Clears the read-only attribute of `page.json`.
    pub fn make_editable(&self) -> Result<(), CoreError> {
        self.session.make_editable()
    }

    /// Waits until the journal record `seq` is on disk.
    pub fn wait_durable(&self, seq: u64, timeout: Duration) -> Result<(), CoreError> {
        match self.session.journal().as_ref() {
            Some(journal) => Ok(journal.wait_durable(seq, timeout)?),
            None if seq == 0 => Ok(()),
            None => Err(CoreError::Journal(crate::error::JournalError::Closed)),
        }
    }

    /// Closes the page for a client, saving it when the last client leaves.
    pub fn close(self, client: &ClientId) -> Result<(), CoreError> {
        let last = {
            let mut st = self.session.state();
            if let Some(state) = st.clients.get_mut(client) {
                state.opens = state.opens.saturating_sub(1);
                if state.opens == 0 {
                    if let Some(stack) = st.clients.remove(client).and_then(|c| c.undo) {
                        let bytes = stack.bytes();
                        st.undo_bytes = st.undo_bytes.saturating_sub(bytes);
                        self.session.ctx.release_undo(bytes);
                    }
                }
            }
            st.clients.is_empty()
        };
        if last {
            self.session.finish(save::Why::Close)
        } else {
            Ok(())
        }
    }
}

/// Reads a page folder without a session, for importers, exporters, and tools.
pub fn read_page_dir(fs: &dyn Fs, codec: &dyn Codec, dir: &Path, limits: &Limits) -> Result<LoadedPage, LoadError> {
    read_page_files(fs, codec, dir, limits)
}

/// Writes a page folder without a session or a journal (spec 17.7, the writer without a journal).
///
/// The new revision's parent is the page's revision, unless the page has none yet. It keeps the device and
/// writer of the page's revision, so an importer sets those. Pending ink records become a new segment.
pub fn write_page_dir(fs: &dyn Fs, codec: &dyn Codec, dir: &Path, page: &Page) -> Result<Revision, CoreError> {
    let clock = SystemClock::new();
    let revision = next_revision(page, &clock, &page.revision.device, &page.revision.writer);
    let files = PageFiles { fs, codec, dir };
    Ok(write_page_files(&files, &clock, page, revision)?.revision)
}

/// Links in `page.md` (spec 11.1): relative paths to other pages of the notebook, and asset file names.
pub(crate) struct PageLinks {
    pub(crate) from: PathBuf,
    pub(crate) pages: HashMap<PageId, PathBuf>,
    pub(crate) assets: BTreeMap<AssetId, String>,
}

impl LinkResolver for PageLinks {
    fn page_md(&self, _from: PageId, to: PageId) -> Option<String> {
        let target = self.pages.get(&to)?;
        let page = target.file_name()?.to_string_lossy().into_owned();
        let section = target.parent()?.file_name()?.to_string_lossy().into_owned();
        let same_section = self.from.parent() == target.parent();
        Some(if same_section {
            format!("../{page}/page.md")
        } else {
            format!("../../{section}/{page}/page.md")
        })
    }

    fn asset_file(&self, asset: AssetId) -> Option<String> {
        self.assets.get(&asset).map(|file| format!("assets/{file}"))
    }
}
