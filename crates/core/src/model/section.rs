//! `section.json` (spec 4.2), its page list, and page levels (spec 4.4).

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use super::{Color, FormatInfo, JsonMap};
use crate::id::{GroupId, PageId, SectionId, TrashItemId};
use crate::order::OrderKey;
use crate::time::Timestamp;

/// The deepest page level: a sub-subpage.
pub const MAX_PAGE_LEVEL: u8 = 2;

/// The content of `section.json`.
#[derive(Clone, Debug, PartialEq)]
pub struct SectionFile {
    /// The section's identity, which also names its folder.
    pub id: SectionId,
    /// The display name.
    pub title: String,
    /// The section's color chip.
    pub color: Option<Color>,
    /// The group that holds it, or `None` at the top level.
    pub group: Option<GroupId>,
    /// Position among its siblings.
    pub order: OrderKey,
    /// When the section was made.
    pub created: Timestamp,
    /// When a field of this file last changed. Used only to merge sync copies.
    pub changed: Timestamp,
    /// Defaults for new pages, over the notebook's defaults.
    pub defaults: Option<JsonMap>,
    /// Reserved for encrypted sections (spec 5.7). A version 1 reader never writes a section that has it.
    pub encryption: Option<serde_json::Value>,
    /// The page list, in any order. Display order comes from [`page_levels`].
    pub pages: Vec<PageEntry>,
    /// Unknown keys.
    pub extra: JsonMap,
    /// What the reader found. Never written.
    pub format: FormatInfo,
}

/// An entry of a section's page list. Serialized for the interface's Trash list, without `moving` and `extra`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PageEntry {
    /// The page's ID, which also names its folder.
    pub id: PageId,
    /// A copy of the page's title. The title in `page.json` wins when they differ.
    pub title: String,
    /// The parent page, for a subpage.
    pub parent: Option<PageId>,
    /// Position among pages with the same parent.
    pub order: OrderKey,
    /// Pinned in the navigation tree.
    pub pinned: bool,
    /// The page's color chip.
    pub color: Option<Color>,
    /// When a field of this entry last changed. Used only to merge sync copies.
    pub changed: Timestamp,
    /// Present while the page folder is still on its way here.
    #[serde(skip)]
    pub moving: Option<Moving>,
    /// Unknown keys.
    #[serde(skip)]
    pub extra: JsonMap,
}

/// Where a page folder is coming from (spec 4.2).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Moving {
    /// A move from another section.
    From(SectionId),
    /// A restore from Trash.
    FromTrash(TrashItemId),
}

/// The display order of a page list, with each page's level (spec 4.4).
///
/// Returns `(index into entries, level)` pairs: each page is followed by its subpages, siblings sorted by order
/// key, then ID. A page whose parent is missing is at level 0. A page deeper than level 2 is shown at level 2.
/// When parents form a loop, the page in the loop that sorts first becomes a top-level page.
pub fn page_levels(entries: &[PageEntry]) -> Vec<(usize, u8)> {
    let index: HashMap<PageId, usize> = entries.iter().enumerate().map(|(i, e)| (e.id, i)).collect();
    let parents: Vec<Option<usize>> = entries
        .iter()
        .enumerate()
        .map(|(i, entry)| entry.parent.and_then(|p| index.get(&p).copied()).filter(|&p| p != i))
        .collect();
    let mut children: HashMap<Option<usize>, Vec<usize>> = HashMap::new();
    for (i, parent) in parents.iter().enumerate() {
        children.entry(*parent).or_default().push(i);
    }
    let sort_key = |i: usize| (&entries[i].order, entries[i].id);
    for list in children.values_mut() {
        list.sort_by(|&a, &b| sort_key(a).cmp(&sort_key(b)));
    }
    let mut out = Vec::with_capacity(entries.len());
    let mut visited = HashSet::with_capacity(entries.len());
    walk(
        children.get(&None).map_or(&[][..], Vec::as_slice),
        &children,
        &mut visited,
        &mut out,
    );
    // What is left hangs off a loop of parents. Each loop starts at its first page, as if it were at the top.
    let mut rest: Vec<usize> = (0..entries.len()).filter(|i| !visited.contains(i)).collect();
    rest.sort_by(|&a, &b| sort_key(a).cmp(&sort_key(b)));
    for i in rest {
        if !visited.contains(&i) {
            let start = loop_members(i, &parents)
                .into_iter()
                .min_by(|&a, &b| sort_key(a).cmp(&sort_key(b)));
            walk(&[start.unwrap_or(i)], &children, &mut visited, &mut out);
        }
    }
    out
}

/// The pages of the loop that the chain of parents from `start` runs into.
fn loop_members(start: usize, parents: &[Option<usize>]) -> Vec<usize> {
    let mut chain = Vec::new();
    let mut seen = HashSet::new();
    let mut current = Some(start);
    while let Some(i) = current {
        if !seen.insert(i) {
            let first = chain.iter().position(|&c| c == i).unwrap_or(0);
            return chain.split_off(first);
        }
        chain.push(i);
        current = parents.get(i).copied().flatten();
    }
    chain
}

/// Walks the subtrees of `roots` depth first, without recursion, so long chains can't overflow the stack.
fn walk(
    roots: &[usize],
    children: &HashMap<Option<usize>, Vec<usize>>,
    visited: &mut HashSet<usize>,
    out: &mut Vec<(usize, u8)>,
) {
    let mut stack: Vec<(usize, u8)> = roots.iter().rev().map(|&i| (i, 0)).collect();
    while let Some((i, level)) = stack.pop() {
        if !visited.insert(i) {
            continue;
        }
        out.push((i, level.min(MAX_PAGE_LEVEL)));
        if let Some(kids) = children.get(&Some(i)) {
            let next = level.saturating_add(1);
            stack.extend(kids.iter().rev().map(|&k| (k, next)));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(n: u64, parent: Option<u64>, order: &str) -> PageEntry {
        PageEntry {
            id: page(n),
            title: format!("page {n}"),
            parent: parent.map(page),
            order: OrderKey::parse(order).unwrap(),
            pinned: false,
            color: None,
            changed: Timestamp::EPOCH,
            moving: None,
            extra: JsonMap::new(),
        }
    }

    fn page(n: u64) -> PageId {
        PageId(crate::id::Id::from_parts(n, u128::from(n)))
    }

    fn levels(entries: &[PageEntry]) -> Vec<(u64, u8)> {
        page_levels(entries)
            .into_iter()
            .map(|(i, level)| (entries[i].id.0.time_ms(), level))
            .collect()
    }

    #[test]
    fn subpages_follow_their_parents_in_order() {
        let entries = [
            entry(1, None, "a1"),
            entry(2, Some(1), "a1"),
            entry(3, None, "a0"),
            entry(4, Some(1), "a0"),
            entry(5, Some(4), "a0"),
        ];
        assert_eq!(levels(&entries), [(3, 0), (1, 0), (4, 1), (5, 2), (2, 1)]);
    }

    #[test]
    fn missing_and_self_parents_are_top_level() {
        let entries = [entry(1, Some(9), "a0"), entry(2, Some(2), "a1")];
        assert_eq!(levels(&entries), [(1, 0), (2, 0)]);
    }

    #[test]
    fn deep_chains_stop_at_level_two() {
        let entries = [
            entry(1, None, "a0"),
            entry(2, Some(1), "a0"),
            entry(3, Some(2), "a0"),
            entry(4, Some(3), "a0"),
        ];
        assert_eq!(levels(&entries), [(1, 0), (2, 1), (3, 2), (4, 2)]);
    }

    #[test]
    fn loops_start_at_the_first_page_in_order() {
        let entries = [entry(1, Some(2), "a1"), entry(2, Some(1), "a0"), entry(3, None, "a2")];
        assert_eq!(levels(&entries), [(3, 0), (2, 0), (1, 1)]);
    }

    #[test]
    fn pages_hanging_off_a_loop_stay_under_it() {
        let entries = [
            entry(1, Some(2), "a1"),
            entry(2, Some(1), "a2"),
            entry(5, Some(1), "a0"),
        ];
        assert_eq!(levels(&entries), [(1, 0), (5, 1), (2, 1)]);
    }

    #[test]
    fn equal_keys_sort_by_id() {
        let entries = [entry(2, None, "a0"), entry(1, None, "a0")];
        assert_eq!(levels(&entries), [(1, 0), (2, 0)]);
    }

    #[test]
    fn a_long_chain_does_not_overflow_the_stack() {
        let entries: Vec<PageEntry> = (1..=100_000).map(|n| entry(n, (n > 1).then(|| n - 1), "a0")).collect();
        let result = page_levels(&entries);
        assert_eq!(result.len(), 100_000);
        assert!(result.iter().skip(2).all(|&(_, level)| level == 2));
    }
}
