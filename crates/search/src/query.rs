//! Query objects: the words to find and the filters to apply. A query serializes to JSON, so a saved search is
//! a query with a name.

use opennote_core::{NotebookId, SectionId, Timestamp};
use serde::{Deserialize, Serialize};

use crate::doc::BlockKind;
use crate::rank::SearchScope;
use crate::text::words;

/// The most characters of query text that are read. The rest of a longer text is left out, so pasted text cannot
/// make a query that costs more than a typed one.
pub const MAX_QUERY_CHARS: usize = 1000;
/// The most words and phrases one query looks for. Later ones are left out.
pub const MAX_QUERY_TERMS: usize = 64;

/// The part of a query text that is read: at most [`MAX_QUERY_CHARS`] characters.
pub(crate) fn clamp_text(text: &str) -> &str {
    match text.char_indices().nth(MAX_QUERY_CHARS) {
        Some((at, _)) => &text[..at],
        None => text,
    }
}

/// Which date a range applies to.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DateField {
    /// When the page was last changed.
    #[default]
    Modified,
    /// When the page was made.
    Created,
}

/// A range of dates. `from` is included and `to` is not, so a day runs from one midnight to the next.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DateRange {
    /// The date the range applies to.
    pub field: DateField,
    /// The earliest time, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from: Option<Timestamp>,
    /// The first time after the range, if any.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub to: Option<Timestamp>,
}

/// How the query text is read.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TextMode {
    /// Every word is required, and `"quoted words"` match as a phrase. Punctuation and operators are words.
    #[default]
    Simple,
    /// Also reads `OR`, `AND`, `NOT`, a minus sign, parentheses, and `title:`. See [`crate::boolean`].
    Boolean,
    /// The whole text is one regular expression. See [`crate::pattern`].
    Regex,
}

/// A search: words and filters. Every filter narrows the result, and an empty list means no filter.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Query {
    /// What the person typed. Words are all required, `"quoted words"` match as a phrase, and the last word
    /// matches as a prefix, so results appear while the person is still typing. Empty text lists pages by date.
    /// `mode` says whether operators and regular expressions are read too.
    pub text: String,
    /// How `text` is read.
    pub mode: TextMode,
    /// Only match in page titles. Block types then have no effect.
    pub title_only: bool,
    /// Only pages of these notebooks.
    pub notebooks: Vec<NotebookId>,
    /// Only pages of these sections.
    pub sections: Vec<SectionId>,
    /// Only pages with every one of these tags. A tag also matches the tags nested in it.
    pub tags: Vec<String>,
    /// Only matches in blocks of these types. The title and tags are searched only when this is empty.
    pub block_types: Vec<BlockKind>,
    /// Only pages whose date falls in this range.
    pub date: Option<DateRange>,
    /// Where the person is searching from. Pages of this notebook and section rank higher, and no page is
    /// left out for being elsewhere.
    pub scope: Option<SearchScope>,
    /// The most results to return.
    pub limit: usize,
    /// How many results to skip, to fetch the next page of results.
    pub offset: usize,
}

impl Default for Query {
    fn default() -> Query {
        Query {
            text: String::new(),
            mode: TextMode::Simple,
            title_only: false,
            notebooks: Vec::new(),
            sections: Vec::new(),
            tags: Vec::new(),
            block_types: Vec::new(),
            date: None,
            scope: None,
            limit: 20,
            offset: 0,
        }
    }
}

impl Query {
    /// A query for some text, with no filters.
    pub fn text(text: impl Into<String>) -> Query {
        Query {
            text: text.into(),
            ..Query::default()
        }
    }

    /// A query whose text is read with `OR`, `NOT`, minus signs, parentheses, and `title:`.
    pub fn boolean(text: impl Into<String>) -> Query {
        Query {
            mode: TextMode::Boolean,
            ..Query::text(text)
        }
    }

    /// A query whose text is a regular expression.
    pub fn regex(pattern: impl Into<String>) -> Query {
        Query {
            mode: TextMode::Regex,
            ..Query::text(pattern)
        }
    }

    /// The full-text columns the words may match in, or none for every column.
    pub(crate) fn columns(&self) -> Vec<&'static str> {
        if self.title_only {
            vec!["title"]
        } else {
            self.block_types.iter().map(|kind| kind.as_str()).collect()
        }
    }
}

/// One word or phrase of the query text. A word of a script written without spaces, such as Japanese, is a
/// phrase of its letters (see [`crate::text::words`]).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Term {
    /// The folded words. A phrase has several.
    pub words: Vec<String>,
    /// The last word matches any word that starts with it.
    pub prefix: bool,
}

/// The query text, ready for the full-text table and for highlighting.
pub struct ParsedText {
    /// An FTS5 `MATCH` expression. It holds only quoted words, so no input can break its syntax. It is empty
    /// when the text only leaves words out.
    pub expression: String,
    /// Pages that match this expression are left out. It is `Some` only when the text has no words to find, as
    /// in `-draft`, because otherwise the exclusion is part of `expression`.
    pub exclude: Option<String>,
    /// The words and phrases to find, for snippets. Words the text leaves out are not here.
    pub terms: Vec<Term>,
}

/// Reads the text of a query the way its mode says. Returns `None` when there is nothing to match in the
/// full-text table, which is also the case for a regular expression.
pub(crate) fn parse_query(query: &Query) -> Option<ParsedText> {
    let columns = query.columns();
    match query.mode {
        TextMode::Simple => parse_simple(&query.text, &columns),
        TextMode::Boolean => crate::boolean::parse(&query.text, &columns),
        TextMode::Regex => None,
    }
}

/// Limits an expression to some columns.
pub(crate) fn in_columns(expression: String, columns: &[&str]) -> String {
    if columns.is_empty() || expression.is_empty() {
        expression
    } else {
        format!("{{{}}} : ({expression})", columns.join(" "))
    }
}

/// Splits the text into words and quoted phrases, and builds the `MATCH` expression.
///
/// Returns `None` when the text holds no words. With `columns`, the expression only matches in those columns.
pub(crate) fn parse_simple(text: &str, columns: &[&str]) -> Option<ParsedText> {
    let text = clamp_text(text);
    let mut terms = chunks(text);
    if terms.is_empty() {
        return None;
    }
    let typing = !text.ends_with(char::is_whitespace);
    if let Some(last) = terms.last_mut() {
        last.0.prefix = typing && !last.1;
    }
    let terms: Vec<Term> = terms.into_iter().map(|(term, _)| term).collect();
    let parts: Vec<String> = terms.iter().map(phrase).collect();
    let expression = in_columns(parts.join(" AND "), columns);
    Some(ParsedText {
        expression,
        exclude: None,
        terms,
    })
}

pub(crate) fn phrase(term: &Term) -> String {
    format!("\"{}\"{}", term.words.join(" "), if term.prefix { " *" } else { "" })
}

/// The chunks of the text: quoted phrases, and runs between white space. The flag says the chunk is a phrase
/// whose closing quote is typed. A phrase still open may be a prefix, like any word still being typed.
fn chunks(text: &str) -> Vec<(Term, bool)> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find(|c: char| !c.is_whitespace()) {
        if out.len() == MAX_QUERY_TERMS {
            break;
        }
        rest = &rest[start..];
        let (chunk, quoted, after) = match rest.strip_prefix('"') {
            Some(inner) => match inner.find('"') {
                Some(end) => (&inner[..end], true, &inner[end + 1..]),
                None => (inner, false, ""),
            },
            None => {
                let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
                (&rest[..end], false, &rest[end..])
            }
        };
        let found: Vec<String> = words(chunk).into_iter().map(|w| w.folded).collect();
        if !found.is_empty() {
            out.push((
                Term {
                    words: found,
                    prefix: false,
                },
                quoted,
            ));
        }
        rest = after;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn expression(text: &str) -> Option<String> {
        parse_simple(text, &[]).map(|parsed| parsed.expression)
    }

    #[test]
    fn the_last_word_is_a_prefix_while_typing() {
        assert_eq!(expression("phys lab").as_deref(), Some("\"phys\" AND \"lab\" *"));
        assert_eq!(expression("phys lab ").as_deref(), Some("\"phys\" AND \"lab\""));
    }

    #[test]
    fn a_closed_phrase_is_never_a_prefix_but_an_open_one_is() {
        assert_eq!(
            expression("\"light reactions\"").as_deref(),
            Some("\"light reactions\"")
        );
        assert_eq!(
            expression("x \"light react\"").as_deref(),
            Some("\"x\" AND \"light react\"")
        );
        assert_eq!(
            expression("x \"light react").as_deref(),
            Some("\"x\" AND \"light react\" *")
        );
    }

    #[test]
    fn syntax_characters_are_harmless() {
        assert_eq!(
            expression("a OR (b) NEAR c*").as_deref(),
            Some("\"a\" AND \"or\" AND \"b\" AND \"near\" AND \"c\" *")
        );
        assert_eq!(expression("\" - * ( \""), None);
        assert_eq!(expression("   "), None);
        assert_eq!(expression("Caf\u{e9}'s").as_deref(), Some("\"cafe s\" *"));
    }

    #[test]
    fn a_block_type_limits_the_columns() {
        let parsed = parse_simple("x", &["text", "tables"]).unwrap();
        assert_eq!(parsed.expression, "{text tables} : (\"x\" *)");
    }

    #[test]
    fn a_query_round_trips_through_json_and_accepts_old_files() {
        let query = Query {
            tags: vec!["exam/unit-3".into()],
            block_types: vec![BlockKind::Table],
            date: Some(DateRange {
                field: DateField::Created,
                from: Some(Timestamp::from_unix_ms(0)),
                to: None,
            }),
            ..Query::text("mitosis")
        };
        let json = serde_json::to_string(&query).unwrap();
        assert_eq!(serde_json::from_str::<Query>(&json).unwrap(), query);
        assert_eq!(
            serde_json::from_str::<Query>("{\"text\":\"x\",\"future\":1}").unwrap(),
            Query::text("x")
        );
    }
}
