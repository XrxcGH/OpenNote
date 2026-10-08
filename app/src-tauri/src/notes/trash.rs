//! Trash: moving nodes to Trash with one receipt per call, listing what is there, restoring, and purging.
//!
//! Each notebook keeps its own Trash in its folder (docs/format/README.md section 12), so Trash travels with the
//! notebook. A notebook moved to Trash leaves the library and keeps its folder. The receipt of a trash call and
//! the sibling each root went before are kept for this session only: after a restart, each item is its own
//! receipt and goes back to its place by its order key.

use std::{collections::HashSet, fs, path::Path};

use opennote_core::{
    model::{
        trash::{TrashItemFile, TrashOrigin, TrashReason},
        Named,
    },
    session::{
        library::RemovedEntry,
        notebook::{NodePlacement, NodeRef, NotebookHandle, ParentRef},
        notes::{ReceiptPart, TrashReceipt, TrashTarget},
    },
    GroupId, Id, PageId, SectionId, TrashItemId,
};

use super::{
    change::{ancestors, blocks_of, fit_blocks},
    from_core, not_found, same_path,
    tree::{container_children, depth_of, flat_pages, height_of, Found, GROUP_DEPTH},
    NodeSummary, Pending, ReceiptOut, TrashedItem,
};
use crate::{core_bridge::Bridge, ipc::IpcResult};

fn item_key(notebook: &Path, item: TrashItemId) -> String {
    format!("{}|{item}", notebook.display())
}

fn notebook_key(path: &Path) -> String {
    format!("notebook|{}", path.display())
}

/// The folder of a Trash item (docs/format/README.md section 3.1).
fn item_dir(notebook: &Path, item: TrashItemId) -> std::path::PathBuf {
    notebook.join(".opennote").join("trash").join(item.to_string())
}

/// The pages listed in a section folder's `section.json`.
fn pages_in(section_dir: &Path) -> u32 {
    let Ok(text) = fs::read_to_string(section_dir.join("section.json")) else {
        return 0;
    };
    let json: serde_json::Value = serde_json::from_str(&text).unwrap_or_default();
    json.get("pages")
        .and_then(serde_json::Value::as_array)
        .map_or(0, |pages| u32::try_from(pages.len()).unwrap_or(u32::MAX))
}

/// The pages of a notebook folder that isn't open.
fn pages_in_notebook(dir: &Path) -> u32 {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    entries
        .filter_map(Result::ok)
        .map(|entry| pages_in(&entry.path()))
        .sum()
}

/// A trashed root as a node summary.
fn trashed_node(id: String, kind: &'static str, parent: Option<String>, title: String, at: &str) -> NodeSummary {
    NodeSummary {
        id,
        kind,
        parent_id: parent,
        title,
        color: None,
        page_level: 0,
        child_count: 0,
        created: at.to_owned(),
        modified: at.to_owned(),
        read_only: false,
        pinned: false,
        archived: false,
        encrypted: false,
    }
}

/// What a Trash item of a notebook lists as: its root, its old parent and that parent's title, and its pages.
fn listed_item(notebook: &NotebookHandle, file: &TrashItemFile) -> Option<(NodeSummary, Option<String>, String, u32)> {
    let at = file.deleted_at.to_rfc3339();
    let notebook_id = notebook.id().to_string();
    let notebook_title = notebook.tree().title;
    let dir = item_dir(notebook.path(), file.id);
    match &file.origin {
        TrashOrigin::Pages {
            section,
            section_title,
            entries,
        } => {
            let ids: HashSet<PageId> = entries.iter().map(|e| e.id).collect();
            let root = entries
                .iter()
                .find(|e| e.parent.is_none_or(|p| !ids.contains(&p)))
                .or(entries.first())?;
            let parent = Some(section.to_string());
            let node = trashed_node(root.id.to_string(), "page", parent.clone(), root.title.clone(), &at);
            let count = u32::try_from(entries.len()).unwrap_or(u32::MAX);
            Some((node, parent, section_title.clone(), count))
        }
        TrashOrigin::Section {
            group, parent_title, ..
        } => {
            let id = file.contents.first()?;
            let parent = Some(group.map_or_else(|| notebook_id.clone(), |g| g.to_string()));
            let node = trashed_node(id.to_string(), "section", parent.clone(), file.title.clone(), &at);
            let title = parent_title.clone().unwrap_or(notebook_title);
            Some((node, parent, title, pages_in(&dir.join(id.to_string()))))
        }
        TrashOrigin::Group { groups, parent_title } => {
            let root = groups.first()?;
            let parent = Some(root.parent.map_or_else(|| notebook_id.clone(), |g| g.to_string()));
            let node = trashed_node(
                root.id.to_string(),
                "sectionGroup",
                parent.clone(),
                file.title.clone(),
                &at,
            );
            let count = file.contents.iter().map(|s| pages_in(&dir.join(s.to_string()))).sum();
            Some((node, parent, parent_title.clone().unwrap_or(notebook_title), count))
        }
    }
}

/// A Trash item or a notebook in Trash, as `restoreFromTrash` finds it.
enum Entry {
    Item(NotebookHandle, TrashItemId),
    Notebook(RemovedEntry),
}

impl Bridge {
    /// The contract's trash: each root, with what is inside it, becomes a Trash item of its notebook, and a
    /// notebook leaves the library. One receipt covers them all.
    pub(crate) fn trash(&mut self, ids: &[String]) -> IpcResult<ReceiptOut> {
        let mut seen = HashSet::new();
        let mut found = Vec::new();
        for id in ids {
            if seen.insert(id.clone()) {
                found.push(self.find(id)?);
            }
        }
        // Roots: nodes not inside another named node, nor in another named page's block of subpages.
        let named: HashSet<String> = found.iter().map(Found::id).collect();
        let mut roots: Vec<Found> = found
            .into_iter()
            .filter(|node| !ancestors(node).iter().any(|a| named.contains(a)))
            .collect();
        let mut blocks: Vec<(String, Vec<String>)> = Vec::new();
        for node in &roots {
            if let Found::Node(notebook, NodeRef::Page(page)) = node {
                let tree = notebook.tree();
                if let Some((section, _)) = tree.find_page(*page) {
                    let flat = flat_pages(&tree, section.id);
                    if let Some(block) = blocks_of(&flat, &[page.to_string()]).pop() {
                        blocks.push((page.to_string(), block.into_iter().map(|(id, _)| id).collect()));
                    }
                }
            }
        }
        let inside_block = |id: &str| {
            blocks
                .iter()
                .any(|(root, block)| root != id && block.iter().any(|x| x == id))
        };
        roots.retain(|node| !inside_block(&node.id()));
        let order = self.display_order();
        roots.sort_by_key(|node| order.get(&node.id()).copied().unwrap_or(usize::MAX));
        // Where each root was: the sibling after it that isn't going to Trash too.
        let mut gone: HashSet<String> = roots.iter().map(Found::id).collect();
        gone.extend(blocks.iter().flat_map(|(_, block)| block.iter().cloned()));
        let mut places = Vec::with_capacity(roots.len());
        for node in &roots {
            places.push(self.place_of(node, &gone));
        }
        let targets: Vec<TrashTarget> = roots
            .iter()
            .map(|node| match node {
                Found::Notebook(notebook) => TrashTarget::Notebook(notebook.path().to_path_buf()),
                Found::Node(notebook, node) => TrashTarget::Node(notebook.clone(), *node),
            })
            .collect();
        let receipt = self.core.trash_nodes(&targets).map_err(from_core)?;
        let text = receipt.encode();
        for part in &receipt.parts {
            match part {
                ReceiptPart::Notebook { path } => {
                    if let Some(i) = roots
                        .iter()
                        .position(|n| matches!(n, Found::Notebook(nb) if same_path(nb.path(), path)))
                    {
                        self.remember(notebook_key(path), &text, &roots, &places, i);
                    }
                }
                ReceiptPart::Items { notebook, items } => {
                    let mine: Vec<usize> = roots
                        .iter()
                        .enumerate()
                        .filter(|(_, n)| matches!(n, Found::Node(nb, _) if same_path(nb.path(), notebook)))
                        .map(|(i, _)| i)
                        .collect();
                    for (item, i) in items.iter().zip(mine) {
                        self.remember(item_key(notebook, *item), &text, &roots, &places, i);
                    }
                }
            }
        }
        Ok(ReceiptOut {
            id: text,
            node_ids: roots.iter().map(Found::id).collect(),
        })
    }

    fn remember(
        &mut self,
        key: String,
        receipt: &str,
        roots: &[Found],
        places: &[(Option<String>, Option<String>)],
        i: usize,
    ) {
        let (Some(root), Some((parent, before))) = (roots.get(i), places.get(i)) else {
            return;
        };
        let pending = Pending {
            receipt: receipt.to_owned(),
            root: root.id(),
            parent: parent.clone(),
            before: before.clone(),
            order: i,
        };
        self.notes.pending.insert(key, pending);
    }

    /// A root's parent, and the first sibling after it (after its subpages, for a page) that isn't in `gone`.
    fn place_of(&self, node: &Found, gone: &HashSet<String>) -> (Option<String>, Option<String>) {
        let id = node.id();
        let tree = node.notebook().tree();
        let (parent, siblings): (Option<String>, Vec<String>) = match node {
            Found::Notebook(_) => (None, self.notebooks().iter().map(|n| n.id().to_string()).collect()),
            Found::Node(notebook, NodeRef::Page(page)) => match tree.find_page(*page) {
                Some((section, _)) => {
                    let flat = flat_pages(&tree, section.id);
                    let _ = notebook;
                    (
                        Some(section.id.to_string()),
                        flat.into_iter().map(|(id, _)| id).collect(),
                    )
                }
                None => (None, Vec::new()),
            },
            Found::Node(notebook, NodeRef::Group(g)) => {
                let parent = tree.groups.iter().find(|x| x.id == *g).and_then(|x| x.parent);
                let id = parent.map_or_else(|| notebook.id().to_string(), |p| p.to_string());
                (Some(id), container_children(&tree, parent))
            }
            Found::Node(notebook, NodeRef::Section(s)) => {
                let group = tree.section(*s).and_then(|x| x.group);
                let id = group.map_or_else(|| notebook.id().to_string(), |p| p.to_string());
                (Some(id), container_children(&tree, group))
            }
        };
        let at = siblings.iter().position(|x| *x == id).unwrap_or(siblings.len());
        let before = siblings.iter().skip(at + 1).find(|x| !gone.contains(*x)).cloned();
        (parent, before)
    }

    /// The listed Trash items, newest first: the items of every notebook in the library, and the notebooks in
    /// Trash. Items trashed inside a notebook that is itself in Trash stay with it, unlisted. Pages that moved to
    /// another notebook leave their originals in Trash, which aren't listed either.
    pub(crate) fn list_trash(&self) -> IpcResult<Vec<TrashedItem>> {
        let mut out: Vec<(String, usize, TrashedItem)> = Vec::new();
        for notebook in self.notebooks() {
            for file in notebook.trash().map_err(from_core)? {
                if file.reason != Named::Known(TrashReason::Deleted) {
                    continue;
                }
                let Some((node, parent, parent_title, page_count)) = listed_item(&notebook, &file) else {
                    continue;
                };
                let key = item_key(notebook.path(), file.id);
                let (receipt, order) = self.receipt_of(&key, || TrashReceipt {
                    parts: vec![ReceiptPart::Items {
                        notebook: notebook.path().to_path_buf(),
                        items: vec![file.id],
                    }],
                });
                let at = file.deleted_at.to_rfc3339();
                out.push((
                    at.clone(),
                    order,
                    TrashedItem {
                        receipt_id: receipt,
                        node,
                        trashed_at: at,
                        original_parent_id: parent,
                        original_parent_title: parent_title,
                        page_count,
                    },
                ));
            }
        }
        for removed in self.core.library().removed {
            let path = removed.entry.path.clone();
            let key = notebook_key(&path);
            let (receipt, order) = self.receipt_of(&key, || TrashReceipt {
                parts: vec![ReceiptPart::Notebook { path: path.clone() }],
            });
            let at = removed.removed_at.to_rfc3339();
            let node = trashed_node(
                removed.entry.notebook.to_string(),
                "notebook",
                None,
                removed.entry.title.clone(),
                &at,
            );
            out.push((
                at.clone(),
                order,
                TrashedItem {
                    receipt_id: receipt,
                    node,
                    trashed_at: at,
                    original_parent_id: None,
                    original_parent_title: String::new(),
                    page_count: pages_in_notebook(&path),
                },
            ));
        }
        out.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
        Ok(out.into_iter().map(|(_, _, item)| item).collect())
    }

    fn receipt_of(&self, key: &str, single: impl FnOnce() -> TrashReceipt) -> (String, usize) {
        match self.notes.pending.get(key) {
            Some(pending) => (pending.receipt.clone(), pending.order),
            None => (single().encode(), 0),
        }
    }

    /// The contract's restore: what is left of one trash call goes back.
    pub(crate) fn restore(&mut self, receipt: &str) -> IpcResult<Vec<NodeSummary>> {
        let parsed = TrashReceipt::decode(receipt).map_err(|_| not_found("That receipt"))?;
        let mut entries = Vec::new();
        for part in &parsed.parts {
            match part {
                ReceiptPart::Notebook { path } => {
                    let removed = self.core.library().removed;
                    if let Some(entry) = removed.into_iter().find(|r| same_path(&r.entry.path, path)) {
                        entries.push(Entry::Notebook(entry));
                    }
                }
                ReceiptPart::Items { notebook, items } => {
                    let Some(handle) = self.notebooks().into_iter().find(|n| same_path(n.path(), notebook)) else {
                        continue;
                    };
                    let listed: HashSet<TrashItemId> =
                        handle.trash().map_err(from_core)?.iter().map(|f| f.id).collect();
                    for item in items.iter().filter(|item| listed.contains(item)) {
                        entries.push(Entry::Item(handle.clone(), *item));
                    }
                }
            }
        }
        if entries.is_empty() {
            return Err(not_found("Anything of that receipt in Trash"));
        }
        self.restore_entries(entries)
    }

    /// Restores the listed items with these root IDs.
    pub(crate) fn restore_from_trash(&mut self, ids: &[String]) -> IpcResult<Vec<NodeSummary>> {
        let entries = self.entries_for(ids)?;
        self.restore_entries(entries)
    }

    /// The Trash entries whose roots have these IDs, or `not-found` when one isn't listed.
    fn entries_for(&self, ids: &[String]) -> IpcResult<Vec<Entry>> {
        let mut entries = Vec::new();
        let mut seen = HashSet::new();
        for id in ids {
            if !seen.insert(id.clone()) {
                continue;
            }
            let removed = self.core.library().removed;
            if let Some(entry) = removed.into_iter().find(|r| r.entry.notebook.to_string() == *id) {
                entries.push(Entry::Notebook(entry));
                continue;
            }
            let mut hit = None;
            for notebook in self.notebooks() {
                for file in notebook.trash().map_err(from_core)? {
                    if file.reason != Named::Known(TrashReason::Deleted) {
                        continue;
                    }
                    if listed_item(&notebook, &file).is_some_and(|(node, ..)| node.id == *id) {
                        hit = Some(Entry::Item(notebook.clone(), file.id));
                    }
                }
            }
            entries.push(hit.ok_or_else(|| not_found(id))?);
        }
        Ok(entries)
    }

    fn restore_entries(&mut self, entries: Vec<Entry>) -> IpcResult<Vec<NodeSummary>> {
        let mut restored: Vec<(usize, NodeSummary)> = Vec::new();
        let mut fallback: Vec<(SectionId, SectionId)> = Vec::new();
        for entry in entries {
            let (order, found) = match entry {
                Entry::Notebook(removed) => {
                    let path = removed.entry.path;
                    let pending = self.notes.pending.remove(&notebook_key(&path));
                    let notebook = self.core.restore_notebook(&path).map_err(from_core)?;
                    if let Some(pending) = &pending {
                        // Before the notebook it was before, or at the end when that one is gone.
                        let before = pending.before.as_deref().and_then(|id| match self.find(id) {
                            Ok(Found::Notebook(next)) => Some(next.path().to_path_buf()),
                            _ => None,
                        });
                        self.core.move_notebook(&path, before.as_deref()).map_err(from_core)?;
                    }
                    (pending.map_or(0, |p| p.order), Found::Notebook(notebook))
                }
                Entry::Item(notebook, item) => self.restore_item(&notebook, item, &mut fallback)?,
            };
            restored.push((order, self.summary_of(&found)?));
        }
        restored.sort_by_key(|(order, _)| *order);
        Ok(restored.into_iter().map(|(_, node)| node).collect())
    }

    /// Restores one Trash item: before the sibling it went before when that sibling is still there, else where its
    /// order key puts it. A page whose section is gone goes into a new section named after the old one, and pages
    /// of one call whose section is gone share that new section.
    fn restore_item(
        &mut self,
        notebook: &NotebookHandle,
        item: TrashItemId,
        fallback: &mut Vec<(SectionId, SectionId)>,
    ) -> IpcResult<(usize, Found)> {
        let file = notebook
            .trash()
            .map_err(from_core)?
            .into_iter()
            .find(|f| f.id == item)
            .ok_or_else(|| not_found("That Trash item"))?;
        let pending = self.notes.pending.remove(&item_key(notebook.path(), item));
        let order = pending.as_ref().map_or(0, |p| p.order);
        let tree = notebook.tree();
        let to = match &file.origin {
            TrashOrigin::Pages { section, .. } if tree.section(*section).is_none() => fallback
                .iter()
                .find(|(old, _)| old == section)
                .map(|(_, new)| NodePlacement {
                    parent: ParentRef::Section(*new),
                    before: None,
                }),
            _ => None,
        };
        let nodes = notebook.restore(item, to).map_err(from_core)?;
        let root = match &file.origin {
            TrashOrigin::Pages { entries, .. } => {
                let ids: HashSet<PageId> = entries.iter().map(|e| e.id).collect();
                let root = entries
                    .iter()
                    .find(|e| e.parent.is_none_or(|p| !ids.contains(&p)))
                    .map(|e| NodeRef::Page(e.id));
                root.or_else(|| nodes.first().copied())
            }
            TrashOrigin::Section { .. } => file.contents.first().map(|id| NodeRef::Section(SectionId(*id))),
            TrashOrigin::Group { groups, .. } => groups.first().map(|g| NodeRef::Group(g.id)),
        }
        .ok_or_else(|| not_found("The restored node"))?;
        if let (TrashOrigin::Pages { section, .. }, NodeRef::Page(page)) = (&file.origin, root) {
            if let Some((home, _)) = notebook.tree().find_page(page) {
                if home.id != *section && !fallback.iter().any(|(old, _)| old == section) {
                    fallback.push((*section, home.id));
                }
            }
        }
        self.put_back(notebook, root, pending.as_ref());
        Ok((order, Found::Node(notebook.clone(), root)))
    }

    /// Puts a restored root where the contract wants it. A group that would now nest too deep, and a group or
    /// section whose old parent is gone, go to the end of the notebook. Otherwise the root goes before the sibling it
    /// went to Trash before, or to the end of its old parent when that sibling is gone. Without what this session
    /// remembers of the trash call, the core's order key places it. A move that doesn't fit leaves the root where
    /// the core restored it.
    fn put_back(&self, notebook: &NotebookHandle, root: NodeRef, pending: Option<&Pending>) {
        let tree = notebook.tree();
        let result = match root {
            NodeRef::Page(page) => {
                let Some(pending) = pending else {
                    return;
                };
                let Some((section, _)) = tree.find_page(page) else {
                    return;
                };
                if pending.parent.as_deref() != Some(section.id.to_string().as_str()) {
                    return;
                }
                let flat = flat_pages(&tree, section.id);
                let Some(block) = blocks_of(&flat, &[page.to_string()]).pop() else {
                    return;
                };
                let moved: HashSet<&String> = block.iter().map(|(id, _)| id).collect();
                let reduced: Vec<(String, u8)> = flat.iter().filter(|(id, _)| !moved.contains(id)).cloned().collect();
                let before = pending.before.as_deref();
                let index = before
                    .and_then(|b| reduced.iter().position(|(id, _)| id == b))
                    .unwrap_or(reduced.len());
                let Some(level) = fit_blocks(&reduced, index, &[block]).and_then(|l| l.first().copied()) else {
                    return;
                };
                notebook.move_page_blocks(&[(page, level)], section.id, index)
            }
            NodeRef::Section(_) | NodeRef::Group(_) => {
                let current = match root {
                    NodeRef::Section(s) => tree.section(s).and_then(|x| x.group),
                    NodeRef::Group(g) => tree.groups.iter().find(|x| x.id == g).and_then(|x| x.parent),
                    NodeRef::Page(_) => None,
                };
                let to_end = |parent: Option<GroupId>| NodePlacement {
                    parent: parent.map_or(ParentRef::Notebook, ParentRef::Group),
                    before: None,
                };
                let too_deep = depth_of(&tree, current).saturating_add(height_of(&tree, root)) > GROUP_DEPTH;
                let placement = if too_deep {
                    to_end(None)
                } else {
                    let Some(pending) = pending else {
                        return;
                    };
                    let old_parent = pending.parent.as_deref().unwrap_or_default();
                    let current_id = current.map_or_else(|| notebook.id().to_string(), |g| g.to_string());
                    if current_id != old_parent {
                        to_end(None)
                    } else {
                        let siblings = container_children(&tree, current);
                        let before = pending
                            .before
                            .as_deref()
                            .filter(|b| siblings.iter().any(|x| x == b))
                            .and_then(|b| Id::parse(b).ok())
                            .map(|b| {
                                if tree.groups.iter().any(|g| g.id.0 == b) {
                                    NodeRef::Group(GroupId(b))
                                } else {
                                    NodeRef::Section(SectionId(b))
                                }
                            });
                        NodePlacement {
                            parent: current.map_or(ParentRef::Notebook, ParentRef::Group),
                            before,
                        }
                    }
                };
                notebook.move_node(root, placement)
            }
        };
        if let Err(error) = result {
            ::log::debug!("A restored node stays where its order key put it: {error}");
        }
    }

    /// Deletes Trash items for good. A notebook in Trash keeps its folder: OpenNote never deletes a notebook
    /// folder, so it stays in Trash until File Explorer deletes it.
    pub(crate) fn purge(&mut self, ids: &[String]) -> IpcResult<()> {
        for entry in self.entries_for(ids)? {
            match entry {
                Entry::Item(notebook, item) => {
                    self.notes.pending.remove(&item_key(notebook.path(), item));
                    notebook.purge(item).map_err(from_core)?;
                }
                Entry::Notebook(removed) => {
                    if !removed.entry.path.exists() {
                        self.core.forget_notebook(&removed.entry.path).map_err(from_core)?;
                    }
                }
            }
        }
        Ok(())
    }
}
