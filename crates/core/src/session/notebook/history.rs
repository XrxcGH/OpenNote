//! Deleting the saved versions of pages, as "Delete history" does (spec 13.3, amendment P3-7 of ADR 0008).

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::NotebookHandle;
use crate::error::CoreError;
use crate::id::{PageId, RevisionId, SectionId};
use crate::store::layout::{NotebookLayout, PAGE_JSON};
use crate::store::page_store::LoadError;

/// Which pages "Delete history" reaches.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", content = "id", rename_all = "camelCase")]
pub enum HistoryScope {
    /// One page.
    Page(PageId),
    /// Every page of a section.
    Section(SectionId),
    /// Every page of the notebook.
    Notebook,
}

/// What deleting history removed.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryDeleted {
    /// How many pages the scope covered.
    pub pages: u32,
    /// How many saved versions were deleted.
    pub versions: u32,
}

impl NotebookHandle {
    /// Puts back the newest saved version of a page whose `page.json` is damaged, so the page opens again (spec
    /// 14.5). The damaged file goes into `.damaged/` first, so nothing is lost. Returns the revision put back, or
    /// `None` when the file reads fine or the page has no saved version.
    pub fn recover_damaged_page(&self, page: PageId) -> Result<Option<RevisionId>, CoreError> {
        let shared = &self.inner;
        shared.check_open()?;
        let dir = shared
            .tree()
            .store
            .page_dir(page)
            .ok_or_else(|| CoreError::NotFound(format!("page {page}")))?;
        let backend = &shared.ctx.backend;
        if !matches!(backend.load(&dir), Err(LoadError::Damaged(_))) {
            return Ok(None);
        }
        let Some(newest) = backend.list_versions(&dir)?.versions.last().map(|v| v.revision) else {
            return Ok(None);
        };
        let read = backend.open_version(&dir, newest)?;
        backend.move_damaged(&dir, PAGE_JSON)?;
        let bytes = shared.ctx.codec.write_page(&read.page);
        shared.ctx.fs.create_durable(&NotebookLayout::page_json(&dir), &bytes)?;
        Ok(Some(newest))
    }

    /// Drops every client's undo history of an open page. A change that deleted files the old content names, such
    /// as removing part of a recording, can't be undone: an undo would point the page at files that are gone, and
    /// every save after it would fail. A page that isn't open has no undo history.
    pub fn forget_undo(&self, page: PageId) {
        let session = self.inner.pages().get(&page).cloned();
        if let Some(session) = session {
            let mut st = session.state();
            session.clear_undo(&mut st);
        }
    }

    /// Deletes the saved versions of the pages in `scope`. With `keep_named`, versions that have a name or are
    /// marked to keep stay. The current content of a page is untouched. Ink and assets that only history used
    /// are collected when the page is tidied after it closes. Pages of encrypted sections keep no history, so
    /// they have none to delete.
    pub fn delete_history(&self, scope: HistoryScope, keep_named: bool) -> Result<HistoryDeleted, CoreError> {
        let shared = &self.inner;
        shared.check_open()?;
        let dirs = self.history_dirs(scope)?;
        let mut deleted = HistoryDeleted::default();
        for dir in &dirs {
            let report = shared.ctx.backend.delete_history(dir, keep_named)?;
            deleted.versions = deleted
                .versions
                .saturating_add(u32::try_from(report.dropped.len()).unwrap_or(u32::MAX));
        }
        deleted.pages = u32::try_from(dirs.len()).unwrap_or(u32::MAX);
        Ok(deleted)
    }

    /// The folders of the pages a scope covers, other than pages of encrypted sections.
    fn history_dirs(&self, scope: HistoryScope) -> Result<Vec<PathBuf>, CoreError> {
        let tree = self.inner.tree();
        let store = &tree.store;
        let in_section = |id: SectionId| -> Result<Vec<PathBuf>, CoreError> {
            let section = store.section(id)?;
            if section.encrypted() {
                return Ok(Vec::new());
            }
            Ok(section
                .file
                .pages
                .iter()
                .filter_map(|entry| store.page_dir(entry.id))
                .collect())
        };
        match scope {
            HistoryScope::Page(id) => {
                let section = store
                    .section_of(id)
                    .ok_or_else(|| CoreError::NotFound(format!("page {id}")))?;
                if store.section(section)?.encrypted() {
                    return Ok(Vec::new());
                }
                Ok(store.page_dir(id).into_iter().collect())
            }
            HistoryScope::Section(id) => in_section(id),
            HistoryScope::Notebook => {
                let mut dirs = Vec::new();
                for &id in store.sections.keys().filter(|id| store.section(**id).is_ok()) {
                    dirs.extend(in_section(id)?);
                }
                Ok(dirs)
            }
        }
    }
}
