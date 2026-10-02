//! The line diff behind the import of an edited `page.md`: runs of base lines that the edit replaced.

use std::ops::Range;

/// The largest comparison, in lines of the base times lines of the edit, that the merge attempts.
const MAX_COMPARISON: usize = 4_000_000;

fn next(n: usize) -> usize {
    n.saturating_add(1)
}

/// A run of base lines that the edit replaced with a run of its own lines.
#[derive(Debug, PartialEq, Eq)]
pub(super) struct Hunk {
    pub(super) base: Range<usize>,
    pub(super) edited: Range<usize>,
}

/// The lengths of the longest common runs of lines, for every pair of positions in the two texts.
struct Lcs {
    cells: Vec<u32>,
    width: usize,
}

impl Lcs {
    fn get(&self, i: usize, j: usize) -> u32 {
        i.checked_mul(self.width)
            .and_then(|row| row.checked_add(j))
            .and_then(|at| self.cells.get(at))
            .copied()
            .unwrap_or(0)
    }

    fn set(&mut self, i: usize, j: usize, value: u32) {
        let at = i.saturating_mul(self.width).saturating_add(j);
        if let Some(cell) = self.cells.get_mut(at) {
            *cell = value;
        }
    }
}

/// The runs of lines that differ, or `None` when the texts are too long to compare.
pub(super) fn diff(base: &[String], edited: &[&str]) -> Option<Vec<Hunk>> {
    let same = |i: usize, j: usize| matches!((base.get(i), edited.get(j)), (Some(a), Some(b)) if a == b);
    let prefix = (0..base.len().min(edited.len())).take_while(|&k| same(k, k)).count();
    let room = base.len().min(edited.len()).saturating_sub(prefix);
    let suffix = (0..room)
        .take_while(|&k| same(base.len().saturating_sub(next(k)), edited.len().saturating_sub(next(k))))
        .count();
    let n = base.len().saturating_sub(prefix).saturating_sub(suffix);
    let m = edited.len().saturating_sub(prefix).saturating_sub(suffix);
    if n.saturating_mul(m) > MAX_COMPARISON {
        return None;
    }
    let same_here = |i: usize, j: usize| same(prefix.saturating_add(i), prefix.saturating_add(j));
    let mut lcs = Lcs {
        cells: vec![0; n.saturating_add(1).saturating_mul(m.saturating_add(1))],
        width: m.saturating_add(1),
    };
    for i in (0..n).rev() {
        for j in (0..m).rev() {
            let value = if same_here(i, j) {
                lcs.get(next(i), next(j)).saturating_add(1)
            } else {
                lcs.get(next(i), j).max(lcs.get(i, next(j)))
            };
            lcs.set(i, j, value);
        }
    }
    Some(walk(&lcs, (n, m), prefix, same_here))
}

/// Follows the table from the start, collecting the runs that don't match.
fn walk(lcs: &Lcs, (n, m): (usize, usize), prefix: usize, same: impl Fn(usize, usize) -> bool) -> Vec<Hunk> {
    let hunk = |(bi, i): (usize, usize), (bj, j): (usize, usize)| Hunk {
        base: prefix.saturating_add(bi)..prefix.saturating_add(i),
        edited: prefix.saturating_add(bj)..prefix.saturating_add(j),
    };
    let mut hunks = Vec::new();
    let (mut i, mut j) = (0, 0);
    let mut open: Option<(usize, usize)> = None;
    while i < n || j < m {
        if i < n && j < m && same(i, j) {
            if let Some((bi, bj)) = open.take() {
                hunks.push(hunk((bi, i), (bj, j)));
            }
            i = next(i);
            j = next(j);
            continue;
        }
        open.get_or_insert((i, j));
        if j >= m || (i < n && lcs.get(next(i), j) >= lcs.get(i, next(j))) {
            i = next(i);
        } else {
            j = next(j);
        }
    }
    if let Some((bi, bj)) = open {
        hunks.push(hunk((bi, n), (bj, m)));
    }
    hunks
}
