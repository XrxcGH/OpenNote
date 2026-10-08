//! Loading and saving pages (plan 8.1, spec 17.7). Owned by WP4.

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, PoisonError};

use crate::error::{CoreError, FormatError, FsError, FsErrorKind, JournalError};
use crate::fail_point;
use crate::format::{DamagedRecord, DecodedSegment};
use crate::id::{AssetId, RevisionId};
use crate::limits::Limits;
use crate::model::{DeviceRef, InkRecord, Page, Revision, SegmentRef, Stroke};
use crate::seams::{Codec, LinkResolver};
use crate::session::journal_thread::JournalHandle;
use crate::store::compact::CompactionPlan;
use crate::store::fs::{Durability, FileStamp, Fs};
use crate::store::layout::{NotebookLayout, INK_SVG, PAGE_MD};
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
    /// The segments this store wrote lately, which minor compaction reads instead of the files.
    written: Mutex<VecDeque<WrittenSegment>>,
}

/// A segment this store wrote, with the records in it.
struct WrittenSegment {
    entry: SegmentRef,
    decoded: DecodedSegment,
}

/// How many written segments a store remembers. Minor compaction merges at most a few segments of each page.
const REMEMBERED_SEGMENTS: usize = 32;

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
    pub fn new(config: PageStoreConfig) -> PageStore {
        PageStore {
            config,
            written: Mutex::new(VecDeque::new()),
        }
    }

    /// Remembers a segment this store just wrote and flushed, forgetting the oldest beyond
    /// [`REMEMBERED_SEGMENTS`].
    fn remember(&self, entry: &SegmentRef, decoded: DecodedSegment) {
        let mut written = self.written.lock().unwrap_or_else(PoisonError::into_inner);
        if written.len() >= REMEMBERED_SEGMENTS {
            written.pop_front();
        }
        written.push_back(WrittenSegment {
            entry: entry.clone(),
            decoded,
        });
    }

    /// The records of a segment this store wrote, when `entry` lists it exactly as written.
    /// Forgets a segment whose save failed, so a later minor compaction doesn't merge from it.
    fn forget(&self, entry: &SegmentRef) {
        let mut written = self.written.lock().unwrap_or_else(PoisonError::into_inner);
        written.retain(|segment| segment.entry != *entry);
    }

    fn remembered(&self, entry: &SegmentRef) -> Option<DecodedSegment> {
        let written = self.written.lock().unwrap_or_else(PoisonError::into_inner);
        written
            .iter()
            .find(|segment| segment.entry == *entry)
            .map(|segment| segment.decoded.clone())
    }

    /// Loads `page.json` and every segment, and replays the ink. Never reads `page.md`.
    ///
    /// Damaged records and missing files are reported, not errors: the page is then read-only, with the reason
    /// in `page.format.access` (spec 9.6 and 14.5).
    pub fn load(&self, dir: &Path) -> Result<LoadedPage, LoadError> {
        self.load_page(dir)
    }

    /// Runs steps S2 to S9 of spec 17.7.
    ///
    /// A `base_stamp` of `None` skips the check of S7, for a writer that creates the page. A journal that
    /// can't be written doesn't stop the save (spec 20.12).
    pub fn save(&self, dir: &Path, req: SaveRequest<'_>) -> Result<SaveOutcome, SaveError> {
        self.save_page(dir, req)
    }

    /// The fingerprint of `page.json`, or `None` if it is missing.
    pub fn fingerprint(&self, dir: &Path) -> Result<Option<FileStamp>, FsError> {
        self.fingerprint_of(&NotebookLayout::page_json(dir))
    }

    fn fingerprint_of(&self, path: &Path) -> Result<Option<FileStamp>, FsError> {
        match self.config.fs.metadata(path) {
            Ok(meta) => Ok(Some(meta.stamp)),
            Err(err) if err.kind == FsErrorKind::NotFound => Ok(None),
            Err(err) => Err(err),
        }
    }

    /// Writes `page.md` if it is stale, following spec 11.2. Never for a page of an encrypted section.
    pub fn write_page_md(&self, dir: &Path, page: &Page, links: &dyn LinkResolver) -> Result<ReadableOutcome, FsError> {
        let outcome = self.write_readable(dir, PAGE_MD, page, || self.config.codec.render_page_md(page, links))?;
        fail_point!("save.md.written");
        Ok(outcome)
    }

    /// Writes `ink.svg` if it is stale, following spec 11.2. A page without strokes gets no new `ink.svg`.
    pub fn write_ink_svg(&self, dir: &Path, page: &Page) -> Result<ReadableOutcome, FsError> {
        if page.ink.is_empty() && self.fingerprint_of(&dir.join(INK_SVG))?.is_none() {
            return Ok(ReadableOutcome::Unchanged);
        }
        self.write_readable(dir, INK_SVG, page, || self.config.codec.render_ink_svg(page))
    }

    /// Sync-tool conflict copies of `page.json` in the page folder (spec 14.2), judged by name.
    pub fn conflict_copies(&self, dir: &Path) -> Result<Vec<PathBuf>, FsError> {
        self.list_conflict_copies(dir)
    }

    /// Absorbs a conflict copy (spec 14.2). A real divergence moves into `.conflicts/<revision>.json` and
    /// returns its revision. An older or identical revision of this page goes into history as a version with
    /// the reason `conflict`, and the copy is removed. A file that isn't a copy of this page is left alone.
    pub fn absorb_conflict_copy(&self, dir: &Path, copy: &Path) -> Result<Option<RevisionId>, CoreError> {
        self.absorb_copy(dir, copy)
    }

    /// Keeps another version of `page.json` in `.conflicts/`.
    pub fn keep_conflict(&self, dir: &Path, theirs: &[u8]) -> Result<RevisionId, CoreError> {
        self.keep_other(dir, theirs)
    }

    /// Moves a file that failed to read into `.damaged/<time>-<name>`. `file_name` is relative to the page
    /// folder, such as `page.json` or `ink/<ID>.onk`.
    pub fn move_damaged(&self, dir: &Path, file_name: &str) -> Result<PathBuf, FsError> {
        self.move_aside(dir, file_name)
    }

    /// Repairs damaged ink from other segments and the journal (spec 9.6), after keeping the damaged revision as
    /// a version with the reason `beforeRepair`. The caller saves the result with `CompactionPlan::Major`, so
    /// the damaged segment is no longer listed.
    pub fn repair_ink(&self, dir: &Path, page: &Page, from_journal: &[Arc<Stroke>]) -> Result<Page, CoreError> {
        self.repair(dir, page, from_journal)
    }
}

mod files;
mod load;
mod repair;
mod save;

pub use load::{ink_access, load_ink, missing_assets, InkLoad};
pub(crate) use save::{ensure_dir, without_strokes};

#[cfg(test)]
pub(crate) mod tests;
