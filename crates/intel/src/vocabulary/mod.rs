//! A custom vocabulary for transcripts: names, course terms, acronyms, and spellings the transcriber
//! should prefer.
//!
//! The list is plain text, one term to a line, so people can edit it, keep one for each notebook, and
//! share it. A line may say how the transcriber tends to mishear the term:
//!
//! ```text
//! # Biology 101
//! ATP
//! Calvin cycle | calvin psyche, kelvin cycle
//! Priya Raghunathan
//! ```
//!
//! Two things use the list, and both stay on the device.
//!
//! - [`Vocabulary::prompt`] is the hint given to the speech engine before it starts.
//! - [`Vocabulary::correct`] fixes what the engine still gets wrong.
//!
//! The correction replaces the listed mishearings and near misses of single-word terms. Each replacement
//! is reported, so the interface can show it and let the person undo it.

use serde::{Deserialize, Serialize};

use crate::summarize::stopword_set;
use crate::text::Span;
use crate::transcribe::{Segment, Transcript};

mod matcher;
#[cfg(test)]
mod tests;

use self::matcher::Matcher;

/// The most terms a list holds.
pub const MAX_TERMS: usize = 5000;
/// The most characters in a term or in a mishearing.
pub const MAX_TERM_CHARS: usize = 80;

/// One term, and the ways the transcriber is known to mishear it.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    /// The term as it should be written.
    pub term: String,
    /// Spellings to replace with the term, such as "calvin psyche".
    pub heard_as: Vec<String>,
}

/// A change [`Vocabulary::correct`] made.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    /// What the transcript said.
    pub from: String,
    /// What it says now.
    pub to: String,
    /// Where `from` sat in the text that was given, in UTF-16 units.
    pub span: Span,
}

/// Text after correction, and the changes made.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Corrected {
    /// The corrected text.
    pub text: String,
    /// The changes, in order.
    pub changes: Vec<Change>,
}

/// A term to offer adding after the person fixes a word.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Offer {
    /// The term to add.
    pub term: String,
    /// The mishearing to record with it.
    pub heard_as: String,
}

/// A list of terms.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Vocabulary {
    entries: Vec<Entry>,
}

impl Vocabulary {
    /// Reads the plain-text form. A line that is empty or starts with `#` is skipped, and so is anything
    /// past the limits. A repeated term adds its mishearings to the first.
    pub fn parse(text: &str) -> Vocabulary {
        let mut list = Vocabulary::default();
        for line in text.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let (term, heard) = line.split_once('|').unwrap_or((line, ""));
            list.add(term, None);
            for alias in heard.split(',') {
                list.add(term, Some(alias));
            }
        }
        list
    }

    /// The plain-text form, which [`Vocabulary::parse`] reads back.
    pub fn to_text(&self) -> String {
        let mut out = String::new();
        for entry in &self.entries {
            out.push_str(&entry.term);
            if !entry.heard_as.is_empty() {
                out.push_str(" | ");
                out.push_str(&entry.heard_as.join(", "));
            }
            out.push('\n');
        }
        out
    }

    /// The entries in order.
    pub fn entries(&self) -> &[Entry] {
        &self.entries
    }

    /// Whether the list has the term, ignoring case.
    pub fn contains(&self, term: &str) -> bool {
        let wanted = term.trim().to_lowercase();
        self.entries.iter().any(|e| e.term.to_lowercase() == wanted)
    }

    /// Adds a term, and a mishearing of it if given. Returns whether anything changed. A term that is
    /// already listed only gains the mishearing.
    pub fn add(&mut self, term: &str, heard_as: Option<&str>) -> bool {
        let term = collapse(term);
        let heard = heard_as
            .map(collapse)
            .filter(|h| !h.is_empty() && h.to_lowercase() != term.to_lowercase());
        let valid =
            |s: &str| !s.is_empty() && s.chars().count() <= MAX_TERM_CHARS && s.chars().any(char::is_alphanumeric);
        if !valid(&term) || heard.as_deref().is_some_and(|h| !valid(h)) {
            return false;
        }
        let at = self
            .entries
            .iter()
            .position(|e| e.term.to_lowercase() == term.to_lowercase());
        if at.is_none() && self.entries.len() >= MAX_TERMS {
            return false;
        }
        let index = at.unwrap_or_else(|| {
            self.entries.push(Entry {
                term,
                heard_as: Vec::new(),
            });
            self.entries.len() - 1
        });
        let entry = &mut self.entries[index];
        match heard {
            Some(h) if !entry.heard_as.iter().any(|x| x.to_lowercase() == h.to_lowercase()) => {
                entry.heard_as.push(h);
                true
            }
            _ => at.is_none(),
        }
    }

    /// Removes a term, ignoring case. Returns whether it was there.
    pub fn remove(&mut self, term: &str) -> bool {
        let before = self.entries.len();
        let wanted = term.trim().to_lowercase();
        self.entries.retain(|e| e.term.to_lowercase() != wanted);
        self.entries.len() != before
    }

    /// The terms joined with commas, up to `max_chars`, as the hint for a speech engine. Whisper-style
    /// engines accept such a hint before the audio and then favor those spellings.
    pub fn prompt(&self, max_chars: usize) -> String {
        let mut out = String::new();
        for entry in &self.entries {
            let extra = entry.term.chars().count() + if out.is_empty() { 0 } else { 2 };
            if out.chars().count() + extra > max_chars {
                break;
            }
            if !out.is_empty() {
                out.push_str(", ");
            }
            out.push_str(&entry.term);
        }
        out
    }

    /// Replaces the listed mishearings, the wrong case, and near misses of single-word terms.
    ///
    /// A near miss is a word of five letters or more that starts like a term and differs by one letter.
    /// The limit is two letters for a term of nine letters or more. A word that is a term with letters
    /// added or removed at an end, such as a plural, is left alone, and so are common words.
    pub fn correct(&self, text: &str) -> Corrected {
        Matcher::new(self).correct(text)
    }

    /// Corrects every segment of a transcript.
    pub fn correct_transcript(&self, transcript: &Transcript) -> Transcript {
        let matcher = Matcher::new(self);
        let segments = transcript
            .segments
            .iter()
            .map(|s| Segment {
                text: matcher.correct(&s.text).text,
                ..s.clone()
            })
            .collect();
        Transcript {
            segments,
            ..transcript.clone()
        }
    }

    /// The term to offer adding after the person changed `original` to `fixed` in a transcript, or `None`
    /// when it is not worth offering. That is when the list has it, it is a common word, or only the
    /// case of a short ordinary word changed.
    pub fn offer(&self, original: &str, fixed: &str) -> Option<Offer> {
        let (original, fixed) = (collapse(original), collapse(fixed));
        let letters = fixed.chars().filter(|c| c.is_alphanumeric()).count();
        let case_only = original.to_lowercase() == fixed.to_lowercase();
        let distinctive = fixed.chars().skip(1).any(char::is_uppercase) || letters >= 7;
        let common = stopword_set("en").is_some_and(|set| set.contains(fixed.to_lowercase().as_str()));
        if letters < 2 || self.contains(&fixed) || common || (case_only && !distinctive) {
            return None;
        }
        Some(Offer {
            term: fixed,
            heard_as: original,
        })
    }
}

/// Trims and collapses runs of whitespace.
fn collapse(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}
