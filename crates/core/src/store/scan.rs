//! The scan that heals partial state (spec 18.3). Owned by WP5.
//!
//! The scan reads folder listings and tree files, not page files, so it stays fast. It never uses timestamps
//! to decide where a page belongs: the folder's place wins. It writes a tree file only when it changes
//! something, so a second run changes nothing (property P11).

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use crate::error::{CoreError, FsErrorKind};
use crate::id::{Id, PageId, SectionId, TrashItemId};
use crate::model::{Moving, PageNodeState, Warning};
use crate::store::layout::{parse_temp_name, PartialFolder, PAGE_JSON};
use crate::store::notebook_store::{NotebookStore, PendingMove};

mod files;
mod folders;

pub use folders::ScanReport;

impl NotebookStore {
    /// Runs the whole scan of spec 18.3 and returns what it found and changed.
    pub fn scan(&mut self) -> Result<ScanReport, CoreError> {
        let mut report = ScanReport::default();
        self.notices.clear();
        self.merge_notebook_copies(&mut report)?;
        self.rescan_sections(&mut report)?;
        self.trash.clear();
        self.reread_trash(&mut report);
        self.mark_pending();
        self.finish_pending()?;
        let found = self.list_page_folders()?;
        self.match_entries(&found, &mut report)?;
        self.clean_partials(&found, &mut report);
        self.mark_pending();
        report.notices.clone_from(&self.notices);
        Ok(report)
    }

    /// Finishes what earlier changes left on their way, as steps 2 and 4 of spec 18.3 say. Folders of pending
    /// deletions go into their Trash items, and folders of pages marked as moving go to their sections. A
    /// folder that can't move yet, because a file inside is held open, stays where it is. Its page is read and
    /// saved there until a retry succeeds.
    pub fn finish_pending(&mut self) -> Result<(), CoreError> {
        self.pending.clear();
        self.finish_deletions();
        self.finish_moves()?;
        self.mark_pending();
        Ok(())
    }

    /// Moves the folders of pending deletions into their Trash items.
    fn finish_deletions(&mut self) {
        let restoring: HashSet<TrashItemId> = self
            .sections
            .values()
            .flat_map(|s| s.file.pages.iter())
            .filter_map(|e| match e.moving {
                Some(Moving::FromTrash(item)) => Some(item),
                _ => None,
            })
            .collect();
        let items: Vec<(TrashItemId, Vec<(Id, PathBuf)>)> = self
            .trash
            .values()
            .filter(|t| !restoring.contains(&t.file.id))
            .map(|t| {
                let outside = t.file.contents.iter().filter(|id| !t.present.contains(id));
                let sources = outside.map(|id| (*id, self.outside_folder(&t.file, *id))).collect();
                (t.file.id, sources)
            })
            .collect();
        for (item, sources) in items {
            let dir = self.layout.trash_item_dir(item);
            for (id, from) in sources {
                let to = dir.join(id.to_string());
                if self.move_folder(id, &from, &to) {
                    if let Some(t) = self.trash.get_mut(&item) {
                        t.present.insert(id);
                    }
                    self.sections.remove(&SectionId(id));
                    self.places.remove(&PageId(id));
                }
            }
        }
    }

    /// Where a folder of a pending deletion is: a page in its section, or a section in the notebook folder.
    fn outside_folder(&self, item: &crate::model::TrashItemFile, id: Id) -> PathBuf {
        if let Some(place) = self.places.get(&PageId(id)) {
            return place.clone();
        }
        if let Some(section) = self.sections.get(&SectionId(id)) {
            return section.dir.clone();
        }
        match &item.origin {
            crate::model::TrashOrigin::Pages { section, .. } => self
                .sections
                .get(section)
                .map_or_else(|| self.layout.section_dir(*section), |s| s.dir.clone())
                .join(id.to_string()),
            _ => self.layout.root.join(id.to_string()),
        }
    }

    /// Moves the folders of pages marked as moving, and clears the marks of those that arrived.
    ///
    /// A restore ends by deleting `item.json` before it clears its marks, the reverse of the order spec 12.3
    /// lists for step 5. A crash between the two then leaves marks whose folders already arrived, and the next
    /// run clears them. The other order could leave an `item.json` that makes the restored pages look like a
    /// pending deletion.
    fn finish_moves(&mut self) -> Result<(), CoreError> {
        let marked: Vec<(SectionId, PageId, Moving, PathBuf)> = self
            .sections
            .values()
            .flat_map(|s| {
                s.file
                    .pages
                    .iter()
                    .filter_map(move |e| e.moving.map(|m| (s.file.id, e.id, m, s.dir.join(e.id.to_string()))))
            })
            .collect();
        let arrived = self.move_marked(&marked)?;
        let trash = &self.trash;
        let clear = |moving: Option<Moving>, page: PageId| match moving {
            Some(Moving::From(_)) => arrived.contains(&page),
            Some(Moving::FromTrash(item)) => arrived.contains(&page) && !trash.contains_key(&item),
            None => false,
        };
        let sections: Vec<SectionId> = marked
            .iter()
            .filter(|(_, page, moving, _)| clear(Some(*moving), *page))
            .map(|(s, ..)| *s)
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        for section in sections {
            if let Some(state) = self.sections.get_mut(&section) {
                for entry in state.file.pages.iter_mut() {
                    if clear(entry.moving, entry.id) {
                        entry.moving = None;
                    }
                }
            }
            self.write_section(section)?;
        }
        Ok(())
    }

    /// Moves the folders of marked pages. Deletes each Trash item whose pages all came back. Returns the pages
    /// whose folders arrived.
    fn move_marked(&mut self, marked: &[(SectionId, PageId, Moving, PathBuf)]) -> Result<HashSet<PageId>, CoreError> {
        let mut arrived: HashSet<PageId> = HashSet::new();
        let mut items: HashSet<TrashItemId> = HashSet::new();
        let mut waiting: HashSet<TrashItemId> = HashSet::new();
        for (_, page, moving, to) in marked {
            let from = match moving {
                Moving::From(src) => self
                    .sections
                    .get(src)
                    .map_or_else(|| self.layout.section_dir(*src), |s| s.dir.clone())
                    .join(page.to_string()),
                Moving::FromTrash(item) => {
                    items.insert(*item);
                    self.layout.trash_item_dir(*item).join(page.to_string())
                }
            };
            if self.move_folder(page.0, &from, to) {
                arrived.insert(*page);
            } else if let Moving::FromTrash(item) = moving {
                waiting.insert(*item);
            }
        }
        for item in items.difference(&waiting) {
            // A file held open inside the item folder keeps it from going away. The item stays in Trash, so
            // its pages keep their marks, and the next pass retries (spec 17.6).
            match self.forget_item(*item) {
                Err(CoreError::Fs(e)) if e.kind == FsErrorKind::Busy => {
                    let dir = self.layout.trash_item_dir(*item);
                    self.notices
                        .push(Warning::new("tree.folderBusy", format!("{}: {e}", dir.display())));
                }
                result => result?,
            }
        }
        Ok(arrived)
    }

    /// Moves a folder, or finds it already moved. A folder held open is left for a retry, and its page is
    /// read and saved where it is until then. Returns whether the folder is at `to`.
    fn move_folder(&mut self, id: Id, from: &Path, to: &Path) -> bool {
        let fs = self.env.fs.as_ref();
        if fs.metadata(to).is_ok_and(|m| m.is_dir) {
            self.places.remove(&PageId(id));
            return true;
        }
        match fs.rename_dir(from, to) {
            Ok(_) => {
                self.places.remove(&PageId(id));
                true
            }
            Err(e) if e.kind == FsErrorKind::NotFound => false,
            Err(e) => {
                self.notices
                    .push(Warning::new("tree.folderBusy", format!("{}: {e}", from.display())));
                self.places.insert(PageId(id), from.to_path_buf());
                self.pending.push(PendingMove {
                    id,
                    from: from.to_path_buf(),
                    to: to.to_path_buf(),
                });
                false
            }
        }
    }

    /// Clears the state of pages the scan will judge again.
    fn reset_page_states(&mut self) {
        self.states.retain(|_, state| *state == PageNodeState::Moving);
    }
}

/// Whether a folder entry is a temporary file, a partial copy, or a leftover purge folder.
fn is_partial(name: &str, is_dir: bool) -> bool {
    if is_dir {
        PartialFolder::parse(name).is_some()
    } else {
        parse_temp_name(name).is_some()
    }
}

/// Whether a page folder listing has a `page.json`, looked up exactly first and then without case (spec 3.3).
fn has_page_json(names: &[crate::store::fs::DirEntry]) -> Option<String> {
    names
        .iter()
        .find(|e| !e.is_dir && e.name == PAGE_JSON)
        .or_else(|| {
            names
                .iter()
                .find(|e| !e.is_dir && e.name.eq_ignore_ascii_case(PAGE_JSON))
        })
        .map(|e| e.name.clone())
}

#[cfg(test)]
mod tests;
