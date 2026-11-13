//! The neutral document tree that every converter reads or writes.
//!
//! It has the shape of the tree in `docs/format/fixtures/markdown/documents/README.md`: blocks hold runs of text,
//! and each run carries its marks. Parsing turns Markdown (OpenNote, Obsidian, or Joplin) into this tree, and the
//! writers turn it into canonical OpenNote Markdown (spec 7), HTML, or Word.

pub mod cell_style;
pub mod data;
pub mod escape;
pub(crate) mod html_tags;
mod inline;
pub mod parse;
pub mod values;
pub mod write;

#[cfg(test)]
mod tests;

/// The body size that the `textSize` names scale, in points.
pub const BODY_POINTS: f64 = 12.0;

/// The size in points of a `textSize` value (R-VAL-3). A name scales the 12 point body: `small` is 10 (0.85 of
/// the body, to the nearest point), `large` 15 (1.25), and `xlarge` 18 (1.5). Points are 1 to 1638, step 0.5.
pub fn size_points(size: &str) -> Option<f64> {
    match size {
        "small" => Some(10.0),
        "large" => Some(15.0),
        "xlarge" => Some(18.0),
        _ if values::size_points_text(size) => size.parse().ok(),
        _ => None,
    }
}

/// A `textSize` value as an attribute gives it, when it is in the grammar: a version 1 name in any case, or
/// points. Readers of HTML use it, so a size that OpenNote wrote comes back.
pub fn size_value(value: &str) -> Option<String> {
    let value = value.trim();
    let name = value.to_ascii_lowercase();
    if values::SIZE_NAMES.contains(&name.as_str()) {
        return Some(name);
    }
    values::size_points_text(value).then(|| value.to_owned())
}

/// Subscript or superscript.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Script {
    /// Lowered text.
    Sub,
    /// Raised text.
    Sup,
}

/// The marks of a run of text. The fields follow the nesting order of spec 7.10 (`R-MRK-24`), outermost first.
///
/// Values of version 2 marks are kept as the text of their tag, which the grammar of spec Appendix D already
/// makes canonical, so a run writes back byte for byte. [`values`] and [`size_points`] read them.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Marks {
    /// `start` or `end`: images inside float to that edge of the paragraph (`R-MRK-29`).
    pub float: Option<String>,
    /// The link destination.
    pub link: Option<String>,
    /// The IDs of the comments that cover the text, in code point order (`R-MRK-26`).
    pub comments: Vec<String>,
    /// The ID of the suggestion that inserted the text.
    pub insertion: Option<String>,
    /// The ID of the suggestion that deletes the text.
    pub deletion: Option<String>,
    /// The ID of the suggestion that changed the text's format.
    pub format_change: Option<String>,
    /// `rtl` or `ltr`: the run is isolated in that direction.
    pub dir: Option<String>,
    /// A language tag (Appendix D.8), or `zxx` for "do not check spelling".
    pub lang: Option<String>,
    /// The name of a character style.
    pub char_style: Option<String>,
    /// Strong emphasis.
    pub strong: bool,
    /// A weight from 100 to 900 other than 400 and 700, such as `600`.
    pub weight: Option<String>,
    /// Emphasis.
    pub emphasis: bool,
    /// Strikethrough.
    pub strike: bool,
    /// Whether the strikethrough is double. Only with `strike`.
    pub strike_double: bool,
    /// Underline.
    pub underline: bool,
    /// The underline style other than single, such as `double` or `wave` (Appendix D.5). Only with `underline`.
    pub underline_line: Option<String>,
    /// The color of the underline. Only with `underline`.
    pub underline_color: Option<String>,
    /// A highlight color, where `honey` is the default highlight. Version 2 takes any color of Appendix D.7.
    pub highlight: Option<String>,
    /// Shading behind the text and any highlight: a color.
    pub shade: Option<String>,
    /// A text color: a pen name or `#rrggbb`, and in version 2 any color of Appendix D.7.
    pub color: Option<String>,
    /// A font name or a theme token such as `+body`.
    pub font: Option<String>,
    /// `small`, `large`, or `xlarge`, or points from 1 to 1638 in steps of 0.5, such as `10.5` ([`size_points`]).
    pub size: Option<String>,
    /// `small` (small capitals) or `all` (all capitals).
    pub caps: Option<String>,
    /// Letter spacing in points, such as `1.5`.
    pub tracking: Option<String>,
    /// Character width in percent, such as `90`.
    pub scale: Option<String>,
    /// Raised (positive) or lowered text in points.
    pub shift: Option<String>,
    /// `0` for no kerning, or the size in points from which the text is kerned.
    pub kern: Option<String>,
    /// OpenType feature tokens, such as `onum tnum`.
    pub otf: Option<String>,
    /// Text effects, such as `outline shadow`.
    pub effect: Option<String>,
    /// A box around the text: `single`, `double`, `dotted`, `dashed`, or `thick`.
    pub text_box: Option<String>,
    /// The color of the box. Only with `text_box`.
    pub box_color: Option<String>,
    /// Subscript or superscript.
    pub script: Option<Script>,
    /// The exact opening tags of marks from a later version (`R-INL-9`), in code point order. Each one closes with
    /// the closing tag of its name.
    pub foreign: Vec<String>,
    /// Inline code.
    pub code: bool,
    /// TeX math, written `$...$`, or between `$$` lines when it is a paragraph on its own (spec 7.6).
    pub math: bool,
}

impl Marks {
    /// The marks of ordinary text.
    pub fn none() -> Marks {
        Marks::default()
    }

    /// Whether the text has no marks.
    pub fn is_plain(&self) -> bool {
        *self == Marks::default()
    }

    /// Plain text with a link.
    pub fn link(dest: impl Into<String>) -> Marks {
        Marks {
            link: Some(dest.into()),
            ..Marks::default()
        }
    }
}

/// A piece of a paragraph, heading, or table cell.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Inline {
    /// A run of text with its marks. The text is unescaped.
    Text {
        /// The text.
        text: String,
        /// Its marks.
        marks: Marks,
    },
    /// A line break inside a paragraph.
    HardBreak,
    /// A line break that CommonMark shows as a space. Only the parser makes one, and it resolves them before
    /// it returns, so finished documents never hold one.
    SoftBreak,
    /// An image. The destination is `asset:<ID>` in a page, or a path before an import resolves it.
    Image {
        /// Where the image is.
        dest: String,
        /// The description.
        alt: String,
    },
    /// A footnote or endnote reference, `[^ID]` (spec 7.12). Its note is in the block's
    /// `data.notes`. It holds no text, but it can carry marks.
    Note {
        /// The note's ID.
        id: String,
        /// Its marks.
        marks: Marks,
    },
}

impl Inline {
    /// Plain text.
    pub fn text(text: impl Into<String>) -> Inline {
        Inline::Text {
            text: text.into(),
            marks: Marks::none(),
        }
    }

    /// Text with marks.
    pub fn marked(text: impl Into<String>, marks: Marks) -> Inline {
        Inline::Text {
            text: text.into(),
            marks,
        }
    }
}

/// How a callout starts.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Fold {
    /// `-`: closed until opened.
    Folded,
    /// `+`: open, but can be folded.
    Open,
}

/// One item of a list.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Item {
    /// `Some(checked)` for a task list item.
    pub task: Option<bool>,
    /// The blocks of the item.
    pub blocks: Vec<Block>,
}

/// A block of a document.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Block {
    /// A paragraph.
    Paragraph(Vec<Inline>),
    /// A heading, levels 1 to 6.
    Heading {
        /// The level.
        level: u8,
        /// The text.
        content: Vec<Inline>,
    },
    /// A bullet or numbered list.
    List {
        /// Whether the list is numbered.
        ordered: bool,
        /// The first number of a numbered list.
        start: u64,
        /// The items.
        items: Vec<Item>,
    },
    /// A block quote.
    Quote(Vec<Block>),
    /// A callout, such as a tip or a warning.
    Callout {
        /// The type, in lowercase.
        kind: String,
        /// Folded, open, or fixed.
        fold: Option<Fold>,
        /// The title, which may be empty.
        title: Vec<Inline>,
        /// The content.
        blocks: Vec<Block>,
    },
    /// A fenced code block.
    Code {
        /// The language, or an empty string.
        language: String,
        /// The code, without the final line break.
        text: String,
    },
    /// A thematic break.
    Break,
    /// A table. Only exports and imports use it: pages keep tables in `table` blocks.
    Table {
        /// Whether the first row is a header.
        header: bool,
        /// The rows of cells.
        rows: Vec<Vec<Vec<Inline>>>,
        /// The sheet style of each cell, by row and column like `rows`, from the table's `data.sheet`. Empty when
        /// the table has no sheet styles, and a row may be shorter than its cells.
        cell_styles: Vec<Vec<Option<cell_style::CellStyle>>>,
        /// The merged ranges from the table's `data.sheet`. Empty without merges. A merge's anchor holds the content
        /// and the other cells it covers are not drawn.
        merges: Vec<crate::sheet::Merge>,
        /// The column widths in whole page units (1/96 inch), from the table block. Empty when the source has none.
        widths: Vec<u32>,
    },
}

impl Block {
    /// A table without sheet styles.
    pub fn table(header: bool, rows: Vec<Vec<Vec<Inline>>>) -> Block {
        Block::Table {
            header,
            rows,
            cell_styles: Vec::new(),
            merges: Vec::new(),
            widths: Vec::new(),
        }
    }

    /// The sheet style of the cell at `row` and `column` of a table.
    pub fn cell_style(&self, row: usize, column: usize) -> Option<&cell_style::CellStyle> {
        match self {
            Block::Table { cell_styles, .. } => cell_styles.get(row)?.get(column)?.as_ref(),
            _ => None,
        }
    }
}

/// The text of inlines with no marks, for titles and names. A break becomes a space.
pub fn plain_text(inlines: &[Inline]) -> String {
    let mut out = String::new();
    for inline in inlines {
        match inline {
            Inline::Text { text, .. } => out.push_str(text),
            Inline::HardBreak | Inline::SoftBreak => out.push(' '),
            Inline::Image { alt, .. } => out.push_str(alt),
            Inline::Note { .. } => {}
        }
    }
    out
}

/// Calls `f` on every list of inlines in the blocks, including titles and table cells.
pub fn visit_inlines_mut(blocks: &mut [Block], f: &mut dyn FnMut(&mut Vec<Inline>)) {
    for block in blocks {
        match block {
            Block::Paragraph(content) | Block::Heading { content, .. } => f(content),
            Block::List { items, .. } => {
                for item in items {
                    visit_inlines_mut(&mut item.blocks, f);
                }
            }
            Block::Quote(blocks) => visit_inlines_mut(blocks, f),
            Block::Callout { title, blocks, .. } => {
                f(title);
                visit_inlines_mut(blocks, f);
            }
            Block::Table { rows, .. } => rows.iter_mut().flatten().for_each(&mut *f),
            Block::Code { .. } | Block::Break => {}
        }
    }
}

/// Calls `f` on every list of inlines in the blocks.
pub fn visit_inlines(blocks: &[Block], f: &mut dyn FnMut(&[Inline])) {
    for block in blocks {
        match block {
            Block::Paragraph(content) | Block::Heading { content, .. } => f(content),
            Block::List { items, .. } => items.iter().for_each(|item| visit_inlines(&item.blocks, f)),
            Block::Quote(blocks) => visit_inlines(blocks, f),
            Block::Callout { title, blocks, .. } => {
                f(title);
                visit_inlines(blocks, f);
            }
            Block::Table { rows, .. } => rows.iter().flatten().for_each(|cell| f(cell)),
            Block::Code { .. } | Block::Break => {}
        }
    }
}

/// Appends text, joining it to the last run when the marks match.
pub fn push_text(inlines: &mut Vec<Inline>, text: &str, marks: &Marks) {
    if text.is_empty() {
        return;
    }
    if let Some(Inline::Text {
        text: last,
        marks: last_marks,
    }) = inlines.last_mut()
    {
        if last_marks == marks {
            last.push_str(text);
            return;
        }
    }
    inlines.push(Inline::marked(text, marks.clone()));
}
