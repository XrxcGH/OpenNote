//! The storage behind sessions: the page store, history, assets, recovery, and the journal thread, behind one
//! seam. Owned by WP5.
//!
//! [`StoreBackend`] is the production backend. It forwards to the page store, history, assets, recovery, and
//! journal code of `store` and `session::journal_thread`. [`mem::MemBackend`] is a small backend on the
//! registry codec, with a journal in memory, so sessions, autosave, and the Core API can be tested on their
//! own. Sessions only ever talk to a [`Backend`].

use std::ops::Range;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use crate::error::{CoreError, FsError, JournalError};
use crate::format::ReadPage;
use crate::id::{PageId, RevisionId};
use crate::limits::{Limits, Timings};
use crate::model::{Asset, DeviceRef, Page, Revision, Stroke, VersionReason, VersionsFile};
use crate::ops::Txn;
use crate::seams::{Applier, Codec, LinkResolver};
use crate::session::events::{EventSink, RecoveryOutcome};
use crate::session::journal_thread::{BaseSnapshot, JournalConfig, JournalHandle, JournalMeta, JournalThread};
use crate::store::assets::{AssetSource, ImportCtx};
use crate::store::external::{classify_change, ExternalDecision};
use crate::store::fs::{Durability, FileStamp, FolderIdentity, Fs};
use crate::store::gc::RefSet;
use crate::store::history::{self, Retention, ThinReport};
use crate::store::journal::format::decode_header;
use crate::store::journal::reader::{list_journals, KeyJournals};
use crate::store::layout::{DataLayout, NotebookKey, NotebookLayout};
use crate::store::page_store::{
    LoadError, LoadedPage, PageStore, PageStoreConfig, SaveError, SaveOutcome, SaveRequest,
};
use crate::store::recovery::{recover_page, RecoverCtx};
use crate::store::tree_log::IntentLog;
use crate::store::verify::{verify_notebook, VerifyReport};
use crate::store::PageFiles;
use crate::time::{Clock, Timestamp};

#[cfg(any(test, feature = "testing"))]
pub mod mem;
#[cfg(test)]
mod tests;

/// A page's journal, as a page session uses it.
pub trait PageJournal: Send + Sync {
    /// Appends a transaction and returns its sequence number.
    fn append_txn(&self, txn: &Txn) -> u64;
    /// Appends a progress copy of a stroke still being drawn.
    fn append_ink_progress(&self, stroke: &Stroke) -> u64;
    /// Tells the journal a save finished, so it may rotate after a confirmed one (spec 20.9).
    fn after_save(&self, durability: Durability, base: BaseSnapshot, through_seq: u64);
    /// Closes the journal: deletes it after a confirmed final save, or parks it.
    fn close(self: Box<Self>, last_save: Option<(RevisionId, Durability)>);
    /// The highest sequence number on disk.
    fn durable_seq(&self) -> u64;
    /// Waits until `seq` is on disk.
    fn wait_durable(&self, seq: u64, timeout: Duration) -> Result<(), JournalError>;
    /// Bytes journaled since the last save, for the 4 MiB rule.
    fn bytes_since_save(&self) -> u64;
    /// Whether the journal can't be written.
    fn degraded(&self) -> bool;
    /// The journal thread's handle, which the page store needs for `SaveBegin`.
    fn handle(&self) -> Option<&JournalHandle> {
        None
    }
}

impl PageJournal for JournalHandle {
    fn append_txn(&self, txn: &Txn) -> u64 {
        JournalHandle::append_txn(self, txn)
    }

    fn append_ink_progress(&self, stroke: &Stroke) -> u64 {
        JournalHandle::append_ink_progress(self, stroke)
    }

    fn after_save(&self, durability: Durability, base: BaseSnapshot, through_seq: u64) {
        JournalHandle::after_save(self, durability, base, through_seq);
    }

    fn close(self: Box<Self>, last_save: Option<(RevisionId, Durability)>) {
        JournalHandle::close(*self, last_save);
    }

    fn durable_seq(&self) -> u64 {
        JournalHandle::durable_seq(self)
    }

    fn wait_durable(&self, seq: u64, timeout: Duration) -> Result<(), JournalError> {
        JournalHandle::wait_durable(self, seq, timeout)
    }

    fn bytes_since_save(&self) -> u64 {
        JournalHandle::bytes_since_save(self)
    }

    fn degraded(&self) -> bool {
        JournalHandle::degraded(self)
    }

    fn handle(&self) -> Option<&JournalHandle> {
        Some(self)
    }
}

/// What a save of a page session hands the backend.
pub struct SaveInput<'a> {
    /// A snapshot of the page, with its pending ink records.
    pub page: &'a Page,
    /// The last journal sequence number the snapshot includes.
    pub through_seq: u64,
    /// The fingerprint of `page.json` when it was last read or written.
    pub base_stamp: Option<FileStamp>,
    /// The page's journal, for `SaveBegin`.
    pub journal: Option<&'a dyn PageJournal>,
}

/// What recovery of one page needs from the notebook.
pub struct RecoverInput<'a> {
    /// The notebook's layout.
    pub layout: &'a NotebookLayout,
    /// The notebook folder's identity.
    pub identity: &'a FolderIdentity,
    /// Finds a page folder by ID, in any section or in Trash.
    pub locate: &'a dyn Fn(PageId) -> Option<PathBuf>,
    /// The page.
    pub page: PageId,
    /// Its journal generations, oldest first.
    pub generations: &'a [PathBuf],
}

/// The storage sessions work with.
pub trait Backend: Send + Sync + 'static {
    /// Opens a page's journal. The generation file is created at the first append.
    fn open_page_journal(
        &self,
        key: &NotebookKey,
        page: PageId,
        meta: JournalMeta,
        base: BaseSnapshot,
    ) -> Result<Box<dyn PageJournal>, JournalError>;
    /// Opens a notebook's tree journal.
    fn open_tree_journal(&self, key: &NotebookKey, meta: JournalMeta) -> Result<Box<dyn IntentLog>, JournalError>;
    /// Flushes every journal.
    fn flush_journals(&self, timeout: Duration) -> Result<(), JournalError>;
    /// Flushes and stops the journal.
    fn shutdown(&self, timeout: Duration);
    /// Every notebook key's journal generations.
    fn journals(&self) -> Result<Vec<KeyJournals>, FsError>;
    /// Recovers one page from its journal generations (spec 20.10).
    fn recover_page(&self, input: &RecoverInput<'_>) -> Result<RecoveryOutcome, CoreError>;
    /// Loads a page folder.
    fn load(&self, dir: &Path) -> Result<LoadedPage, LoadError>;
    /// Saves a page folder (steps S2 to S9 of spec 17.7).
    fn save(&self, dir: &Path, input: SaveInput<'_>) -> Result<SaveOutcome, SaveError>;
    /// The fingerprint of `page.json`, or `None` if it is missing.
    fn fingerprint(&self, dir: &Path) -> Result<Option<FileStamp>, FsError>;
    /// Writes `page.md` and `ink.svg` if they are stale (spec 11.2).
    fn write_readable(&self, dir: &Path, page: &Page, links: &dyn LinkResolver) -> Result<(), FsError>;
    /// Keeps another version of `page.json` in `.conflicts/` (spec 14.1).
    fn keep_conflict(&self, dir: &Path, theirs: &[u8]) -> Result<RevisionId, CoreError>;
    /// Moves a file of the page folder that failed to read into `.damaged/`, and returns where it went.
    fn move_damaged(&self, dir: &Path, file_name: &str) -> Result<PathBuf, FsError>;
    /// Moves sync-tool conflict copies into `.conflicts/`. Returns the revisions of real divergences.
    fn absorb_conflict_copies(&self, dir: &Path) -> Result<Vec<RevisionId>, CoreError>;
    /// Repairs damaged ink (spec 9.6).
    fn repair_ink(&self, dir: &Path, page: &Page) -> Result<Page, CoreError>;
    /// What a changed `page.json` means for this device (spec 14.1).
    fn classify_change(&self, disk: &Revision, base: RevisionId, own: &Revision, dirty: bool) -> ExternalDecision;
    /// Saves the exact bytes of `page.json` at a revision as a version (spec 13).
    fn write_version(&self, version: VersionToWrite<'_>) -> Result<(), CoreError>;
    /// The page's versions.
    fn list_versions(&self, dir: &Path) -> Result<VersionsFile, CoreError>;
    /// Reads one version.
    fn open_version(&self, dir: &Path, rev: RevisionId) -> Result<ReadPage, CoreError>;
    /// Thins the history and collects garbage of a page that is not open.
    fn tidy_page(&self, dir: &Path, page: PageId, now: Timestamp, keep: Retention) -> Result<(), CoreError>;
    /// Deletes the saved versions of a page, keeping the named ones when `keep_named` is set.
    fn delete_history(&self, dir: &Path, keep_named: bool) -> Result<ThinReport, CoreError>;
    /// Imports a file as an asset of a page.
    fn import_asset(&self, dir: &Path, source: AssetSource, ctx: &ImportCtx<'_>) -> Result<Asset, CoreError>;
    /// Reads an asset, or a range of it.
    fn read_asset(&self, dir: &Path, asset: &Asset, range: Option<Range<u64>>) -> Result<Vec<u8>, FsError>;
    /// Checks a whole notebook (spec 17.1).
    fn verify(&self, root: &Path) -> Result<VerifyReport, CoreError>;
}

/// A version to save.
pub struct VersionToWrite<'a> {
    /// The page folder.
    pub dir: &'a Path,
    /// The exact bytes of `page.json` at the revision.
    pub bytes: &'a [u8],
    /// The page at that revision.
    pub page: &'a Page,
    /// Why it is kept.
    pub reason: VersionReason,
    /// A name the person gave it.
    pub name: Option<String>,
}

/// What the production backend needs.
#[derive(Clone)]
pub struct StoreConfig {
    /// The file system.
    pub fs: Arc<dyn Fs>,
    /// The codec.
    pub codec: Arc<dyn Codec>,
    /// The applier, for recovery.
    pub applier: Arc<dyn Applier>,
    /// The clock.
    pub clock: Arc<dyn Clock>,
    /// Reader limits.
    pub limits: Limits,
    /// Save and journal timings.
    pub timings: Timings,
    /// This device.
    pub device: DeviceRef,
    /// The app and version, for revisions.
    pub writer: String,
    /// The device-local data folder.
    pub data: DataLayout,
    /// The current boot identifier.
    pub boot: String,
}

/// The production backend: the page store, history, assets, recovery, and the journal thread.
pub struct StoreBackend {
    config: StoreConfig,
    store: PageStore,
    journal: Mutex<Option<JournalThread>>,
}

impl StoreBackend {
    /// Starts the journal thread and makes the page store.
    pub fn start(config: StoreConfig, events: Arc<dyn EventSink>) -> Result<StoreBackend, CoreError> {
        let journal = JournalThread::start(JournalConfig {
            fs: config.fs.clone(),
            codec: config.codec.clone(),
            root: config.data.root.join("journal"),
            clock: config.clock.clone(),
            timings: config.timings.clone(),
            events,
        })?;
        let store = PageStore::new(PageStoreConfig {
            fs: config.fs.clone(),
            codec: config.codec.clone(),
            clock: config.clock.clone(),
            device: config.device.clone(),
            writer: config.writer.clone(),
            limits: config.limits.clone(),
        });
        Ok(StoreBackend {
            config,
            store,
            journal: Mutex::new(Some(journal)),
        })
    }

    fn with_journal<T>(&self, f: impl FnOnce(&JournalThread) -> Result<T, JournalError>) -> Result<T, JournalError> {
        let guard = self.journal.lock().unwrap_or_else(PoisonError::into_inner);
        match guard.as_ref() {
            Some(journal) => f(journal),
            None => Err(JournalError::Closed),
        }
    }

    fn files<'a>(&'a self, dir: &'a Path) -> PageFiles<'a> {
        PageFiles {
            fs: self.config.fs.as_ref(),
            codec: self.config.codec.as_ref(),
            dir,
        }
    }

    /// What the page's journal generations still refer to. Recovery can rebuild the page from their base
    /// snapshots (spec 20.10), which may list segments, assets, and a revision that `page.json` no longer does.
    /// A generation that can't be read fails the call, so nothing is tidied on a guess.
    fn journal_refs(&self, page: PageId) -> Result<(RefSet, Vec<RevisionId>), CoreError> {
        let (fs, limits) = (self.config.fs.as_ref(), &self.config.limits);
        let mut refs = RefSet::default();
        let mut revisions = Vec::new();
        for journals in self.journals()? {
            for path in journals.pages.get(&page).into_iter().flatten() {
                let decoded = decode_header(&fs.read(path, u64::MAX)?, limits.gunzip_bytes)?;
                revisions.push(decoded.header.base);
                if let Some(base) = decoded.base {
                    refs.add_page(&self.config.codec.read_page(&base, limits)?.page);
                }
            }
        }
        Ok((refs, revisions))
    }
}

impl Backend for StoreBackend {
    fn open_page_journal(
        &self,
        key: &NotebookKey,
        page: PageId,
        meta: JournalMeta,
        base: BaseSnapshot,
    ) -> Result<Box<dyn PageJournal>, JournalError> {
        let handle = self.with_journal(|j| j.open_page(key, page, meta, base))?;
        Ok(Box::new(handle))
    }

    fn open_tree_journal(&self, key: &NotebookKey, meta: JournalMeta) -> Result<Box<dyn IntentLog>, JournalError> {
        let tree = self.with_journal(|j| j.open_tree(key, meta))?;
        Ok(Box::new(tree))
    }

    fn flush_journals(&self, timeout: Duration) -> Result<(), JournalError> {
        self.with_journal(|j| j.flush_all(timeout))
    }

    fn shutdown(&self, timeout: Duration) {
        let journal = self.journal.lock().unwrap_or_else(PoisonError::into_inner).take();
        if let Some(journal) = journal {
            journal.shutdown(timeout);
        }
    }

    fn journals(&self) -> Result<Vec<KeyJournals>, FsError> {
        list_journals(self.config.fs.as_ref(), &self.config.data.root.join("journal"))
    }

    fn recover_page(&self, input: &RecoverInput<'_>) -> Result<RecoveryOutcome, CoreError> {
        let recovery_dir = self.config.data.recovery_dir();
        let ctx = RecoverCtx {
            fs: self.config.fs.as_ref(),
            codec: self.config.codec.as_ref(),
            applier: self.config.applier.as_ref(),
            store: &self.store,
            layout: input.layout,
            identity: input.identity,
            boot: &self.config.boot,
            clock: self.config.clock.as_ref(),
            locate: input.locate,
            recovery_dir: &recovery_dir,
        };
        recover_page(&ctx, input.page, input.generations)
    }

    fn load(&self, dir: &Path) -> Result<LoadedPage, LoadError> {
        self.store.load(dir)
    }

    fn save(&self, dir: &Path, input: SaveInput<'_>) -> Result<SaveOutcome, SaveError> {
        let request = SaveRequest {
            page: input.page,
            pending: input.page.ink.pending(),
            through_seq: input.through_seq,
            base_stamp: input.base_stamp,
            journal: input.journal.and_then(|j| j.handle()),
            compaction: crate::store::compact::plan_compaction(&input.page.ink),
        };
        self.store.save(dir, request)
    }

    fn fingerprint(&self, dir: &Path) -> Result<Option<FileStamp>, FsError> {
        self.store.fingerprint(dir)
    }

    fn write_readable(&self, dir: &Path, page: &Page, links: &dyn LinkResolver) -> Result<(), FsError> {
        self.store.write_page_md(dir, page, links)?;
        self.store.write_ink_svg(dir, page)?;
        Ok(())
    }

    fn keep_conflict(&self, dir: &Path, theirs: &[u8]) -> Result<RevisionId, CoreError> {
        self.store.keep_conflict(dir, theirs)
    }

    fn move_damaged(&self, dir: &Path, file_name: &str) -> Result<PathBuf, FsError> {
        self.store.move_damaged(dir, file_name)
    }

    fn absorb_conflict_copies(&self, dir: &Path) -> Result<Vec<RevisionId>, CoreError> {
        let mut found = Vec::new();
        for copy in self.store.conflict_copies(dir)? {
            if let Some(revision) = self.store.absorb_conflict_copy(dir, &copy)? {
                found.push(revision);
            }
        }
        Ok(found)
    }

    fn repair_ink(&self, dir: &Path, page: &Page) -> Result<Page, CoreError> {
        self.store.repair_ink(dir, page, &[])
    }

    fn classify_change(&self, disk: &Revision, base: RevisionId, own: &Revision, dirty: bool) -> ExternalDecision {
        classify_change(disk, base, own, dirty)
    }

    fn write_version(&self, version: VersionToWrite<'_>) -> Result<(), CoreError> {
        let files = self.files(version.dir);
        history::write_version(&files, version.bytes, version.page, version.reason, version.name)
    }

    fn list_versions(&self, dir: &Path) -> Result<VersionsFile, CoreError> {
        history::list_versions(&self.files(dir), &self.config.limits)
    }

    fn open_version(&self, dir: &Path, rev: RevisionId) -> Result<ReadPage, CoreError> {
        history::open_version(&self.files(dir), rev, &self.config.limits)
    }

    fn delete_history(&self, dir: &Path, keep_named: bool) -> Result<ThinReport, CoreError> {
        history::delete_versions(&self.files(dir), keep_named)
    }

    fn tidy_page(&self, dir: &Path, page: PageId, now: Timestamp, keep: Retention) -> Result<(), CoreError> {
        let files = self.files(dir);
        let (refs, protected) = self.journal_refs(page)?;
        history::thin(&files, now, 0, keep, &protected)?;
        crate::store::gc::collect_garbage(&files, &refs, now, self.config.timings.gc_grace)?;
        Ok(())
    }

    fn import_asset(&self, dir: &Path, source: AssetSource, ctx: &ImportCtx<'_>) -> Result<Asset, CoreError> {
        crate::store::assets::import_asset(self.config.fs.as_ref(), dir, source, ctx)
    }

    fn read_asset(&self, dir: &Path, asset: &Asset, range: Option<Range<u64>>) -> Result<Vec<u8>, FsError> {
        crate::store::assets::read_asset(self.config.fs.as_ref(), dir, asset, range)
    }

    fn verify(&self, root: &Path) -> Result<VerifyReport, CoreError> {
        verify_notebook(
            self.config.fs.as_ref(),
            self.config.codec.as_ref(),
            root,
            &self.config.limits,
        )
    }
}
