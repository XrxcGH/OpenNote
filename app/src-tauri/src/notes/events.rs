//! The notes events: after each command, and after tree changes the core makes on its own, the bridge compares
//! the library and each notebook's tree with what it last sent and sends `upserted`, `removed`, and
//! `childrenChanged` events (crates/core/src/session/tree_events.rs). Applying them is idempotent.

use std::collections::HashMap;

use opennote_core::{
    model::NotebookTree,
    session::{
        notes::{all_nodes, notebook_node},
        tree_events::{diff, TreeEvent},
    },
};
use serde_json::{json, Value};

use super::{tree::summary, NOTES_EVENT};
use crate::core_bridge::Bridge;

/// What the interface last heard: the notebooks in order and their trees.
pub(crate) struct Seen {
    order: Vec<String>,
    trees: HashMap<String, NotebookTree>,
}

fn event_json(event: TreeEvent) -> Value {
    match event {
        TreeEvent::Upserted { nodes } => {
            let nodes: Vec<_> = nodes.into_iter().map(summary).collect();
            json!({ "type": "upserted", "nodes": nodes })
        }
        TreeEvent::Removed { ids } => json!({ "type": "removed", "ids": ids }),
        TreeEvent::ChildrenChanged { parent_id } => json!({ "type": "childrenChanged", "parentId": parent_id }),
        TreeEvent::Reset => json!({ "type": "reset" }),
    }
}

/// A page moved between notebooks is removed from the old one and upserted in the new one. Which comes first
/// depends on library order, and a removal after the upsert would delete the node just added, so ids that
/// this pass also upserts are not reported as removed.
fn drop_moved_removals(events: &mut Vec<TreeEvent>) {
    let upserted: std::collections::HashSet<String> = events
        .iter()
        .filter_map(|event| match event {
            TreeEvent::Upserted { nodes } => Some(nodes.iter().map(|n| n.id.clone())),
            _ => None,
        })
        .flatten()
        .collect();
    if upserted.is_empty() {
        return;
    }
    for event in events.iter_mut() {
        if let TreeEvent::Removed { ids } = event {
            ids.retain(|id| !upserted.contains(id));
        }
    }
    events.retain(|event| !matches!(event, TreeEvent::Removed { ids } if ids.is_empty()));
}

impl Bridge {
    /// Sends the events that take the interface from what it last heard to the tree as it is now.
    pub(crate) fn send_tree_events(&mut self) {
        let notebooks = self.notebooks();
        let now = Seen {
            order: notebooks.iter().map(|n| n.id().to_string()).collect(),
            trees: notebooks.iter().map(|n| (n.id().to_string(), n.tree())).collect(),
        };
        let Some(old) = self.notes.seen.replace(now) else {
            return;
        };
        let Some(now) = self.notes.seen.as_ref() else {
            return;
        };
        let mut events = Vec::new();
        for (id, tree) in &old.trees {
            if !now.trees.contains_key(id) {
                let ids: Vec<String> = all_nodes(tree).into_iter().map(|n| n.id).collect();
                events.push(TreeEvent::Removed { ids });
            }
        }
        for id in &now.order {
            let Some(tree) = now.trees.get(id) else {
                continue;
            };
            match old.trees.get(id) {
                Some(before) => events.extend(diff(before, tree)),
                None => events.push(TreeEvent::Upserted {
                    nodes: vec![notebook_node(tree)],
                }),
            }
        }
        if old.order != now.order {
            events.push(TreeEvent::ChildrenChanged { parent_id: None });
        }
        drop_moved_removals(&mut events);
        for event in events {
            self.relay.send(NOTES_EVENT, event_json(event));
        }
    }
}
