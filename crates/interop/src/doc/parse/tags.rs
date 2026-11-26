//! The reserved inline tag grammar of version 2 (spec 7.9) and the marks its tags name (spec 7.10).

use crate::doc::values::{self, BOXES, UNDERLINES};
use crate::doc::{Marks, Script};

/// The tag names of the grammar.
const NAMES: [&str; 6] = ["span", "u", "del", "mark", "ins", "s"];
/// The names a closing tag may have: the grammar's, and the version 1 tags without attributes.
const CLOSE_NAMES: [&str; 10] = ["span", "u", "del", "mark", "ins", "s", "sub", "sup", "em", "strong"];
/// At most this many attributes in one tag (`R-INL-1`).
const MAX_ATTRS: usize = 8;
/// At most this many characters in a value (`R-INL-2`).
const MAX_VALUE: usize = 200;
/// A pair inside this many other pairs is literal text (`R-INL-6`).
pub const MAX_DEPTH: usize = 32;

/// A mark that a tag, a delimiter, or a link sets. Each one has a kind, and a run carries the innermost value of
/// each kind (`R-MRK-28`), except comments and foreign marks, which stack.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Mark {
    Float(String),
    Link(String),
    Comment(String),
    Insertion(String),
    Deletion(String),
    FormatChange(String),
    Dir(String),
    Lang(String),
    CharStyle(String),
    Strong,
    Weight(String),
    Emphasis,
    Strike {
        double: bool,
    },
    Underline {
        line: Option<String>,
        color: Option<String>,
    },
    Highlight(String),
    Shade(String),
    Color(String),
    Font(String),
    Size(String),
    Caps(String),
    Tracking(String),
    Scale(String),
    Shift(String),
    Kern(String),
    Otf(String),
    Effect(String),
    TextBox {
        style: String,
        color: Option<String>,
    },
    Script(Script),
    Foreign(String),
}

/// The number of mark kinds, for [`Mark::kind`].
pub const KINDS: usize = 29;

impl Mark {
    /// The kind, as its place in the nesting order (`R-MRK-24`).
    pub fn kind(&self) -> usize {
        match self {
            Mark::Float(_) => 0,
            Mark::Link(_) => 1,
            Mark::Comment(_) => 2,
            Mark::Insertion(_) => 3,
            Mark::Deletion(_) => 4,
            Mark::FormatChange(_) => 5,
            Mark::Dir(_) => 6,
            Mark::Lang(_) => 7,
            Mark::CharStyle(_) => 8,
            Mark::Strong => 9,
            Mark::Weight(_) => 10,
            Mark::Emphasis => 11,
            Mark::Strike { .. } => 12,
            Mark::Underline { .. } => 13,
            Mark::Highlight(_) => 14,
            Mark::Shade(_) => 15,
            Mark::Color(_) => 16,
            Mark::Font(_) => 17,
            Mark::Size(_) => 18,
            Mark::Caps(_) => 19,
            Mark::Tracking(_) => 20,
            Mark::Scale(_) => 21,
            Mark::Shift(_) => 22,
            Mark::Kern(_) => 23,
            Mark::Otf(_) => 24,
            Mark::Effect(_) => 25,
            Mark::TextBox { .. } => 26,
            Mark::Script(_) => 27,
            Mark::Foreign(_) => 28,
        }
    }

    /// Whether several marks of this kind may cover the same text.
    pub fn stacks(&self) -> bool {
        matches!(self, Mark::Comment(_) | Mark::Foreign(_))
    }

    /// Sets the mark on `marks`.
    pub fn apply(&self, marks: &mut Marks) {
        let some = |v: &String| Some(v.clone());
        match self {
            Mark::Float(v) => marks.float = some(v),
            Mark::Link(v) => marks.link = some(v),
            Mark::Comment(v) => marks.comments.push(v.clone()),
            Mark::Insertion(v) => marks.insertion = some(v),
            Mark::Deletion(v) => marks.deletion = some(v),
            Mark::FormatChange(v) => marks.format_change = some(v),
            Mark::Dir(v) => marks.dir = some(v),
            Mark::Lang(v) => marks.lang = some(v),
            Mark::CharStyle(v) => marks.char_style = some(v),
            Mark::Strong => marks.strong = true,
            Mark::Weight(v) => marks.weight = some(v),
            Mark::Emphasis => marks.emphasis = true,
            Mark::Strike { double } => {
                marks.strike = true;
                marks.strike_double = *double;
            }
            Mark::Underline { line, color } => {
                marks.underline = true;
                marks.underline_line = line.clone();
                marks.underline_color = color.clone();
            }
            Mark::Highlight(v) => marks.highlight = some(v),
            Mark::Shade(v) => marks.shade = some(v),
            Mark::Color(v) => marks.color = some(v),
            Mark::Font(v) => marks.font = some(v),
            Mark::Size(v) => marks.size = some(v),
            Mark::Caps(v) => marks.caps = some(v),
            Mark::Tracking(v) => marks.tracking = some(v),
            Mark::Scale(v) => marks.scale = some(v),
            Mark::Shift(v) => marks.shift = some(v),
            Mark::Kern(v) => marks.kern = some(v),
            Mark::Otf(v) => marks.otf = some(v),
            Mark::Effect(v) => marks.effect = some(v),
            Mark::TextBox { style, color } => {
                marks.text_box = Some(style.clone());
                marks.box_color = color.clone();
            }
            Mark::Script(v) => marks.script = Some(*v),
            Mark::Foreign(v) => marks.foreign.push(v.clone()),
        }
    }
}

/// An inline tag that pulldown-cmark found: an opening tag with its mark and name, or a closing tag's name.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Tag {
    /// An opening tag of the grammar, or of version 1.
    Open {
        /// The tag name, which its closing tag repeats.
        name: &'static str,
        /// The mark it sets: a known one, or the foreign mark that keeps the tag's bytes.
        mark: Mark,
    },
    /// A closing tag.
    Close(&'static str),
}

/// Reads one piece of raw HTML. `None` when it is no tag that pairs: it is literal text then (`R-INL-3`).
pub fn read_tag(raw: &str) -> Option<Tag> {
    if let Some(name) = raw.strip_prefix("</").and_then(|r| r.strip_suffix('>')) {
        return CLOSE_NAMES.iter().find(|n| **n == name).map(|n| Tag::Close(n));
    }
    let simple = match raw {
        "<u>" => Some((
            "u",
            Mark::Underline {
                line: None,
                color: None,
            },
        )),
        "<sub>" => Some(("sub", Mark::Script(Script::Sub))),
        "<sup>" => Some(("sup", Mark::Script(Script::Sup))),
        "<em>" => Some(("em", Mark::Emphasis)),
        "<strong>" => Some(("strong", Mark::Strong)),
        "<del>" => Some(("del", Mark::Strike { double: false })),
        "<mark>" => Some(("mark", Mark::Highlight("honey".to_owned()))),
        _ => None,
    };
    if let Some((name, mark)) = simple {
        return Some(Tag::Open { name, mark });
    }
    let (name, attrs) = open_tag(raw)?;
    let mark = known_mark(name, &attrs).unwrap_or_else(|| Mark::Foreign(raw.to_owned()));
    Some(Tag::Open { name, mark })
}

/// The name and attributes of an opening tag in the grammar (`R-INL-1` to `R-INL-3`).
fn open_tag(raw: &str) -> Option<(&'static str, Vec<(&str, &str)>)> {
    let inner = raw.strip_prefix('<')?.strip_suffix('>')?;
    let (name, mut rest) = inner.split_once(' ')?;
    let name = *NAMES.iter().find(|n| **n == name)?;
    let mut attrs: Vec<(&str, &str)> = Vec::new();
    loop {
        let (key, after) = rest.split_once("=\"")?;
        let attr_ok = key == "lang"
            || key == "dir"
            || key.strip_prefix("data-").is_some_and(|k| {
                (1..=16).contains(&k.len())
                    && k.bytes()
                        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
            });
        let (value, tail) = after.split_once('"')?;
        let value_ok = value.chars().count() <= MAX_VALUE
            && !value.chars().any(|c| matches!(c, '<' | '>' | '&') || c.is_control());
        if !attr_ok || !value_ok || attrs.last().is_some_and(|(last, _)| *last >= key) {
            return None;
        }
        attrs.push((key, value));
        if tail.is_empty() {
            break;
        }
        rest = tail.strip_prefix(' ')?;
    }
    (attrs.len() <= MAX_ATTRS).then_some((name, attrs))
}

/// The known mark of a tag in the grammar, or `None` for a foreign mark (`R-INL-7`).
fn known_mark(name: &str, attrs: &[(&str, &str)]) -> Option<Mark> {
    let keys: Vec<&str> = attrs.iter().map(|(k, _)| *k).collect();
    let value = |key: &str| attrs.iter().find(|(k, _)| *k == key).map(|(_, v)| v.to_string());
    let line_ok = |v: &str| UNDERLINES[1..].contains(&v);
    match (name, keys.as_slice()) {
        ("u", ["data-line"]) => {
            let line = value("data-line")?;
            line_ok(&line).then_some(Mark::Underline {
                line: Some(line),
                color: None,
            })
        }
        ("u", ["data-line", "data-line-color"]) => {
            let (line, color) = (value("data-line")?, value("data-line-color")?);
            (line_ok(&line) && values::color(&color)).then_some(Mark::Underline {
                line: Some(line),
                color: Some(color),
            })
        }
        ("u", ["data-line-color"]) => {
            let color = value("data-line-color")?;
            values::color(&color).then_some(Mark::Underline {
                line: None,
                color: Some(color),
            })
        }
        ("del", ["data-line"]) => (value("data-line")? == "double").then_some(Mark::Strike { double: true }),
        ("mark", ["data-color"]) => {
            let color = value("data-color")?;
            (values::color(&color) && color != "honey").then_some(Mark::Highlight(color))
        }
        ("span", ["data-box"]) => {
            let style = value("data-box")?;
            BOXES
                .contains(&style.as_str())
                .then_some(Mark::TextBox { style, color: None })
        }
        ("span", ["data-box", "data-box-color"]) => {
            let (style, color) = (value("data-box")?, value("data-box-color")?);
            (BOXES.contains(&style.as_str()) && values::color(&color)).then_some(Mark::TextBox {
                style,
                color: Some(color),
            })
        }
        ("span", [key]) => span_mark(key, value(key)?),
        _ => None,
    }
}

/// The mark of a `<span>` with one attribute, when its value is in the attribute's grammar.
fn span_mark(key: &str, v: String) -> Option<Mark> {
    let ok = match key {
        "data-font" => values::font_name(&v),
        "data-size" => values::SIZE_NAMES.contains(&v.as_str()) || values::size_points_text(&v),
        "data-weight" => values::number_text(&v, 10_000, 90_000, 10_000, &[40_000, 70_000]),
        "data-caps" => v == "small" || v == "all",
        "data-tracking" => values::number_text(&v, -158_400, 158_400, 5, &[0]),
        "data-scale" => values::number_text(&v, 100, 60_000, 100, &[10_000]),
        "data-shift" => values::number_text(&v, -158_400, 158_400, 50, &[0]),
        "data-kern" => v == "0" || values::size_points_text(&v),
        "data-otf" => values::otf(&v),
        "data-effect" => values::effect(&v),
        "data-shade" | "data-color" => values::color(&v),
        "lang" => values::lang(&v),
        "dir" => v == "rtl" || v == "ltr",
        "data-comment" | "data-ins" | "data-del" | "data-fmt" => values::id(&v),
        "data-style" => values::style_name(&v),
        "data-float" => v == "start" || v == "end",
        _ => false,
    };
    if !ok {
        return None;
    }
    Some(match key {
        "data-font" => Mark::Font(v),
        "data-size" => Mark::Size(v),
        "data-weight" => Mark::Weight(v),
        "data-caps" => Mark::Caps(v),
        "data-tracking" => Mark::Tracking(v),
        "data-scale" => Mark::Scale(v),
        "data-shift" => Mark::Shift(v),
        "data-kern" => Mark::Kern(v),
        "data-otf" => Mark::Otf(v),
        "data-effect" => Mark::Effect(v),
        "data-shade" => Mark::Shade(v),
        "data-color" => Mark::Color(v),
        "lang" => Mark::Lang(v),
        "dir" => Mark::Dir(v),
        "data-comment" => Mark::Comment(v),
        "data-ins" => Mark::Insertion(v),
        "data-del" => Mark::Deletion(v),
        "data-fmt" => Mark::FormatChange(v),
        "data-style" => Mark::CharStyle(v),
        _ => Mark::Float(v),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_tags_of_the_grammar_pair() {
        let open = |raw: &str| match read_tag(raw) {
            Some(Tag::Open { mark, .. }) => Some(mark),
            _ => None,
        };
        assert_eq!(
            open("<span data-font=\"Georgia\">"),
            Some(Mark::Font("Georgia".to_owned()))
        );
        assert_eq!(
            open("<span data-x=\"1\">"),
            Some(Mark::Foreign("<span data-x=\"1\">".to_owned()))
        );
        assert_eq!(
            open("<span data-size=\"0.5\">"),
            Some(Mark::Foreign("<span data-size=\"0.5\">".to_owned()))
        );
        for literal in [
            "<span>",
            "<span data-x='1'>",
            "<span  data-x=\"1\">",
            "<span data-x=\"1\" >",
            "<span data-x=\"1\"/>",
            "<SPAN data-x=\"1\">",
            "<span data-b=\"1\" data-a=\"1\">",
            "<span data-a=\"1\" data-a=\"1\">",
            "<span data-x=\"a&amp;b\">",
            "<span data-x=\"a\tb\">",
            "<b>",
            "<span data-abcdefghijklmnopq=\"1\">",
        ] {
            assert_eq!(open(literal), None, "{literal}");
        }
        let many: String = (0..9).map(|i| format!(" data-a{i}=\"1\"")).collect();
        assert_eq!(open(&format!("<span{many}>")), None);
        assert_eq!(open(&format!("<span data-x=\"{}\">", "a".repeat(201))), None);
        assert_eq!(read_tag("</span>"), Some(Tag::Close("span")));
        assert_eq!(read_tag("</b>"), None);
    }
}
