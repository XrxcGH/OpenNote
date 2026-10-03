//! Keywords from repeated terms and phrases.
//!
//! A candidate is a run of up to `max_words` words that starts and ends on a content word and does not
//! cross punctuation or a line break. Single words qualify at once. Longer phrases must appear at least
//! twice, which keeps out the accidental pairs of a sentence and keeps in the terms a writer comes back
//! to.
//!
//! A phrase scores higher for repeating and for length, and a little higher for appearing early or for
//! being a name or an acronym. A word that mostly appears inside a longer chosen phrase is dropped in
//! favor of the phrase.

use std::collections::HashMap;

use super::analysis::Analysis;
use super::{Keyword, KeywordOptions};

/// Room for the longest phrase `KeywordOptions::max_words` allows.
const MAX_GRAM: usize = 4;
/// The number that stands for no word in a padded key.
const NO_WORD: u32 = u32::MAX;
/// An acronym is at most this many letters, so an all-capitals heading does not count as one.
const MAX_ACRONYM_LETTERS: usize = 6;

type Gram = [u32; MAX_GRAM];

/// How often a candidate appears, and where it first appears.
struct Stat {
    count: usize,
    first_word: usize,
    len: usize,
}

/// What the text shows about how a term is written.
#[derive(Default)]
struct Casing {
    /// Each lowercase form seen and how often, such as "cell" and "cells" for one term.
    forms: Vec<(String, usize)>,
    lowercase_seen: bool,
    capital_in_sentence: Option<String>,
    acronym: Option<String>,
}

impl Casing {
    fn proper(&self) -> bool {
        !self.lowercase_seen && (self.capital_in_sentence.is_some() || self.acronym.is_some())
    }

    /// The best form to show: an acronym or a name as written, anything else in lowercase.
    fn display(&self) -> &str {
        match (&self.acronym, &self.capital_in_sentence) {
            (Some(acronym), _) if !self.lowercase_seen => acronym,
            (_, Some(name)) if !self.lowercase_seen => name,
            _ => self
                .forms
                .iter()
                .max_by_key(|(_, count)| *count)
                .map_or("", |(form, _)| form.as_str()),
        }
    }
}

struct Candidate {
    gram: Gram,
    len: usize,
    count: usize,
    first_word: usize,
    score: f32,
}

impl Candidate {
    fn words(&self) -> &[u32] {
        &self.gram[..self.len]
    }

    fn contains(&self, other: &Candidate) -> bool {
        self.len > other.len && self.words().windows(other.len).any(|w| w == other.words())
    }
}

pub(super) fn extract(analysis: &Analysis<'_>, options: &KeywordOptions) -> Vec<Keyword> {
    let (casing, token) = number_terms(analysis);
    let grams = count_all_grams(analysis, &token, options.max_words);
    let candidates = rank(grams, &casing, analysis.words.len());
    let chosen = choose(candidates, options.max_keywords);
    render(&chosen, &casing)
}

/// Numbers the terms of the text and records how each is written. Each word becomes a term number and a
/// flag for whether it is a content word.
fn number_terms(analysis: &Analysis<'_>) -> (Vec<Casing>, Vec<(u32, bool)>) {
    let mut ids: HashMap<&str, u32> = HashMap::new();
    let mut casing: Vec<Casing> = Vec::new();
    let mut token: Vec<(u32, bool)> = Vec::with_capacity(analysis.words.len());
    for (index, word) in analysis.words.iter().enumerate() {
        let next = ids.len() as u32;
        let id = *ids.entry(analysis.key(index)).or_insert(next);
        if id == next {
            casing.push(Casing::default());
        }
        let entry = &mut casing[id as usize];
        match entry.forms.iter_mut().find(|(form, _)| *form == word.lower) {
            Some((_, count)) => *count += 1,
            None => entry.forms.push((word.lower.clone(), 1)),
        }
        note_casing(entry, &analysis.text[word.range.clone()], word.sentence_start);
        token.push((id, analysis.is_content(word)));
    }
    (casing, token)
}

/// Counts the phrases of every stretch of words that has no break inside it.
fn count_all_grams(analysis: &Analysis<'_>, token: &[(u32, bool)], max_words: usize) -> HashMap<Gram, Stat> {
    let words = &analysis.words;
    let mut grams: HashMap<Gram, Stat> = HashMap::new();
    let mut start = 0;
    for end in 1..=words.len() {
        if end == words.len() || words[end].breaks_before {
            count_grams(token, start..end, max_words, &mut grams);
            start = end;
        }
    }
    grams
}

/// Scores the candidates and sorts them best first.
fn rank(grams: HashMap<Gram, Stat>, casing: &[Casing], total_words: usize) -> Vec<Candidate> {
    let total = total_words as f32;
    let mut candidates: Vec<Candidate> = grams
        .into_iter()
        .filter(|(_, stat)| stat.len == 1 || stat.count >= 2)
        .map(|(gram, stat)| {
            let proper = gram[..stat.len].iter().any(|&id| casing[id as usize].proper());
            let repeats = 1.0 + (stat.count as f32).ln();
            let length = 1.0 + 0.45 * (stat.len - 1) as f32;
            let early = 1.0 + 0.2 * (1.0 - stat.first_word as f32 / total);
            let name = if proper { 1.15 } else { 1.0 };
            Candidate {
                gram,
                len: stat.len,
                count: stat.count,
                first_word: stat.first_word,
                score: repeats * length * early * name,
            }
        })
        .collect();
    candidates.sort_by(|a, b| {
        b.score
            .total_cmp(&a.score)
            .then(a.first_word.cmp(&b.first_word))
            .then(a.gram.cmp(&b.gram))
    });
    candidates
}

/// Takes the best candidates, letting a longer phrase stand in for a shorter one it mostly explains.
fn choose(candidates: Vec<Candidate>, max_keywords: usize) -> Vec<Candidate> {
    let mut chosen: Vec<Candidate> = Vec::new();
    for candidate in candidates {
        if chosen.len() >= max_keywords {
            break;
        }
        // A longer phrase that holds this one most of the times it appears already stands for it.
        let explained = chosen
            .iter()
            .any(|p| p.contains(&candidate) && p.count * 10 >= candidate.count * 7);
        if explained {
            continue;
        }
        // And a longer phrase replaces a shorter one it holds, when it explains most of its uses.
        chosen.retain(|s| !(candidate.contains(s) && candidate.count * 10 >= s.count * 7));
        chosen.push(candidate);
    }
    chosen
}

/// Writes each keyword in its best form, with scores scaled so the best is 1.
fn render(chosen: &[Candidate], casing: &[Casing]) -> Vec<Keyword> {
    let best = chosen
        .iter()
        .map(|c| c.score)
        .fold(0.0_f32, f32::max)
        .max(f32::MIN_POSITIVE);
    chosen
        .iter()
        .map(|c| Keyword {
            text: c
                .words()
                .iter()
                .map(|&id| casing[id as usize].display())
                .collect::<Vec<_>>()
                .join(" "),
            score: c.score / best,
            count: c.count,
        })
        .collect()
}

fn note_casing(casing: &mut Casing, original: &str, sentence_start: bool) {
    let letters = original.chars().filter(|c| c.is_alphabetic()).count();
    let starts_upper = original.chars().next().is_some_and(char::is_uppercase);
    if (2..=MAX_ACRONYM_LETTERS).contains(&letters) && original.chars().all(|c| !c.is_lowercase()) {
        casing.acronym.get_or_insert_with(|| original.to_owned());
    } else if starts_upper {
        if !sentence_start {
            casing.capital_in_sentence.get_or_insert_with(|| original.to_owned());
        }
    } else {
        casing.lowercase_seen = true;
    }
}

/// Counts every phrase of one stretch of words that has no break inside it.
fn count_grams(
    token: &[(u32, bool)],
    segment: std::ops::Range<usize>,
    max_words: usize,
    grams: &mut HashMap<Gram, Stat>,
) {
    for first in segment.clone() {
        if !token[first].1 {
            continue;
        }
        for len in 1..=max_words.min(MAX_GRAM) {
            let end = first + len;
            if end > segment.end {
                break;
            }
            if !token[end - 1].1 {
                continue;
            }
            let mut gram = [NO_WORD; MAX_GRAM];
            for (slot, t) in gram.iter_mut().zip(&token[first..end]) {
                *slot = t.0;
            }
            grams.entry(gram).and_modify(|stat| stat.count += 1).or_insert(Stat {
                count: 1,
                first_word: first,
                len,
            });
        }
    }
}
