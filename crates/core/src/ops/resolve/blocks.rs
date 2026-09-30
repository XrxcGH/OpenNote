//! Resolving the edits that change blocks: `setText`, `insertBlock`, `moveBlock`, `patchBlock`, and
//! `deleteBlocks`.

use std::collections::HashSet;
use std::sync::Arc;

use serde_json::Value;

use super::place::place;
use super::{find_block, invalid, locked, EditCtx};
use crate::error::EditError;
use crate::id::{BlockId, Id};
use crate::model::{Block, BlockData, Frame, JsonMap, Lock, NamedValue, Page};
use crate::ops::apply::checks::{check_block, check_frame, lock_level, LockLevel};
use crate::ops::merge_patch::view::{
    apply_view, block_view, data_from_json, fallback_from_json, RESERVED_TYPES, V1_TYPES,
};
use crate::ops::merge_patch::{apply_patch, diff, round_trips};
use crate::ops::resolve::NewBlock;
use crate::ops::text_diff;
use crate::ops::{Op, PageFields, Placement, Stamps};

impl EditCtx<'_> {
    fn stamps(&self, block: &Block) -> Stamps {
        Stamps {
            before: block.modified,
            after: self.at,
        }
    }
}

/// Fails when the block is locked with `all`.
fn editable(block: &Block) -> Result<(), EditError> {
    if lock_level(block) == LockLevel::All {
        return Err(locked(block.id));
    }
    Ok(())
}

/// `setText`: one splice between the old and the new Markdown.
pub(super) fn set_text(c: &EditCtx<'_>, id: BlockId, markdown: &str) -> Result<Vec<Op>, EditError> {
    let block = find_block(c.page, id)?;
    editable(block)?;
    let BlockData::Text(text) = &block.data else {
        return Err(invalid(format!("{id} is not a text block")));
    };
    if markdown.len() as u64 > c.ctx.limits.markdown_bytes {
        return Err(invalid("the Markdown passes the limit"));
    }
    Ok(text_diff::diff(&text.markdown, markdown)
        .map(|splice| Op::EditText {
            id,
            splices: vec![splice],
            stamps: c.stamps(block),
        })
        .into_iter()
        .collect())
}

/// Every block ID and text element ID on the page, except the elements of `except`.
fn ids_in_use(page: &Page, except: Option<BlockId>) -> HashSet<Id> {
    let mut ids = HashSet::new();
    for block in page.blocks.iter() {
        ids.insert(block.id.0);
        if let (BlockData::Text(text), false) = (&block.data, Some(block.id) == except) {
            ids.extend(text.ids.iter().map(|e| e.0));
        }
    }
    ids
}

/// Fails when a text block's element IDs repeat, or clash with other IDs on the page.
fn check_element_ids(page: &Page, block: &Block) -> Result<(), EditError> {
    let BlockData::Text(text) = &block.data else {
        return Ok(());
    };
    let mut taken = ids_in_use(page, Some(block.id));
    taken.insert(block.id.0);
    for element in &text.ids {
        if !taken.insert(element.0) {
            return Err(invalid(format!("the element ID {element} is already used")));
        }
    }
    Ok(())
}

/// A frame with no values and no unknown keys is no frame.
fn normal_frame(frame: Frame) -> Option<Frame> {
    (frame != Frame::default()).then_some(frame)
}

/// Reads a new block's type, data, and fallback.
fn new_block_parts(new: &NewBlock) -> Result<(BlockData, Option<crate::model::Fallback>), EditError> {
    let type_name = new.type_name.as_str();
    let v1 = V1_TYPES.contains(&type_name);
    if !v1 && !type_name.starts_with("ext:") {
        let why = if RESERVED_TYPES.contains(&type_name) {
            "reserved"
        } else {
            "unknown"
        };
        return Err(invalid(format!("the block type {type_name:?} is {why}")));
    }
    let mut data = data_from_json(type_name, &new.data).map_err(invalid)?;
    if let BlockData::Ink(ink) = &mut data {
        ink.stroke_count = 0;
    }
    let fallback = match &new.fallback {
        None | Some(Value::Null) => None,
        Some(Value::Object(map)) => Some(fallback_from_json(map).map_err(invalid)?),
        Some(_) => return Err(invalid("a fallback must be an object")),
    };
    if !v1 && fallback.is_none() {
        return Err(invalid(format!("a block of type {type_name:?} needs a fallback")));
    }
    Ok((data, fallback))
}

/// `insertBlock`: the new block with an order key between its neighbors, and the core's timestamps.
pub(super) fn insert_block(
    c: &EditCtx<'_>,
    new: &NewBlock,
    after: Option<BlockId>,
    before: Option<BlockId>,
) -> Result<Vec<Op>, EditError> {
    if c.page.blocks.len() as u64 >= u64::from(c.ctx.limits.blocks_per_page) {
        return Err(invalid("the page has as many blocks as it may have"));
    }
    if ids_in_use(c.page, None).contains(&new.id.0) {
        return Err(invalid(format!("the block ID {} is already used", new.id)));
    }
    let (data, fallback) = new_block_parts(new)?;
    let frame = new.frame.clone().and_then(normal_frame);
    let (mut ops, order) = place(c, None, after, before)?;
    let block = Block {
        id: new.id,
        order,
        frame,
        lock: None,
        created: c.at,
        modified: c.at,
        data,
        fallback,
        extra: JsonMap::new(),
    };
    check_block(&block, c.page, c.ctx.limits).map_err(invalid)?;
    check_element_ids(c.page, &block)?;
    ops.push(Op::InsertBlocks {
        blocks: vec![Arc::new(block)],
    });
    Ok(ops)
}

/// `moveBlock`: a new frame, a new place among the blocks, or both.
pub(super) fn move_block(
    c: &EditCtx<'_>,
    id: BlockId,
    frame: Option<&Frame>,
    after: Option<BlockId>,
    before: Option<BlockId>,
) -> Result<Vec<Op>, EditError> {
    let block = find_block(c.page, id)?;
    if lock_level(block) != LockLevel::Free {
        return Err(locked(id));
    }
    let frame = match frame {
        None => block.frame.clone(),
        Some(frame) => normal_frame(frame.clone()),
    };
    if let Some(frame) = &frame {
        check_frame(frame, c.ctx.limits).map_err(invalid)?;
    }
    if after == Some(id) || before == Some(id) {
        return Err(invalid("a block can't be placed next to itself"));
    }
    let (mut ops, order) = if after.is_none() && before.is_none() {
        (Vec::new(), block.order.clone())
    } else {
        place(c, Some(id), after, before)?
    };
    if ops.is_empty() && order == block.order && frame == block.frame {
        return Ok(Vec::new());
    }
    ops.push(Op::MoveBlock {
        id,
        before: Placement {
            order: block.order.clone(),
            frame: block.frame.clone(),
        },
        after: Placement { order, frame },
        stamps: c.stamps(block),
    });
    Ok(ops)
}

/// The merge patch the edit asks for, over the block's view.
fn requested_patch(lock: Option<&str>, data: Option<&JsonMap>, fallback: Option<&Value>) -> Result<JsonMap, EditError> {
    let mut patch = JsonMap::new();
    match lock {
        None => {}
        Some("none") => {
            patch.insert("lock".to_owned(), Value::Null);
        }
        Some(name) if Lock::from_name(name).is_some() => {
            patch.insert("lock".to_owned(), Value::from(name));
        }
        Some(name) => return Err(invalid(format!("{name:?} is not a lock"))),
    }
    if let Some(data) = data {
        patch.insert("data".to_owned(), Value::Object(data.clone()));
    }
    match fallback {
        None => {}
        Some(value @ (Value::Null | Value::Object(_))) => {
            patch.insert("fallback".to_owned(), value.clone());
        }
        Some(_) => return Err(invalid("a fallback patch must be an object or null")),
    }
    Ok(patch)
}

fn stroke_count(block: &Block) -> Option<u32> {
    match &block.data {
        BlockData::Ink(ink) => Some(ink.stroke_count),
        _ => None,
    }
}

/// `patchBlock`: exact patches between the block's view before and after the requested change.
pub(super) fn patch_block(
    c: &EditCtx<'_>,
    id: BlockId,
    lock: Option<&str>,
    data: Option<&JsonMap>,
    fallback: Option<&Value>,
) -> Result<Vec<Op>, EditError> {
    let block = find_block(c.page, id)?;
    let only_lock = data.is_none() && fallback.is_none();
    if !only_lock {
        editable(block)?;
        if matches!(block.data, BlockData::Other(_)) {
            return Err(invalid("blocks of unknown types can't be edited"));
        }
    }
    let requested = requested_patch(lock, data, fallback)?;
    let from = block_view(block);
    let mut patched = from.clone();
    apply_patch(&mut patched, &requested);
    let changed = apply_view(block, &patched).map_err(invalid)?;
    if stroke_count(&changed) != stroke_count(block) {
        return Err(invalid("strokeCount can't be changed"));
    }
    check_block(&changed, c.page, c.ctx.limits).map_err(invalid)?;
    check_element_ids(c.page, &changed)?;
    let to = block_view(&changed);
    let after = diff(&from, &to);
    if after.is_empty() {
        return Ok(Vec::new());
    }
    let before = diff(&to, &from);
    if !round_trips(&from, &to, &before, &after) {
        return Err(invalid("this change can't be undone exactly"));
    }
    Ok(vec![Op::PatchBlock {
        id,
        before,
        after,
        stamps: c.stamps(block),
    }])
}

/// `deleteBlocks`: the whole blocks, every stroke of deleted ink blocks, and the reading order without them.
pub(super) fn delete_blocks(c: &EditCtx<'_>, ids: &[BlockId]) -> Result<Vec<Op>, EditError> {
    let mut seen = HashSet::new();
    let mut blocks = Vec::new();
    let mut strokes = Vec::new();
    for &id in ids {
        if !seen.insert(id) {
            continue;
        }
        let block = find_block(c.page, id)?;
        editable(block)?;
        strokes.extend(c.page.ink.in_block(id).cloned());
        blocks.push(block.clone());
    }
    let mut ops = Vec::new();
    if blocks.is_empty() {
        return Ok(ops);
    }
    let order = &c.page.reading_order;
    if order.iter().any(|id| seen.contains(id)) {
        ops.push(Op::SetPage {
            before: PageFields {
                reading_order: Some(order.clone()),
                ..PageFields::default()
            },
            after: PageFields {
                reading_order: Some(order.iter().copied().filter(|id| !seen.contains(id)).collect()),
                ..PageFields::default()
            },
        });
    }
    ops.push(Op::DeleteBlocks { blocks, strokes });
    Ok(ops)
}
