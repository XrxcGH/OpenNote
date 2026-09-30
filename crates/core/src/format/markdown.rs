//! The parts of OpenNote Markdown the core needs (spec 7): escaping and links. Owned by WP1.
//!
//! The core otherwise treats Markdown as an opaque string.

mod links;

use unicode_properties::{GeneralCategoryGroup, UnicodeGeneralCategory};

use crate::id::{AssetId, Id, NotebookId, PageId, SectionId};

pub use links::{outgoing_links, rewrite_links, write_destination};

/// A link found in Markdown (spec 7.5).
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LinkTarget {
    /// `opennote:page/<page ID>`, optionally with `#<block or element ID>`.
    Page {
        /// The page.
        page: PageId,
        /// A block or text element on it.
        anchor: Option<Id>,
    },
    /// `opennote:section/<section ID>`.
    Section(SectionId),
    /// `opennote:notebook/<notebook ID>`.
    Notebook(NotebookId),
    /// `asset:<asset ID>`.
    Asset(AssetId),
    /// A web or email link.
    External(String),
    /// A link with an unknown scheme, kept but never opened.
    Other(String),
}

/// Escapes text as spec 7.6 requires. `at_line_start` says whether the text begins a paragraph line.
///
/// A line feed becomes a hard break, and the text after it begins a new paragraph line. A carriage return,
/// alone or before a line feed, is a line break too, because text never holds one (spec 7.6). The end of the
/// text counts as the end of a line, so a space there is written as a character reference.
pub fn escape_text(text: &str, at_line_start: bool) -> String {
    let normalized = text.replace("\r\n", "\n").replace('\r', "\n");
    let chars: Vec<char> = normalized.chars().collect();
    let mut out = String::with_capacity(text.len().saturating_add(8));
    let mut line_start = at_line_start;
    // The characters since the start of the current paragraph line, when they are all ASCII digits.
    let mut leading_digits: Option<usize> = at_line_start.then_some(0);
    for (i, &c) in chars.iter().enumerate() {
        let before = i.checked_sub(1).and_then(|j| chars.get(j)).copied();
        let after = chars.get(i.saturating_add(1)).copied();
        if c == '\n' {
            out.push_str("\\\n");
            line_start = true;
            leading_digits = Some(0);
            continue;
        }
        let first = line_start;
        line_start = false;
        let digits_before = leading_digits.unwrap_or(0);
        leading_digits = leading_digits
            .filter(|_| c.is_ascii_digit())
            .map(|n| n.saturating_add(1));
        let context = Context {
            first,
            last: after.is_none_or(|a| a == '\n'),
            before,
            after,
            rest: chars.get(i.saturating_add(1)..).unwrap_or_default(),
            after_digits: (1..=9).contains(&digits_before) && leading_digits.is_none(),
        };
        push_escaped(&mut out, c, &context);
    }
    out
}

/// What escaping one character depends on.
struct Context<'a> {
    first: bool,
    last: bool,
    before: Option<char>,
    after: Option<char>,
    rest: &'a [char],
    after_digits: bool,
}

fn push_escaped(out: &mut String, c: char, cx: &Context<'_>) {
    match c {
        '\0' => out.push('\u{fffd}'),
        '\t' => out.push_str("&#9;"),
        ' ' if cx.first || cx.last => out.push_str("&#32;"),
        '\\' | '`' | '*' | '~' | '$' | '[' | ']' | '{' | '<' | '|' => escaped(out, c),
        '_' if !(is_word(cx.before) && is_word(cx.after)) => escaped(out, c),
        '=' if cx.first || cx.before == Some('=') || cx.after == Some('=') => escaped(out, c),
        '&' if is_reference(cx.rest) => escaped(out, c),
        '#' if cx.before.is_none_or(char::is_whitespace) => escaped(out, c),
        '>' | '-' | '+' if cx.first => escaped(out, c),
        '.' | ')' if cx.after_digits => escaped(out, c),
        c => out.push(c),
    }
}

fn escaped(out: &mut String, c: char) {
    out.push('\\');
    out.push(c);
}

/// Whether a character is a letter or a digit: Unicode categories L and N.
fn is_word(c: Option<char>) -> bool {
    c.is_some_and(|c| {
        matches!(
            c.general_category_group(),
            GeneralCategoryGroup::Letter | GeneralCategoryGroup::Number
        )
    })
}

/// Whether the characters after a `&` make a character reference: an optional `#`, then ASCII letters or
/// digits, then `;`.
fn is_reference(rest: &[char]) -> bool {
    let rest = rest.strip_prefix(&['#']).unwrap_or(rest);
    let name = rest.iter().take_while(|c| c.is_ascii_alphanumeric()).count();
    name > 0 && rest.get(name) == Some(&';')
}

/// Text for a single line, such as a heading or a list item: line breaks become spaces.
pub fn one_line(text: &str) -> String {
    text.replace("\r\n", " ").replace(['\r', '\n'], " ")
}

/// Undoes [`escape_text`]: backslash escapes, the two character references it writes, and hard breaks.
pub fn unescape_text(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(c) = rest.chars().next() {
        let (piece, len) = if c == '\\' {
            match rest.get(1..).and_then(|r| r.chars().next()) {
                Some(next) => (next, next.len_utf8().saturating_add(1)),
                None => (c, 1),
            }
        } else if rest.starts_with("&#32;") {
            (' ', 5)
        } else if rest.starts_with("&#9;") {
            ('\t', 4)
        } else {
            (c, c.len_utf8())
        };
        out.push(piece);
        rest = rest.get(len..).unwrap_or_default();
    }
    out
}

#[cfg(test)]
mod tests;
