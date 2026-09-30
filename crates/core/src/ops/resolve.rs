//! From interface edits to operations (plan 7.2 and 11.4). Owned by WP3.

use std::sync::Arc;

use serde::Deserialize;

use crate::error::EditError;
use crate::id::{AssetId, BlockId, ClientId, PageId, StrokeId};
use crate::limits::Limits;
use crate::model::{Asset, Frame, JsonMap, Page, Stroke};
use crate::ops::{CoalesceKey, Txn};
use crate::time::Clock;

/// A transaction request from the interface.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TxnRequest {
    /// The page.
    pub page: PageId,
    /// The window or editor.
    pub client: ClientId,
    /// The client's sequence number. A gap or a repeat returns `outOfOrder`.
    pub client_seq: u64,
    /// How it may join the undo entry before it.
    #[serde(default)]
    pub coalesce: Option<CoalesceKey>,
    /// The selection before and after, opaque to the core.
    #[serde(default)]
    pub ui: Option<serde_json::Value>,
    /// The edits, in order.
    pub edits: Vec<Edit>,
}

/// One edit, in the interface's terms.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(tag = "edit", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Edit {
    /// A text block's whole Markdown.
    SetText {
        /// The text block.
        block: BlockId,
        /// Its new Markdown.
        markdown: String,
    },
    /// A new block after or before a sibling. The core makes its order key and timestamps.
    InsertBlock {
        /// The block.
        block: NewBlock,
        /// The sibling it goes after.
        #[serde(default)]
        after: Option<BlockId>,
        /// The sibling it goes before.
        #[serde(default)]
        before: Option<BlockId>,
    },
    /// A new frame, or a new place among the blocks.
    MoveBlock {
        /// The block.
        block: BlockId,
        /// Its new frame.
        #[serde(default)]
        frame: Option<Frame>,
        /// The sibling it goes after.
        #[serde(default)]
        after: Option<BlockId>,
        /// The sibling it goes before.
        #[serde(default)]
        before: Option<BlockId>,
    },
    /// Changes to `lock`, `data`, or `fallback`, as merge patches.
    PatchBlock {
        /// The block.
        block: BlockId,
        /// A new lock, or `"none"`.
        #[serde(default)]
        lock: Option<String>,
        /// A merge patch over `data`.
        #[serde(default)]
        data: Option<JsonMap>,
        /// A merge patch over `fallback`.
        #[serde(default)]
        fallback: Option<serde_json::Value>,
    },
    /// Deletes blocks, with every stroke of deleted ink blocks.
    DeleteBlocks {
        /// The blocks.
        blocks: Vec<BlockId>,
    },
    /// Removes strokes.
    RemoveStrokes {
        /// The strokes.
        strokes: Vec<StrokeId>,
    },
    /// Composes a matrix with each stroke's transform.
    TransformStrokes {
        /// The strokes.
        strokes: Vec<StrokeId>,
        /// The matrix `a b c d e f`.
        matrix: [f64; 6],
    },
    /// Changes the style of strokes.
    RestyleStrokes {
        /// The strokes.
        strokes: Vec<StrokeId>,
        /// The parts of the style to change.
        style: StyleEdit,
    },
    /// Moves strokes to another ink block.
    MoveStrokesToBlock {
        /// The strokes.
        strokes: Vec<StrokeId>,
        /// The ink block.
        block: BlockId,
    },
    /// Changes page fields.
    SetPage {
        /// A new title.
        #[serde(default)]
        title: Option<String>,
        /// New tags.
        #[serde(default)]
        tags: Option<Vec<String>>,
        /// A new view, as `page.json` writes it.
        #[serde(default)]
        view: Option<serde_json::Value>,
        /// A new reading order (spec 6.2).
        #[serde(default)]
        reading_order: Option<Vec<BlockId>>,
    },
    /// Adds an imported asset to the table.
    AddAsset {
        /// The asset, already imported.
        asset: AssetId,
    },
    /// Removes an asset from the table.
    RemoveAsset {
        /// The asset.
        asset: AssetId,
    },
}

/// A block the interface creates. Its ID comes from the interface.
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewBlock {
    /// The new block's ID.
    pub id: BlockId,
    /// The block type, such as `text`.
    #[serde(rename = "type")]
    pub type_name: String,
    /// Its frame.
    #[serde(default)]
    pub frame: Option<Frame>,
    /// Its `data`, as `page.json` writes it.
    #[serde(default)]
    pub data: JsonMap,
    /// Its fallback, for types newer than version 1.
    #[serde(default)]
    pub fallback: Option<serde_json::Value>,
}

/// The parts of a stroke style to change. `None` keeps a part.
#[derive(Clone, Debug, PartialEq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleEdit {
    /// A new tool.
    #[serde(default)]
    pub tool: Option<u8>,
    /// A new palette slot.
    #[serde(default)]
    pub palette: Option<u8>,
    /// A new color: red, green, blue, and alpha.
    #[serde(default)]
    pub color: Option<[u8; 4]>,
    /// A new width in page units.
    #[serde(default)]
    pub width: Option<f32>,
}

/// The metadata of a binary stroke request (`page_add_strokes`).
#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrokeTxnMeta {
    /// The page.
    pub page: PageId,
    /// The window or editor.
    pub client: ClientId,
    /// The client's sequence number.
    pub client_seq: u64,
    /// How it may join the undo entry before it.
    #[serde(default)]
    pub coalesce: Option<CoalesceKey>,
}

/// What resolving needs besides the page.
pub struct ResolveCtx<'a> {
    /// The clock for order keys' neighbors and timestamps.
    pub clock: &'a dyn Clock,
    /// The limits every change is checked against.
    pub limits: &'a Limits,
    /// Looks up an asset that was imported but isn't in the table yet.
    pub imported: &'a dyn Fn(AssetId) -> Option<Asset>,
}

/// Resolves a request against the current page into a transaction.
pub fn resolve(_page: &Page, _req: &TxnRequest, _ctx: &ResolveCtx) -> Result<Txn, EditError> {
    unimplemented!("WP3: resolve")
}

/// Resolves strokes that arrived as binary records into an `AddStrokes` transaction.
pub fn resolve_add_strokes(
    _page: &Page,
    _meta: &StrokeTxnMeta,
    _strokes: Vec<Arc<Stroke>>,
    _ctx: &ResolveCtx,
) -> Result<Txn, EditError> {
    unimplemented!("WP3: resolve_add_strokes")
}
