//! Inline Markdown of version 2, as far as stamping needs it (spec 7.9 to 7.13 and 15.6).
//!
//! A page needs version 2 when a run of its text carries a mark that a version 1 reader does not read
//! (`R-STAMP-8`), or when it holds a footnote reference (`R-STAMP-9`). Whether a tag is a mark depends on the
//! whole paragraph. A tag pairs only with a closing tag of its name (`R-INL-6`). A pair inside 32 others is
//! literal text (`R-INL-12`). Code spans and escapes hide tags. A run keeps only the innermost mark of each kind
//! (`R-MRK-28`).
//!
//! So this module reads each paragraph the way the reference reader of the spec does
//! (`docs/format/tools/inline_read.py`). It keeps only what stamping needs: whether any run carries a mark of
//! version 2, and the readable text (`R-TXT-1`). It runs in time linear in the text. It never panics: indexes
//! go through `get`, and sums saturate.

use std::collections::HashMap;

mod links;
mod pairs;
mod tokens;

use pairs::{expand, pair_tags, process_delimiters};
use tokens::tokenize;

/// Whether any paragraph of a text block's or a cell's Markdown holds a construct of version 2.
pub fn needs_v2(markdown: &str) -> bool {
    inline_containers(markdown)
        .iter()
        .any(|part| read(&part.chars().collect::<Vec<_>>()).needs_v2)
}

/// The readable text of inline Markdown (`R-TXT-1`): paragraphs joined by a blank line, with tags, marks, and
/// footnote references dropped and hard breaks as line feeds.
pub fn readable_text(markdown: &str) -> String {
    markdown
        .split("\n\n")
        .map(|part| read(&part.chars().collect::<Vec<_>>()).text)
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn plus(a: usize, b: usize) -> usize {
    a.saturating_add(b)
}

fn char_at(text: &[char], at: usize) -> Option<char> {
    text.get(at).copied()
}

fn slice(text: &[char], from: usize, to: usize) -> &[char] {
    text.get(from..to).unwrap_or_default()
}

/// The inline text of each paragraph, heading, list item, and quote line, outside fenced code.
fn inline_containers(markdown: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current: Vec<&str> = Vec::new();
    let mut fence = false;
    for line in markdown.split('\n') {
        let stripped = line.trim_start_matches([' ', '>']);
        if stripped.starts_with("```") {
            fence = !fence;
            continue;
        }
        if fence {
            continue;
        }
        let stripped = strip_block_prefix(stripped.trim_start_matches(' '));
        if stripped.is_empty() {
            parts.push(current.join("\n"));
            current.clear();
        } else {
            current.push(stripped);
        }
    }
    parts.push(current.join("\n"));
    parts.retain(|part| !part.is_empty());
    parts
}

/// The line without a heading, list, or task marker: `#{1,6} `, `[-+] ` with an optional `[ ] ` or `[x] `, or
/// a number of 1 to 9 digits and `.` or `)` and a space. Every marker is ASCII, so the cuts fall between
/// characters.
fn strip_block_prefix(line: &str) -> &str {
    let bytes = line.as_bytes();
    let hashes = bytes.iter().take_while(|b| **b == b'#').count();
    if (1..=6).contains(&hashes) && bytes.get(hashes) == Some(&b' ') {
        return line.get(plus(hashes, 1)..).unwrap_or_default();
    }
    if matches!(bytes.first(), Some(b'-' | b'+')) && bytes.get(1) == Some(&b' ') {
        let rest = line.get(2..).unwrap_or_default();
        return ["[ ] ", "[x] "]
            .iter()
            .find_map(|task| rest.strip_prefix(task))
            .unwrap_or(rest);
    }
    let digits = bytes.iter().take_while(|b| b.is_ascii_digit()).count();
    if (1..=9).contains(&digits)
        && matches!(bytes.get(digits), Some(b'.' | b')'))
        && bytes.get(plus(digits, 1)) == Some(&b' ')
    {
        return line.get(plus(digits, 2)..).unwrap_or_default();
    }
    line
}

/// The kinds of mark that have a version 1 form, so that an inner mark of version 1 hides an outer one of
/// version 2 (`R-MRK-28`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum Kind {
    Link,
    Strong,
    Emphasis,
    Strike,
    Highlight,
    Underline,
    Size,
    Color,
    Sub,
}

/// A mark as stamping sees it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Mark {
    /// A mark of a kind with a version 1 form, and whether this value is of version 1.
    Of(Kind, bool),
    /// Any other mark of the reserved grammar, or a foreign mark: every value needs version 2.
    Always,
}

#[derive(Clone, Debug)]
enum Ev {
    Text(String),
    Break,
    Code(String),
    Footnote,
    Html(String),
    Delim(Delim),
    LBracket,
    LinkOpen,
    LinkClose,
    MarkOpen(Kind),
    MarkClose(Kind),
    TagOpen(Mark, String),
    TagClose(usize, String),
}

#[derive(Clone, Debug)]
struct Delim {
    ch: char,
    left: usize,
    can_open: bool,
    can_close: bool,
    run: usize,
    pairs: Vec<(bool, Kind)>,
}

#[derive(Default)]
struct Read {
    needs_v2: bool,
    text: String,
}

/// Reads one inline container.
fn read(text: &[char]) -> Read {
    let mut events = tokenize(text);
    process_delimiters(&mut events);
    let mut events = expand(events);
    pair_tags(&mut events);
    let mut open = OpenMarks::default();
    let mut out = Read::default();
    let mut content = false;
    for (index, event) in events.into_iter().enumerate() {
        match event {
            Ev::Text(t) | Ev::Code(t) if !t.is_empty() => {
                out.needs_v2 |= open.needs_v2();
                out.text.push_str(&t);
                content = true;
            }
            // R-WS-2: a hard break with nothing before it in its paragraph is dropped.
            Ev::Break if content => out.text.push('\n'),
            Ev::Footnote => {
                out.needs_v2 = true;
                content = true;
            }
            Ev::LinkOpen => open.open(Key::Link, Mark::Of(Kind::Link, true)),
            Ev::LinkClose => open.close(Key::Link, Mark::Of(Kind::Link, true)),
            Ev::MarkOpen(kind) => open.open(Key::Delim(kind), Mark::Of(kind, true)),
            Ev::MarkClose(kind) => open.close(Key::Delim(kind), Mark::Of(kind, true)),
            Ev::TagOpen(mark, _) => open.open(Key::Tag(index), mark),
            Ev::TagClose(at, _) => {
                if let Some(mark) = open.tags.get(&at).copied() {
                    open.close(Key::Tag(at), mark);
                }
            }
            _ => {}
        }
    }
    out
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Key {
    Link,
    Delim(Kind),
    Tag(usize),
}

/// The marks open at a point, by kind, so a run's marks cost the number of kinds and not the depth.
#[derive(Default)]
struct OpenMarks {
    always: Vec<Key>,
    by_kind: HashMap<Kind, Vec<(Key, bool)>>,
    tags: HashMap<usize, Mark>,
}

impl OpenMarks {
    fn open(&mut self, key: Key, mark: Mark) {
        if let Key::Tag(at) = key {
            self.tags.insert(at, mark);
        }
        match mark {
            Mark::Always => self.always.push(key),
            Mark::Of(kind, v1) => self.by_kind.entry(kind).or_default().push((key, v1)),
        }
    }

    /// Closes the innermost open mark with this key.
    fn close(&mut self, key: Key, mark: Mark) {
        match mark {
            Mark::Always => {
                if let Some(at) = self.always.iter().rposition(|k| *k == key) {
                    self.always.remove(at);
                }
            }
            Mark::Of(kind, _) => {
                let open = self.by_kind.entry(kind).or_default();
                if let Some(at) = open.iter().rposition(|(k, _)| *k == key) {
                    open.remove(at);
                }
            }
        }
    }

    /// Whether a run here carries a mark of version 2: one value of each kind, the innermost (`R-MRK-28`).
    fn needs_v2(&self) -> bool {
        !self.always.is_empty() || self.by_kind.values().any(|open| open.last().is_some_and(|(_, v1)| !v1))
    }
}

#[cfg(test)]
mod tests;
