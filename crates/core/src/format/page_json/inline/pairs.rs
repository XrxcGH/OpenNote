//! Pairing delimiter runs (`**`, `*`, `~~`, `==`) and tags into marks (`R-INL-6`, `R-INL-12`).

use std::collections::{HashMap, HashSet};

use super::super::values::{is_color, is_hex, is_number_text, Step, HIGHLIGHTERS_V1, PENS};
use super::*;

/// Most attributes in one tag (`R-INL-3`).
const MAX_ATTRS: usize = 8;
/// Most pairs of tags around one run (`R-INL-12`).
const MAX_DEPTH: usize = 32;
/// The names of tags in the reserved grammar (`R-INL-1`).
const NAMES: [&str; 6] = ["span", "u", "del", "mark", "ins", "s"];
/// The underline styles a tag names, besides `single` (Appendix D.5).
const UNDERLINES: [&str; 16] = [
    "double",
    "words",
    "thick",
    "dotted",
    "dottedHeavy",
    "dash",
    "dashedHeavy",
    "dashLong",
    "dashLongHeavy",
    "dotDash",
    "dashDotHeavy",
    "dotDotDash",
    "dashDotDotHeavy",
    "wave",
    "wavyHeavy",
    "wavyDouble",
];
/// The size names of version 1 (spec 7.4).
const SIZES_V1: [&str; 3] = ["small", "large", "xlarge"];

pub(super) fn delim(events: &[Ev], at: usize) -> Option<&Delim> {
    match events.get(at) {
        Some(Ev::Delim(d)) => Some(d),
        _ => None,
    }
}

pub(super) fn delim_mut(events: &mut [Ev], at: usize) -> Option<&mut Delim> {
    match events.get_mut(at) {
        Some(Ev::Delim(d)) => Some(d),
        _ => None,
    }
}

/// CommonMark's emphasis rule for `*`, and pairs of 2 for `~~` and `==`, in place. `bottom` keeps, for each
/// kind of closer, the event below which no opener can match it, so the pass is linear.
pub(super) fn process_delimiters(events: &mut [Ev]) {
    let mut stack: Vec<usize> = Vec::new();
    let mut bottom: HashMap<(char, usize, bool), usize> = HashMap::new();
    for index in 0..events.len() {
        let Some(closer) = delim(events, index) else {
            continue;
        };
        let (ch, can_open, can_close, run) = (closer.ch, closer.can_open, closer.can_close, closer.run);
        let key = if ch == '*' {
            (ch, run % 3, can_open)
        } else {
            (ch, 0, false)
        };
        loop {
            let left = delim(events, index).map_or(0, |d| d.left);
            if !can_close || left == 0 || (ch != '*' && left < 2) {
                break;
            }
            let floor = bottom.get(&key).copied().unwrap_or(0);
            let mut found = None;
            for (s, at) in stack.iter().enumerate().rev() {
                if *at < floor {
                    break;
                }
                let Some(opener) = delim(events, *at) else {
                    continue;
                };
                if opener.ch != ch || opener.left == 0 {
                    continue;
                }
                let sum = plus(opener.run, run);
                if ch == '*'
                    && (opener.can_close || can_open)
                    && sum.is_multiple_of(3)
                    && (!opener.run.is_multiple_of(3) || !run.is_multiple_of(3))
                {
                    continue;
                }
                if ch != '*' && (opener.left < 2 || left < 2) {
                    continue;
                }
                found = Some((s, *at));
                break;
            }
            let Some((s, opener_at)) = found else {
                bottom.insert(key, index);
                break;
            };
            let opener_left = delim(events, opener_at).map_or(0, |d| d.left);
            let used = if opener_left >= 2 && left >= 2 { 2 } else { 1 };
            let kind = match ch {
                '*' if used == 2 => Kind::Strong,
                '*' => Kind::Emphasis,
                '~' => Kind::Strike,
                _ => Kind::Highlight,
            };
            if let Some(opener) = delim_mut(events, opener_at) {
                opener.pairs.push((true, kind));
                opener.left = opener.left.saturating_sub(used);
            }
            if let Some(closer) = delim_mut(events, index) {
                closer.pairs.push((false, kind));
                closer.left = closer.left.saturating_sub(used);
            }
            stack.truncate(plus(s, 1));
        }
        if can_open && delim(events, index).is_some_and(|d| d.left > 0) {
            stack.push(index);
        }
    }
}

/// Turns paired delimiters into mark events, and the rest of each run into text.
pub(super) fn expand(events: Vec<Ev>) -> Vec<Ev> {
    let mut out = Vec::with_capacity(events.len());
    for event in events {
        let Ev::Delim(d) = event else {
            out.push(event);
            continue;
        };
        out.extend(
            d.pairs
                .iter()
                .filter(|(open, _)| !open)
                .map(|(_, kind)| Ev::MarkClose(*kind)),
        );
        if d.left > 0 {
            out.push(Ev::Text(std::iter::repeat_n(d.ch, d.left).collect()));
        }
        out.extend(
            d.pairs
                .iter()
                .rev()
                .filter(|(open, _)| *open)
                .map(|(_, kind)| Ev::MarkOpen(*kind)),
        );
    }
    out
}

/// The tags of version 1 without attributes (spec 7.4), by their exact text, with their names and marks.
pub(super) fn v1_tag(raw: &str) -> Option<(&'static str, Mark)> {
    let (name, kind) = match raw {
        "<u>" => ("u", Kind::Underline),
        "<sub>" => ("sub", Kind::Sub),
        "<sup>" => ("sup", Kind::Sub),
        "<em>" => ("em", Kind::Emphasis),
        "<strong>" => ("strong", Kind::Strong),
        "<del>" => ("del", Kind::Strike),
        "<mark>" => ("mark", Kind::Highlight),
        _ => return None,
    };
    Some((name, Mark::Of(kind, true)))
}

/// The name of a closing tag that can pair (`R-INL-6`).
pub(super) fn close_name(raw: &str) -> Option<&str> {
    let name = raw.strip_prefix("</")?.strip_suffix('>')?;
    (NAMES.contains(&name) || matches!(name, "sub" | "sup" | "em" | "strong")).then_some(name)
}

/// Pairs tags with a stack (`R-INL-6`): a closing tag closes the innermost open tag only when that tag has its
/// name. A pair inside more than 31 others is literal text (`R-INL-12`). Unpaired tags are literal text.
pub(super) fn pair_tags(events: &mut [Ev]) {
    let mut stack: Vec<(usize, String, Mark)> = Vec::new();
    let mut pairs: Vec<(usize, usize)> = Vec::new();
    for index in 0..events.len() {
        let Some(Ev::Html(raw)) = events.get(index) else {
            continue;
        };
        if let Some((name, mark)) = v1_tag(raw) {
            stack.push((index, name.to_owned(), mark));
        } else if let Some((name, attrs)) = parse_open_tag(raw) {
            let mark = classify(name, &attrs);
            stack.push((index, name.to_owned(), mark));
        } else if close_name(raw).is_some_and(|name| stack.last().is_some_and(|(_, open, _)| open == name)) {
            let Some((open_at, _, mark)) = stack.pop() else {
                continue;
            };
            let close_raw = raw.clone();
            if let Some(event) = events.get_mut(open_at) {
                if let Ev::Html(open_raw) = std::mem::replace(event, Ev::LBracket) {
                    *event = Ev::TagOpen(mark, open_raw);
                }
            }
            if let Some(event) = events.get_mut(index) {
                *event = Ev::TagClose(open_at, close_raw);
            }
            pairs.push((open_at, index));
        }
    }
    let close_of: HashMap<usize, usize> = pairs.iter().copied().collect();
    let closes: HashSet<usize> = pairs.iter().map(|(_, close)| *close).collect();
    let mut depth = 0usize;
    for index in 0..events.len() {
        if let Some(close) = close_of.get(&index) {
            depth = plus(depth, 1);
            if depth > MAX_DEPTH {
                for at in [index, *close] {
                    if let Some(event) = events.get_mut(at) {
                        if let Ev::TagOpen(_, raw) | Ev::TagClose(_, raw) = event {
                            *event = Ev::Html(std::mem::take(raw));
                        }
                    }
                }
            }
        } else if closes.contains(&index) {
            depth = depth.saturating_sub(1);
        }
    }
    for event in events.iter_mut() {
        if let Ev::Html(raw) = event {
            *event = Ev::Text(std::mem::take(raw));
        }
    }
}

/// The name and attributes of an opening tag in the reserved grammar (`R-INL-1` to `R-INL-4`), or `None`.
pub(super) fn parse_open_tag(raw: &str) -> Option<(&str, Vec<(&str, &str)>)> {
    if raw.chars().any(char::is_control) {
        return None;
    }
    let body = raw.strip_prefix('<')?.strip_suffix('>')?;
    let (name, mut rest) = body.split_once(' ')?;
    if !NAMES.contains(&name) {
        return None;
    }
    let mut attrs = Vec::new();
    loop {
        let (key, after) = rest.split_once("=\"")?;
        let valid_key = key == "lang"
            || key == "dir"
            || key.strip_prefix("data-").is_some_and(|k| {
                (1..=16).contains(&k.len())
                    && k.bytes()
                        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            });
        let (value, tail) = after.split_once('"')?;
        if !valid_key || value.chars().count() > 200 || value.contains(['<', '>', '&']) {
            return None;
        }
        attrs.push((key, value));
        if tail.is_empty() {
            break;
        }
        rest = tail.strip_prefix(' ')?;
    }
    let ordered = attrs.windows(2).all(|w| matches!(w, [a, b] if a.0 < b.0));
    (attrs.len() <= MAX_ATTRS && ordered).then_some((name, attrs))
}

/// What a tag of the grammar means to stamping (`R-INL-7`). Only the kinds with a version 1 form need their
/// values checked: any other tag, known, or foreign, needs version 2 whatever it holds.
pub(super) fn classify(name: &str, attrs: &[(&str, &str)]) -> Mark {
    let keys: Vec<&str> = attrs.iter().map(|(k, _)| *k).collect();
    let value = |key: &str| attrs.iter().find(|(k, _)| *k == key).map(|(_, v)| *v);
    let line = value("data-line");
    let line_color = value("data-line-color");
    let underline = |l: Option<&str>| l.is_some_and(|l| UNDERLINES.contains(&l));
    let color = |c: Option<&str>| c.is_some_and(is_color);
    let v2 = |kind| Mark::Of(kind, false);
    match (name, keys.as_slice()) {
        ("u", ["data-line"]) if underline(line) => v2(Kind::Underline),
        ("u", ["data-line", "data-line-color"]) if underline(line) && color(line_color) => v2(Kind::Underline),
        ("u", ["data-line-color"]) if color(line_color) => v2(Kind::Underline),
        ("del", ["data-line"]) if line == Some("double") => v2(Kind::Strike),
        ("mark", ["data-color"]) => match value("data-color") {
            Some(c) if is_color(c) && c != "honey" => Mark::Of(Kind::Highlight, HIGHLIGHTERS_V1.contains(&c)),
            _ => Mark::Always,
        },
        ("span", ["data-size"]) => match value("data-size") {
            Some(s) if SIZES_V1.contains(&s) => Mark::Of(Kind::Size, true),
            Some(s) if is_number_text(s, 1.0, 1638.0, Step::Half) => v2(Kind::Size),
            _ => Mark::Always,
        },
        ("span", ["data-color"]) => match value("data-color") {
            Some(c) if is_color(c) => Mark::Of(Kind::Color, PENS.contains(&c) || is_hex(c)),
            _ => Mark::Always,
        },
        _ => Mark::Always,
    }
}
