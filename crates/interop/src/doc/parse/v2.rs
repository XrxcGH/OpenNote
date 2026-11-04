//! Reading the inline Markdown of an OpenNote page: the tags of spec 7.4 and 7.9, which pair like brackets within
//! a paragraph, foreign marks, `==` highlights, and footnote references (spec 7.12).
//!
//! pulldown-cmark reads the CommonMark structure: emphasis, links, code spans, and raw HTML. The inline events of
//! a paragraph are collected first, because a tag is a mark only when its closing tag comes later in the same
//! paragraph (`R-INL-5`). When the paragraph ends, the tags and `==` delimiters are paired, and the runs get the
//! innermost mark of each kind (`R-MRK-28`).

use std::ops::Range;

use pulldown_cmark::{Event, LinkType, Tag as MdTag, TagEnd};

use super::tags::{read_tag, Mark, Tag, KINDS, MAX_DEPTH};
use super::{Builder, WIKI_PREFIX};
use crate::doc::{push_text, values, Inline, Marks};

/// One inline event of a paragraph, before tags pair.
#[derive(Debug)]
pub(super) enum Ev {
    /// Text as written, which may hold the brackets of a footnote reference.
    Text(String),
    /// Text from an escape or a character reference, which is never Markdown.
    Lit(String),
    /// A run of `=`, which may open or close a highlight.
    Equals {
        /// How many `=` are left.
        run: usize,
        /// Whether it may open: no whitespace after it.
        left: bool,
        /// Whether it may close: no whitespace before it.
        right: bool,
    },
    /// A code span.
    Code(String),
    /// TeX math.
    Math(String),
    /// A hard break.
    Break,
    /// A soft break.
    Soft,
    /// An image.
    Image(String, String),
    /// A footnote reference.
    Note(String),
    /// Raw HTML that may be a tag.
    Html(String),
    /// A mark opens, with a key that its closing event repeats.
    Open(usize, Mark),
    /// The mark opened with this key closes.
    Close(usize),
    /// Nothing: a piece that pairing used up.
    Gone,
}

/// The text of the source at `range`, and whether a backslash escapes its first character.
fn source_of<'s>(source: &'s str, range: &Range<usize>) -> (&'s str, bool) {
    let before = source.get(..range.start).unwrap_or("");
    let slashes = before.bytes().rev().take_while(|b| *b == b'\\').count();
    (source.get(range.clone()).unwrap_or(""), slashes % 2 == 1)
}

impl Builder {
    /// Handles an inline event of a page's Markdown. Returns `false` for the events the block reader handles.
    pub(super) fn page_event(&mut self, event: &Event<'_>, range: &Range<usize>, source: &str) -> bool {
        if self.code.is_some() || self.html_block.is_some() {
            return false;
        }
        if self.image.is_some() {
            return self.image_event(event);
        }
        match event {
            Event::Text(text) => self.page_text(text, range, source),
            Event::Code(code) => self.evs.push(Ev::Code(code.to_string())),
            Event::InlineMath(math) | Event::DisplayMath(math) => self.evs.push(Ev::Math(math.trim().to_owned())),
            Event::InlineHtml(html) => self.evs.push(Ev::Html(html.to_string())),
            Event::SoftBreak => self.evs.push(Ev::Soft),
            Event::HardBreak => self.evs.push(Ev::Break),
            Event::Start(MdTag::Emphasis) => self.md_open(Mark::Emphasis),
            Event::Start(MdTag::Strong) => self.md_open(Mark::Strong),
            Event::Start(MdTag::Strikethrough) => self.md_open(Mark::Strike { double: false }),
            Event::Start(MdTag::Link {
                link_type, dest_url, ..
            }) => {
                let dest = match link_type {
                    LinkType::WikiLink { .. } => format!("{WIKI_PREFIX}{dest_url}"),
                    LinkType::Email => format!("mailto:{dest_url}"),
                    _ => dest_url.to_string(),
                };
                self.md_open(Mark::Link(dest));
            }
            Event::Start(MdTag::Image { dest_url, .. }) => self.image = Some((dest_url.to_string(), String::new())),
            Event::End(TagEnd::Emphasis | TagEnd::Strong | TagEnd::Strikethrough | TagEnd::Link) => {
                if let Some(at) = self.md_open.pop() {
                    self.evs.push(Ev::Close(at));
                }
            }
            _ => return false,
        }
        true
    }

    /// Collects the description of an image.
    fn image_event(&mut self, event: &Event<'_>) -> bool {
        let (_, alt) = self.image.as_mut().expect("an image is open");
        match event {
            Event::Text(text) | Event::Code(text) | Event::InlineMath(text) => alt.push_str(text),
            Event::SoftBreak | Event::HardBreak => alt.push(' '),
            Event::End(TagEnd::Image) => {
                let (dest, alt) = self.image.take().expect("an image is open");
                self.evs.push(Ev::Image(dest, super::clean::clean_alt(&alt)));
            }
            _ => {}
        }
        true
    }

    fn md_open(&mut self, mark: Mark) {
        let key = self.evs.len();
        self.md_open.push(key);
        self.evs.push(Ev::Open(key, mark));
    }

    /// Splits text into plain text, `=` runs, and the pieces of footnote references.
    fn page_text(&mut self, text: &str, range: &Range<usize>, source: &str) {
        let (raw, escaped) = source_of(source, range);
        if raw != text {
            // An entity or an escape: its text is literal.
            self.evs.push(Ev::Lit(text.to_owned()));
            return;
        }
        let mut rest = text;
        let mut at = range.start;
        if escaped {
            let first = rest.chars().next().map_or(0, char::len_utf8);
            self.evs.push(Ev::Lit(rest[..first].to_owned()));
            rest = &rest[first..];
            at += first;
        }
        while let Some(found) = rest.find('=') {
            let run = rest[found..].bytes().take_while(|b| *b == b'=').count();
            if found > 0 {
                self.evs.push(Ev::Text(rest[..found].to_owned()));
            }
            let start = at + found;
            let prev = source[..start].chars().next_back();
            let next = source[start + run..].chars().next();
            let space = |c: Option<char>| c.is_none_or(char::is_whitespace);
            self.evs.push(Ev::Equals {
                run,
                left: !space(next),
                right: !space(prev),
            });
            rest = &rest[found + run..];
            at = start + run;
        }
        if !rest.is_empty() {
            self.evs.push(Ev::Text(rest.to_owned()));
        }
    }

    /// Turns the collected events of a paragraph into its inlines.
    pub(super) fn page_inlines(&mut self) -> Vec<Inline> {
        let mut evs = std::mem::take(&mut self.evs);
        self.md_open.clear();
        if self.references {
            find_references(&mut evs);
        }
        let key = evs.len();
        pair_equals(&mut evs, key);
        let key = key + evs.len();
        pair_tags(&mut evs, key);
        resolve(&evs)
    }
}

/// Turns `[`, `^ID`, and `]` text into a reference (`R-FN-1`). pulldown-cmark gives each bracket that it did not
/// make a link of as text of its own, so an unescaped `[^ID]` is always these three pieces.
fn find_references(evs: &mut [Ev]) {
    for i in 2..evs.len() {
        let id = match &evs[i - 1] {
            Ev::Text(t) => t.strip_prefix('^').filter(|id| values::id(id)),
            _ => None,
        };
        let open = matches!(&evs[i - 2], Ev::Text(t) if t == "[" || t == "![");
        let close = matches!(&evs[i], Ev::Text(t) if t == "]");
        if let (Some(id), true, true) = (id, open, close) {
            let id = id.to_owned();
            if matches!(&evs[i - 2], Ev::Text(t) if t == "![") {
                evs[i - 2] = Ev::Text("!".to_owned());
            } else {
                evs[i - 2] = Ev::Gone;
            }
            evs[i - 1] = Ev::Note(id);
            evs[i] = Ev::Gone;
        }
    }
}

/// Pairs `==` runs as highlights, two `=` at a time, each closer with the nearest opener before it, as
/// CommonMark pairs `~~`. Keys of the new marks start at `key`, past every key in use.
fn pair_equals(evs: &mut Vec<Ev>, mut key: usize) {
    if !evs.iter().any(|ev| matches!(ev, Ev::Equals { .. })) {
        return;
    }
    let left_of = |ev: &Ev| match ev {
        Ev::Equals { run, .. } => *run,
        _ => 0,
    };
    let mut stack: Vec<usize> = Vec::new();
    // For each `=` run: the keys it closes, in order, and the keys it opens.
    let mut closes: Vec<Vec<usize>> = vec![Vec::new(); evs.len()];
    let mut opens: Vec<Vec<usize>> = vec![Vec::new(); evs.len()];
    for i in 0..evs.len() {
        let Ev::Equals { left, right, .. } = evs[i] else {
            continue;
        };
        // Every opener on the stack has at least two `=` left, so the nearest one is the top.
        while right && left_of(&evs[i]) >= 2 {
            let Some(&opener) = stack.last() else {
                break;
            };
            for at in [opener, i] {
                if let Ev::Equals { run, .. } = &mut evs[at] {
                    *run -= 2;
                }
            }
            if left_of(&evs[opener]) < 2 {
                stack.pop();
            }
            opens[opener].push(key);
            closes[i].push(key);
            key += 1;
        }
        if left && left_of(&evs[i]) >= 2 {
            stack.push(i);
        }
    }
    let mut out: Vec<Ev> = Vec::with_capacity(evs.len());
    for (i, ev) in std::mem::take(evs).into_iter().enumerate() {
        let Ev::Equals { run, .. } = ev else {
            out.push(ev);
            continue;
        };
        out.extend(closes[i].iter().map(|k| Ev::Close(*k)));
        if run > 0 {
            out.push(Ev::Text("=".repeat(run)));
        }
        out.extend(
            opens[i]
                .iter()
                .rev()
                .map(|k| Ev::Open(*k, Mark::Highlight("honey".to_owned()))),
        );
    }
    *evs = out;
}

/// Pairs tags like brackets (`R-INL-5`). A closing tag pairs with the opening tag on top of the stack when the
/// names match; every tag left unpaired, and every pair nested too deep (`R-INL-6`), is literal text.
fn pair_tags(evs: &mut [Ev], key: usize) {
    let mut stack: Vec<(usize, &'static str, Mark)> = Vec::new();
    let mut pairs: Vec<(usize, usize, Mark)> = Vec::new();
    for (i, ev) in evs.iter().enumerate() {
        let Ev::Html(raw) = ev else { continue };
        match read_tag(raw) {
            Some(Tag::Open { name, mark }) => stack.push((i, name, mark)),
            Some(Tag::Close(name)) if stack.last().is_some_and(|(_, n, _)| *n == name) => {
                let (open, _, mark) = stack.pop().expect("the stack has a top");
                pairs.push((open, i, mark));
            }
            _ => {}
        }
    }
    pairs.sort_by_key(|(open, _, _)| *open);
    let mut ends: Vec<usize> = Vec::new();
    for (open, close, mark) in pairs {
        while ends.last().is_some_and(|end| *end < open) {
            ends.pop();
        }
        ends.push(close);
        if ends.len() <= MAX_DEPTH {
            evs[open] = Ev::Open(key + open, mark);
            evs[close] = Ev::Close(key + open);
        }
    }
    for ev in evs.iter_mut() {
        if let Ev::Html(raw) = ev {
            *ev = Ev::Text(std::mem::take(raw));
        }
    }
}

/// The marks open at each point, by kind, so a run gets the innermost of each kind.
struct Open {
    by_kind: Vec<Vec<(usize, Mark)>>,
    kind_of: std::collections::HashMap<usize, usize>,
    cached: Option<Marks>,
}

impl Open {
    fn marks(&mut self) -> Marks {
        if let Some(marks) = &self.cached {
            return marks.clone();
        }
        let mut marks = Marks::none();
        for open in &self.by_kind {
            match open.first().map(|(_, m)| m.stacks()) {
                Some(true) => open.iter().for_each(|(_, m)| m.apply(&mut marks)),
                Some(false) => open.last().into_iter().for_each(|(_, m)| m.apply(&mut marks)),
                None => {}
            }
        }
        marks.comments.sort();
        marks.comments.dedup();
        marks.foreign.sort();
        marks.foreign.dedup();
        self.cached = Some(marks.clone());
        marks
    }
}

fn resolve(evs: &[Ev]) -> Vec<Inline> {
    let mut open = Open {
        by_kind: vec![Vec::new(); KINDS],
        kind_of: std::collections::HashMap::new(),
        cached: None,
    };
    let mut out: Vec<Inline> = Vec::new();
    for ev in evs {
        match ev {
            Ev::Text(text) | Ev::Lit(text) => push_text(&mut out, text, &open.marks()),
            Ev::Code(code) => {
                let marks = Marks {
                    code: true,
                    ..open.marks()
                };
                push_text(&mut out, code, &marks);
            }
            Ev::Math(math) => {
                let marks = Marks {
                    math: true,
                    ..Marks::default()
                };
                push_text(&mut out, math, &marks);
            }
            // R-WS-2: a hard break with nothing before it in its paragraph is dropped.
            Ev::Break if !out.is_empty() => out.push(Inline::HardBreak),
            Ev::Soft => out.push(Inline::SoftBreak),
            Ev::Image(dest, alt) => out.push(Inline::Image {
                dest: dest.clone(),
                alt: alt.clone(),
            }),
            Ev::Note(id) => out.push(Inline::Note {
                id: id.clone(),
                marks: open.marks(),
            }),
            Ev::Open(key, mark) => {
                open.by_kind[mark.kind()].push((*key, mark.clone()));
                open.kind_of.insert(*key, mark.kind());
                open.cached = None;
            }
            Ev::Close(key) => {
                if let Some(kind) = open.kind_of.get(key) {
                    let list = &mut open.by_kind[*kind];
                    if let Some(pos) = list.iter().rposition(|(k, _)| k == key) {
                        list.remove(pos);
                    }
                    open.cached = None;
                }
            }
            Ev::Equals { .. } | Ev::Html(_) | Ev::Break | Ev::Gone => {}
        }
    }
    out
}
