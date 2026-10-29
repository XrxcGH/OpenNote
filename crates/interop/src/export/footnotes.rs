//! Footnotes in exported text: `[^key]` marks a note and `[^key]: text` defines it.
//!
//! Page Markdown has no footnotes of its own (spec 7), so the Markdown parser would read a definition as a link
//! reference and drop it. Before a page is converted, [`extract`] takes the definitions out of its texts and
//! replaces each reference to a defined note with a marker that the parser keeps as text. The LaTeX export turns
//! the markers into `\footnote{...}`. A reference with no definition stays as typed.

use super::equations::fence_of;

/// Starts a marker. The two private-use characters never appear in exported text, because [`extract`] removes them
/// from it first.
pub const OPEN: char = '\u{E000}';
/// Ends a marker.
pub const CLOSE: char = '\u{E001}';

/// The most notes one page keeps.
const MAX_NOTES: usize = 10_000;
/// The longest key.
const MAX_KEY: usize = 32;

/// A definition: the key and its Markdown.
struct Definition {
    key: String,
    markdown: String,
}

fn valid_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= MAX_KEY && key.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// The key and the text after it, when the line starts a definition.
fn definition_start(line: &str) -> Option<(&str, &str)> {
    let trimmed = line.trim_start_matches(' ');
    if line.len() - trimmed.len() > 3 {
        return None;
    }
    let rest = trimmed.strip_prefix("[^")?;
    let (key, after) = rest.split_once("]:")?;
    valid_key(key).then(|| (key, after.trim()))
}

/// Takes the definitions out of the texts and puts a marker where a defined note is referenced. Returns the
/// Markdown of each note, in the order of its definition. The marker of note `n` is `OPEN`, the digits of `n`,
/// `CLOSE`.
pub fn extract(texts: &mut [String]) -> Vec<String> {
    let touched = |t: &String| t.contains("[^") || t.contains([OPEN, CLOSE]);
    if !texts.iter().any(touched) {
        return Vec::new();
    }
    let mut definitions: Vec<Definition> = Vec::new();
    for text in texts.iter_mut() {
        let cleaned: String = text.chars().filter(|c| *c != OPEN && *c != CLOSE).collect();
        *text = take_definitions(&cleaned, &mut definitions);
    }
    if definitions.is_empty() {
        return Vec::new();
    }
    let keys: Vec<&str> = definitions.iter().map(|d| d.key.as_str()).collect();
    for text in texts.iter_mut() {
        *text = mark_references(text, &keys);
    }
    definitions.into_iter().map(|d| d.markdown).collect()
}

/// The text without its definition lines. The definitions go into `found`; the first one of a key wins.
fn take_definitions(text: &str, found: &mut Vec<Definition>) -> String {
    if !text.contains("[^") {
        return text.to_owned();
    }
    let mut kept: Vec<&str> = Vec::new();
    let mut fence: Option<(char, usize)> = None;
    let mut lines = text.split('\n').peekable();
    while let Some(line) = lines.next() {
        let marker = fence_of(line);
        if let Some((c, n)) = fence {
            if matches!(marker, Some((fc, fnum)) if fc == c && fnum >= n) {
                fence = None;
            }
            kept.push(line);
            continue;
        }
        if marker.is_some() {
            fence = marker;
            kept.push(line);
            continue;
        }
        let Some((key, first)) = definition_start(line) else {
            kept.push(line);
            continue;
        };
        let mut markdown = first.to_owned();
        while let Some(next) = lines.peek() {
            let indented = next.starts_with("    ") || next.starts_with('\t');
            if !indented || next.trim().is_empty() {
                break;
            }
            markdown.push(' ');
            markdown.push_str(next.trim());
            lines.next();
        }
        if found.len() < MAX_NOTES && !markdown.is_empty() && found.iter().all(|d| d.key != key) {
            found.push(Definition {
                key: key.to_owned(),
                markdown,
            });
        }
    }
    kept.join("\n").trim_end_matches('\n').to_owned()
}

/// The text with `[^key]` replaced by a marker, outside code fences and code spans.
fn mark_references(text: &str, keys: &[&str]) -> String {
    if !text.contains("[^") {
        return text.to_owned();
    }
    let mut out: Vec<String> = Vec::new();
    let mut fence: Option<(char, usize)> = None;
    for line in text.split('\n') {
        let marker = fence_of(line);
        if let Some((c, n)) = fence {
            if matches!(marker, Some((fc, fnum)) if fc == c && fnum >= n) {
                fence = None;
            }
            out.push(line.to_owned());
        } else if marker.is_some() {
            fence = marker;
            out.push(line.to_owned());
        } else {
            out.push(mark_line(line, keys));
        }
    }
    out.join("\n")
}

fn mark_line(line: &str, keys: &[&str]) -> String {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while !rest.is_empty() {
        let tick = rest.find('`');
        let note = rest.find("[^");
        match (tick, note) {
            (Some(t), n) if n.is_none_or(|n| t < n) => {
                let run = rest[t..].chars().take_while(|c| *c == '`').count();
                let after = &rest[t + run..];
                let closing = "`".repeat(run);
                match after.find(&closing) {
                    Some(close) => {
                        let end = t + run + close + run;
                        out.push_str(&rest[..end]);
                        rest = &rest[end..];
                    }
                    None => {
                        out.push_str(&rest[..t + run]);
                        rest = after;
                    }
                }
            }
            (_, Some(n)) => {
                let after = &rest[n + 2..];
                let hit = after.find(']').and_then(|end| {
                    let key = &after[..end];
                    keys.iter().position(|k| *k == key).map(|index| (index, end))
                });
                match hit {
                    Some((index, end)) => {
                        out.push_str(&rest[..n]);
                        out.push(OPEN);
                        out.push_str(&index.to_string());
                        out.push(CLOSE);
                        rest = &after[end + 1..];
                    }
                    None => {
                        out.push_str(&rest[..n + 2]);
                        rest = after;
                    }
                }
            }
            _ => {
                out.push_str(rest);
                rest = "";
            }
        }
    }
    out
}

/// A piece of a run of text.
#[derive(Debug, PartialEq, Eq)]
pub enum Piece<'a> {
    /// Text.
    Text(&'a str),
    /// A reference to a note, by its number.
    Note(usize),
}

/// The text without its note markers, digits included. Text that cannot hold a note (a heading's outline entry, a
/// table cell's width, an alt text) is written through this, so a marker never leaves its number behind.
pub fn strip_markers(text: &str) -> String {
    if !text.contains([OPEN, CLOSE]) {
        return text.to_owned();
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find(OPEN) {
        out.push_str(&rest[..open]);
        let after = &rest[open + OPEN.len_utf8()..];
        let digits = after.bytes().take_while(u8::is_ascii_digit).count();
        rest = if after[digits..].starts_with(CLOSE) {
            &after[digits + CLOSE.len_utf8()..]
        } else {
            after
        };
    }
    out.push_str(rest);
    out.retain(|c| c != CLOSE);
    out
}

/// A run of text cut at its note markers. A marker whose number is not below `count` stays in the text.
pub fn split_markers(text: &str, count: usize) -> Vec<Piece<'_>> {
    let mut pieces = Vec::new();
    let mut rest = text;
    while let Some(open) = rest.find(OPEN) {
        let after = &rest[open + OPEN.len_utf8()..];
        let parsed = after.find(CLOSE).and_then(|close| {
            let index = after[..close].parse::<usize>().ok().filter(|i| *i < count)?;
            Some((index, close))
        });
        match parsed {
            Some((index, close)) => {
                if open > 0 {
                    pieces.push(Piece::Text(&rest[..open]));
                }
                pieces.push(Piece::Note(index));
                rest = &after[close + CLOSE.len_utf8()..];
            }
            None => {
                pieces.push(Piece::Text(&rest[..open + OPEN.len_utf8()]));
                rest = after;
            }
        }
    }
    if !rest.is_empty() {
        pieces.push(Piece::Text(rest));
    }
    pieces
}

#[cfg(test)]
mod tests {
    use super::*;

    fn marker(n: usize) -> String {
        format!("{OPEN}{n}{CLOSE}")
    }

    #[test]
    fn stripping_markers_takes_their_digits_too() {
        let text = format!("a{}b{} 12 {OPEN}x{CLOSE}c{OPEN}7", marker(0), marker(12));
        assert_eq!(strip_markers(&text), "ab 12 xc7");
        assert_eq!(strip_markers("plain 3"), "plain 3");
    }

    #[test]
    fn definitions_leave_the_text_and_references_become_markers() {
        let mut texts = vec![
            "A claim[^a] and another[^b], and a stray[^zz].".to_owned(),
            "[^b]: Second *note*,\n    over two lines.\n[^a]: First note.\n\nAfter.".to_owned(),
        ];
        let notes = extract(&mut texts);
        assert_eq!(notes, ["Second *note*, over two lines.", "First note."]);
        assert_eq!(
            texts[0],
            format!("A claim{} and another{}, and a stray[^zz].", marker(1), marker(0))
        );
        assert_eq!(texts[1], "\nAfter.");
    }

    #[test]
    fn code_is_left_alone_and_forged_markers_are_removed() {
        let mut texts = vec![format!(
            "`x[^a]` and ```y[^a]``` and {OPEN}0{CLOSE} then[^a]\n```\n[^a]\n```\n[^a]: Note."
        )];
        let notes = extract(&mut texts);
        assert_eq!(notes, ["Note."]);
        assert_eq!(
            texts[0],
            format!("`x[^a]` and ```y[^a]``` and 0 then{}\n```\n[^a]\n```", marker(0))
        );
    }

    #[test]
    fn pieces_split_around_markers_and_ignore_bad_numbers() {
        let text = format!("one{}two{}{}three", marker(0), marker(7), marker(1));
        let bad = format!("two{OPEN}");
        let tail = format!("7{CLOSE}");
        assert_eq!(
            split_markers(&text, 2),
            [
                Piece::Text("one"),
                Piece::Note(0),
                Piece::Text(&bad),
                Piece::Text(&tail),
                Piece::Note(1),
                Piece::Text("three"),
            ]
        );
    }
}
