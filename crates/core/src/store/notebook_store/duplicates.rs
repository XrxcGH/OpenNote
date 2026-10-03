//! Resolving a copied page folder that holds the same page ID as a page of the notebook (spec 14.4).

use std::collections::HashSet;
use std::path::Path;

use super::pages::read_page_files;
use super::transfer::load_failed;
use super::{invalid_move, not_found, NotebookStore, TrashEntry};
use crate::error::CoreError;
use crate::id::{PageId, TrashItemId};
use crate::model::{FormatInfo, JsonMap, Named, PageNodeState, TrashItemFile, TrashKind, TrashOrigin, TrashReason};
use crate::session::notebook::DuplicateChoice;
use crate::store::layout::ITEM_JSON;
use crate::store::lock::ensure_dir_all;

const DAY: std::time::Duration = std::time::Duration::from_secs(86_400);

impl NotebookStore {
    /// Keeps a duplicate folder as its own page with a new page ID, or moves it to Trash. A writer never
    /// gives a copy a new ID on its own: only the person's choice does (spec 14.4).
    pub fn resolve_duplicate(&mut self, page: PageId, copy: &Path, choice: DuplicateChoice) -> Result<(), CoreError> {
        let (section, _) = self.subtree(page)?;
        self.check_section_writable(section)?;
        let own = self.page_dir(page).ok_or_else(|| not_found(format!("page {page}")))?;
        let in_section = copy.parent() == Some(self.section(section)?.dir.as_path())
            || self.sections.values().any(|s| copy.parent() == Some(s.dir.as_path()));
        if copy == own || !in_section {
            return Err(invalid_move("that folder is not a copy of the page"));
        }
        let loaded = read_page_files(self.env.fs.as_ref(), self.env.codec.as_ref(), copy, &self.env.limits)
            .map_err(|e| load_failed(page, e))?;
        if loaded.page.id != page {
            return Err(invalid_move("that folder holds another page"));
        }
        match choice {
            DuplicateChoice::KeepBoth => {
                self.add_copy_from(page, &loaded.page, Some(copy))?;
                self.env.fs.remove_dir_all(copy)?;
            }
            DuplicateChoice::TrashCopy => {
                self.trash_copy(page, section, copy)?;
            }
        }
        if self.states.get(&page) == Some(&PageNodeState::Duplicate) {
            self.states.remove(&page);
        }
        let shown = copy.display().to_string();
        self.notices
            .retain(|n| n.code != "tree.duplicatePage" || n.detail != shown);
        Ok(())
    }

    /// Moves a copied folder into a new Trash item. The item names the page it copies, but the page itself
    /// stays where it is.
    fn trash_copy(&mut self, page: PageId, section: crate::id::SectionId, copy: &Path) -> Result<(), CoreError> {
        let state = self.section(section)?;
        let entry = state
            .entry(page)
            .cloned()
            .ok_or_else(|| not_found(format!("page {page}")))?;
        let now = self.now();
        let item = TrashItemFile {
            id: TrashItemId::generate(self.env.clock.as_ref()),
            kind: TrashKind::Page,
            title: entry.title.clone(),
            deleted_at: now,
            expires_at: now.saturating_add(DAY.saturating_mul(self.env.timings.trash_days)),
            deleted_by: self.env.device.clone(),
            reason: Named::Known(TrashReason::Deleted),
            origin: TrashOrigin::Pages {
                section,
                section_title: state.file.title.clone(),
                entries: vec![entry],
            },
            contents: vec![page.0],
            extra: JsonMap::new(),
            format: FormatInfo::default(),
        };
        let dir = self.layout.trash_item_dir(item.id);
        ensure_dir_all(self.env.fs.as_ref(), &dir)?;
        self.env
            .fs
            .replace_durable(&dir.join(ITEM_JSON), &self.env.codec.write_trash_item(&item))?;
        if let Err(e) = self.env.fs.rename_dir(copy, &dir.join(page.to_string())) {
            let _ = self.env.fs.remove_dir_all(&dir);
            return Err(e.into());
        }
        let present = HashSet::from([page.0]);
        self.trash.insert(item.id, TrashEntry { file: item, present });
        Ok(())
    }
}
