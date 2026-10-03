//! Reading Markdown into the document tree. It accepts all of CommonMark, plus the GFM strikethrough, task lists
//! and tables, Obsidian wiki links, `==highlights==`, and the HTML tags of spec 7.4.

mod clean;
mod highlight;

use pulldown_cmark::{CodeBlockKind, Event, LinkType, Options, Parser, Tag, TagEnd};

use self::clean::{clean_alt, clean_language, split_callout, tidy};
use super::html_tags::{self, apply_tag, Piece, Span};
use super::{push_text, visit_inlines_mut, Block, Inline, Item, Marks};

/// What a line break inside a paragraph becomes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SoftBreaks {
    /// A space, as CommonMark shows it.
    Space,
    /// A hard break, as Obsidian and Joplin show it.
    Hard,
}

/// Things the parser left out or simplified, for import reports.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Notes {
    /// HTML tags that have no meaning in OpenNote, dropped with their text kept.
    pub html_dropped: usize,
    /// Tables inside lists or quotes, written as plain lines.
    pub tables_flattened: usize,
}

/// A parsed document.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Parsed {
    /// The blocks.
    pub blocks: Vec<Block>,
    /// What was simplified.
    pub notes: Notes,
}

/// Wiki links get this prefix in their destination, until an import resolves them.
pub const WIKI_PREFIX: &str = "wiki:";

/// How deep quotes and lists nest before the reader stops nesting them and keeps their content flat. The tree's
/// walks, writers, and drop are recursive, so a note of a hundred thousand `>` would overflow the stack.
pub const MAX_NESTING: usize = 64;

/// Reads Markdown.
pub fn parse(markdown: &str, soft: SoftBreaks) -> Parsed {
    let options =
        Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TASKLISTS | Options::ENABLE_TABLES | Options::ENABLE_WIKILINKS;
    let mut builder = Builder::default();
    builder.frames.push(Frame::Container(Kind::Root, Vec::new()));
    for event in Parser::new_ext(markdown, options) {
        builder.event(event);
    }
    builder.finish(soft)
}

enum Kind {
    Root,
    Quote,
    Item(Option<bool>),
}

enum Frame {
    Container(Kind, Vec<Block>),
    List {
        ordered: bool,
        start: u64,
        items: Vec<Item>,
    },
}

#[derive(Default)]
struct Builder {
    frames: Vec<Frame>,
    cur: Vec<Inline>,
    md: Marks,
    md_stack: Vec<Marks>,
    html: Marks,
    spans: Vec<Span>,
    highlight_open: Option<usize>,
    heading: Option<usize>,
    code: Option<(String, String)>,
    image: Option<(String, String)>,
    html_block: Option<String>,
    table: Vec<Vec<Vec<Inline>>>,
    row: Vec<Vec<Inline>>,
    notes: Notes,
    /// Quotes, lists, and items opened past [`MAX_NESTING`], whose content goes to the deepest container kept.
    too_deep: usize,
}

impl Builder {
    fn marks(&self) -> Marks {
        let (md, html) = (&self.md, &self.html);
        let highlight = html.highlight.clone().or_else(|| md.highlight.clone());
        Marks {
            link: md.link.clone(),
            strong: md.strong || html.strong,
            emphasis: md.emphasis || html.emphasis,
            strike: md.strike || html.strike,
            underline: md.underline || html.underline,
            highlight,
            color: html.color.clone().or_else(|| md.color.clone()),
            size: html.size.clone().or_else(|| md.size.clone()),
            script: html.script.or(md.script),
            code: md.code || html.code,
        }
    }

    fn event(&mut self, event: Event<'_>) {
        match event {
            Event::Start(tag) => self.start(tag),
            Event::End(tag) => self.end(tag),
            Event::Text(text) => self.text(&text),
            Event::Code(code) => {
                let marks = Marks {
                    code: true,
                    ..self.marks()
                };
                self.push_inline_text(&code, &marks);
            }
            Event::Html(html) if self.html_block.is_some() => {
                self.html_block.get_or_insert_with(String::new).push_str(&html);
            }
            Event::Html(html) | Event::InlineHtml(html) => self.html(&html),
            Event::SoftBreak if self.image.is_some() => self.text(" "),
            Event::SoftBreak => self.cur.push(Inline::SoftBreak),
            Event::HardBreak => self.cur.push(Inline::HardBreak),
            Event::Rule => {
                self.flush();
                self.add_block(Block::Break);
            }
            Event::TaskListMarker(_) if self.too_deep > 0 => {}
            Event::TaskListMarker(done) => {
                if let Some(Frame::Container(Kind::Item(task), _)) = self.frames.last_mut() {
                    *task = Some(done);
                }
            }
            _ => {}
        }
    }

    fn start(&mut self, tag: Tag<'_>) {
        match tag {
            Tag::Emphasis => self.push_marks(|m| m.emphasis = true),
            Tag::Strong => self.push_marks(|m| m.strong = true),
            Tag::Strikethrough => self.push_marks(|m| m.strike = true),
            Tag::Link {
                link_type, dest_url, ..
            } => {
                let dest = match link_type {
                    LinkType::WikiLink { .. } => format!("{WIKI_PREFIX}{dest_url}"),
                    LinkType::Email => format!("mailto:{dest_url}"),
                    _ => dest_url.to_string(),
                };
                self.push_marks(|m| m.link = Some(dest));
            }
            Tag::Image { dest_url, .. } => self.image = Some((dest_url.to_string(), String::new())),
            Tag::TableHead | Tag::TableRow => self.row.clear(),
            other => self.start_block(other),
        }
    }

    /// Starts a block, ending the paragraph in progress.
    fn start_block(&mut self, tag: Tag<'_>) {
        if !matches!(tag, Tag::Paragraph | Tag::TableCell) {
            self.flush();
        }
        if self.skips_container(&tag) {
            self.too_deep += 1;
            return;
        }
        match tag {
            Tag::Heading { level, .. } => self.heading = Some(level as usize),
            Tag::BlockQuote(_) => self.frames.push(Frame::Container(Kind::Quote, Vec::new())),
            Tag::CodeBlock(kind) => {
                let language = match kind {
                    CodeBlockKind::Fenced(info) => info.split_whitespace().next().unwrap_or("").to_owned(),
                    CodeBlockKind::Indented => String::new(),
                };
                self.code = Some((language, String::new()));
            }
            Tag::HtmlBlock => self.html_block = Some(String::new()),
            Tag::List(start) => self.frames.push(Frame::List {
                ordered: start.is_some(),
                start: start.unwrap_or(1),
                items: Vec::new(),
            }),
            Tag::Item => self.frames.push(Frame::Container(Kind::Item(None), Vec::new())),
            Tag::Table(_) => self.table.clear(),
            _ => {}
        }
    }

    /// Whether a quote, list, or item opens too deep to nest. Once one is skipped, every container inside it is
    /// skipped too. A list needs room for its items, so the deepest container kept is never a bare list.
    fn skips_container(&self, tag: &Tag<'_>) -> bool {
        let room = match tag {
            Tag::BlockQuote(_) | Tag::Item => MAX_NESTING,
            Tag::List(_) => MAX_NESTING - 1,
            _ => return false,
        };
        self.too_deep > 0 || self.frames.len() >= room
    }

    fn push_marks(&mut self, change: impl FnOnce(&mut Marks)) {
        self.md_stack.push(self.md.clone());
        change(&mut self.md);
    }

    fn end(&mut self, tag: TagEnd) {
        if self.end_skipped(&tag) {
            return;
        }
        match tag {
            TagEnd::Paragraph => self.flush(),
            TagEnd::Heading(_) => {
                let level = self.heading.take().unwrap_or(1);
                let content = self.take_inlines();
                self.add_block(Block::Heading {
                    level: level.clamp(1, 6) as u8,
                    content,
                });
            }
            TagEnd::BlockQuote(_) => self.end_quote(),
            TagEnd::CodeBlock => self.end_code(),
            TagEnd::HtmlBlock => {
                let html = self.html_block.take().unwrap_or_default();
                self.html(&html);
                self.flush();
            }
            TagEnd::List(_) => self.end_list(),
            TagEnd::Item => self.end_item(),
            TagEnd::Emphasis | TagEnd::Strong | TagEnd::Strikethrough | TagEnd::Link => {
                self.md = self.md_stack.pop().unwrap_or_default();
            }
            TagEnd::Image => {
                if let Some((dest, alt)) = self.image.take() {
                    self.cur.push(Inline::Image {
                        dest,
                        alt: clean_alt(&alt),
                    });
                }
            }
            TagEnd::TableCell => {
                let cell = self.take_inlines();
                self.row.push(cell);
            }
            TagEnd::TableHead | TagEnd::TableRow => self.table.push(std::mem::take(&mut self.row)),
            TagEnd::Table => self.end_table(),
            _ => {}
        }
    }

    /// Ends a container that [`Builder::skips_container`] skipped, keeping its content flat.
    fn end_skipped(&mut self, tag: &TagEnd) -> bool {
        let skipped = self.too_deep > 0 && matches!(tag, TagEnd::BlockQuote(_) | TagEnd::List(_) | TagEnd::Item);
        if skipped {
            self.flush();
            self.too_deep -= 1;
        }
        skipped
    }

    fn end_code(&mut self) {
        if let Some((language, mut text)) = self.code.take() {
            if text.ends_with('\n') {
                text.pop();
            }
            self.add_block(Block::Code {
                language: clean_language(&language),
                text,
            });
        }
    }

    fn end_list(&mut self) {
        if let Some(Frame::List { ordered, start, items }) = self.frames.pop() {
            self.add_block(Block::List { ordered, start, items });
        }
    }

    fn end_item(&mut self) {
        self.flush();
        if let Some(Frame::Container(Kind::Item(task), blocks)) = self.frames.pop() {
            if let Some(Frame::List { items, .. }) = self.frames.last_mut() {
                items.push(Item { task, blocks });
            }
        }
    }

    fn end_quote(&mut self) {
        self.flush();
        let Some(Frame::Container(_, mut blocks)) = self.frames.pop() else {
            return;
        };
        let block = match split_callout(&blocks) {
            Some(callout) => callout,
            None => Block::Quote(std::mem::take(&mut blocks)),
        };
        self.add_block(block);
    }

    fn end_table(&mut self) {
        let rows = std::mem::take(&mut self.table);
        if self.frames.len() == 1 {
            self.add_block(Block::Table { header: true, rows });
            return;
        }
        self.notes.tables_flattened += 1;
        let mut lines: Vec<Inline> = Vec::new();
        for (i, row) in rows.into_iter().enumerate() {
            if i > 0 {
                lines.push(Inline::HardBreak);
            }
            for (j, cell) in row.into_iter().enumerate() {
                if j > 0 {
                    lines.push(Inline::text(" | "));
                }
                lines.extend(cell);
            }
        }
        self.add_block(Block::Paragraph(lines));
    }

    fn take_inlines(&mut self) -> Vec<Inline> {
        self.revert_open_highlight();
        std::mem::take(&mut self.cur)
    }

    /// Ends the paragraph in progress, if there is text in it.
    fn flush(&mut self) {
        let inlines = self.take_inlines();
        if !inlines.is_empty() {
            self.add_block(Block::Paragraph(inlines));
        }
    }

    fn add_block(&mut self, block: Block) {
        if let Some(Frame::Container(_, blocks)) = self.frames.last_mut() {
            blocks.push(block);
        }
    }

    fn push_inline_text(&mut self, text: &str, marks: &Marks) {
        if let Some((_, alt)) = self.image.as_mut() {
            alt.push_str(text);
        } else if let Some((_, code)) = self.code.as_mut() {
            code.push_str(text);
        } else {
            push_text(&mut self.cur, text, marks);
        }
    }

    fn html(&mut self, html: &str) {
        for piece in html_tags::tokenize(html) {
            match piece {
                Piece::Text(text) => self.plain(&text),
                Piece::Tag(tag) if tag.name == "br" => self.cur.push(Inline::HardBreak),
                Piece::Tag(tag) if tag.name == "img" => {
                    let dest = tag.attr("src").unwrap_or("").to_owned();
                    let alt = tag.attr("alt").unwrap_or("").to_owned();
                    self.cur.push(Inline::Image { dest, alt });
                }
                Piece::Tag(tag) => {
                    if !apply_tag(&tag, &mut self.html, &mut self.spans) && !tag.closing {
                        self.notes.html_dropped += 1;
                    }
                }
            }
        }
    }

    fn finish(mut self, soft: SoftBreaks) -> Parsed {
        self.flush();
        let mut blocks = match self.frames.pop() {
            Some(Frame::Container(_, blocks)) => blocks,
            _ => Vec::new(),
        };
        visit_inlines_mut(&mut blocks, &mut |inlines| tidy(inlines, soft));
        Parsed {
            blocks,
            notes: self.notes,
        }
    }
}
