//! Reading the tree: finding nodes, their summaries, children in display order, and the first load along a path.

use std::collections::{BTreeMap, HashMap};

use opennote_core::{
    model::{NotebookTree, TreeChild},
    session::{
        notebook::{NodeRef, NotebookHandle},
        notes::{all_nodes, children_of, node, notebook_node, NodeInfo, NodeKind},
    },
    GroupId, Id, SectionId,
};

use super::{not_found, InitialTree, LibraryOut, NodeSummary};
use crate::{core_bridge::Bridge, ipc::IpcResult};

/// The deepest section groups nest: a top-level group is at depth 1 (NOTES_LIMITS.groupDepth).
pub const GROUP_DEPTH: u32 = 4;

/// A node the commands found: a notebook, or a group, section, or page of one.
#[derive(Clone, Debug)]
pub(crate) enum Found {
    Notebook(NotebookHandle),
    Node(NotebookHandle, NodeRef),
}

impl Found {
    pub(crate) fn notebook(&self) -> &NotebookHandle {
        match self {
            Found::Notebook(notebook) | Found::Node(notebook, _) => notebook,
        }
    }

    pub(crate) fn kind(&self) -> NodeKind {
        match self {
            Found::Notebook(_) => NodeKind::Notebook,
            Found::Node(_, NodeRef::Group(_)) => NodeKind::SectionGroup,
            Found::Node(_, NodeRef::Section(_)) => NodeKind::Section,
            Found::Node(_, NodeRef::Page(_)) => NodeKind::Page,
        }
    }

    /// The node's ID text.
    pub(crate) fn id(&self) -> String {
        match self {
            Found::Notebook(notebook) => notebook.id().to_string(),
            Found::Node(_, node) => node_id(*node).to_string(),
        }
    }
}

/// The ID of a group, section, or page.
pub(crate) fn node_id(node: NodeRef) -> Id {
    match node {
        NodeRef::Group(GroupId(id)) => id,
        NodeRef::Section(SectionId(id)) => id,
        NodeRef::Page(page) => page.0,
    }
}

pub(crate) fn kind_name(kind: NodeKind) -> &'static str {
    match kind {
        NodeKind::Notebook => "notebook",
        NodeKind::SectionGroup => "sectionGroup",
        NodeKind::Section => "section",
        NodeKind::Page => "page",
    }
}

/// A node summary from the core's description of it.
pub(crate) fn summary(info: NodeInfo) -> NodeSummary {
    let page = info.kind == NodeKind::Page;
    NodeSummary {
        id: info.id,
        kind: kind_name(info.kind),
        parent_id: info.parent_id,
        title: info.title,
        color: if page {
            None
        } else {
            info.color.map(|color| color.to_text())
        },
        page_level: info.page_level,
        child_count: info.child_count,
        created: info.created.to_rfc3339(),
        modified: info.modified.to_rfc3339(),
        read_only: info.read_only,
        pinned: info.pinned,
        archived: info.archived,
        encrypted: info.encrypted,
    }
}

/// The groups that hold a group or section, innermost first.
pub(crate) fn group_chain(tree: &NotebookTree, mut group: Option<GroupId>) -> Vec<GroupId> {
    let mut chain = Vec::new();
    while let Some(id) = group {
        if chain.contains(&id) {
            break;
        }
        chain.push(id);
        group = tree.groups.iter().find(|g| g.id == id).and_then(|g| g.parent);
    }
    chain
}

/// How deep a group sits: 1 at the top level. The notebook is at depth 0.
pub(crate) fn depth_of(tree: &NotebookTree, group: Option<GroupId>) -> u32 {
    u32::try_from(group_chain(tree, group).len()).unwrap_or(u32::MAX)
}

/// How many levels of groups a node takes: 0 for a section, 1 for a group without groups inside, and so on.
pub(crate) fn height_of(tree: &NotebookTree, node: NodeRef) -> u32 {
    let NodeRef::Group(group) = node else {
        return 0;
    };
    let inner = tree
        .groups
        .iter()
        .filter(|g| g.parent == Some(group))
        .map(|g| height_of(tree, NodeRef::Group(g.id)))
        .max()
        .unwrap_or(0);
    inner.saturating_add(1)
}

/// The child IDs of a notebook or group, in display order.
pub(crate) fn container_children(tree: &NotebookTree, group: Option<GroupId>) -> Vec<String> {
    tree.children(group)
        .iter()
        .map(|child| match child {
            TreeChild::Group(g) => g.id.to_string(),
            TreeChild::Section(s) => s.id.to_string(),
        })
        .collect()
}

/// A section's pages in display order, with their levels.
pub(crate) fn flat_pages(tree: &NotebookTree, section: SectionId) -> Vec<(String, u8)> {
    tree.section(section)
        .map(|s| s.pages.iter().map(|p| (p.id.to_string(), p.level)).collect())
        .unwrap_or_default()
}

/// The page at `index` and the pages after it with a higher level: the page with its subpages.
pub(crate) fn block_at(flat: &[(String, u8)], index: usize) -> Vec<String> {
    let Some((_, root)) = flat.get(index) else {
        return Vec::new();
    };
    let mut block = Vec::new();
    for (i, (id, level)) in flat.iter().enumerate().skip(index) {
        if i > index && level <= root {
            break;
        }
        block.push(id.clone());
    }
    block
}

impl Bridge {
    /// The open notebooks of the library, in display order.
    pub(crate) fn notebooks(&self) -> Vec<NotebookHandle> {
        self.core
            .library()
            .notebooks
            .iter()
            .filter_map(|entry| self.core.find_open(&entry.path))
            .collect()
    }

    /// The node with this ID, or `not-found`.
    pub(crate) fn find(&self, id: &str) -> IpcResult<Found> {
        let parsed = Id::parse(id).map_err(|_| not_found(id))?;
        let listed = self.notebooks();
        match self.core.find_node(parsed) {
            Some((notebook, found)) if listed.iter().any(|n| n.id() == notebook.id()) => Ok(match found {
                None => Found::Notebook(notebook),
                Some(node) => Found::Node(notebook, node),
            }),
            _ => Err(not_found(id)),
        }
    }

    /// The summary of a node that was just found or made.
    pub(crate) fn summary_of(&self, found: &Found) -> IpcResult<NodeSummary> {
        let tree = found.notebook().tree();
        let info = match found {
            Found::Notebook(_) => Some(notebook_node(&tree)),
            Found::Node(_, node_ref) => node(&tree, node_id(*node_ref)),
        };
        info.map(summary).ok_or_else(|| not_found(&found.id()))
    }

    pub(crate) fn list_notebooks(&self) -> Vec<NodeSummary> {
        self.notebooks()
            .iter()
            .map(|notebook| summary(notebook_node(&notebook.tree())))
            .collect()
    }

    pub(crate) fn list_children(&self, parent: &str) -> IpcResult<Vec<NodeSummary>> {
        let found = self.find(parent)?;
        if let Found::Node(_, NodeRef::Page(_)) = found {
            return Ok(Vec::new());
        }
        let tree = found.notebook().tree();
        let id = Id::parse(parent).map_err(|_| not_found(parent))?;
        let children = children_of(&tree, id).ok_or_else(|| not_found(parent))?;
        Ok(children.into_iter().map(summary).collect())
    }

    pub(crate) fn get_node(&self, id: &str) -> Option<NodeSummary> {
        self.find(id).ok().and_then(|found| self.summary_of(&found).ok())
    }

    /// Every listed node's place in display order: the notebooks in library order, each followed by its tree.
    pub(crate) fn display_order(&self) -> HashMap<String, usize> {
        let mut order = HashMap::new();
        for notebook in self.notebooks() {
            for info in all_nodes(&notebook.tree()) {
                let next = order.len();
                order.entry(info.id).or_insert(next);
            }
        }
        order
    }

    pub(crate) fn load_initial(&self, path: &[String]) -> IpcResult<InitialTree> {
        let mut resolved: Vec<(String, NodeSummary)> = Vec::new();
        for id in path {
            let parent = resolved.last().map(|(id, _)| id.clone());
            let Some(found) = self.get_node(id) else {
                break;
            };
            if found.parent_id != parent {
                break;
            }
            resolved.push((id.clone(), found));
        }
        let mut children = BTreeMap::new();
        for (id, found) in &resolved {
            if found.kind != "page" {
                children.insert(id.clone(), self.list_children(id)?);
            }
        }
        let page = resolved
            .last()
            .filter(|(_, found)| found.kind == "page")
            .map(|(_, found)| found.clone());
        let folder = self
            .notes
            .folder
            .as_ref()
            .map(|f| f.display().to_string())
            .unwrap_or_default();
        Ok(InitialTree {
            library: LibraryOut {
                folder,
                read_only: false,
            },
            notebooks: self.list_notebooks(),
            children,
            resolved_path: resolved.into_iter().map(|(id, _)| id).collect(),
            page,
        })
    }
}
