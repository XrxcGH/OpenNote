//! Finding and rewriting link destinations in OpenNote Markdown (spec 7.5 and 11.1).
//!
//! The scan is a small subset of CommonMark: it skips fenced code blocks, code spans, and backslash escapes,
//! and finds the destinations of inline links and images, `[text](destination)`, and autolinks.

use std::ops::Range;

use super::LinkTarget;
use crate::id::{Id, PageId};
use crate::seams::LinkResolver;

/// A link destination found in Markdown.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Found {
    /// Where the destination is written, including any `<` and `>` around it.
    span: Range<usize>,
    /// The destination with its backslash escapes removed.
    destination: String,
    /// Whether it may be rewritten: autolinks keep their form.
    rewritable: bool,
}

/// Every link in a text block's Markdown, in order.
pub fn outgoing_links(markdown: &str) -> Vec<LinkTarget> {
    find_links(markdown)
        .into_iter()
        .map(|f| classify(&f.destination))
        .collect()
}

/// Rewrites page and asset links into relative paths for `page.md` (spec 11.1). Links the resolver doesn't
/// know stay as they are. A page link's fragment is dropped, because `page.md` has no element anchors.
pub fn rewrite_links(markdown: &str, from: PageId, links: &dyn LinkResolver) -> String {
    let mut out = String::with_capacity(markdown.len());
    let mut copied = 0;
    for found in find_links(markdown).into_iter().filter(|f| f.rewritable) {
        let target = match classify(&found.destination) {
            LinkTarget::Page { page, .. } => links.page_md(from, page),
            LinkTarget::Asset(asset) => links.asset_file(asset).map(|file| format!("assets/{file}")),
            _ => None,
        };
        let Some(target) = target else {
            continue;
        };
        out.push_str(markdown.get(copied..found.span.start).unwrap_or_default());
        out.push_str(&write_destination(&target));
        copied = found.span.end;
    }
    out.push_str(markdown.get(copied..).unwrap_or_default());
    out
}

/// A destination as spec 7.5 writes it: bare when it can be, otherwise between `<` and `>`.
pub fn write_destination(destination: &str) -> String {
    let bare = !destination.is_empty()
        && !destination
            .chars()
            .any(|c| c.is_whitespace() || c.is_control() || matches!(c, '(' | ')' | '<' | '>' | '\\'));
    if bare {
        return destination.to_owned();
    }
    let mut out = String::from("<");
    for c in destination.chars() {
        if matches!(c, '<' | '>' | '\\') {
            out.push('\\');
        }
        out.push(c);
    }
    out.push('>');
    out
}

/// What a destination points at.
fn classify(destination: &str) -> LinkTarget {
    let id = |text: &str| {
        text.get(..Id::TEXT_LEN)
            .filter(|_| text.len() == Id::TEXT_LEN)
            .and_then(|t| Id::parse(t).ok())
    };
    if let Some(rest) = destination.strip_prefix("opennote:page/") {
        let (page, fragment) = rest.split_once('#').map_or((rest, None), |(p, f)| (p, Some(f)));
        let anchor = fragment
            .and_then(|f| f.get(..Id::TEXT_LEN))
            .and_then(|f| Id::parse(f).ok());
        if let Some(page) = id(page) {
            return LinkTarget::Page {
                page: PageId(page),
                anchor,
            };
        }
    } else if let Some(section) = destination.strip_prefix("opennote:section/").and_then(id) {
        return LinkTarget::Section(section.into());
    } else if let Some(notebook) = destination.strip_prefix("opennote:notebook/").and_then(id) {
        return LinkTarget::Notebook(notebook.into());
    } else if let Some(asset) = destination.strip_prefix("asset:").and_then(id) {
        return LinkTarget::Asset(asset.into());
    }
    let scheme = destination.split_once(':').map(|(s, _)| s.to_ascii_lowercase());
    match scheme.as_deref() {
        Some("http" | "https" | "mailto") => LinkTarget::External(destination.to_owned()),
        _ => LinkTarget::Other(destination.to_owned()),
    }
}

/// Every link destination in the Markdown, outside code.
fn find_links(markdown: &str) -> Vec<Found> {
    let mut found = Vec::new();
    let mut offset = 0usize;
    let mut fence: Option<(char, usize)> = None;
    for line in markdown.split_inclusive('\n') {
        let start = offset;
        offset = offset.saturating_add(line.len());
        if let Some(marker) = fence_marker(line) {
            match fence {
                None => fence = Some(marker),
                Some((c, n)) if marker.0 == c && marker.1 >= n => fence = None,
                Some(_) => {}
            }
            continue;
        }
        if fence.is_none() {
            scan_line(line, start, &mut found);
        }
    }
    found
}

/// The fence character and length when a line opens or closes a code fence, after any quote and list
/// markers and indentation.
fn fence_marker(line: &str) -> Option<(char, usize)> {
    let content = line.trim_start_matches([' ', '>', '\t']);
    let c = content.chars().next().filter(|&c| c == '`' || c == '~')?;
    let run = content.chars().take_while(|&x| x == c).count();
    (run >= 3).then_some((c, run))
}

/// Finds link destinations in one line. Code spans are skipped. A code span that runs past its line is
/// treated as plain text, which errs toward finding links.
fn scan_line(line: &str, start: usize, found: &mut Vec<Found>) {
    let bytes = line.as_bytes();
    let mut i = 0usize;
    // Unescaped `[` not closed yet. A `](` only ends a link when a `[` opened one.
    let mut open = 0usize;
    while let Some(&b) = bytes.get(i) {
        match b {
            b'\\' => i = i.saturating_add(2),
            b'`' => i = skip_code_span(bytes, i),
            b'[' => {
                open = open.saturating_add(1);
                i = i.saturating_add(1);
            }
            b']' if open == 0 => i = i.saturating_add(1),
            b']' if bytes.get(i.saturating_add(1)) != Some(&b'(') => {
                open = open.saturating_sub(1);
                i = i.saturating_add(1);
            }
            b']' => {
                open = open.saturating_sub(1);
                i = inline_link(line, i.saturating_add(2), start, found);
            }
            b'<' => i = autolink(line, i, start, found),
            _ => i = i.saturating_add(1),
        }
    }
}

/// The destination of an inline link, after its `](` at `at`. Returns where scanning goes on.
fn inline_link(line: &str, at: usize, start: usize, found: &mut Vec<Found>) -> usize {
    let Some((span, destination)) = destination(line, at) else {
        return at;
    };
    let next = span.end;
    found.push(Found {
        span: span.start.saturating_add(start)..span.end.saturating_add(start),
        destination,
        rewritable: true,
    });
    next
}

fn skip_code_span(bytes: &[u8], at: usize) -> usize {
    let run = bytes
        .get(at..)
        .map_or(0, |r| r.iter().take_while(|&&b| b == b'`').count());
    let mut i = at.saturating_add(run);
    while i < bytes.len() {
        let len = bytes
            .get(i..)
            .map_or(0, |r| r.iter().take_while(|&&b| b == b'`').count());
        if len == run {
            return i.saturating_add(len);
        }
        i = i.saturating_add(len.max(1));
    }
    at.saturating_add(run)
}

/// The destination after `](`: its span and its text without backslash escapes.
fn destination(line: &str, at: usize) -> Option<(Range<usize>, String)> {
    let rest = line.get(at..)?;
    let skipped = rest.len().saturating_sub(rest.trim_start_matches([' ', '\t']).len());
    let at = at.saturating_add(skipped);
    let rest = line.get(at..)?;
    if let Some(inner) = rest.strip_prefix('<') {
        let mut text = String::new();
        let mut chars = inner.char_indices();
        while let Some((i, c)) = chars.next() {
            match c {
                '\\' => text.extend(chars.next().map(|(_, c)| c)),
                '>' => return Some((at..at.saturating_add(i).saturating_add(2), text)),
                '<' | '\n' => return None,
                c => text.push(c),
            }
        }
        return None;
    }
    let mut depth = 0usize;
    let mut text = String::new();
    let mut chars = rest.char_indices();
    while let Some((i, c)) = chars.next() {
        match c {
            '\\' => text.extend(chars.next().map(|(_, c)| c)),
            '(' => {
                depth = depth.saturating_add(1);
                text.push(c);
            }
            ')' if depth == 0 => return Some((at..at.saturating_add(i), text)),
            ')' => {
                depth = depth.saturating_sub(1);
                text.push(c);
            }
            c if c.is_whitespace() || c.is_control() => return Some((at..at.saturating_add(i), text)),
            c => text.push(c),
        }
    }
    None
}

/// An autolink such as `<https://example.org>` at `at`. Returns where scanning goes on.
fn autolink(line: &str, at: usize, start: usize, found: &mut Vec<Found>) -> usize {
    let next = at.saturating_add(1);
    let Some(rest) = line.get(next..) else {
        return next;
    };
    let Some(end) = rest.find('>') else {
        return next;
    };
    let inner = rest.get(..end).unwrap_or_default();
    let scheme_len = inner.find(':').unwrap_or(0);
    let scheme_ok = (2..=32).contains(&scheme_len)
        && inner.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        && inner
            .chars()
            .take(scheme_len)
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '.' | '-'));
    if !scheme_ok || inner.chars().any(|c| c.is_whitespace() || c.is_control() || c == '<') {
        return next;
    }
    found.push(Found {
        span: at.saturating_add(start)..next.saturating_add(end).saturating_add(1).saturating_add(start),
        destination: inner.to_owned(),
        rewritable: false,
    });
    next.saturating_add(end).saturating_add(1)
}
