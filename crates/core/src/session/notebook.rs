//! An open notebook: its tree, tree changes, Trash, and page sessions (plan 9.1 and 9.4). Owned by WP5.

use std::path::Path;
use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::error::CoreError;
use crate::id::{ClientId, GroupId, NotebookId, PageId, SectionId, TrashItemId};
use crate::model::{Color, NotebookTree, TrashItemFile};
use crate::session::page::PageHandle;
use crate::store::verify::VerifyReport;

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

/// Properties of a node in the tree. `None` leaves a property as it is.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct NodeProps {
    /// A new color chip. `Some(None)` removes it.
    #[serde(default)]
    pub color: Option<Option<Color>>,
    /// Pin or unpin a page.
    #[serde(default)]
    pub pinned: Option<bool>,
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
    _inner: Arc<()>,
}

impl NotebookHandle {
    /// The notebook's ID.
    pub fn id(&self) -> NotebookId {
        unimplemented!("WP5: NotebookHandle::id")
    }

    /// The navigation tree.
    pub fn tree(&self) -> NotebookTree {
        unimplemented!("WP5: NotebookHandle::tree")
    }

    /// Creates a section group.
    pub fn create_group(&self, _title: &str, _at: NodePlacement) -> Result<GroupId, CoreError> {
        unimplemented!("WP5: NotebookHandle::create_group")
    }

    /// Creates a section.
    pub fn create_section(&self, _title: &str, _at: NodePlacement) -> Result<SectionId, CoreError> {
        unimplemented!("WP5: NotebookHandle::create_section")
    }

    /// Creates a page in a section, or a subpage under a page.
    pub fn create_page(&self, _section: SectionId, _at: NodePlacement) -> Result<PageId, CoreError> {
        unimplemented!("WP5: NotebookHandle::create_page")
    }

    /// Renames a node. Renaming a page edits its `page.json`.
    pub fn rename(&self, _node: NodeRef, _title: &str) -> Result<(), CoreError> {
        unimplemented!("WP5: NotebookHandle::rename")
    }

    /// Moves a node, with a page's subpages, within this notebook.
    pub fn move_node(&self, _node: NodeRef, _to: NodePlacement) -> Result<(), CoreError> {
        unimplemented!("WP5: NotebookHandle::move_node")
    }

    /// Changes a node's color or pin.
    pub fn set_props(&self, _node: NodeRef, _props: NodeProps) -> Result<(), CoreError> {
        unimplemented!("WP5: NotebookHandle::set_props")
    }

    /// Duplicates a page.
    pub fn duplicate(&self, _page: PageId) -> Result<PageId, CoreError> {
        unimplemented!("WP5: NotebookHandle::duplicate")
    }

    /// Moves a page to another notebook.
    pub fn move_to_notebook(
        &self,
        _page: PageId,
        _target: &NotebookHandle,
        _to: NodePlacement,
    ) -> Result<PageId, CoreError> {
        unimplemented!("WP5: NotebookHandle::move_to_notebook")
    }

    /// Deletes nodes to Trash: one Trash item for each root, such as a page with its subpages (spec 12.2).
    pub fn delete(&self, _nodes: &[NodeRef]) -> Result<Vec<TrashItemId>, CoreError> {
        unimplemented!("WP5: NotebookHandle::delete")
    }

    /// The Trash items.
    pub fn trash(&self) -> Result<Vec<TrashItemFile>, CoreError> {
        unimplemented!("WP5: NotebookHandle::trash")
    }

    /// Restores a Trash item, to its original place or to `to`.
    pub fn restore(&self, _item: TrashItemId, _to: Option<NodePlacement>) -> Result<Vec<NodeRef>, CoreError> {
        unimplemented!("WP5: NotebookHandle::restore")
    }

    /// Deletes a Trash item for good.
    pub fn purge(&self, _item: TrashItemId) -> Result<(), CoreError> {
        unimplemented!("WP5: NotebookHandle::purge")
    }

    /// Deletes every Trash item for good.
    pub fn empty_trash(&self) -> Result<(), CoreError> {
        unimplemented!("WP5: NotebookHandle::empty_trash")
    }

    /// Undoes the last tree change. Returns whether anything changed.
    pub fn tree_undo(&self) -> Result<bool, CoreError> {
        unimplemented!("WP5: NotebookHandle::tree_undo")
    }

    /// Redoes the last undone tree change.
    pub fn tree_redo(&self) -> Result<bool, CoreError> {
        unimplemented!("WP5: NotebookHandle::tree_redo")
    }

    /// Opens a page for a client, running its recovery first if journals wait.
    pub fn open_page(&self, _page: PageId, _client: ClientId) -> Result<PageHandle, CoreError> {
        unimplemented!("WP5: NotebookHandle::open_page")
    }

    /// Checks the notebook for problems.
    pub fn verify(&self) -> Result<VerifyReport, CoreError> {
        unimplemented!("WP5: NotebookHandle::verify")
    }

    /// Gives a copied notebook a new notebook ID (spec 20.2).
    pub fn make_separate(&self) -> Result<NotebookId, CoreError> {
        unimplemented!("WP5: NotebookHandle::make_separate")
    }

    /// Resolves a duplicate page folder.
    pub fn resolve_duplicate(&self, _page: PageId, _copy: &Path, _choice: DuplicateChoice) -> Result<(), CoreError> {
        unimplemented!("WP5: NotebookHandle::resolve_duplicate")
    }

    /// Saves every page, closes the journals, and releases the lock.
    pub fn close(self) -> Result<(), CoreError> {
        unimplemented!("WP5: NotebookHandle::close")
    }
}
