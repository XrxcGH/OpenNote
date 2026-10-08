//! How a notebook handle runs tree changes: the tree lock, waiting for saves of pages whose folders move,
//! events, undo, page renames, deletions, and moves to other notebooks.

use std::sync::{Arc, PoisonError};

use super::shared::TreeState;
use super::undo::TreeAction;
use super::{NodePlacement, NodeProps, NodeRef, NotebookHandle};
use crate::error::CoreError;
use crate::id::{ClientId, PageId, TrashItemId, TxnId};
use crate::model::TrashReason;
use crate::ops::{Op, Origin, PageFields, Txn};
use crate::session::page::save::Why;
use crate::store::notebook_store::{invalid_move, not_found, Transfer};

/// The client that tree changes use when they edit a page, such as a rename.
pub(crate) fn tree_client() -> ClientId {
    #[allow(clippy::expect_used)]
    ClientId::parse("tree").expect("`tree` is a valid client ID")
}

impl NotebookHandle {
    /// Runs a tree change under the tree lock. When the change may move page folders, it first waits for
    /// every save of an open page in the notebook, and afterward the open pages follow their folders. A failed
    /// change reads the tree files again, so memory matches the disk.
    pub(crate) fn change<T>(
        &self,
        moves_folders: bool,
        op: impl FnOnce(&mut TreeState) -> Result<T, CoreError>,
    ) -> Result<T, CoreError> {
        let shared = &self.inner;
        shared.check_open()?;
        let mut tree = shared.tree();
        let sessions = if moves_folders { shared.sessions() } else { Vec::new() };
        let guards: Vec<_> = sessions
            .iter()
            .map(|s| s.io.lock().unwrap_or_else(PoisonError::into_inner))
            .collect();
        let result = op(&mut tree);
        if result.is_err() {
            let _ = tree.store.reload();
        }
        for session in &sessions {
            if let Some(dir) = tree.store.page_dir(session.id) {
                session.state().dir = dir;
            }
        }
        drop(guards);
        let _ = tree.store.cache.save(shared.ctx.fs.as_ref());
        let pending = !tree.store.pending.is_empty();
        drop(tree);
        shared.tree_changed();
        if pending {
            shared.schedule_retry();
        }
        result
    }

    /// Records a change for tree undo.
    pub(crate) fn record(&self, action: TreeAction) {
        self.inner.tree().undo.record(action);
    }

    /// Undoes or redoes the last tree change. A change that can't be reversed, because something else
    /// changed the same node, is dropped.
    pub(crate) fn reverse(&self, redo: bool) -> Result<bool, CoreError> {
        let action = self.inner.tree().undo.take(redo);
        let Some(action) = action else {
            return Ok(false);
        };
        let reverse = self.apply_reverse(action)?;
        self.inner.tree().undo.push_reverse(redo, reverse);
        Ok(true)
    }

    fn apply_reverse(&self, action: TreeAction) -> Result<TreeAction, CoreError> {
        match action {
            TreeAction::Created(nodes) => Ok(TreeAction::Deleted(self.delete_nodes(&nodes, TrashReason::Deleted)?)),
            TreeAction::Deleted(items) => {
                let mut nodes = Vec::new();
                for item in items {
                    nodes.extend(self.change(true, |t| t.store.restore(item, None))?);
                }
                Ok(TreeAction::Created(nodes))
            }
            TreeAction::Renamed { node, before, after } => {
                match node {
                    NodeRef::Page(page) => self.rename_page(page, &before)?,
                    _ => self.change(false, |t| t.store.rename(node, &before))?,
                }
                Ok(TreeAction::Renamed {
                    node,
                    before: after,
                    after: before,
                })
            }
            TreeAction::Props { node, before, after } => {
                self.change(false, |t| t.store.set_props(node, &before))?;
                Ok(TreeAction::Props {
                    node,
                    before: after,
                    after: before,
                })
            }
            TreeAction::Moved { node, before } => {
                let now = self.inner.tree().store.placement_of(node)?;
                self.change(true, |t| t.store.move_node(node, &before))?;
                Ok(TreeAction::Moved { node, before: now })
            }
        }
    }

    /// The title the tree shows for a node.
    pub(crate) fn title_of(&self, node: NodeRef) -> Result<String, CoreError> {
        let tree = self.inner.tree();
        let store = &tree.store;
        match node {
            NodeRef::Group(g) => Ok(store.group(g)?.title.clone()),
            NodeRef::Section(s) => Ok(store.section(s)?.file.title.clone()),
            NodeRef::Page(p) => {
                let section = store.section_of(p).ok_or_else(|| not_found(format!("page {p}")))?;
                let entry = store.section(section)?.entry(p);
                entry
                    .map(|e| e.title.clone())
                    .ok_or_else(|| not_found(format!("page {p}")))
            }
        }
    }

    /// A node's color and pin, for tree undo.
    pub(crate) fn props_of(&self, node: NodeRef) -> Result<NodeProps, CoreError> {
        let tree = self.inner.tree();
        let store = &tree.store;
        Ok(match node {
            NodeRef::Group(g) => NodeProps {
                color: Some(store.group(g)?.color.clone()),
                pinned: None,
                styles: None,
            },
            NodeRef::Section(s) => NodeProps {
                color: Some(store.section(s)?.file.color.clone()),
                pinned: Some(crate::model::is_pinned(&store.section(s)?.file.extra)),
                styles: None,
            },
            NodeRef::Page(p) => {
                let section = store.section_of(p).ok_or_else(|| not_found(format!("page {p}")))?;
                let entry = store
                    .section(section)?
                    .entry(p)
                    .ok_or_else(|| not_found(format!("page {p}")))?;
                NodeProps {
                    color: Some(entry.color.clone()),
                    pinned: Some(entry.pinned),
                    styles: None,
                }
            }
        })
    }

    /// Renames a page: an edit of its `page.json`, journaled like any other edit, then saved, and then the
    /// title copy in `section.json` (spec 18.1).
    pub(crate) fn rename_page(&self, page: PageId, title: &str) -> Result<(), CoreError> {
        let client = tree_client();
        let handle = self.open_page(page, client.clone())?;
        let result = self.retitle(&handle.session, title);
        let saved = result.and_then(|()| handle.save_now().map(|_| ()));
        let copied = saved.and_then(|()| self.change(false, |t| t.store.set_title_copy(page, title)));
        let closed = handle.close(&client);
        copied.and(closed)
    }

    fn retitle(&self, session: &crate::session::page::PageSession, title: &str) -> Result<(), CoreError> {
        let ctx = &self.inner.ctx;
        if u32::try_from(title.chars().count()).map_or(true, |n| n > ctx.limits.title_chars) {
            return Err(crate::store::notebook_store::invalid_name("too-long"));
        }
        let mut st = session.state();
        session.check_editable(&st)?;
        if st.page.title == title {
            return Ok(());
        }
        let txn = Txn {
            id: TxnId::generate(ctx.clock.as_ref()),
            at: ctx.clock.now(),
            origin: Origin::Local,
            client: tree_client(),
            coalesce: None,
            ui: None,
            ops: vec![Op::SetPage {
                before: PageFields {
                    title: Some(st.page.title.clone()),
                    ..PageFields::default()
                },
                after: PageFields {
                    title: Some(title.to_owned()),
                    ..PageFields::default()
                },
            }],
        };
        session.commit(&mut st, &txn)?;
        Ok(())
    }

    /// Saves open pages among `pages`, so tree code reads their latest content.
    pub(crate) fn save_open(&self, pages: &[PageId]) -> Result<(), CoreError> {
        let sessions: Vec<_> = self
            .inner
            .sessions()
            .into_iter()
            .filter(|s| pages.contains(&s.id))
            .collect();
        for session in sessions {
            session.save(Why::Now)?;
        }
        Ok(())
    }

    /// The pages a change to these nodes takes with it: a page's subpages, a section's pages, and a group's.
    fn pages_under(&self, nodes: &[NodeRef]) -> Vec<PageId> {
        let tree = self.inner.tree();
        let store = &tree.store;
        let mut pages = Vec::new();
        for node in nodes {
            let sections = match node {
                NodeRef::Page(p) => {
                    pages.extend(
                        store
                            .subtree(*p)
                            .map(|(_, b)| b.into_iter().map(|f| f.id))
                            .into_iter()
                            .flatten(),
                    );
                    Vec::new()
                }
                NodeRef::Section(s) => vec![*s],
                NodeRef::Group(g) => store.sections_in(*g),
            };
            for section in sections {
                if let Some(state) = store.sections.get(&section) {
                    pages.extend(state.file.pages.iter().map(|e| e.id));
                }
            }
        }
        pages
    }

    /// Closes the open pages among `pages` in every window, each with a final save (spec 12.2, step 1).
    fn close_pages(&self, pages: &[PageId]) {
        let sessions: Vec<_> = self
            .inner
            .sessions()
            .into_iter()
            .filter(|s| pages.contains(&s.id))
            .collect();
        for session in sessions {
            let _ = session.finish(Why::Close);
        }
    }

    /// Deletes nodes to Trash after closing their open pages.
    pub(crate) fn delete_nodes(&self, nodes: &[NodeRef], reason: TrashReason) -> Result<Vec<TrashItemId>, CoreError> {
        self.close_pages(&self.pages_under(nodes));
        self.change(true, |t| t.store.delete(nodes, reason))
    }

    /// Moves a node to another notebook after closing its open pages. Both trees are locked, in a fixed
    /// order, so two moves in opposite directions can't wait for each other.
    pub(crate) fn transfer(
        &self,
        node: NodeRef,
        target: &NotebookHandle,
        to: NodePlacement,
    ) -> Result<Transfer, CoreError> {
        if Arc::ptr_eq(&self.inner, &target.inner) {
            return Err(invalid_move("that is the same notebook; move the node within it"));
        }
        self.inner.check_open()?;
        target.inner.check_open()?;
        self.close_pages(&self.pages_under(&[node]));
        let source_first = Arc::as_ptr(&self.inner) < Arc::as_ptr(&target.inner);
        let (mut source, mut dest) = if source_first {
            let a = self.inner.tree();
            (a, target.inner.tree())
        } else {
            let b = target.inner.tree();
            (self.inner.tree(), b)
        };
        let result = match node {
            NodeRef::Page(page) => source.store.move_page_to(page, &mut dest.store, &to),
            _ => source.store.move_section_to(node, &mut dest.store, &to),
        };
        if result.is_err() {
            let _ = source.store.reload();
            let _ = dest.store.reload();
        }
        let fs = self.inner.ctx.fs.as_ref();
        let _ = source.store.cache.save(fs);
        let _ = dest.store.cache.save(fs);
        drop((source, dest));
        self.inner.tree_changed();
        target.inner.tree_changed();
        result
    }
}
