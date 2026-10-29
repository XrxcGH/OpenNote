//! Reading the small set of HTML tags that OpenNote Markdown allows (spec 7.4), and dropping all others.

use super::{Marks, Script};

/// A piece of HTML: text, or one tag.
#[derive(Debug, PartialEq, Eq)]
pub enum Piece {
    /// Text, with character references decoded.
    Text(String),
    /// A tag, such as `<u>` or `</span>`.
    Tag(Tag),
}

/// One tag.
#[derive(Debug, PartialEq, Eq)]
pub struct Tag {
    /// The lowercase name.
    pub name: String,
    /// Whether it closes.
    pub closing: bool,
    /// The value of `data-color`, `color`, or `src`, whichever the tag has: only one matters for each name.
    pub attrs: Vec<(String, String)>,
}

impl Tag {
    /// The value of an attribute.
    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attrs
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.as_str())
    }
}

/// Splits HTML into text and tags. Comments are dropped.
pub fn tokenize(html: &str) -> Vec<Piece> {
    let mut pieces = Vec::new();
    let mut rest = html;
    let mut next_gt = NextGt::default();
    while let Some(start) = rest.find('<') {
        let (text, from_tag) = rest.split_at(start);
        push_text(&mut pieces, text);
        if let Some(after) = from_tag.strip_prefix("<!--") {
            rest = after.find("-->").map_or("", |end| &after[end + 3..]);
            continue;
        }
        match next_gt
            .after(html, html.len() - from_tag.len())
            .and_then(|end| parse_tag(&from_tag[1..end]).map(|tag| (tag, end)))
        {
            Some((tag, end)) => {
                pieces.push(Piece::Tag(tag));
                rest = &from_tag[end + 1..];
            }
            None => {
                push_text(&mut pieces, "<");
                rest = &from_tag[1..];
            }
        }
    }
    push_text(&mut pieces, rest);
    pieces
}

/// The next `>` of a text, remembered between calls. A run of `<` that are not tags all end at the same `>`, so
/// the text is searched once for it, not once for each `<`.
#[derive(Default)]
struct NextGt {
    /// The position of the `>` found by the last search, or `None` when no `>` was left.
    found: Option<Option<usize>>,
}

impl NextGt {
    /// The distance from `from` to the next `>` after it. The positions asked for must not go back.
    fn after(&mut self, text: &str, from: usize) -> Option<usize> {
        let at = match self.found {
            Some(Some(at)) if at > from => Some(at),
            Some(None) => None,
            _ => text.get(from..)?.find('>').map(|end| from + end),
        };
        self.found = Some(at);
        at.map(|at| at - from)
    }
}

fn push_text(pieces: &mut Vec<Piece>, text: &str) {
    if !text.is_empty() {
        pieces.push(Piece::Text(decode_entities(text)));
    }
}

/// Reads the inside of a tag. It looks at the name first, so text that is not a tag costs only its first few
/// characters, however long the rest is.
fn parse_tag(inner: &str) -> Option<Tag> {
    let inner = inner.trim_start();
    let (closing, inner) = match inner.strip_prefix('/') {
        Some(rest) => (true, rest),
        None => (false, inner),
    };
    let name_len = inner
        .find(|c: char| !(c.is_ascii_alphanumeric() || c == '-'))
        .unwrap_or(inner.len());
    let name = inner[..name_len].to_lowercase();
    if name.is_empty() || !name.starts_with(|c: char| c.is_ascii_alphabetic()) {
        return None;
    }
    let attrs = inner[name_len..].trim_end().trim_end_matches('/');
    Some(Tag {
        name,
        closing,
        attrs: parse_attrs(attrs),
    })
}

fn parse_attrs(mut rest: &str) -> Vec<(String, String)> {
    let mut attrs = Vec::new();
    loop {
        rest = rest.trim_start();
        let key_len = rest.find(|c: char| c == '=' || c.is_whitespace()).unwrap_or(rest.len());
        if key_len == 0 {
            return attrs;
        }
        let key = rest[..key_len].to_lowercase();
        rest = rest[key_len..].trim_start();
        let Some(after_eq) = rest.strip_prefix('=') else {
            attrs.push((key, String::new()));
            continue;
        };
        let after_eq = after_eq.trim_start();
        let quote = after_eq.chars().next().filter(|c| *c == '"' || *c == '\'');
        let (value, tail) = match quote {
            Some(q) => {
                let body = &after_eq[1..];
                let end = body.find(q).unwrap_or(body.len());
                (&body[..end], body.get(end + 1..).unwrap_or(""))
            }
            None => after_eq.split_at(after_eq.find(char::is_whitespace).unwrap_or(after_eq.len())),
        };
        attrs.push((key, decode_entities(value)));
        rest = tail;
    }
}

/// Decodes `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`, `&nbsp;`, and numeric references. Others stay as written.
pub fn decode_entities(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        let decoded = rest
            .find(';')
            .filter(|end| *end <= 10)
            .and_then(|end| Some((entity(&rest[1..end])?, end)));
        match decoded {
            Some((c, end)) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// The other named references that Word, OneNote, and browsers write, as `name=character` pairs.
const NAMED_ENTITIES: &str = "lsquo=\u{2018},rsquo=\u{2019},ldquo=\u{201c},rdquo=\u{201d},sbquo=\u{201a},\
bdquo=\u{201e},ndash=\u{2013},mdash=\u{2014},hellip=\u{2026},bull=\u{2022},middot=\u{b7},copy=\u{a9},\
reg=\u{ae},trade=\u{2122},deg=\u{b0},plusmn=\u{b1},times=\u{d7},divide=\u{f7},laquo=\u{ab},raquo=\u{bb},\
euro=\u{20ac},pound=\u{a3},yen=\u{a5},cent=\u{a2},sect=\u{a7},para=\u{b6},larr=\u{2190},rarr=\u{2192},\
uarr=\u{2191},darr=\u{2193},harr=\u{2194},ne=\u{2260},le=\u{2264},ge=\u{2265},infin=\u{221e},\
frac12=\u{bd},frac14=\u{bc},frac34=\u{be},sup2=\u{b2},sup3=\u{b3},micro=\u{b5},iexcl=\u{a1},\
iquest=\u{bf},eacute=\u{e9},egrave=\u{e8},agrave=\u{e0},aacute=\u{e1},uuml=\u{fc},ouml=\u{f6},auml=\u{e4},\
ntilde=\u{f1},ccedil=\u{e7},szlig=\u{df},ensp=\u{2002},emsp=\u{2003},thinsp=\u{2009},zwnj=\u{200c},\
zwj=\u{200d},shy=\u{ad}";

fn entity(name: &str) -> Option<char> {
    match name {
        "amp" => Some('&'),
        "lt" => Some('<'),
        "gt" => Some('>'),
        "quot" => Some('"'),
        "apos" => Some('\''),
        "nbsp" => Some('\u{a0}'),
        named if !named.starts_with('#') => NAMED_ENTITIES
            .split(',')
            .filter_map(|pair| pair.split_once('='))
            .find(|(key, _)| *key == named)
            .and_then(|(_, value)| value.chars().next()),
        _ => {
            let digits = name.strip_prefix('#')?;
            let code = match digits.strip_prefix(['x', 'X']) {
                Some(hex) => u32::from_str_radix(hex, 16).ok()?,
                None => digits.parse().ok()?,
            };
            char::from_u32(code)
        }
    }
}

/// What an open `<span>` stands for, so its closing tag ends the right mark.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Span {
    /// A text color.
    Color,
    /// A text size.
    Size,
    /// A span with no meaning here.
    Other,
}

/// What a tag does to the marks of the text after it. Returns `false` for a tag that has no meaning here.
pub fn apply_tag(tag: &Tag, marks: &mut Marks, spans: &mut Vec<Span>) -> bool {
    let on = !tag.closing;
    match tag.name.as_str() {
        "u" | "ins" => marks.underline = on,
        "strong" | "b" => marks.strong = on,
        "em" | "i" => marks.emphasis = on,
        "del" | "s" | "strike" => marks.strike = on,
        "sub" => marks.script = on.then_some(Script::Sub),
        "sup" => marks.script = on.then_some(Script::Sup),
        "mark" if !on => marks.highlight = None,
        "mark" => match tag.attr("data-color").map_or(Some("honey".to_owned()), mark_name) {
            Some(name) => marks.highlight = Some(name),
            None => return false,
        },
        "span" => return apply_span(tag, marks, spans),
        "code" | "kbd" | "tt" => marks.code = on,
        _ => return false,
    }
    true
}

fn apply_span(tag: &Tag, marks: &mut Marks, spans: &mut Vec<Span>) -> bool {
    if tag.closing {
        match spans.pop() {
            Some(Span::Color) => marks.color = None,
            Some(Span::Size) => marks.size = None,
            _ => {}
        }
        return true;
    }
    if let Some(color) = tag.attr("data-color").and_then(mark_name) {
        marks.color = Some(color);
        spans.push(Span::Color);
        true
    } else if let Some(size) = tag.attr("data-size").and_then(mark_name) {
        marks.size = Some(size);
        spans.push(Span::Size);
        true
    } else {
        spans.push(Span::Other);
        false
    }
}

/// A highlighter, color, or size name from a `data-color` or `data-size` attribute, or `None` when it is not one.
/// A name is 1 to 32 of `a-z`, `0-9`, and `-`, or a `#rrggbb` color, so it can never close the tag it is written
/// into. Case is ignored.
pub fn mark_name(value: &str) -> Option<String> {
    let name = value.trim().to_ascii_lowercase();
    let is_word = (1..=32).contains(&name.len())
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    let is_hex = name
        .strip_prefix('#')
        .is_some_and(|hex| hex.len() == 6 && hex.bytes().all(|b| b.is_ascii_hexdigit()));
    (is_word || is_hex).then_some(name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_full_of_brackets_is_split_in_one_pass() {
        let started = std::time::Instant::now();
        for html in [
            "<".repeat(100_000),
            format!("{}>", "<".repeat(100_000)),
            format!("{}>", "< ".repeat(50_000)),
            format!("{}>", "<a ".repeat(30_000)),
        ] {
            let pieces = tokenize(&html);
            assert!(!pieces.is_empty());
        }
        assert!(
            started.elapsed() < std::time::Duration::from_secs(3),
            "{:?}",
            started.elapsed()
        );
        let tags = tokenize("a <br/> <span data-color=\"mint\" >c</span >");
        let names: Vec<_> = tags
            .iter()
            .filter_map(|p| match p {
                Piece::Tag(tag) => Some((tag.name.as_str(), tag.closing, tag.attr("data-color"))),
                Piece::Text(_) => None,
            })
            .collect();
        assert_eq!(
            names,
            [("br", false, None), ("span", false, Some("mint")), ("span", true, None)]
        );
    }

    #[test]
    fn only_short_safe_names_are_marks() {
        assert_eq!(mark_name("Mint").as_deref(), Some("mint"));
        assert_eq!(mark_name("#2F4F9A").as_deref(), Some("#2f4f9a"));
        assert_eq!(mark_name("x\"><img src=\"https://example.org/p.png\">"), None);
        assert_eq!(mark_name(""), None);
        assert_eq!(mark_name("#12345"), None);
        assert_eq!(mark_name(&"a".repeat(33)), None);
    }
}
