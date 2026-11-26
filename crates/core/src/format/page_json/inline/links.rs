//! Footnote references, raw HTML tags, and link destinations, as CommonMark reads them.

use std::collections::HashMap;

use super::*;

/// A footnote reference `[^ID]` at `at` that no link destination follows (`R-FN-1`), and where it ends.
pub(super) fn footnote(text: &[char], at: usize) -> Option<usize> {
    if char_at(text, plus(at, 1)) != Some('^') {
        return None;
    }
    let id = text.get(plus(at, 2)..plus(at, 28))?;
    let (first, rest) = id.split_first()?;
    let valid = matches!(first, '0'..='7')
        && rest
            .iter()
            .all(|c| matches!(c, '0'..='9' | 'a'..='h' | 'j' | 'k' | 'm' | 'n' | 'p'..='t' | 'v'..='z'));
    let end = plus(at, 28);
    (valid && char_at(text, end) == Some(']') && char_at(text, plus(end, 1)) != Some('(')).then_some(plus(end, 1))
}

/// A raw HTML opening or closing tag at `at` (CommonMark 6.6), and where it ends. A tag that is not in the
/// reserved grammar is still one piece of literal text.
pub(super) fn raw_tag(text: &[char], at: usize) -> Option<usize> {
    let c = |i: usize| char_at(text, i);
    let name_end = |mut i: usize| {
        if !c(i).is_some_and(|x| x.is_ascii_alphabetic()) {
            return None;
        }
        while c(i).is_some_and(|x| x.is_ascii_alphanumeric() || x == '-') {
            i = plus(i, 1);
        }
        Some(i)
    };
    let spaces = |mut i: usize| {
        while c(i).is_some_and(char::is_whitespace) {
            i = plus(i, 1);
        }
        i
    };
    if c(plus(at, 1)) == Some('/') {
        let i = spaces(name_end(plus(at, 2))?);
        return (c(i) == Some('>')).then_some(plus(i, 1));
    }
    let mut i = name_end(plus(at, 1))?;
    loop {
        let after_space = spaces(i);
        let starts_name = c(after_space).is_some_and(|x| x.is_ascii_alphabetic() || x == '_' || x == ':');
        if after_space == i || !starts_name {
            break;
        }
        let mut j = plus(after_space, 1);
        while c(j).is_some_and(|x| x.is_ascii_alphanumeric() || matches!(x, '_' | '.' | ':' | '-')) {
            j = plus(j, 1);
        }
        i = attribute_value(text, j).unwrap_or(j);
    }
    let i = spaces(i);
    let i = if c(i) == Some('/') { plus(i, 1) } else { i };
    (c(i) == Some('>')).then_some(plus(i, 1))
}

/// The end of `\s*=\s*value` at `at`, where the value is unquoted, single-quoted, or double-quoted.
pub(super) fn attribute_value(text: &[char], at: usize) -> Option<usize> {
    let c = |i: usize| char_at(text, i);
    let mut i = at;
    while c(i).is_some_and(char::is_whitespace) {
        i = plus(i, 1);
    }
    if c(i) != Some('=') {
        return None;
    }
    i = plus(i, 1);
    while c(i).is_some_and(char::is_whitespace) {
        i = plus(i, 1);
    }
    match c(i)? {
        quote @ ('"' | '\'') => {
            let close = text.get(plus(i, 1)..)?.iter().position(|x| *x == quote)?;
            Some(plus(plus(i, 1), plus(close, 1)))
        }
        _ => {
            let start = i;
            while c(i).is_some_and(|x| !x.is_whitespace() && !matches!(x, '"' | '\'' | '=' | '<' | '>' | '`')) {
                i = plus(i, 1);
            }
            (i > start).then_some(i)
        }
    }
}

/// The end of the link `](...)` whose `(` is at `at`.
pub(super) fn link_destination(text: &[char], at: usize, dests: &Destinations) -> Option<usize> {
    let mut i = plus(at, 1);
    if char_at(text, i) == Some('<') {
        i = plus(i, 1);
        while let Some(c) = char_at(text, i) {
            if matches!(c, '<' | '>' | '\n') {
                break;
            }
            if c == '\\' && char_at(text, plus(i, 1)).is_some_and(|n| n.is_ascii_punctuation()) {
                i = plus(i, 1);
            }
            i = plus(i, 1);
        }
        let closed = char_at(text, i) == Some('>') && char_at(text, plus(i, 1)) == Some(')');
        return closed.then_some(plus(i, 2));
    }
    dests.close(i).map(|end| plus(end, 1))
}

/// Where each bare link destination of one text ends (CommonMark 6.3): at the first `)` outside its balanced
/// parentheses, unless a space or control comes first. Worked out once for the whole text.
pub(super) struct Destinations {
    parens: Vec<usize>,
    first: Vec<Option<usize>>,
    stops: Vec<usize>,
}

impl Destinations {
    pub(super) fn new(text: &[char]) -> Destinations {
        // (position, level before it, whether it closes)
        let mut parens: Vec<(usize, i64, bool)> = Vec::new();
        let mut level = 0i64;
        let mut i = 0;
        while let Some(c) = char_at(text, i) {
            if c == '\\' && char_at(text, plus(i, 1)).is_some_and(|n| n.is_ascii_punctuation()) {
                i = plus(i, 2);
                continue;
            }
            if matches!(c, '(' | ')') {
                parens.push((i, level, c == ')'));
                level = if c == '(' {
                    level.saturating_add(1)
                } else {
                    level.saturating_sub(1)
                };
            }
            i = plus(i, 1);
        }
        let mut first = vec![None; parens.len()];
        let mut later: HashMap<i64, usize> = HashMap::new();
        for (slot, (at, level, closes)) in first.iter_mut().zip(&parens).rev() {
            if *closes {
                later.insert(*level, *at);
            }
            *slot = later.get(level).copied();
        }
        let stops = text
            .iter()
            .enumerate()
            .filter(|(_, c)| {
                matches!(c, '\u{00}'..='\u{20}' | '\u{7f}'..='\u{a0}' | '\u{1680}' | '\u{2000}'..='\u{200a}')
                    || matches!(c, '\u{2028}' | '\u{2029}' | '\u{202f}' | '\u{205f}' | '\u{3000}')
            })
            .map(|(at, _)| at)
            .collect();
        Destinations {
            parens: parens.into_iter().map(|(at, _, _)| at).collect(),
            first,
            stops,
        }
    }

    fn close(&self, start: usize) -> Option<usize> {
        let e = self.parens.partition_point(|p| *p < start);
        let end = (*self.first.get(e)?)?;
        let stop = self.stops.partition_point(|s| *s < start);
        self.stops.get(stop).is_none_or(|s| *s > end).then_some(end)
    }
}
