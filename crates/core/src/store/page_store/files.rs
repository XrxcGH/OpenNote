//! Readable copies, conflict files, and damaged files of a page folder (spec 11.2, 14.1, 14.2, and 16).

use std::path::{Path, PathBuf};

use super::save::ensure_dir;
use super::{PageStore, ReadableOutcome};
use crate::error::{CoreError, FsError, FsErrorKind};
use crate::format::names::{conflict_copy_kind, ConflictCopyOf};
use crate::format::ReadableState;
use crate::id::{PageId, RevisionId};
use crate::model::{Page, Revision, VersionReason};
use crate::store::history::write_version;
use crate::store::layout::{file_time, parse_temp_name, NotebookLayout, CONFLICTS_DIR, DAMAGED_DIR, PAGE_JSON};
use crate::store::PageFiles;

/// The largest readable copy a writer reads back to check it. A larger file is left alone.
const READABLE_LIMIT: u64 = 64 * 1024 * 1024;

/// How many names `move_damaged` tries when files with the same time already exist.
const DAMAGED_NAMES: u32 = 100;

impl PageStore {
    /// Writes a readable copy if it is stale, keeping a person's edits (spec 11.2).
    pub(super) fn write_readable(
        &self,
        dir: &Path,
        name: &str,
        page: &Page,
        render: impl FnOnce() -> Vec<u8>,
    ) -> Result<ReadableOutcome, FsError> {
        if page.encryption.is_some() {
            return Ok(ReadableOutcome::Unchanged);
        }
        let fs = &*self.config.fs;
        let path = dir.join(name);
        let existing = match fs.read(&path, READABLE_LIMIT) {
            Ok(bytes) => Some(bytes),
            Err(err) if err.kind == FsErrorKind::NotFound => None,
            Err(err) if err.kind == FsErrorKind::TooLarge => return Ok(ReadableOutcome::Unchanged),
            Err(err) => return Err(err),
        };
        let rendered = render();
        let state = match &existing {
            Some(bytes) => self.config.codec.classify_readable(bytes),
            None => ReadableState::Missing,
        };
        let outcome = match (state, &existing) {
            (ReadableState::Ours { .. }, Some(bytes)) if *bytes == rendered => return Ok(ReadableOutcome::Unchanged),
            (ReadableState::Edited, Some(bytes)) => {
                let kept = self.keep_edited_copy(dir, name, bytes)?;
                ReadableOutcome::EditedCopyKept(kept)
            }
            _ => ReadableOutcome::Written,
        };
        fs.write_derived(&path, &rendered)?;
        Ok(outcome)
    }

    /// Keeps a readable copy that a person edited as `.conflicts/<name>.<time>.edited`.
    fn keep_edited_copy(&self, dir: &Path, name: &str, bytes: &[u8]) -> Result<PathBuf, FsError> {
        let conflicts = dir.join(CONFLICTS_DIR);
        ensure_dir(&*self.config.fs, &conflicts)?;
        let time = file_time(self.config.clock.now());
        self.create_unique(&conflicts, &format!("{name}.{time}"), ".edited", bytes)
    }

    /// Creates `<stem><ext>`, or `<stem>-2<ext>` and so on when that name is taken by other bytes.
    fn create_unique(&self, dir: &Path, stem: &str, ext: &str, bytes: &[u8]) -> Result<PathBuf, FsError> {
        let mut last = FsError::new(FsErrorKind::AlreadyExists, dir);
        for n in 1..=DAMAGED_NAMES {
            let name = if n == 1 {
                format!("{stem}{ext}")
            } else {
                format!("{stem}-{n}{ext}")
            };
            let path = dir.join(name);
            match self.config.fs.create_durable(&path, bytes) {
                Ok(_) => return Ok(path),
                Err(err) if err.kind == FsErrorKind::AlreadyExists => last = err,
                Err(err) => return Err(err),
            }
        }
        Err(last)
    }

    pub(super) fn list_conflict_copies(&self, dir: &Path) -> Result<Vec<PathBuf>, FsError> {
        let entries = self.config.fs.read_dir(dir)?;
        Ok(entries
            .into_iter()
            .filter(|entry| !entry.is_dir && entry.name != PAGE_JSON && parse_temp_name(&entry.name).is_none())
            .filter(|entry| conflict_copy_kind(&entry.name) == Some(ConflictCopyOf::Page))
            .map(|entry| dir.join(entry.name))
            .collect())
    }

    pub(super) fn absorb_copy(&self, dir: &Path, copy: &Path) -> Result<Option<RevisionId>, CoreError> {
        let config = &self.config;
        let bytes = config.fs.read(copy, config.limits.page_json_bytes)?;
        let Ok(theirs) = config.codec.read_page(&bytes, &config.limits) else {
            return Ok(None);
        };
        let theirs = theirs.page;
        let revision = theirs.revision.id;
        match self.current_revision(dir) {
            // A copy of another page is not this page's business.
            Some((page, _)) if page != theirs.id => Ok(None),
            Some((_, current)) if is_ours(&current, revision) => {
                // An older or identical revision of this page adds nothing new: it goes into history.
                let files = PageFiles {
                    fs: &*config.fs,
                    codec: &*config.codec,
                    dir,
                };
                write_version(&files, &bytes, &theirs, VersionReason::Conflict, None)?;
                config.fs.remove_file(copy)?;
                Ok(None)
            }
            // Another version, or no readable page.json to compare with: keep both.
            _ => {
                self.keep(dir, &bytes, revision)?;
                config.fs.remove_file(copy)?;
                Ok(Some(revision))
            }
        }
    }

    /// The page ID and revision in `page.json`, if it reads.
    fn current_revision(&self, dir: &Path) -> Option<(PageId, Revision)> {
        let config = &self.config;
        let bytes = config
            .fs
            .read(&NotebookLayout::page_json(dir), config.limits.page_json_bytes)
            .ok()?;
        let page = config.codec.read_page(&bytes, &config.limits).ok()?.page;
        Some((page.id, page.revision))
    }

    pub(super) fn keep_other(&self, dir: &Path, theirs: &[u8]) -> Result<RevisionId, CoreError> {
        let config = &self.config;
        let page = config.codec.read_page(theirs, &config.limits)?.page;
        self.keep(dir, theirs, page.revision.id)?;
        Ok(page.revision.id)
    }

    fn keep(&self, dir: &Path, bytes: &[u8], revision: RevisionId) -> Result<(), FsError> {
        let fs = &*self.config.fs;
        ensure_dir(fs, &dir.join(CONFLICTS_DIR))?;
        fs.create_durable(&NotebookLayout::conflict_path(dir, revision), bytes)
            .map(|_| ())
    }

    pub(super) fn move_aside(&self, dir: &Path, file_name: &str) -> Result<PathBuf, FsError> {
        let fs = &*self.config.fs;
        let from = dir.join(file_name);
        let bytes = fs.read(&from, u64::MAX)?;
        let damaged = dir.join(DAMAGED_DIR);
        ensure_dir(fs, &damaged)?;
        let base = Path::new(file_name)
            .file_name()
            .map_or_else(|| file_name.to_owned(), |name| name.to_string_lossy().into_owned());
        let (stem, ext) = match base.rsplit_once('.') {
            Some((stem, ext)) => (stem.to_owned(), format!(".{ext}")),
            None => (base.clone(), String::new()),
        };
        let time = file_time(self.config.clock.now());
        let target = self.create_unique(&damaged, &format!("{time}-{stem}"), &ext, &bytes)?;
        fs.remove_file(&from)?;
        Ok(target)
    }
}

/// Whether `revision` is this device's revision or one of its ancestors (spec 14.1).
pub(crate) fn is_ours(current: &Revision, revision: RevisionId) -> bool {
    revision == current.id || current.ancestors.contains(&revision) || current.parents.contains(&revision)
}
