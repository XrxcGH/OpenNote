//! The typed version 2 data of a text block (spec 6.8 to 6.11): paragraph formatting, lists, notes, comments,
//! suggestions, and the text layout.
//!
//! The JSON in [`super::TextData::extra`] stays the source of truth, so every unknown key and every invalid
//! value is kept exactly and written back in code point order (spec 2.9 and `R-JSON-1`). These types are what a
//! reader makes of it: a key whose value is invalid reads as missing (`R-NUM-1`).

use std::collections::BTreeMap;

use crate::id::ElementId;
use crate::model::{named_enum, JsonMap};
use crate::time::Timestamp;

named_enum! {
    /// Paragraph alignment (`R-PARA-1`). `Start` and `End` follow the paragraph's direction.
    Align {
        /// The start edge.
        Start = "start",
        /// Centered.
        Center = "center",
        /// The end edge.
        End = "end",
        /// Both edges.
        Justify = "justify",
        /// Both edges, the last line too.
        Distribute = "distribute",
    }
}

named_enum! {
    /// How a tab stop aligns text (`R-PARA-1`).
    TabAlign {
        /// At the start of the text.
        Start = "start",
        /// Centered on the stop.
        Center = "center",
        /// At the end of the text.
        End = "end",
        /// On the decimal point.
        Decimal = "decimal",
        /// A vertical bar at the stop.
        Bar = "bar",
        /// Removes a stop the style sets.
        Clear = "clear",
    }
}

named_enum! {
    /// What fills the space before a tab stop (`R-PARA-1`).
    TabLeader {
        /// Nothing.
        None = "none",
        /// Dots.
        Dot = "dot",
        /// Hyphens.
        Hyphen = "hyphen",
        /// An underline.
        Underscore = "underscore",
        /// A heavy line.
        Heavy = "heavy",
        /// Middle dots.
        MiddleDot = "middleDot",
    }
}

named_enum! {
    /// The rule of line spacing (`R-PARA-1`).
    LineRule {
        /// A multiple of single spacing.
        Multiple = "multiple",
        /// Exactly this many points.
        Exact = "exact",
        /// At least this many points.
        AtLeast = "atLeast",
    }
}

named_enum! {
    /// Text direction.
    Direction {
        /// Right to left.
        Rtl = "rtl",
        /// Left to right.
        Ltr = "ltr",
    }
}

named_enum! {
    /// Where a drop cap sits (`R-PARA-1`).
    DropCapMode {
        /// In the text.
        Drop = "drop",
        /// In the margin.
        Margin = "margin",
    }
}

named_enum! {
    /// How a list number sits in its space (`R-LIST-1`).
    ListAlign {
        /// At the start.
        Start = "start",
        /// Centered.
        Center = "center",
        /// At the end.
        End = "end",
    }
}

named_enum! {
    /// A footnote or an endnote (`R-NOTE-1`).
    NoteKind {
        /// At the bottom of the sheet.
        Foot = "foot",
        /// At the end of the page.
        End = "end",
    }
}

named_enum! {
    /// What a suggestion changes (`R-SUG-1`).
    SuggestionKind {
        /// Inserted text.
        Ins = "ins",
        /// Deleted text.
        Del = "del",
        /// A format change.
        Fmt = "fmt",
    }
}

/// Space before or after a paragraph, in points, or Word's HTML spacing of 14 points.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Spacing {
    /// Points.
    Points(f64),
    /// `"auto"`.
    Auto,
}

/// Indents in points. A negative `first` is a hanging indent.
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct Indent {
    /// From the start edge.
    pub start: f64,
    /// From the end edge.
    pub end: f64,
    /// Of the first line.
    pub first: f64,
}

/// Line spacing.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LineSpacing {
    /// The rule.
    pub rule: LineRule,
    /// A multiple, or points.
    pub value: f64,
}

/// One tab stop.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TabStop {
    /// Points from the start edge.
    pub pos: f64,
    /// How text aligns on it.
    pub align: TabAlign,
    /// What fills the space before it.
    pub leader: TabLeader,
}

/// One side of a paragraph border.
#[derive(Clone, Debug, PartialEq)]
pub struct BorderLine {
    /// An OOXML border style name, such as `single` or `thinThickSmallGap`.
    pub style: String,
    /// Points, 0.25 to 6.
    pub width: f64,
    /// Points between the border and the text, 0 to 31.
    pub space: u32,
    /// The color, or `None` for the text color.
    pub color: Option<String>,
}

/// The borders of a paragraph.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct ParaBorders {
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

/// Shading behind a paragraph.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Shade {
    /// The background color, or `None` for no fill.
    pub fill: Option<String>,
    /// An OOXML `ST_Shd` name, `clear` by default.
    pub pattern: String,
    /// The color of the pattern, or `None` for the text color.
    pub color: Option<String>,
}

/// A drop cap.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct DropCap {
    /// In the text or in the margin.
    pub mode: DropCapMode,
    /// How many lines it drops, 1 to 10.
    pub lines: u32,
    /// Points between it and the text.
    pub distance: f64,
}

/// The list definition a list item follows.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct ListRef {
    /// The list ID, or `None` for the built-in defaults.
    pub id: Option<String>,
    /// Whether numbering starts again at this item.
    pub restart: bool,
}

/// One entry of `data.paras` (`R-PARA-1`). A missing key comes from the element's style.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct ParaFormat {
    /// Alignment.
    pub align: Option<Align>,
    /// Indents.
    pub indent: Option<Indent>,
    /// Space above.
    pub before: Option<Spacing>,
    /// Space below.
    pub after: Option<Spacing>,
    /// Drops `before` and `after` between neighbors of the same style.
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
    pub tabs: Option<Vec<TabStop>>,
    /// Borders.
    pub border: Option<ParaBorders>,
    /// Shading.
    pub shade: Option<Shade>,
    /// Direction.
    pub dir: Option<Direction>,
    /// Language tag.
    pub lang: Option<String>,
    /// Outline level, 1 to 9.
    pub outline: Option<u8>,
    /// A drop cap.
    pub drop_cap: Option<DropCap>,
    /// The list definition of a list item.
    pub list: Option<ListRef>,
    /// Overrides `view.text.hyphenate`.
    pub hyphenate: Option<bool>,
    /// Keys this version does not know.
    pub extra: JsonMap,
}

/// One level of a list definition (`R-LIST-1`). Missing keys take the level's defaults.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct ListLevel {
    /// An OOXML `ST_NumberFormat` name.
    pub format: Option<String>,
    /// The number pattern, where `%1` to `%9` stand for the numbers of levels 1 to 9.
    pub text: Option<String>,
    /// The first number, 0 to 32,767.
    pub start: Option<u32>,
    /// Points where the text starts.
    pub indent: Option<f64>,
    /// Points the number hangs before the text.
    pub hanging: Option<f64>,
    /// The bullet, one code point.
    pub symbol: Option<char>,
    /// The font of the number or bullet.
    pub font: Option<String>,
    /// How the number sits in its space.
    pub align: Option<ListAlign>,
    /// Keys this version does not know.
    pub extra: JsonMap,
}

/// A list definition: 1 to 9 levels, the first for the outermost items.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct ListDef {
    /// The levels.
    pub levels: Vec<ListLevel>,
    /// Keys this version does not know.
    pub extra: JsonMap,
}

/// A footnote or endnote (`R-NOTE-1`).
#[derive(Clone, Debug, PartialEq)]
pub struct Note {
    /// Footnote or endnote.
    pub kind: NoteKind,
    /// Inline Markdown with hard breaks.
    pub markdown: String,
    /// Keys this version does not know.
    pub extra: JsonMap,
}

/// A reply to a comment.
#[derive(Clone, Debug, PartialEq)]
pub struct Reply {
    /// The person's display name, never an account ID (`R-CMT-3`).
    pub author: String,
    /// When it was written.
    pub time: Timestamp,
    /// Inline Markdown with hard breaks.
    pub markdown: String,
}

/// A comment (`R-CMT-1`).
#[derive(Clone, Debug, PartialEq)]
pub struct Comment {
    /// The person's display name.
    pub author: String,
    /// When it was made.
    pub time: Timestamp,
    /// Inline Markdown with hard breaks.
    pub markdown: String,
    /// Replies, oldest first.
    pub replies: Vec<Reply>,
    /// Whether it is resolved.
    pub resolved: bool,
    /// Keys this version does not know.
    pub extra: JsonMap,
}

/// A suggested change (`R-SUG-1`).
#[derive(Clone, Debug, PartialEq)]
pub struct Suggestion {
    /// What it changes.
    pub kind: SuggestionKind,
    /// The person's display name.
    pub author: String,
    /// When it was made.
    pub time: Timestamp,
    /// For a format change, the canonical inline Markdown of the range before it.
    pub before: Option<String>,
    /// Keys this version does not know.
    pub extra: JsonMap,
}

/// Newspaper columns of a text block (`R-LAY-1`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct TextLayout {
    /// 1 to 4 columns.
    pub columns: u32,
    /// Points between columns.
    pub gap: f64,
    /// Whether a line is drawn between columns.
    pub rule: bool,
}

impl Default for TextLayout {
    fn default() -> TextLayout {
        TextLayout {
            columns: 1,
            gap: 36.0,
            rule: false,
        }
    }
}

/// What a reader makes of a text block's version 2 data.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct TextFormatting {
    /// Paragraph formatting of the elements in `ids` (`R-PARA-2`).
    pub paras: BTreeMap<ElementId, ParaFormat>,
    /// List definitions by list ID.
    pub lists: BTreeMap<String, ListDef>,
    /// Notes by ID.
    pub notes: BTreeMap<String, Note>,
    /// Comments by ID.
    pub comments: BTreeMap<String, Comment>,
    /// Suggestions by ID.
    pub suggestions: BTreeMap<String, Suggestion>,
    /// Newspaper columns.
    pub layout: Option<TextLayout>,
    /// Values a reader found invalid and treats as missing, by path, such as
    /// `paras.01m3sbcmt0000000000000e001.align: start, center, end, justify, or distribute`.
    pub problems: Vec<String>,
    /// Limits of spec 16 that the data passes, which make the page damaged, by path.
    pub over_limits: Vec<String>,
}
