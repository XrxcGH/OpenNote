//! Snippets: the few words around a match, with the matched words marked.

use std::ops::Range;

use opennote_core::BlockId;
use serde::Serialize;

use crate::doc::BlockKind;
use crate::query::Term;
use crate::text::{words, Word};

/// Words of context before the first match.
const WORDS_BEFORE: usize = 6;
/// Words in a whole snippet.
const WORDS_TOTAL: usize = 26;
/// Bytes of context before a match found by [`around`].
const AROUND_BEFORE: usize = 40;
/// Bytes in a snippet made by [`around`].
const AROUND_TOTAL: usize = 160;
/// The most bytes a snippet made by [`around`] shows of one long match.
const AROUND_MAX: usize = 400;
const ELLIPSIS: &str = "\u{2026}";

/// A block of a page, as the index stores it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoredBlock {
    /// The block's ID.
    pub id: BlockId,
    /// The block's type.
    pub kind: BlockKind,
    /// The block's plain text.
    pub text: String,
}

/// A few words of a block, for a result list.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snippet {
    /// The block the words come from, so the result can open the page at that block.
    pub block: BlockId,
    /// The block's type.
    pub kind: BlockKind,
    /// The words, with `…` where the text was cut.
    pub text: String,
    /// The byte ranges of the matched words in `text`.
    pub highlights: Vec<Range<usize>>,
}

/// The byte ranges of the words of `text` that match a term.
pub fn highlights(text: &str, terms: &[Term]) -> Vec<Range<usize>> {
    let found = words(text);
    matching(&found, terms)
        .into_iter()
        .map(|(at, _)| found[at].range.clone())
        .collect()
}

/// The snippet of the block that matches the most terms. Without any match, the start of the first block.
pub fn best(blocks: &[StoredBlock], terms: &[Term]) -> Option<Snippet> {
    let mut best: Option<(usize, usize, Vec<Word>)> = None;
    for (index, block) in blocks.iter().enumerate() {
        let found = words(&block.text);
        let matches = matching(&found, terms);
        let distinct = (0..terms.len())
            .filter(|t| matches.iter().any(|(_, term)| term == t))
            .count();
        if distinct > best.as_ref().map_or(0, |b| b.0) {
            best = Some((distinct, index, found));
        }
    }
    match best {
        Some((_, index, found)) => Some(cut(&blocks[index], &found, terms)),
        None => {
            let block = blocks.iter().find(|block| !block.text.trim().is_empty())?;
            Some(cut(block, &words(&block.text), &[]))
        }
    }
}

/// The snippet around the first of some byte ranges of a block, for a match that is not a word, such as a
/// regular expression. The text is cut a little before the first range and about 160 bytes long, or up to 400
/// bytes when the first match is long. A match cut by the end is highlighted up to the cut.
pub fn around(block: &StoredBlock, matches: &[Range<usize>]) -> Snippet {
    let text = &block.text;
    let first = matches.first().cloned().unwrap_or(0..0);
    let mut from = first.start.saturating_sub(AROUND_BEFORE).min(text.len());
    while !text.is_char_boundary(from) {
        from += 1;
    }
    let mut to = (from + AROUND_TOTAL)
        .max(first.end.min(from + AROUND_MAX))
        .min(text.len());
    while !text.is_char_boundary(to) {
        to += 1;
    }
    let lead = if from > 0 { ELLIPSIS } else { "" };
    let tail = if to < text.len() { ELLIPSIS } else { "" };
    let body = text[from..to].replace(['\n', '\r', '\t'], " ");
    let highlights = matches
        .iter()
        .filter(|found| found.start >= from && found.start < to)
        .map(|found| lead.len() + found.start - from..lead.len() + found.end.min(to) - from)
        .collect();
    Snippet {
        block: block.id,
        kind: block.kind,
        text: format!("{lead}{body}{tail}"),
        highlights,
    }
}

/// Every word that matches a term, as the word's index and the term's index.
fn matching(found: &[Word], terms: &[Term]) -> Vec<(usize, usize)> {
    let mut out = Vec::new();
    for (at, word) in found.iter().enumerate() {
        for (index, term) in terms.iter().enumerate() {
            let last = term.words.len().saturating_sub(1);
            let hit = term.words.iter().enumerate().any(|(n, wanted)| {
                word.folded == *wanted || (term.prefix && n == last && word.folded.starts_with(wanted.as_str()))
            });
            if hit {
                out.push((at, index));
            }
        }
    }
    out
}

fn cut(block: &StoredBlock, found: &[Word], terms: &[Term]) -> Snippet {
    let matches = matching(found, terms);
    let first = matches.first().map_or(0, |(at, _)| *at);
    let start = first.saturating_sub(WORDS_BEFORE);
    let end = (start + WORDS_TOTAL).min(found.len());
    let (from, to) = match (found.get(start), found.get(end.wrapping_sub(1))) {
        (Some(a), Some(b)) => (a.range.start, b.range.end),
        _ => (0, 0),
    };
    let lead = if start > 0 { ELLIPSIS } else { "" };
    let tail = if end < found.len() { ELLIPSIS } else { "" };
    let body = block.text[from..to].replace(['\n', '\r', '\t'], " ");
    let highlights = matches
        .iter()
        .filter(|(at, _)| (start..end).contains(at))
        .map(|(at, _)| {
            let range = &found[*at].range;
            lead.len() + range.start - from..lead.len() + range.end - from
        })
        .collect();
    Snippet {
        block: block.id,
        kind: block.kind,
        text: format!("{lead}{body}{tail}"),
        highlights,
    }
}

#[cfg(test)]
mod tests;
