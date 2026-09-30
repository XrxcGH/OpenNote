//! Telling changes made elsewhere apart (spec 14.1), and the storage side of edits from other apps and notes in
//! sync-tool folders (FEATURES.md, Phase 3). Owned by WP4.
//!
//! The folder watcher, the reload, and the notices are the session's and the interface's. This module gives
//! them the decisions. It says what a changed `page.json` means and which page a changed path belongs to. It
//! lists the readable copies a person edited and the files still only in the cloud, and describes a sync
//! tool's folder.

use std::path::{Component, Path, PathBuf};

use crate::error::{FsError, FsErrorKind};
use crate::format::names::{conflict_copy_kind, ConflictCopyOf};
use crate::id::{PageId, RevisionId, SectionId};
use crate::model::{Page, Revision};
use crate::store::fs::{Fs, SyncTool, VolumeInfo};
use crate::store::gc::parse_file_time;
use crate::store::layout::{
    NotebookLayout, CONFLICTS_DIR, INK_SVG, NOTEBOOK_JSON, OPENNOTE_DIR, PAGE_JSON, PAGE_MD, SECTION_JSON,
};
use crate::time::Timestamp;

/// What a changed `page.json` on disk means for this device.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ExternalDecision {
    /// The revision this device wrote. A tool touched the file without changing it.
    Unchanged,
    /// An older revision of this device's, such as a sync tool's rollback. Saving goes ahead.
    OlderOfOurs,
    /// Another revision, with no unsaved edits here: reload the page.
    FastForward,
    /// Another revision, with unsaved edits here: keep both.
    Conflict,
}

/// Classifies the revision on disk against the base this device read and its own revision.
pub fn classify_change(disk: &Revision, base: RevisionId, own: &Revision, dirty: bool) -> ExternalDecision {
    if disk.id == own.id {
        return ExternalDecision::Unchanged;
    }
    if disk.id == base || own.parents.contains(&disk.id) || own.ancestors.contains(&disk.id) {
        return ExternalDecision::OlderOfOurs;
    }
    if dirty {
        ExternalDecision::Conflict
    } else {
        ExternalDecision::FastForward
    }
}

/// A file of a page folder, as a watcher sees it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PageFile {
    /// `page.json`: check the fingerprint, then `classify_change`.
    PageJson,
    /// A sync-tool conflict copy of `page.json`: absorb it.
    ConflictCopy,
    /// `page.md` or `ink.svg`: a person may have edited it.
    ReadableCopy,
    /// Anything else: segments, assets, history, and files OpenNote doesn't know.
    Other,
}

/// What part of a notebook a changed path belongs to.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NotebookChange {
    /// `notebook.json`.
    Notebook,
    /// A section's `section.json`, or a copy of it.
    Section(SectionId),
    /// A file in a page folder.
    Page {
        /// The section folder the page is in.
        section: SectionId,
        /// The page.
        page: PageId,
        /// Which file.
        file: PageFile,
    },
    /// Trash, conflict copies of tree files, and the lock, in `.opennote/`.
    Internal,
}

/// Which part of the notebook at `root` a changed path belongs to, for the folder watcher. `None` for paths
/// outside the notebook, temporary files, and folders whose names aren't IDs.
pub fn classify_path(root: &Path, path: &Path) -> Option<NotebookChange> {
    let relative = path.strip_prefix(root).ok()?;
    let parts: Vec<&str> = relative
        .components()
        .map(|c| match c {
            Component::Normal(part) => part.to_str(),
            _ => None,
        })
        .collect::<Option<_>>()?;
    let name = *parts.last()?;
    if name.starts_with('~') {
        return None;
    }
    match parts.as_slice() {
        [OPENNOTE_DIR, ..] => Some(NotebookChange::Internal),
        [file] if *file == NOTEBOOK_JSON => Some(NotebookChange::Notebook),
        [section, file] if *file == SECTION_JSON || conflict_copy_kind(file) == Some(ConflictCopyOf::Section) => {
            SectionId::parse(section).ok().map(NotebookChange::Section)
        }
        [section, page, rest @ ..] => {
            let section = SectionId::parse(section).ok()?;
            let page = PageId::parse(page).ok()?;
            Some(NotebookChange::Page {
                section,
                page,
                file: page_file(rest),
            })
        }
        _ => None,
    }
}

fn page_file(rest: &[&str]) -> PageFile {
    match rest {
        [PAGE_JSON] => PageFile::PageJson,
        [name] if conflict_copy_kind(name) == Some(ConflictCopyOf::Page) => PageFile::ConflictCopy,
        [PAGE_MD] | [INK_SVG] => PageFile::ReadableCopy,
        _ => PageFile::Other,
    }
}

/// A readable copy a person edited, which OpenNote kept aside before writing a new one (spec 11.2).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EditedCopy {
    /// The kept copy, in `.conflicts/`.
    pub path: PathBuf,
    /// Which readable copy it was: `page.md` or `ink.svg`.
    pub file: String,
    /// When OpenNote kept it.
    pub kept_at: Option<Timestamp>,
}

/// The edited readable copies kept in a page's `.conflicts/`, by name, so the interface can offer to bring
/// their text into the page.
pub fn edited_copies(fs: &dyn Fs, page_dir: &Path) -> Result<Vec<EditedCopy>, FsError> {
    let dir = page_dir.join(CONFLICTS_DIR);
    let entries = match fs.read_dir(&dir) {
        Ok(entries) => entries,
        Err(err) if err.kind == FsErrorKind::NotFound => return Ok(Vec::new()),
        Err(err) => return Err(err),
    };
    let mut copies: Vec<EditedCopy> = entries
        .into_iter()
        .filter(|e| !e.is_dir)
        .filter_map(|e| {
            let stem = e.name.strip_suffix(".edited")?;
            let (file, time) = [PAGE_MD, INK_SVG]
                .into_iter()
                .find_map(|file| Some((file, stem.strip_prefix(file)?.strip_prefix('.')?)))?;
            let time = time.split('-').next().unwrap_or(time);
            Some(EditedCopy {
                path: dir.join(&e.name),
                file: file.to_owned(),
                kept_at: parse_file_time(time),
            })
        })
        .collect();
    copies.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(copies)
}

/// The files of a page that are only in the cloud, so the session can ask for them before the page opens and
/// never shows an empty page (spec 14.5). Files that are missing or can't be checked are left out.
pub fn cloud_only_files(fs: &dyn Fs, page_dir: &Path, page: &Page) -> Vec<PathBuf> {
    let mut paths = vec![NotebookLayout::page_json(page_dir)];
    paths.extend(
        page.ink
            .segments()
            .iter()
            .map(|s| NotebookLayout::segment_path(page_dir, s.id)),
    );
    paths.extend(
        page.assets
            .values()
            .filter_map(|a| NotebookLayout::asset_path(page_dir, a).ok()),
    );
    paths
        .into_iter()
        .filter(|path| fs.metadata(path).is_ok_and(|meta| meta.placeholder))
        .collect()
}

/// What Setup and Settings tell a person whose notes folder a sync tool manages.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SyncNotice {
    /// The tool.
    pub tool: SyncTool,
    /// Its name, for the notice.
    pub name: &'static str,
    /// Whether the tool can keep files only in the cloud, so "Always keep on this device" applies.
    pub files_on_demand: bool,
}

/// The notice for a notes folder on this volume, or `None` when no sync tool manages it.
pub fn sync_notice(volume: &VolumeInfo) -> Option<SyncNotice> {
    let tool = volume.sync_root?;
    let (name, files_on_demand) = match tool {
        SyncTool::OneDrive => ("OneDrive", true),
        SyncTool::Dropbox => ("Dropbox", true),
        SyncTool::GoogleDrive => ("Google Drive", true),
        SyncTool::ICloud => ("iCloud Drive", true),
        SyncTool::Other => ("a sync tool", false),
    };
    Some(SyncNotice {
        tool,
        name,
        files_on_demand,
    })
}

#[cfg(test)]
mod tests;
