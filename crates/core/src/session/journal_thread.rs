//! The journal thread (plan 8.2): one per core, owning every journal file. Owned by WP4.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use crate::error::{CoreError, JournalError};
use crate::id::{DeviceId, Id, IntentId, NotebookId, PageId, RevisionId, SectionId, TrashItemId};
use crate::limits::Timings;
use crate::model::Stroke;
use crate::ops::Txn;
use crate::seams::Codec;
use crate::session::events::EventSink;
use crate::store::fs::{Durability, FolderIdentity, Fs};
use crate::store::layout::NotebookKey;
use crate::time::Clock;

/// What the journal thread needs.
#[derive(Clone)]
pub struct JournalConfig {
    /// The file system.
    pub fs: Arc<dyn Fs>,
    /// The codec, for stroke records in blobs.
    pub codec: Arc<dyn Codec>,
    /// The device-local journal folder.
    pub root: PathBuf,
    /// The clock.
    pub clock: Arc<dyn Clock>,
    /// Group commit, rotation, and forced-save sizes.
    pub timings: Timings,
    /// Where `JournalDegraded` goes.
    pub events: Arc<dyn EventSink>,
}

/// The thread that appends, flushes, and rotates every journal file.
pub struct JournalThread {
    _thread: (),
}

/// A page's journal, held by its page session.
pub struct JournalHandle {
    _channel: (),
}

/// The base snapshot of a new generation: the exact bytes of `page.json` at a revision, gzipped.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BaseSnapshot {
    /// The revision.
    pub revision: RevisionId,
    /// The gzip of its `page.json` bytes.
    pub gzip: Arc<[u8]>,
}

/// The metadata of a journal header (spec 20.5).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct JournalMeta {
    /// The notebook.
    pub notebook: NotebookId,
    /// Where the notebook folder is.
    pub notebook_path: PathBuf,
    /// The notebook folder's identity.
    pub identity: FolderIdentity,
    /// The app and version.
    pub app: String,
    /// This device.
    pub device: DeviceId,
    /// The boot identifier.
    pub boot: String,
    /// The page format version of the records' operations.
    pub page_format: u16,
}

/// A notebook's tree journal, for intents of changes that touch several files.
pub struct TreeJournal {
    _handle: (),
}

/// A tree change that touches several files (spec 18.2 and 20.7).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TreeIntent {
    /// The intent's ID.
    pub id: IntentId,
    /// The change.
    pub op: TreeOp,
    /// How many of its steps are done.
    pub steps_done: u8,
}

/// The tree changes that record intents.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TreeOp {
    /// Create a page.
    CreatePage {
        /// Its section.
        section: SectionId,
        /// The new page.
        page: PageId,
    },
    /// Create a section.
    CreateSection {
        /// The new section.
        section: SectionId,
    },
    /// Move a page to another section.
    MovePage {
        /// The page.
        page: PageId,
        /// The source section.
        from: SectionId,
        /// The target section.
        to: SectionId,
    },
    /// Duplicate a page.
    DuplicatePage {
        /// The original page.
        from: PageId,
        /// The section of the copy.
        section: SectionId,
        /// The copy's new page ID.
        new: PageId,
    },
    /// Move a page to another notebook.
    MovePageToNotebook {
        /// The page.
        page: PageId,
        /// The target notebook folder.
        to_notebook: PathBuf,
        /// The target section.
        to_section: SectionId,
    },
    /// Move a section, or the sections of a group, to another notebook (spec 18.2).
    MoveSectionToNotebook {
        /// The sections.
        sections: Vec<SectionId>,
        /// The target notebook folder.
        to_notebook: PathBuf,
    },
    /// Delete to Trash.
    DeleteToTrash {
        /// The new Trash item.
        item: TrashItemId,
        /// The folders it holds.
        contents: Vec<Id>,
    },
    /// Restore from Trash.
    Restore {
        /// The Trash item.
        item: TrashItemId,
    },
    /// Purge from Trash.
    Purge {
        /// The Trash item.
        item: TrashItemId,
    },
}

impl JournalThread {
    /// Starts the thread.
    pub fn start(_config: JournalConfig) -> Result<JournalThread, CoreError> {
        unimplemented!("WP4: JournalThread::start")
    }

    /// Opens a page's journal. The generation file is created at the first append.
    pub fn open_page(
        &self,
        _key: &NotebookKey,
        _page: PageId,
        _meta: JournalMeta,
        _base: BaseSnapshot,
    ) -> Result<JournalHandle, JournalError> {
        unimplemented!("WP4: JournalThread::open_page")
    }

    /// Opens a notebook's tree journal.
    pub fn open_tree(&self, _key: &NotebookKey, _meta: JournalMeta) -> Result<TreeJournal, JournalError> {
        unimplemented!("WP4: JournalThread::open_tree")
    }

    /// Flushes every journal, waiting at most `timeout`.
    pub fn flush_all(&self, _timeout: Duration) -> Result<(), JournalError> {
        unimplemented!("WP4: JournalThread::flush_all")
    }

    /// Flushes everything and stops the thread.
    pub fn shutdown(self, _timeout: Duration) {
        unimplemented!("WP4: JournalThread::shutdown")
    }
}

impl JournalHandle {
    /// Appends a transaction and returns its sequence number. It survives an app crash from now on.
    pub fn append_txn(&self, _txn: &Txn) -> u64 {
        unimplemented!("WP4: JournalHandle::append_txn")
    }

    /// Appends a progress copy of a stroke still being drawn.
    pub fn append_ink_progress(&self, _stroke: &Stroke) -> u64 {
        unimplemented!("WP4: JournalHandle::append_ink_progress")
    }

    /// Appends and flushes `SaveBegin` (step S6).
    pub fn save_begin(&self, _revision: RevisionId, _through_seq: u64, _timeout: Duration) -> Result<(), JournalError> {
        unimplemented!("WP4: JournalHandle::save_begin")
    }

    /// Tells the journal a save finished, so it may rotate after a confirmed one (spec 20.9).
    pub fn after_save(&self, _durability: Durability, _base: BaseSnapshot, _through_seq: u64) {
        unimplemented!("WP4: JournalHandle::after_save")
    }

    /// Closes the page's journal: deletes it after a confirmed final save, or parks it (spec 20.9).
    pub fn close(self, _last_save: Option<(RevisionId, Durability)>) {
        unimplemented!("WP4: JournalHandle::close")
    }

    /// The highest sequence number flushed to disk.
    pub fn durable_seq(&self) -> u64 {
        unimplemented!("WP4: JournalHandle::durable_seq")
    }

    /// Waits until `seq` is flushed.
    pub fn wait_durable(&self, _seq: u64, _timeout: Duration) -> Result<(), JournalError> {
        unimplemented!("WP4: JournalHandle::wait_durable")
    }

    /// Bytes journaled since the last save, for the 4 MiB rule.
    pub fn bytes_since_save(&self) -> u64 {
        unimplemented!("WP4: JournalHandle::bytes_since_save")
    }

    /// Whether the journal can't be written.
    pub fn degraded(&self) -> bool {
        unimplemented!("WP4: JournalHandle::degraded")
    }
}

impl TreeJournal {
    /// Records an intent and flushes it before returning.
    pub fn begin(&self, _intent: &TreeIntent) -> Result<(), JournalError> {
        unimplemented!("WP4: TreeJournal::begin")
    }

    /// Records that a step of an intent is done.
    pub fn step_done(&self, _intent: IntentId, _step: u8) {
        unimplemented!("WP4: TreeJournal::step_done")
    }

    /// Records that an intent is done.
    pub fn done(&self, _intent: IntentId) {
        unimplemented!("WP4: TreeJournal::done")
    }

    /// Intents without a done record, to roll forward.
    pub fn unfinished(&self) -> Vec<TreeIntent> {
        unimplemented!("WP4: TreeJournal::unfinished")
    }
}
