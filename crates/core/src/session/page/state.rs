//! A page session's state, and what every change does to it: journal it, mark the page dirty, schedule the
//! save, and tell other windows.

use std::collections::{BTreeMap, BTreeSet};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, RwLock, RwLockReadGuard, Weak};

use crate::error::{EditError, FsErrorKind};
use crate::format::gzip::gzip;
use crate::id::{AssetId, BlockId, ClientId, PageId, RevisionId};
use crate::model::{Asset, Page, ReadOnlyReason, VersionReason};
use crate::ops::undo::UndoStack;
use crate::ops::{AppliedChanges, Op, Txn};
use crate::session::autosave::{due_at, Dirty, Saveable, Urgency};
use crate::session::backend::PageJournal;
use crate::session::core::CoreCtx;
use crate::session::events::CoreEvent;
use crate::session::journal_thread::BaseSnapshot;
use crate::session::notebook::NotebookShared;
use crate::store::fs::FileStamp;
use crate::store::page_store::LoadedPage;

/// A change removes more than this many blocks: save a version first (spec 13.2).
const LARGE_DELETE_BLOCKS: usize = 20;

/// A change removes more than this many strokes: save a version first.
const LARGE_DELETE_STROKES: usize = 200;

/// One window or editor that has the page open.
#[derive(Debug, Default)]
pub(crate) struct ClientState {
    /// The last client sequence number accepted.
    pub(crate) seq: u64,
    /// Its undo and redo stacks, made at its first edit.
    pub(crate) undo: Option<UndoStack>,
    /// How many handles of this client are open.
    pub(crate) opens: u32,
}

/// What changed since the last save, for the search index.
#[derive(Clone, Debug, Default)]
pub(crate) struct Hint {
    pub(crate) changed: BTreeSet<BlockId>,
    pub(crate) removed: BTreeSet<BlockId>,
    pub(crate) title: bool,
}

impl Hint {
    pub(crate) fn add(&mut self, changes: &AppliedChanges) {
        for id in &changes.blocks_changed {
            self.removed.remove(id);
            self.changed.insert(*id);
        }
        for id in &changes.blocks_removed {
            self.changed.remove(id);
            self.removed.insert(*id);
        }
        self.title |= changes.page_fields;
    }

    pub(crate) fn merge(&mut self, earlier: Hint) {
        for id in earlier.changed {
            if !self.removed.contains(&id) {
                self.changed.insert(id);
            }
        }
        for id in earlier.removed {
            if !self.changed.contains(&id) {
                self.removed.insert(id);
            }
        }
        self.title |= earlier.title;
    }
}

/// The page's history bookkeeping (spec 13.2).
#[derive(Clone, Debug, Default)]
pub(crate) struct Versions {
    /// A version of the base revision to write before the next save.
    pub(crate) before_save: Option<VersionReason>,
    /// Edits since the last version.
    pub(crate) edited: bool,
    /// When the last version was written, in monotonic time.
    pub(crate) last: Option<std::time::Duration>,
    /// Whether this session saved yet.
    pub(crate) saved_once: bool,
}

/// Everything a page session holds behind its lock.
pub(crate) struct PageState {
    pub(crate) page: Page,
    pub(crate) dir: PathBuf,
    /// The exact `page.json` bytes of the base revision.
    pub(crate) bytes: Arc<[u8]>,
    pub(crate) stamp: Option<FileStamp>,
    /// The revision on disk that this session builds on.
    pub(crate) base: RevisionId,
    pub(crate) clients: BTreeMap<ClientId, ClientState>,
    /// The last journal sequence number, or a local count while the journal can't be written.
    pub(crate) seq: u64,
    pub(crate) saved_seq: u64,
    pub(crate) dirty: Option<Dirty>,
    pub(crate) urgency: Urgency,
    pub(crate) saving: bool,
    pub(crate) failures: u32,
    pub(crate) last_error: Option<FsErrorKind>,
    pub(crate) read_only: Option<ReadOnlyReason>,
    pub(crate) damaged: u32,
    pub(crate) missing: u32,
    pub(crate) hint: Hint,
    pub(crate) versions: Versions,
    /// Assets imported and not yet in the table.
    pub(crate) imported: BTreeMap<AssetId, Asset>,
    pub(crate) encrypted: bool,
    pub(crate) conflicts: Vec<RevisionId>,
    pub(crate) closed: bool,
    pub(crate) journal_failed: bool,
    /// Whether the last save was confirmed on disk (spec 17.5).
    pub(crate) last_durability: crate::store::fs::Durability,
    /// Bytes charged to the shared undo budget by this page's stacks.
    pub(crate) undo_bytes: usize,
    /// When a client last used the page, for the undo budget.
    pub(crate) used: std::time::Duration,
}

/// An open page, shared by every client that has it open.
pub(crate) struct PageSession {
    pub(crate) serial: u64,
    pub(crate) id: PageId,
    pub(crate) ctx: Arc<CoreCtx>,
    pub(crate) notebook: Weak<NotebookShared>,
    pub(crate) state: Mutex<PageState>,
    /// The page's journal, made at the first edit. Appends take it for reading, so saves never block edits.
    pub(crate) journal: RwLock<Option<Box<dyn PageJournal>>>,
    /// Held by a save, and by a folder move of this page, so the two never overlap (spec 18.2).
    pub(crate) io: Mutex<()>,
    pub(crate) me: Weak<PageSession>,
}

/// How a page session starts.
pub(crate) struct Opening {
    pub(crate) loaded: LoadedPage,
    pub(crate) dir: PathBuf,
    pub(crate) read_only: Option<ReadOnlyReason>,
    pub(crate) encrypted: bool,
}

impl PageSession {
    pub(crate) fn new(ctx: Arc<CoreCtx>, notebook: Weak<NotebookShared>, opening: Opening) -> Arc<PageSession> {
        let loaded = opening.loaded;
        let read_only = opening.read_only.or_else(|| match &loaded.page.format.access {
            crate::model::Access::ReadOnly(reason) => Some(reason.clone()),
            crate::model::Access::ReadWrite => None,
        });
        let state = PageState {
            base: loaded.page.revision.id,
            damaged: u32::try_from(loaded.damaged.len()).unwrap_or(u32::MAX),
            missing: u32::try_from(loaded.missing.len()).unwrap_or(u32::MAX),
            page: loaded.page,
            dir: opening.dir,
            bytes: loaded.bytes,
            stamp: Some(loaded.stamp),
            clients: BTreeMap::new(),
            seq: 0,
            saved_seq: 0,
            dirty: None,
            urgency: Urgency::Normal,
            saving: false,
            failures: 0,
            last_error: None,
            read_only,
            hint: Hint::default(),
            versions: Versions::default(),
            imported: BTreeMap::new(),
            encrypted: opening.encrypted,
            conflicts: Vec::new(),
            closed: false,
            journal_failed: false,
            last_durability: crate::store::fs::Durability::Confirmed,
            undo_bytes: 0,
            used: ctx.clock.monotonic(),
        };
        let serial = ctx.next_serial();
        let id = state.page.id;
        Arc::new_cyclic(|me| PageSession {
            serial,
            id,
            ctx,
            notebook,
            state: Mutex::new(state),
            journal: RwLock::new(None),
            io: Mutex::new(()),
            me: me.clone(),
        })
    }

    pub(crate) fn state(&self) -> MutexGuard<'_, PageState> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn journal(&self) -> RwLockReadGuard<'_, Option<Box<dyn PageJournal>>> {
        self.journal.read().unwrap_or_else(PoisonError::into_inner)
    }

    /// Fails for an edit to a closed or read-only page.
    pub(crate) fn check_editable(&self, st: &PageState) -> Result<(), EditError> {
        if st.closed {
            return Err(EditError::NotFound(format!("page {} is closed", self.id)));
        }
        match &st.read_only {
            Some(reason) => Err(EditError::ReadOnly(reason.clone())),
            None => Ok(()),
        }
    }

    /// Applies a resolved transaction and records it.
    pub(crate) fn commit(&self, st: &mut PageState, txn: &Txn) -> Result<(u64, AppliedChanges), EditError> {
        let changes = self
            .ctx
            .applier
            .apply(&mut st.page, txn)
            .map_err(EditError::Precondition)?;
        let seq = self.record(st, txn, &changes);
        Ok((seq, changes))
    }

    /// Records a transaction that is already applied: journals it, marks the page dirty, schedules the save,
    /// and tells other windows. Returns its sequence number.
    pub(crate) fn record(&self, st: &mut PageState, txn: &Txn, changes: &AppliedChanges) -> u64 {
        let before_first_edit = st.dirty.is_none() && !st.versions.saved_once && !st.versions.edited;
        let seq = self.journal_txn(st, txn);
        let now = self.ctx.clock.monotonic();
        st.dirty = Some(match st.dirty {
            Some(dirty) => crate::session::autosave::Dirty { last: now, ..dirty },
            None => crate::session::autosave::Dirty { first: now, last: now },
        });
        st.used = now;
        st.hint.add(changes);
        st.versions.edited = true;
        if before_first_edit {
            st.versions.before_save.get_or_insert(VersionReason::BeforeEdit);
        }
        if changes.blocks_removed.len() > LARGE_DELETE_BLOCKS || changes.strokes_removed.len() > LARGE_DELETE_STROKES {
            st.versions.before_save.get_or_insert(VersionReason::BeforeLargeDelete);
        }
        if self
            .journal()
            .as_ref()
            .is_some_and(|j| j.bytes_since_save() > self.ctx.timings.journal_force_bytes)
        {
            st.urgency = Urgency::JournalFull;
        }
        self.schedule(st);
        if st.clients.len() > 1 {
            self.ctx.events.emit(CoreEvent::TxnApplied {
                page: self.id,
                source: txn.client.clone(),
                changes: changes.clone(),
            });
        }
        seq
    }

    /// Appends a transaction to the journal, opening it at the first edit (plan 9.2). While the journal can't
    /// be written, edits still go through, with a save every second (spec 20.12).
    fn journal_txn(&self, st: &mut PageState, txn: &Txn) -> u64 {
        self.ensure_journal(st);
        let seq = match self.journal().as_ref() {
            Some(journal) => journal.append_txn(txn),
            None => st.seq.saturating_add(1),
        };
        st.seq = seq;
        seq
    }

    /// Opens the page's journal if it isn't open yet.
    pub(crate) fn ensure_journal(&self, st: &mut PageState) {
        if st.journal_failed || self.journal().is_some() {
            return;
        }
        let Some(notebook) = self.notebook.upgrade() else {
            return;
        };
        // The page's folder is inside its section's folder, so recovery can create a lost page again there.
        let section = st.dir.parent().and_then(|d| d.file_name()?.to_str()?.parse().ok());
        let (key, meta) = notebook.journal_meta(section);
        let base = BaseSnapshot {
            revision: st.base,
            gzip: gzip(&st.bytes).into(),
        };
        match self.ctx.backend.open_page_journal(&key, self.id, meta, base) {
            Ok(journal) => {
                *self.journal.write().unwrap_or_else(PoisonError::into_inner) = Some(journal);
            }
            Err(e) => {
                st.journal_failed = true;
                self.ctx
                    .events
                    .emit(CoreEvent::JournalDegraded { message: e.to_string() });
            }
        }
    }

    /// Whether the journal can't protect edits, so saves come every second.
    pub(crate) fn degraded(&self, st: &PageState) -> bool {
        st.journal_failed || self.journal().as_ref().is_some_and(|j| j.degraded())
    }

    /// Hands the page's due time to the saver.
    pub(crate) fn schedule(&self, st: &PageState) {
        let Some(dirty) = st.dirty else {
            self.ctx.saver.cancel(self.serial);
            return;
        };
        if st.read_only.is_some() || st.closed {
            return;
        }
        let due = due_at(dirty, &self.ctx.timings, self.degraded(st), st.urgency);
        let me: Weak<dyn Saveable> = self.me.clone() as Weak<dyn Saveable>;
        self.ctx.saver.schedule(self.serial, me, due);
    }

    /// The order keys the transaction gave new blocks, for the answer to the interface.
    pub(crate) fn new_order_keys(txn: &Txn) -> BTreeMap<BlockId, crate::order::OrderKey> {
        let mut keys = BTreeMap::new();
        for op in &txn.ops {
            if let Op::InsertBlocks { blocks } = op {
                for block in blocks {
                    keys.insert(block.id, block.order.clone());
                }
            }
        }
        keys
    }

    /// Whether the client can undo and redo.
    pub(crate) fn undo_state(st: &PageState, client: &ClientId) -> (bool, bool) {
        st.clients
            .get(client)
            .and_then(|c| c.undo.as_ref())
            .map_or((false, false), |u| (u.can_undo(), u.can_redo()))
    }

    /// Drops every client's undo history, such as after a reload or a restored version (spec 13.4).
    pub(crate) fn clear_undo(&self, st: &mut PageState) {
        for client in st.clients.values_mut() {
            if let Some(stack) = client.undo.as_mut() {
                stack.clear();
            }
        }
        self.ctx.release_undo(st.undo_bytes);
        st.undo_bytes = 0;
    }
}
