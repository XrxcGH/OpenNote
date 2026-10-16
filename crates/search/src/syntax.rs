//! The search box: turns what the person types into a [`Query`].
//!
//! Words, quoted phrases, `OR`, `NOT`, a minus sign, brackets, and `title:` stay in the text of the query, where
//! [`crate::boolean`] reads them. Operators narrow the search and leave the text.
//!
//! The `tag:school/biology` operator finds pages with the tag or a tag nested in it. The `in:"Bio 201"` operator
//! finds pages of the notebook or section with that name, and `notebook:` or `section:` names the kind. The
//! `type:table` operator matches only in blocks of that type. Then `before:`, `after:`, and `on:` limit pages by
//! when they were changed. The `created-before:`, `created-after:`, and `created-on:` forms limit them by when
//! they were made.
//!
//! Dates are `2026-03-01`, `2026-03`, `2026`, `today`, `yesterday`, or a time ago such as `7d` or `3m`. `after:`
//! includes the day it names and `before:` does not, as in mail search. Operators apply to the whole search, so
//! one inside brackets is read as words. The parser never fails. Text it cannot use is reported in
//! [`TypedSearch::notes`], so the interface can say what it ignored, and the rest of the search still runs.

mod dates;
mod operators;
mod places;

use opennote_core::Timestamp;
use serde::Serialize;

use crate::doc::BlockKind;
use crate::query::{DateField, DateRange, Query, TextMode};
use crate::tags;
use dates::Clock;
pub use operators::{Operator, OPERATORS};
pub use places::{NamedPlace, PlaceList, PlaceNames};

/// What the parser needs to know about the person.
pub struct SyntaxContext<'a> {
    /// The current time, for `today` and `7d`.
    pub now: Timestamp,
    /// Local time's offset from UTC, in minutes, east positive, so a day starts at the person's midnight.
    pub utc_offset_minutes: i32,
    /// The notebooks and sections an `in:` can name.
    pub places: &'a dyn PlaceNames,
}

/// Something the parser could not use.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SyntaxNote {
    /// No notebook or section has this name.
    UnknownPlace {
        /// The operator.
        operator: String,
        /// The name as typed.
        value: String,
    },
    /// The text is not a date.
    BadDate {
        /// The operator.
        operator: String,
        /// The text as typed.
        value: String,
    },
    /// The text is not a block type.
    UnknownType {
        /// The text as typed.
        value: String,
    },
    /// A search can limit pages by when they were changed or by when they were made, not both.
    TwoDateFields {
        /// The operator that was left out.
        operator: String,
    },
}

impl SyntaxNote {
    /// A sentence for the line below the search box.
    pub fn message(&self) -> String {
        match self {
            SyntaxNote::UnknownPlace { operator, value } => {
                format!("No notebook or section is named \"{value}\", so {operator}: was left out.")
            }
            SyntaxNote::BadDate { operator, value } => {
                format!("\"{value}\" is not a date, so {operator}: was left out. Try 2026-03-01, today, or 7d.")
            }
            SyntaxNote::UnknownType { value } => {
                format!("\"{value}\" is not a block type. Try text, table, image, file, ink, or alt.")
            }
            SyntaxNote::TwoDateFields { operator } => {
                format!("A search limits either the change date or the creation date, so {operator}: was left out.")
            }
        }
    }
}

/// A query read from the text of the search box.
#[derive(Clone, Debug, PartialEq)]
pub struct TypedSearch {
    /// The query. Its limit, offset, and scope are the defaults, for the caller to set.
    pub query: Query,
    /// What was left out, and why.
    pub notes: Vec<SyntaxNote>,
}

/// Reads the text of the search box.
pub fn parse(text: &str, context: &SyntaxContext) -> TypedSearch {
    let text = crate::query::clamp_text(text);
    let clock = Clock {
        now_ms: context.now.unix_ms(),
        utc_offset_minutes: context.utc_offset_minutes,
    };
    let mut reader = Reader {
        query: Query {
            mode: TextMode::Boolean,
            ..Query::default()
        },
        notes: Vec::new(),
        context,
        clock,
    };
    let mut rest = String::new();
    let mut after_operator = false;
    let mut cursor = text;
    while let Some(start) = cursor.find(|c: char| !c.is_whitespace()) {
        let (chunk, after) = split_chunk(&cursor[start..]);
        match operator(chunk) {
            Some((name, value)) => {
                reader.apply(&name, value);
                after_operator = true;
            }
            None => {
                if !rest.is_empty() {
                    rest.push(' ');
                }
                rest.push_str(chunk);
                after_operator = false;
            }
        }
        cursor = after;
    }
    // A word before an operator is finished: the person is typing the operator now.
    if after_operator || text.ends_with(char::is_whitespace) {
        rest.push(' ');
    }
    reader.query.text = rest;
    TypedSearch {
        query: reader.query,
        notes: reader.notes,
    }
}

/// The chunk at the start of `text`, which runs to white space, except that a quoted part stays whole.
fn split_chunk(text: &str) -> (&str, &str) {
    let mut quoted = false;
    for (at, c) in text.char_indices() {
        match c {
            '"' => quoted = !quoted,
            c if c.is_whitespace() && !quoted => return (&text[..at], &text[at..]),
            _ => {}
        }
    }
    (text, "")
}

/// The operator name in lower case and its value, if the chunk is `name:value` for a known operator.
fn operator(chunk: &str) -> Option<(String, &str)> {
    let colon = chunk.find(':')?;
    let name = chunk[..colon].to_ascii_lowercase();
    const NAMES: [&str; 12] = [
        "tag",
        "in",
        "notebook",
        "section",
        "type",
        "before",
        "after",
        "on",
        "created-before",
        "created-after",
        "created-on",
        "is",
    ];
    NAMES.contains(&name.as_str()).then(|| (name, &chunk[colon + 1..]))
}

fn unquote(value: &str) -> &str {
    let value = value.strip_prefix('"').unwrap_or(value);
    value.strip_suffix('"').unwrap_or(value).trim()
}

struct Reader<'a> {
    query: Query,
    notes: Vec<SyntaxNote>,
    context: &'a SyntaxContext<'a>,
    clock: Clock,
}

impl Reader<'_> {
    fn apply(&mut self, name: &str, value: &str) {
        let value = unquote(value);
        // An operator still being typed has no value yet, and that is no mistake.
        if value.is_empty() {
            return;
        }
        match name {
            "tag" => self.tag(value),
            "in" | "notebook" | "section" => self.place(name, value),
            "type" | "is" => self.block_type(value),
            _ => self.date(name, value),
        }
    }

    fn tag(&mut self, value: &str) {
        if let Some(tag) = tags::normalize(value.trim_start_matches('#')) {
            if !self.query.tags.contains(&tag) {
                self.query.tags.push(tag);
            }
        }
    }

    fn place(&mut self, operator: &str, value: &str) {
        let found = self.context.places.find(value);
        let mut matched = false;
        for place in found {
            match place {
                NamedPlace::Notebook(id) if operator != "section" => {
                    matched = true;
                    if !self.query.notebooks.contains(&id) {
                        self.query.notebooks.push(id);
                    }
                }
                NamedPlace::Section(id) if operator != "notebook" => {
                    matched = true;
                    if !self.query.sections.contains(&id) {
                        self.query.sections.push(id);
                    }
                }
                _ => {}
            }
        }
        if !matched {
            self.notes.push(SyntaxNote::UnknownPlace {
                operator: operator.to_string(),
                value: value.to_string(),
            });
        }
    }

    fn block_type(&mut self, value: &str) {
        let kinds: &[BlockKind] = match value.to_ascii_lowercase().as_str() {
            "text" | "note" | "paragraph" => &[BlockKind::Text],
            "table" | "tables" => &[BlockKind::Table],
            "image" | "images" | "picture" | "pictures" => &[BlockKind::Image],
            "file" | "files" | "attachment" | "attachments" => &[BlockKind::File],
            "ink" | "handwriting" | "drawing" | "drawings" => &[BlockKind::Ink],
            "alt" => &[BlockKind::Image, BlockKind::File, BlockKind::Ink],
            "other" => &[BlockKind::Other],
            _ => {
                self.notes.push(SyntaxNote::UnknownType {
                    value: value.to_string(),
                });
                return;
            }
        };
        for kind in kinds {
            if !self.query.block_types.contains(kind) {
                self.query.block_types.push(*kind);
            }
        }
    }

    fn date(&mut self, name: &str, value: &str) {
        let (field, direction) = match name.strip_prefix("created-") {
            Some(direction) => (DateField::Created, direction),
            None => (DateField::Modified, name),
        };
        let Some(span) = self.clock.span(value) else {
            self.notes.push(SyntaxNote::BadDate {
                operator: name.to_string(),
                value: value.to_string(),
            });
            return;
        };
        let range = self.query.date.get_or_insert(DateRange {
            field,
            from: None,
            to: None,
        });
        if range.field != field {
            self.notes.push(SyntaxNote::TwoDateFields {
                operator: name.to_string(),
            });
            return;
        }
        let at = |ms: i64| Some(Timestamp::from_unix_ms(ms));
        match direction {
            "before" => range.to = at(span.from),
            "after" => range.from = at(span.from),
            _ => {
                range.from = at(span.from);
                range.to = at(span.to);
            }
        }
    }
}

#[cfg(test)]
mod tests;
