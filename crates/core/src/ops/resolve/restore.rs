//! Restoring blocks from an older version of the page (spec 13.4, and amendment P3-7 of ADR 0008).
//!
//! The person picks blocks in a saved version. They come back as one transaction, so one undo step reverses
//! it. The current copy of each block goes, and the old copy comes in with its strokes. Any asset the old copy
//! needs that the table has lost is added again.

use std::collections::HashSet;
use std::sync::Arc;

use super::{check_page, find_block, local_txn, locked, not_found, ResolveCtx};
use crate::error::EditError;
use crate::id::{BlockId, ClientId};
use crate::model::{Block, Page, Stroke};
use crate::ops::apply::checks::{block_uses_asset, blocks_equal, lock_level, strokes_equal, LockLevel};
use crate::ops::{Op, Txn};
use crate::time::Timestamp;

/// Resolves a restore of `ids` from `old`, an older version of `page` with its strokes loaded.
///
/// Each block that is on the page now is replaced by its old copy, and each block that is gone comes back. A
/// block that is the same in both versions is left alone. The restored block gets the transaction's time as
/// its `modified` time, so copies of the page on other devices take it. A stroke of an old ink block that the
/// page still has in another block stays where it is. A block locked with `all` can't be replaced.
pub fn resolve_restore_blocks(
    page: &Page,
    old: &Page,
    ids: &[BlockId],
    client: &ClientId,
    ctx: &ResolveCtx,
) -> Result<Txn, EditError> {
    check_page(page, page.id)?;
    let at = ctx.clock.now();
    let (gone, coming) = pick(page, old, ids, at)?;
    let mut ops = Vec::new();
    if !coming.is_empty() {
        ops.extend(missing_assets(page, old, &coming));
        if !gone.is_empty() {
            let strokes = gone.iter().flat_map(|b| page.ink.in_block(b.id).cloned()).collect();
            ops.push(Op::DeleteBlocks { blocks: gone, strokes });
        }
        let strokes = returning_strokes(page, old, &coming);
        ops.push(Op::InsertBlocks { blocks: coming });
        if !strokes.is_empty() {
            ops.push(Op::AddStrokes { strokes });
        }
    }
    Ok(Txn {
        ops,
        ..local_txn(ctx, at, (client, &None))
    })
}

/// The current copies to remove and the old copies, stamped with `at`, to bring in.
#[allow(clippy::type_complexity)]
fn pick(
    page: &Page,
    old: &Page,
    ids: &[BlockId],
    at: Timestamp,
) -> Result<(Vec<Arc<Block>>, Vec<Arc<Block>>), EditError> {
    let mut seen = HashSet::new();
    let (mut gone, mut coming) = (Vec::new(), Vec::new());
    for &id in ids.iter().filter(|id| seen.insert(**id)) {
        let theirs = old
            .blocks
            .get(id)
            .ok_or_else(|| not_found(format!("block {id} in that version")))?;
        if let Some(mine) = page.blocks.get(id) {
            if blocks_equal(mine, theirs) && same_strokes(page, old, id) {
                continue;
            }
            if lock_level(mine) == LockLevel::All {
                return Err(locked(id));
            }
            gone.push(find_block(page, id)?.clone());
        }
        coming.push(Arc::new(Block {
            modified: at,
            ..Block::clone(theirs)
        }));
    }
    Ok((gone, coming))
}

/// Whether the block holds the same strokes in both versions of the page.
fn same_strokes(page: &Page, old: &Page, id: BlockId) -> bool {
    let (mine, theirs) = (page.ink.count_in_block(id), old.ink.count_in_block(id));
    mine == theirs
        && old
            .ink
            .in_block(id)
            .all(|stroke| page.ink.stroke(stroke.id).is_some_and(|now| strokes_equal(now, stroke)))
}

/// The old strokes of the blocks that come back. A stroke that the page still has in a block that stays is
/// left where it is.
fn returning_strokes(page: &Page, old: &Page, coming: &[Arc<Block>]) -> Vec<Arc<Stroke>> {
    let replaced: HashSet<BlockId> = coming.iter().map(|block| block.id).collect();
    coming
        .iter()
        .flat_map(|block| old.ink.in_block(block.id).cloned())
        .filter(|stroke| {
            page.ink
                .stroke(stroke.id)
                .is_none_or(|now| replaced.contains(&now.block))
        })
        .collect()
}

/// `AddAsset` operations for the assets that the restored blocks use and the page's table no longer lists. An
/// asset's file stays on disk while a version uses it, so only the table entry comes back.
fn missing_assets(page: &Page, old: &Page, coming: &[Arc<Block>]) -> Vec<Op> {
    old.assets
        .iter()
        .filter(|(id, _)| !page.assets.contains_key(id))
        .filter(|(id, _)| coming.iter().any(|block| block_uses_asset(block, **id)))
        .map(|(_, asset)| Op::AddAsset { asset: asset.clone() })
        .collect()
}
