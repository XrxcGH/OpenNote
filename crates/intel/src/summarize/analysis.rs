//! The words of a text and which of them matter, shared by summaries and keywords.

use std::collections::HashSet;

use super::stopwords;
use crate::geometry::Language;
use crate::text::{is_cjk, words, Word};

/// A text split into words, with the language rules chosen for it.
pub(super) struct Analysis<'a> {
    pub text: &'a str,
    pub words: Vec<Word>,
    /// The language to report.
    pub language: Language,
    stop: Option<&'static HashSet<&'static str>>,
    /// The stem of each word that has one different from its lowercase form.
    stems: Vec<Option<String>>,
}

impl<'a> Analysis<'a> {
    /// Splits the text and picks the stop word list: the requested language's when it has one, and the
    /// best match among the lists otherwise.
    pub fn new(text: &'a str, requested: Option<&Language>) -> Analysis<'a> {
        let words = words(text);
        let requested_tag = requested.map(Language::primary);
        let rules = match requested_tag.as_deref() {
            Some(tag) if stopwords::for_language(tag).is_some() => tag.to_owned(),
            _ => stopwords::detect(&words).to_owned(),
        };
        let language = requested
            .cloned()
            .unwrap_or_else(|| Language::new(&rules).expect("a list name is a language tag"));
        let stems = words.iter().map(|w| stem(&rules, &w.lower)).collect();
        Analysis {
            text,
            words,
            language,
            stop: stopwords::for_language(&rules),
            stems,
        }
    }

    /// What identifies the term the `index`th word belongs to: its stem, so that "cell" and "cells" count
    /// as one term.
    pub fn key(&self, index: usize) -> &str {
        self.stems[index].as_deref().unwrap_or(&self.words[index].lower)
    }

    /// Whether the word is a stop word.
    pub fn is_stop(&self, word: &Word) -> bool {
        self.stop.is_some_and(|set| set.contains(word.lower.as_str()))
    }

    /// Whether the word says something about the text: not a stop word, not a bare number, not a single
    /// letter, and not one character of an East Asian script.
    pub fn is_content(&self, word: &Word) -> bool {
        let mut chars = word.lower.chars();
        let first = chars.next();
        let long_enough = chars.next().is_some();
        long_enough
            && first.is_some_and(|c| !is_cjk(c))
            && !word.lower.chars().all(|c| c.is_ascii_digit())
            && !self.is_stop(word)
    }
}

/// Strips a plural ending from words of the languages that form plurals with "s". It does not need to
/// give real words, only the same text for the forms of one word.
fn stem(rules: &str, lower: &str) -> Option<String> {
    if !matches!(rules, "en" | "es" | "fr") || lower.chars().count() <= 3 || !lower.is_ascii() && rules == "en" {
        return None;
    }
    if rules == "en" {
        if let Some(base) = lower.strip_suffix("ies").filter(|b| b.len() >= 2) {
            return Some(format!("{base}y"));
        }
        if let Some(base) = lower.strip_suffix("sses") {
            return Some(format!("{base}ss"));
        }
    }
    let base = lower.strip_suffix('s')?;
    let protected = base.ends_with(['s', 'u', 'i']) || base.ends_with("ou");
    (!protected).then(|| base.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plurals_share_a_stem_and_other_words_are_left_alone() {
        assert_eq!(stem("en", "cells").as_deref(), Some("cell"));
        assert_eq!(stem("en", "stories").as_deref(), Some("story"));
        assert_eq!(stem("en", "classes").as_deref(), Some("class"));
        assert_eq!(stem("en", "analysis"), None);
        assert_eq!(stem("en", "class"), None);
        assert_eq!(stem("en", "virus"), None);
        assert_eq!(stem("en", "its"), None);
        assert_eq!(stem("es", "plantas").as_deref(), Some("planta"));
        assert_eq!(stem("de", "katzen"), None);
    }
}
