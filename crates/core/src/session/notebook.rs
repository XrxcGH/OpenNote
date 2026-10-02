//! An open notebook: its tree, tree changes, Trash, and page sessions (plan 9.1 and 9.4). Owned by WP5.
//!
//! Tree changes run under the notebook's tree lock. A change that moves page folders also waits for any save
//! of an open page in the notebook, so a folder never moves under a save, and open pages then follow their
//! folders (spec 18.2). Every change reports `TreeChanged`; `session::tree_events` turns two trees into the
//! finer events of the notes contract.

use std::path::Path;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::id::{ClientId, GroupId, NotebookId, PageId, SectionId, TrashItemId};
use crate::model::{Color, NotebookStyles, NotebookTree, TrashItemFile, TrashReason};
use crate::session::page::PageHandle;
use crate::store::notebook_store::{invalid_move, FlatPage, Transfer};
use crate::store::scan::ScanReport;
use crate::store::verify::VerifyReport;

mod history;
pub(crate) mod open;
mod ops;
pub(crate) mod shared;
#[cfg(test)]
mod tests;
pub(crate) mod undo;

pub use history::{HistoryDeleted, HistoryScope};
pub(crate) use open::open_notebook;
pub(crate) use shared::NotebookShared;
use undo::TreeAction;

/// A group, section, or page of a notebook.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", content = "id", rename_all = "camelCase")]
pub enum NodeRef {
    /// A section group.
    Group(GroupId),
    /// A section.
    Section(SectionId),
    /// A page.
    Page(PageId),
}

/// What a node goes into: the notebook's top level, a group, a section, or a page for subpages.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", content = "id", rename_all = "camelCase")]
pub enum ParentRef {
    /// The notebook's top level, for groups and sections.
    Notebook,
    /// A section group, for groups and sections.
    Group(GroupId),
    /// A section, for top-level pages.
    Section(SectionId),
    /// A page, for its subpages.
    Page(PageId),
}

/// Where a node goes: before a sibling, or at the end of its parent's children when `before` is `None`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct NodePlacement {
    /// The new parent.
    pub parent: ParentRef,
    /// The sibling it goes before.
    pub before: Option<NodeRef>,
}

/// Properties of a node in the tree, or of the notebook itself. `None` leaves a property as it is.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct NodeProps {
    /// A new color chip. `Some(None)` removes it.
    #[serde(default)]
    pub color: Option<Option<Color>>,
    /// Pin or unpin a page.
    #[serde(default)]
    pub pinned: Option<bool>,
    /// New named styles, for the notebook only. An empty map removes them.
    #[serde(default)]
    pub styles: Option<NotebookStyles>,
}

/// What to do about a copied page folder with the same page ID (spec 14.4).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DuplicateChoice {
    /// Keep both, giving the copy a new page ID and its own entry.
    KeepBoth,
    /// Move the copy to Trash.
    TrashCopy,
}

/// An open notebook. Cloning shares it.
#[derive(Clone)]
pub struct NotebookHandle {
    pub(crate) inner: Arc<NotebookShared>,
}

impl std::fmt::Debug for NotebookHandle {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NotebookHandle")
            .field("id", &self.id())
            .field("root", &self.inner.root)
            .finish()
    }
}

impl NotebookHandle {
    /// The notebook's ID.
    pub fn id(&self) -> NotebookId {
        self.inner.id()
    }

    /// The notebook folder.
    pub fn path(&self) -> &Path {
        &self.inner.root
    }

    /// The navigation tree.
    pub fn tree(&self) -> NotebookTree {
        self.inner.tree().store.tree()
    }

    /// A section's pages in display order, with their levels, as the notes contract lists them.
    pub fn flat_pages(&self, section: SectionId) -> Result<Vec<FlatPage>, CoreError> {
        self.inner.tree().store.flat_pages(section)
    }

    /// Whether any open page has changes that aren't saved yet.
    pub fn has_unsaved(&self) -> bool {
        self.inner.sessions().iter().any(|s| s.state().dirty.is_some())
    }

    /// Creates a section group.
    pub fn create_group(&self, title: &str, at: NodePlacement) -> Result<GroupId, CoreError> {
        let parent = container_parent(at.parent)?;
        let before = at.before.map(node_id);
        let id = self.change(false, |t| t.store.create_group(title, parent, before))?;
        self.record(TreeAction::Created(vec![NodeRef::Group(id)]));
        Ok(id)
    }

    /// Creates a section.
    pub fn create_section(&self, title: &str, at: NodePlacement) -> Result<SectionId, CoreError> {
        let parent = container_parent(at.parent)?;
        let before = at.before.map(node_id);
        let id = self.change(false, |t| t.store.create_section(title, parent, before))?;
        self.record(TreeAction::Created(vec![NodeRef::Section(id)]));
        Ok(id)
    }

    /// Creates a page in a section, or a subpage under a page.
    pub fn create_page(&self, section: SectionId, at: NodePlacement) -> Result<PageId, CoreError> {
        self.create_page_titled(section, at, "")
    }

    /// Creates a page with a title, as the notes contract's `create` does.
    pub fn create_page_titled(&self, section: SectionId, at: NodePlacement, title: &str) -> Result<PageId, CoreError> {
        let parent = match at.parent {
            ParentRef::Section(s) if s == section => None,
            ParentRef::Page(p) => Some(p),
            _ => return Err(invalid_move("a page goes into its section or under a page of it")),
        };
        let before = match at.before {
            Some(NodeRef::Page(b)) => Some(b),
            Some(_) => return Err(invalid_move("pages go before pages")),
            None => None,
        };
        let id = self.change(false, |t| t.store.create_page(section, parent, before, title))?;
        self.record(TreeAction::Created(vec![NodeRef::Page(id)]));
        Ok(id)
    }

    /// Renames a node. Renaming a page edits its `page.json`.
    pub fn rename(&self, node: NodeRef, title: &str) -> Result<(), CoreError> {
        let before = self.title_of(node)?;
        if before == title {
            return Ok(());
        }
        match node {
            NodeRef::Page(page) => self.rename_page(page, title)?,
            _ => self.change(false, |t| t.store.rename(node, title))?,
        }
        self.record(TreeAction::Renamed {
            node,
            before,
            after: title.to_owned(),
        });
        Ok(())
    }

    /// Renames the notebook in `notebook.json`. Its folder keeps its name.
    pub fn rename_notebook(&self, title: &str) -> Result<(), CoreError> {
        self.change(false, |t| t.store.rename_notebook(title))
    }

    /// Sets or removes the notebook's color.
    pub fn set_notebook_color(&self, color: Option<Color>) -> Result<(), CoreError> {
        self.change(false, |t| t.store.set_notebook_color(color))
    }

    /// Moves a node, with a page's subpages, within this notebook.
    pub fn move_node(&self, node: NodeRef, to: NodePlacement) -> Result<(), CoreError> {
        let before = self.inner.tree().store.placement_of(node)?;
        self.change(true, |t| t.store.move_node(node, &to))?;
        self.record(TreeAction::Moved { node, before });
        Ok(())
    }

    /// Moves a page, with its subpages, to `index` of a section's flat page list without the moved pages, at
    /// `level`: the notes contract's move of pages.
    pub fn move_pages(&self, pages: &[PageId], section: SectionId, index: usize, level: u8) -> Result<(), CoreError> {
        self.change(true, |t| t.store.move_pages(pages, section, index, level))
    }

    /// Gives pages, with their subpages, a new level in place: the notes contract's `setPageLevel`.
    pub fn set_page_level(&self, pages: &[PageId], level: u8) -> Result<(), CoreError> {
        self.change(false, |t| t.store.set_page_level(pages, level))
    }

    /// Changes the notebook's own color or named styles. A notebook isn't a node of the tree, so these changes
    /// aren't in the tree's undo history.
    pub fn set_notebook_props(&self, props: NodeProps) -> Result<(), CoreError> {
        if props.pinned.is_some() {
            return Err(invalid_move("only pages can be pinned"));
        }
        if let Some(color) = props.color {
            self.set_notebook_color(color)?;
        }
        if let Some(styles) = props.styles {
            self.change(false, |t| t.store.set_notebook_styles(styles))?;
        }
        Ok(())
    }

    /// Changes a node's color or pin.
    pub fn set_props(&self, node: NodeRef, props: NodeProps) -> Result<(), CoreError> {
        let before = self.props_of(node)?;
        self.change(false, |t| t.store.set_props(node, &props))?;
        self.record(TreeAction::Props {
            node,
            before,
            after: props,
        });
        Ok(())
    }

    /// Duplicates a page. An open page is saved first, so the copy has its latest content.
    pub fn duplicate(&self, page: PageId) -> Result<PageId, CoreError> {
        self.save_open(&[page])?;
        let id = self.change(false, |t| t.store.duplicate(page))?;
        self.record(TreeAction::Created(vec![NodeRef::Page(id)]));
        Ok(id)
    }

    /// Moves a page, with its subpages, to another notebook. The originals stay in this notebook's Trash for
    /// 30 days (spec 18.2).
    pub fn move_to_notebook(
        &self,
        page: PageId,
        target: &NotebookHandle,
        to: NodePlacement,
    ) -> Result<PageId, CoreError> {
        self.transfer(NodeRef::Page(page), target, to)?;
        Ok(page)
    }

    /// Moves a section, or a group with everything in it, to another notebook (spec 18.2).
    pub fn move_section_to_notebook(
        &self,
        node: NodeRef,
        target: &NotebookHandle,
        to: NodePlacement,
    ) -> Result<Transfer, CoreError> {
        self.transfer(node, target, to)
    }

    /// Deletes nodes to Trash: one Trash item for each root, such as a page with its subpages (spec 12.2).
    pub fn delete(&self, nodes: &[NodeRef]) -> Result<Vec<TrashItemId>, CoreError> {
        let items = self.delete_nodes(nodes, TrashReason::Deleted)?;
        self.record(TreeAction::Deleted(items.clone()));
        Ok(items)
    }

    /// The Trash items, newest first.
    pub fn trash(&self) -> Result<Vec<TrashItemFile>, CoreError> {
        self.inner.check_open()?;
        Ok(self.inner.tree().store.trash_items())
    }

    /// Restores a Trash item, to its original place or to `to`.
    pub fn restore(&self, item: TrashItemId, to: Option<NodePlacement>) -> Result<Vec<NodeRef>, CoreError> {
        let nodes = self.change(true, |t| t.store.restore(item, to.as_ref()))?;
        self.record(TreeAction::Created(nodes.clone()));
        Ok(nodes)
    }

    /// Deletes a Trash item for good.
    pub fn purge(&self, item: TrashItemId) -> Result<(), CoreError> {
        self.change(false, |t| {
            t.undo.clear();
            t.store.purge(item)
        })
    }

    /// Deletes every Trash item for good.
    pub fn empty_trash(&self) -> Result<(), CoreError> {
        self.change(false, |t| {
            t.undo.clear();
            t.store.empty_trash()
        })
    }

    /// Undoes the last tree change. Returns whether anything changed.
    pub fn tree_undo(&self) -> Result<bool, CoreError> {
        self.reverse(false)
    }

    /// Redoes the last undone tree change.
    pub fn tree_redo(&self) -> Result<bool, CoreError> {
        self.reverse(true)
    }

    /// Opens a page for a client, running its recovery first if journals wait.
    pub fn open_page(&self, page: PageId, client: ClientId) -> Result<PageHandle, CoreError> {
        self.inner.open_page(page, client)
    }

    /// Checks the notebook for problems.
    pub fn verify(&self) -> Result<VerifyReport, CoreError> {
        self.inner.check_open()?;
        self.inner.ctx.backend.verify(&self.inner.root)
    }

    /// Runs the scan of spec 18.3 now, as "Check this notebook for problems" does.
    pub fn scan(&self) -> Result<ScanReport, CoreError> {
        self.change(true, |t| {
            t.undo.clear();
            t.store.scan()
        })
    }

    /// Gives a copied notebook a new notebook ID (spec 20.2).
    pub fn make_separate(&self) -> Result<NotebookId, CoreError> {
        self.inner.make_separate()
    }

    /// Resolves a duplicate page folder.
    pub fn resolve_duplicate(&self, page: PageId, copy: &Path, choice: DuplicateChoice) -> Result<(), CoreError> {
        self.change(true, |t| t.store.resolve_duplicate(page, copy, choice))
    }

    /// Saves every page, closes the journals, and releases the lock.
    pub fn close(self) -> Result<(), CoreError> {
        self.inner.close()
    }
}

/// The group a placement of a group or section names.
fn container_parent(parent: ParentRef) -> Result<Option<GroupId>, CoreError> {
    match parent {
        ParentRef::Notebook => Ok(None),
        ParentRef::Group(g) => Ok(Some(g)),
        _ => Err(invalid_move("groups and sections go into a notebook or a group")),
    }
}

/// The untyped ID of a node.
pub(crate) fn node_id(node: NodeRef) -> crate::id::Id {
    match node {
        NodeRef::Group(g) => g.0,
        NodeRef::Section(s) => s.0,
        NodeRef::Page(p) => p.0,
    }
}
