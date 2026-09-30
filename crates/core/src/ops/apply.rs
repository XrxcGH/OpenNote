//! Applying and inverting operations (plan 7.1). Owned by WP3.
//!
//! Applying a transaction is all or nothing. Each operation checks its preconditions against the page as the
//! operations before it left it. When a check fails, every change the transaction made is put back, newest
//! first, and the error names the failing operation and check. Applying keeps the page consistent: it updates
//! the page's `modified` time, each ink block's `strokeCount`, and the pending ink records that the next save
//! writes as a new segment.

mod blocks;
pub(crate) mod checks;
mod page;
mod state;
mod strokes;

use std::mem::size_of;
use std::sync::Arc;

use serde_json::Value;

use crate::error::ApplyError;
use crate::model::{Block, BlockData, JsonMap, Page, Stroke};
use crate::ops::text_diff::invert_splices;
use crate::ops::{AppliedChanges, Op, PageFields, Stamps, StrokePropsChange, Txn};
use crate::seams::Applier;
use crate::time::Timestamp;

use state::{Applying, Fail};
pub(crate) use strokes::state_of;

/// The production [`Applier`].
#[derive(Clone, Copy, Debug, Default)]
pub struct OpsApplier;

impl Applier for OpsApplier {
    fn apply(&self, page: &mut Page, txn: &Txn) -> Result<AppliedChanges, ApplyError> {
        page.apply(txn)
    }
}

impl Page {
    /// Applies every operation of a transaction, or none. Keeps `modified`, each ink block's `strokeCount`,
    /// and the pending ink records up to date. A transaction without operations changes nothing.
    pub fn apply(&mut self, txn: &Txn) -> Result<AppliedChanges, ApplyError> {
        apply_ops(self, &txn.ops, txn.at)
    }
}

/// Applies operations as one transaction made at `at`.
pub(crate) fn apply_ops(page: &mut Page, ops: &[Op], at: Timestamp) -> Result<AppliedChanges, ApplyError> {
    if ops.is_empty() {
        return Ok(AppliedChanges::default());
    }
    let mut applying = Applying::new(page);
    for (op_index, op) in ops.iter().enumerate() {
        if let Err(Fail { check, detail }) = apply_op(&mut applying, op) {
            applying.rollback();
            return Err(ApplyError {
                op_index,
                check,
                detail,
            });
        }
    }
    Ok(applying.commit(at))
}

fn apply_op(a: &mut Applying<'_>, op: &Op) -> Result<(), Fail> {
    match op {
        Op::SetPage { before, after } => page::set_page(a, before, after),
        Op::InsertBlocks { blocks } => blocks::insert(a, blocks),
        Op::DeleteBlocks { blocks, strokes } => blocks::delete(a, blocks, strokes),
        Op::MoveBlock {
            id,
            before,
            after,
            stamps,
        } => blocks::move_block(a, *id, (before, after), stamps),
        Op::PatchBlock {
            id,
            before,
            after,
            stamps,
        } => blocks::patch(a, *id, (before, after), stamps),
        Op::EditText { id, splices, stamps } => blocks::edit_text(a, *id, splices, stamps),
        Op::AddStrokes { strokes } => strokes::add_strokes(a, strokes),
        Op::RemoveStrokes { strokes } => strokes::remove_strokes(a, strokes),
        Op::SetStrokeProps { items } => strokes::set_props(a, items),
        Op::AddAsset { asset } => page::add_asset(a, asset),
        Op::RemoveAsset { asset } => page::remove_asset(a, asset),
    }
}

fn swapped(stamps: &Stamps) -> Stamps {
    Stamps {
        before: stamps.after,
        after: stamps.before,
    }
}

/// The operations that undo `op` exactly, in order. Every operation has one inverse, except `DeleteBlocks`,
/// which is undone by `InsertBlocks` and then, when ink blocks had strokes, `AddStrokes`.
pub fn invert(op: &Op) -> Vec<Op> {
    match op {
        Op::DeleteBlocks { blocks, strokes } => {
            let mut ops = vec![Op::InsertBlocks { blocks: blocks.clone() }];
            if !strokes.is_empty() {
                ops.push(Op::AddStrokes {
                    strokes: strokes.clone(),
                });
            }
            ops
        }
        Op::MoveBlock { .. } | Op::PatchBlock { .. } | Op::EditText { .. } => {
            invert_block_change(op).into_iter().collect()
        }
        Op::SetPage { before, after } => vec![Op::SetPage {
            before: after.clone(),
            after: before.clone(),
        }],
        Op::InsertBlocks { blocks } => vec![Op::DeleteBlocks {
            blocks: blocks.clone(),
            strokes: Vec::new(),
        }],
        Op::AddStrokes { strokes } => vec![Op::RemoveStrokes {
            strokes: strokes.clone(),
        }],
        Op::RemoveStrokes { strokes } => vec![Op::AddStrokes {
            strokes: strokes.clone(),
        }],
        Op::SetStrokeProps { items } => vec![Op::SetStrokeProps {
            items: items.iter().rev().map(swap_props).collect(),
        }],
        Op::AddAsset { asset } => vec![Op::RemoveAsset { asset: asset.clone() }],
        Op::RemoveAsset { asset } => vec![Op::AddAsset { asset: asset.clone() }],
    }
}

/// The inverse of an operation that changes one block and its `modified` time.
fn invert_block_change(op: &Op) -> Option<Op> {
    let inverse = match op {
        Op::MoveBlock {
            id,
            before,
            after,
            stamps,
        } => Op::MoveBlock {
            id: *id,
            before: after.clone(),
            after: before.clone(),
            stamps: swapped(stamps),
        },
        Op::PatchBlock {
            id,
            before,
            after,
            stamps,
        } => Op::PatchBlock {
            id: *id,
            before: after.clone(),
            after: before.clone(),
            stamps: swapped(stamps),
        },
        Op::EditText { id, splices, stamps } => Op::EditText {
            id: *id,
            splices: invert_splices(splices),
            stamps: swapped(stamps),
        },
        _ => return None,
    };
    Some(inverse)
}

fn swap_props(item: &StrokePropsChange) -> StrokePropsChange {
    StrokePropsChange {
        id: item.id,
        before: item.after.clone(),
        after: item.before.clone(),
    }
}

/// The inverses of `ops`, in reverse order.
pub fn invert_all(ops: &[Op]) -> Vec<Op> {
    ops.iter().rev().flat_map(invert).collect()
}

/// The bytes that only undo keeps alive, such as the points of removed strokes. Data that the page still holds,
/// such as the blocks an `InsertBlocks` added, costs only its pointers.
pub fn retained_bytes(op: &Op) -> usize {
    let held = match op {
        Op::SetPage { before, after } => fields_bytes(before) + fields_bytes(after),
        Op::InsertBlocks { blocks } => blocks.len() * size_of::<Arc<Block>>(),
        Op::DeleteBlocks { blocks, strokes } => {
            blocks.iter().map(|b| block_bytes(b)).sum::<usize>()
                + strokes.iter().map(|s| stroke_bytes(s)).sum::<usize>()
        }
        Op::MoveBlock { before, after, .. } => {
            before.order.as_str().len() + after.order.as_str().len() + 2 * size_of::<crate::model::Frame>()
        }
        Op::PatchBlock { before, after, .. } => map_bytes(before) + map_bytes(after),
        Op::EditText { splices, .. } => splices
            .iter()
            .map(|s| size_of::<crate::ops::Splice>() + s.del.len() + s.ins.len())
            .sum(),
        Op::AddStrokes { strokes } => strokes.len() * size_of::<Arc<Stroke>>(),
        Op::RemoveStrokes { strokes } => strokes.iter().map(|s| stroke_bytes(s)).sum(),
        Op::SetStrokeProps { items } => items.len() * size_of::<StrokePropsChange>(),
        Op::AddAsset { asset } | Op::RemoveAsset { asset } => {
            size_of::<crate::model::Asset>() + asset.file.len() + asset.mime.len() + asset.name.len()
        }
    };
    size_of::<Op>() + held
}

fn fields_bytes(fields: &PageFields) -> usize {
    let title = fields.title.as_ref().map_or(0, String::len);
    let tags = fields
        .tags
        .iter()
        .flatten()
        .map(|t| t.len() + size_of::<String>())
        .sum::<usize>();
    let view = fields.view.as_ref().map_or(0, |_| size_of::<crate::model::PageView>());
    let order = fields.reading_order.as_ref().map_or(0, |o| o.len() * 16);
    title + tags + view + order
}

fn stroke_bytes(stroke: &Stroke) -> usize {
    size_of::<Stroke>() + stroke.points.len()
}

fn block_bytes(block: &Block) -> usize {
    let data = match &block.data {
        BlockData::Text(text) => text.markdown.len() + text.ids.len() * 16 + map_bytes(&text.extra),
        BlockData::Table(table) => table
            .rows
            .iter()
            .flat_map(|r| r.cells.values())
            .map(|c| c.markdown.len() + 48)
            .sum(),
        BlockData::Other(other) => map_bytes(&other.data),
        BlockData::Ink(_) | BlockData::Image(_) | BlockData::File(_) => 0,
    };
    let fallback = block.fallback.as_ref().map_or(0, |f| f.markdown.len());
    size_of::<Block>() + data + fallback + map_bytes(&block.extra)
}

/// About how many bytes a JSON object holds.
fn map_bytes(map: &JsonMap) -> usize {
    map.iter().map(|(k, v)| k.len() + value_bytes(v)).sum()
}

fn value_bytes(value: &Value) -> usize {
    let own = size_of::<Value>();
    match value {
        Value::String(text) => own + text.len(),
        Value::Array(items) => own + items.iter().map(value_bytes).sum::<usize>(),
        Value::Object(map) => own + map_bytes(map),
        Value::Null | Value::Bool(_) | Value::Number(_) => own,
    }
}

#[cfg(test)]
mod tests;
