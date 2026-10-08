//! What the app bridge needs to serve the Phase 2 notes contract directly (Phase 2 architecture, section 12):
//! node summaries, the save status, error codes, title rules, node lookup, and Trash receipts that cover
//! nodes of several notebooks and whole notebooks. Owned by WP5.
//!
//! A contract `NodeId` is the node's ID text. Notebook, section, and page IDs are unique everywhere, and group
//! IDs are random, so [`Core::find_node`] finds a node from its text alone.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use crate::error::{CoreError, EditError, FsErrorKind};
use crate::id::{GroupId, Id, NotebookId, PageId, SectionId, TrashItemId};
use crate::model::{Color, NotebookTree, PageNodeState, TreeChild};
use crate::session::core::Core;
use crate::session::notebook::{NodeRef, NotebookHandle};
use crate::store::notebook_store::{invalid_name, INVALID_MOVE, INVALID_NAME};
use crate::time::Timestamp;

/// The longest title the notes contract accepts, in characters.
pub const MAX_TITLE_CHARS: usize = 200;

/// The kind of a node.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum NodeKind {
    /// A notebook.
    Notebook,
    /// A section group.
    SectionGroup,
    /// A section.
    Section,
    /// A page or subpage.
    Page,
}

/// A node as the notes contract's `NodeSummary` describes it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeInfo {
    /// The node's ID text.
    pub id: String,
    /// Its kind.
    pub kind: NodeKind,
    /// Its parent's ID text: `None` only for notebooks. A page's parent is its section; its level says how
    /// deep it is.
    pub parent_id: Option<String>,
    /// Its title.
    pub title: String,
    /// Its color chip. Only pen names reach the contract; other colors show as none.
    pub color: Option<Color>,
    /// 0, 1, or 2 for pages, and 0 for everything else.
    pub page_level: u8,
    /// Direct children of a container: a section's are all its pages. Zero for pages.
    pub child_count: u32,
    /// When it was made.
    pub created: Timestamp,
    /// When it last changed. A page the cache doesn't know yet uses its created time.
    pub modified: Timestamp,
    /// Whether it may not change.
    pub read_only: bool,
    /// A pinned page or section. Always false for everything else.
    pub pinned: bool,
    /// Archived: hidden from the tree until "Show archived".
    pub archived: bool,
}

fn pen(color: &Option<Color>) -> Option<Color> {
    color.clone().filter(Color::is_pen)
}

fn count(n: usize) -> u32 {
    u32::try_from(n).unwrap_or(u32::MAX)
}

/// The notebook itself, as a node.
pub fn notebook_node(tree: &NotebookTree) -> NodeInfo {
    NodeInfo {
        id: tree.notebook.to_string(),
        kind: NodeKind::Notebook,
        parent_id: None,
        title: tree.title.clone(),
        color: pen(&tree.color),
        page_level: 0,
        child_count: count(tree.children(None).len()),
        created: tree.created,
        modified: tree.changed,
        read_only: tree.access.is_read_only(),
        pinned: false,
        archived: tree.archived,
    }
}

fn child_node(tree: &NotebookTree, child: &TreeChild<'_>, parent: String) -> NodeInfo {
    match child {
        TreeChild::Group(group) => NodeInfo {
            id: group.id.to_string(),
            kind: NodeKind::SectionGroup,
            parent_id: Some(parent),
            title: group.title.clone(),
            color: pen(&group.color),
            page_level: 0,
            child_count: count(tree.children(Some(group.id)).len()),
            created: group.created,
            modified: group.changed,
            read_only: tree.access.is_read_only(),
            pinned: false,
            archived: crate::model::is_archived(&group.extra),
        },
        TreeChild::Section(section) => NodeInfo {
            id: section.id.to_string(),
            kind: NodeKind::Section,
            parent_id: Some(parent),
            title: section.title.clone(),
            color: pen(&section.color),
            page_level: 0,
            child_count: count(section.pages.len()),
            created: section.created,
            modified: section.changed,
            read_only: section.access.is_read_only(),
            pinned: section.pinned,
            archived: section.archived,
        },
    }
}

/// The children of a notebook, group, or section, in display order. `parent` is the node's ID; a notebook's
/// own ID lists its top level.
pub fn children_of(tree: &NotebookTree, parent: Id) -> Option<Vec<NodeInfo>> {
    if parent == tree.notebook.0 {
        let id = parent.to_string();
        return Some(
            tree.children(None)
                .iter()
                .map(|c| child_node(tree, c, id.clone()))
                .collect(),
        );
    }
    if tree.groups.iter().any(|g| g.id.0 == parent) {
        let group = GroupId(parent);
        let id = parent.to_string();
        return Some(
            tree.children(Some(group))
                .iter()
                .map(|c| child_node(tree, c, id.clone()))
                .collect(),
        );
    }
    let section = tree.section(SectionId(parent))?;
    let read_only = section.access.is_read_only();
    let pages = section.pages.iter().map(|page| NodeInfo {
        id: page.id.to_string(),
        kind: NodeKind::Page,
        parent_id: Some(section.id.to_string()),
        title: page.title.clone(),
        color: pen(&page.color),
        page_level: page.level,
        child_count: 0,
        created: page.created,
        modified: page.modified.unwrap_or(page.created),
        read_only: read_only || !matches!(page.state, PageNodeState::Normal | PageNodeState::Moving),
        pinned: page.pinned,
        archived: page.archived,
    });
    Some(pages.collect())
}

/// Every node of a notebook, the notebook first, each followed by its children in display order.
pub fn all_nodes(tree: &NotebookTree) -> Vec<NodeInfo> {
    let mut out = vec![notebook_node(tree)];
    let mut pending = vec![tree.notebook.0];
    while let Some(parent) = pending.pop() {
        let Some(children) = children_of(tree, parent) else {
            continue;
        };
        for child in children.iter().rev() {
            if child.kind != NodeKind::Page {
                if let Ok(id) = Id::parse(&child.id) {
                    pending.push(id);
                }
            }
        }
        out.extend(children);
    }
    out
}

/// One node of a notebook by its ID.
pub fn node(tree: &NotebookTree, id: Id) -> Option<NodeInfo> {
    all_nodes(tree).into_iter().find(|n| n.id == id.to_string())
}

/// The save status the title bar shows.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum SaveStatus {
    /// Everything is saved.
    Saved,
    /// Changes wait for a save, or one is running.
    Saving,
    /// A notebook's drive can't be reached (spec 17.6).
    Offline,
    /// A save failed for another reason.
    Error,
}

/// The contract's error code for a core error: `not-found`, `invalid-name`, `invalid-move`, `read-only`,
/// `conflict`, `unavailable`, or `io`.
pub fn error_code(error: &CoreError) -> &'static str {
    match error {
        CoreError::NotFound(_) => "not-found",
        CoreError::ReadOnly(_) => "read-only",
        CoreError::Conflict(_) | CoreError::Apply(_) => "conflict",
        CoreError::Edit(EditError::Invalid(detail)) if detail.starts_with(INVALID_NAME) => "invalid-name",
        CoreError::Edit(EditError::Invalid(detail)) if detail.starts_with(INVALID_MOVE) => "invalid-move",
        CoreError::Edit(EditError::NotFound(_)) => "not-found",
        CoreError::Edit(EditError::ReadOnly(_)) => "read-only",
        CoreError::Edit(_) => "conflict",
        CoreError::Fs(e) => match e.kind {
            FsErrorKind::NotFound => "not-found",
            FsErrorKind::Offline | FsErrorKind::CloudPlaceholder => "unavailable",
            FsErrorKind::ReadOnlyFile | FsErrorKind::Blocked => "read-only",
            _ => "io",
        },
        _ => "io",
    }
}

/// The reason of an `invalid-name` error, such as `empty` or `too-long`.
pub fn invalid_name_reason(error: &CoreError) -> Option<&str> {
    match error {
        CoreError::Edit(EditError::Invalid(detail)) => detail.strip_prefix(INVALID_NAME)?.strip_prefix(": "),
        _ => None,
    }
}

/// The contract's title rule: trimmed, and 1 to 200 characters. Section and page folders are named by ID,
/// and notebook folder names are made safe (spec 3.4), so no other reason can arise.
pub fn check_title(title: &str) -> Result<String, CoreError> {
    let trimmed = title.trim();
    if trimmed.is_empty() {
        return Err(invalid_name("empty"));
    }
    if trimmed.chars().count() > MAX_TITLE_CHARS {
        return Err(invalid_name("too-long"));
    }
    Ok(trimmed.to_owned())
}

/// A node to move to Trash through [`Core::trash_nodes`].
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TrashTarget {
    /// A whole notebook: it leaves the library, and its folder stays.
    Notebook(PathBuf),
    /// A group, section, or page of an open notebook.
    Node(NotebookHandle, NodeRef),
}

impl PartialEq for NotebookHandle {
    fn eq(&self, other: &NotebookHandle) -> bool {
        std::sync::Arc::ptr_eq(&self.inner, &other.inner)
    }
}

impl Eq for NotebookHandle {}

/// One part of a Trash receipt.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ReceiptPart {
    /// Trash items of one notebook.
    Items {
        /// The notebook folder.
        notebook: PathBuf,
        /// The items.
        items: Vec<TrashItemId>,
    },
    /// A notebook removed from the library.
    Notebook {
        /// The notebook folder.
        path: PathBuf,
    },
}

/// What one call of the contract's `trash` did, so `restore` can undo exactly that. It may cover Trash items
/// in several notebooks and whole notebooks. The app treats its text as an opaque `TrashReceiptId`.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TrashReceipt {
    /// The parts.
    pub parts: Vec<ReceiptPart>,
}

impl TrashReceipt {
    /// The receipt as opaque text.
    pub fn encode(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }

    /// Reads a receipt's text.
    pub fn decode(text: &str) -> Result<TrashReceipt, CoreError> {
        serde_json::from_str(text).map_err(|_| CoreError::NotFound(format!("Trash receipt {text:?}")))
    }
}

/// A node that a receipt brought back.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Restored {
    /// A notebook, open again in the library.
    Notebook(NotebookHandle),
    /// A group, section, or page of a notebook.
    Node(NotebookHandle, NodeRef),
}

impl Core {
    /// The open notebook that holds a node with this ID, and the node. A notebook's own ID gives the
    /// notebook with `None`.
    pub fn find_node(&self, id: Id) -> Option<(NotebookHandle, Option<NodeRef>)> {
        for notebook in self.notebooks() {
            if notebook.id().0 == id {
                return Some((notebook, None));
            }
            let tree = notebook.tree();
            let node = if tree.groups.iter().any(|g| g.id.0 == id) {
                Some(NodeRef::Group(GroupId(id)))
            } else if tree.section(SectionId(id)).is_some() {
                Some(NodeRef::Section(SectionId(id)))
            } else if tree.find_page(PageId(id)).is_some() {
                Some(NodeRef::Page(PageId(id)))
            } else {
                None
            };
            if node.is_some() {
                return Some((notebook, node));
            }
        }
        None
    }

    /// Moves nodes of any open notebooks, and whole notebooks, to Trash in one call, and returns one receipt
    /// for all of them.
    pub fn trash_nodes(&self, targets: &[TrashTarget]) -> Result<TrashReceipt, CoreError> {
        let mut by_notebook: BTreeMap<PathBuf, (NotebookHandle, Vec<NodeRef>)> = BTreeMap::new();
        let mut receipt = TrashReceipt::default();
        for target in targets {
            match target {
                TrashTarget::Notebook(path) => {
                    self.remove_notebook(path)?;
                    receipt.parts.push(ReceiptPart::Notebook { path: path.clone() });
                }
                TrashTarget::Node(notebook, node) => {
                    let entry = by_notebook
                        .entry(notebook.path().to_path_buf())
                        .or_insert_with(|| (notebook.clone(), Vec::new()));
                    entry.1.push(*node);
                }
            }
        }
        for (path, (notebook, nodes)) in by_notebook {
            let items = notebook.delete(&nodes)?;
            receipt.parts.push(ReceiptPart::Items { notebook: path, items });
        }
        Ok(receipt)
    }

    /// Restores everything a receipt moved to Trash, each to its original place (spec 12.3).
    pub fn restore_receipt(&self, receipt: &TrashReceipt) -> Result<Vec<Restored>, CoreError> {
        let mut restored = Vec::new();
        for part in &receipt.parts {
            match part {
                ReceiptPart::Notebook { path } => {
                    restored.push(Restored::Notebook(self.restore_notebook(path)?));
                }
                ReceiptPart::Items { notebook, items } => {
                    let handle = self.open_notebook(notebook)?;
                    for item in items {
                        for node in handle.restore(*item, None)? {
                            restored.push(Restored::Node(handle.clone(), node));
                        }
                    }
                }
            }
        }
        Ok(restored)
    }

    /// The save status across every open page.
    pub fn save_status(&self) -> SaveStatus {
        let mut status = SaveStatus::Saved;
        for session in self.ctx().live_sessions() {
            let st = session.state();
            let this = match st.last_error {
                Some(FsErrorKind::Offline | FsErrorKind::CloudPlaceholder) => SaveStatus::Offline,
                Some(_) => SaveStatus::Error,
                None if st.dirty.is_some() || st.saving => SaveStatus::Saving,
                None => SaveStatus::Saved,
            };
            status = worse(status, this);
        }
        status
    }

    /// The notebook with this ID, if it is open.
    pub fn notebook(&self, id: NotebookId) -> Option<NotebookHandle> {
        self.notebooks().into_iter().find(|n| n.id() == id)
    }
}

fn worse(a: SaveStatus, b: SaveStatus) -> SaveStatus {
    let rank = |s: SaveStatus| match s {
        SaveStatus::Saved => 0,
        SaveStatus::Saving => 1,
        SaveStatus::Offline => 2,
        SaveStatus::Error => 3,
    };
    if rank(b) > rank(a) {
        b
    } else {
        a
    }
}
