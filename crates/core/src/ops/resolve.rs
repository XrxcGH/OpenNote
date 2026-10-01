//! From interface edits to operations (plan 7.2 and 11.4). Owned by WP3.
//!
//! The interface sends edits in its own terms. The core resolves them against the current page into a
//! transaction of operations. Each operation holds everything needed to apply, check, and undo it. Each edit of
//! a request is resolved against the page as the edits before it left it.

mod blocks;
mod page;
mod place;
mod strokes;
pub mod view;

use std::sync::Arc;

use serde::{Deserialize, Deserializer, Serialize};

use crate::error::EditError;
use crate::id::{AssetId, BlockId, ClientId, PageId, StrokeId, TxnId};
use crate::limits::Limits;
use crate::model::{Access, Asset, Block, Frame, JsonMap, Page, Stroke};
use crate::ops::apply::apply_ops;
use crate::ops::{CoalesceKey, Op, Origin, Txn};
use crate::order::OrderKey;
use crate::time::{Clock, Timestamp};

pub use strokes::compose;

/// A transaction request from the interface.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
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
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
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
        /// Its new frame. `None` keeps the frame, and a frame without values removes it.
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
        /// A merge patch over `fallback`. `null` removes the fallback.
        #[serde(default, deserialize_with = "keep_null", skip_serializing_if = "Option::is_none")]
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
        /// A JSON merge patch (RFC 7396) over the current view, as `page.json` writes it. It can set
        /// `readingOrder` (spec 6.2), and `null` puts a member back to its default.
        #[serde(default)]
        view: Option<serde_json::Value>,
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
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewBlock {
    /// The new block's ID.
    pub id: BlockId,
    /// The block type, such as `text`.
    #[serde(rename = "type")]
    pub type_name: String,
    /// Its frame. A frame without values is no frame.
    #[serde(default)]
    pub frame: Option<Frame>,
    /// Its `data`, as `page.json` writes it.
    #[serde(default)]
    pub data: JsonMap,
    /// Its fallback, required for types newer than version 1.
    #[serde(default)]
    pub fallback: Option<serde_json::Value>,
}

/// The parts of a stroke style to change. `None` keeps a part.
#[derive(Clone, Debug, PartialEq, Default, Serialize, Deserialize)]
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
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
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

/// Reads a JSON value that may be `null`, keeping `null` as `Some(Value::Null)`, so a missing member and a
/// `null` member differ.
fn keep_null<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<serde_json::Value>, D::Error> {
    serde_json::Value::deserialize(deserializer).map(Some)
}

/// What resolving needs besides the page.
pub struct ResolveCtx<'a> {
    /// The clock for timestamps and transaction IDs.
    pub clock: &'a dyn Clock,
    /// The limits every change is checked against.
    pub limits: &'a Limits,
    /// Looks up an asset that was imported but isn't in the table yet.
    pub imported: &'a dyn Fn(AssetId) -> Option<Asset>,
}

/// One edit being resolved: the page as the edits before it left it, and the transaction's time.
struct EditCtx<'a> {
    page: &'a Page,
    ctx: &'a ResolveCtx<'a>,
    at: Timestamp,
}

fn invalid(detail: impl Into<String>) -> EditError {
    EditError::Invalid(detail.into())
}

fn not_found(what: impl Into<String>) -> EditError {
    EditError::NotFound(what.into())
}

fn locked(block: BlockId) -> EditError {
    EditError::Locked(block)
}

fn find_block(page: &Page, id: BlockId) -> Result<&Arc<Block>, EditError> {
    page.blocks.get(id).ok_or_else(|| not_found(format!("block {id}")))
}

/// Fails when the page is read-only or the request names another page.
fn check_page(page: &Page, id: PageId) -> Result<(), EditError> {
    if let Access::ReadOnly(reason) = &page.format.access {
        return Err(EditError::ReadOnly(reason.clone()));
    }
    if id != page.id {
        return Err(invalid(format!("the request is for page {id}, not {}", page.id)));
    }
    Ok(())
}

fn local_txn(ctx: &ResolveCtx, at: Timestamp, (client, coalesce): (&ClientId, &Option<CoalesceKey>)) -> Txn {
    Txn {
        id: TxnId::generate(ctx.clock),
        at,
        origin: Origin::Local,
        client: client.clone(),
        coalesce: coalesce.clone(),
        ui: None,
        ops: Vec::new(),
    }
}

/// Resolves a request against the current page into a transaction. A request that changes nothing, such as
/// text set to what it already is, gives a transaction without operations.
pub fn resolve(page: &Page, req: &TxnRequest, ctx: &ResolveCtx) -> Result<Txn, EditError> {
    check_page(page, req.page)?;
    let at = ctx.clock.now();
    let mut working: Option<Page> = None;
    let mut ops = Vec::new();
    let last = req.edits.len().saturating_sub(1);
    for (index, edit) in req.edits.iter().enumerate() {
        let current = working.as_ref().unwrap_or(page);
        let edit_ops = resolve_edit(&EditCtx { page: current, ctx, at }, edit)?;
        if index < last && !edit_ops.is_empty() {
            let working = working.get_or_insert_with(|| page.clone());
            apply_ops(working, &edit_ops, at).map_err(EditError::Precondition)?;
        }
        ops.extend(edit_ops);
    }
    Ok(Txn {
        ui: req.ui.clone(),
        ops,
        ..local_txn(ctx, at, (&req.client, &req.coalesce))
    })
}

fn resolve_edit(c: &EditCtx<'_>, edit: &Edit) -> Result<Vec<Op>, EditError> {
    match edit {
        Edit::SetText { block, markdown } => blocks::set_text(c, *block, markdown),
        Edit::InsertBlock { block, after, before } => blocks::insert_block(c, block, *after, *before),
        Edit::MoveBlock {
            block,
            frame,
            after,
            before,
        } => blocks::move_block(c, *block, frame.as_ref(), *after, *before),
        Edit::PatchBlock {
            block,
            lock,
            data,
            fallback,
        } => blocks::patch_block(c, *block, lock.as_deref(), data.as_ref(), fallback.as_ref()),
        Edit::DeleteBlocks { blocks } => blocks::delete_blocks(c, blocks),
        Edit::RemoveStrokes { strokes } => strokes::remove(c, strokes),
        Edit::TransformStrokes { strokes, matrix } => strokes::transform(c, strokes, matrix),
        Edit::RestyleStrokes { strokes, style } => strokes::restyle(c, strokes, style),
        Edit::MoveStrokesToBlock { strokes, block } => strokes::move_to_block(c, strokes, *block),
        Edit::SetPage { title, tags, view } => {
            let edit = page::PageEdit {
                title: title.as_deref(),
                tags: tags.as_deref(),
                view: view.as_ref(),
            };
            page::set_page(c, &edit)
        }
        Edit::AddAsset { asset } => page::add_asset(c, *asset),
        Edit::RemoveAsset { asset } => page::remove_asset(c, *asset),
    }
}

/// Resolves strokes that arrived as binary records into an `AddStrokes` transaction. Each stroke's points are
/// decoded once to check them, and its bounding box is computed from them.
pub fn resolve_add_strokes(
    page: &Page,
    meta: &StrokeTxnMeta,
    strokes: Vec<Arc<Stroke>>,
    ctx: &ResolveCtx,
) -> Result<Txn, EditError> {
    let checked = strokes
        .into_iter()
        .map(|stroke| strokes::checked_points(stroke, ctx.limits))
        .collect::<Result<Vec<_>, _>>()?;
    resolve_checked_strokes(page, meta, checked, ctx)
}

/// Resolves strokes whose points were already decoded and checked, such as strokes a reader checked or strokes
/// the core made, into an `AddStrokes` transaction. Every other check still runs.
pub fn resolve_checked_strokes(
    page: &Page,
    meta: &StrokeTxnMeta,
    strokes: Vec<Arc<Stroke>>,
    ctx: &ResolveCtx,
) -> Result<Txn, EditError> {
    check_page(page, meta.page)?;
    let at = ctx.clock.now();
    let ops = strokes::add(&EditCtx { page, ctx, at }, strokes)?;
    Ok(Txn {
        ops,
        ..local_txn(ctx, at, (&meta.client, &meta.coalesce))
    })
}

/// The order keys a transaction gives to new and moved blocks, for the answer to the interface.
pub fn assigned_order_keys(txn: &Txn) -> Vec<(BlockId, OrderKey)> {
    let mut keys = Vec::new();
    for op in &txn.ops {
        match op {
            Op::InsertBlocks { blocks } => keys.extend(blocks.iter().map(|b| (b.id, b.order.clone()))),
            Op::MoveBlock { id, before, after, .. } if before.order != after.order => {
                keys.push((*id, after.order.clone()));
            }
            _ => {}
        }
    }
    keys
}

#[cfg(test)]
mod tests;
