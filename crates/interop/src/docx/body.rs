//! The blocks of a document as WordprocessingML paragraphs, lists, and tables.

use super::parts::xml_escape;
use super::runs::State;
use crate::doc::{push_text, Block, Inline, Item, Marks};

const SHADE: &str = "<w:shd w:val=\"clear\" w:color=\"auto\" w:fill=\"F4F0EA\"/>";
const RULE: &str = "<w:pBdr><w:bottom w:val=\"single\" w:sz=\"6\" w:space=\"1\" w:color=\"C9C2B8\"/></w:pBdr>";
/// The width of the text area of a Letter page, in twentieths of a point.
const TEXT_WIDTH: usize = 9_360;
/// How far each list level moves in, in twentieths of a point.
const LEVEL_INDENT: u32 = 720;

/// Where a block sits: inside a quote, a callout, or a list item.
#[derive(Clone, Copy, Default)]
pub(super) struct Frame {
    /// The paragraph style, such as `Quote`.
    pub style: Option<&'static str>,
    /// Whether paragraphs have a shaded background.
    pub shade: bool,
    /// The left indent for paragraphs inside a list item.
    pub indent: u32,
    /// The depth of the list that holds the block.
    pub level: u32,
}

impl Frame {
    fn props(self, num: Option<(usize, u32)>) -> String {
        let mut out = String::new();
        if let Some(style) = self.style {
            out.push_str(&format!("<w:pStyle w:val=\"{style}\"/>"));
        }
        if let Some((id, level)) = num {
            out.push_str(&format!(
                "<w:numPr><w:ilvl w:val=\"{level}\"/><w:numId w:val=\"{id}\"/></w:numPr>"
            ));
        }
        if self.shade {
            out.push_str(SHADE);
        }
        if self.indent > 0 && num.is_none() {
            out.push_str(&format!("<w:ind w:left=\"{}\"/>", self.indent));
        }
        if out.is_empty() {
            out
        } else {
            format!("<w:pPr>{out}</w:pPr>")
        }
    }
}

impl State<'_> {
    /// Writes blocks as body elements.
    pub fn blocks(&mut self, blocks: &[Block], frame: Frame) -> String {
        blocks.iter().map(|block| self.block(block, frame)).collect()
    }

    fn block(&mut self, block: &Block, frame: Frame) -> String {
        match block {
            Block::Paragraph(content) => self.paragraph(content, frame.props(None), false),
            Block::Heading { level, content } => {
                let heading = Frame {
                    style: Some(HEADINGS[usize::from((*level).clamp(1, 6)) - 1]),
                    ..Frame::default()
                };
                self.paragraph(content, heading.props(None), false)
            }
            Block::List { ordered, start, items } => self.list(*ordered, *start, items, frame),
            Block::Quote(blocks) => {
                let inner = Frame {
                    style: Some("Quote"),
                    ..frame
                };
                self.blocks(blocks, inner)
            }
            Block::Callout {
                kind, title, blocks, ..
            } => self.callout(kind, title, blocks, frame),
            Block::Code { text, .. } => self.code(text),
            Block::Break => format!("<w:p><w:pPr>{RULE}</w:pPr></w:p>"),
            Block::Table { header, rows } => self.table(*header, rows),
        }
    }

    fn paragraph(&mut self, content: &[Inline], props: String, bold: bool) -> String {
        format!("<w:p>{props}{}</w:p>", self.runs(content, bold))
    }

    fn code(&mut self, text: &str) -> String {
        let props = "<w:pPr><w:pStyle w:val=\"Code\"/></w:pPr>";
        let lines = text.split('\n').map(|line| {
            let line = xml_escape(line.trim_end_matches('\r'));
            format!("<w:p>{props}<w:r><w:t xml:space=\"preserve\">{line}</w:t></w:r></w:p>")
        });
        lines.collect()
    }

    fn callout(&mut self, kind: &str, title: &[Inline], blocks: &[Block], frame: Frame) -> String {
        let shaded = Frame { shade: true, ..frame };
        let heading = if title.is_empty() {
            vec![Inline::text(kind.to_uppercase())]
        } else {
            title.to_vec()
        };
        let mut out = self.paragraph(&heading, shaded.props(None), true);
        out.push_str(&self.blocks(blocks, shaded));
        out
    }

    fn list(&mut self, ordered: bool, start: u64, items: &[Item], frame: Frame) -> String {
        let level = frame.level;
        let num_id = if ordered {
            self.ordered.push((level, start));
            self.ordered.len() + 1
        } else {
            1
        };
        let mut out = String::new();
        for item in items {
            out.push_str(&self.item(item, num_id, frame));
        }
        out
    }

    fn item(&mut self, item: &Item, num_id: usize, frame: Frame) -> String {
        let level = frame.level;
        let inner = Frame {
            indent: LEVEL_INDENT * (level + 1),
            level: level + 1,
            style: None,
            ..frame
        };
        let mut out = String::new();
        for (i, block) in item.blocks.iter().enumerate() {
            match (i, block) {
                (0, Block::Paragraph(content)) => {
                    let content = with_checkbox(content, item.task);
                    let list_frame = Frame {
                        style: Some("ListParagraph"),
                        ..inner
                    };
                    let numbered = item.task.is_none().then_some((num_id, level));
                    let props = list_frame.props(numbered);
                    out.push_str(&self.paragraph(&content, props, false));
                }
                _ => out.push_str(&self.block(block, inner)),
            }
        }
        out
    }

    fn table(&mut self, header: bool, rows: &[Vec<Vec<Inline>>]) -> String {
        let columns = rows.iter().map(Vec::len).max().unwrap_or(1).max(1);
        let width = TEXT_WIDTH / columns;
        let border = |side: &str| format!("<w:{side} w:val=\"single\" w:sz=\"4\" w:space=\"0\" w:color=\"C9C2B8\"/>");
        let borders: String = ["top", "left", "bottom", "right", "insideH", "insideV"]
            .iter()
            .map(|s| border(s))
            .collect();
        let mut out = format!(
            "<w:tbl><w:tblPr><w:tblW w:w=\"0\" w:type=\"auto\"/><w:tblBorders>{borders}</w:tblBorders></w:tblPr>\
             <w:tblGrid>"
        );
        out.push_str(&format!("<w:gridCol w:w=\"{width}\"/>").repeat(columns));
        out.push_str("</w:tblGrid>");
        for (r, row) in rows.iter().enumerate() {
            let head = header && r == 0;
            out.push_str(if head {
                "<w:tr><w:trPr><w:tblHeader/></w:trPr>"
            } else {
                "<w:tr>"
            });
            for c in 0..columns {
                let cell = row.get(c).map_or(&[][..], Vec::as_slice);
                let paragraph = self.paragraph(cell, String::new(), head);
                out.push_str(&format!(
                    "<w:tc><w:tcPr><w:tcW w:w=\"{width}\" w:type=\"dxa\"/></w:tcPr>{paragraph}</w:tc>"
                ));
            }
            out.push_str("</w:tr>");
        }
        out.push_str("</w:tbl><w:p/>");
        out
    }
}

/// The inlines of a task item with a box in front, or the inlines as they are for any other item.
fn with_checkbox(content: &[Inline], task: Option<bool>) -> Vec<Inline> {
    let Some(done) = task else {
        return content.to_vec();
    };
    let mut out = Vec::new();
    push_text(&mut out, if done { "\u{2611} " } else { "\u{2610} " }, &Marks::none());
    for inline in content {
        match inline {
            Inline::Text { text, marks } => push_text(&mut out, text, marks),
            other => out.push(other.clone()),
        }
    }
    out
}

const HEADINGS: [&str; 6] = ["Heading1", "Heading2", "Heading3", "Heading4", "Heading5", "Heading6"];
