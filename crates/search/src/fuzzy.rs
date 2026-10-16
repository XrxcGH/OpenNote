//! Fuzzy matching of a short query against a short text, for the quick switcher and for any list a person
//! filters by typing.
//!
//! A query matches a title in one of seven ways, from best to worst. The first is [`MatchKind::Exact`]: the
//! title is the query. Next is [`MatchKind::Prefix`]: the title starts with the query, and each query word
//! starts a title word, so `phys la` finds `Physics Lab Notes`. [`MatchKind::WordPrefix`] is the same from a
//! later word, so `lab` finds it too.
//!
//! In [`MatchKind::Words`], every query word starts a different title word, in any order, so `lab phys` finds
//! it. In [`MatchKind::Substring`] the query is inside the title, so `synth` finds `Photosynthesis`. In
//! [`MatchKind::Subsequence`] the query's letters appear in order, so `pnt` finds `Physics Notes`. Letters that
//! start words and letters in a row score higher.
//!
//! The last resort is [`MatchKind::Typo`]. Each query word is a small slip away from a title word: one letter
//! wrong, missing, extra, or swapped, or two for long words. So `photosyntesis` finds `Photosynthesis`.
//!
//! Case, accents, and punctuation do not matter. A match also gives the byte ranges of the title to highlight.
//! The score is a number where larger is better. Each kind has a base score. The bonuses within a kind stay
//! below the gap between kinds, so a better kind always wins unless the caller adds its own bonus on top.

use std::ops::Range;

use serde::Serialize;
use unicode_normalization::char::is_combining_mark;
use unicode_normalization::UnicodeNormalization;

/// The longest title read, in letters. A longer title is matched by its start.
const MAX_HAY_CHARS: usize = 256;
/// The longest query read, in letters.
const MAX_NEEDLE_CHARS: usize = 48;

/// How a query matched a title. Earlier kinds are better matches.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum MatchKind {
    /// The title is the query.
    Exact,
    /// The title starts with the query.
    Prefix,
    /// A run of title words, after the first, starts with the query.
    WordPrefix,
    /// Each query word starts a different title word, in any order.
    Words,
    /// The query is inside the title.
    Substring,
    /// The query's letters appear in the title, in order.
    Subsequence,
    /// Each query word is close to a title word.
    Typo,
}

impl MatchKind {
    /// The score every match of this kind starts from.
    pub fn base_score(self) -> u32 {
        match self {
            MatchKind::Exact => 1000,
            MatchKind::Prefix => 800,
            MatchKind::WordPrefix => 650,
            MatchKind::Words => 520,
            MatchKind::Substring => 420,
            MatchKind::Subsequence => 300,
            MatchKind::Typo => 200,
        }
    }
}

/// A title that matched a query.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FuzzyMatch {
    /// How it matched.
    pub kind: MatchKind,
    /// How well. Larger is better.
    pub score: u32,
    /// The byte ranges of the title that matched, in order and apart, for highlighting.
    pub ranges: Vec<Range<usize>>,
}

/// Text folded for matching: lowercase, without accents, with each letter's place in the original.
#[derive(Clone, Debug, Default)]
struct Folded {
    chars: Vec<char>,
    starts: Vec<usize>,
    ends: Vec<usize>,
    /// The runs of letters and digits, as ranges of `chars`.
    tokens: Vec<Range<usize>>,
}

fn fold_text(text: &str, limit: usize) -> Folded {
    let mut folded = Folded::default();
    'text: for (at, c) in text.char_indices() {
        let end = at + c.len_utf8();
        for lower in std::iter::once(c)
            .nfd()
            .filter(|d| !is_combining_mark(*d))
            .flat_map(char::to_lowercase)
        {
            if folded.chars.len() >= limit {
                break 'text;
            }
            folded.chars.push(lower);
            folded.starts.push(at);
            folded.ends.push(end);
        }
    }
    let mut start = None;
    for (at, c) in folded.chars.iter().enumerate() {
        match (start, c.is_alphanumeric()) {
            (None, true) => start = Some(at),
            (Some(from), false) => {
                folded.tokens.push(from..at);
                start = None;
            }
            _ => {}
        }
    }
    if let Some(from) = start {
        folded.tokens.push(from..folded.chars.len());
    }
    folded
}

impl Folded {
    fn token(&self, index: usize) -> &[char] {
        &self.chars[self.tokens[index].clone()]
    }

    /// The bytes of the original text that letters `range` came from.
    fn bytes(&self, range: Range<usize>) -> Range<usize> {
        self.starts[range.start]..self.ends[range.end - 1]
    }

    fn letters(&self) -> usize {
        self.tokens.iter().map(|token| token.len()).sum()
    }
}

/// A title, prepared once so many queries can match it quickly.
#[derive(Clone, Debug)]
pub struct Haystack {
    folded: Folded,
}

impl Haystack {
    /// Prepares a title.
    pub fn new(text: &str) -> Haystack {
        Haystack {
            folded: fold_text(text, MAX_HAY_CHARS),
        }
    }

    /// Whether the title holds no letters or digits, so no query can match it.
    pub fn is_blank(&self) -> bool {
        self.folded.tokens.is_empty()
    }
}

/// A query, prepared once to match many titles.
#[derive(Clone, Debug)]
pub struct Needle {
    tokens: Vec<Vec<char>>,
    /// The words with one space between them.
    joined: Vec<char>,
    /// The letters of every word, with nothing between.
    compact: Vec<char>,
}

impl Needle {
    /// Prepares a query. Returns `None` when it holds no letters or digits.
    pub fn new(query: &str) -> Option<Needle> {
        let folded = fold_text(query, MAX_NEEDLE_CHARS);
        if folded.tokens.is_empty() {
            return None;
        }
        let tokens: Vec<Vec<char>> = (0..folded.tokens.len()).map(|i| folded.token(i).to_vec()).collect();
        let joined = tokens.join(&' ');
        let compact = tokens.concat();
        Some(Needle {
            tokens,
            joined,
            compact,
        })
    }
}

/// Matches a query against a title. Returns the best way it matches, or `None`.
pub fn fuzzy_match(needle: &Needle, hay: &Haystack) -> Option<FuzzyMatch> {
    fuzzy_match_strict(needle, hay).or_else(|| fuzzy_match_typo(needle, hay))
}

/// Like [`fuzzy_match`], but without the last resort: it never finds a title by a typo. It is much cheaper, so a
/// list that filters many titles can try it first and look for typos only when nothing better matched.
pub fn fuzzy_match_strict(needle: &Needle, hay: &Haystack) -> Option<FuzzyMatch> {
    let folded = &hay.folded;
    if folded.tokens.is_empty() {
        return None;
    }
    let bonus = length_bonus(needle, folded);
    exact(needle, folded)
        .or_else(|| aligned(needle, folded, bonus))
        .or_else(|| words(needle, folded, bonus))
        .or_else(|| substring(needle, folded, bonus))
        .or_else(|| scatter::subsequence(needle, folded))
}

/// Matches a query against a title by a typo only: each query word is a small slip away from a title word.
pub fn fuzzy_match_typo(needle: &Needle, hay: &Haystack) -> Option<FuzzyMatch> {
    let folded = &hay.folded;
    if folded.tokens.is_empty() {
        return None;
    }
    typo::typo(needle, folded, length_bonus(needle, folded))
}

/// Up to 50 points for a title no longer than the query, so shorter titles come first within a kind.
fn length_bonus(needle: &Needle, hay: &Folded) -> u32 {
    let ratio = needle.compact.len() * 50 / hay.letters().max(1);
    ratio.min(50) as u32
}

fn exact(needle: &Needle, hay: &Folded) -> Option<FuzzyMatch> {
    if needle.tokens.len() != hay.tokens.len() {
        return None;
    }
    let same = needle
        .tokens
        .iter()
        .enumerate()
        .all(|(i, token)| token.as_slice() == hay.token(i));
    same.then(|| FuzzyMatch {
        kind: MatchKind::Exact,
        score: MatchKind::Exact.base_score(),
        ranges: merge(hay.tokens.iter().map(|token| hay.bytes(token.clone())).collect()),
    })
}

/// The query's words each start a title word, in a row, from the first word (a prefix) or a later one.
fn aligned(needle: &Needle, hay: &Folded, bonus: u32) -> Option<FuzzyMatch> {
    let n = needle.tokens.len();
    if hay.tokens.len() < n {
        return None;
    }
    for first in 0..=hay.tokens.len() - n {
        let starts = needle
            .tokens
            .iter()
            .enumerate()
            .all(|(i, token)| hay.token(first + i).starts_with(token));
        if !starts {
            continue;
        }
        let whole = needle
            .tokens
            .iter()
            .enumerate()
            .filter(|(i, token)| hay.token(first + i).len() == token.len())
            .count() as u32;
        let ranges = needle
            .tokens
            .iter()
            .enumerate()
            .map(|(i, token)| {
                let from = hay.tokens[first + i].start;
                hay.bytes(from..from + token.len())
            })
            .collect();
        let (kind, score) = if first == 0 {
            (MatchKind::Prefix, MatchKind::Prefix.base_score() + whole * 6 + bonus)
        } else {
            let later = (first as u32 * 10).min(40);
            (
                MatchKind::WordPrefix,
                MatchKind::WordPrefix.base_score() - later + whole * 6 + bonus,
            )
        };
        return Some(FuzzyMatch {
            kind,
            score,
            ranges: merge(ranges),
        });
    }
    None
}

/// Every query word starts a different title word, in any order.
fn words(needle: &Needle, hay: &Folded, bonus: u32) -> Option<FuzzyMatch> {
    if needle.tokens.len() < 2 || hay.tokens.len() < needle.tokens.len() {
        return None;
    }
    let mut used = vec![false; hay.tokens.len()];
    let mut ranges = Vec::new();
    for token in &needle.tokens {
        let found = (0..hay.tokens.len()).find(|i| !used[*i] && hay.token(*i).starts_with(token))?;
        used[found] = true;
        let from = hay.tokens[found].start;
        ranges.push(hay.bytes(from..from + token.len()));
    }
    ranges.sort_by_key(|range| range.start);
    Some(FuzzyMatch {
        kind: MatchKind::Words,
        score: MatchKind::Words.base_score() + bonus,
        ranges: merge(ranges),
    })
}

fn substring(needle: &Needle, hay: &Folded, bonus: u32) -> Option<FuzzyMatch> {
    let wanted = needle.joined.as_slice();
    let at = hay.chars.windows(wanted.len()).position(|window| window == wanted)?;
    let early = (at as u32).min(40);
    Some(FuzzyMatch {
        kind: MatchKind::Substring,
        score: MatchKind::Substring.base_score() - early + bonus / 2,
        ranges: vec![hay.bytes(at..at + wanted.len())],
    })
}

/// Joins ranges that touch or overlap, so a highlight is one run.
fn merge(mut ranges: Vec<Range<usize>>) -> Vec<Range<usize>> {
    ranges.sort_by_key(|range| range.start);
    let mut out: Vec<Range<usize>> = Vec::with_capacity(ranges.len());
    for range in ranges {
        match out.last_mut() {
            Some(last) if range.start <= last.end => last.end = last.end.max(range.end),
            _ => out.push(range),
        }
    }
    out
}

mod scatter;
#[cfg(test)]
mod tests;
mod typo;
