//! Splitting a paragraph into text, code, breaks, raw tags, delimiter runs, and link brackets.

use std::collections::HashMap;

use unicode_properties::{GeneralCategoryGroup, UnicodeGeneralCategory};

use super::links::{footnote, link_destination, raw_tag, Destinations};
use super::*;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Class {
    Space,
    Punct,
    Other,
}

pub(super) fn is_white_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{0b}' | '\u{0c}' | '\r' | ' ' | '\u{85}' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}' | '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}'
    )
}

pub(super) fn class(c: Option<char>) -> Class {
    match c {
        None => Class::Space,
        Some(c) if is_white_space(c) => Class::Space,
        Some(c)
            if c.is_ascii_punctuation()
                || matches!(
                    c.general_category_group(),
                    GeneralCategoryGroup::Punctuation | GeneralCategoryGroup::Symbol
                ) =>
        {
            Class::Punct
        }
        Some(_) => Class::Other,
    }
}

pub(super) fn flanking(prev: Option<char>, next: Option<char>) -> (bool, bool) {
    let (before, after) = (class(prev), class(next));
    let left = after != Class::Space && (after != Class::Punct || before != Class::Other);
    let right = before != Class::Space && (before != Class::Punct || after != Class::Other);
    (left, right)
}

pub(super) fn starts_nothing(c: char) -> bool {
    !matches!(c, '\\' | '&' | '`' | '<' | '[' | ']' | '*' | '~' | '=')
}

pub(super) fn run_length(text: &[char], at: usize, c: char) -> usize {
    text.get(at..)
        .map_or(0, |rest| rest.iter().take_while(|x| **x == c).count())
}

/// Collects text and events, joining text into one event per run.
#[derive(Default)]
pub(super) struct Events {
    events: Vec<Ev>,
    pending: String,
}

impl Events {
    fn push(&mut self, event: Ev) {
        if !self.pending.is_empty() {
            self.events.push(Ev::Text(std::mem::take(&mut self.pending)));
        }
        self.events.push(event);
    }
}

/// Flat events: text, breaks, code, footnotes, raw tags, delimiter runs, and link brackets.
pub(super) fn tokenize(text: &[char]) -> Vec<Ev> {
    let mut out = Events::default();
    let mut brackets: Vec<usize> = Vec::new();
    let mut runs: Option<HashMap<usize, Vec<usize>>> = None;
    let mut dests: Option<Destinations> = None;
    let mut i = 0;
    while let Some(c) = char_at(text, i) {
        let next = char_at(text, plus(i, 1));
        if starts_nothing(c) {
            out.pending.push(c);
            i = plus(i, 1);
        } else if matches!(c, '*' | '~' | '=') {
            let run = run_length(text, i, c);
            let prev = i.checked_sub(1).and_then(|p| char_at(text, p));
            let after = char_at(text, plus(i, run));
            let (mut left, mut right) = flanking(prev, after);
            if c == '=' {
                (left, right) = (class(after) != Class::Space, class(prev) != Class::Space);
            }
            out.push(Ev::Delim(Delim {
                ch: c,
                left: run,
                can_open: left,
                can_close: right,
                run,
                pairs: Vec::new(),
            }));
            i = plus(i, run.max(1));
        } else if c == '\\' && next == Some('\n') {
            out.push(Ev::Break);
            i = plus(i, 2);
        } else if c == '\\' && next.is_some_and(|n| n.is_ascii_punctuation()) {
            out.pending.extend(next);
            i = plus(i, 2);
        } else if c == '&' {
            match entity(text, i) {
                Some((decoded, end)) => {
                    out.pending.push(decoded);
                    i = end;
                }
                None => {
                    out.pending.push(c);
                    i = plus(i, 1);
                }
            }
        } else if c == '`' {
            let runs = runs.get_or_insert_with(|| backtick_runs(text));
            match code_span(text, i, runs) {
                Some((body, end)) => {
                    out.push(Ev::Code(body));
                    i = end;
                }
                None => {
                    let run = run_length(text, i, '`').max(1);
                    out.pending.extend(std::iter::repeat_n('`', run));
                    i = plus(i, run);
                }
            }
        } else if let Some(end) = (c == '<').then(|| raw_tag(text, i)).flatten() {
            out.push(Ev::Html(slice(text, i, end).iter().collect()));
            i = end;
        } else if let Some(end) = (c == '[').then(|| footnote(text, i)).flatten() {
            out.push(Ev::Footnote);
            i = end;
        } else if c == '[' {
            out.push(Ev::LBracket);
            brackets.push(out.events.len().saturating_sub(1));
            i = plus(i, 1);
        } else if c == ']' && !brackets.is_empty() && next == Some('(') {
            let dests = dests.get_or_insert_with(|| Destinations::new(text));
            match link_destination(text, plus(i, 1), dests) {
                Some(end) => {
                    if let Some(opener) = brackets.pop().and_then(|at| out.events.get_mut(at)) {
                        *opener = Ev::LinkOpen;
                    }
                    out.push(Ev::LinkClose);
                    i = end;
                }
                None => {
                    out.pending.push(c);
                    i = plus(i, 1);
                }
            }
        } else {
            out.pending.push(c);
            i = plus(i, 1);
        }
    }
    let Events { mut events, pending } = out;
    if !pending.is_empty() {
        events.push(Ev::Text(pending));
    }
    for at in brackets {
        if let Some(event) = events.get_mut(at) {
            *event = Ev::Text("[".to_owned());
        }
    }
    events
}

/// A numeric character reference at `at` (CommonMark 6.2), decoded, and where it ends. Named references stay
/// text: stamping needs only the readable text's first character, which `&equals;` alone could change.
pub(super) fn entity(text: &[char], at: usize) -> Option<(char, usize)> {
    if char_at(text, plus(at, 1)) != Some('#') {
        return None;
    }
    let hex = matches!(char_at(text, plus(at, 2)), Some('x' | 'X'));
    let start = plus(at, if hex { 3 } else { 2 });
    let max = if hex { 6 } else { 7 };
    let digits = text
        .get(start..)?
        .iter()
        .take_while(|c| if hex { c.is_ascii_hexdigit() } else { c.is_ascii_digit() })
        .count();
    let end = plus(start, digits);
    if digits == 0 || digits > max || char_at(text, end) != Some(';') {
        return None;
    }
    let body: String = slice(text, start, end).iter().collect();
    let code = u32::from_str_radix(&body, if hex { 16 } else { 10 }).ok()?;
    let decoded = if code == 0 { None } else { char::from_u32(code) };
    Some((decoded.unwrap_or('\u{fffd}'), plus(end, 1)))
}

/// Where each whole run of backticks starts, by its length.
pub(super) fn backtick_runs(text: &[char]) -> HashMap<usize, Vec<usize>> {
    let mut runs: HashMap<usize, Vec<usize>> = HashMap::new();
    let mut i = 0;
    while let Some(c) = char_at(text, i) {
        if c == '`' {
            let run = run_length(text, i, '`').max(1);
            runs.entry(run).or_default().push(i);
            i = plus(i, run);
        } else {
            i = plus(i, 1);
        }
    }
    runs
}

/// The code span whose opening run starts at `at`, closed by the next run of the same length (CommonMark 6.1).
pub(super) fn code_span(text: &[char], at: usize, runs: &HashMap<usize, Vec<usize>>) -> Option<(String, usize)> {
    let run = run_length(text, at, '`');
    let starts = runs.get(&run)?;
    let found = starts.partition_point(|s| *s < plus(at, run));
    let close = *starts.get(found)?;
    let body: Vec<char> = slice(text, plus(at, run), close)
        .iter()
        .map(|c| if *c == '\n' { ' ' } else { *c })
        .collect();
    let trimmed =
        body.len() >= 2 && body.first() == Some(&' ') && body.last() == Some(&' ') && body.iter().any(|c| *c != ' ');
    let body = if trimmed {
        body.get(1..body.len().saturating_sub(1)).unwrap_or_default()
    } else {
        &body[..]
    };
    Some((body.iter().collect(), plus(close, run)))
}
