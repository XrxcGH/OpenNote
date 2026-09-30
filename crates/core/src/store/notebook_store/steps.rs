//! Rolling tree intents forward after a crash (spec 18.2 and 20.10, step 8).
//!
//! Each change's last step heals whatever state the crash left, by looking at the notebook, so running it
//! twice is safe and the earlier steps have nothing left to do. A change that can't be finished because the
//! crash came before its portable mark was written is dropped, and anything it left behind is cleaned up.

use std::cell::RefCell;
use std::collections::HashSet;
use std::path::Path;

use super::plain_entry;
use super::template::template_page;
use super::{write_page_files, NotebookStore};
use crate::error::CoreError;
use crate::id::{PageId, SectionId, TrashItemId};
use crate::session::journal_thread::{TreeIntent, TreeOp};
use crate::store::layout::{PartialFolder, ITEM_JSON, PAGE_JSON, SECTION_JSON};
use crate::store::tree_log::{roll_forward_log, MemIntentLog, TreeSteps};
use crate::store::PageFiles;

/// How many steps each change has in the journal.
pub fn step_count(op: &TreeOp) -> u8 {
    match op {
        TreeOp::CreatePage { .. } | TreeOp::DeleteToTrash { .. } | TreeOp::MovePageToNotebook { .. } => 3,
        TreeOp::CreateSection { .. } | TreeOp::Purge { .. } => 2,
        TreeOp::Restore { .. } => 1,
        TreeOp::MovePage { .. } | TreeOp::DuplicatePage { .. } | TreeOp::MoveSectionToNotebook { .. } => 4,
    }
}

struct Roller<'a> {
    store: RefCell<&'a mut NotebookStore>,
}

impl TreeSteps for Roller<'_> {
    fn steps(&self, op: &TreeOp) -> u8 {
        step_count(op)
    }

    fn run_step(&self, intent: &TreeIntent, step: u8) -> Result<(), CoreError> {
        if step < step_count(&intent.op) {
            return Ok(());
        }
        let mut store = self.store.borrow_mut();
        store.heal(&intent.op)
    }
}

impl NotebookStore {
    /// Rolls every unfinished tree intent forward. Returns how many it finished.
    pub fn roll_forward(&mut self) -> Result<u32, CoreError> {
        // Healing may start changes of its own, such as a deletion. Their intents go to a scratch log while
        // the real log is borrowed, because the healing step of the outer intent covers them.
        let log = std::mem::replace(&mut self.log, Box::new(MemIntentLog::new()));
        let result = {
            let roller = Roller {
                store: RefCell::new(self),
            };
            roll_forward_log(log.as_ref(), &roller)
        };
        self.log = log;
        self.mark_pending();
        result
    }

    /// Finishes or cleans up one change.
    fn heal(&mut self, op: &TreeOp) -> Result<(), CoreError> {
        match op {
            TreeOp::CreatePage { section, page } => self.heal_create_page(*section, *page),
            TreeOp::CreateSection { section } => {
                let dir = self.layout.section_dir(*section);
                self.remove_if_empty(&dir, SECTION_JSON);
                Ok(())
            }
            TreeOp::MovePage { page, from, .. } => {
                let in_target = self
                    .sections
                    .iter()
                    .any(|(s, st)| s != from && st.entry(*page).is_some());
                if in_target {
                    if let Some(source) = self.sections.get_mut(from) {
                        source.file.pages.retain(|e| e.id != *page);
                        self.write_section(*from)?;
                    }
                }
                self.mark_pending();
                self.finish_pending()
            }
            TreeOp::DuplicatePage { from, section, new } => self.heal_duplicate(*from, *section, *new),
            TreeOp::MovePageToNotebook {
                page,
                to_notebook,
                to_section,
            } => {
                let target = to_notebook.join(to_section.to_string());
                self.heal_page_transfer(*page, &target)
            }
            TreeOp::MoveSectionToNotebook { sections, to_notebook } => {
                self.heal_section_transfer(sections, to_notebook)
            }
            TreeOp::DeleteToTrash { item, .. } => self.heal_delete(*item),
            TreeOp::Restore { item } => self.heal_restore(*item),
            TreeOp::Purge { item } => self.heal_purge(*item),
        }
    }

    fn heal_create_page(&mut self, section: SectionId, page: PageId) -> Result<(), CoreError> {
        let Ok(state) = self.section(section) else {
            return Ok(());
        };
        let dir = state.dir.join(page.to_string());
        let fs = self.env.fs.as_ref();
        if fs.metadata(&dir).is_err() {
            return Ok(());
        }
        if fs.metadata(&dir.join(PAGE_JSON)).is_err() {
            let defaults = [state.file.defaults.as_ref(), self.notebook.defaults.as_ref()];
            let template = template_page(&self.env, page, "", defaults);
            let files = PageFiles {
                fs,
                codec: self.env.codec.as_ref(),
                dir: &dir,
            };
            write_page_files(&files, self.env.clock.as_ref(), &template, template.revision.clone())?;
        }
        if self.section_of(page).is_none() {
            let (order, rekeys) = self.page_slot(section, None, None)?;
            let entry = plain_entry(page, String::new(), None, order, self.now());
            self.add_entry(section, entry, &rekeys)?;
        }
        Ok(())
    }

    fn heal_duplicate(&mut self, from: PageId, section: SectionId, new: PageId) -> Result<(), CoreError> {
        let Ok(state) = self.section(section) else {
            return Ok(());
        };
        let dir = state.dir.clone();
        let _ = self
            .env
            .fs
            .remove_dir_all(&dir.join(PartialFolder::Copying(new.0).name()));
        let copied = self.env.fs.metadata(&dir.join(new.to_string()).join(PAGE_JSON)).is_ok();
        if copied && self.section_of(new).is_none() {
            let parent = self.section(section)?.entry(from).and_then(|e| e.parent);
            let (order, rekeys) = self.page_slot(section, parent, None)?;
            let title = self.section(section)?.entry(from).map(|e| e.title.clone());
            let entry = plain_entry(new, title.unwrap_or_default(), parent, order, self.now());
            self.add_entry(section, entry, &rekeys)?;
        }
        Ok(())
    }

    /// A deletion: once `item.json` exists, the deletion is recorded, so it finishes. Before that, nothing
    /// changed but maybe an empty item folder.
    pub(super) fn heal_delete(&mut self, item: TrashItemId) -> Result<(), CoreError> {
        let dir = self.layout.trash_item_dir(item);
        if self.env.fs.metadata(&dir.join(ITEM_JSON)).is_err() {
            self.remove_if_empty(&dir, ITEM_JSON);
            return Ok(());
        }
        let entry = match self.trash.get(&item) {
            Some(entry) => entry.clone(),
            None => self.read_trash_item(item)?,
        };
        match &entry.file.origin {
            crate::model::TrashOrigin::Pages { section, .. } => {
                let ids: HashSet<crate::id::Id> = entry.file.contents.iter().copied().collect();
                let listed = self
                    .sections
                    .get(section)
                    .is_some_and(|s| s.file.pages.iter().any(|e| ids.contains(&e.id.0)));
                if listed {
                    if let Some(state) = self.sections.get_mut(section) {
                        state.file.pages.retain(|e| !ids.contains(&e.id.0));
                    }
                    self.write_section(*section)?;
                }
            }
            crate::model::TrashOrigin::Group { groups, .. } => {
                let ids: HashSet<_> = groups.iter().map(|g| g.id).collect();
                if self.notebook.groups.iter().any(|g| ids.contains(&g.id)) {
                    self.notebook.groups.retain(|g| !ids.contains(&g.id));
                    self.write_notebook()?;
                }
            }
            crate::model::TrashOrigin::Section { .. } => {}
        }
        self.trash.insert(item, entry);
        self.mark_pending();
        self.finish_pending()
    }

    /// A restore: pages carry marks while they come back, so finishing pending moves finishes them. A section
    /// or group has no marks, so once every folder is out of the item, only deleting `item.json` is left.
    /// Without this intent, the scan would take such folders for a pending deletion.
    fn heal_restore(&mut self, item: TrashItemId) -> Result<(), CoreError> {
        let Some(entry) = self.trash.get(&item).cloned() else {
            return Ok(());
        };
        let pages = matches!(entry.file.origin, crate::model::TrashOrigin::Pages { .. });
        let all_out = entry.file.contents.iter().all(|id| !entry.present.contains(id));
        if !pages && all_out {
            self.forget_item(item)?;
            for id in &entry.file.contents {
                let dir = self.layout.section_dir(SectionId(*id));
                if let Some(file) = super::read_section_file(&self.env, &dir)? {
                    self.sections.insert(file.id, super::SectionState { file, dir });
                }
            }
        }
        self.mark_pending();
        self.finish_pending()
    }

    fn heal_purge(&mut self, item: TrashItemId) -> Result<(), CoreError> {
        let dir = self.layout.trash_item_dir(item);
        let purge = self.layout.purge_dir(item);
        let fs = self.env.fs.as_ref();
        if fs.metadata(&dir).is_ok() {
            fs.rename_dir(&dir, &purge)?;
        }
        let _ = fs.remove_dir_all(&purge);
        self.trash.remove(&item);
        Ok(())
    }

    /// Deletes a folder left by an interrupted create, if it holds nothing but temporary files.
    fn remove_if_empty(&self, dir: &Path, marker: &str) {
        let fs = self.env.fs.as_ref();
        let Ok(listing) = fs.read_dir(dir) else { return };
        let empty = listing
            .iter()
            .all(|e| e.name != marker && crate::store::layout::parse_temp_name(&e.name).is_some());
        if empty {
            let _ = fs.remove_dir_all(dir);
        }
    }
}
