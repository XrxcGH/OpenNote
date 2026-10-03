//! Deleting to Trash, restoring, and purging (spec 12). Owned by WP5.
//!
//! Each deleted root becomes its own Trash item, so each can be restored on its own (spec 12.2). A root is a
//! page with its subpages, a section, or a group with everything in it. `item.json` is written first, so the
//! deletion is recorded inside the notebook, where any device can finish it. Folder moves that fail because a
//! file is held open are finished later by [`NotebookStore::finish_pending`].

use std::collections::HashSet;
use std::time::Duration;

use crate::error::{CoreError, FsErrorKind};
use crate::id::{GroupId, Id, PageId, SectionId, TrashItemId};
use crate::model::{Named, PageEntry, TrashItemFile, TrashKind, TrashOrigin, TrashReason};
use crate::session::journal_thread::TreeOp;
use crate::session::notebook::NodeRef;
use crate::store::layout::ITEM_JSON;
use crate::store::lock::ensure_dir_all;
use crate::store::notebook_store::{not_found, NotebookStore, TrashEntry};

const DAY: Duration = Duration::from_secs(86_400);

impl NotebookStore {
    /// Deletes nodes to Trash, one item for each root. A node inside another listed node goes with it. The
    /// caller closes the pages involved first, each with a final save (spec 12.2).
    pub fn delete(&mut self, nodes: &[NodeRef], reason: TrashReason) -> Result<Vec<TrashItemId>, CoreError> {
        self.check_writable()?;
        let roots = self.trash_roots(nodes)?;
        let mut items = Vec::with_capacity(roots.len());
        let mut intents = Vec::with_capacity(roots.len());
        for root in roots {
            let item = self.trash_item_for(root, reason)?;
            let intent = self.begin(TreeOp::DeleteToTrash {
                item: item.id,
                contents: item.contents.clone(),
            });
            self.write_trash_item(&item)?;
            self.log.step_done(intent, 1);
            self.remove_from_tree(&item)?;
            self.log.step_done(intent, 2);
            items.push(item.id);
            intents.push(intent);
        }
        self.mark_pending();
        self.finish_pending()?;
        for intent in intents {
            self.log.done(intent);
        }
        Ok(items)
    }

    /// The roots among `nodes`: each node that no other listed node holds.
    fn trash_roots(&self, nodes: &[NodeRef]) -> Result<Vec<NodeRef>, CoreError> {
        let mut covered: HashSet<Id> = HashSet::new();
        for &node in nodes {
            match node {
                NodeRef::Page(p) => {
                    let (section, block) = self.subtree(p)?;
                    self.check_section_writable(section)?;
                    covered.extend(block.iter().skip(1).map(|f| f.id.0));
                }
                NodeRef::Section(s) => {
                    self.check_section_writable(s)?;
                    covered.extend(self.section(s)?.file.pages.iter().map(|e| e.id.0));
                }
                NodeRef::Group(g) => {
                    self.group(g)?;
                    for group in self.groups_inside(g).iter().skip(1) {
                        covered.insert(group.id.0);
                    }
                    for s in self.sections_in(g) {
                        self.check_section_writable(s)?;
                        covered.insert(s.0);
                        covered.extend(self.section(s)?.file.pages.iter().map(|e| e.id.0));
                    }
                }
            }
        }
        let mut seen = HashSet::new();
        Ok(nodes
            .iter()
            .copied()
            .filter(|n| !covered.contains(&node_id(*n)) && seen.insert(node_id(*n)))
            .collect())
    }

    /// The shown sections inside a group and the groups in it.
    pub(crate) fn sections_in(&self, group: GroupId) -> Vec<SectionId> {
        let groups: HashSet<GroupId> = self.groups_inside(group).iter().map(|g| g.id).collect();
        self.sections
            .values()
            .filter(|s| !self.hidden.contains(&s.file.id.0) && s.file.group.is_some_and(|g| groups.contains(&g)))
            .map(|s| s.file.id)
            .collect()
    }

    /// The Trash item for one deleted root.
    fn trash_item_for(&self, root: NodeRef, reason: TrashReason) -> Result<TrashItemFile, CoreError> {
        let (kind, title, origin, contents) = match root {
            NodeRef::Page(p) => self.page_origin(p)?,
            NodeRef::Section(s) => {
                let file = &self.section(s)?.file;
                let group = file.group.filter(|g| self.group(*g).is_ok());
                let parent_title = group.and_then(|g| self.group(g).ok()).map(|g| g.title.clone());
                let origin = TrashOrigin::Section {
                    group,
                    order: file.order.clone(),
                    parent_title,
                };
                (TrashKind::Section, file.title.clone(), origin, vec![s.0])
            }
            NodeRef::Group(g) => {
                let groups = self.groups_inside(g);
                let title = groups.first().map(|g| g.title.clone()).unwrap_or_default();
                let parent = groups.first().and_then(|g| g.parent);
                let parent_title = parent.and_then(|p| self.group(p).ok()).map(|p| p.title.clone());
                let contents = self.sections_in(g).into_iter().map(|s| s.0).collect();
                let origin = TrashOrigin::Group { groups, parent_title };
                (TrashKind::Group, title, origin, contents)
            }
        };
        let now = self.now();
        let days = self.env.timings.trash_days;
        Ok(TrashItemFile {
            id: TrashItemId::generate(self.env.clock.as_ref()),
            kind,
            title,
            deleted_at: now,
            expires_at: now.saturating_add(DAY.saturating_mul(days)),
            deleted_by: self.env.device.clone(),
            reason: Named::Known(reason),
            origin,
            contents,
            extra: crate::model::JsonMap::new(),
            format: crate::model::FormatInfo::default(),
        })
    }

    fn page_origin(&self, page: PageId) -> Result<(TrashKind, String, TrashOrigin, Vec<Id>), CoreError> {
        let (section, block) = self.subtree(page)?;
        let state = self.section(section)?;
        let entries: Vec<PageEntry> = block
            .iter()
            .filter_map(|f| state.entry(f.id).cloned())
            .map(|e| PageEntry { moving: None, ..e })
            .collect();
        let title = entries.first().map(|e| e.title.clone()).unwrap_or_default();
        let contents = entries.iter().map(|e| e.id.0).collect();
        let origin = TrashOrigin::Pages {
            section,
            section_title: state.file.title.clone(),
            entries,
        };
        Ok((TrashKind::Page, title, origin, contents))
    }

    /// Creates the item folder and writes `item.json` durably (spec 12.2, step 3).
    fn write_trash_item(&mut self, item: &TrashItemFile) -> Result<(), CoreError> {
        let dir = self.layout.trash_item_dir(item.id);
        ensure_dir_all(self.env.fs.as_ref(), &dir)?;
        let bytes = self.env.codec.write_trash_item(item);
        self.env.fs.replace_durable(&dir.join(ITEM_JSON), &bytes)?;
        let entry = TrashEntry {
            file: item.clone(),
            present: HashSet::new(),
        };
        self.trash.insert(item.id, entry);
        Ok(())
    }

    /// Removes the page entries from `section.json`, or the groups from `notebook.json` (spec 12.2, step 4).
    fn remove_from_tree(&mut self, item: &TrashItemFile) -> Result<(), CoreError> {
        match &item.origin {
            TrashOrigin::Pages { section, .. } => {
                let ids: HashSet<Id> = item.contents.iter().copied().collect();
                if let Some(state) = self.sections.get_mut(section) {
                    state.file.pages.retain(|e| !ids.contains(&e.id.0));
                }
                self.write_section(*section)
            }
            TrashOrigin::Group { groups, .. } => {
                let ids: HashSet<GroupId> = groups.iter().map(|g| g.id).collect();
                self.notebook.groups.retain(|g| !ids.contains(&g.id));
                self.write_notebook()
            }
            TrashOrigin::Section { .. } => Ok(()),
        }
    }

    /// Every Trash item, newest first.
    pub fn trash_items(&self) -> Vec<TrashItemFile> {
        let mut items: Vec<TrashItemFile> = self.trash.values().map(|t| t.file.clone()).collect();
        items.sort_by(|a, b| b.deleted_at.cmp(&a.deleted_at).then(b.id.cmp(&a.id)));
        items
    }

    /// Deletes a Trash item for good (spec 12.4): renames it to `~purge-<ID>`, which is atomic, then deletes
    /// that folder. A leftover purge folder is deleted by the next scan.
    pub fn purge(&mut self, item: TrashItemId) -> Result<(), CoreError> {
        self.check_writable()?;
        let dir = self.layout.trash_item_dir(item);
        let purge = self.layout.purge_dir(item);
        if !self.trash.contains_key(&item) && self.env.fs.metadata(&dir).is_err() {
            return Err(not_found(format!("Trash item {item}")));
        }
        let intent = self.begin(TreeOp::Purge { item });
        match self.env.fs.rename_dir(&dir, &purge) {
            Ok(_) => {}
            Err(e) if e.kind == FsErrorKind::NotFound => {}
            Err(e) => return Err(e.into()),
        }
        self.log.step_done(intent, 1);
        if let Some(entry) = self.trash.remove(&item) {
            if let TrashOrigin::Pages { entries, .. } = &entry.file.origin {
                for page in entries {
                    self.cache.forget(page.id);
                }
            }
        }
        let _ = self.env.fs.remove_dir_all(&purge);
        self.log.step_done(intent, 2);
        self.log.done(intent);
        self.mark_pending();
        Ok(())
    }

    /// Deletes every Trash item for good.
    pub fn empty_trash(&mut self) -> Result<(), CoreError> {
        let items: Vec<TrashItemId> = self.trash.keys().copied().collect();
        for item in items {
            self.purge(item)?;
        }
        Ok(())
    }

    /// Purges the items whose `expiresAt` has passed (spec 12.4). Returns them.
    pub fn purge_expired(&mut self) -> Result<Vec<TrashItemId>, CoreError> {
        if self.check_writable().is_err() {
            return Ok(Vec::new());
        }
        let now = self.now();
        let expired: Vec<TrashItemId> = self
            .trash
            .values()
            .filter(|t| t.file.expires_at <= now)
            .map(|t| t.file.id)
            .collect();
        for item in &expired {
            self.purge(*item)?;
        }
        Ok(expired)
    }
}

fn node_id(node: NodeRef) -> Id {
    match node {
        NodeRef::Group(g) => g.0,
        NodeRef::Section(s) => s.0,
        NodeRef::Page(p) => p.0,
    }
}

mod restore;

#[cfg(test)]
mod tests;
