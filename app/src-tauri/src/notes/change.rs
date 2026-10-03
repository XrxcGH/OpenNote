//! Changing the tree: create, rename, colors, moves, and page levels, with the contract's rules checked before
//! anything changes, so a call that rejects changes nothing (ARCHITECTURE.md section 12.2).

use std::collections::HashSet;

use opennote_core::{
    model::{Color, NotebookTree, PEN_NAMES},
    session::{
        notebook::{NodePlacement, NodeProps, NodeRef, NotebookHandle, ParentRef},
        notes::{check_title, NodeKind},
    },
    GroupId, Id, PageId, SectionId,
};

use super::{
    from_core, invalid_move,
    tree::{block_at, container_children, depth_of, flat_pages, group_chain, height_of, Found, GROUP_DEPTH},
    CreateInput, NodeSummary, Placement,
};
use crate::{core_bridge::Bridge, ipc::IpcError, ipc::IpcResult};

/// The highest page level: a sub-subpage.
const MAX_LEVEL: u8 = 2;

fn default_title(kind: NodeKind) -> &'static str {
    match kind {
        NodeKind::Notebook => "Untitled notebook",
        NodeKind::SectionGroup => "Untitled section group",
        NodeKind::Section => "Untitled section",
        NodeKind::Page => "Untitled page",
    }
}

fn parse_kind(kind: &str) -> IpcResult<NodeKind> {
    match kind {
        "notebook" => Ok(NodeKind::Notebook),
        "sectionGroup" => Ok(NodeKind::SectionGroup),
        "section" => Ok(NodeKind::Section),
        "page" => Ok(NodeKind::Page),
        _ => Err(IpcError::invalid("kind", "isn't a kind of node")),
    }
}

/// A pen name as a color; anything else is no color.
pub(crate) fn pen(color: Option<&str>) -> Option<Color> {
    color
        .filter(|name| PEN_NAMES.contains(name))
        .map(|name| Color::Palette(name.into()))
}

fn title_of(text: &str) -> IpcResult<String> {
    check_title(text).map_err(from_core)
}

/// Whether a parent of this kind holds children of that kind.
fn can_hold(parent: Option<NodeKind>, child: NodeKind) -> bool {
    matches!(
        (parent, child),
        (None, NodeKind::Notebook)
            | (
                Some(NodeKind::Notebook | NodeKind::SectionGroup),
                NodeKind::SectionGroup | NodeKind::Section
            )
            | (Some(NodeKind::Section), NodeKind::Page)
    )
}

/// The containers above a node, innermost first, ending with its notebook.
pub(crate) fn ancestors(found: &Found) -> Vec<String> {
    let notebook = found.notebook();
    let tree = notebook.tree();
    let mut out = Vec::new();
    let group = match found {
        Found::Notebook(_) => return out,
        Found::Node(_, NodeRef::Group(g)) => tree.groups.iter().find(|x| x.id == *g).and_then(|x| x.parent),
        Found::Node(_, NodeRef::Section(s)) => tree.section(*s).and_then(|x| x.group),
        Found::Node(_, NodeRef::Page(p)) => {
            let Some((section, _)) = tree.find_page(*p) else {
                return out;
            };
            out.push(section.id.to_string());
            section.group
        }
    };
    out.extend(group_chain(&tree, group).iter().map(ToString::to_string));
    out.push(notebook.id().to_string());
    out
}

/// The index in `reduced` where moved nodes go: before `before`, or after the moved ones when `before` moves too.
fn insertion_index(target: &[String], reduced: &[String], before: Option<&str>, moved: &HashSet<String>) -> usize {
    let Some(before) = before else {
        return reduced.len();
    };
    let anchor = if moved.contains(before) {
        let at = target.iter().position(|id| id == before).unwrap_or(target.len());
        target.iter().skip(at).find(|id| !moved.contains(*id)).cloned()
    } else {
        Some(before.to_owned())
    };
    anchor
        .and_then(|anchor| reduced.iter().position(|id| *id == anchor))
        .unwrap_or(reduced.len())
}

/// Fits page blocks inserted at `index` of `reduced`: each block's first page rises to at most one level below
/// the page before it. Returns each root's new level, or `None` when the page after them would be too deep.
pub(crate) fn fit_blocks(reduced: &[(String, u8)], index: usize, blocks: &[Vec<(String, u8)>]) -> Option<Vec<u8>> {
    let mut previous: i32 = match index.checked_sub(1).and_then(|i| reduced.get(i)) {
        Some((_, level)) => i32::from(*level),
        None => -1,
    };
    let mut roots = Vec::with_capacity(blocks.len());
    for block in blocks {
        let (Some((_, first)), Some((_, last))) = (block.first(), block.last()) else {
            continue;
        };
        let first = i32::from(*first);
        let delta = first.min(previous + 1) - first;
        roots.push(u8::try_from(first + delta).unwrap_or(0));
        previous = i32::from(*last) + delta;
    }
    match reduced.get(index) {
        Some((_, next)) if i32::from(*next) > previous + 1 => None,
        _ => Some(roots),
    }
}

/// Whether a flat list of levels keeps the rules: it starts at 0, and each page is at most one deeper than the one
/// before it.
pub(crate) fn levels_valid(levels: &[u8]) -> bool {
    let mut previous: i32 = -1;
    levels.iter().all(|&level| {
        let ok = level <= MAX_LEVEL && i32::from(level) <= previous + 1;
        previous = i32::from(level);
        ok
    })
}

/// The pages of `flat` that start a block, with the block's pages and their levels.
pub(crate) fn blocks_of(flat: &[(String, u8)], roots: &[String]) -> Vec<Vec<(String, u8)>> {
    roots
        .iter()
        .filter_map(|root| flat.iter().position(|(id, _)| id == root))
        .map(|index| {
            block_at(flat, index)
                .into_iter()
                .filter_map(|id| flat.iter().find(|(x, _)| *x == id).cloned())
                .collect()
        })
        .collect()
}

/// A section's place in a notebook, as a parent for its pages.
fn section_of(found: &Found) -> Option<SectionId> {
    match found {
        Found::Node(_, NodeRef::Section(section)) => Some(*section),
        _ => None,
    }
}

impl Bridge {
    /// The NodeRef of a group or section of `notebook` by ID, if it is a child of `group` there.
    fn container_ref(tree: &NotebookTree, id: &str) -> Option<NodeRef> {
        let parsed = Id::parse(id).ok()?;
        if tree.groups.iter().any(|g| g.id.0 == parsed) {
            return Some(NodeRef::Group(GroupId(parsed)));
        }
        tree.section(SectionId(parsed)).map(|s| NodeRef::Section(s.id))
    }

    /// Checks a `beforeId` among the children `siblings`: unknown is `not-found`, elsewhere is `invalid-move`.
    fn check_before(&self, before: Option<&str>, siblings: &[String]) -> IpcResult<()> {
        if let Some(before) = before {
            self.find(before)?;
            if !siblings.iter().any(|id| id == before) {
                return Err(invalid_move(
                    "The node to place before isn't a child of the new parent.",
                ));
            }
        }
        Ok(())
    }

    pub(crate) fn create(&mut self, input: CreateInput) -> IpcResult<NodeSummary> {
        let kind = parse_kind(&input.kind)?;
        let title = title_of(input.title.as_deref().unwrap_or(default_title(kind)))?;
        let parent = match input.placement.parent_id.as_deref() {
            Some(id) => Some(self.find(id)?),
            None => None,
        };
        if !can_hold(parent.as_ref().map(Found::kind), kind) {
            return Err(invalid_move("That kind of node can't go there."));
        }
        let before = input.placement.before_id.as_deref();
        let color = pen(input.color.as_deref());
        match (kind, parent) {
            (NodeKind::Notebook, _) => self.create_notebook(&title, before, color),
            (NodeKind::Page, Some(found)) => {
                let section = section_of(&found).ok_or_else(|| invalid_move("Pages go into sections."))?;
                self.create_page(found.notebook(), section, &title, before, input.page_level.unwrap_or(0))
            }
            (_, Some(found)) => self.create_container(&found, kind, &title, before, color),
            (_, None) => Err(invalid_move("That kind of node can't go there.")),
        }
    }

    fn create_notebook(&mut self, title: &str, before: Option<&str>, color: Option<Color>) -> IpcResult<NodeSummary> {
        let siblings: Vec<String> = self.notebooks().iter().map(|n| n.id().to_string()).collect();
        self.check_before(before, &siblings)?;
        let folder = self
            .notes
            .folder
            .clone()
            .ok_or_else(|| super::error("unavailable", "Choose a notes folder before making a notebook."))?;
        std::fs::create_dir_all(&folder).map_err(IpcError::from)?;
        let notebook = self.core.create_notebook(&folder, title).map_err(from_core)?;
        if let Some(before) = before.and_then(|id| self.find(id).ok()) {
            let path = before.notebook().path().to_path_buf();
            self.core
                .move_notebook(notebook.path(), Some(&path))
                .map_err(from_core)?;
        }
        if color.is_some() {
            notebook.set_notebook_color(color).map_err(from_core)?;
        }
        self.summary_of(&Found::Notebook(notebook))
    }

    fn create_container(
        &mut self,
        parent: &Found,
        kind: NodeKind,
        title: &str,
        before: Option<&str>,
        color: Option<Color>,
    ) -> IpcResult<NodeSummary> {
        let notebook = parent.notebook().clone();
        let tree = notebook.tree();
        let (at, group) = match parent {
            Found::Notebook(_) => (ParentRef::Notebook, None),
            Found::Node(_, NodeRef::Group(g)) => (ParentRef::Group(*g), Some(*g)),
            _ => {
                return Err(invalid_move(
                    "Groups and sections go into notebooks and section groups.",
                ))
            }
        };
        if kind == NodeKind::SectionGroup && depth_of(&tree, group) + 1 > GROUP_DEPTH {
            return Err(invalid_move("Section groups nest at most 4 deep."));
        }
        self.check_before(before, &container_children(&tree, group))?;
        let placement = NodePlacement {
            parent: at,
            before: before.and_then(|id| Bridge::container_ref(&tree, id)),
        };
        let node = if kind == NodeKind::SectionGroup {
            NodeRef::Group(notebook.create_group(title, placement).map_err(from_core)?)
        } else {
            NodeRef::Section(notebook.create_section(title, placement).map_err(from_core)?)
        };
        if color.is_some() {
            let props = NodeProps {
                color: Some(color),
                ..NodeProps::default()
            };
            notebook.set_props(node, props).map_err(from_core)?;
        }
        self.summary_of(&Found::Node(notebook, node))
    }

    fn create_page(
        &mut self,
        notebook: &NotebookHandle,
        section: SectionId,
        title: &str,
        before: Option<&str>,
        level: u8,
    ) -> IpcResult<NodeSummary> {
        let flat = flat_pages(&notebook.tree(), section);
        let ids: Vec<String> = flat.iter().map(|(id, _)| id.clone()).collect();
        self.check_before(before, &ids)?;
        let index = before
            .and_then(|b| ids.iter().position(|id| id == b))
            .unwrap_or(ids.len());
        let previous = index
            .checked_sub(1)
            .and_then(|i| flat.get(i))
            .map_or(-1, |(_, l)| i32::from(*l));
        let next_too_deep = flat.get(index).is_some_and(|(_, next)| *next > level.saturating_add(1));
        if level > MAX_LEVEL || i32::from(level) > previous + 1 || next_too_deep {
            return Err(invalid_move("The page level breaks the rules."));
        }
        let at_end = NodePlacement {
            parent: ParentRef::Section(section),
            before: None,
        };
        let page = notebook.create_page_titled(section, at_end, title).map_err(from_core)?;
        if index < flat.len() || level > 0 {
            notebook
                .move_page_blocks(&[(page, level)], section, index)
                .map_err(from_core)?;
        }
        self.summary_of(&Found::Node(notebook.clone(), NodeRef::Page(page)))
    }

    pub(crate) fn rename(&mut self, id: &str, title: &str) -> IpcResult<NodeSummary> {
        let found = self.find(id)?;
        let title = title_of(title)?;
        match &found {
            Found::Notebook(notebook) => notebook.rename_notebook(&title),
            Found::Node(notebook, node) => notebook.rename(*node, &title),
        }
        .map_err(from_core)?;
        self.summary_of(&found)
    }

    pub(crate) fn set_color(&mut self, id: &str, color: Option<String>) -> IpcResult<NodeSummary> {
        let found = self.find(id)?;
        let color = pen(color.as_deref());
        match &found {
            Found::Notebook(notebook) => notebook.set_notebook_color(color).map_err(from_core)?,
            Found::Node(_, NodeRef::Page(_)) => {}
            Found::Node(notebook, node) => {
                let props = NodeProps {
                    color: Some(color),
                    ..NodeProps::default()
                };
                notebook.set_props(*node, props).map_err(from_core)?;
            }
        }
        self.summary_of(&found)
    }

    /// The contract's move: the nodes go before `beforeId` among the new parent's children, in the given order.
    pub(crate) fn move_nodes(&mut self, ids: &[String], placement: &Placement) -> IpcResult<()> {
        let mut seen = HashSet::new();
        let mut found = Vec::new();
        for id in ids {
            if seen.insert(id.clone()) {
                found.push(self.find(id)?);
            }
        }
        let parent = match placement.parent_id.as_deref() {
            Some(id) => Some(self.find(id)?),
            None => None,
        };
        let parent_kind = parent.as_ref().map(Found::kind);
        for node in &found {
            if !can_hold(parent_kind, node.kind()) {
                return Err(invalid_move("That kind of node can't go there."));
            }
            if let Some(parent) = &parent {
                if parent.id() == node.id() || ancestors(parent).contains(&node.id()) {
                    return Err(invalid_move("A node can't move into itself."));
                }
            }
        }
        let before = placement.before_id.as_deref();
        match parent {
            None => self.move_notebooks(&found, before),
            Some(parent) if parent_kind == Some(NodeKind::Section) => self.move_pages(&found, &parent, before),
            Some(parent) => self.move_containers(&found, &parent, before),
        }
    }

    fn move_notebooks(&mut self, found: &[Found], before: Option<&str>) -> IpcResult<()> {
        let target: Vec<String> = self.notebooks().iter().map(|n| n.id().to_string()).collect();
        self.check_before(before, &target)?;
        let moved: HashSet<String> = found.iter().map(Found::id).collect();
        let reduced: Vec<String> = target.iter().filter(|id| !moved.contains(*id)).cloned().collect();
        let index = insertion_index(&target, &reduced, before, &moved);
        let anchor = match reduced.get(index) {
            Some(id) => Some(self.find(id)?.notebook().path().to_path_buf()),
            None => None,
        };
        for node in found {
            self.core
                .move_notebook(node.notebook().path(), anchor.as_deref())
                .map_err(from_core)?;
        }
        Ok(())
    }

    fn move_containers(&mut self, found: &[Found], parent: &Found, before: Option<&str>) -> IpcResult<()> {
        let target_notebook = parent.notebook().clone();
        let tree = target_notebook.tree();
        let (at, group) = match parent {
            Found::Notebook(_) => (ParentRef::Notebook, None),
            Found::Node(_, NodeRef::Group(g)) => (ParentRef::Group(*g), Some(*g)),
            _ => {
                return Err(invalid_move(
                    "Groups and sections go into notebooks and section groups.",
                ))
            }
        };
        let depth = depth_of(&tree, group);
        for node in found {
            if let Found::Node(notebook, node_ref) = node {
                if depth + height_of(&notebook.tree(), *node_ref) > GROUP_DEPTH {
                    return Err(invalid_move("Section groups nest at most 4 deep."));
                }
            }
        }
        let target = container_children(&tree, group);
        self.check_before(before, &target)?;
        let ids: HashSet<String> = found.iter().map(Found::id).collect();
        let roots: Vec<&Found> = found
            .iter()
            .filter(|node| !ancestors(node).iter().any(|a| ids.contains(a)))
            .collect();
        let moved: HashSet<String> = roots.iter().map(|node| node.id()).collect();
        let reduced: Vec<String> = target.iter().filter(|id| !moved.contains(*id)).cloned().collect();
        let index = insertion_index(&target, &reduced, before, &moved);
        let anchor = reduced.get(index).and_then(|id| Bridge::container_ref(&tree, id));
        let placement = NodePlacement {
            parent: at,
            before: anchor,
        };
        for root in roots {
            let Found::Node(source, node) = root else {
                continue;
            };
            if source.id() == target_notebook.id() {
                source.move_node(*node, placement).map_err(from_core)?;
            } else {
                source
                    .move_section_to_notebook(*node, &target_notebook, placement)
                    .map_err(from_core)?;
            }
        }
        Ok(())
    }

    fn move_pages(&mut self, found: &[Found], parent: &Found, before: Option<&str>) -> IpcResult<()> {
        let target_notebook = parent.notebook().clone();
        let section = section_of(parent).ok_or_else(|| invalid_move("Pages go into sections."))?;
        let target = flat_pages(&target_notebook.tree(), section);
        let target_ids: Vec<String> = target.iter().map(|(id, _)| id.clone()).collect();
        self.check_before(before, &target_ids)?;
        // Each named page with its subpages, leaving out pages inside another named page's block.
        let mut blocks: Vec<(NotebookHandle, Vec<(String, u8)>)> = Vec::new();
        for node in found {
            let Found::Node(notebook, NodeRef::Page(page)) = node else {
                continue;
            };
            let tree = notebook.tree();
            let Some((home, _)) = tree.find_page(*page) else {
                continue;
            };
            let flat = flat_pages(&tree, home.id);
            if let Some(block) = blocks_of(&flat, &[page.to_string()]).pop() {
                blocks.push((notebook.clone(), block));
            }
        }
        let inside = |root: &str, own: usize| {
            blocks
                .iter()
                .enumerate()
                .any(|(i, (_, block))| i != own && block.iter().skip(1).any(|(id, _)| id == root))
        };
        let blocks: Vec<(NotebookHandle, Vec<(String, u8)>)> = blocks
            .iter()
            .enumerate()
            .filter(|(i, (_, block))| block.first().is_some_and(|(root, _)| !inside(root, *i)))
            .map(|(_, block)| block.clone())
            .collect();
        let moved: HashSet<String> = blocks
            .iter()
            .flat_map(|(_, b)| b.iter().map(|(id, _)| id.clone()))
            .collect();
        let reduced: Vec<(String, u8)> = target.iter().filter(|(id, _)| !moved.contains(id)).cloned().collect();
        let reduced_ids: Vec<String> = reduced.iter().map(|(id, _)| id.clone()).collect();
        let index = insertion_index(&target_ids, &reduced_ids, before, &moved);
        let shapes: Vec<Vec<(String, u8)>> = blocks.iter().map(|(_, b)| b.clone()).collect();
        let levels = fit_blocks(&reduced, index, &shapes)
            .ok_or_else(|| invalid_move("The page after them would be too deep."))?;
        let mut roots = Vec::with_capacity(blocks.len());
        for ((source, block), level) in blocks.iter().zip(levels) {
            let Some(root) = block.first().and_then(|(id, _)| PageId::parse(id).ok()) else {
                continue;
            };
            if source.id() != target_notebook.id() {
                let at_end = NodePlacement {
                    parent: ParentRef::Section(section),
                    before: None,
                };
                source
                    .move_to_notebook(root, &target_notebook, at_end)
                    .map_err(from_core)?;
            }
            roots.push((root, level));
        }
        target_notebook
            .move_page_blocks(&roots, section, index)
            .map_err(from_core)
    }

    /// The contract's setPageLevel: each page, with its subpages, moves to `level` in place.
    pub(crate) fn set_page_level(&mut self, ids: &[String], level: u8) -> IpcResult<()> {
        if level > MAX_LEVEL {
            return Err(invalid_move("Pages nest at most 2 levels deep."));
        }
        let mut pages: Vec<(NotebookHandle, PageId)> = Vec::new();
        let mut seen = HashSet::new();
        for id in ids {
            if !seen.insert(id.clone()) {
                continue;
            }
            match self.find(id)? {
                Found::Node(notebook, NodeRef::Page(page)) => pages.push((notebook, page)),
                _ => return Err(invalid_move("Only pages have levels.")),
            }
        }
        // Check every section first, as the reference model does, so a rejection changes nothing.
        let mut sections: Vec<(NotebookHandle, SectionId, Vec<PageId>)> = Vec::new();
        for (notebook, page) in &pages {
            let tree = notebook.tree();
            let Some((home, _)) = tree.find_page(*page) else {
                continue;
            };
            match sections.iter_mut().find(|(_, s, _)| *s == home.id) {
                Some((_, _, list)) => list.push(*page),
                None => sections.push((notebook.clone(), home.id, vec![*page])),
            }
        }
        for (notebook, section, list) in &sections {
            let flat = flat_pages(&notebook.tree(), *section);
            let mut levels: Vec<u8> = flat.iter().map(|(_, l)| *l).collect();
            let mut targets: Vec<usize> = list
                .iter()
                .filter_map(|p| flat.iter().position(|(id, _)| *id == p.to_string()))
                .collect();
            targets.sort_unstable();
            for index in targets {
                let shaped: Vec<(String, u8)> = flat.iter().zip(&levels).map(|((id, _), l)| (id.clone(), *l)).collect();
                let block = block_at(&shaped, index);
                let delta = i32::from(level) - i32::from(levels.get(index).copied().unwrap_or(0));
                for id in block {
                    if let Some(i) = flat.iter().position(|(x, _)| *x == id) {
                        if let Some(slot) = levels.get_mut(i) {
                            *slot = u8::try_from(i32::from(*slot) + delta).unwrap_or(u8::MAX);
                        }
                    }
                }
            }
            if !levels_valid(&levels) {
                return Err(invalid_move("The page levels would break the rules."));
            }
        }
        for (notebook, _, list) in sections {
            notebook.set_page_level(&list, level).map_err(from_core)?;
        }
        Ok(())
    }
}
