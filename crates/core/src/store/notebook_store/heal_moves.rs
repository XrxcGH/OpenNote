//! Finishing or undoing a move to another notebook after a crash (spec 18.2).
//!
//! A move copies every folder into the target first, each to a partial `~<ID>.moving` folder. Only after all
//! copies are complete does it rename them into place. So once any copy has its final name, every copy is
//! complete, and the move is committed. The heal then renames the other copies into place and puts the
//! originals in Trash. Before that, nothing in the target is visible, so the heal deletes the partial copies
//! and leaves the source untouched, as the spec's portable mark says.
//!
//! A section or group move also counts as committed once its groups are in the target's `notebook.json`,
//! because rolling back would leave them there empty. Page folders that arrive without a target entry are
//! added by the target's scan, at the end of their section.

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use super::{copy_tree, read_notebook_file, NotebookStore};
use crate::error::CoreError;
use crate::id::{GroupId, Id, PageId, SectionId, TrashItemId};
use crate::model::{TrashOrigin, TrashReason};
use crate::session::notebook::NodeRef;
use crate::store::layout::{NotebookLayout, PartialFolder};

impl NotebookStore {
    /// Heals a page move to the section folder `target` of another notebook.
    pub(super) fn heal_page_transfer(&mut self, page: PageId, target: &Path) -> Result<(), CoreError> {
        let pending = self.pending_deletions(&[page.0], &HashSet::new());
        let ids: Vec<Id> = match (self.subtree(page), pending.first().and_then(|i| self.trash.get(i))) {
            (Ok((_, block)), _) => block.iter().map(|f| f.id.0).collect(),
            (Err(_), Some(item)) => item.file.contents.clone(),
            (Err(_), None) => vec![page.0],
        };
        if !self.finish_copies(&ids, target, false)? {
            return Ok(());
        }
        for item in pending {
            self.heal_delete(item)?;
        }
        if self.section_of(page).is_some() && !self.hidden.contains(&page.0) {
            self.delete(&[NodeRef::Page(page)], TrashReason::Moved)?;
        }
        Ok(())
    }

    /// Heals a section or group move to the notebook at `target`.
    pub(super) fn heal_section_transfer(&mut self, sections: &[SectionId], target: &Path) -> Result<(), CoreError> {
        let groups = self.groups_also_in(target);
        let ids: Vec<Id> = sections.iter().map(|s| s.0).collect();
        if !self.finish_copies(&ids, target, !groups.is_empty())? {
            return Ok(());
        }
        for item in self.pending_deletions(&ids, &groups) {
            self.heal_delete(item)?;
        }
        let nodes = self.transfer_roots(sections, &groups);
        if !nodes.is_empty() {
            self.delete(&nodes, TrashReason::Moved)?;
        }
        Ok(())
    }

    /// The Trash items that hold some of `ids` or of `groups` and whose deletion a crash left half done. The
    /// heal of the move finishes them itself, because a deletion it started during an earlier heal left no
    /// intent behind.
    fn pending_deletions(&self, ids: &[Id], groups: &HashSet<GroupId>) -> Vec<TrashItemId> {
        let restoring = self.restoring_items();
        self.trash
            .values()
            .filter(|item| !restoring.contains(&item.file.id))
            .filter(|item| {
                let holds = item.file.contents.iter().any(|c| ids.contains(c));
                match &item.file.origin {
                    TrashOrigin::Group { groups: held, .. } => {
                        held.iter()
                            .any(|g| groups.contains(&g.id) && self.notebook.groups.iter().any(|n| n.id == g.id))
                            || (holds && item.file.contents.iter().any(|c| !item.present.contains(c)))
                    }
                    _ => holds && item.file.contents.iter().any(|c| !item.present.contains(c)),
                }
            })
            .map(|item| item.file.id)
            .collect()
    }

    /// Finishes the copies of `ids` if the move is committed, and otherwise deletes them. A move is committed
    /// when any copy has its final name in `target`, or when `committed` says it passed its point of no
    /// return. Finishing renames the partial copies into place, after copying a missing one again from the
    /// source. Returns whether the move is committed.
    fn finish_copies(&self, ids: &[Id], target: &Path, committed: bool) -> Result<bool, CoreError> {
        let fs = self.env.fs.as_ref();
        let arrived = ids.iter().any(|id| fs.metadata(&target.join(id.to_string())).is_ok());
        if !arrived && !committed {
            for id in ids {
                let _ = fs.remove_dir_all(&target.join(PartialFolder::Moving(*id).name()));
            }
            return Ok(false);
        }
        for id in ids {
            let dir = target.join(id.to_string());
            if fs.metadata(&dir).is_ok() {
                continue;
            }
            let partial = target.join(PartialFolder::Moving(*id).name());
            if fs.metadata(&partial).is_err() {
                let Some(source) = self.source_dir(*id) else {
                    continue;
                };
                copy_tree(fs, &source, &partial)?;
            }
            fs.rename_dir(&partial, &dir)?;
        }
        Ok(true)
    }

    /// The folder of a page or section in this notebook.
    fn source_dir(&self, id: Id) -> Option<PathBuf> {
        self.page_dir(PageId(id))
            .or_else(|| self.sections.get(&SectionId(id)).map(|s| s.dir.clone()))
    }

    /// This notebook's groups that the notebook at `root` also has. Group IDs are random, so a group in both
    /// was moved there.
    fn groups_also_in(&self, root: &Path) -> HashSet<GroupId> {
        let Ok(file) = read_notebook_file(&self.env, &NotebookLayout::new(root)) else {
            return HashSet::new();
        };
        let theirs: HashSet<GroupId> = file.groups.iter().map(|g| g.id).collect();
        self.notebook
            .groups
            .iter()
            .map(|g| g.id)
            .filter(|g| theirs.contains(g))
            .collect()
    }

    /// What goes to Trash after a section or group move: each moved group whose parent stayed, and each
    /// moved section outside the moved groups.
    fn transfer_roots(&self, sections: &[SectionId], groups: &HashSet<GroupId>) -> Vec<NodeRef> {
        let mut nodes: Vec<NodeRef> = self
            .notebook
            .groups
            .iter()
            .filter(|g| groups.contains(&g.id) && !g.parent.is_some_and(|p| groups.contains(&p)))
            .map(|g| NodeRef::Group(g.id))
            .collect();
        for s in sections {
            let Some(state) = self.sections.get(s) else {
                continue;
            };
            if self.hidden.contains(&s.0) || state.file.group.is_some_and(|g| groups.contains(&g)) {
                continue;
            }
            nodes.push(NodeRef::Section(*s));
        }
        nodes
    }
}
