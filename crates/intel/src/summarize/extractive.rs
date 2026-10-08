//! The extractive summarizer: chooses whole sentences, never writes new ones.
//!
//! A sentence scores higher when it holds terms the text repeats, with a small bonus for opening the
//! text, where a writer states the topic. The sentences are then chosen one at a time. Each trades its
//! own score against how much it repeats a sentence already chosen (maximal marginal relevance), so
//! the summary does not say one thing three times.

use std::collections::HashMap;
use std::ops::Range;

use super::analysis::Analysis;
use super::keywords;
use super::{check_size, Keyword, KeywordOptions, Summarizer, Summary, SummaryOptions, SummarySentence};
use crate::error::IntelError;
use crate::text::{split_sentences, utf16_spans};

/// How much a sentence's own score counts against its overlap with the sentences already chosen.
const RELEVANCE_WEIGHT: f32 = 0.7;
/// Sentences with fewer content words than this are probably headings or fragments.
const MIN_CONTENT_WORDS: usize = 2;
/// Sentences with more words than this are probably run-ons.
const LONG_SENTENCE_WORDS: usize = 60;
/// Sentences shorter than this lose score in proportion, because they are mostly headings and lists of names.
const FULL_CREDIT_WORDS: usize = 8;
/// Sentences with at least this many words count as prose when finding the opening of the text.
const PROSE_WORDS: usize = 5;

/// The summarizer that ships with OpenNote. It needs no model, so it is always available, and it runs on
/// every platform.
#[derive(Clone, Copy, Debug, Default)]
pub struct ExtractiveSummarizer;

impl ExtractiveSummarizer {
    /// Creates the summarizer.
    pub fn new() -> ExtractiveSummarizer {
        ExtractiveSummarizer
    }
}

/// What the scoring needs to know about one sentence.
struct Scored {
    word_count: usize,
    /// The distinct content terms, sorted.
    terms: Vec<u32>,
}

impl Summarizer for ExtractiveSummarizer {
    fn summarize(&self, text: &str, options: &SummaryOptions) -> Result<Summary, IntelError> {
        check_size(text)?;
        let analysis = Analysis::new(text, options.language.as_ref());
        let sentences = split_sentences(text);
        let language = analysis.language.clone();
        let empty = |input_sentences| Summary {
            language: language.clone(),
            sentences: Vec::new(),
            input_sentences,
        };
        if sentences.is_empty() || options.max_sentences == 0 {
            return Ok(empty(sentences.len()));
        }

        let (scored, frequency) = count_terms(&analysis, &sentences);
        let scores = sentence_scores(&scored, &frequency);
        let chosen = choose(text, &sentences, &scored, &scores, options);

        let ranges: Vec<Range<usize>> = chosen.iter().map(|&i| sentences[i].clone()).collect();
        let spans = utf16_spans(text, &ranges);
        let picked = chosen
            .iter()
            .zip(spans)
            .map(|(&i, span)| SummarySentence {
                text: text[sentences[i].clone()].replace(['\n', '\r'], " "),
                span,
                score: scores[i],
            })
            .collect();
        Ok(Summary {
            language,
            sentences: picked,
            input_sentences: sentences.len(),
        })
    }

    fn keywords(&self, text: &str, options: &KeywordOptions) -> Result<Vec<Keyword>, IntelError> {
        check_size(text)?;
        if options.max_keywords == 0 || !(1..=4).contains(&options.max_words) {
            return Err(IntelError::InvalidInput(
                "keywords need a count above zero and 1 to 4 words each".to_owned(),
            ));
        }
        let analysis = Analysis::new(text, options.language.as_ref());
        Ok(keywords::extract(&analysis, options))
    }
}

/// Counts each sentence's words and its distinct content terms, with terms numbered across the text, and
/// returns how often each term occurs in the whole text.
fn count_terms(analysis: &Analysis<'_>, sentences: &[Range<usize>]) -> (Vec<Scored>, Vec<u32>) {
    let mut ids: HashMap<&str, u32> = HashMap::new();
    let mut scored: Vec<Scored> = sentences
        .iter()
        .map(|_| Scored {
            word_count: 0,
            terms: Vec::new(),
        })
        .collect();
    let mut sentence = 0;
    for (index, word) in analysis.words.iter().enumerate() {
        while sentence < sentences.len() && sentences[sentence].end <= word.range.start {
            sentence += 1;
        }
        let Some(range) = sentences.get(sentence) else { break };
        if word.range.start < range.start {
            continue;
        }
        scored[sentence].word_count += 1;
        if analysis.is_content(word) {
            let next = ids.len() as u32;
            let id = *ids.entry(analysis.key(index)).or_insert(next);
            scored[sentence].terms.push(id);
        }
    }
    // Count every occurrence before keeping only the distinct terms of each sentence.
    let mut frequency = vec![0_u32; ids.len()];
    for s in &scored {
        for &t in &s.terms {
            frequency[t as usize] += 1;
        }
    }
    for s in &mut scored {
        s.terms.sort_unstable();
        s.terms.dedup();
    }
    (scored, frequency)
}

/// Scores every sentence from 0 to 1.
fn sentence_scores(scored: &[Scored], frequency: &[u32]) -> Vec<f32> {
    let max = frequency.iter().copied().max().unwrap_or(0);
    let weight = |term: u32| -> f32 {
        if max == 0 {
            0.0
        } else {
            (1.0 + frequency[term as usize] as f32).ln() / (1.0 + max as f32).ln()
        }
    };
    // The opening matters, but a title or a line of names is not an opening, so only sentences long enough
    // to be prose count toward it.
    let mut prose_seen = 0;
    let mut scores: Vec<f32> = scored
        .iter()
        .map(|s| {
            let total: f32 = s.terms.iter().map(|&t| weight(t)).sum();
            let mut score = total / (s.word_count.max(1) as f32).sqrt();
            if s.terms.len() < MIN_CONTENT_WORDS {
                score *= 0.4;
            }
            if s.word_count > LONG_SENTENCE_WORDS {
                score *= 0.7;
            }
            score *= (s.word_count as f32 / FULL_CREDIT_WORDS as f32).min(1.0).powf(1.5);
            if s.word_count >= PROSE_WORDS {
                score *= 1.0 + 0.25 / (1.0 + prose_seen as f32);
                prose_seen += 1;
            }
            score
        })
        .collect();
    let best = scores.iter().copied().fold(0.0_f32, f32::max);
    if best <= 0.0 {
        // Nothing to count, as with East Asian text: the opening matters most.
        scores = (0..scored.len()).map(|i| 1.0 / (1.0 + i as f32)).collect();
        return scores;
    }
    scores.iter_mut().for_each(|s| *s /= best);
    scores
}

/// How alike two sentences are, from 0 to 1: shared terms over all terms.
fn similarity(a: &[u32], b: &[u32]) -> f32 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let (mut i, mut j, mut shared) = (0, 0, 0);
    while i < a.len() && j < b.len() {
        match a[i].cmp(&b[j]) {
            std::cmp::Ordering::Less => i += 1,
            std::cmp::Ordering::Greater => j += 1,
            std::cmp::Ordering::Equal => {
                shared += 1;
                i += 1;
                j += 1;
            }
        }
    }
    shared as f32 / (a.len() + b.len() - shared) as f32
}

/// Picks up to `max_sentences` sentence numbers within the character budget, returned in text order.
fn choose(
    text: &str,
    sentences: &[Range<usize>],
    scored: &[Scored],
    scores: &[f32],
    options: &SummaryOptions,
) -> Vec<usize> {
    let wanted = options.max_sentences.min(sentences.len());
    // Only the best-scoring sentences compete, which keeps a long text fast.
    let pool_size = (wanted * 20).max(64);
    let mut pool: Vec<usize> = (0..sentences.len()).collect();
    pool.sort_by(|&a, &b| scores[b].total_cmp(&scores[a]).then(a.cmp(&b)));
    pool.truncate(pool_size);

    let mut chosen: Vec<usize> = Vec::new();
    let mut used_chars = 0;
    let fits = |chars: usize, used: usize| options.max_chars.is_none_or(|limit| used + chars <= limit);
    while chosen.len() < wanted {
        let mut best: Option<(usize, f32, usize)> = None;
        for &i in &pool {
            if chosen.contains(&i) {
                continue;
            }
            let chars = text[sentences[i].clone()].chars().count();
            if !fits(chars, used_chars) {
                continue;
            }
            let overlap = chosen
                .iter()
                .map(|&j| similarity(&scored[i].terms, &scored[j].terms))
                .fold(0.0_f32, f32::max);
            let value = RELEVANCE_WEIGHT * scores[i] - (1.0 - RELEVANCE_WEIGHT) * overlap;
            if best.is_none_or(|(_, v, _)| value > v) {
                best = Some((i, value, chars));
            }
        }
        let Some((i, _, chars)) = best else { break };
        chosen.push(i);
        used_chars += chars;
    }
    chosen.sort_unstable();
    chosen
}
