//! Where a node is now, as a placement a move can use to put it back: the tree undo's record of moves.

use super::flat::flat_parent;
use super::{not_found, NotebookStore};
use crate::error::CoreError;
use crate::id::{GroupId, Id, SectionId};
use crate::session::notebook::{NodePlacement, NodeRef, ParentRef};

impl NotebookStore {
    /// A node's parent and the sibling right after it.
    pub fn placement_of(&self, node: NodeRef) -> Result<NodePlacement, CoreError> {
        match node {
            NodeRef::Group(g) => {
                let parent = self
                    .display_groups()
                    .into_iter()
                    .find(|group| group.id == g)
                    .ok_or_else(|| not_found(format!("group {g}")))?
                    .parent;
                Ok(self.child_placement(g.0, parent))
            }
            NodeRef::Section(s) => {
                let groups = self.display_groups();
                let group = self
                    .section(s)?
                    .file
                    .group
                    .filter(|g| groups.iter().any(|x| x.id == *g));
                Ok(self.child_placement(s.0, group))
            }
            NodeRef::Page(p) => {
                let (section, block) = self.subtree(p)?;
                let flat = self.flat_pages(section)?;
                let index = flat
                    .iter()
                    .position(|f| f.id == p)
                    .ok_or_else(|| not_found(format!("page {p}")))?;
                let parent = match flat_parent(&flat, index) {
                    Some(q) => ParentRef::Page(q),
                    None => ParentRef::Section(section),
                };
                let level = flat.get(index).map_or(0, |f| f.level);
                let next = flat.get(index.saturating_add(block.len()));
                let before = next.filter(|f| f.level == level).map(|f| NodeRef::Page(f.id));
                Ok(NodePlacement { parent, before })
            }
        }
    }

    fn child_placement(&self, id: Id, parent: Option<GroupId>) -> NodePlacement {
        let siblings = self.children_of(parent, None);
        let next = siblings
            .iter()
            .position(|s| s.1 == id)
            .and_then(|i| siblings.get(i.saturating_add(1)))
            .map(|s| s.1);
        let before = next.map(|n| {
            if self.notebook.groups.iter().any(|g| g.id.0 == n) {
                NodeRef::Group(GroupId(n))
            } else {
                NodeRef::Section(SectionId(n))
            }
        });
        NodePlacement {
            parent: parent.map_or(ParentRef::Notebook, ParentRef::Group),
            before,
        }
    }
}
