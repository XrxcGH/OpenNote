//! The repairs Check notebook offers (docs/FEATURES.md, "Check notebook"; A2-2): putting a page's `page.json`
//! back from the newest version in its history that reads, putting one file back from the newest backup of the
//! notebook, and writing `page.md` again. Nothing changes until the person picks a repair, and each one returns
//! the bytes it replaced, so Undo puts them back.
//!
//! Every path must be inside the notebook folder, with no `..`, so a repair can never write elsewhere.

use std::path::{Component, Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{CoreError, FsErrorKind};
use crate::limits::Limits;
use crate::model::{Access, ReadOnlyReason};
use crate::seams::Codec;
use crate::store::backup::scheduled::newest_backup_set;
use crate::store::fs::Fs;
use crate::store::history::{list_versions, snapshot_bytes};
use crate::store::layout::NotebookLayout;
use crate::store::PageFiles;

/// The largest file a repair reads or keeps for Undo.
const MAX_FILE: u64 = 512 * 1024 * 1024;

/// A repair Check notebook can run. Paths are absolute and inside the notebook.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Repair {
    /// Writes a page's `page.md` again from its `page.json`. An edited copy is kept aside first, as a save does.
    PageMd {
        /// The page folder.
        page: PathBuf,
    },
    /// Puts back a page's `page.json` from the newest version in its history that reads.
    PageFromHistory {
        /// The page folder.
        page: PathBuf,
    },
    /// Puts back one file from the newest complete backup of the notebook under `backups`.
    FromBackup {
        /// The damaged or missing file.
        file: PathBuf,
        /// The backup folder the person chose in Settings.
        backups: PathBuf,
    },
}

/// What a repair replaced, so Undo can put it back.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RepairUndo {
    /// The file the repair wrote.
    pub path: PathBuf,
    /// Its bytes before, or `None` when it wasn't there.
    pub previous: Option<Vec<u8>>,
}

/// Fails unless `path` is inside `root`, with no `..` or other tricks on the way.
pub fn inside(root: &Path, path: &Path) -> Result<(), CoreError> {
    let rest = path
        .strip_prefix(root)
        .map_err(|_| CoreError::NotFound(format!("{} in the notebook", path.display())))?;
    let plain = rest.components().all(|c| matches!(c, Component::Normal(_)));
    if !plain || rest.as_os_str().is_empty() {
        return Err(CoreError::NotFound(format!("{} in the notebook", path.display())));
    }
    Ok(())
}

/// The bytes of `page.json` in the newest version of the page's history that reads and isn't damaged.
pub fn page_json_from_history(
    fs: &dyn Fs,
    codec: &dyn Codec,
    dir: &Path,
    limits: &Limits,
) -> Result<Vec<u8>, CoreError> {
    let files = PageFiles { fs, codec, dir };
    let mut versions = list_versions(&files, limits)?.versions;
    versions.sort_by(|a, b| b.saved_at.cmp(&a.saved_at).then(b.revision.cmp(&a.revision)));
    for version in versions {
        let Ok(bytes) = snapshot_bytes(&files, version.revision, limits) else {
            continue;
        };
        let reads = codec
            .read_page(&bytes, limits)
            .is_ok_and(|read| read.page.format.access != Access::ReadOnly(ReadOnlyReason::Damaged));
        if reads {
            return Ok(bytes);
        }
    }
    Err(CoreError::NotFound("a saved version of the page that reads".into()))
}

/// The same file in the newest complete backup of the notebook at `root`, under the folder `backups`.
pub fn file_from_backup(fs: &dyn Fs, root: &Path, backups: &Path, file: &Path) -> Result<Vec<u8>, CoreError> {
    inside(root, file)?;
    let rest = file.strip_prefix(root).unwrap_or(file);
    let set =
        newest_backup_set(fs, root, backups).ok_or_else(|| CoreError::NotFound("a backup of this notebook".into()))?;
    Ok(fs.read(&set.join(rest), MAX_FILE)?)
}

/// What `path` holds now, for Undo: its bytes, or `None` when it isn't there.
pub fn current(fs: &dyn Fs, path: &Path) -> Result<Option<Vec<u8>>, CoreError> {
    match fs.read(path, MAX_FILE) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(err) if err.kind == FsErrorKind::NotFound => Ok(None),
        Err(err) => Err(err.into()),
    }
}

/// Replaces a file inside the notebook with `bytes`, durably, and returns what it held.
pub fn replace(fs: &dyn Fs, root: &Path, path: &Path, bytes: &[u8]) -> Result<RepairUndo, CoreError> {
    inside(root, path)?;
    let previous = current(fs, path)?;
    fs.replace_durable(path, bytes)?;
    Ok(RepairUndo {
        path: path.to_path_buf(),
        previous,
    })
}

/// Puts back what a repair replaced.
pub fn undo(fs: &dyn Fs, root: &Path, undo: &RepairUndo) -> Result<(), CoreError> {
    inside(root, &undo.path)?;
    match &undo.previous {
        Some(bytes) => {
            fs.replace_durable(&undo.path, bytes)?;
        }
        None => match fs.remove_file(&undo.path) {
            Ok(()) => {}
            Err(err) if err.kind == FsErrorKind::NotFound => {}
            Err(err) => return Err(err.into()),
        },
    }
    Ok(())
}

/// Runs a repair that writes `page.json` or another stored file, while the notebook is closed.
pub fn apply_closed(
    fs: &dyn Fs,
    codec: &dyn Codec,
    limits: &Limits,
    root: &Path,
    repair: &Repair,
) -> Result<RepairUndo, CoreError> {
    match repair {
        Repair::PageFromHistory { page } => {
            inside(root, page)?;
            let bytes = page_json_from_history(fs, codec, page, limits)?;
            replace(fs, root, &NotebookLayout::page_json(page), &bytes)
        }
        Repair::FromBackup { file, backups } => {
            let bytes = file_from_backup(fs, root, backups, file)?;
            replace(fs, root, file, &bytes)
        }
        Repair::PageMd { .. } => Err(CoreError::NotFound("a repair that needs the notebook closed".into())),
    }
}

#[cfg(test)]
mod tests;
