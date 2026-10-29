//! The journal thread (plan 8.2): one per core, owning every journal file. Owned by WP4.
//!
//! Handles number and frame records on the caller's thread, and the journal thread appends each at once, so it
//! survives an app crash from that moment. The thread flushes within the group commit interval of the first
//! unflushed record, and at once for `SaveBegin` and tree intents. It rotates generations after confirmed
//! saves, with no appends in between, and reports `JournalDegraded` when it can't write.

use std::path::PathBuf;
use std::sync::mpsc::{self, Sender};
use std::sync::Arc;
use std::thread::JoinHandle;
use std::time::Duration;

use crate::error::{CoreError, FsError, FsErrorKind, JournalError};
use crate::id::{DeviceId, Id, IntentId, NotebookId, PageId, RevisionId, SectionId, TrashItemId};
use crate::limits::Timings;
use crate::model::Stroke;
use crate::ops::Txn;
use crate::seams::Codec;
use crate::session::events::EventSink;
use crate::store::fs::{Durability, FolderIdentity, Fs};
use crate::store::journal::encode;
use crate::store::journal::format::{encode_record, RecordKind};
use crate::store::journal::payload::encode_payload;
use crate::store::journal::reader::JournalRecord;
use crate::store::journal::txn_json::encode_txn;
use crate::store::layout::NotebookKey;
use crate::time::Clock;

mod files;
mod page;
mod shared;
mod tree;
mod tree_journal;
mod worker;

use shared::{PageShared, TreeShared};
use worker::{Command, Worker};

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
    commands: Sender<Command>,
    codec: Arc<dyn Codec>,
    thread: Option<JoinHandle<()>>,
    /// How long an open waits for the thread's answer: [`OPEN_TIMEOUT`], shorter in tests.
    open_wait: Duration,
}

/// A page's journal, held by its page session.
pub struct JournalHandle {
    id: u64,
    commands: Sender<Command>,
    shared: Arc<PageShared>,
    codec: Arc<dyn Codec>,
    closed: bool,
}

/// The base snapshot of a new generation: the exact bytes of `page.json` at a revision, gzipped.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BaseSnapshot {
    /// The revision.
    pub revision: RevisionId,
    /// The gzip of its `page.json` bytes.
    pub gzip: Arc<[u8]>,
}

impl BaseSnapshot {
    /// The base snapshot of these exact `page.json` bytes.
    pub fn of(revision: RevisionId, page_json: &[u8]) -> BaseSnapshot {
        BaseSnapshot {
            revision,
            gzip: Arc::from(crate::format::gzip::gzip(page_json)),
        }
    }
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
    /// The page's section, so recovery can create a lost page again where it was. `None` for a tree journal.
    pub section: Option<SectionId>,
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
    key: NotebookKey,
    commands: Sender<Command>,
    shared: Arc<TreeShared>,
    codec: Arc<dyn Codec>,
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

/// How long opening a journal waits for the journal thread. The thread answers in milliseconds; a longer wait
/// means it is stuck, and the page then runs without a journal (spec 20.12) instead of holding its lock, and
/// every command behind it, forever. It is shorter than the app's `COMMAND_WAIT` (15 s in core_bridge.rs): an
/// open stuck here holds the core, and it must give up before the commands queued behind it do, so they run
/// instead of failing as busy.
const OPEN_TIMEOUT: Duration = Duration::from_secs(10);

impl JournalThread {
    /// Starts the thread.
    pub fn start(config: JournalConfig) -> Result<JournalThread, CoreError> {
        let (commands, receiver) = mpsc::channel();
        let codec = config.codec.clone();
        let root = config.root.clone();
        let worker = Worker::new(config);
        let thread = std::thread::Builder::new()
            .name("opennote-journal".into())
            .spawn(move || worker.run(&receiver))
            .map_err(|_| CoreError::Fs(FsError::new(FsErrorKind::Io, root)))?;
        Ok(JournalThread {
            commands,
            codec,
            thread: Some(thread),
            open_wait: OPEN_TIMEOUT,
        })
    }

    /// Opens a page's journal. The generation file is created at the first append. Numbers continue after
    /// the page's existing generations, which recovery must have handled first (spec 20.4).
    pub fn open_page(
        &self,
        key: &NotebookKey,
        page: PageId,
        meta: JournalMeta,
        base: BaseSnapshot,
    ) -> Result<JournalHandle, JournalError> {
        let (reply, answer) = mpsc::channel();
        let command = Command::OpenPage {
            key: key.clone(),
            page,
            meta,
            base,
            reply,
        };
        self.commands.send(command).map_err(|_| JournalError::Closed)?;
        let (id, shared) = answer
            .recv_timeout(self.open_wait)
            .map_err(|_| JournalError::Timeout)??;
        Ok(JournalHandle {
            id,
            commands: self.commands.clone(),
            shared,
            codec: self.codec.clone(),
            closed: false,
        })
    }

    /// Opens a notebook's tree journal, with the unfinished intents its generations hold.
    pub fn open_tree(&self, key: &NotebookKey, meta: JournalMeta) -> Result<TreeJournal, JournalError> {
        let (reply, answer) = mpsc::channel();
        let command = Command::OpenTree {
            key: key.clone(),
            meta,
            reply,
        };
        self.commands.send(command).map_err(|_| JournalError::Closed)?;
        let shared = answer
            .recv_timeout(self.open_wait)
            .map_err(|_| JournalError::Timeout)??;
        Ok(TreeJournal {
            key: key.clone(),
            commands: self.commands.clone(),
            shared,
            codec: self.codec.clone(),
        })
    }

    /// Flushes every journal, waiting at most `timeout`. Fails when a journal can't be written.
    pub fn flush_all(&self, timeout: Duration) -> Result<(), JournalError> {
        let (reply, answer) = mpsc::channel();
        self.commands
            .send(Command::Flush { reply })
            .map_err(|_| JournalError::Closed)?;
        answer.recv_timeout(timeout).map_err(|_| JournalError::Timeout)?
    }

    /// Flushes everything and stops the thread. Journals stay on disk for pages that are still open.
    pub fn shutdown(mut self, timeout: Duration) {
        let (reply, answer) = mpsc::channel();
        if self.commands.send(Command::Shutdown { reply }).is_ok() && answer.recv_timeout(timeout).is_ok() {
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }
}

impl JournalHandle {
    /// Appends a transaction and returns its sequence number. It survives an app crash from now on.
    pub fn append_txn(&self, txn: &Txn) -> u64 {
        let (json, blob) = encode_txn(txn, &*self.codec);
        self.append(RecordKind::Txn, &json, &blob)
    }

    /// Appends a progress copy of a stroke still being drawn.
    pub fn append_ink_progress(&self, stroke: &Stroke) -> u64 {
        let record = JournalRecord::InkProgress {
            seq: 0,
            stroke: Arc::new(stroke.clone()),
        };
        let payload = encode_payload(&record, &*self.codec);
        self.append(RecordKind::InkProgress, &payload.json, &payload.blob)
    }

    fn append(&self, kind: RecordKind, json: &[u8], blob: &[u8]) -> u64 {
        let mut seq = self.shared.seq();
        *seq = seq.saturating_add(1);
        let bytes = encode_record(*seq, kind, json, blob);
        self.shared.add_bytes(bytes.len() as u64);
        let command = Command::Append {
            id: self.id,
            seq: *seq,
            bytes,
            edit: true,
        };
        if self.commands.send(command).is_err() {
            self.shared.health.close();
        }
        *seq
    }

    /// Appends and flushes `SaveBegin` (step S6).
    pub fn save_begin(&self, revision: RevisionId, through_seq: u64, timeout: Duration) -> Result<(), JournalError> {
        let (reply, answer) = mpsc::channel();
        {
            let mut seq = self.shared.seq();
            *seq = seq.saturating_add(1);
            let record = JournalRecord::SaveBegin {
                seq: *seq,
                revision,
                through_seq,
            };
            let command = Command::SaveBegin {
                id: self.id,
                seq: *seq,
                bytes: encode(&record, &*self.codec),
                reply,
            };
            self.commands.send(command).map_err(|_| JournalError::Closed)?;
        }
        answer.recv_timeout(timeout).map_err(|_| JournalError::Timeout)?
    }

    /// Tells the journal a save finished, so it may rotate after a confirmed one (spec 20.9).
    pub fn after_save(&self, durability: Durability, base: BaseSnapshot, through_seq: u64) {
        let command = Command::AfterSave {
            id: self.id,
            durability,
            base,
            through: through_seq,
        };
        let _ = self.commands.send(command);
    }

    /// Closes the page's journal: deletes it after a confirmed final save, or parks it (spec 20.9).
    pub fn close(mut self, last_save: Option<(RevisionId, Durability)>) {
        self.closed = true;
        let _ = self.commands.send(Command::Close { id: self.id, last_save });
    }

    /// The highest sequence number flushed to disk.
    pub fn durable_seq(&self) -> u64 {
        self.shared.health.durable()
    }

    /// Waits until `seq` is flushed. Fails at once when the journal can't be written.
    pub fn wait_durable(&self, seq: u64, timeout: Duration) -> Result<(), JournalError> {
        self.shared.health.wait(seq, timeout)
    }

    /// Bytes journaled since the last save, for the 4 MiB rule.
    pub fn bytes_since_save(&self) -> u64 {
        self.shared.bytes_since_save()
    }

    /// Whether the journal can't be written.
    pub fn degraded(&self) -> bool {
        self.shared.health.degraded()
    }
}

impl Drop for JournalHandle {
    /// A handle dropped without `close` keeps its generations, flushed, for recovery.
    fn drop(&mut self) {
        if !self.closed {
            let _ = self.commands.send(Command::Detach { id: self.id });
        }
    }
}

#[cfg(test)]
mod tests;
