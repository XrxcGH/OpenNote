//! Ranking: how the signals of a match combine into one score.
//!
//! The full-text table finds the pages that hold the words and scores their text with BM25. This module takes
//! that score and adds what BM25 cannot see. Then it puts the pages in order.
//!
//! A page whose title is the words typed comes first. Next comes a title that starts with them, then a title
//! that holds them. A page with the words in a heading beats a page with them somewhere in a paragraph.
//!
//! The body signal is the BM25 score of the text, squeezed into 0 to 1 so no single page dominates. Newer pages
//! score higher, and the boost halves every `half_life_days`. It settles ties between pages that match equally
//! well. A weak match never wins on age alone.
//!
//! Pages of the notebook or section the person is in score higher. This boosts and never filters, so a search
//! from one notebook still finds pages of the others.
//!
//! Everything here is a pure function of numbers, so the order is easy to test and to explain. Each hit carries
//! a [`RankBreakdown`] with the parts of its score.

use opennote_core::Timestamp;
use serde::{Deserialize, Serialize};

use crate::query::Term;
use crate::text::words;

const MS_PER_DAY: f64 = 86_400_000.0;

/// How much each signal counts. The defaults put a title match above a heading match above a body match, and
/// leave age and scope to break ties.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RankWeights {
    /// The BM25 score of the text.
    pub body: f64,
    /// How well the title matches.
    pub title: f64,
    /// How well the best heading matches.
    pub heading: f64,
    /// The boost of a page changed just now.
    pub recency: f64,
    /// Days until the recency boost halves.
    pub half_life_days: f64,
    /// The boost of a page in the notebook the person is in.
    pub same_notebook: f64,
    /// The extra boost of a page in the section the person is in.
    pub same_section: f64,
    /// The BM25 score that earns half the body signal. Larger values make the body signal grow more slowly.
    pub body_scale: f64,
}

impl Default for RankWeights {
    fn default() -> RankWeights {
        RankWeights {
            body: 1.0,
            title: 0.8,
            heading: 0.3,
            recency: 0.2,
            half_life_days: 30.0,
            same_notebook: 0.08,
            same_section: 0.08,
            body_scale: 2.0,
        }
    }
}

/// Where a search is happening, for the scope boost.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SearchScope {
    /// The notebook the person is in.
    pub notebook: Option<opennote_core::NotebookId>,
    /// The section the person is in.
    pub section: Option<opennote_core::SectionId>,
}

impl SearchScope {
    /// Whether the scope names anything.
    pub fn is_empty(&self) -> bool {
        self.notebook.is_none() && self.section.is_none()
    }
}

/// What a ranking needs besides the query: the weights, and the time that ages are measured against.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RankContext {
    /// How much each signal counts.
    pub weights: RankWeights,
    /// The current time.
    pub now: Timestamp,
}

impl RankContext {
    /// The default weights at `now`.
    pub fn at(now: Timestamp) -> RankContext {
        RankContext {
            weights: RankWeights::default(),
            now,
        }
    }

    /// The default weights at the current time.
    pub fn current() -> RankContext {
        use opennote_core::{Clock, SystemClock};
        RankContext::at(SystemClock::new().now())
    }
}

/// The signals of one match, before they are weighed.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Signals {
    /// The BM25 score of the text, as a positive number where larger is better.
    pub bm25: f64,
    /// How well the title matches, 0 to 1.
    pub title: f64,
    /// How well the best heading matches, 0 to 1.
    pub heading: f64,
    /// How long ago the page changed, in milliseconds.
    pub age_ms: i64,
    /// The page is in the notebook of the scope.
    pub same_notebook: bool,
    /// The page is in the section of the scope.
    pub same_section: bool,
}

/// The parts of a score, so a result can be explained and a ranking tested.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankBreakdown {
    /// The weighed body signal.
    pub body: f64,
    /// The weighed title signal.
    pub title: f64,
    /// The weighed heading signal.
    pub heading: f64,
    /// The weighed recency boost.
    pub recency: f64,
    /// The scope boost.
    pub scope: f64,
    /// The sum of the parts.
    pub total: f64,
}

/// Weighs the signals of one match.
pub fn score(signals: &Signals, weights: &RankWeights) -> RankBreakdown {
    let bm25 = signals.bm25.max(0.0);
    let scale = weights.body_scale.max(f64::MIN_POSITIVE);
    let body = weights.body * bm25 / (bm25 + scale);
    let title = weights.title * signals.title.clamp(0.0, 1.0);
    let heading = weights.heading * signals.heading.clamp(0.0, 1.0);
    let recency = weights.recency * recency(signals.age_ms, weights.half_life_days);
    let scope = match (signals.same_notebook, signals.same_section) {
        (_, true) => weights.same_notebook + weights.same_section,
        (true, false) => weights.same_notebook,
        (false, false) => 0.0,
    };
    RankBreakdown {
        body,
        title,
        heading,
        recency,
        scope,
        total: body + title + heading + recency + scope,
    }
}

/// 1 for a page changed now, 0.5 after one half-life, and so on. A page from the future counts as new.
pub fn recency(age_ms: i64, half_life_days: f64) -> f64 {
    if age_ms <= 0 || half_life_days <= 0.0 {
        return 1.0;
    }
    0.5_f64.powf(age_ms as f64 / MS_PER_DAY / half_life_days)
}

/// The age of a page, never negative.
pub fn age_ms(now: Timestamp, modified: Timestamp) -> i64 {
    now.unix_ms().saturating_sub(modified.unix_ms()).max(0)
}

/// How well the words of a text hold the query terms, 0 to 1. It is the mean over the terms. A term found
/// whole counts 1. A term found only as the start of a word being typed counts 0.7. A term not found counts 0.
pub fn coverage(text_words: &[String], terms: &[Term]) -> f64 {
    if terms.is_empty() {
        return 0.0;
    }
    let sum: f64 = terms.iter().map(|term| term_coverage(text_words, term)).sum();
    sum / terms.len() as f64
}

fn term_coverage(text_words: &[String], term: &Term) -> f64 {
    let Some((last, head)) = term.words.split_last() else {
        return 0.0;
    };
    let mut best = 0.0_f64;
    for start in 0..text_words.len() {
        if text_words.len() - start < term.words.len() || text_words[start..start + head.len()] != *head {
            continue;
        }
        let word = &text_words[start + head.len()];
        if word == last {
            return 1.0;
        }
        if term.prefix && word.starts_with(last.as_str()) {
            best = 0.7;
        }
    }
    best
}

/// How well a title matches the query terms, 0 to 1.
///
/// A title that is exactly the words typed scores 1. A title that starts with them scores 0.9, or 0.85 when
/// the last word is only the start of a word still being typed. Any other title scores by how many of the
/// terms it holds, at most 0.75.
pub fn title_score(title: &str, terms: &[Term]) -> f64 {
    let title_words: Vec<String> = words(title).into_iter().map(|word| word.folded).collect();
    let held = 0.75 * coverage(&title_words, terms);
    let typed: Vec<&String> = terms.iter().flat_map(|term| term.words.iter()).collect();
    let Some((last, head)) = typed.split_last() else {
        return 0.0;
    };
    if title_words.len() < typed.len() || !head.iter().zip(&title_words).all(|(a, b)| *a == b) {
        return held;
    }
    let word = &title_words[head.len()];
    let last_is_prefix = terms.last().is_some_and(|term| term.prefix);
    if word == *last {
        if title_words.len() == typed.len() {
            1.0
        } else {
            0.9
        }
    } else if last_is_prefix && word.starts_with(last.as_str()) {
        0.85
    } else {
        held
    }
}

/// How well the best of several headings matches the query terms, 0 to 1.
pub fn heading_score<'a>(headings: impl IntoIterator<Item = &'a str>, terms: &[Term]) -> f64 {
    headings
        .into_iter()
        .map(|heading| {
            let heading_words: Vec<String> = words(heading).into_iter().map(|word| word.folded).collect();
            coverage(&heading_words, terms)
        })
        .fold(0.0, f64::max)
}

#[cfg(test)]
mod tests;
