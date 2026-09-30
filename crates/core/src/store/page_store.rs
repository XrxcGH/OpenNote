//! Loading and saving pages (plan 8.1, spec 17.7). Owned by WP4.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use crate::error::{CoreError, FormatError, FsError, JournalError};
use crate::format::DamagedRecord;
use crate::id::{AssetId, RevisionId};
use crate::limits::Limits;
use crate::model::{DeviceRef, InkRecord, Page, Revision, SegmentRef, Stroke};
use crate::seams::{Codec, LinkResolver};
use crate::session::journal_thread::JournalHandle;
use crate::store::compact::CompactionPlan;
use crate::store::fs::{Durability, FileStamp, Fs};
use crate::time::Clock;

/// What a page store needs.
#[derive(Clone)]
pub struct PageStoreConfig {
    /// The file system.
    pub fs: Arc<dyn Fs>,
    /// The codec.
    pub codec: Arc<dyn Codec>,
    /// The clock for revisions.
    pub clock: Arc<dyn Clock>,
    /// This device, for revisions.
    pub device: DeviceRef,
    /// The app and version, such as `OpenNote 0.4.0 (windows)`.
    pub writer: String,
    /// The limits every read is checked against.
    pub limits: Limits,
}

/// Reads and writes page folders.
pub struct PageStore {
    /// What the store works with.
    pub config: PageStoreConfig,
}

/// A page as loaded, with what it found on disk.
#[derive(Clone, Debug)]
pub struct LoadedPage {
    /// The page, with its live ink.
    pub page: Page,
    /// The fingerprint of `page.json`.
    pub stamp: FileStamp,
    /// The exact bytes of `page.json`, for the envelope and the journal's base snapshot.
    pub bytes: Arc<[u8]>,
    /// Records that failed their checks.
    pub damaged: Vec<DamagedRecord>,
    /// Segments and assets that are listed but not on disk.
    pub missing: Vec<PathBuf>,
}

/// Why a page couldn't be loaded.
#[derive(Clone, Debug, PartialEq)]
pub enum LoadError {
    /// No `page.json`.
    Missing,
    /// `page.json` failed to read or validate.
    Damaged(FormatError),
    /// A newer version wrote it, and this reader can't show it.
    NewerFormat(u32),
    /// The file can't be read now, such as an offline drive.
    Unavailable(FsError),
}

/// What to save.
pub struct SaveRequest<'a> {
    /// A snapshot of the page.
    pub page: &'a Page,
    /// The ink records since the last save.
    pub pending: &'a [InkRecord],
    /// The last journal sequence number the snapshot includes.
    pub through_seq: u64,
    /// The fingerprint of `page.json` when it was last read or written.
    pub base_stamp: Option<FileStamp>,
    /// The page's journal, for the `SaveBegin` record. `None` for writers without a journal.
    pub journal: Option<&'a JournalHandle>,
    /// Whether to compact the ink, and how.
    pub compaction: CompactionPlan,
}

/// What a save did.
#[derive(Clone, Debug)]
pub struct SaveOutcome {
    /// The new revision.
    pub revision: Revision,
    /// Whether the replace of `page.json` is confirmed on disk.
    pub durability: Durability,
    /// The new fingerprint.
    pub stamp: FileStamp,
    /// The new segment list.
    pub segments: Vec<SegmentRef>,
    /// Dead bytes after the save.
    pub dead_bytes: u64,
    /// The exact bytes written.
    pub bytes: Arc<[u8]>,
}

/// Why a save failed. The page stays dirty, and every edit stays in memory and in the journal.
#[derive(Clone, Debug, PartialEq)]
pub enum SaveError {
    /// A file system call failed.
    Fs(FsError),
    /// `page.json` changed on disk (spec 14.1). `disk` is the revision found there, if it could be read.
    External {
        /// The revision on disk.
        disk: Option<RevisionId>,
    },
    /// The written bytes didn't read back as the snapshot.
    Serializer(String),
    /// An asset the page refers to is missing.
    MissingAsset(AssetId),
    /// The journal couldn't record `SaveBegin`.
    Journal(JournalError),
}

/// What happened to a readable copy (spec 11.2).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReadableOutcome {
    /// It was written.
    Written,
    /// It was already current, so nothing was written.
    Unchanged,
    /// A person edited it. The edited copy was kept here, and a new one written.
    EditedCopyKept(PathBuf),
}

impl PageStore {
    /// A store with this configuration.
    pub fn new(_config: PageStoreConfig) -> PageStore {
        unimplemented!("WP4: PageStore::new")
    }

    /// Loads `page.json` and every segment, and replays the ink. Never reads `page.md`.
    pub fn load(&self, _dir: &Path) -> Result<LoadedPage, LoadError> {
        unimplemented!("WP4: PageStore::load")
    }

    /// Runs steps S2 to S9 of spec 17.7.
    pub fn save(&self, _dir: &Path, _req: SaveRequest<'_>) -> Result<SaveOutcome, SaveError> {
        unimplemented!("WP4: PageStore::save")
    }

    /// The fingerprint of `page.json`, or `None` if it is missing.
    pub fn fingerprint(&self, _dir: &Path) -> Result<Option<FileStamp>, FsError> {
        unimplemented!("WP4: PageStore::fingerprint")
    }

    /// Writes `page.md` if it is stale, following spec 11.2.
    pub fn write_page_md(
        &self,
        _dir: &Path,
        _page: &Page,
        _links: &dyn LinkResolver,
    ) -> Result<ReadableOutcome, FsError> {
        unimplemented!("WP4: PageStore::write_page_md")
    }

    /// Writes `ink.svg` if it is stale, following spec 11.2.
    pub fn write_ink_svg(&self, _dir: &Path, _page: &Page) -> Result<ReadableOutcome, FsError> {
        unimplemented!("WP4: PageStore::write_ink_svg")
    }

    /// Sync-tool conflict copies of `page.json` in the page folder (spec 14.2).
    pub fn conflict_copies(&self, _dir: &Path) -> Result<Vec<PathBuf>, FsError> {
        unimplemented!("WP4: PageStore::conflict_copies")
    }

    /// Moves a conflict copy into `.conflicts/`, returning its revision if it is a real divergence.
    pub fn absorb_conflict_copy(&self, _dir: &Path, _copy: &Path) -> Result<Option<RevisionId>, CoreError> {
        unimplemented!("WP4: PageStore::absorb_conflict_copy")
    }

    /// Keeps another version of `page.json` in `.conflicts/`.
    pub fn keep_conflict(&self, _dir: &Path, _theirs: &[u8]) -> Result<RevisionId, CoreError> {
        unimplemented!("WP4: PageStore::keep_conflict")
    }

    /// Moves a file that failed to read into `.damaged/`.
    pub fn move_damaged(&self, _dir: &Path, _file_name: &str) -> Result<PathBuf, FsError> {
        unimplemented!("WP4: PageStore::move_damaged")
    }

    /// Repairs damaged ink from other segments and the journal (spec 9.6).
    pub fn repair_ink(&self, _dir: &Path, _page: &Page, _from_journal: &[Arc<Stroke>]) -> Result<Page, CoreError> {
        unimplemented!("WP4: PageStore::repair_ink")
    }
}
