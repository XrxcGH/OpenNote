//! The blocks of a document as WordprocessingML paragraphs, lists, and tables, with the paragraph formatting,
//! named styles, and lists of their text blocks.

use super::parts::xml_escape;
use super::ppr::{drop_cap_frame, ParaProps};
use super::runs::State;
use super::styles::style_id;
use crate::doc::data::{Element, Para};
use crate::doc::{push_text, Block, Inline, Item, Marks};

const RULE: &str = "<w:pBdr><w:bottom w:val=\"single\" w:sz=\"6\" w:space=\"1\" w:color=\"C9C2B8\"/></w:pBdr>";
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

impl State<'_> {
    /// The element at the current path, when the text part has records.
    fn element(&self) -> Option<&Element> {
        self.elements.get(&self.path)
    }

    /// The Word style of the current element, when the sheet defines its style.
    fn element_style(&self) -> Option<String> {
        let style = self.element()?.style.as_ref()?;
        self.style_names.contains(style).then(|| style_id(style))
    }

    fn element_para(&self) -> Option<Para> {
        self.element()?.para.clone()
    }

    /// Writes blocks as body elements.
    pub fn blocks(&mut self, blocks: &[Block], frame: Frame) -> String {
        let mut out = String::new();
        for (i, block) in blocks.iter().enumerate() {
            self.path.push(i);
            out.push_str(&self.block(block, frame));
            self.path.pop();
        }
        out
    }

    fn block(&mut self, block: &Block, frame: Frame) -> String {
        match block {
            Block::Paragraph(content) => {
                let style = self.element_style().or_else(|| frame.style.map(str::to_owned));
                self.formatted(content, style, frame, None)
            }
            Block::Heading { level, content } => {
                let default = format!("Heading{}", (*level).clamp(1, 6));
                let style = self.element_style().unwrap_or(default);
                self.formatted(content, Some(style), Frame::default(), None)
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
            Block::Table {
                header,
                rows,
                cell_styles,
                merges,
                widths,
            } => self.table(*header, rows, cell_styles, merges, widths),
        }
    }

    /// A paragraph with the current element's formatting over the frame's. A drop cap becomes a framed paragraph
    /// of its own with the first letter, as Word writes one.
    fn formatted(
        &mut self,
        content: &[Inline],
        style: Option<String>,
        frame: Frame,
        num: Option<(usize, u32)>,
    ) -> String {
        let para = self.element_para();
        let mut out = String::new();
        let mut content = content.to_vec();
        if let Some(cap) = para.as_ref().and_then(|p| p.drop_cap.clone()) {
            if let Some((letter, rest)) = split_first_letter(&content) {
                // The letter and the rest are two runs now, so a comment over both has one more run to end.
                if let (Some(Inline::Text { marks, .. }), false) = (rest.first(), rest.len() < content.len()) {
                    self.count_comments(&[Inline::marked("", marks.clone())]);
                }
                let props = ParaProps {
                    style: style.clone(),
                    frame_pr: Some(drop_cap_frame(&cap.mode, cap.lines, cap.distance)),
                    ..ParaProps::default()
                };
                out.push_str(&format!("<w:p>{}{}</w:p>", props.xml(), self.runs(&letter, false)));
                content = rest;
            }
        }
        let props = ParaProps {
            style,
            num,
            para: para.as_ref(),
            frame_shade: frame.shade,
            frame_indent: frame.indent,
            ..ParaProps::default()
        };
        let xml = props.xml();
        out.push_str(&format!("<w:p>{xml}{}</w:p>", self.runs(&content, false)));
        out
    }

    fn code(&mut self, text: &str) -> String {
        let para = self.element_para();
        let props = ParaProps {
            style: Some(self.element_style().unwrap_or_else(|| "Code".to_owned())),
            para: para.as_ref(),
            ..ParaProps::default()
        }
        .xml();
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
        let props = ParaProps {
            style: self.element_style().or_else(|| frame.style.map(str::to_owned)),
            para: self.element_para().as_ref(),
            frame_shade: true,
            frame_indent: frame.indent,
            ..ParaProps::default()
        }
        .xml();
        let mut out = format!("<w:p>{props}{}</w:p>", self.runs(&heading, true));
        out.push_str(&self.blocks(blocks, shaded));
        out
    }

    fn list(&mut self, ordered: bool, start: u64, items: &[Item], frame: Frame) -> String {
        let mut plain: Option<usize> = None;
        let mut out = String::new();
        for (j, item) in items.iter().enumerate() {
            self.path.push(j);
            let num = self.item_num(ordered, start, frame.level, &mut plain);
            out.push_str(&self.item(item, num, frame));
            self.path.pop();
        }
        out
    }

    /// The list of the item at the current path: its list ID's list, a restart of it, or the Markdown list's own.
    fn item_num(&mut self, ordered: bool, start: u64, level: u32, plain: &mut Option<usize>) -> usize {
        let list = self.element_para().and_then(|p| p.list);
        let Some(list) = list else {
            return *plain.get_or_insert_with(|| {
                if ordered {
                    self.lists.numbered(level, start)
                } else {
                    self.lists.bullets()
                }
            });
        };
        let def = self.data.and_then(|d| d.lists.get(&list.id)).cloned();
        let abstract_id = match self.list_defs.get(&list.id) {
            Some(id) => *id,
            None => {
                let id = match &def {
                    Some(def) => self.lists.define(def, ordered),
                    None => usize::from(ordered),
                };
                self.list_defs.insert(list.id.clone(), id);
                id
            }
        };
        let current = self.list_nums.get(&list.id).copied();
        let num = match current {
            Some(num) if !list.restart => num,
            _ => {
                let first = self.lists.level_start(abstract_id, level);
                // A list with no definition starts where its Markdown says, as version 1 lists do.
                let begin = if def.is_none() && current.is_none() {
                    start
                } else {
                    first
                };
                self.lists.list(abstract_id, Some((level, begin)))
            }
        };
        self.list_nums.insert(list.id.clone(), num);
        self.doc_list_nums.insert(list.id.clone(), num);
        num
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
                    let numbered = item.task.is_none().then_some((num_id, level));
                    let style = self.element_style().unwrap_or_else(|| "ListParagraph".to_owned());
                    out.push_str(&self.formatted(&content, Some(style), inner, numbered));
                }
                _ => {
                    self.path.push(i);
                    out.push_str(&self.block(block, inner));
                    self.path.pop();
                }
            }
        }
        out
    }
}

/// The first letter of a paragraph and the rest, for a drop cap. `None` when it starts with no text.
fn split_first_letter(content: &[Inline]) -> Option<(Vec<Inline>, Vec<Inline>)> {
    let Some(Inline::Text { text, marks }) = content.first() else {
        return None;
    };
    let letter = text.chars().next()?;
    let rest_text = &text[letter.len_utf8()..];
    let mut rest = Vec::new();
    if !rest_text.is_empty() {
        rest.push(Inline::marked(rest_text, marks.clone()));
    }
    rest.extend(content[1..].iter().cloned());
    Some((vec![Inline::marked(letter.to_string(), marks.clone())], rest))
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
