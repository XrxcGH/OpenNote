//! A backend on the registry codec with a journal in memory, for tests of sessions and the Core API.
//!
//! Pages are read and written with the journal-less page writer of `store::notebook_store`, history keeps
//! gzipped snapshots and `versions.json`, and the journal numbers records and keeps them in memory. Tests can
//! make saves fail with a chosen error kind and make the journal degraded.

use std::collections::HashMap;
use std::ops::Range;
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;

use sha2::{Digest, Sha256};

use super::{Backend, PageJournal, RecoverInput, SaveInput, VersionToWrite};
use crate::error::{CoreError, FormatError, FormatErrorKind, FsError, FsErrorKind, JournalError};
use crate::format::gzip::{gunzip, gzip};
use crate::format::names::asset_file_name;
use crate::format::ReadPage;
use crate::id::{AssetId, PageId, RevisionId};
use crate::limits::Limits;
use crate::model::{Asset, DeviceRef, JsonMap, Named, Page, Revision, Stroke, VersionEntry, VersionsFile};
use crate::ops::Txn;
use crate::seams::{Codec, LinkResolver};
use crate::session::events::RecoveryOutcome;
use crate::session::journal_thread::{BaseSnapshot, JournalMeta};
use crate::store::assets::{AssetSource, ImportCtx};
use crate::store::external::ExternalDecision;
use crate::store::fs::{Durability, FileStamp, Fs};
use crate::store::history::{Retention, ThinReport};
use crate::store::journal::reader::KeyJournals;
use crate::store::layout::{NotebookKey, NotebookLayout, ASSETS_DIR, CONFLICTS_DIR, PAGE_MD};
use crate::store::lock::ensure_dir_all;
use crate::store::notebook_store::{next_revision, read_page_files, write_page_files};
use crate::store::page_store::{LoadError, LoadedPage, SaveError, SaveOutcome};
use crate::store::tree_log::{IntentLog, MemIntentLog};
use crate::store::verify::VerifyReport;
use crate::store::PageFiles;
use crate::time::{Clock, Timestamp};

/// What the in-memory journal received, for assertions.
#[derive(Clone, Debug, Default)]
pub struct JournalLog {
    /// Each transaction's page, sequence number, and transaction.
    pub txns: Vec<(PageId, u64, Txn)>,
    /// Each progress record's page and sequence number.
    pub progress: Vec<(PageId, u64)>,
    /// Pages whose journal closed, with the final save if there was one.
    pub closed: Vec<(PageId, Option<RevisionId>)>,
    /// Saves reported to the journal, with the sequence number each covers.
    pub saves: Vec<(PageId, u64)>,
    /// How many times every journal was flushed.
    pub flushes: u32,
}

#[derive(Default)]
struct JournalState {
    log: Mutex<JournalLog>,
    degraded: AtomicBool,
    refuse: AtomicBool,
}

impl JournalState {
    fn log(&self) -> MutexGuard<'_, JournalLog> {
        self.log.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// The in-memory backend.
pub struct MemBackend {
    fs: Arc<dyn Fs>,
    codec: Arc<dyn Codec>,
    clock: Arc<dyn Clock>,
    device: DeviceRef,
    writer: String,
    limits: Limits,
    trees: Mutex<HashMap<NotebookKey, MemIntentLog>>,
    journal: Arc<JournalState>,
    fail_saves: Mutex<Option<FsErrorKind>>,
}

impl MemBackend {
    /// A backend on `fs` and `codec`.
    pub fn new(fs: Arc<dyn Fs>, codec: Arc<dyn Codec>, clock: Arc<dyn Clock>, device: DeviceRef) -> MemBackend {
        MemBackend {
            fs,
            codec,
            clock,
            device,
            writer: "OpenNote test".to_owned(),
            limits: Limits::default(),
            trees: Mutex::default(),
            journal: Arc::default(),
            fail_saves: Mutex::default(),
        }
    }

    /// What the journal received so far.
    pub fn journal_log(&self) -> JournalLog {
        self.journal.log().clone()
    }

    /// Makes every save fail with `kind` until called with `None`.
    pub fn fail_saves(&self, kind: Option<FsErrorKind>) {
        *self.fail_saves.lock().unwrap_or_else(PoisonError::into_inner) = kind;
    }

    /// Makes journals report that they can't be written.
    pub fn degrade_journal(&self, degraded: bool) {
        self.journal.degraded.store(degraded, Ordering::SeqCst);
    }

    /// Makes opening a page journal fail, as with a full system drive.
    pub fn refuse_journals(&self, refuse: bool) {
        self.journal.refuse.store(refuse, Ordering::SeqCst);
    }

    fn files<'a>(&'a self, dir: &'a Path) -> PageFiles<'a> {
        PageFiles {
            fs: self.fs.as_ref(),
            codec: self.codec.as_ref(),
            dir,
        }
    }

    fn check_base(&self, dir: &Path, base: Option<FileStamp>) -> Result<(), SaveError> {
        let Some(base) = base else { return Ok(()) };
        let now = self.fingerprint(dir).map_err(SaveError::Fs)?;
        if now == Some(base) {
            return Ok(());
        }
        let disk = read_page_files(self.fs.as_ref(), self.codec.as_ref(), dir, &self.limits)
            .ok()
            .map(|loaded| loaded.page.revision.id);
        Err(SaveError::External { disk })
    }
}

struct MemPageJournal {
    page: PageId,
    state: Arc<JournalState>,
    seq: AtomicU64,
    since_save: AtomicU64,
}

impl PageJournal for MemPageJournal {
    fn append_txn(&self, txn: &Txn) -> u64 {
        let seq = self.seq.fetch_add(1, Ordering::SeqCst).saturating_add(1);
        let size = u64::try_from(txn.ops.len()).unwrap_or(0).saturating_mul(64);
        self.since_save.fetch_add(size.max(64), Ordering::SeqCst);
        self.state.log().txns.push((self.page, seq, txn.clone()));
        seq
    }

    fn append_ink_progress(&self, stroke: &Stroke) -> u64 {
        let seq = self.seq.fetch_add(1, Ordering::SeqCst).saturating_add(1);
        self.since_save.fetch_add(stroke.record_len(), Ordering::SeqCst);
        self.state.log().progress.push((self.page, seq));
        seq
    }

    fn after_save(&self, _durability: Durability, _base: BaseSnapshot, through_seq: u64) {
        self.since_save.store(0, Ordering::SeqCst);
        self.state.log().saves.push((self.page, through_seq));
    }

    fn close(self: Box<Self>, last_save: Option<(RevisionId, Durability)>) {
        self.state.log().closed.push((self.page, last_save.map(|s| s.0)));
    }

    fn durable_seq(&self) -> u64 {
        self.seq.load(Ordering::SeqCst)
    }

    fn wait_durable(&self, seq: u64, _timeout: Duration) -> Result<(), JournalError> {
        if seq <= self.durable_seq() {
            Ok(())
        } else {
            Err(JournalError::Timeout)
        }
    }

    fn bytes_since_save(&self) -> u64 {
        self.since_save.load(Ordering::SeqCst)
    }

    fn degraded(&self) -> bool {
        self.state.degraded.load(Ordering::SeqCst)
    }
}

impl Backend for MemBackend {
    fn open_page_journal(
        &self,
        _key: &NotebookKey,
        page: PageId,
        _meta: JournalMeta,
        _base: BaseSnapshot,
    ) -> Result<Box<dyn PageJournal>, JournalError> {
        if self.journal.refuse.load(Ordering::SeqCst) {
            return Err(JournalError::Degraded(FsError::new(FsErrorKind::DiskFull, "journal")));
        }
        Ok(Box::new(MemPageJournal {
            page,
            state: self.journal.clone(),
            seq: AtomicU64::new(0),
            since_save: AtomicU64::new(0),
        }))
    }

    fn open_tree_journal(&self, key: &NotebookKey, _meta: JournalMeta) -> Result<Box<dyn IntentLog>, JournalError> {
        let mut trees = self.trees.lock().unwrap_or_else(PoisonError::into_inner);
        Ok(Box::new(trees.entry(key.clone()).or_default().clone()))
    }

    fn flush_journals(&self, _timeout: Duration) -> Result<(), JournalError> {
        let mut log = self.journal.log();
        log.flushes = log.flushes.saturating_add(1);
        Ok(())
    }

    fn shutdown(&self, _timeout: Duration) {}

    fn journals(&self) -> Result<Vec<KeyJournals>, FsError> {
        Ok(Vec::new())
    }

    fn recover_page(&self, _input: &RecoverInput<'_>) -> Result<RecoveryOutcome, CoreError> {
        Ok(RecoveryOutcome::Nothing)
    }

    fn load(&self, dir: &Path) -> Result<LoadedPage, LoadError> {
        read_page_files(self.fs.as_ref(), self.codec.as_ref(), dir, &self.limits)
    }

    fn save(&self, dir: &Path, input: SaveInput<'_>) -> Result<SaveOutcome, SaveError> {
        if let Some(kind) = *self.fail_saves.lock().unwrap_or_else(PoisonError::into_inner) {
            return Err(SaveError::Fs(FsError::new(kind, dir)));
        }
        self.check_base(dir, input.base_stamp)?;
        let revision = next_revision(input.page, self.clock.as_ref(), &self.device, &self.writer);
        let written =
            write_page_files(&self.files(dir), self.clock.as_ref(), input.page, revision).map_err(|e| match e {
                CoreError::Fs(e) => SaveError::Fs(e),
                other => SaveError::Serializer(other.to_string()),
            })?;
        Ok(SaveOutcome {
            revision: written.revision,
            durability: written.durability,
            stamp: written.stamp,
            segments: written.segments,
            dead_bytes: input.page.ink.dead_bytes(),
            bytes: written.bytes,
        })
    }

    fn fingerprint(&self, dir: &Path) -> Result<Option<FileStamp>, FsError> {
        match self.fs.metadata(&NotebookLayout::page_json(dir)) {
            Ok(meta) => Ok(Some(meta.stamp)),
            Err(e) if e.kind == FsErrorKind::NotFound => Ok(None),
            Err(e) => Err(e),
        }
    }

    fn write_readable(&self, dir: &Path, page: &Page, links: &dyn LinkResolver) -> Result<(), FsError> {
        self.fs
            .write_derived(&dir.join(PAGE_MD), &self.codec.render_page_md(page, links))
    }

    fn keep_conflict(&self, dir: &Path, theirs: &[u8]) -> Result<RevisionId, CoreError> {
        let read = self.codec.read_page(theirs, &self.limits)?;
        let revision = read.page.revision.id;
        let path = NotebookLayout::conflict_path(dir, revision);
        ensure_dir_all(self.fs.as_ref(), &dir.join(CONFLICTS_DIR))?;
        match self.fs.create_durable(&path, theirs) {
            Ok(_) => Ok(revision),
            Err(e) if e.kind == FsErrorKind::AlreadyExists => Ok(revision),
            Err(e) => Err(e.into()),
        }
    }

    fn absorb_conflict_copies(&self, _dir: &Path) -> Result<Vec<RevisionId>, CoreError> {
        Ok(Vec::new())
    }

    fn repair_ink(&self, _dir: &Path, page: &Page) -> Result<Page, CoreError> {
        let mut repaired = page.clone();
        repaired.format.access = crate::model::Access::ReadWrite;
        Ok(repaired)
    }

    fn classify_change(&self, disk: &Revision, base: RevisionId, own: &Revision, dirty: bool) -> ExternalDecision {
        if disk.id == own.id || disk.id == base {
            ExternalDecision::Unchanged
        } else if own.ancestors.contains(&disk.id) {
            ExternalDecision::OlderOfOurs
        } else if !dirty {
            ExternalDecision::FastForward
        } else {
            ExternalDecision::Conflict
        }
    }

    fn write_version(&self, version: VersionToWrite<'_>) -> Result<(), CoreError> {
        let revision = &version.page.revision;
        let path = NotebookLayout::version_path(version.dir, revision.id);
        if let Some(parent) = path.parent() {
            ensure_dir_all(self.fs.as_ref(), parent)?;
        }
        let snapshot = gzip(version.bytes);
        match self.fs.create_durable(&path, &snapshot) {
            Ok(_) => {}
            Err(e) if e.kind == FsErrorKind::AlreadyExists => {}
            Err(e) => return Err(e.into()),
        }
        let mut file = self.list_versions(version.dir)?;
        let named = version.name.is_some();
        match file.versions.iter_mut().find(|v| v.revision == revision.id) {
            Some(entry) if named => entry.name = version.name,
            Some(_) => return Ok(()),
            None => file.versions.push(VersionEntry {
                revision: revision.id,
                saved_at: revision.saved_at,
                reason: Named::Known(version.reason),
                name: version.name,
                keep: false,
                device: revision.device.clone(),
                bytes: u64::try_from(snapshot.len()).unwrap_or(u64::MAX),
                segments: version.page.ink.segments().iter().map(|s| s.id).collect(),
                assets: version.page.assets.keys().copied().collect(),
                extra: JsonMap::new(),
            }),
        }
        let bytes = self.codec.write_versions(&file);
        self.fs
            .replace_durable(&NotebookLayout::versions_json(version.dir), &bytes)?;
        Ok(())
    }

    fn list_versions(&self, dir: &Path) -> Result<VersionsFile, CoreError> {
        match self
            .fs
            .read(&NotebookLayout::versions_json(dir), self.limits.page_json_bytes)
        {
            Ok(bytes) => Ok(self.codec.read_versions(&bytes, &self.limits)?),
            Err(e) if e.kind == FsErrorKind::NotFound => Ok(VersionsFile {
                page: dir
                    .file_name()
                    .and_then(|n| PageId::parse(&n.to_string_lossy()).ok())
                    .unwrap_or_default(),
                versions: Vec::new(),
                extra: JsonMap::new(),
                format: crate::model::FormatInfo::default(),
            }),
            Err(e) => Err(e.into()),
        }
    }

    fn open_version(&self, dir: &Path, rev: RevisionId) -> Result<ReadPage, CoreError> {
        let bytes = self
            .fs
            .read(&NotebookLayout::version_path(dir, rev), self.limits.page_json_bytes)?;
        let page_json = gunzip(&bytes, self.limits.gunzip_bytes)?;
        Ok(self.codec.read_page(&page_json, &self.limits)?)
    }

    fn delete_history(&self, _dir: &Path, _keep_named: bool) -> Result<ThinReport, CoreError> {
        Ok(ThinReport::default())
    }

    fn tidy_page(&self, _dir: &Path, _now: Timestamp, _keep: Retention) -> Result<(), CoreError> {
        Ok(())
    }

    fn import_asset(&self, dir: &Path, source: AssetSource, ctx: &ImportCtx<'_>) -> Result<Asset, CoreError> {
        let (name, mime, bytes, claimed) = match source {
            AssetSource::Bytes {
                name,
                mime,
                bytes,
                image,
            } => (name, mime, bytes, image),
            AssetSource::Path { path, image } => {
                let name = path
                    .file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default();
                let bytes = self.fs.read(&path, u64::MAX)?;
                (name, "application/octet-stream".to_owned(), bytes, image)
            }
        };
        crate::store::assets::check_declared_type(&bytes, &mime)?;
        let size = crate::store::assets::picture_size(&bytes, &mime, claimed);
        let sha256: [u8; 32] = Sha256::digest(&bytes).into();
        if let Some(existing) = ctx.existing.values().find(|a| a.sha256 == sha256) {
            return Ok(existing.clone());
        }
        let id = AssetId::generate(ctx.clock);
        let file = asset_file_name(id, &name, &mime);
        ensure_dir_all(self.fs.as_ref(), &dir.join(ASSETS_DIR))?;
        self.fs.create_durable(&dir.join(ASSETS_DIR).join(&file), &bytes)?;
        let len = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
        (ctx.progress)(len, len);
        Ok(Asset {
            id,
            file,
            mime,
            bytes: len,
            sha256,
            name,
            width: size.map(|(w, _)| w),
            height: size.map(|(_, h)| h),
            created: ctx.clock.now(),
            extra: JsonMap::new(),
        })
    }

    fn read_asset(&self, dir: &Path, asset: &Asset, range: Option<Range<u64>>) -> Result<Vec<u8>, FsError> {
        let path = NotebookLayout::asset_path(dir, asset).map_err(|_| FsError::new(FsErrorKind::NotFound, dir))?;
        match range {
            Some(range) => self.fs.read_range(&path, range),
            None => self.fs.read(&path, asset.bytes.saturating_add(1)),
        }
    }

    fn verify(&self, _root: &Path) -> Result<VerifyReport, CoreError> {
        Ok(VerifyReport::default())
    }
}

/// A format error for a value the in-memory backend can't handle.
#[allow(dead_code)]
fn unsupported(what: &str) -> CoreError {
    FormatError::new(FormatErrorKind::Validation, what.to_owned()).into()
}
