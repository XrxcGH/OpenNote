//! Turning ENML, the XHTML of an Evernote note, into document blocks.
//!
//! Each `div` is a line, to-dos become task lists, `en-media` becomes an image or a file, and tables become table
//! blocks. Fonts, sizes, and the like are dropped, and the counts go to the report.

use std::collections::HashMap;

mod line;
mod style;

use self::line::{merge_tasks, trim_line, Line, TODO_DONE, TODO_OPEN};
use self::style::{code, descendants, parse_color};
use super::xmltree::{Element, Node};
use crate::dest::{self, ImportLink};
use crate::doc::html_tags::{decode_entities, mark_name};
use crate::doc::{plain_text, Block, Fold, Inline, Item, Marks, Script};

/// A piece of the converted note.
#[derive(Debug)]
pub enum Piece {
    /// A block.
    Block(Block),
    /// An attachment, by the MD5 hash of its data, to add as a file block.
    File(String),
    /// A to-do line, before neighboring to-dos are joined into a list.
    Task(bool, Vec<Inline>),
}

/// What the conversion dropped or simplified, for the report.
#[derive(Debug, Default)]
pub struct EnmlStats {
    /// Elements that set a font, a size, or a background.
    pub styled: usize,
    /// Encrypted passages, which cannot be read.
    pub encrypted: usize,
    /// Images on the web, now links.
    pub remote_images: usize,
    /// Images stored inside the text, which are not imported.
    pub data_images: usize,
    /// Links to other Evernote notes, which OpenNote cannot follow.
    pub internal_links: usize,
    /// Checked and unchecked boxes, in total.
    pub todos: usize,
    /// HTML only: links to a place in the same page, which OpenNote cannot follow.
    pub anchors: usize,
    /// HTML only: links the converter dropped, such as `javascript:` and `onenote:` links.
    pub dropped_links: usize,
    /// HTML only: images whose data the page does not hold.
    pub missing_images: usize,
}

/// What the converter needs to read HTML instead of ENML.
pub struct HtmlMode<'a> {
    /// Headings move up one level, because OpenNote's own export writes the page title as the only `h1`.
    pub shift_headings: bool,
    /// Turns the `src` of an image into the destination to use, or `None` when the image is not available. A
    /// path stays a path for the link resolver. Data from a container becomes `media:<key>`.
    pub image_dest: &'a dyn Fn(&str) -> Option<String>,
}

/// Converts ENML.
pub struct Converter<'a> {
    /// The media type of each attachment, by the MD5 hash of its data.
    media: &'a HashMap<String, String>,
    /// Set when the converter reads HTML.
    html: Option<HtmlMode<'a>>,
    /// What was dropped so far.
    pub stats: EnmlStats,
}

/// The tags that start a new block of text, separated by spaces.
const BLOCK_TAGS: &str = "div p h1 h2 h3 h4 h5 h6 ul ol li blockquote pre table hr center section article body html \
                          en-note header";

pub(super) fn is_block(name: &str) -> bool {
    BLOCK_TAGS.split_whitespace().any(|tag| tag == name)
}

fn has_block(element: &Element) -> bool {
    element.children.iter().any(|child| match child {
        Node::Element(e) => is_block(&e.name) || has_block(e),
        Node::Text(_) => false,
    })
}

impl<'a> Converter<'a> {
    /// A converter that knows the media type of each attachment by hash.
    pub fn new(media: &'a HashMap<String, String>) -> Converter<'a> {
        Converter {
            media,
            html: None,
            stats: EnmlStats::default(),
        }
    }

    /// A converter for HTML. `media` holds the media type of each `media:<key>` image the hook can return.
    pub fn html(media: &'a HashMap<String, String>, mode: HtmlMode<'a>) -> Converter<'a> {
        Converter {
            media,
            html: Some(mode),
            stats: EnmlStats::default(),
        }
    }

    /// Converts the `en-note` element.
    pub fn convert(&mut self, root: &Element) -> Vec<Piece> {
        self.blocks(&root.children, &Marks::none())
    }

    /// Converts an HTML body to blocks. Files do not exist in HTML, so only blocks come back.
    pub fn convert_blocks(&mut self, root: &Element) -> Vec<Block> {
        into_blocks(self.convert(root))
    }

    fn blocks(&mut self, nodes: &[Node], marks: &Marks) -> Vec<Piece> {
        let raw = self.blocks_raw(nodes, marks);
        merge_tasks(raw)
    }

    fn blocks_raw(&mut self, nodes: &[Node], marks: &Marks) -> Vec<Piece> {
        let mut pieces = Vec::new();
        let mut line = Line::default();
        for node in nodes {
            match node {
                Node::Text(text) => line.text(text, marks),
                Node::Element(e) if is_block(&e.name) || has_block(e) => {
                    line.flush(&mut pieces);
                    self.block(e, marks, &mut pieces);
                }
                Node::Element(e) => self.inline(e, marks, &mut line),
            }
        }
        line.flush(&mut pieces);
        pieces
    }

    fn block(&mut self, e: &Element, marks: &Marks, pieces: &mut Vec<Piece>) {
        let marks = self.apply(e, marks);
        match e.name.as_str() {
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                let level: u8 = e.name[1..].parse().unwrap_or(1);
                let level = if self.html.as_ref().is_some_and(|h| h.shift_headings) && level > 1 {
                    level - 1
                } else {
                    level
                };
                let content = self.inline_content(e, &marks);
                if !content.is_empty() {
                    pieces.push(Piece::Block(Block::Heading { level, content }));
                }
            }
            "ul" | "ol" => self.list(e, &marks, pieces),
            "blockquote" => {
                let inner = self.blocks(&e.children, &marks);
                pieces.push(Piece::Block(Block::Quote(into_blocks(inner))));
            }
            "pre" => pieces.push(code(e)),
            "div" if e.attr("style").is_some_and(|s| s.contains("-en-codeblock")) => pieces.push(code(e)),
            "table" => self.table(e, &marks, pieces),
            "hr" => pieces.push(Piece::Block(Block::Break)),
            "aside" | "details" if self.html.is_some() && has_class(e, "callout") => {
                self.callout(e, &marks, pieces);
            }
            _ => pieces.extend(self.blocks_raw(&e.children, &marks)),
        }
    }

    /// A callout that OpenNote's HTML export wrote: a title line, then the content.
    fn callout(&mut self, e: &Element, marks: &Marks, pieces: &mut Vec<Piece>) {
        let kind = e.attr("data-kind").unwrap_or("note").to_lowercase();
        let fold = (e.name == "details").then(|| {
            if e.attr("open").is_some() {
                Fold::Open
            } else {
                Fold::Folded
            }
        });
        let is_title = |n: &Node| matches!(n, Node::Element(c) if c.name == "summary" || has_class(c, "callout-title"));
        let title = match e.children.iter().find(|n| is_title(n)) {
            Some(Node::Element(t)) => self.inline_content(t, marks),
            _ => Vec::new(),
        };
        let default_title = plain_text(&title).eq_ignore_ascii_case(&kind);
        let rest: Vec<Node> = e.children.iter().filter(|n| !is_title(n)).cloned().collect();
        let blocks = into_blocks(self.blocks(&rest, marks));
        pieces.push(Piece::Block(Block::Callout {
            kind,
            fold,
            title: if default_title { Vec::new() } else { title },
            blocks,
        }));
    }

    fn inline_content(&mut self, e: &Element, marks: &Marks) -> Vec<Inline> {
        let mut line = Line::default();
        for child in &e.children {
            match child {
                Node::Text(text) => line.text(text, marks),
                Node::Element(child) => self.inline(child, marks, &mut line),
            }
        }
        let mut inlines = std::mem::take(&mut line.inlines);
        trim_line(&mut inlines);
        inlines
    }

    fn list(&mut self, e: &Element, marks: &Marks, pieces: &mut Vec<Piece>) {
        let mut items = Vec::new();
        let mut files = Vec::new();
        for child in &e.children {
            let Node::Element(li) = child else {
                continue;
            };
            let mut inner = self.blocks_raw(&li.children, marks);
            let task = match inner.first() {
                Some(Piece::Task(done, _)) => Some(*done),
                _ => None,
            };
            if task.is_some() {
                if let Piece::Task(_, inlines) = inner.remove(0) {
                    inner.insert(0, Piece::Block(Block::Paragraph(inlines)));
                }
            }
            let mut blocks = Vec::new();
            for piece in merge_tasks(inner) {
                match piece {
                    Piece::Block(block) => blocks.push(block),
                    Piece::File(hash) => files.push(Piece::File(hash)),
                    Piece::Task(..) => {}
                }
            }
            items.push(Item { task, blocks });
        }
        if !items.is_empty() {
            let start = e.attr("start").and_then(|s| s.parse().ok()).unwrap_or(1);
            pieces.push(Piece::Block(Block::List {
                ordered: e.name == "ol",
                start,
                items,
            }));
        }
        pieces.extend(files);
    }

    fn table(&mut self, e: &Element, marks: &Marks, pieces: &mut Vec<Piece>) {
        let mut rows = Vec::new();
        let mut header = false;
        for row in descendants(e, "tr") {
            let cells: Vec<&Element> = row
                .children
                .iter()
                .filter_map(|n| match n {
                    Node::Element(c) if c.name == "td" || c.name == "th" => Some(c),
                    _ => None,
                })
                .collect();
            header |= rows.is_empty() && cells.iter().any(|c| c.name == "th");
            rows.push(cells.iter().map(|cell| self.cell(cell, marks)).collect());
        }
        if !rows.is_empty() {
            pieces.push(Piece::Block(Block::Table { header, rows }));
        }
    }

    /// The inlines of a table cell: its lines, joined by breaks.
    fn cell(&mut self, cell: &Element, marks: &Marks) -> Vec<Inline> {
        let mut inlines = Vec::new();
        for piece in self.blocks(&cell.children, marks) {
            let content = match piece {
                Piece::Block(Block::Paragraph(content) | Block::Heading { content, .. }) => content,
                Piece::Task(_, content) => content,
                _ => continue,
            };
            if !inlines.is_empty() {
                inlines.push(Inline::HardBreak);
            }
            inlines.extend(content);
        }
        inlines
    }

    fn inline(&mut self, e: &Element, marks: &Marks, line: &mut Line) {
        match e.name.as_str() {
            "br" => line.inlines.push(Inline::HardBreak),
            "en-todo" => {
                self.stats.todos += 1;
                let done = e.attr("checked") == Some("true");
                let mark = if done { TODO_DONE } else { TODO_OPEN };
                line.inlines.push(Inline::text(mark.to_string()));
            }
            "input" if e.attr("type") == Some("checkbox") => {
                self.stats.todos += 1;
                let mark = if e.attr("checked").is_some() {
                    TODO_DONE
                } else {
                    TODO_OPEN
                };
                line.inlines.push(Inline::text(mark.to_string()));
            }
            "en-media" => self.media(e, line),
            "en-crypt" => {
                self.stats.encrypted += 1;
                line.text("[encrypted text]", marks);
            }
            "img" => self.image(e, line),
            _ => {
                let marks = self.apply(e, marks);
                for child in &e.children {
                    match child {
                        Node::Text(text) => line.text(text, &marks),
                        Node::Element(child) => self.inline(child, &marks, line),
                    }
                }
            }
        }
    }

    fn media(&mut self, e: &Element, line: &mut Line) {
        let hash = e.attr("hash").unwrap_or("").to_lowercase();
        let mime = self
            .media
            .get(&hash)
            .map(String::as_str)
            .or_else(|| e.attr("type"))
            .unwrap_or("");
        if mime.starts_with("image/") {
            line.inlines.push(Inline::Image {
                dest: format!("media:{hash}"),
                alt: String::new(),
            });
        } else {
            line.files.push(hash);
        }
    }

    fn image(&mut self, e: &Element, line: &mut Line) {
        let src = e.attr("src").unwrap_or("");
        let alt = e.attr("alt").unwrap_or("");
        let remote = src.starts_with("http://") || src.starts_with("https://");
        if remote {
            self.stats.remote_images += 1;
            let label = if alt.is_empty() { src } else { alt };
            line.inlines.push(Inline::marked(label, Marks::link(src)));
        } else if let Some(html) = &self.html {
            if let Some(dest) = (html.image_dest)(src) {
                line.inlines.push(Inline::Image {
                    dest,
                    alt: alt.to_owned(),
                });
            } else {
                self.stats.missing_images += 1;
            }
        } else {
            self.stats.data_images += 1;
        }
    }

    /// The marks of an element's content: its tag, and the parts of its `style` that OpenNote keeps.
    fn apply(&mut self, e: &Element, marks: &Marks) -> Marks {
        let mut marks = marks.clone();
        match e.name.as_str() {
            "b" | "strong" => marks.strong = true,
            "i" | "em" => marks.emphasis = true,
            "u" => marks.underline = true,
            "s" | "strike" | "del" => marks.strike = true,
            "sub" => marks.script = Some(Script::Sub),
            "sup" => marks.script = Some(Script::Sup),
            "code" | "tt" | "kbd" => marks.code = true,
            "mark" if self.html.is_some() => {
                let name = e.attr("data-color").map_or(Some("honey".to_owned()), mark_name);
                marks.highlight = name.or(marks.highlight);
            }
            "span" if self.html.is_some() => {
                marks.color = e.attr("data-color").and_then(mark_name).or(marks.color);
                marks.size = e.attr("data-size").and_then(mark_name).or(marks.size);
            }
            "a" => self.apply_link(e, &mut marks),
            "font" => {
                self.stats.styled += usize::from(e.attr("face").is_some() || e.attr("size").is_some());
                marks.color = e.attr("color").and_then(parse_color).or(marks.color);
            }
            _ => {}
        }
        if let Some(style) = e.attr("style") {
            self.apply_style(style, &mut marks);
        }
        marks
    }

    fn apply_link(&mut self, e: &Element, marks: &mut Marks) {
        let Some(href) = e.attr("href") else {
            return;
        };
        if self.html.is_some() {
            self.apply_html_link(href, marks);
        } else if ["http:", "https:", "mailto:"].iter().any(|s| href.starts_with(s)) {
            marks.link = Some(decode_entities(href));
        } else if href.starts_with("evernote:") {
            self.stats.internal_links += 1;
        }
    }

    /// In HTML, the schemes of [`dest::for_import`] stay, a path stays for the link resolver, and the rest is
    /// dropped. The check reads the address the way a browser does, so a tab inside `javascript:` does not pass.
    fn apply_html_link(&mut self, href: &str, marks: &mut Marks) {
        let href = dest::clean(href);
        if href.is_empty() {
            return;
        }
        if href.starts_with('#') {
            self.stats.anchors += 1;
            return;
        }
        match dest::for_import(&href) {
            ImportLink::Keep(kept) | ImportLink::Path(kept) => marks.link = Some(kept),
            ImportLink::Refuse => self.stats.dropped_links += 1,
        }
    }

    fn apply_style(&mut self, style: &str, marks: &mut Marks) {
        for declaration in style.split(';') {
            let Some((key, value)) = declaration.split_once(':') else {
                continue;
            };
            let (key, value) = (key.trim().to_lowercase(), value.trim().to_lowercase());
            match key.as_str() {
                "font-weight" if value == "bold" || value.parse::<u32>().is_ok_and(|w| w >= 600) => marks.strong = true,
                "font-style" if value == "italic" => marks.emphasis = true,
                "text-decoration" | "text-decoration-line" => {
                    marks.underline |= value.contains("underline");
                    marks.strike |= value.contains("line-through");
                }
                "color" => marks.color = parse_color(&value).or(marks.color.take()),
                "font-family" | "font-size" | "background-color" | "background" => self.stats.styled += 1,
                _ => {}
            }
        }
    }
}

fn has_class(e: &Element, class: &str) -> bool {
    e.attr("class")
        .is_some_and(|classes| classes.split_whitespace().any(|c| c == class))
}

fn into_blocks(pieces: Vec<Piece>) -> Vec<Block> {
    pieces
        .into_iter()
        .filter_map(|piece| match piece {
            Piece::Block(block) => Some(block),
            Piece::File(_) | Piece::Task(..) => None,
        })
        .collect()
}
