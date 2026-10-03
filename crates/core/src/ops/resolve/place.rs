//! Order keys for new and moved blocks (spec 2.8).
//!
//! A block placed after or before a sibling gets a key between its neighbors. Sometimes no key fits between
//! them: two neighbors share a key, or another tool wrote keys that `OrderKey::between` can't use. Every block
//! then gets a new, evenly spread key, and the transaction moves each block whose key changed.

use super::{invalid, locked, not_found, EditCtx};
use crate::error::EditError;
use crate::id::BlockId;
use crate::ops::apply::checks::{lock_level, LockLevel};
use crate::ops::{Op, Placement, Stamps};
use crate::order::OrderKey;

/// The key for a block placed after `after`, before `before`, or at the end. It comes with the operations that
/// re-key other blocks, if any. `moving` is the block being moved, left out of the siblings.
pub(super) fn place(
    c: &EditCtx<'_>,
    moving: Option<BlockId>,
    after: Option<BlockId>,
    before: Option<BlockId>,
) -> Result<(Vec<Op>, OrderKey), EditError> {
    if moving.is_none() && after.is_none() && before.is_none() {
        if let Ok(key) = OrderKey::between(c.page.blocks.last_key(), None) {
            return Ok((Vec::new(), key));
        }
    }
    let siblings: Vec<(OrderKey, BlockId)> = c
        .page
        .blocks
        .iter()
        .filter(|b| Some(b.id) != moving)
        .map(|b| (b.order.clone(), b.id))
        .collect();
    let index = slot(&siblings, after, before)?;
    let low = index.checked_sub(1).and_then(|i| siblings.get(i)).map(|s| &s.0);
    let high = siblings.get(index).map(|s| &s.0);
    if let Some(current) = moving.and_then(|id| c.page.blocks.get(id)) {
        let fits = low.is_none_or(|l| *l < current.order) && high.is_none_or(|h| current.order < *h);
        if fits {
            return Ok((Vec::new(), current.order.clone()));
        }
    }
    match OrderKey::between(low, high) {
        Ok(key) => Ok((Vec::new(), key)),
        Err(_) => rekey(c, &siblings, index),
    }
}

/// Where among the siblings the block goes.
fn slot(siblings: &[(OrderKey, BlockId)], after: Option<BlockId>, before: Option<BlockId>) -> Result<usize, EditError> {
    let position = |id: BlockId| {
        siblings
            .iter()
            .position(|s| s.1 == id)
            .ok_or_else(|| not_found(format!("block {id}")))
    };
    match (after, before) {
        (None, None) => Ok(siblings.len()),
        (None, Some(before)) => position(before),
        (Some(after), before) => {
            let index = position(after)? + 1;
            match before {
                Some(before) if siblings.get(index).map(|s| s.1) != Some(before) => {
                    Err(invalid("the blocks named by after and before are not neighbors"))
                }
                _ => Ok(index),
            }
        }
    }
}

/// New keys for every sibling and the placed block, with a move for each sibling whose key changed.
fn rekey(c: &EditCtx<'_>, siblings: &[(OrderKey, BlockId)], index: usize) -> Result<(Vec<Op>, OrderKey), EditError> {
    let count = siblings.len() + 1;
    let keys = OrderKey::spread(None, None, count).map_err(|e| invalid(e.to_string()))?;
    let mut ops = Vec::new();
    let mut placed = None;
    for (position, key) in keys.into_iter().enumerate() {
        let sibling = match position.cmp(&index) {
            std::cmp::Ordering::Less => siblings.get(position),
            std::cmp::Ordering::Equal => {
                placed = Some(key);
                continue;
            }
            std::cmp::Ordering::Greater => siblings.get(position - 1),
        };
        let Some((old, id)) = sibling else { continue };
        if *old == key {
            continue;
        }
        let block = super::find_block(c.page, *id)?;
        if lock_level(block) != LockLevel::Free {
            return Err(locked(*id));
        }
        ops.push(Op::MoveBlock {
            id: *id,
            before: Placement {
                order: old.clone(),
                frame: block.frame.clone(),
            },
            after: Placement {
                order: key,
                frame: block.frame.clone(),
            },
            stamps: Stamps {
                before: block.modified,
                after: c.at,
            },
        });
    }
    let placed = placed.ok_or_else(|| invalid("no order key is left for the block"))?;
    Ok((ops, placed))
}
