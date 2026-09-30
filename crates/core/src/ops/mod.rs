//! Operations and transactions (plan section 7, spec 20.7).
//!
//! An operation is resolved: it holds everything needed to apply it, check it, and invert it, with no clock
//! reads or randomness left. Every operation that changes a block stores that block's `modified` time before
//! and after, so undo restores timestamps exactly. This module defines the data. Applying, inverting,
//! resolving, and undo live in the submodules.

use std::sync::Arc;

use serde::{Deserialize, Serialize};

use crate::id::{AssetId, BlockId, ClientId, StrokeId, TxnId};
use crate::model::{named_enum, Affine, Asset, Block, Frame, JsonMap, PageView, Stroke, StrokeStyle};
use crate::order::OrderKey;
use crate::time::Timestamp;

/// One resolved change to a page.
#[derive(Clone, Debug, PartialEq)]
pub enum Op {
    /// Changes page fields. Holds only the fields that changed.
    SetPage {
        /// The fields as they were.
        before: PageFields,
        /// The fields as they become.
        after: PageFields,
    },
    /// Adds whole blocks, with their order keys and timestamps.
    InsertBlocks {
        /// The new blocks.
        blocks: Vec<Arc<Block>>,
    },
    /// Removes whole blocks, and every stroke of any ink block among them.
    DeleteBlocks {
        /// The removed blocks as they were.
        blocks: Vec<Arc<Block>>,
        /// The strokes of removed ink blocks.
        strokes: Vec<Arc<Stroke>>,
    },
    /// Moves a block.
    MoveBlock {
        /// The block.
        id: BlockId,
        /// Its placement before.
        before: Placement,
        /// Its placement after.
        after: Placement,
        /// Its `modified` time before and after.
        stamps: Stamps,
    },
    /// Changes `lock`, `data`, or `fallback` with JSON merge patches (RFC 7396).
    PatchBlock {
        /// The block.
        id: BlockId,
        /// The patch that undoes the change.
        before: JsonMap,
        /// The patch that makes the change.
        after: JsonMap,
        /// Its `modified` time before and after.
        stamps: Stamps,
    },
    /// Changes a text block's Markdown.
    EditText {
        /// The text block.
        id: BlockId,
        /// The splices, applied in order.
        splices: Vec<Splice>,
        /// Its `modified` time before and after.
        stamps: Stamps,
    },
    /// Adds whole strokes.
    AddStrokes {
        /// The new strokes.
        strokes: Vec<Arc<Stroke>>,
    },
    /// Removes whole strokes.
    RemoveStrokes {
        /// The removed strokes as they were.
        strokes: Vec<Arc<Stroke>>,
    },
    /// Changes style, transform, or ink block of strokes.
    SetStrokeProps {
        /// One change per stroke.
        items: Vec<StrokePropsChange>,
    },
    /// Adds an entry to the asset table. The file is already on disk.
    AddAsset {
        /// The entry.
        asset: Asset,
    },
    /// Removes an entry from the asset table. The file stays for history and undo.
    RemoveAsset {
        /// The entry as it was.
        asset: Asset,
    },
}

/// Page fields that `SetPage` changes. `None` leaves a field out.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct PageFields {
    /// The title.
    pub title: Option<String>,
    /// The tags.
    pub tags: Option<Vec<String>>,
    /// The view settings, boxed to keep operations small in undo stacks.
    pub view: Option<Box<PageView>>,
    /// The reading order of a freeform page (spec 6.2).
    pub reading_order: Option<Vec<BlockId>>,
}

/// A block's order key and frame.
#[derive(Clone, Debug, PartialEq)]
pub struct Placement {
    /// The order key.
    pub order: OrderKey,
    /// The frame.
    pub frame: Option<Frame>,
}

/// A block's `modified` time before and after an operation.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Stamps {
    /// Before.
    pub before: Timestamp,
    /// After.
    pub after: Timestamp,
}

/// Replaces `del` at UTF-8 byte offset `at` with `ins`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Splice {
    /// A byte offset into the UTF-8 text, on a character boundary.
    pub at: u32,
    /// The text removed.
    pub del: String,
    /// The text inserted.
    pub ins: String,
}

/// A stroke's properties before and after `SetStrokeProps`.
#[derive(Clone, Debug, PartialEq)]
pub struct StrokePropsChange {
    /// The stroke.
    pub id: StrokeId,
    /// Before.
    pub before: StrokeState,
    /// After.
    pub after: StrokeState,
}

/// The properties `SetStrokeProps` changes.
#[derive(Clone, Debug, PartialEq)]
pub struct StrokeState {
    /// The style.
    pub style: StrokeStyle,
    /// The transform. `None` is the identity.
    pub transform: Option<Affine>,
    /// The ink block.
    pub block: BlockId,
}

/// Operations that apply together: all of them or none.
#[derive(Clone, Debug, PartialEq)]
pub struct Txn {
    /// The transaction's ID.
    pub id: TxnId,
    /// When it was applied.
    pub at: Timestamp,
    /// Where it came from.
    pub origin: Origin,
    /// The window or editor that made it.
    pub client: ClientId,
    /// How it may join the undo entry before it.
    pub coalesce: Option<CoalesceKey>,
    /// The interface's selection before and after, returned on undo and redo. Opaque to the core.
    pub ui: Option<serde_json::Value>,
    /// The operations, in order.
    pub ops: Vec<Op>,
}

named_enum! {
    /// Where a transaction came from.
    Origin {
        /// An edit in this app.
        Local = "local",
        /// An undo.
        Undo = "undo",
        /// A redo.
        Redo = "redo",
        /// Crash recovery.
        Recovery = "recovery",
    }
}

named_enum! {
    /// The kinds of edits that group into one undo step (plan 7.3).
    CoalesceKind {
        /// Typing in one block.
        Typing = "typing",
        /// Dragging, keyed by gesture.
        Drag = "drag",
        /// Resizing, keyed by gesture.
        Resize = "resize",
        /// Rotating, keyed by gesture.
        Rotate = "rotate",
        /// Erasing, keyed by gesture.
        Erase = "erase",
        /// A slider. The key names the block and the property.
        Slider = "slider",
    }
}

/// How a transaction may join the undo entry before it.
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct CoalesceKey {
    /// The kind of edit.
    pub kind: CoalesceKind,
    /// The block ID, gesture ID, or block and property it applies to.
    pub target: String,
}

/// What a transaction changed, for the interface and the search index.
#[derive(Clone, Debug, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedChanges {
    /// Title, tags, view, or reading order changed.
    pub page_fields: bool,
    /// Blocks added or changed.
    pub blocks_changed: Vec<BlockId>,
    /// Blocks removed.
    pub blocks_removed: Vec<BlockId>,
    /// Strokes added.
    pub strokes_added: Vec<StrokeId>,
    /// Strokes removed.
    pub strokes_removed: Vec<StrokeId>,
    /// Strokes whose properties changed.
    pub strokes_changed: Vec<StrokeId>,
    /// Asset table entries added or removed.
    pub assets_changed: Vec<AssetId>,
}
