//! The flat page list's rules: levels, the parents they imply, and order keys that follow a wanted order.

use super::arrange::FlatPage;
use super::{invalid_move, not_found, Sibling};
use crate::error::CoreError;
use crate::id::PageId;
use crate::model::section::MAX_PAGE_LEVEL;
use crate::order::OrderKey;

/// The level of children of `parent` in a flat list, and the index after the parent's subtree, where a new
/// last child goes. For `None`, level 0 and the end of the list.
pub(crate) fn child_range(flat: &[FlatPage], parent: Option<PageId>) -> Result<(u8, usize), CoreError> {
    let Some(q) = parent else {
        return Ok((0, flat.len()));
    };
    let i = flat
        .iter()
        .position(|f| f.id == q)
        .ok_or_else(|| not_found(format!("page {q}")))?;
    let lq = flat.get(i).map_or(0, |f| f.level);
    if lq >= MAX_PAGE_LEVEL {
        return Err(invalid_move("subpages nest at most 2 levels deep"));
    }
    let end = flat
        .iter()
        .enumerate()
        .skip(i.saturating_add(1))
        .find(|(_, f)| f.level <= lq)
        .map_or(flat.len(), |(j, _)| j);
    Ok((lq.saturating_add(1), end))
}

/// The parent a flat list implies for the page at `index`: the nearest earlier page one level up.
pub(crate) fn flat_parent(flat: &[FlatPage], index: usize) -> Option<PageId> {
    let level = flat.get(index)?.level.checked_sub(1)?;
    flat.iter().take(index).rev().find(|f| f.level == level).map(|f| f.id)
}

/// Each page of a flat list with the parent it implies.
pub(crate) fn derive_parents(flat: &[FlatPage]) -> Vec<(PageId, Option<PageId>)> {
    let mut last_at: [Option<PageId>; 3] = [None; 3];
    let mut out = Vec::with_capacity(flat.len());
    for f in flat {
        let level = usize::from(f.level.min(MAX_PAGE_LEVEL));
        let parent = level.checked_sub(1).and_then(|l| last_at.get(l).copied().flatten());
        if let Some(slot) = last_at.get_mut(level) {
            *slot = Some(f.id);
        }
        for deeper in last_at.iter_mut().skip(level.saturating_add(1)) {
            *deeper = None;
        }
        out.push((f.id, parent));
    }
    out
}

/// Checks the contract's rules for a flat list: the first page is at level 0, each page is at most one level
/// deeper than the page before it, and no page is deeper than a sub-subpage.
pub(crate) fn check_levels(flat: &[FlatPage]) -> Result<(), CoreError> {
    let mut allowed: u8 = 0;
    for f in flat {
        if f.level > allowed || f.level > MAX_PAGE_LEVEL {
            return Err(invalid_move(
                "a page can be at most one level deeper than the page before it",
            ));
        }
        allowed = f.level.saturating_add(1);
    }
    Ok(())
}

/// Gives a page a new level in place, and shifts its subpages by the same amount.
pub(crate) fn shift_subtree(flat: &mut [FlatPage], page: PageId, level: u8) -> Result<(), CoreError> {
    let start = flat
        .iter()
        .position(|f| f.id == page)
        .ok_or_else(|| not_found(format!("page {page}")))?;
    let base = flat.get(start).map_or(0, |f| f.level);
    let mut first = true;
    for f in flat.iter_mut().skip(start) {
        if !first && f.level <= base {
            break;
        }
        first = false;
        let depth = f.level.saturating_sub(base);
        f.level = level
            .checked_add(depth)
            .filter(|l| *l <= MAX_PAGE_LEVEL)
            .ok_or_else(|| invalid_move("subpages nest at most 2 levels deep"))?;
    }
    Ok(())
}

/// New order keys for a sibling list in its wanted order, so the keys ascend: `None` keeps a key. Keeps the
/// longest run of keys it can find greedily, and spreads new keys over the gaps. When a gap has no room, as
/// between equal keys, every sibling gets a new key.
pub(crate) fn sibling_keys(current: &[Sibling]) -> Result<Vec<Option<OrderKey>>, CoreError> {
    if current.windows(2).all(|w| matches!(w, [a, b] if a < b)) {
        return Ok(vec![None; current.len()]);
    }
    let mut keep = Vec::with_capacity(current.len());
    let mut prev: Option<&Sibling> = None;
    for s in current {
        let ok = prev.is_none_or(|p| s > p) && OrderKey::between(Some(&s.0), None).is_ok();
        keep.push(ok);
        if ok {
            prev = Some(s);
        }
    }
    let mut out: Vec<Option<OrderKey>> = vec![None; current.len()];
    let mut i = 0usize;
    while i < current.len() {
        if keep.get(i) == Some(&true) {
            i = i.saturating_add(1);
            continue;
        }
        let start = i;
        while i < current.len() && keep.get(i) != Some(&true) {
            i = i.saturating_add(1);
        }
        let before = start.checked_sub(1).and_then(|j| current.get(j)).map(|s| &s.0);
        let after = current.get(i).map(|s| &s.0);
        match OrderKey::spread(before, after, i.saturating_sub(start)) {
            Ok(keys) => {
                for (slot, key) in out.iter_mut().skip(start).zip(keys) {
                    *slot = Some(key);
                }
            }
            Err(_) => return respread(current),
        }
    }
    Ok(out)
}

pub(crate) fn respread(current: &[Sibling]) -> Result<Vec<Option<OrderKey>>, CoreError> {
    let keys = OrderKey::spread(None, None, current.len()).map_err(|e| invalid_move(format!("no order keys: {e}")))?;
    Ok(keys
        .into_iter()
        .zip(current)
        .map(|(key, s)| (key != s.0).then_some(key))
        .collect())
}
