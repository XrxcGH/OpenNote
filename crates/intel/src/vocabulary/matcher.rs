//! Finding mishearings in text: the list prepared for scanning, and the replacements it makes.

use std::collections::HashMap;
use std::ops::Range;

use super::{Change, Corrected, Vocabulary};
use crate::summarize::stopword_set;
use crate::text::{utf16_spans, words, Word};

/// A target spelling as words, and the term it stands for.
type Target = (Vec<String>, String);

/// The list prepared for scanning: spellings by their first word, and single-word terms by first letter.
pub(super) struct Matcher {
    by_first_word: HashMap<String, Vec<Target>>,
    singles: HashMap<char, Vec<(String, String)>>,
}

impl Matcher {
    pub(super) fn new(list: &Vocabulary) -> Matcher {
        let mut by_first_word: HashMap<String, Vec<Target>> = HashMap::new();
        let mut singles: HashMap<char, Vec<(String, String)>> = HashMap::new();
        for entry in &list.entries {
            for spelling in std::iter::once(&entry.term).chain(&entry.heard_as) {
                let target: Vec<String> = words(spelling).into_iter().map(|w| w.lower).collect();
                if let Some(first) = target.first().cloned() {
                    by_first_word
                        .entry(first)
                        .or_default()
                        .push((target, entry.term.clone()));
                }
            }
            let lower = entry.term.to_lowercase();
            if let (false, Some(first)) = (lower.contains(' '), lower.chars().next()) {
                singles.entry(first).or_default().push((lower, entry.term.clone()));
            }
        }
        Matcher { by_first_word, singles }
    }

    pub(super) fn correct(&self, text: &str) -> Corrected {
        let found = words(text);
        let mut changes: Vec<(Range<usize>, String)> = Vec::new();
        let mut i = 0;
        while i < found.len() {
            match self.match_at(text, &found, i) {
                Some((len, replacement)) => {
                    let range = found[i].range.start..found[i + len - 1].range.end;
                    let replacement = fit_case(&text[range.clone()], &replacement);
                    if text[range.clone()] != replacement {
                        changes.push((range, replacement));
                    }
                    i += len;
                }
                None => i += 1,
            }
        }
        render(text, changes)
    }

    /// The longest match that starts at word `i`: how many words it covers, and what to write instead.
    fn match_at(&self, text: &str, found: &[Word], i: usize) -> Option<(usize, String)> {
        let mut best: Option<(usize, String)> = None;
        for (target, term) in self.by_first_word.get(&found[i].lower).into_iter().flatten() {
            let end = i + target.len();
            if end > found.len() || !target.iter().zip(&found[i..end]).all(|(t, w)| *t == w.lower) {
                continue;
            }
            let joined = found[i..end].windows(2).all(|pair| {
                let between = &text[pair[0].range.end..pair[1].range.start];
                between.trim_matches(['-', ' ']).is_empty()
            });
            if joined && best.as_ref().is_none_or(|(len, _)| target.len() > *len) {
                best = Some((target.len(), term.clone()));
            }
        }
        best.or_else(|| self.near_miss(&found[i]).map(|term| (1, term)))
    }

    fn near_miss(&self, word: &Word) -> Option<String> {
        let letters = word.lower.chars().count();
        let common = stopword_set("en").is_some_and(|set| set.contains(word.lower.as_str()));
        if letters < 5 || common {
            return None;
        }
        let candidates = self.singles.get(&word.lower.chars().next()?)?;
        candidates.iter().find_map(|(lower, term)| {
            let allowed = if lower.chars().count() >= 9 { 2 } else { 1 };
            let inflected = lower.starts_with(&word.lower) || word.lower.starts_with(lower.as_str());
            (!inflected && within(lower, &word.lower, allowed)).then(|| term.clone())
        })
    }
}

/// A term written in lowercase means the word, not a particular case, so it takes the capital of the word
/// it replaces. A term with a capital letter is written as listed.
fn fit_case(original: &str, term: &str) -> String {
    let lowercase_term = term.chars().all(|c| !c.is_uppercase());
    if !lowercase_term || !original.chars().next().is_some_and(char::is_uppercase) {
        return term.to_owned();
    }
    let mut chars = term.chars();
    chars
        .next()
        .map(|c| c.to_uppercase().chain(chars).collect())
        .unwrap_or_default()
}

/// Whether the words differ by at most `limit` single-letter edits (insert, delete, or change).
pub(super) fn within(a: &str, b: &str, limit: usize) -> bool {
    let (a, b): (Vec<char>, Vec<char>) = (a.chars().collect(), b.chars().collect());
    if a.len().abs_diff(b.len()) > limit {
        return false;
    }
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut diagonal = row[0];
        row[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let above = row[j + 1];
            row[j + 1] = (diagonal + usize::from(ca != cb)).min(above + 1).min(row[j] + 1);
            diagonal = above;
        }
    }
    row[b.len()] <= limit
}

/// Applies the replacements, which are in order and do not overlap, and records their UTF-16 spans.
fn render(text: &str, changes: Vec<(Range<usize>, String)>) -> Corrected {
    let ranges: Vec<_> = changes.iter().map(|(r, _)| r.clone()).collect();
    let spans = utf16_spans(text, &ranges);
    let mut out = String::with_capacity(text.len());
    let mut at = 0;
    let mut made = Vec::new();
    for ((range, to), span) in changes.into_iter().zip(spans) {
        out.push_str(&text[at..range.start]);
        out.push_str(&to);
        made.push(Change {
            from: text[range.clone()].to_owned(),
            to,
            span,
        });
        at = range.end;
    }
    out.push_str(&text[at..]);
    Corrected {
        text: out,
        changes: made,
    }
}
