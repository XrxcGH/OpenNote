//! The blocks of a page: found by ID, walked by order key and ID, and read in reading order (spec 6.2).

use std::collections::{BTreeSet, HashMap};
use std::ops::Bound;
use std::sync::Arc;

use super::{Block, ModelError};
use crate::id::BlockId;
use crate::order::OrderKey;

/// Floating blocks whose tops are this close form one row in reading order (spec 6.2).
pub const READING_ROW_UNITS: f64 = 8.0;

/// A page's blocks: found by ID, and walked by order key, then ID.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Blocks {
    by_id: HashMap<BlockId, Arc<Block>>,
    order: BTreeSet<(OrderKey, BlockId)>,
}

impl Blocks {
    /// No blocks.
    pub fn new() -> Blocks {
        Blocks::default()
    }

    /// The block with this ID.
    pub fn get(&self, id: BlockId) -> Option<&Arc<Block>> {
        self.by_id.get(&id)
    }

    /// Whether a block has this ID.
    pub fn contains(&self, id: BlockId) -> bool {
        self.by_id.contains_key(&id)
    }

    /// Every block, by order key, then ID.
    pub fn iter(&self) -> impl Iterator<Item = &Arc<Block>> + '_ {
        self.order.iter().filter_map(|(_, id)| self.by_id.get(id))
    }

    /// How many blocks there are.
    pub fn len(&self) -> usize {
        self.by_id.len()
    }

    /// Whether there are no blocks.
    pub fn is_empty(&self) -> bool {
        self.by_id.is_empty()
    }

    /// Adds a block. Fails if its ID is taken.
    pub fn insert(&mut self, block: Arc<Block>) -> Result<(), ModelError> {
        if self.by_id.contains_key(&block.id) {
            return Err(ModelError::DuplicateId(block.id.0));
        }
        self.order.insert((block.order.clone(), block.id));
        self.by_id.insert(block.id, block);
        Ok(())
    }

    /// Removes and returns the block with this ID.
    pub fn remove(&mut self, id: BlockId) -> Option<Arc<Block>> {
        let block = self.by_id.remove(&id)?;
        self.order.remove(&(block.order.clone(), id));
        Some(block)
    }

    /// Replaces the block with the same ID, and returns the old one. Fails if no block has the ID.
    pub fn replace(&mut self, block: Arc<Block>) -> Result<Arc<Block>, ModelError> {
        let old = self.remove(block.id).ok_or(ModelError::MissingId(block.id.0))?;
        self.order.insert((block.order.clone(), block.id));
        self.by_id.insert(block.id, block);
        Ok(old)
    }

    /// The order keys of the blocks right before and right after this one. Both are `None` for a missing ID.
    pub fn neighbors(&self, id: BlockId) -> (Option<&OrderKey>, Option<&OrderKey>) {
        let Some(block) = self.by_id.get(&id) else {
            return (None, None);
        };
        let at = (block.order.clone(), id);
        let before = self.order.range(..at.clone()).next_back().map(|(key, _)| key);
        let after = self
            .order
            .range((Bound::Excluded(at), Bound::Unbounded))
            .next()
            .map(|(key, _)| key);
        (before, after)
    }

    /// The largest order key, for adding a block at the end.
    pub fn last_key(&self) -> Option<&OrderKey> {
        self.order.iter().next_back().map(|(key, _)| key)
    }

    /// Block IDs in reading order (spec 6.2): `preferred` first, then flowing blocks, then floating rows.
    pub fn reading_order(&self, preferred: &[BlockId]) -> Vec<BlockId> {
        let mut out: Vec<BlockId> = Vec::with_capacity(self.len());
        let mut seen = BTreeSet::new();
        for &id in preferred {
            if self.contains(id) && seen.insert(id) {
                out.push(id);
            }
        }
        let rest = || self.iter().filter(|b| !seen.contains(&b.id));
        out.extend(rest().filter(|b| !b.is_floating()).map(|b| b.id));
        let floating: Vec<&Arc<Block>> = rest().filter(|b| b.is_floating()).collect();
        out.extend(floating_rows(floating));
        out
    }
}

/// Floating blocks sorted into rows, each row read from left to right.
fn floating_rows(mut blocks: Vec<&Arc<Block>>) -> Vec<BlockId> {
    let pos = |b: &Block| {
        b.frame
            .as_ref()
            .map_or((0.0, 0.0), |f| (f.x.unwrap_or(0.0), f.y.unwrap_or(0.0)))
    };
    let tie = |a: &Block, b: &Block| (&a.order, a.id).cmp(&(&b.order, b.id));
    blocks.sort_by(|a, b| {
        let ((ax, ay), (bx, by)) = (pos(a), pos(b));
        ay.total_cmp(&by).then(ax.total_cmp(&bx)).then_with(|| tie(a, b))
    });
    let mut out = Vec::with_capacity(blocks.len());
    let mut start = 0;
    while start < blocks.len() {
        let top = pos(blocks[start]).1;
        let end = start
            + blocks[start..]
                .iter()
                .take_while(|b| pos(b).1 - top <= READING_ROW_UNITS)
                .count();
        let mut row = blocks[start..end].to_vec();
        row.sort_by(|a, b| {
            let ((ax, ay), (bx, by)) = (pos(a), pos(b));
            ax.total_cmp(&bx).then(ay.total_cmp(&by)).then_with(|| tie(a, b))
        });
        out.extend(row.iter().map(|b| b.id));
        start = end;
    }
    out
}

#[cfg(test)]
mod tests;
