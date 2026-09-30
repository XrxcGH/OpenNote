//! Restoring from Trash (spec 12.3).

use std::collections::HashSet;

use crate::error::{CoreError, FsErrorKind};
use crate::id::{GroupId, Id, PageId, SectionId, TrashItemId};
use crate::model::{Moving, PageEntry, TrashItemFile, TrashOrigin};
use crate::session::journal_thread::TreeOp;
use crate::session::notebook::{NodePlacement, NodeRef, ParentRef};
use crate::store::notebook_store::{invalid_move, not_found, NotebookStore};

impl NotebookStore {
    /// Restores a Trash item to where it came from, or to `to` (spec 12.3). Returns the restored roots.
    ///
    /// Pages go back to their section with their order keys and parents. If the section is gone, they go into
    /// a new top-level section named after it. A section or group whose group is gone goes to the top level.
    pub fn restore(&mut self, item: TrashItemId, to: Option<&NodePlacement>) -> Result<Vec<NodeRef>, CoreError> {
        self.check_writable()?;
        let file = self
            .trash
            .get(&item)
            .map(|t| t.file.clone())
            .ok_or_else(|| not_found(format!("Trash item {item}")))?;
        let intent = self.begin(TreeOp::Restore { item });
        let restored = match &file.origin {
            TrashOrigin::Pages {
                section,
                section_title,
                entries,
            } => self.restore_pages(item, (*section, section_title), entries, to)?,
            TrashOrigin::Section { group, order, .. } => {
                let section = file.contents.first().map(|id| SectionId(*id));
                let section = section.ok_or_else(|| not_found("the section in the Trash item"))?;
                self.restore_section(item, section, (*group, order), to)?
            }
            TrashOrigin::Group { groups, .. } => self.restore_groups(&file, groups, to)?,
        };
        self.log.step_done(intent, 1);
        self.mark_pending();
        self.finish_pending()?;
        self.log.done(intent);
        Ok(restored)
    }

    /// Adds restored page entries marked as moving from Trash (spec 12.3, step 3).
    fn restore_pages(
        &mut self,
        item: TrashItemId,
        (section, section_title): (SectionId, &str),
        entries: &[PageEntry],
        to: Option<&NodePlacement>,
    ) -> Result<Vec<NodeRef>, CoreError> {
        let target = match to.map(|t| t.parent) {
            Some(ParentRef::Section(s)) => s,
            Some(ParentRef::Page(q)) => self.section_of(q).ok_or_else(|| not_found(format!("page {q}")))?,
            Some(_) => return Err(invalid_move("pages go into a section or under a page")),
            None if self.section(section).is_ok() => section,
            None => self.create_section(section_title, None, None)?,
        };
        self.check_section_writable(target)?;
        let restoring = |e: &PageEntry| e.moving == Some(Moving::FromTrash(item));
        let clash = entries.iter().find(|e| {
            let listed = self.sections.values().filter_map(|s| s.entry(e.id)).next();
            listed.is_some_and(|l| !restoring(l))
        });
        if let Some(clash) = clash {
            // Only a copied folder can cause this (spec 12.3, step 4). Restoring it as a new page is not
            // supported yet, so nothing changes.
            let detail = format!("page {} is already in the notebook", clash.id);
            return Err(CoreError::Conflict(detail));
        }
        let ids: HashSet<PageId> = entries.iter().map(|e| e.id).collect();
        let fresh: Vec<PageEntry> = entries
            .iter()
            .filter(|e| self.section_of(e.id).is_none())
            .map(|e| PageEntry {
                parent: e
                    .parent
                    .filter(|p| ids.contains(p) || self.section_of(*p) == Some(target)),
                moving: Some(Moving::FromTrash(item)),
                changed: self.now(),
                ..e.clone()
            })
            .collect();
        if let Some(state) = self.sections.get_mut(&target) {
            state.file.pages.extend(fresh);
        }
        self.write_section(target)?;
        self.mark_pending();
        let root = entries
            .first()
            .map(|e| e.id)
            .ok_or_else(|| not_found("the pages of the Trash item"))?;
        if let Some(to) = to {
            self.move_node(NodeRef::Page(root), to)?;
        }
        Ok(vec![NodeRef::Page(root)])
    }

    /// Moves a section folder back and gives it its place (spec 12.3).
    fn restore_section(
        &mut self,
        item: TrashItemId,
        section: SectionId,
        (group, order): (Option<GroupId>, &crate::order::OrderKey),
        to: Option<&NodePlacement>,
    ) -> Result<Vec<NodeRef>, CoreError> {
        self.move_back(item, section.0)?;
        let dir = self.layout.section_dir(section);
        let file = crate::store::notebook_store::read_section_file(&self.env, &dir)?
            .ok_or_else(|| not_found(format!("section {section}")))?;
        let mut file = file;
        file.group = group.filter(|g| self.group(*g).is_ok());
        file.order = order.clone();
        self.sections
            .insert(section, crate::store::notebook_store::SectionState { file, dir });
        self.forget_item(item)?;
        self.hidden.remove(&section.0);
        if let Some(to) = to {
            self.move_node(NodeRef::Section(section), to)?;
        } else {
            self.write_section(section)?;
        }
        Ok(vec![NodeRef::Section(section)])
    }

    /// Puts removed groups back and moves their sections' folders back (spec 12.3).
    fn restore_groups(
        &mut self,
        file: &TrashItemFile,
        groups: &[crate::model::Group],
        to: Option<&NodePlacement>,
    ) -> Result<Vec<NodeRef>, CoreError> {
        let root = groups
            .first()
            .map(|g| g.id)
            .ok_or_else(|| not_found("the group of the Trash item"))?;
        for group in groups {
            if self.group(group.id).is_err() {
                self.notebook.groups.push(group.clone());
            }
        }
        let known: HashSet<GroupId> = self.notebook.groups.iter().map(|g| g.id).collect();
        for group in self.notebook.groups.iter_mut().filter(|g| g.id == root) {
            group.parent = group.parent.filter(|p| known.contains(p));
        }
        self.write_notebook()?;
        for id in &file.contents {
            self.move_back(file.id, *id)?;
            let dir = self.layout.section_dir(SectionId(*id));
            if let Some(section) = crate::store::notebook_store::read_section_file(&self.env, &dir)? {
                self.sections.insert(
                    section.id,
                    crate::store::notebook_store::SectionState { file: section, dir },
                );
            }
            self.hidden.remove(id);
        }
        self.forget_item(file.id)?;
        if let Some(to) = to {
            self.move_node(NodeRef::Group(root), to)?;
        }
        Ok(vec![NodeRef::Group(root)])
    }

    /// Moves a section folder from a Trash item back into the notebook folder.
    fn move_back(&mut self, item: TrashItemId, id: Id) -> Result<(), CoreError> {
        let from = self.layout.trash_item_dir(item).join(id.to_string());
        let to = self.layout.root.join(id.to_string());
        match self.env.fs.rename_dir(&from, &to) {
            Ok(_) => Ok(()),
            Err(e) if e.kind == FsErrorKind::NotFound && self.env.fs.metadata(&to).is_ok() => Ok(()),
            Err(e) => Err(e.into()),
        }
    }

    /// Deletes `item.json` and the item folder once no folder is left in it (spec 12.3, step 5).
    pub(crate) fn forget_item(&mut self, item: TrashItemId) -> Result<(), CoreError> {
        let dir = self.layout.trash_item_dir(item);
        let left = self
            .env
            .fs
            .read_dir(&dir)
            .map(|e| e.iter().any(|e| e.is_dir))
            .unwrap_or(false);
        if left {
            return Ok(());
        }
        // A rename is durable and a deletion is not, so the item goes away by renaming its folder, as a purge
        // does. A power cut can then never bring `item.json` back after the marks that depend on it are gone.
        let purge = self.layout.purge_dir(item);
        match self.env.fs.rename_dir(&dir, &purge) {
            Ok(_) => {}
            Err(e) if e.kind == FsErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
        let _ = self.env.fs.remove_dir_all(&purge);
        self.trash.remove(&item);
        Ok(())
    }
}
