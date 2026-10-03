//! Applying the operations that change blocks: insert, delete, move, patch, and edit text.

use std::sync::Arc;

use super::checks::{blocks_equal, check_block, check_frame, lock_level, strokes_equal, LockLevel};
use super::state::{fail, Applying, Fail};
use crate::id::BlockId;
use crate::limits::Limits;
use crate::model::{Block, BlockData, InkRecord, JsonMap, Stroke};
use crate::ops::merge_patch::view::{apply_view, block_view, VIEW_KEYS};
use crate::ops::merge_patch::{apply_patch, inverse_patch};
use crate::ops::text_diff::apply_splices;
use crate::ops::{Placement, Splice, Stamps};
use crate::time::Timestamp;

/// The block's new `modified` time. It is `stamps.after` when the block is as the operation expects, and
/// never goes backward when another change came in between.
fn restamp(current: Timestamp, stamps: &Stamps) -> Timestamp {
    if current == stamps.before {
        stamps.after
    } else {
        current.max(stamps.after)
    }
}

fn existing(a: &Applying<'_>, id: BlockId) -> Result<Arc<Block>, Fail> {
    a.page.blocks.get(id).cloned().ok_or_else(|| fail("blockExists", id))
}

/// `InsertBlocks`: the IDs are unused and each block is well formed.
pub(super) fn insert(a: &mut Applying<'_>, blocks: &[Arc<Block>]) -> Result<(), Fail> {
    let limits = Limits::default();
    for block in blocks {
        if a.page.blocks.contains(block.id) {
            return Err(fail("blockIdUnused", block.id));
        }
        check_block(block, a.page, &limits).map_err(|e| fail("blockValid", e))?;
        a.set_block(block.id, Some(block.clone()));
        a.recount(&[block.id]);
        a.changes.blocks_changed.push(block.id);
    }
    Ok(())
}

/// `DeleteBlocks`: each block and stroke is as stored, and the strokes are all the strokes of the blocks.
pub(super) fn delete(a: &mut Applying<'_>, blocks: &[Arc<Block>], strokes: &[Arc<Stroke>]) -> Result<(), Fail> {
    for stroke in strokes {
        let current = a
            .page
            .ink
            .stroke(stroke.id)
            .ok_or_else(|| fail("strokeExists", stroke.id))?;
        if !strokes_equal(current, stroke) {
            return Err(fail("strokeEquals", stroke.id));
        }
        if !blocks.iter().any(|b| b.id == stroke.block) {
            return Err(fail("strokeInDeletedBlock", stroke.id));
        }
        a.set_stroke(stroke.id, None);
        a.record(InkRecord::Remove(stroke.id));
        a.changes.strokes_removed.push(stroke.id);
    }
    for block in blocks {
        let current = existing(a, block.id)?;
        if !blocks_equal(&current, block) {
            return Err(fail("blockEquals", block.id));
        }
        if lock_level(&current) == LockLevel::All {
            return Err(fail("blockLocked", block.id));
        }
        if a.page.ink.count_in_block(block.id) != 0 {
            return Err(fail("inkBlockEmpty", block.id));
        }
        a.set_block(block.id, None);
        a.changes.blocks_removed.push(block.id);
    }
    Ok(())
}

/// `MoveBlock`: the block is where `before` says, and not locked.
pub(super) fn move_block(
    a: &mut Applying<'_>,
    id: BlockId,
    (before, after): (&Placement, &Placement),
    stamps: &Stamps,
) -> Result<(), Fail> {
    let current = existing(a, id)?;
    if lock_level(&current) != LockLevel::Free {
        return Err(fail("blockLocked", id));
    }
    if current.order != before.order || current.frame != before.frame {
        return Err(fail("placementEquals", id));
    }
    if let Some(frame) = &after.frame {
        check_frame(frame, &Limits::default()).map_err(|e| fail("frameValid", e))?;
    }
    let moved = Block {
        order: after.order.clone(),
        frame: after.frame.clone(),
        modified: restamp(current.modified, stamps),
        ..Block::clone(&current)
    };
    a.set_block(id, Some(Arc::new(moved)));
    a.changes.blocks_changed.push(id);
    Ok(())
}

/// `PatchBlock`: the block's view matches `before` wherever `after` changes it, and the result is well formed.
pub(super) fn patch(
    a: &mut Applying<'_>,
    id: BlockId,
    (before, after): (&JsonMap, &JsonMap),
    stamps: &Stamps,
) -> Result<(), Fail> {
    let current = existing(a, id)?;
    if let Some(key) = after.keys().find(|k| !VIEW_KEYS.contains(&k.as_str())) {
        return Err(fail("patchKeys", key));
    }
    let edits_more_than_lock = after.keys().any(|k| k != "lock");
    if edits_more_than_lock && lock_level(&current) == LockLevel::All {
        return Err(fail("blockLocked", id));
    }
    if edits_more_than_lock && matches!(current.data, BlockData::Other(_)) {
        return Err(fail("blockUnknownType", id));
    }
    let view = block_view(&current);
    if inverse_patch(&view, after) != *before {
        return Err(fail("patchBefore", id));
    }
    let mut patched = view;
    apply_patch(&mut patched, after);
    let mut changed = apply_view(&current, &patched).map_err(|e| fail("patchValid", e))?;
    if block_view(&changed) != patched {
        return Err(fail("patchCanonical", id));
    }
    if stroke_count(&changed) != stroke_count(&current) {
        return Err(fail("strokeCountDerived", id));
    }
    check_block(&changed, a.page, &Limits::default()).map_err(|e| fail("blockValid", e))?;
    changed.modified = restamp(current.modified, stamps);
    a.set_block(id, Some(Arc::new(changed)));
    a.changes.blocks_changed.push(id);
    Ok(())
}

fn stroke_count(block: &Block) -> Option<u32> {
    match &block.data {
        BlockData::Ink(ink) => Some(ink.stroke_count),
        _ => None,
    }
}

/// `EditText`: each splice falls on character boundaries and deletes the text that is there.
pub(super) fn edit_text(a: &mut Applying<'_>, id: BlockId, splices: &[Splice], stamps: &Stamps) -> Result<(), Fail> {
    let current = existing(a, id)?;
    if lock_level(&current) == LockLevel::All {
        return Err(fail("blockLocked", id));
    }
    let BlockData::Text(text) = &current.data else {
        return Err(fail("textBlock", id));
    };
    let markdown = apply_splices(&text.markdown, splices).map_err(|i| fail("spliceMatches", format!("splice {i}")))?;
    if markdown.len() as u64 > Limits::default().markdown_bytes {
        return Err(fail("markdownLimit", id));
    }
    let mut changed = Block::clone(&current);
    if let BlockData::Text(text) = &mut changed.data {
        text.markdown = markdown.into();
    }
    changed.modified = restamp(current.modified, stamps);
    a.set_block(id, Some(Arc::new(changed)));
    a.changes.blocks_changed.push(id);
    Ok(())
}
