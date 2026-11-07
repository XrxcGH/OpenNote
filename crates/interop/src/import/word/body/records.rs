//! Notes, comments, and tracked changes while the body is read: their records, and the marks and
//! references that name them (spec 6.10).

use serde_json::{Map, Value};

use super::{Change, Item, Reader};
use crate::doc::{Inline, Marks};
use crate::import::word::TrackedChanges;
use crate::import::xmltree::Element;

/// The longest author name a comment or suggestion keeps (`R-CMT-1`).
const MAX_AUTHOR: usize = 100;

/// The time a change or comment was made, in the spec's form, or `fallback`.
fn time_of(date: Option<&str>, fallback: &str) -> String {
    date.and_then(crate::dates::parse_date)
        .map_or_else(|| fallback.to_owned(), |t| t.to_string())
}

fn author_of(author: Option<&str>) -> String {
    let name: String = author.map(str::trim).unwrap_or("").chars().take(MAX_AUTHOR).collect();
    if name.is_empty() {
        "Unknown author".to_owned()
    } else {
        name
    }
}

impl Reader<'_> {
    /// Starts a tracked change: an insertion or a deletion. Returns whether it was entered.
    pub(super) fn enter_change(&mut self, e: &Element) -> bool {
        let insert = matches!(e.name.as_str(), "w:ins" | "w:moveto");
        let keep = self.changes == TrackedChanges::Suggest && self.in_table == 0 && !self.nested;
        let id = if keep {
            let id = self.new_id();
            if let Some(id) = &id {
                self.stats.suggestions += 1;
                self.records
                    .suggestions
                    .insert(id.clone(), self.suggestion(if insert { "ins" } else { "del" }, e, None));
            }
            id
        } else {
            self.stats.settled += 1;
            None
        };
        self.change.push(Change { insert, id });
        true
    }

    pub(super) fn suggestion(&self, kind: &str, e: &Element, before: Option<String>) -> Value {
        let mut record = Map::new();
        record.insert("kind".to_owned(), Value::from(kind));
        record.insert("author".to_owned(), Value::from(author_of(e.attr("w:author"))));
        record.insert("time".to_owned(), Value::from(time_of(e.attr("w:date"), &self.now)));
        if let Some(before) = before {
            record.insert("before".to_owned(), Value::from(before));
        }
        Value::Object(record)
    }

    /// What the changes around the run being read do to it: `None` drops it, else it gets the IDs of the
    /// insertion and the deletion it is in. Without suggestions, an import accepts every change unless it was asked
    /// to reject them.
    pub(super) fn change_marks(&self) -> Option<(Option<String>, Option<String>)> {
        let (mut ins, mut del) = (None, None);
        for change in &self.change {
            let reject = self.changes == TrackedChanges::Reject;
            match (&change.id, change.insert) {
                (Some(id), true) => ins = Some(id.clone()),
                (Some(id), false) => del = Some(id.clone()),
                (None, true) if reject => return None,
                (None, false) if !reject => return None,
                (None, _) => {}
            }
        }
        Some((ins, del))
    }

    pub(super) fn open_comment(&mut self, e: &Element) {
        let Some(word_id) = e.attr("w:id") else {
            return;
        };
        if self.nested {
            return;
        }
        let Some(sources) = self.sources else {
            return;
        };
        let Some(comment) = sources.comments.get(word_id) else {
            return;
        };
        if comment.parent.is_some() {
            // A reply shares its comment's range.
            return;
        }
        if self.in_table > 0 {
            self.stats.table_marks += 1;
            return;
        }
        let id = match self.comment_ids.get(word_id) {
            Some(id) => id.clone(),
            None => {
                let Some(id) = self.new_id() else {
                    return;
                };
                self.comment_ids.insert(word_id.to_owned(), id.clone());
                id
            }
        };
        if !self.open_comments.iter().any(|(w, _)| w == word_id) {
            self.open_comments.push((word_id.to_owned(), id));
        }
    }

    pub(super) fn close_comment(&mut self, e: &Element) {
        if let Some(word_id) = e.attr("w:id") {
            self.open_comments.retain(|(w, _)| w != word_id);
        }
    }

    /// Makes the records of the comments whose ranges were read, with their replies.
    pub(super) fn finish_comments(&mut self) {
        let Some(sources) = self.sources else {
            return;
        };
        let used: Vec<(String, String)> = self.comment_ids.iter().map(|(w, id)| (w.clone(), id.clone())).collect();
        for (word_id, id) in used {
            let Some(comment) = sources.comments.get(&word_id) else {
                continue;
            };
            let mut record = Map::new();
            record.insert("author".to_owned(), Value::from(author_of(comment.author.as_deref())));
            record.insert(
                "time".to_owned(),
                Value::from(time_of(comment.date.as_deref(), &self.now)),
            );
            record.insert("markdown".to_owned(), Value::from(self.nested_markdown(&comment.body)));
            let replies: Vec<Value> = sources
                .replies(&word_id)
                .into_iter()
                .take(256)
                .map(|reply| {
                    let mut r = Map::new();
                    r.insert("author".to_owned(), Value::from(author_of(reply.author.as_deref())));
                    r.insert(
                        "time".to_owned(),
                        Value::from(time_of(reply.date.as_deref(), &self.now)),
                    );
                    r.insert("markdown".to_owned(), Value::from(self.nested_markdown(&reply.body)));
                    Value::Object(r)
                })
                .collect();
            if !replies.is_empty() {
                record.insert("replies".to_owned(), Value::Array(replies));
            }
            if comment.done {
                record.insert("resolved".to_owned(), Value::from(true));
            }
            self.records.comments.insert(id, Value::Object(record));
        }
    }

    /// The text of a note or comment as inline Markdown: its paragraphs joined by hard breaks. Changes inside it
    /// are settled, since its record cannot hold suggestions.
    pub(super) fn nested_markdown(&mut self, e: &Element) -> String {
        let mut reader = Reader::new(self.rels, self.styles, self.numbering);
        reader.theme = self.theme.clone();
        reader.nested = true;
        reader.changes = if self.changes == TrackedChanges::Reject {
            TrackedChanges::Reject
        } else {
            TrackedChanges::Accept
        };
        let mut items = Vec::new();
        reader.block_content(e, &mut items);
        let mut inlines: Vec<Inline> = Vec::new();
        for item in items {
            let Item::Para(para) = item else {
                continue;
            };
            if para.inlines.is_empty() {
                continue;
            }
            if !inlines.is_empty() {
                inlines.push(Inline::HardBreak);
            }
            inlines.extend(para.inlines);
        }
        if let Some(Inline::Text { text, .. }) = inlines.first_mut() {
            *text = text.trim_start().to_owned();
        }
        inlines.retain(|i| !matches!(i, Inline::Text { text, .. } if text.is_empty()));
        self.plain_styles.append(&mut reader.plain_styles);
        crate::doc::write::inlines_to_markdown(&inlines)
    }

    /// A footnote or endnote reference: the note's text becomes a record of the block, and the reference
    /// `[^id]` (spec 7.12). Inside a table, or without its text, only a count in the report is left.
    pub(super) fn note(&mut self, e: &Element, end: bool, out: &mut Vec<Inline>) {
        let source = self.sources.and_then(|s| {
            let notes = if end { &s.endnotes } else { &s.footnotes };
            e.attr("w:id").and_then(|id| notes.get(id))
        });
        let Some(source) = source else {
            self.stats.note_marks += 1;
            return;
        };
        if self.in_table > 0 || self.nested {
            self.stats.table_marks += 1;
            return;
        }
        let Some(id) = self.new_id() else {
            self.stats.note_marks += 1;
            return;
        };
        let mut record = Map::new();
        if end {
            record.insert("kind".to_owned(), Value::from("end"));
            self.stats.endnotes += 1;
        } else {
            self.stats.footnotes += 1;
        }
        record.insert("markdown".to_owned(), Value::from(self.nested_markdown(source)));
        self.records.notes.insert(id.clone(), Value::Object(record));
        out.push(Inline::Note {
            id,
            marks: Marks::none(),
        });
    }
}
