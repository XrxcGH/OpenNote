//! The records of a text block's `data` that go with its Markdown: paragraph formatting (spec 6.8), list
//! definitions (6.9), notes, comments, and suggestions (6.10), and the layout (6.11).
//!
//! A reader keeps what is in the grammar and ignores the rest key by key, so one bad value never costs a whole
//! paragraph its formatting. Elements (spec 6.6) tie the records of `paras` to the blocks of the tree.

use std::collections::BTreeMap;

use serde_json::{Map, Value};

use super::values;
use super::{Block, Inline};

/// Paragraph formatting of one element (`R-PARA-1`). A missing key comes from the element's style.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Para {
    /// `start`, `center`, `end`, `justify`, or `distribute`.
    pub align: Option<String>,
    /// Indents in points.
    pub indent: Option<Indent>,
    /// Space above.
    pub before: Option<Spacing>,
    /// Space below.
    pub after: Option<Spacing>,
    /// Whether `before` and `after` are dropped between neighbors of the same style.
    pub contextual: Option<bool>,
    /// Line spacing.
    pub line: Option<LineSpacing>,
    /// Keep with the next paragraph.
    pub keep_next: Option<bool>,
    /// Keep the lines together.
    pub keep_lines: Option<bool>,
    /// Start on a new sheet.
    pub break_before: Option<bool>,
    /// Widow and orphan control.
    pub widows: Option<bool>,
    /// Tab stops, sorted by position.
    pub tabs: Vec<TabStop>,
    /// Borders.
    pub border: Option<Borders>,
    /// Shading.
    pub shade: Option<Shade>,
    /// `rtl` or `ltr`.
    pub dir: Option<String>,
    /// A language tag.
    pub lang: Option<String>,
    /// Outline level, 1 to 9.
    pub outline: Option<u8>,
    /// A drop cap.
    pub drop_cap: Option<DropCap>,
    /// The list definition a list item follows.
    pub list: Option<ParaList>,
    /// Whether the paragraph is hyphenated.
    pub hyphenate: Option<bool>,
}

/// Indents in points. A negative `first` is a hanging indent.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Indent {
    /// From the start edge.
    pub start: f64,
    /// From the end edge.
    pub end: f64,
    /// Of the first line.
    pub first: f64,
}

/// Space above or below a paragraph.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Spacing {
    /// Points.
    Points(f64),
    /// Word's HTML auto spacing, 14 points.
    Auto,
}

/// Line spacing.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum LineSpacing {
    /// A multiple of single spacing, 0.06 to 132.
    Multiple(f64),
    /// Exactly this many points.
    Exact(f64),
    /// At least this many points.
    AtLeast(f64),
}

/// A tab stop.
#[derive(Clone, Debug, PartialEq)]
pub struct TabStop {
    /// The position in points.
    pub pos: f64,
    /// `start`, `center`, `end`, `decimal`, `bar`, or `clear`.
    pub align: String,
    /// `none`, `dot`, `hyphen`, `underscore`, `heavy`, or `middleDot`.
    pub leader: String,
}

/// The borders of a paragraph.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Borders {
    /// Above.
    pub top: Option<BorderLine>,
    /// Below.
    pub bottom: Option<BorderLine>,
    /// At the start edge.
    pub start: Option<BorderLine>,
    /// At the end edge.
    pub end: Option<BorderLine>,
    /// Between neighbors with equal borders.
    pub between: Option<BorderLine>,
}

/// One side of a paragraph border.
#[derive(Clone, Debug, PartialEq)]
pub struct BorderLine {
    /// The OOXML border style, such as `single` or `double`.
    pub style: String,
    /// The width in points, 0.25 to 6.
    pub width: f64,
    /// The space between the border and the text, in points.
    pub space: u8,
    /// The color, or `None` for the text color.
    pub color: Option<String>,
}

/// Shading behind a paragraph.
#[derive(Clone, Debug, PartialEq)]
pub struct Shade {
    /// The background color, or `None` for no fill.
    pub fill: Option<String>,
    /// The OOXML `ST_Shd` pattern, such as `clear` or `pct10`.
    pub pattern: String,
    /// The color of the pattern, or `None` for the text color.
    pub color: Option<String>,
}

/// A drop cap.
#[derive(Clone, Debug, PartialEq)]
pub struct DropCap {
    /// `drop` or `margin`.
    pub mode: String,
    /// How many lines it spans.
    pub lines: u8,
    /// The distance from the text, in points.
    pub distance: f64,
}

/// The list definition of a list item.
#[derive(Clone, Debug, PartialEq)]
pub struct ParaList {
    /// The list ID, a key of [`TextData::lists`].
    pub id: String,
    /// Whether numbering starts again at this item.
    pub restart: bool,
}

/// A list definition (`R-LIST-1`).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ListDef {
    /// The levels, outermost first, 1 to 9.
    pub levels: Vec<ListLevel>,
}

/// One level of a list definition. Every key is optional.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct ListLevel {
    /// An OOXML `ST_NumberFormat` name, such as `decimal` or `bullet`.
    pub format: Option<String>,
    /// The number pattern, with `%1` to `%9`.
    pub text: Option<String>,
    /// The first number.
    pub start: Option<u16>,
    /// Where the text starts, in points.
    pub indent: Option<f64>,
    /// How far the number hangs before the text, in points.
    pub hanging: Option<f64>,
    /// The bullet, one code point.
    pub symbol: Option<String>,
    /// The font of the number or bullet.
    pub font: Option<String>,
    /// `start`, `center`, or `end`.
    pub align: Option<String>,
}

/// Whether a note is a footnote or an endnote.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum NoteKind {
    /// At the foot of the sheet.
    #[default]
    Foot,
    /// At the end of the document.
    End,
}

/// A footnote or endnote (`R-NOTE-1`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Note {
    /// Foot or end.
    pub kind: NoteKind,
    /// The note's text, inline Markdown with hard breaks.
    pub markdown: String,
}

impl Note {
    /// The note's text as inlines. References inside a note are literal text (`R-FN-4`).
    pub fn inlines(&self) -> Vec<Inline> {
        inline_markdown(&self.markdown)
    }
}

/// A comment (`R-CMT-1`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Comment {
    /// The person's display name. It is never sent anywhere (`R-CMT-3`).
    pub author: String,
    /// When the comment was made, as written.
    pub time: String,
    /// The comment's text, inline Markdown with hard breaks.
    pub markdown: String,
    /// The replies, oldest first.
    pub replies: Vec<Reply>,
    /// Whether the comment is resolved.
    pub resolved: bool,
}

/// A reply to a comment.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Reply {
    /// The person's display name.
    pub author: String,
    /// When the reply was made, as written.
    pub time: String,
    /// The reply's text.
    pub markdown: String,
}

/// A suggested change (`R-SUG-1`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Suggestion {
    /// `ins`, `del`, or `fmt`.
    pub kind: String,
    /// The person's display name.
    pub author: String,
    /// When the change was suggested, as written.
    pub time: String,
    /// For `fmt`: the canonical inline Markdown of the range before the change.
    pub before: Option<String>,
}

/// The newspaper columns of a text block (`R-LAY-1`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Layout {
    /// 1 to 4 columns.
    pub columns: u8,
    /// The gap between them in points.
    pub gap: f64,
    /// Whether a line is drawn between them.
    pub rule: bool,
}

impl Default for Layout {
    fn default() -> Layout {
        Layout {
            columns: 1,
            gap: 36.0,
            rule: false,
        }
    }
}

/// The records of a text block's `data` (spec 6.6 to 6.11).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TextData {
    /// Element IDs, one for each element, in document order.
    pub ids: Vec<String>,
    /// Named styles by element ID.
    pub styles: BTreeMap<String, String>,
    /// Paragraph formatting by element ID.
    pub paras: BTreeMap<String, Para>,
    /// List definitions by list ID.
    pub lists: BTreeMap<String, ListDef>,
    /// Footnotes and endnotes by note ID.
    pub notes: BTreeMap<String, Note>,
    /// Comments by comment ID.
    pub comments: BTreeMap<String, Comment>,
    /// Suggested changes by suggestion ID.
    pub suggestions: BTreeMap<String, Suggestion>,
    /// Newspaper columns, when the block sets them.
    pub layout: Option<Layout>,
}

/// The inlines of inline Markdown: its paragraphs, joined by hard breaks.
pub fn inline_markdown(markdown: &str) -> Vec<Inline> {
    let mut out = Vec::new();
    for block in super::parse::parse_note(markdown).blocks {
        if let Block::Paragraph(content) = block {
            if !out.is_empty() {
                out.push(Inline::HardBreak);
            }
            out.extend(content);
        }
    }
    out
}

impl TextData {
    /// Reads the records from a text block's `data`: its element IDs and styles, and the keys of version 2 that
    /// the core keeps among the block's other keys.
    pub fn read(ids: &[String], styles: &BTreeMap<String, String>, extra: &Map<String, Value>) -> TextData {
        let map = |key: &str| extra.get(key).and_then(Value::as_object);
        let entries = |key: &str, limit: usize| {
            map(key)
                .into_iter()
                .flatten()
                .take(limit)
                .filter_map(|(k, v)| Some((k.clone(), v.as_object()?)))
                .collect::<Vec<_>>()
        };
        // Look up each element ID in `paras`, so the work grows with the IDs and never with their product.
        let paras = map("paras")
            .map(|paras| {
                ids.iter()
                    .filter_map(|id| Some((id.clone(), read_para(paras.get(id)?.as_object()?))))
                    .collect()
            })
            .unwrap_or_default();
        let lists = entries("lists", 256)
            .into_iter()
            .filter(|(id, _)| list_id(id))
            .filter_map(|(id, v)| Some((id, read_list(v)?)))
            .collect();
        let notes = entries("notes", 10_000)
            .into_iter()
            .filter(|(id, _)| values::id(id))
            .filter_map(|(id, v)| Some((id, read_note(v)?)))
            .collect();
        let comments = entries("comments", 10_000)
            .into_iter()
            .filter(|(id, _)| values::id(id))
            .filter_map(|(id, v)| Some((id, read_comment(v)?)))
            .collect();
        let suggestions = entries("suggestions", 10_000)
            .into_iter()
            .filter(|(id, _)| values::id(id))
            .filter_map(|(id, v)| Some((id, read_suggestion(v)?)))
            .collect();
        TextData {
            ids: ids.to_vec(),
            styles: styles.clone(),
            paras,
            lists,
            notes,
            comments,
            suggestions,
            layout: map("layout").map(read_layout),
        }
    }

    /// The elements of the blocks that came from this text block, each with its ID, style, and formatting.
    pub fn elements(&self, blocks: &[Block]) -> Vec<Element> {
        let mut paths = Vec::new();
        element_paths(blocks, &mut Vec::new(), &mut paths);
        paths
            .into_iter()
            .enumerate()
            .map(|(index, path)| {
                let id = self.ids.get(index).cloned();
                let style = id.as_ref().and_then(|id| self.styles.get(id)).cloned();
                let para = id.as_ref().and_then(|id| self.paras.get(id)).cloned();
                Element { path, id, style, para }
            })
            .collect()
    }
}

/// An element of a text block (spec 6.6): a heading, paragraph, list item, code block, math block, or thematic
/// break, at any depth.
#[derive(Clone, Debug, PartialEq)]
pub struct Element {
    /// Where it is in the blocks: the index of a block, then for a list the index of the item, then the index of a
    /// block inside the item, quote, or callout. A list item's path ends at the item, and a callout's own path
    /// stands for its title.
    pub path: Vec<usize>,
    /// Its ID, when `ids` has one for it.
    pub id: Option<String>,
    /// Its named style.
    pub style: Option<String>,
    /// Its paragraph formatting.
    pub para: Option<Para>,
}

/// The paths of the elements of the blocks, in document order. A list item's first paragraph belongs to the
/// item, and quotes and callouts are not elements, but the blocks inside them are. A callout's title line counts
/// as one element.
fn element_paths(blocks: &[Block], path: &mut Vec<usize>, out: &mut Vec<Vec<usize>>) {
    for (i, block) in blocks.iter().enumerate() {
        path.push(i);
        block_paths(block, path, out);
        path.pop();
    }
}

fn block_paths(block: &Block, path: &mut Vec<usize>, out: &mut Vec<Vec<usize>>) {
    match block {
        Block::Paragraph(_) | Block::Heading { .. } | Block::Code { .. } | Block::Break => out.push(path.clone()),
        Block::List { items, .. } => {
            for (j, item) in items.iter().enumerate() {
                path.push(j);
                out.push(path.clone());
                for (k, inner) in item.blocks.iter().enumerate() {
                    if k == 0 && matches!(inner, Block::Paragraph(_)) {
                        continue;
                    }
                    path.push(k);
                    block_paths(inner, path, out);
                    path.pop();
                }
                path.pop();
            }
        }
        Block::Quote(inner) => element_paths(inner, path, out),
        Block::Callout { blocks, .. } => {
            out.push(path.clone());
            element_paths(blocks, path, out);
        }
        Block::Table { .. } => {}
    }
}

fn list_id(id: &str) -> bool {
    (1..=16).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit())
}

/// A JSON number from `lo` to `hi` on a step (`R-VAL-1`).
fn number(value: Option<&Value>, lo: f64, hi: f64, step: f64) -> Option<f64> {
    let v = value?.as_f64()?;
    let steps = v / step;
    ((lo..=hi).contains(&v) && (steps - steps.round()).abs() < 1e-6).then_some(v)
}

fn word(value: Option<&Value>, allowed: &[&str]) -> Option<String> {
    value?.as_str().filter(|v| allowed.contains(v)).map(str::to_owned)
}

fn color(value: Option<&Value>) -> Option<String> {
    value?.as_str().filter(|v| values::color(v)).map(str::to_owned)
}

fn string(value: Option<&Value>, max_chars: usize) -> Option<String> {
    value?
        .as_str()
        .filter(|v| v.chars().count() <= max_chars)
        .map(str::to_owned)
}

/// At most 64 KiB of Markdown.
fn markdown(value: Option<&Value>) -> Option<String> {
    value?.as_str().filter(|v| v.len() <= 64 * 1024).map(str::to_owned)
}

const POINTS: f64 = 1584.0;
const ALIGNS: [&str; 5] = ["start", "center", "end", "justify", "distribute"];
const BORDER_STYLES: [&str; 15] = [
    "single",
    "double",
    "dotted",
    "dashed",
    "thick",
    "triple",
    "thinThickSmallGap",
    "thickThinSmallGap",
    "wave",
    "doubleWave",
    "dashDotStroked",
    "threeDEmboss",
    "threeDEngrave",
    "inset",
    "outset",
];
const SHADE_PATTERNS: [&str; 37] = [
    "clear",
    "solid",
    "horzStripe",
    "vertStripe",
    "reverseDiagStripe",
    "diagStripe",
    "horzCross",
    "diagCross",
    "thinHorzStripe",
    "thinVertStripe",
    "thinReverseDiagStripe",
    "thinDiagStripe",
    "thinHorzCross",
    "thinDiagCross",
    "pct5",
    "pct10",
    "pct12",
    "pct15",
    "pct20",
    "pct25",
    "pct30",
    "pct35",
    "pct37",
    "pct40",
    "pct45",
    "pct50",
    "pct55",
    "pct60",
    "pct62",
    "pct65",
    "pct70",
    "pct75",
    "pct80",
    "pct85",
    "pct87",
    "pct90",
    "pct95",
];
const NUMBER_FORMATS: [&str; 20] = [
    "decimal",
    "decimalZero",
    "lowerLetter",
    "upperLetter",
    "lowerRoman",
    "upperRoman",
    "ordinal",
    "cardinalText",
    "ordinalText",
    "bullet",
    "none",
    "hebrew1",
    "hebrew2",
    "arabicAlpha",
    "arabicAbjad",
    "hindiNumbers",
    "thaiNumbers",
    "chineseCounting",
    "japaneseCounting",
    "koreanCounting",
];

/// Reads paragraph formatting from a `data.paras` entry or a style's paragraph keys. Invalid values are dropped.
pub fn read_para(v: &Map<String, Value>) -> Para {
    let flag = |key: &str| v.get(key).and_then(Value::as_bool);
    let spacing = |key: &str| match v.get(key) {
        Some(Value::String(auto)) if auto == "auto" => Some(Spacing::Auto),
        other => number(other, 0.0, POINTS, 0.05).map(Spacing::Points),
    };
    let indent = v.get("indent").and_then(Value::as_object).map(|i| {
        let side = |key: &str| number(i.get(key), -POINTS, POINTS, 0.05).unwrap_or(0.0);
        Indent {
            start: side("start"),
            end: side("end"),
            first: side("first"),
        }
    });
    let line = v.get("line").and_then(Value::as_object).and_then(|l| {
        let value = l.get("value");
        match l.get("rule")?.as_str()? {
            "multiple" => number(value, 0.06, 132.0, 0.01).map(LineSpacing::Multiple),
            "exact" => number(value, 0.7, POINTS, 0.05).map(LineSpacing::Exact),
            "atLeast" => number(value, 0.7, POINTS, 0.05).map(LineSpacing::AtLeast),
            _ => None,
        }
    });
    Para {
        align: word(v.get("align"), &ALIGNS),
        indent,
        before: spacing("before"),
        after: spacing("after"),
        contextual: flag("contextual"),
        line,
        keep_next: flag("keepNext"),
        keep_lines: flag("keepLines"),
        break_before: flag("breakBefore"),
        widows: flag("widows"),
        tabs: read_tabs(v.get("tabs")),
        border: v.get("border").and_then(Value::as_object).map(read_borders),
        shade: v.get("shade").and_then(Value::as_object).map(|s| Shade {
            fill: color(s.get("fill")),
            pattern: word(s.get("pattern"), &SHADE_PATTERNS).unwrap_or_else(|| "clear".to_owned()),
            color: color(s.get("color")),
        }),
        dir: word(v.get("dir"), &["rtl", "ltr"]),
        lang: v
            .get("lang")
            .and_then(Value::as_str)
            .filter(|l| values::lang(l))
            .map(str::to_owned),
        outline: number(v.get("outline"), 1.0, 9.0, 1.0).map(|n| n as u8),
        drop_cap: v.get("dropCap").and_then(Value::as_object).and_then(|d| {
            Some(DropCap {
                mode: word(d.get("mode"), &["drop", "margin"])?,
                lines: number(d.get("lines"), 1.0, 10.0, 1.0).map_or(3, |n| n as u8),
                distance: number(d.get("distance"), 0.0, POINTS, 0.05).unwrap_or(0.0),
            })
        }),
        list: v.get("list").and_then(Value::as_object).and_then(|l| {
            let id = l.get("id")?.as_str().filter(|id| list_id(id))?.to_owned();
            let restart = l.get("restart").and_then(Value::as_bool).unwrap_or(false);
            Some(ParaList { id, restart })
        }),
        hyphenate: flag("hyphenate"),
    }
}

fn read_tabs(value: Option<&Value>) -> Vec<TabStop> {
    let mut tabs: Vec<TabStop> = Vec::new();
    for tab in value.and_then(Value::as_array).into_iter().flatten().take(64) {
        let Some(t) = tab.as_object() else { continue };
        let Some(pos) = number(t.get("pos"), 0.0, POINTS, 0.05) else {
            continue;
        };
        if tabs.iter().any(|old| old.pos == pos) {
            continue;
        }
        tabs.push(TabStop {
            pos,
            align: word(t.get("align"), &["start", "center", "end", "decimal", "bar", "clear"])
                .unwrap_or_else(|| "start".to_owned()),
            leader: word(
                t.get("leader"),
                &["none", "dot", "hyphen", "underscore", "heavy", "middleDot"],
            )
            .unwrap_or_else(|| "none".to_owned()),
        });
    }
    tabs.sort_by(|a, b| a.pos.total_cmp(&b.pos));
    tabs
}

fn read_borders(b: &Map<String, Value>) -> Borders {
    let side = |key: &str| {
        let s = b.get(key)?.as_object()?;
        Some(BorderLine {
            style: word(s.get("style"), &BORDER_STYLES)?,
            width: number(s.get("width"), 0.25, 6.0, 0.125).unwrap_or(0.5),
            space: number(s.get("space"), 0.0, 31.0, 1.0).map_or(1, |n| n as u8),
            color: color(s.get("color")),
        })
    };
    Borders {
        top: side("top"),
        bottom: side("bottom"),
        start: side("start"),
        end: side("end"),
        between: side("between"),
    }
}

fn read_list(v: &Map<String, Value>) -> Option<ListDef> {
    let levels: Vec<ListLevel> = v
        .get("levels")?
        .as_array()?
        .iter()
        .take(9)
        .map(|level| {
            let l = level.as_object().cloned().unwrap_or_default();
            let symbol = l.get("symbol").and_then(Value::as_str).filter(|s| {
                let mut chars = s.chars();
                chars.next().is_some_and(|c| !c.is_control()) && chars.next().is_none()
            });
            ListLevel {
                format: word(l.get("format"), &NUMBER_FORMATS),
                text: string(l.get("text"), 64),
                start: number(l.get("start"), 0.0, 32_767.0, 1.0).map(|n| n as u16),
                indent: number(l.get("indent"), 0.0, POINTS, 0.05),
                hanging: number(l.get("hanging"), 0.0, POINTS, 0.05),
                symbol: symbol.map(str::to_owned),
                font: l
                    .get("font")
                    .and_then(Value::as_str)
                    .filter(|f| values::font_name(f))
                    .map(str::to_owned),
                align: word(l.get("align"), &["start", "center", "end"]),
            }
        })
        .collect();
    (!levels.is_empty()).then_some(ListDef { levels })
}

fn read_note(v: &Map<String, Value>) -> Option<Note> {
    let kind = match v.get("kind").and_then(Value::as_str) {
        Some("end") => NoteKind::End,
        _ => NoteKind::Foot,
    };
    Some(Note {
        kind,
        markdown: markdown(v.get("markdown"))?,
    })
}

fn read_reply(v: &Map<String, Value>) -> Option<Reply> {
    Some(Reply {
        author: string(v.get("author"), 100).filter(|a| !a.is_empty())?,
        time: v.get("time")?.as_str()?.to_owned(),
        markdown: markdown(v.get("markdown"))?,
    })
}

fn read_comment(v: &Map<String, Value>) -> Option<Comment> {
    let head = read_reply(v)?;
    let replies = v
        .get("replies")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(256);
    Some(Comment {
        author: head.author,
        time: head.time,
        markdown: head.markdown,
        replies: replies.filter_map(|r| read_reply(r.as_object()?)).collect(),
        resolved: v.get("resolved").and_then(Value::as_bool).unwrap_or(false),
    })
}

fn read_suggestion(v: &Map<String, Value>) -> Option<Suggestion> {
    let kind = word(v.get("kind"), &["ins", "del", "fmt"])?;
    let before = if kind == "fmt" { markdown(v.get("before")) } else { None };
    Some(Suggestion {
        author: string(v.get("author"), 100).filter(|a| !a.is_empty())?,
        time: v.get("time")?.as_str()?.to_owned(),
        kind,
        before,
    })
}

fn read_layout(v: &Map<String, Value>) -> Layout {
    let default = Layout::default();
    Layout {
        columns: number(v.get("columns"), 1.0, 4.0, 1.0).map_or(default.columns, |n| n as u8),
        gap: number(v.get("gap"), 0.0, POINTS, 0.05).unwrap_or(default.gap),
        rule: v.get("rule").and_then(Value::as_bool).unwrap_or(default.rule),
    }
}
