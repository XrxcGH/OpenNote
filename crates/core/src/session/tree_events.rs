//! The notes contract's fine-grained tree events, from two snapshots of a notebook's tree. Owned by WP5.
//!
//! The core reports every tree change as one `TreeChanged` event. The app bridge keeps the last tree it sent
//! for each notebook, reads the new one, and calls [`diff`], which gives `upserted` for new or changed nodes,
//! `removed` for nodes that are gone, and `childrenChanged` for each parent whose children changed order or
//! membership. Applying the events is idempotent, as the contract requires. A notebook that closes, or a
//! folder that changes under the app, gets `reset`.

use std::collections::{BTreeMap, BTreeSet};

use serde::Serialize;

use crate::model::NotebookTree;
use crate::session::notes::{all_nodes, NodeInfo};

/// One event of the notes contract.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum TreeEvent {
    /// Nodes that are new or changed.
    Upserted {
        /// The nodes as they are now.
        nodes: Vec<NodeInfo>,
    },
    /// Nodes that are gone.
    Removed {
        /// Their IDs.
        ids: Vec<String>,
    },
    /// A parent whose children changed order or membership: re-list it.
    ChildrenChanged {
        /// The parent's ID.
        parent_id: Option<String>,
    },
    /// Reload everything.
    Reset,
}

/// The events that take the interface from `old` to `new`, in the order to apply them.
pub fn diff(old: &NotebookTree, new: &NotebookTree) -> Vec<TreeEvent> {
    if old.notebook != new.notebook {
        return vec![TreeEvent::Reset];
    }
    let before = all_nodes(old);
    let after = all_nodes(new);
    let old_by_id: BTreeMap<&str, &NodeInfo> = before.iter().map(|n| (n.id.as_str(), n)).collect();
    let new_ids: BTreeSet<&str> = after.iter().map(|n| n.id.as_str()).collect();
    let upserted: Vec<NodeInfo> = after
        .iter()
        .filter(|n| old_by_id.get(n.id.as_str()) != Some(n))
        .cloned()
        .collect();
    let removed: Vec<String> = before
        .iter()
        .filter(|n| !new_ids.contains(n.id.as_str()))
        .map(|n| n.id.clone())
        .collect();
    let mut events = Vec::new();
    if !removed.is_empty() {
        events.push(TreeEvent::Removed { ids: removed });
    }
    if !upserted.is_empty() {
        events.push(TreeEvent::Upserted { nodes: upserted });
    }
    let (old_children, new_children) = (children(&before), children(&after));
    let parents: BTreeSet<&Option<String>> = old_children.keys().chain(new_children.keys()).collect();
    for parent in parents {
        if old_children.get(parent) != new_children.get(parent) {
            events.push(TreeEvent::ChildrenChanged {
                parent_id: parent.clone(),
            });
        }
    }
    events
}

/// Each parent's children, in display order.
fn children(nodes: &[NodeInfo]) -> BTreeMap<Option<String>, Vec<&str>> {
    let mut map: BTreeMap<Option<String>, Vec<&str>> = BTreeMap::new();
    for node in nodes {
        map.entry(node.parent_id.clone()).or_default().push(node.id.as_str());
    }
    map
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::session::notebook::{NodePlacement, NodeRef, ParentRef};
    use crate::store::notebook_store::kit::Kit;

    #[test]
    fn diffs_name_what_changed_and_where() {
        let kit = Kit::new();
        let mut store = kit.open().unwrap_or_else(|e| panic!("{e}"));
        let lab = store
            .create_section("Lab", None, None)
            .unwrap_or_else(|e| panic!("{e}"));
        let page = store
            .create_page(lab, None, None, "A")
            .unwrap_or_else(|e| panic!("{e}"));
        let before = store.tree();
        assert!(diff(&before, &before).is_empty());
        store
            .rename(NodeRef::Section(lab), "Labs")
            .unwrap_or_else(|e| panic!("{e}"));
        let b = store
            .create_page(lab, None, Some(page), "B")
            .unwrap_or_else(|e| panic!("{e}"));
        let after = store.tree();
        let events = diff(&before, &after);
        let upserted: Vec<String> = events
            .iter()
            .filter_map(|e| match e {
                TreeEvent::Upserted { nodes } => Some(nodes.iter().map(|n| n.title.clone()).collect::<Vec<_>>()),
                _ => None,
            })
            .flatten()
            .collect();
        assert!(upserted.contains(&"Labs".to_owned()) && upserted.contains(&"B".to_owned()));
        assert!(events.contains(&TreeEvent::ChildrenChanged {
            parent_id: Some(lab.to_string())
        }));
        let to = NodePlacement {
            parent: ParentRef::Section(lab),
            before: None,
        };
        store.move_node(NodeRef::Page(b), &to).unwrap_or_else(|e| panic!("{e}"));
        store
            .delete(&[NodeRef::Page(page)], crate::model::TrashReason::Deleted)
            .unwrap_or_else(|e| panic!("{e}"));
        let last = diff(&after, &store.tree());
        assert!(last.contains(&TreeEvent::Removed {
            ids: vec![page.to_string()]
        }));
        let json = serde_json::to_value(&last).unwrap_or_default();
        assert_eq!(json[0]["type"], "removed");
    }
}
