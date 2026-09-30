//! Reading a notebook's tree files: `notebook.json`, every `section.json`, and every Trash item.

use std::collections::{BTreeMap, HashSet};
use std::path::Path;

use super::{not_found, NotebookStore, SectionState, TrashEntry, TreeEnv};
use crate::error::{CoreError, FsError, FsErrorKind};
use crate::id::{Id, SectionId, TrashItemId};
use crate::model::{NotebookFile, PageNodeState, SectionFile, Warning};
use crate::store::layout::{NotebookLayout, ITEM_JSON, SECTION_JSON};

impl NotebookStore {
    /// Reads `section.json` from every folder of the notebook. Folders that start with `.` or `~` are skipped.
    pub(crate) fn read_sections(&mut self) -> Result<(), CoreError> {
        let entries = self.env.fs.read_dir(&self.layout.root)?;
        for entry in entries.iter().filter(|e| e.is_dir && !skipped_name(&e.name)) {
            let dir = self.layout.root.join(&entry.name);
            match read_section_file(&self.env, &dir) {
                Ok(Some(file)) => add_section(
                    &mut self.sections,
                    &mut self.notices,
                    SectionState { file, dir },
                    &entry.name,
                ),
                Ok(None) => {}
                Err(e) => self.notices.push(Warning::new(
                    "tree.sectionUnreadable",
                    format!("{}: {e}", dir.display()),
                )),
            }
        }
        Ok(())
    }

    /// Reads every Trash item. A damaged `item.json` is skipped with a notice; its folder stays.
    pub(crate) fn read_trash_items(&mut self) {
        let Ok(entries) = self.env.fs.read_dir(&self.layout.trash_dir()) else {
            return;
        };
        for entry in entries.iter().filter(|e| e.is_dir) {
            let Ok(id) = TrashItemId::parse(&entry.name) else {
                continue;
            };
            match self.read_trash_item(id) {
                Ok(item) => {
                    self.trash.insert(id, item);
                }
                Err(e) => self
                    .notices
                    .push(Warning::new("trash.unreadable", format!("{id}: {e}"))),
            }
        }
    }

    /// Reads one Trash item and lists which of its folders are inside it.
    pub(crate) fn read_trash_item(&self, id: TrashItemId) -> Result<TrashEntry, CoreError> {
        let dir = self.layout.trash_item_dir(id);
        let bytes = self
            .env
            .fs
            .read(&dir.join(ITEM_JSON), self.env.limits.page_json_bytes)?;
        let file = self.env.codec.read_trash_item(&bytes, &self.env.limits)?;
        if file.id != id {
            return Err(not_found(format!("Trash item {id} names another item")));
        }
        let present = self
            .env
            .fs
            .read_dir(&dir)?
            .into_iter()
            .filter(|e| e.is_dir)
            .filter_map(|e| Id::parse(&e.name).ok())
            .collect();
        Ok(TrashEntry { file, present })
    }

    /// Hides pending deletions, and marks pages whose move or restore is still on its way.
    pub(crate) fn mark_pending(&mut self) {
        self.hidden.clear();
        let restoring: HashSet<TrashItemId> = self.restoring_items();
        for item in self.trash.values().filter(|i| !restoring.contains(&i.file.id)) {
            let pending = item.file.contents.iter().filter(|id| !item.present.contains(id));
            self.hidden.extend(pending.copied());
        }
        for section in self.sections.values() {
            for entry in &section.file.pages {
                match entry.moving {
                    Some(_) => {
                        self.states.entry(entry.id).or_insert(PageNodeState::Moving);
                        self.hidden.remove(&entry.id.0);
                    }
                    None => {
                        if self.states.get(&entry.id) == Some(&PageNodeState::Moving) {
                            self.states.remove(&entry.id);
                        }
                    }
                }
            }
        }
    }

    /// Trash items whose pages are marked as being restored from them.
    pub(crate) fn restoring_items(&self) -> HashSet<TrashItemId> {
        let marks = self
            .sections
            .values()
            .flat_map(|s| s.file.pages.iter())
            .filter_map(|e| match e.moving {
                Some(crate::model::Moving::FromTrash(item)) => Some(item),
                _ => None,
            });
        marks.collect()
    }
}

/// Reads `notebook.json`. A folder without one is not a notebook.
pub(crate) fn read_notebook_file(env: &TreeEnv, layout: &NotebookLayout) -> Result<NotebookFile, CoreError> {
    let path = layout.notebook_json();
    let bytes = env
        .fs
        .read(&path, env.limits.page_json_bytes)
        .map_err(|e| match e.kind {
            FsErrorKind::NotFound => not_found(format!("a notebook at {}", layout.root.display())),
            _ => CoreError::Fs(e),
        })?;
    Ok(env.codec.read_notebook(&bytes, &env.limits)?)
}

/// Reads a folder's `section.json`. `Ok(None)` when the folder has none, so it is not a section.
pub(crate) fn read_section_file(env: &TreeEnv, dir: &Path) -> Result<Option<SectionFile>, CoreError> {
    match env.fs.read(&dir.join(SECTION_JSON), env.limits.page_json_bytes) {
        Ok(bytes) => Ok(Some(env.codec.read_section(&bytes, &env.limits)?)),
        Err(FsError {
            kind: FsErrorKind::NotFound,
            ..
        }) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Adds a section that was read. Of two folders with the same section ID, the one named by the ID wins.
pub(crate) fn add_section(
    sections: &mut BTreeMap<SectionId, SectionState>,
    notices: &mut Vec<Warning>,
    state: SectionState,
    name: &str,
) {
    let id = state.file.id;
    if let Some(existing) = sections.get(&id) {
        let detail = format!("{} and {}", existing.dir.display(), state.dir.display());
        notices.push(Warning::new("tree.duplicateSection", detail));
        let existing_named = existing
            .dir
            .file_name()
            .is_some_and(|n| n.to_string_lossy() == id.to_string());
        if existing_named || name != id.to_string() {
            return;
        }
    }
    sections.insert(id, state);
}

/// Names the tree never treats as sections or pages: the notebook's own folder, hidden files, and partial
/// copies and temporary files.
pub(crate) fn skipped_name(name: &str) -> bool {
    name.starts_with('.') || name.starts_with('~')
}
