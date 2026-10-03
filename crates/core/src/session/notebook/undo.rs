//! The tree's undo and redo stacks (plan 7.3): one per notebook, for creating, renaming, recoloring, moving,
//! and deleting nodes. Undoing a deletion restores the items from Trash.

use crate::id::TrashItemId;
use crate::session::notebook::{NodePlacement, NodeProps, NodeRef};

/// Most tree changes each stack keeps.
const MAX_ACTIONS: usize = 100;

/// A tree change, with what it takes to reverse it.
#[derive(Clone, Debug, PartialEq)]
pub(crate) enum TreeAction {
    /// Nodes were made, or restored. Reversing deletes them to Trash.
    Created(Vec<NodeRef>),
    /// Nodes went to Trash as these items. Reversing restores the items.
    Deleted(Vec<TrashItemId>),
    /// A node's title changed.
    Renamed {
        /// The node.
        node: NodeRef,
        /// The title before.
        before: String,
        /// The title after.
        after: String,
    },
    /// A node's color or pin changed.
    Props {
        /// The node.
        node: NodeRef,
        /// The properties before.
        before: NodeProps,
        /// The properties after.
        after: NodeProps,
    },
    /// A node moved within the notebook.
    Moved {
        /// The node.
        node: NodeRef,
        /// Where it was.
        before: NodePlacement,
    },
}

/// A notebook's tree undo and redo stacks. Reversing an action gives the action that reverses it back, so
/// undo and redo use the same machinery.
#[derive(Clone, Debug, Default)]
pub(crate) struct TreeUndo {
    undo: Vec<TreeAction>,
    redo: Vec<TreeAction>,
}

impl TreeUndo {
    /// Records a new change. It clears the redo stack.
    pub(crate) fn record(&mut self, action: TreeAction) {
        self.undo.push(action);
        if self.undo.len() > MAX_ACTIONS {
            self.undo.remove(0);
        }
        self.redo.clear();
    }

    /// Takes the change to undo, or to redo.
    pub(crate) fn take(&mut self, redo: bool) -> Option<TreeAction> {
        if redo {
            self.redo.pop()
        } else {
            self.undo.pop()
        }
    }

    /// Puts the reverse of an undone change on the redo stack, or of a redone one on the undo stack.
    pub(crate) fn push_reverse(&mut self, redo: bool, reverse: TreeAction) {
        if redo {
            self.undo.push(reverse);
        } else {
            self.redo.push(reverse);
        }
    }

    /// Drops everything, such as after a scan changed the tree underneath.
    pub(crate) fn clear(&mut self) {
        self.undo.clear();
        self.redo.clear();
    }
}
