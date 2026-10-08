//! The last resort: each query word is a small slip away from a title word.

use super::{merge, Folded, FuzzyMatch, MatchKind, Needle};

/// Each query word, at least four letters long, is within a slip or two of a different title word.
pub(super) fn typo(needle: &Needle, hay: &Folded, bonus: u32) -> Option<FuzzyMatch> {
    let mut used = vec![false; hay.tokens.len()];
    let mut ranges = Vec::new();
    let mut total = 0;
    for token in &needle.tokens {
        let allowed = match token.len() {
            0..=3 => return None,
            4..=7 => 1,
            _ => 2,
        };
        let mut closest: Option<(usize, usize)> = None;
        for (i, _) in hay.tokens.iter().enumerate().filter(|(i, _)| !used[*i]) {
            let distance = slip(token, hay.token(i));
            if distance <= allowed && closest.is_none_or(|(_, d)| distance < d) {
                closest = Some((i, distance));
            }
        }
        let (found, distance) = closest?;
        used[found] = true;
        total += distance as u32;
        ranges.push(hay.bytes(hay.tokens[found].clone()));
    }
    ranges.sort_by_key(|range| range.start);
    Some(FuzzyMatch {
        kind: MatchKind::Typo,
        score: MatchKind::Typo.base_score() - (total * 20).min(40) + bonus / 2,
        ranges: merge(ranges),
    })
}

/// How far `typed` is from the start of `word`, or from all of it: the fewest letters to change, add, remove,
/// or swap with a neighbor. The word may run on past what was typed, so a word still being typed is close to it.
pub(super) fn slip(typed: &[char], word: &[char]) -> usize {
    let shortest = typed.len().saturating_sub(1).max(1).min(word.len());
    let longest = (typed.len() + 1).min(word.len());
    (shortest..=longest)
        .map(|len| edit_distance(typed, &word[..len]))
        .min()
        .unwrap_or(usize::MAX)
}

/// The longest word, in letters, that [`edit_distance`] can compare.
const MAX_LETTERS: usize = 50;

/// The Damerau-Levenshtein distance with adjacent swaps (optimal string alignment).
///
/// A word longer than [`MAX_LETTERS`] is as far from anything as its length. A query word is at most 48 letters,
/// and it is compared with title prefixes that are at most one letter longer, so this never happens in use.
pub(super) fn edit_distance(a: &[char], b: &[char]) -> usize {
    let (n, m) = (a.len(), b.len());
    if n >= MAX_LETTERS || m >= MAX_LETTERS {
        return n.max(m);
    }
    let mut rows = [[0u8; MAX_LETTERS]; MAX_LETTERS];
    for (i, row) in rows.iter_mut().enumerate().take(n + 1) {
        row[0] = i as u8;
    }
    for (j, cell) in rows[0].iter_mut().enumerate().take(m + 1) {
        *cell = j as u8;
    }
    for i in 1..=n {
        for j in 1..=m {
            let cost = u8::from(a[i - 1] != b[j - 1]);
            let mut best = (rows[i - 1][j] + 1)
                .min(rows[i][j - 1] + 1)
                .min(rows[i - 1][j - 1] + cost);
            if i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1] {
                best = best.min(rows[i - 2][j - 2] + 1);
            }
            rows[i][j] = best;
        }
    }
    usize::from(rows[n][m])
}
