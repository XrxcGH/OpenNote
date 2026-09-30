//! Checking a whole notebook against invariant I1 (spec 17.1). Owned by WP4.
//!
//! Every JSON file must read and validate, every segment's checksums must pass and its strokes decode, and
//! every reference must resolve. No page or section ID may appear twice, and every Trash item must hold what
//! it lists. The kill harness runs this after every crash, and people run it as "Check this notebook for
//! problems".

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::error::{CoreError, FsErrorKind};
use crate::id::{PageId, SectionId, TrashItemId};
use crate::limits::Limits;
use crate::model::{SectionFile, TrashKind, Warning};
use crate::seams::Codec;
use crate::store::fs::{DirEntry, Fs};
use crate::store::layout::{parse_temp_name, NotebookLayout, ITEM_JSON, OPENNOTE_DIR, SECTION_JSON};

mod page;

/// What "Check this notebook for problems" found.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyReport {
    /// Files checked.
    pub files: u32,
    /// Problems, each with the file it is in.
    pub problems: Vec<(PathBuf, Warning)>,
}

impl VerifyReport {
    /// Whether nothing is wrong.
    pub fn is_clean(&self) -> bool {
        self.problems.is_empty()
    }
}

/// Walks a notebook and collects problems.
struct Verifier<'a> {
    fs: &'a dyn Fs,
    codec: &'a dyn Codec,
    limits: &'a Limits,
    report: VerifyReport,
    pages: HashMap<PageId, PathBuf>,
    sections: HashMap<SectionId, PathBuf>,
}

impl Verifier<'_> {
    fn problem(&mut self, path: &Path, code: &'static str, detail: impl Into<String>) {
        self.report
            .problems
            .push((path.to_path_buf(), Warning::new(code, detail)));
    }

    fn counted(&mut self) {
        self.report.files = self.report.files.saturating_add(1);
    }

    /// Reads a file, counting it, and reports it if it can't be read.
    fn read(&mut self, path: &Path, max: u64) -> Option<Vec<u8>> {
        self.counted();
        match self.fs.read(path, max) {
            Ok(bytes) => Some(bytes),
            Err(err) => {
                self.problem(path, "file.unreadable", format!("{:?}", err.kind));
                None
            }
        }
    }

    /// The folder's entries, or none when it doesn't exist.
    fn list(&mut self, dir: &Path) -> Vec<DirEntry> {
        match self.fs.read_dir(dir) {
            Ok(entries) => entries,
            Err(err) if err.kind == FsErrorKind::NotFound => Vec::new(),
            Err(err) => {
                self.problem(dir, "folder.unreadable", format!("{:?}", err.kind));
                Vec::new()
            }
        }
    }

    fn notebook(&mut self, root: &Path) {
        let path = NotebookLayout::new(root).notebook_json();
        if let Some(bytes) = self.read(&path, self.limits.page_json_bytes) {
            if let Err(err) = self.codec.read_notebook(&bytes, self.limits) {
                self.problem(&path, "notebook.invalid", err.to_string());
            }
        }
    }

    /// Checks a section folder: its `section.json`, its page list, and every page folder in it.
    fn section(&mut self, dir: &Path, listed: bool) {
        let path = dir.join(SECTION_JSON);
        let file = self.read(&path, self.limits.page_json_bytes).and_then(|bytes| {
            match self.codec.read_section(&bytes, self.limits) {
                Ok(file) => Some(file),
                Err(err) => {
                    self.problem(&path, "section.invalid", err.to_string());
                    None
                }
            }
        });
        if let Some(file) = &file {
            self.section_identity(dir, file);
        }
        let mut found = Vec::new();
        for entry in self.list(dir).into_iter().filter(|e| e.is_dir) {
            let page_dir = dir.join(&entry.name);
            if !self
                .fs
                .metadata(&NotebookLayout::page_json(&page_dir))
                .is_ok_and(|m| !m.is_dir)
            {
                continue;
            }
            if let Some(id) = self.page(&page_dir) {
                found.push(id);
            }
        }
        if let (Some(file), true) = (&file, listed) {
            self.page_list(dir, file, &found);
        }
    }

    fn section_identity(&mut self, dir: &Path, file: &SectionFile) {
        let named = dir
            .file_name()
            .is_some_and(|n| n.to_string_lossy() == file.id.to_string());
        if !named {
            self.problem(dir, "section.folderName", file.id.to_string());
        }
        if let Some(other) = self.sections.insert(file.id, dir.to_path_buf()) {
            let detail = format!("{} is also in {}", file.id, other.display());
            self.problem(dir, "tree.duplicateSection", detail);
        }
    }

    /// Every entry has its folder, no entry is still moving, and every page folder has an entry.
    fn page_list(&mut self, dir: &Path, file: &SectionFile, found: &[PageId]) {
        for entry in &file.pages {
            if entry.moving.is_some() {
                self.problem(dir, "tree.pendingMove", entry.id.to_string());
            }
            if !found.contains(&entry.id) {
                self.problem(dir, "tree.entryWithoutFolder", entry.id.to_string());
            }
        }
        for id in found.iter().filter(|id| !file.pages.iter().any(|e| e.id == **id)) {
            self.problem(dir, "tree.folderWithoutEntry", id.to_string());
        }
    }

    /// Checks one Trash item: its `item.json`, and that it holds every folder it lists.
    fn trash_item(&mut self, dir: &Path) {
        let path = dir.join(ITEM_JSON);
        let Some(bytes) = self.read(&path, self.limits.page_json_bytes) else {
            return;
        };
        let item = match self.codec.read_trash_item(&bytes, self.limits) {
            Ok(item) => item,
            Err(err) => return self.problem(&path, "trash.invalid", err.to_string()),
        };
        for id in &item.contents {
            let folder = dir.join(id.to_string());
            if !self.fs.metadata(&folder).is_ok_and(|m| m.is_dir) {
                self.problem(dir, "trash.contentMissing", id.to_string());
                continue;
            }
            match item.kind {
                TrashKind::Page => {
                    self.page(&folder);
                }
                TrashKind::Section | TrashKind::Group => self.section(&folder, false),
            }
        }
    }
}

/// Checks every JSON file, segment, and reference of a notebook, every ID's uniqueness, and every Trash item.
pub fn verify_notebook(
    fs: &dyn Fs,
    codec: &dyn Codec,
    root: &Path,
    limits: &Limits,
) -> Result<VerifyReport, CoreError> {
    let mut verifier = Verifier {
        fs,
        codec,
        limits,
        report: VerifyReport::default(),
        pages: HashMap::new(),
        sections: HashMap::new(),
    };
    verifier.notebook(root);
    for entry in fs.read_dir(root)?.into_iter().filter(|e| e.is_dir) {
        let dir = root.join(&entry.name);
        let is_section = fs.metadata(&dir.join(SECTION_JSON)).is_ok_and(|m| !m.is_dir);
        if entry.name != OPENNOTE_DIR && parse_temp_name(&entry.name).is_none() && is_section {
            verifier.section(&dir, true);
        }
    }
    let trash = NotebookLayout::new(root).trash_dir();
    for entry in verifier.list(&trash).into_iter().filter(|e| e.is_dir) {
        if TrashItemId::parse(&entry.name).is_ok() {
            verifier.trash_item(&trash.join(&entry.name));
        }
    }
    Ok(verifier.report)
}

#[cfg(test)]
mod tests;
