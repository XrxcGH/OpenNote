//! The query's letters in order, anywhere in the title.
//!
//! A small dynamic program picks the placement that favors letters at the start of words and letters in a row.

use super::{merge, Folded, FuzzyMatch, MatchKind, Needle};

const MATCH: i32 = 16;
const WORD_START: i32 = 16;
const IN_A_ROW: i32 = 12;
const GAP: i32 = 2;
const MISSING: i32 = i32::MIN / 2;

/// The best score of each query letter placed at each title letter, and where the letter before it sat.
struct Table {
    /// Title letters in a row of the table.
    width: usize,
    best: Vec<i32>,
    from: Vec<usize>,
}

/// Whether the letters of `needle` appear in `hay` in order.
fn appears_in_order(needle: &[char], hay: &[char]) -> bool {
    let mut cursor = 0;
    for letter in needle {
        match hay[cursor..].iter().position(|c| c == letter) {
            Some(at) => cursor += at + 1,
            None => return false,
        }
    }
    true
}

impl Table {
    fn fill(letters: &[char], hay: &Folded) -> Table {
        let width = hay.chars.len();
        let mut table = Table {
            width,
            best: vec![MISSING; letters.len() * width],
            from: vec![usize::MAX; letters.len() * width],
        };
        for (i, letter) in letters.iter().enumerate() {
            table.fill_row(i, *letter, hay);
        }
        table
    }

    fn fill_row(&mut self, i: usize, letter: char, hay: &Folded) {
        let n = self.width;
        let word_start = |j: usize| j == 0 || !hay.chars[j - 1].is_alphanumeric();
        // The best score of the letters before this one and where it ends, minus the cost of the gap to `j`.
        let mut gap_best = (MISSING, usize::MAX);
        for j in i..n {
            if i > 0 && j >= 2 {
                gap_best = self.widen(gap_best, i, j);
            }
            if hay.chars[j] != letter {
                continue;
            }
            let here = MATCH + if word_start(j) { WORD_START } else { 0 };
            if i == 0 {
                self.best[j] = here - (j as i32).min(12);
                continue;
            }
            let row = (j >= 1)
                .then(|| self.best[(i - 1) * n + (j - 1)])
                .filter(|score| *score > MISSING);
            let (previous, source) = match (row, gap_best) {
                (Some(row), (gap, _)) if row + IN_A_ROW >= gap => (row + IN_A_ROW, j - 1),
                (_, (gap, source)) if gap > MISSING => (gap, source),
                (Some(row), _) => (row + IN_A_ROW, j - 1),
                _ => continue,
            };
            self.best[i * n + j] = here + previous;
            self.from[i * n + j] = source;
        }
    }

    /// Moves the best gapped predecessor one letter on, and lets the letter two back join it.
    fn widen(&self, gap_best: (i32, usize), i: usize, j: usize) -> (i32, usize) {
        let aged = if gap_best.0 > MISSING {
            (gap_best.0 - GAP, gap_best.1)
        } else {
            gap_best
        };
        let candidate = self.best[(i - 1) * self.width + (j - 2)];
        if candidate > MISSING && candidate - GAP > aged.0 {
            (candidate - GAP, j - 2)
        } else {
            aged
        }
    }

    /// Where the last query letter ends best, and its score.
    fn best_end(&self, letters: usize) -> Option<(usize, i32)> {
        let last = (letters - 1) * self.width;
        (0..self.width)
            .map(|j| (j, self.best[last + j]))
            .filter(|(_, score)| *score > MISSING)
            .fold(None, |kept: Option<(usize, i32)>, found| match kept {
                Some(kept) if kept.1 >= found.1 => Some(kept),
                _ => Some(found),
            })
    }

    /// The title letter of each query letter, following the best path back from `end`.
    fn placed(&self, letters: usize, end: usize) -> Vec<usize> {
        let mut placed = vec![0; letters];
        let mut j = end;
        for i in (0..letters).rev() {
            placed[i] = j;
            if i > 0 {
                j = self.from[i * self.width + j];
            }
        }
        placed
    }
}

/// Matches the query's letters, in order, anywhere in the title.
pub(super) fn subsequence(needle: &Needle, hay: &Folded) -> Option<FuzzyMatch> {
    let letters = needle.compact.as_slice();
    if letters.len() > hay.chars.len() || !appears_in_order(letters, &hay.chars) {
        return None;
    }
    let table = Table::fill(letters, hay);
    let (end, top) = table.best_end(letters.len())?;
    let placed = table.placed(letters.len(), end);
    let best_possible = letters.len() as i32 * (MATCH + WORD_START + IN_A_ROW);
    let quality = (80 * top.max(0) / best_possible.max(1)).clamp(0, 80) as u32;
    Some(FuzzyMatch {
        kind: MatchKind::Subsequence,
        score: MatchKind::Subsequence.base_score() + quality,
        ranges: merge(placed.into_iter().map(|at| hay.bytes(at..at + 1)).collect()),
    })
}
