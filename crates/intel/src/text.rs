//! Plain-text helpers shared by read-aloud and summaries: sentences, words, and UTF-16 offsets.
//!
//! Offsets that leave the crate count UTF-16 code units, because the interface is JavaScript and its
//! strings index that way. Inside the crate, ranges are byte offsets into the `&str`.

use std::ops::Range;

use serde::{Deserialize, Serialize};

/// A stretch of text as UTF-16 code unit offsets, which are the indexes of a JavaScript string.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Span {
    /// Where the stretch starts.
    pub start: usize,
    /// Where it ends, not included.
    pub end: usize,
}

/// Converts byte offsets into UTF-16 offsets for one text, in a single pass however many are asked.
pub fn utf16_spans(text: &str, ranges: &[Range<usize>]) -> Vec<Span> {
    let mut edges: Vec<(usize, usize)> = ranges
        .iter()
        .enumerate()
        .flat_map(|(i, r)| [(r.start, 2 * i), (r.end, 2 * i + 1)])
        .collect();
    edges.sort_unstable();
    let mut out = vec![0_usize; edges.len()];
    let (mut byte, mut units) = (0, 0);
    let mut chars = text.chars();
    for (target, slot) in edges {
        while byte < target {
            let Some(c) = chars.next() else { break };
            byte += c.len_utf8();
            units += c.len_utf16();
        }
        out[slot] = units;
    }
    out.as_chunks::<2>()
        .0
        .iter()
        .map(|pair| Span {
            start: pair[0],
            end: pair[1],
        })
        .collect()
}

fn is_terminator(c: char) -> bool {
    matches!(c, '.' | '!' | '?' | '…' | '。' | '！' | '？' | '؟' | '।' | '؛')
}

fn is_closer(c: char) -> bool {
    matches!(c, '"' | '\'' | '”' | '’' | ')' | ']' | '}' | '»' | '」' | '』' | '）')
}

/// Words after which a period does not end a sentence, in lowercase, without the period.
const NEVER_ENDS: &[&str] = &[
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "mt", "vs", "fig", "figs", "eq", "eqs", "cf", "e.g", "i.e",
    "no", "vol", "ch", "sec", "pp", "al", "approx", "ca", "inc", "ltd", "co", "dept", "est", "ex", "gen", "gov", "rev",
    "sen", "rep",
];

/// The line starts a list item: a bullet, or a number followed by a period or a parenthesis.
pub fn bullet_len(line: &str) -> usize {
    let mut chars = line.char_indices();
    match chars.next() {
        Some((_, '-' | '*' | '+' | '•' | '–' | '·' | '▪' | '☐' | '☑')) => {
            let rest = &line[line.chars().next().map_or(0, char::len_utf8)..];
            if rest.starts_with(char::is_whitespace) {
                return line.len() - rest.trim_start().len();
            }
            0
        }
        Some((_, c)) if c.is_ascii_digit() => {
            let digits = line.bytes().take_while(u8::is_ascii_digit).count();
            let rest = &line[digits..];
            let marker = rest.starts_with(['.', ')']);
            if digits <= 3 && marker && rest[1..].starts_with(char::is_whitespace) {
                line.len() - rest[1..].trim_start().len()
            } else {
                0
            }
        }
        _ => 0,
    }
}

/// Splits text into sentences and returns their byte ranges, trimmed, with list markers left out.
///
/// Notes are line-oriented, so a line break ends a sentence, with one exception. A line that stops
/// without punctuation and is followed by a line starting in lowercase is a wrapped sentence. A blank
/// line, a list item, and a line starting with a capital always start a new sentence.
pub fn split_sentences(text: &str) -> Vec<Range<usize>> {
    let mut out = Vec::new();
    let mut start = 0;
    let bytes = text.as_bytes();
    let mut iter = text.char_indices().peekable();
    while let Some((i, c)) = iter.next() {
        let end_after = i + c.len_utf8();
        let boundary = if c == '\n' {
            newline_ends_sentence(text, start, i)
        } else if is_terminator(c) {
            // Closing quotes and brackets belong to the sentence, and a run of "?!" is one stop.
            let mut after = end_after;
            while let Some(&(j, n)) = iter.peek() {
                if is_terminator(n) || is_closer(n) {
                    after = j + n.len_utf8();
                    iter.next();
                } else {
                    break;
                }
            }
            let cjk = matches!(c, '。' | '！' | '？');
            let spaced = after >= bytes.len() || text[after..].starts_with(char::is_whitespace);
            if (cjk || spaced) && period_ends_sentence(text, start, i, after, c) {
                push(&mut out, text, start..after);
                start = after;
            }
            false
        } else {
            false
        };
        if boundary {
            push(&mut out, text, start..i);
            start = end_after;
        }
    }
    push(&mut out, text, start..text.len());
    out
}

fn push(out: &mut Vec<Range<usize>>, text: &str, range: Range<usize>) {
    let slice = &text[range.clone()];
    let trimmed = slice.trim();
    if !trimmed.chars().any(char::is_alphanumeric) {
        return;
    }
    let lead = slice.len() - slice.trim_start().len();
    let start = range.start + lead;
    let marker = bullet_len(&text[start..range.start + lead + trimmed.len()]);
    let start = start + marker;
    let end = range.start + lead + trimmed.len();
    if start < end && text[start..end].chars().any(char::is_alphanumeric) {
        out.push(start..end);
    }
}

fn newline_ends_sentence(text: &str, start: usize, newline: usize) -> bool {
    let before = text[start..newline].trim_end();
    let after = text[newline + 1..].trim_start_matches([' ', '\t', '\r']);
    if after.starts_with('\n') || before.is_empty() {
        return true;
    }
    let after = after.trim_start_matches('\n');
    if bullet_len(after) > 0 {
        return true;
    }
    let last = before.chars().next_back().unwrap_or(' ');
    let wrapped = !is_terminator(last) && !is_closer(last) && last != ':' && after.starts_with(char::is_lowercase);
    !wrapped
}

/// Whether the terminator at byte `at` really ends a sentence. `[start, after)` is the sentence so far.
fn period_ends_sentence(text: &str, start: usize, at: usize, after: usize, terminator: char) -> bool {
    if terminator != '.' {
        return true;
    }
    let before = &text[start..at];
    let word = before.rsplit(char::is_whitespace).next().unwrap_or("");
    let lower = word.trim_start_matches(['(', '[', '"', '\'', '“']).to_lowercase();
    // "3." and "12." at the start of a line are list numbers, but a number ending a sentence still ends it.
    if lower.chars().all(|c| c.is_ascii_digit()) && !lower.is_empty() && before.trim() == word {
        return false;
    }
    let single_initial = lower.chars().count() == 1 && word.chars().all(char::is_uppercase);
    if single_initial || NEVER_ENDS.contains(&lower.as_str()) {
        return false;
    }
    // A lowercase letter after the period means the sentence goes on ("approx. five").
    let next = text[after..].trim_start();
    !next.starts_with(char::is_lowercase)
}

/// One word of the text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Word {
    /// Where the word sits, in bytes.
    pub range: Range<usize>,
    /// The word in lowercase.
    pub lower: String,
    /// The word starts a sentence or a line.
    pub sentence_start: bool,
    /// Punctuation or a line break separates this word from the one before it.
    pub breaks_before: bool,
}

fn is_word_char(c: char) -> bool {
    c.is_alphanumeric()
}

/// Whether the character is Chinese, Japanese, or Korean, which are written without spaces between words.
pub(crate) fn is_cjk(c: char) -> bool {
    matches!(c as u32, 0x3040..=0x30ff | 0x3400..=0x4dbf | 0x4e00..=0x9fff | 0xf900..=0xfaff | 0xac00..=0xd7af)
}

/// Splits text into lowercase words. Letters and digits make words, and an apostrophe between letters
/// stays inside one ("don't"). Each Chinese, Japanese, or Korean character is a word of its own, because
/// those scripts have no spaces to split on.
pub fn words(text: &str) -> Vec<Word> {
    let mut out: Vec<Word> = Vec::new();
    let mut iter = text.char_indices().peekable();
    let mut gap_start = 0;
    let mut at_sentence_start = true;
    while let Some((i, c)) = iter.next() {
        if !is_word_char(c) {
            continue;
        }
        let gap = &text[gap_start..i];
        if gap.chars().any(is_terminator) || gap.contains('\n') {
            at_sentence_start = true;
        }
        let breaks_before = out.is_empty()
            || gap
                .chars()
                .any(|g| !(g.is_whitespace() && g != '\n') && !matches!(g, '-' | '\'' | '’' | '/' | '–'))
            || gap.contains('\n');
        let mut end = i + c.len_utf8();
        if !is_cjk(c) {
            while let Some(&(j, n)) = iter.peek() {
                let inner_mark = matches!(n, '\'' | '’')
                    && text[j + n.len_utf8()..].chars().next().is_some_and(is_word_char)
                    && text[..j].chars().next_back().is_some_and(is_word_char);
                if (is_word_char(n) && !is_cjk(n)) || inner_mark {
                    end = j + n.len_utf8();
                    iter.next();
                } else {
                    break;
                }
            }
        }
        out.push(Word {
            range: i..end,
            lower: text[i..end].to_lowercase().replace('’', "'"),
            sentence_start: at_sentence_start,
            breaks_before,
        });
        at_sentence_start = false;
        gap_start = end;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sentences(text: &str) -> Vec<&str> {
        split_sentences(text).into_iter().map(|r| &text[r]).collect()
    }

    #[test]
    fn splits_on_terminators_and_keeps_closing_quotes() {
        assert_eq!(
            sentences("It works. Does it? \"Yes!\" He left (quickly). Done"),
            ["It works.", "Does it?", "\"Yes!\"", "He left (quickly).", "Done"]
        );
        assert_eq!(sentences("Wait... what?! Fine."), ["Wait... what?!", "Fine."]);
    }

    #[test]
    fn abbreviations_decimals_and_initials_do_not_end_sentences() {
        assert_eq!(
            sentences("Dr. Smith paid $3.50 for it, e.g. a pen. J. K. Rowling agrees. See Fig. 2 for more."),
            [
                "Dr. Smith paid $3.50 for it, e.g. a pen.",
                "J. K. Rowling agrees.",
                "See Fig. 2 for more."
            ]
        );
        assert_eq!(
            sentences("It cost approx. five dollars. Ok."),
            ["It cost approx. five dollars.", "Ok."]
        );
        assert_eq!(
            sentences("Visit example.com today. Bye."),
            ["Visit example.com today.", "Bye."]
        );
    }

    #[test]
    fn lines_are_sentences_unless_a_line_was_wrapped() {
        assert_eq!(
            sentences("Heading\nFirst point\nsecond half of it.\n\nNew paragraph here"),
            ["Heading", "First point\nsecond half of it.", "New paragraph here"]
        );
    }

    #[test]
    fn list_markers_are_dropped_and_each_item_stands_alone() {
        assert_eq!(
            sentences("Todo:\n- buy milk\n* call mom\n1. first thing\n2) second thing\n12. twelve"),
            ["Todo:", "buy milk", "call mom", "first thing", "second thing", "twelve"]
        );
        // A bullet needs a space after it, so a minus sign stays.
        assert_eq!(sentences("-5 degrees"), ["-5 degrees"]);
    }

    #[test]
    fn east_asian_stops_end_sentences_without_a_space() {
        assert_eq!(
            sentences("今日は晴れです。明日は雨？はい！"),
            ["今日は晴れです。", "明日は雨？", "はい！"]
        );
    }

    #[test]
    fn text_with_no_letters_has_no_sentences() {
        assert!(sentences("  \n ... \n -- ").is_empty());
        assert!(sentences("").is_empty());
    }

    #[test]
    fn utf16_spans_count_code_units_not_bytes() {
        let text = "é😀 ok. Next";
        let ranges = split_sentences(text);
        let spans = utf16_spans(text, &ranges);
        // "é" is one unit, the emoji is two, so "ok." starts at 4 and ends at 7.
        assert_eq!(spans[0], Span { start: 0, end: 7 });
        assert_eq!(spans[1], Span { start: 8, end: 12 });
    }

    #[test]
    fn words_keep_apostrophes_and_flag_breaks() {
        let list = words("Don't stop, state-of-the-art. Next one");
        let lower: Vec<&str> = list.iter().map(|w| w.lower.as_str()).collect();
        assert_eq!(lower, ["don't", "stop", "state", "of", "the", "art", "next", "one"]);
        let breaks: Vec<bool> = list.iter().map(|w| w.breaks_before).collect();
        assert_eq!(breaks, [true, false, true, false, false, false, true, false]);
        let starts: Vec<&str> = list
            .iter()
            .filter(|w| w.sentence_start)
            .map(|w| w.lower.as_str())
            .collect();
        assert_eq!(starts, ["don't", "next"]);
    }

    #[test]
    fn each_cjk_character_is_a_word() {
        assert_eq!(words("今日は").len(), 3);
    }
}
