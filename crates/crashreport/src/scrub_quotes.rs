//! The scrubber's rule for quoted text, in every common quote mark. It is separate from the other rules in
//! [`crate::scrub`] to keep each file small.

use crate::scrub::TEXT;

/// The marks that may close a quote opened with `open`, for the quote marks people and programs write. Some
/// languages write a pair the other way round, as in `»Plan«`, `”Plan”`, and `‚Plan‘`. So a mark of either
/// direction closes a quote that either one opened.
fn closing_marks(open: char) -> Option<&'static [char]> {
    let marks: &'static [char] = match open {
        '"' => &['"'],
        '\'' => &['\''],
        '`' => &['`'],
        '\u{201C}' | '\u{201D}' | '\u{201E}' => &['\u{201C}', '\u{201D}'],
        '\u{2018}' | '\u{2019}' | '\u{201A}' => &['\u{2018}', '\u{2019}'],
        '\u{00AB}' | '\u{00BB}' => &['\u{00AB}', '\u{00BB}'],
        '\u{2039}' | '\u{203A}' => &['\u{2039}', '\u{203A}'],
        '\u{300C}' => &['\u{300D}'],
        '\u{300E}' => &['\u{300F}'],
        _ => return None,
    };
    Some(marks)
}

/// Whether a quote mark is also written as an apostrophe, as in `can't` and `can’t`.
fn is_apostrophe(c: char) -> bool {
    matches!(c, '\'' | '\u{2019}')
}

/// Whether text in backticks names code, such as `Option::unwrap()` or `None`, as in the standard library's own
/// messages. Anything else in backticks is quoted text, such as a page name in a parse error.
fn is_code(text: &str) -> bool {
    if matches!(text, "Ok" | "Err" | "Some" | "None" | "async fn") {
        return true;
    }
    let plain = text.len() <= 80
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "_:<>()&[]*!.,".contains(c));
    plain && (text.contains("::") || text.ends_with("()"))
}

/// Replaces every quoted piece of text, including one that is never closed. A quote runs from its first mark to
/// the last mark that can close it. One stray mark then can't swap what is inside and outside, and the text
/// between two quotes goes too. That removes more than the quotes at times, which is the safe way to be wrong.
///
/// An apostrophe-like mark opens a quote only where it can't be an apostrophe: not right after a letter or
/// digit, and not before a space. It closes one only where a letter or digit doesn't follow it. Code in
/// backticks stays, and so do placeholders from an earlier pass.
pub(crate) fn replace_quoted(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut previous: Option<char> = None;
    let mut rest = text;
    while let Some(c) = rest.chars().next() {
        let after = &rest[c.len_utf8()..];
        let kept = if rest.starts_with(TEXT) {
            Some(TEXT.len())
        } else if c == '`' {
            after.find('`').filter(|&end| is_code(&after[..end])).map(|end| end + 2)
        } else {
            None
        };
        if let Some(len) = kept {
            out.push_str(&rest[..len]);
            previous = rest[..len].chars().next_back();
            rest = &rest[len..];
            continue;
        }
        let closers = closing_marks(c).filter(|_| {
            !is_apostrophe(c)
                || (previous.is_none_or(|p| !p.is_alphanumeric())
                    && after.chars().next().is_some_and(|n| !n.is_whitespace()))
        });
        let Some(closers) = closers else {
            out.push(c);
            previous = Some(c);
            rest = after;
            continue;
        };
        out.push_str(TEXT);
        let end = last_close(after, closers);
        previous = after[..end].chars().next_back().or(Some(c));
        rest = &after[end..];
    }
    out
}

/// Where a quote whose text starts `text` ends: just after the last mark in `closers` that closes it, or at the
/// end of the text when none does. A mark after a backslash is escaped and doesn't close.
fn last_close(text: &str, closers: &[char]) -> usize {
    let mut end = text.len();
    let mut escaped = false;
    let mut chars = text.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        let next = chars.peek().map(|&(_, n)| n);
        if !escaped && closers.contains(&c) && !(is_apostrophe(c) && next.is_some_and(char::is_alphanumeric)) {
            end = i + c.len_utf8();
        }
        escaped = !escaped && c == '\\';
    }
    end
}

#[cfg(test)]
#[path = "scrub_quotes_tests.rs"]
mod tests;
