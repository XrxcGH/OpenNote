//! The neutral document tree that every converter reads or writes.
//!
//! It has the shape of the tree in `docs/format/fixtures/markdown/documents/README.md`: blocks hold runs of text,
//! and each run carries its marks. Parsing turns Markdown (OpenNote, Obsidian, or Joplin) into this tree, and the
//! writers turn it into canonical OpenNote Markdown (spec 7), HTML, or Word.

pub mod escape;
pub(crate) mod html_tags;
mod inline;
pub mod parse;
pub mod write;

/// Subscript or superscript.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Script {
    /// Lowered text.
    Sub,
    /// Raised text.
    Sup,
}

/// The marks of a run of text. The fields follow the nesting order of spec 7.7, outermost first.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct Marks {
    /// The link destination.
    pub link: Option<String>,
    /// Strong emphasis.
    pub strong: bool,
    /// Emphasis.
    pub emphasis: bool,
    /// Strikethrough.
    pub strike: bool,
    /// Underline.
    pub underline: bool,
    /// A highlighter name, where `honey` is the default highlight.
    pub highlight: Option<String>,
    /// A pen name or `#rrggbb`.
    pub color: Option<String>,
    /// `small`, `large`, or `xlarge`.
    pub size: Option<String>,
    /// Subscript or superscript.
    pub script: Option<Script>,
    /// Inline code.
    pub code: bool,
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
    },
}

/// The text of inlines with no marks, for titles and names. A break becomes a space.
pub fn plain_text(inlines: &[Inline]) -> String {
    let mut out = String::new();
    for inline in inlines {
        match inline {
            Inline::Text { text, .. } => out.push_str(text),
            Inline::HardBreak | Inline::SoftBreak => out.push(' '),
            Inline::Image { alt, .. } => out.push_str(alt),
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
