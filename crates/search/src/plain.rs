//! OpenNote Markdown to plain text for the index (spec 7).
//!
//! The index wants the words a person reads: no emphasis marks, no link destinations, no escapes. This module
//! also collects the page's headings, for `[[Page#Heading]]` links, and its inline `#tags` (spec 7.6).

use crate::tags;

/// How deep links may nest inside link labels. A `[` deeper than this is plain text.
const MAX_NESTING: usize = 32;
/// The most characters of a link label or a link destination. A longer one is not a link.
const MAX_LINK_CHARS: usize = 2000;
/// How many characters the searches for closing brackets, parentheses, and backticks may read, for each
/// character of the Markdown. Only crafted text needs more, and its later marks then stay in the plain text.
const SCAN_FUEL_PER_CHAR: usize = 32;

/// A heading of a text block.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Heading {
    /// 1 to 6.
    pub level: u8,
    /// The heading's plain text.
    pub text: String,
}

/// What the index keeps of one piece of Markdown.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Extracted {
    /// The plain text, one line for each non-empty line of the Markdown.
    pub text: String,
    /// The headings, in order.
    pub headings: Vec<Heading>,
    /// The inline tags, in normal form. Code never holds a tag.
    pub tags: Vec<String>,
}

/// Turns OpenNote Markdown into plain text, headings, and inline tags.
pub fn extract(markdown: &str) -> Extracted {
    let mut scan = Scan {
        tags: Vec::new(),
        depth: 0,
        fuel: markdown.len().saturating_mul(SCAN_FUEL_PER_CHAR).saturating_add(4096),
    };
    let mut text = String::new();
    let mut headings = Vec::new();
    let mut fence: Option<&str> = None;
    for line in markdown.lines() {
        let trimmed = line.trim_start();
        if let Some(open) = fence {
            if trimmed.starts_with(open) {
                fence = None;
            } else {
                push_line(&mut text, line);
            }
            continue;
        }
        if let Some(marker) = ["```", "~~~"].into_iter().find(|m| trimmed.starts_with(m)) {
            fence = Some(marker);
            continue;
        }
        let Some((level, body)) = block_body(line) else {
            continue;
        };
        let mut plain = String::new();
        if body.starts_with('|') {
            scan.table_row(body, &mut plain);
        } else {
            scan.inline(body, &mut plain);
        }
        if let Some(level) = level {
            headings.push(Heading {
                level,
                text: plain.trim().to_string(),
            });
        }
        push_line(&mut text, &plain);
    }
    Extracted {
        text,
        headings,
        tags: tags::normalize_all(scan.tags.iter().map(String::as_str)),
    }
}

fn push_line(text: &mut String, line: &str) {
    if line.trim().is_empty() {
        return;
    }
    if !text.is_empty() {
        text.push('\n');
    }
    text.push_str(line.trim());
}

/// Strips the block marks of a line: quotes, callout markers, heading marks, list markers, and task boxes.
/// Returns `None` for lines that hold no words, such as rules and table separators.
fn block_body(line: &str) -> Option<(Option<u8>, &str)> {
    let mut rest = line.trim_start();
    while let Some(after) = rest.strip_prefix('>') {
        rest = after.trim_start();
    }
    if rest.starts_with("[!") {
        if let Some(end) = rest.find(']') {
            rest = rest[end + 1..].trim_start();
        }
    }
    let separator = rest.contains('|') && rest.chars().all(|c| matches!(c, '|' | '-' | ':' | ' '));
    if is_rule(rest) || separator {
        return None;
    }
    let hashes = rest.bytes().take_while(|b| *b == b'#').count();
    if (1..=6).contains(&hashes) && (rest.len() == hashes || rest.as_bytes()[hashes] == b' ') {
        return Some((Some(hashes as u8), rest[hashes..].trim()));
    }
    Some((None, strip_list_mark(rest)))
}

fn is_rule(line: &str) -> bool {
    let marks = line.chars().filter(|c| !c.is_whitespace()).count();
    marks >= 3 && line.chars().all(|c| matches!(c, '-' | '*' | '_' | ' '))
}

fn strip_list_mark(line: &str) -> &str {
    let after = match line.strip_prefix(['-', '*', '+']) {
        Some(rest) => rest.strip_prefix(' '),
        None => {
            let digits = line.bytes().take_while(u8::is_ascii_digit).count();
            let after_number = line[digits..].strip_prefix(['.', ')']);
            after_number
                .filter(|_| (1..=9).contains(&digits))
                .and_then(|rest| rest.strip_prefix(' '))
        }
    };
    let Some(rest) = after else { return line };
    let rest = rest.trim_start();
    ["[ ] ", "[x] ", "[X] "]
        .into_iter()
        .find_map(|boxed| rest.strip_prefix(boxed))
        .unwrap_or(rest)
}

/// The state of an inline scan.
struct Scan {
    tags: Vec<String>,
    /// How many link labels the scan is inside.
    depth: usize,
    /// How many more characters the searches for closing marks may read. See [`SCAN_FUEL_PER_CHAR`].
    fuel: usize,
}

impl Scan {
    fn table_row(&mut self, row: &str, out: &mut String) {
        let mut cell = String::new();
        let mut escaped = false;
        for c in row.chars().chain(['|']) {
            if c == '|' && !escaped {
                self.inline(cell.trim(), out);
                out.push(' ');
                cell.clear();
            } else {
                cell.push(c);
            }
            escaped = c == '\\' && !escaped;
        }
    }

    fn inline(&mut self, source: &str, out: &mut String) {
        let chars: Vec<char> = source.chars().collect();
        let mut at = 0;
        while at < chars.len() {
            at = self.step(&chars, at, out);
        }
    }

    /// Handles the character at `at` and returns where the scan goes on.
    fn step(&mut self, c: &[char], at: usize, out: &mut String) -> usize {
        let next = c.get(at + 1).copied();
        match c[at] {
            '\\' if next.is_some_and(|n| n.is_ascii_punctuation()) => {
                out.push(c[at + 1]);
                at + 2
            }
            '`' => self.code_span(c, at, out),
            '!' if next == Some('[') => at + 1,
            '[' => self.link(c, at, out),
            '<' => markup(c, at, out),
            '&' => entity(c, at, out),
            '*' | '~' => at + 1,
            '=' if next == Some('=') => at + 2,
            '_' => {
                let inside_word = at > 0 && c[at - 1].is_alphanumeric() && next.is_some_and(char::is_alphanumeric);
                if inside_word {
                    out.push('_');
                }
                at + 1
            }
            '#' => self.hash(c, at, out),
            other => {
                out.push(other);
                at + 1
            }
        }
    }

    fn link(&mut self, c: &[char], at: usize, out: &mut String) -> usize {
        if self.depth < MAX_NESTING {
            if let Some(close) = self.matching_bracket(c, at) {
                if c.get(close + 1) == Some(&'(') {
                    if let Some(end) = self.destination_end(c, close + 2) {
                        let label: String = c[at + 1..close].iter().collect();
                        self.depth += 1;
                        self.inline(&label, out);
                        self.depth -= 1;
                        return end + 1;
                    }
                }
            }
        }
        out.push('[');
        at + 1
    }

    /// The end of the stretch of `c` from `start` that a search may read: at most `max` characters, and no
    /// more than the fuel left.
    fn reach(&self, c: &[char], start: usize, max: usize) -> usize {
        c.len().min(start.saturating_add(max.min(self.fuel)))
    }

    fn burn(&mut self, read: usize) {
        self.fuel = self.fuel.saturating_sub(read);
    }

    fn matching_bracket(&mut self, c: &[char], at: usize) -> Option<usize> {
        let end = self.reach(c, at + 1, MAX_LINK_CHARS + 1);
        let mut depth = 0;
        let mut i = at + 1;
        let found = loop {
            if i >= end {
                break None;
            }
            match c[i] {
                '\\' => i += 1,
                '[' => depth += 1,
                ']' if depth == 0 => break Some(i),
                ']' => depth -= 1,
                _ => {}
            }
            i += 1;
        };
        self.burn(i - at);
        found
    }

    /// The index of the `)` that closes a link destination, for both the bare and the `<...>` forms.
    fn destination_end(&mut self, c: &[char], start: usize) -> Option<usize> {
        let end = self.reach(c, start, MAX_LINK_CHARS + 2);
        let (found, read) = destination_in(&c[..end], start);
        self.burn(read);
        found
    }

    fn code_span(&mut self, c: &[char], at: usize, out: &mut String) -> usize {
        let ticks = c[at..].iter().take_while(|ch| **ch == '`').count();
        let end = self.reach(c, at + ticks, usize::MAX);
        let closer = closing_ticks(&c[..end], at + ticks, ticks);
        self.burn(closer.map_or(end, |from| from + ticks) - at);
        let Some(from) = closer else {
            out.extend(std::iter::repeat_n('`', ticks));
            return at + ticks;
        };
        let inner: String = c[at + ticks..from].iter().collect();
        out.push_str(
            inner
                .strip_prefix(' ')
                .and_then(|s| s.strip_suffix(' '))
                .unwrap_or(&inner),
        );
        from + ticks
    }

    /// A `#` at the start of a word begins an inline tag when a letter follows.
    fn hash(&mut self, c: &[char], at: usize, out: &mut String) -> usize {
        out.push('#');
        if at > 0 && !c[at - 1].is_whitespace() {
            return at + 1;
        }
        let len = c[at + 1..]
            .iter()
            .take_while(|ch| ch.is_alphanumeric() || matches!(ch, '-' | '_' | '/'))
            .count();
        let tag: String = c[at + 1..at + 1 + len].iter().collect();
        if tag.chars().any(char::is_alphabetic) {
            self.tags.push(tag.clone());
        }
        out.push_str(&tag);
        at + 1 + len
    }
}

/// The start of the next run of exactly `ticks` backticks at or after `from`.
fn closing_ticks(c: &[char], mut from: usize, ticks: usize) -> Option<usize> {
    while from < c.len() {
        if c[from] != '`' {
            from += 1;
            continue;
        }
        let run = c[from..].iter().take_while(|ch| **ch == '`').count();
        if run == ticks {
            return Some(from);
        }
        from += run;
    }
    None
}

/// The index of the `)` that closes a link destination starting at `start`, and how far the search read.
fn destination_in(c: &[char], start: usize) -> (Option<usize>, usize) {
    if c.get(start) == Some(&'<') {
        let mut i = start + 1;
        while i < c.len() {
            match c[i] {
                '\\' => i += 1,
                '>' => return ((c.get(i + 1) == Some(&')')).then_some(i + 1), i - start),
                '\n' => return (None, i - start),
                _ => {}
            }
            i += 1;
        }
        return (None, c.len().saturating_sub(start));
    }
    for (i, ch) in c.iter().enumerate().skip(start) {
        match ch {
            ')' => return (Some(i), i - start),
            ch if ch.is_whitespace() => return (None, i - start),
            _ => {}
        }
    }
    (None, c.len().saturating_sub(start))
}

/// Drops the allowed HTML tags of spec 7.4 and keeps the text of autolinks.
fn markup(c: &[char], at: usize, out: &mut String) -> usize {
    let Some(len) = c[at + 1..]
        .iter()
        .take(200)
        .position(|ch| matches!(ch, '>' | '<' | '\n'))
    else {
        out.push('<');
        return at + 1;
    };
    if c[at + 1 + len] != '>' {
        out.push('<');
        return at + 1;
    }
    let inner: String = c[at + 1..at + 1 + len].iter().collect();
    let name = inner.trim_start_matches('/');
    if ["http:", "https:", "mailto:"]
        .iter()
        .any(|scheme| inner.starts_with(scheme))
    {
        out.push_str(&inner);
    } else if name.starts_with(|ch: char| ch.is_ascii_alphabetic()) {
        if name.starts_with("br") {
            out.push(' ');
        }
    } else {
        out.push('<');
        return at + 1;
    }
    at + len + 2
}

/// Decodes `&#32;`, `&#x20;`, and the few named references that matter.
fn entity(c: &[char], at: usize, out: &mut String) -> usize {
    let found = c[at + 1..].iter().take(10).position(|ch| *ch == ';');
    let decoded = found.and_then(|len| {
        let name: String = c[at + 1..at + 1 + len].iter().collect();
        let value = match name.as_str() {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            _ => name
                .strip_prefix('#')
                .and_then(|number| match number.strip_prefix(['x', 'X']) {
                    Some(hex) => u32::from_str_radix(hex, 16).ok(),
                    None => number.parse().ok(),
                })
                .and_then(char::from_u32),
        };
        value.map(|ch| (if ch.is_control() { ' ' } else { ch }, len))
    });
    match decoded {
        Some((ch, len)) => {
            out.push(ch);
            at + len + 2
        }
        None => {
            out.push('&');
            at + 1
        }
    }
}

#[cfg(test)]
mod tests;
