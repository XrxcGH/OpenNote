//! Page links in Markdown: finding them, and rewriting them when a page is renamed.
//!
//! Two forms link pages. A title link, `[[Page]]` or `[[Page#Heading]]`, names its target by title. The
//! editor stores an ID link, `[Page](opennote:page/<ID>)`, which survives renames (spec 7.5). The stored link
//! text is the target's title when the link was made, so a rename must rewrite that text. Writers escape a
//! literal `[`, so a title link can also appear as `\[\[Page\]\]`, and both spellings are found.

use std::ops::Range;

use opennote_core::PageId;

use crate::text::fold;

/// How a link names its target.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LinkKind {
    /// `[[Page]]`: by title.
    Title,
    /// `[Page](opennote:page/<ID>)`: by ID.
    Id,
}

/// A link to a page found in Markdown.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Link {
    /// How the link names its target.
    pub kind: LinkKind,
    /// A title link: the page title as written. An ID link: the link text.
    pub title: String,
    /// An ID link: the target page.
    pub target: Option<PageId>,
    /// A title link: the heading after the `#`. An ID link: the text after the `#` of the destination.
    pub fragment: Option<String>,
    /// The link exactly as it appears in the Markdown.
    pub raw: String,
    /// Where the link starts in the Markdown, in bytes.
    pub start: usize,
    /// How the link is written, so a rewrite keeps the spelling.
    spelling: Spelling,
}

/// The spelling of a link.
#[derive(Clone, Debug, PartialEq, Eq)]
enum Spelling {
    /// `[[Page]]`.
    Plain,
    /// `\[\[Page\]\]`.
    Escaped,
    /// An ID link, with its destination as written.
    Destination(String),
}

impl Link {
    /// The folded title of a title link, the form the index matches on.
    pub fn title_norm(&self) -> String {
        fold(&self.title)
    }

    /// The link with another title, in the same spelling when that spelling can hold the title.
    ///
    /// The result always reads back as a link to `title` with the same heading. A title link escapes every `#`
    /// of the title, so the title never splits into a title and a heading. The escaped spelling cannot hold a
    /// title or heading with `]]` in it, so such a link uses the plain spelling with its brackets escaped.
    pub fn with_title(&self, title: &str) -> String {
        let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
        let heading = self.fragment.as_deref();
        let candidates = match &self.spelling {
            Spelling::Destination(dest) => return format!("[{}]({dest})", escape(&title)),
            Spelling::Escaped => vec![escaped_title_link(&title, heading)],
            Spelling::Plain => vec![bare_title_link(&title, heading), escaped_title_link(&title, heading)],
        };
        let fallback = plain_title_link(&title, heading);
        candidates
            .into_iter()
            .find(|candidate| reads_back(candidate, &title, heading))
            .unwrap_or(fallback)
    }
}

/// `[[Title#Heading]]` with nothing escaped. It reads back only when neither part needs an escape.
fn bare_title_link(title: &str, heading: Option<&str>) -> String {
    format!("[[{title}{}]]", heading.map(|h| format!("#{h}")).unwrap_or_default())
}

/// `\[\[Title#Heading\]\]`, the spelling of writers that escape every bracket.
fn escaped_title_link(title: &str, heading: Option<&str>) -> String {
    let heading = heading.map(|h| format!("#{}", escape(h))).unwrap_or_default();
    format!("\\[\\[{}{heading}\\]\\]", escape_title(title))
}

/// `[[Title#Heading]]` with the brackets and marks inside escaped. It holds any title.
fn plain_title_link(title: &str, heading: Option<&str>) -> String {
    let heading = heading.map(|h| format!("#{}", escape(h))).unwrap_or_default();
    format!("[[{}{heading}]]", escape_title(title))
}

/// Escapes a title for a title link: as [`escape`] does, and every `#` as well, since the first bare `#` of a
/// title link starts its heading.
fn escape_title(title: &str) -> String {
    let escaped = escape(title);
    let mut out = String::with_capacity(escaped.len() + 2);
    let mut chars = escaped.chars();
    while let Some(c) = chars.next() {
        match c {
            '\\' => {
                out.push(c);
                out.extend(chars.next());
            }
            '#' => out.push_str("\\#"),
            _ => out.push(c),
        }
    }
    out
}

/// Whether some Markdown is exactly one title link to `title`, with `heading`.
fn reads_back(markdown: &str, title: &str, heading: Option<&str>) -> bool {
    match parse(markdown).as_slice() {
        [link] => link.raw == markdown && link.title == title && link.fragment.as_deref() == heading,
        _ => false,
    }
}

/// A page whose title changes.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Rename {
    /// The page that was renamed.
    pub page: PageId,
    /// Its title before.
    pub old_title: String,
    /// Its title now.
    pub new_title: String,
}

impl Rename {
    /// What `link` becomes, or `None` when the rename does not touch it.
    ///
    /// A title link changes when it names the old title. An ID link changes when it points at the page and its
    /// text is still the old title, so text the person wrote by hand stays.
    pub fn rewrite_link(&self, link: &Link) -> Option<String> {
        let old = fold(&self.old_title);
        let applies = match link.kind {
            LinkKind::Title => link.title_norm() == old,
            LinkKind::Id => link.target == Some(self.page) && fold(&link.title) == old,
        };
        Some(link.with_title(&self.new_title)).filter(|new| applies && *new != link.raw)
    }

    /// The Markdown with every affected link rewritten. It does not look at other pages with the old title.
    pub fn rewrite(&self, markdown: &str) -> String {
        let mut out = markdown.to_string();
        for link in parse(markdown).iter().rev() {
            if let Some(new) = self.rewrite_link(link) {
                out.replace_range(link.start..link.start + link.raw.len(), &new);
            }
        }
        out
    }
}

/// How many bytes the searches for closing brackets and parentheses may read, for each byte of the Markdown.
/// Only crafted text needs more, and the links in the rest of it are then not found.
const SCAN_FUEL_PER_BYTE: usize = 32;

/// What is left of the reading the searches for closing marks may do. See [`SCAN_FUEL_PER_BYTE`].
struct Fuel(usize);

impl Fuel {
    /// The most bytes the next search may read: `max`, or less when the fuel is low.
    fn limit(&self, max: usize) -> usize {
        self.0.min(max)
    }

    fn burn(&mut self, read: usize) {
        self.0 = self.0.saturating_sub(read);
    }
}

/// Every page link in the Markdown, in order. Links inside code are not links.
pub fn parse(markdown: &str) -> Vec<Link> {
    let code = code_ranges(markdown);
    let mut fuel = Fuel(markdown.len().saturating_mul(SCAN_FUEL_PER_BYTE).saturating_add(4096));
    let mut found = Vec::new();
    // The code ranges come in order, so the first one that ends after `at` is the only one that can hold it.
    let mut next_code = 0;
    let mut at = 0;
    while at < markdown.len() {
        while code.get(next_code).is_some_and(|range| range.end <= at) {
            next_code += 1;
        }
        if let Some(range) = code.get(next_code).filter(|range| range.contains(&at)) {
            at = range.end;
            continue;
        }
        let rest = &markdown[at..];
        let link = if rest.starts_with("\\[\\[") {
            title_link(rest, true, &mut fuel)
        } else if rest.starts_with("[[") {
            title_link(rest, false, &mut fuel)
        } else if rest.starts_with('[') {
            id_link(rest, &mut fuel)
        } else {
            None
        };
        let step = match link {
            Some(mut link) => {
                link.start = at;
                let len = link.raw.len();
                found.push(link);
                len
            }
            None if rest.starts_with('\\') => 1 + rest[1..].chars().next().map_or(0, char::len_utf8),
            None => rest.chars().next().map_or(1, char::len_utf8),
        };
        at += step;
    }
    found
}

/// The most bytes between the brackets of a link. A longer run of text is not a link, which also keeps the
/// search for a closing bracket short.
pub(crate) const MAX_LINK_INNER: usize = 2000;

fn title_link(rest: &str, escaped: bool, fuel: &mut Fuel) -> Option<Link> {
    let (open, close) = if escaped { ("\\[\\[", "\\]\\]") } else { ("[[", "]]") };
    let body = &rest[open.len()..];
    let limit = fuel.limit(MAX_LINK_INNER + close.len());
    let (end, read) = if escaped {
        let window = within(body, limit);
        match window.find(close) {
            Some(end) => (Some(end), end + close.len()),
            None => (None, window.len()),
        }
    } else {
        plain_close(body, limit)
    };
    fuel.burn(read);
    let end = end?;
    let inner = &body[..end];
    if inner.contains('\n') {
        return None;
    }
    let (title, heading) = split_heading(inner);
    let title = unescape(title).trim().to_string();
    if title.is_empty() {
        return None;
    }
    let fragment = heading
        .map(|text| unescape(text).trim().to_string())
        .filter(|text| !text.is_empty());
    Some(Link {
        kind: LinkKind::Title,
        title,
        target: None,
        fragment,
        raw: rest[..open.len() + end + close.len()].to_string(),
        start: 0,
        spelling: if escaped { Spelling::Escaped } else { Spelling::Plain },
    })
}

/// The byte index of the `]]` that closes a plain title link, skipping escaped brackets, and how far the
/// search read. A bare `[` or a lone `]` inside breaks the link.
fn plain_close(body: &str, limit: usize) -> (Option<usize>, usize) {
    let window = within(body, limit);
    let mut chars = window.char_indices();
    while let Some((at, c)) = chars.next() {
        match c {
            '\\' => {
                chars.next();
            }
            '[' => return (None, at + 1),
            ']' => return (body[at + 1..].starts_with(']').then_some(at), at + 2),
            _ => {}
        }
    }
    (None, window.len())
}

/// The first `max` bytes of a text, or less to end on a character boundary.
pub(crate) fn within(text: &str, max: usize) -> &str {
    if text.len() <= max {
        return text;
    }
    let mut end = max;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    &text[..end]
}

/// Splits at the first `#` that is not escaped.
fn split_heading(inner: &str) -> (&str, Option<&str>) {
    let mut escaped = false;
    for (at, c) in inner.char_indices() {
        if c == '#' && !escaped {
            return (&inner[..at], Some(&inner[at + 1..]));
        }
        escaped = c == '\\' && !escaped;
    }
    (inner, None)
}

fn id_link(rest: &str, fuel: &mut Fuel) -> Option<Link> {
    let (label_end, read) = closing_bracket_in(rest, fuel.limit(MAX_LINK_INNER + 2));
    fuel.burn(read);
    let label_end = label_end?;
    let after = rest[label_end + 1..].strip_prefix('(')?;
    let (dest_end, read) = destination_in(after, fuel.limit(MAX_LINK_INNER + 2));
    fuel.burn(read);
    let dest_end = dest_end?;
    let written = &after[..dest_end];
    let dest = written
        .strip_prefix('<')
        .and_then(|d| d.strip_suffix('>'))
        .unwrap_or(written);
    let (id, fragment) = match dest.strip_prefix("opennote:page/")?.split_once('#') {
        Some((id, fragment)) => (id, Some(fragment.to_string())),
        None => (dest.strip_prefix("opennote:page/")?, None),
    };
    let label = &rest[1..label_end];
    if label.contains('\n') {
        return None;
    }
    Some(Link {
        kind: LinkKind::Id,
        title: unescape(label),
        target: Some(PageId::parse(id).ok()?),
        fragment,
        raw: rest[..label_end + 2 + dest_end + 1].to_string(),
        start: 0,
        spelling: Spelling::Destination(written.to_string()),
    })
}

/// The byte index of the `]` that closes the `[` at the start of `text`. A label longer than a link body may
/// be is not a label.
pub(crate) fn closing_bracket(text: &str) -> Option<usize> {
    closing_bracket_in(text, MAX_LINK_INNER + 2).0
}

/// The byte index of the `]` that closes the `[` at the start of `text`, reading at most `limit` bytes, and
/// how far the search read.
fn closing_bracket_in(text: &str, limit: usize) -> (Option<usize>, usize) {
    let window = within(text, limit);
    let mut depth = 0;
    let mut skip = false;
    for (at, c) in window.char_indices().skip(1) {
        match c {
            _ if skip => skip = false,
            '\\' => skip = true,
            '[' => depth += 1,
            ']' if depth == 0 => return (Some(at), at + 1),
            ']' => depth -= 1,
            _ => {}
        }
    }
    (None, window.len())
}

/// The byte index of the `)` that ends a link destination, in its bare form or its `<...>` form.
pub(crate) fn destination_end(text: &str) -> Option<usize> {
    destination_in(text, MAX_LINK_INNER + 2).0
}

/// The byte index of the `)` that ends a link destination, reading at most `limit` bytes, and how far the
/// search read.
fn destination_in(text: &str, limit: usize) -> (Option<usize>, usize) {
    let window = within(text, limit);
    if let Some(body) = window.strip_prefix('<') {
        let mut skip = false;
        for (at, c) in body.char_indices() {
            match c {
                _ if skip => skip = false,
                '\\' => skip = true,
                '\n' => return (None, at + 2),
                '>' => return (text[at + 2..].starts_with(')').then_some(at + 2), at + 3),
                _ => {}
            }
        }
        return (None, window.len());
    }
    for (at, c) in window.char_indices() {
        match c {
            ')' => return (Some(at), at + 1),
            c if c.is_whitespace() => return (None, at + 1),
            _ => {}
        }
    }
    (None, window.len())
}

/// The byte ranges of code spans and fenced code blocks.
pub(crate) fn code_ranges(markdown: &str) -> Vec<Range<usize>> {
    let mut ranges = Vec::new();
    let mut offset = 0;
    let mut fence: Option<(usize, &str)> = None;
    for line in markdown.split_inclusive('\n') {
        let trimmed = line.trim_start();
        match fence {
            Some((start, marker)) if trimmed.starts_with(marker) => {
                ranges.push(start..offset + line.len());
                fence = None;
            }
            Some(_) => {}
            None => match ["```", "~~~"].into_iter().find(|m| trimmed.starts_with(m)) {
                Some(marker) => fence = Some((offset, marker)),
                None => code_spans(line, offset, &mut ranges),
            },
        }
        offset += line.len();
    }
    if let Some((start, _)) = fence {
        ranges.push(start..markdown.len());
    }
    ranges
}

fn code_spans(line: &str, offset: usize, ranges: &mut Vec<Range<usize>>) {
    let bytes = line.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'`' {
            i += if bytes[i] == b'\\' { 2 } else { 1 };
            continue;
        }
        let ticks = backtick_run(bytes, i);
        match closing_run(bytes, i + ticks, ticks) {
            Some(end) => {
                ranges.push(offset + i..offset + end);
                i = end;
            }
            None => i += ticks,
        }
    }
}

fn backtick_run(bytes: &[u8], from: usize) -> usize {
    bytes[from..].iter().take_while(|b| **b == b'`').count()
}

/// The end of the next run of exactly `ticks` backticks at or after `from`.
fn closing_run(bytes: &[u8], from: usize, ticks: usize) -> Option<usize> {
    let mut at = from;
    while at < bytes.len() {
        let run = if bytes[at] == b'`' { backtick_run(bytes, at) } else { 0 };
        if run == ticks {
            return Some(at + run);
        }
        at += run.max(1);
    }
    None
}

/// Removes the backslash from every escaped ASCII punctuation mark.
pub fn unescape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match chars.peek() {
            Some(next) if c == '\\' && next.is_ascii_punctuation() => {
                out.push(*next);
                chars.next();
            }
            _ => out.push(c),
        }
    }
    out
}

/// Escapes plain text for Markdown, following spec 7.6 for text inside a line.
pub fn escape(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len() + 4);
    for (i, &c) in chars.iter().enumerate() {
        let prev = i.checked_sub(1).map(|p| chars[p]);
        let next = chars.get(i + 1).copied();
        let needs = match c {
            '\\' | '`' | '*' | '~' | '$' | '[' | ']' | '{' | '<' | '|' => true,
            '_' => !(prev.is_some_and(char::is_alphanumeric) && next.is_some_and(char::is_alphanumeric)),
            '=' => prev == Some('=') || next == Some('='),
            '#' => prev.is_none_or(char::is_whitespace),
            '&' => reference_follows(&chars[i + 1..]),
            _ => false,
        };
        if needs {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// Whether the text after an `&` reads as a character reference: an optional `#`, letters or digits, and `;`.
fn reference_follows(rest: &[char]) -> bool {
    let rest = rest.strip_prefix(&['#']).unwrap_or(rest);
    let name = rest.iter().take_while(|c| c.is_ascii_alphanumeric()).count();
    name > 0 && rest.get(name) == Some(&';')
}

#[cfg(test)]
mod tests;
