//! The parts of Markdown that are not prose, which a mention must not touch.

use std::ops::Range;

use crate::links;

/// The ranges of Markdown that are not prose: code, links, addresses, HTML, math, and tags.
pub(super) fn protected_ranges(markdown: &str) -> Vec<Range<usize>> {
    let mut out = links::code_ranges(markdown);
    out.extend(
        links::parse(markdown)
            .iter()
            .map(|link| link.start..link.start + link.raw.len()),
    );
    let mut chars = markdown.char_indices().peekable();
    let mut covered = 0;
    while let Some((at, c)) = chars.next() {
        if at < covered {
            continue;
        }
        let rest = &markdown[at..];
        let end = match c {
            '\\' => {
                chars.next();
                None
            }
            '[' => bracket_link(rest),
            '<' => angle(rest),
            '$' => math(rest),
            '#' if tag_start(markdown, at) => Some(tag_end(rest)),
            'h' | 'H' | 'w' | 'W' if address_start(markdown, at) => Some(address_end(rest)),
            _ => None,
        };
        if let Some(end) = end.filter(|end| *end > 0) {
            out.push(at..at + end);
            covered = at + end;
        }
    }
    out
}

/// `[label](destination)` or `[label][reference]`: the length up to the end.
fn bracket_link(rest: &str) -> Option<usize> {
    let label_end = links::closing_bracket(rest)?;
    let after = &rest[label_end + 1..];
    if let Some(inner) = after.strip_prefix('(') {
        return links::destination_end(inner).map(|end| label_end + 2 + end + 1);
    }
    let reference = after.strip_prefix('[')?;
    let close = reference.find([']', '\n'])?;
    reference[close..].starts_with(']').then_some(label_end + 2 + close + 1)
}

/// `<https://...>` and HTML tags: up to the closing `>` on the same line.
fn angle(rest: &str) -> Option<usize> {
    let mut chars = rest[1..].chars();
    let first = chars.next()?;
    if !(first.is_ascii_alphabetic() || first == '/' || first == '!') {
        return None;
    }
    let close = rest.find(['>', '\n'])?;
    (rest[close..].starts_with('>') && close < 400).then_some(close + 1)
}

/// `$math$` on one line.
fn math(rest: &str) -> Option<usize> {
    let body = rest.strip_prefix('$')?;
    let close = body.find(['$', '\n'])?;
    (body[close..].starts_with('$') && close > 0).then_some(close + 2)
}

/// A `#` that begins a tag: not after a letter, and before one.
fn tag_start(markdown: &str, at: usize) -> bool {
    let before = markdown[..at].chars().next_back();
    let after = markdown[at + 1..].chars().next();
    !before.is_some_and(char::is_alphanumeric) && after.is_some_and(char::is_alphanumeric)
}

fn tag_end(rest: &str) -> usize {
    1 + rest[1..]
        .find(|c: char| !(c.is_alphanumeric() || matches!(c, '_' | '-' | '/')))
        .unwrap_or(rest.len() - 1)
}

fn address_start(markdown: &str, at: usize) -> bool {
    let rest = &markdown[at..];
    let lower: String = rest.chars().take(8).collect::<String>().to_ascii_lowercase();
    let boundary = !markdown[..at].chars().next_back().is_some_and(char::is_alphanumeric);
    boundary && (lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("www."))
}

fn address_end(rest: &str) -> usize {
    let end = rest
        .find(|c: char| c.is_whitespace() || matches!(c, ')' | '>' | '<'))
        .unwrap_or(rest.len());
    rest[..end].trim_end_matches(['.', ',', ';', ':', '!', '?']).len()
}
