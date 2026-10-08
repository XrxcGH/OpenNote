//! Summaries and keywords from plain text, computed on the device with no model and no network.
//!
//! [`Summarizer`] is the interface. [`ExtractiveSummarizer`] is the implementation that ships. It picks
//! the sentences that carry a text's main terms and returns them untouched, with their positions in
//! the text. The interface can link each one back to where it came from. It never writes new
//! sentences, so a summary cannot say something the notes do not. A model-backed summarizer can sit
//! behind the same trait later.
//!
//! The extractive summarizer reads English, Spanish, French, and German stop words and falls back to
//! English rules for other scripts that put spaces between words. Chinese, Japanese, and Korean text
//! gets a summary by position, because those scripts need a word splitter this crate does not have.

use serde::{Deserialize, Serialize};

use crate::error::IntelError;
use crate::geometry::Language;
use crate::text::Span;

mod actions;
mod analysis;
mod chapters;
mod extractive;
mod keywords;
mod stopwords;

pub use self::actions::{ActionItem, ActionKind};
pub use self::chapters::{Chapter, ChapterOptions};
// Reached from outside through `Engines`, unless the crate's own tests turn on `unstable-engines`.
pub(crate) use self::stopwords::for_language as stopword_set;
#[cfg(feature = "unstable-engines")]
pub use self::{actions::find_action_items, chapters::make_chapters, extractive::ExtractiveSummarizer};
#[cfg(not(feature = "unstable-engines"))]
pub(crate) use self::{actions::find_action_items, chapters::make_chapters, extractive::ExtractiveSummarizer};

/// The most text one call accepts, in bytes. A thick textbook chapter is well under it.
pub const MAX_TEXT_BYTES: usize = 4 * 1024 * 1024;

/// How long a summary may be.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SummaryOptions {
    /// The most sentences to return.
    pub max_sentences: usize,
    /// The most characters in all the sentences together. A sentence that would pass it is skipped, and
    /// a text with no sentence short enough gets an empty summary.
    pub max_chars: Option<usize>,
    /// The language of the text, or `None` to detect it.
    pub language: Option<Language>,
}

impl Default for SummaryOptions {
    fn default() -> Self {
        SummaryOptions {
            max_sentences: 3,
            max_chars: None,
            language: None,
        }
    }
}

/// A sentence of the summary.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummarySentence {
    /// The sentence as written, with any list marker removed.
    pub text: String,
    /// Where it sits in the text that was given, in UTF-16 units.
    pub span: Span,
    /// How central it is to the text, from 0 to 1, where 1 is the most central sentence of all.
    pub score: f32,
}

/// The sentences chosen from a text, in the order they appear there.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    /// The language the text was read as.
    pub language: Language,
    /// The chosen sentences.
    pub sentences: Vec<SummarySentence>,
    /// How many sentences the text had.
    pub input_sentences: usize,
}

impl Summary {
    /// The chosen sentences joined with spaces.
    pub fn text(&self) -> String {
        let texts: Vec<&str> = self.sentences.iter().map(|s| s.text.as_str()).collect();
        texts.join(" ")
    }
}

/// How many keywords to find, and how long each may be.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct KeywordOptions {
    /// The most keywords to return.
    pub max_keywords: usize,
    /// The most words in one keyword phrase, from 1 to 4.
    pub max_words: usize,
    /// The language of the text, or `None` to detect it.
    pub language: Option<Language>,
}

impl Default for KeywordOptions {
    fn default() -> Self {
        KeywordOptions {
            max_keywords: 8,
            max_words: 3,
            language: None,
        }
    }
}

/// A word or phrase that stands for the text.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Keyword {
    /// The keyword in the form it is best shown: lowercase, unless the text always capitalizes it.
    pub text: String,
    /// How well it stands for the text, from 0 to 1, where 1 is the best keyword.
    pub score: f32,
    /// How many times it appears.
    pub count: usize,
}

/// A summarizer. Every call runs on the device and makes no network request.
///
/// A page takes a few milliseconds, and a million characters take about a quarter of a second. A caller that
/// summarizes a whole notebook should still run them on a worker thread.
pub trait Summarizer: Send + Sync {
    /// Chooses the sentences that best stand for `text`.
    fn summarize(&self, text: &str, options: &SummaryOptions) -> Result<Summary, IntelError>;

    /// Finds the words and phrases that best stand for `text`, best first.
    fn keywords(&self, text: &str, options: &KeywordOptions) -> Result<Vec<Keyword>, IntelError>;
}

engine_api! {
    /// The summarizer for this build. The extractive one works on every platform.
    fn default_summarizer() -> Box<dyn Summarizer> {
        Box::new(ExtractiveSummarizer::new())
    }
}

pub(crate) fn check_size(text: &str) -> Result<(), IntelError> {
    if text.len() > MAX_TEXT_BYTES {
        return Err(IntelError::InvalidInput(format!(
            "{} bytes of text is more than the limit of {MAX_TEXT_BYTES}",
            text.len()
        )));
    }
    Ok(())
}
