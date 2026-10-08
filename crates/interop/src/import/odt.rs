//! Importing OpenDocument text files (`.odt`), the format of LibreOffice and many other word processors.
//!
//! An `.odt` file is a ZIP archive with `content.xml` (the text), `styles.xml`, `meta.xml` (title, dates, and
//! keywords), and a `Pictures` folder. This reader takes headings, paragraphs, bold, italic, underline,
//! strikethrough, super and subscripts, colors, highlights, links, lists, tables, code paragraphs, and pictures.
//! One file becomes one page.

use std::collections::HashMap;
use std::io::{Read, Seek};
use std::path::Path;

use super::files::{Converted, ConvertedPage};
use super::pictures;
use super::xmltree::{Element, Node};
use super::zipxml::{first_text, ElementExt, Parts};
use crate::dates::parse_date;
use crate::dest::{self, ImportLink};
use crate::doc::{plain_text, push_text, Block, Inline, Item, Marks, Script};
use crate::error::{InteropError, Result};
use crate::page_builder::PageBuilder;
use crate::palette::{highlight_name, pen_name};
use crate::report::PageReport;
use crate::sink::ImportEnv;

/// The most columns a repeated cell may add, and the most rows a repeated row may add. A spreadsheet pasted into a
/// text document can repeat a cell a million times.
const MAX_REPEAT: usize = 64;

/// Reads one `.odt` file into a page.
pub(super) fn convert(path: &Path, env: &ImportEnv<'_>) -> Result<Converted> {
    let mut parts = Parts::open(path)?;
    let stem = path
        .file_stem()
        .map_or_else(String::new, |n| n.to_string_lossy().into_owned());
    convert_parts(&mut parts, &stem, env)
}

/// Reads an opened file. `name` stands in for a title the file does not give.
pub(super) fn convert_parts<R: Read + Seek>(
    parts: &mut Parts<R>,
    name: &str,
    env: &ImportEnv<'_>,
) -> Result<Converted> {
    let content = parts.xml("content.xml")?.ok_or_else(|| {
        InteropError::format(name, "it is not an OpenDocument text file: the file has no content.xml")
    })?;
    let mut styles = Styles::default();
    styles.read(&content);
    if let Some(named) = parts.xml("styles.xml")? {
        styles.read(&named);
    }
    let meta = parts.xml("meta.xml")?;
    let mut walker = Walker {
        styles: &styles,
        stats: Stats::default(),
        first_title: None,
    };
    let mut blocks = Vec::new();
    if let Some(text) = content.first("office:body").and_then(|b| b.first("office:text")) {
        walker.blocks(text, &mut blocks);
    }
    let now = env.clock.now();
    let (title, created, modified, keywords) = properties(meta.as_ref());
    let title = title.or(walker.first_title.take()).unwrap_or_else(|| name.to_owned());
    let created = created.unwrap_or(now);
    let modified = modified.unwrap_or(created).max(created);
    let mut builder = PageBuilder::new(env, &title, created, modified);
    builder.set_tags(keywords);
    let (placed, lost) = pictures::place(&mut blocks, &mut builder, "odt:", &mut |path| parts.bytes(path));
    let tables = blocks.iter().filter(|b| matches!(b, Block::Table { .. })).count();
    builder.push_blocks(blocks);
    let mut report = PageReport {
        title: title.clone(),
        source: name.to_owned(),
        entries: Vec::new(),
    };
    report.came_over("text and formatting");
    report.came_over_count(tables, "table", "tables");
    report.came_over_count(placed, "image", "images");
    let stats = &walker.stats;
    report.skipped_count(
        lost,
        ("image that could not be read", "images that could not be read"),
        "Its data is missing, damaged, past the size limit, or in a format that screens cannot show.",
    );
    report.simplified_count(
        stats.nested_tables,
        ("table inside a table", "tables inside tables"),
        "Each became a line of text in its cell.",
    );
    report.simplified_count(
        stats.text_boxes,
        ("text box", "text boxes"),
        "Each became ordinary paragraphs after its place in the text.",
    );
    report.skipped_count(
        stats.notes,
        ("footnote or endnote", "footnotes and endnotes"),
        "The notes themselves are not imported.",
    );
    report.skipped_count(
        stats.drawings,
        ("drawing, chart, or object", "drawings, charts, and objects"),
        "OpenNote reads pictures only.",
    );
    Ok(Converted {
        pages: vec![ConvertedPage {
            section: None,
            page: builder.finish()?,
            report,
        }],
        general: Vec::new(),
    })
}

/// The title, dates, and keywords of `meta.xml`.
fn properties(
    meta: Option<&Element>,
) -> (
    Option<String>,
    Option<opennote_core::Timestamp>,
    Option<opennote_core::Timestamp>,
    Vec<String>,
) {
    let Some(root) = meta.and_then(|m| m.first("office:meta")) else {
        return (None, None, None, Vec::new());
    };
    let keywords = root
        .elements("meta:keyword")
        .map(|k| k.all_text().trim().to_owned())
        .filter(|k| !k.is_empty())
        .collect();
    (
        first_text(root, "dc:title"),
        first_text(root, "meta:creation-date").and_then(|d| parse_date(&d)),
        first_text(root, "dc:date").and_then(|d| parse_date(&d)),
        keywords,
    )
}

/// What the document held that the page cannot.
#[derive(Default)]
struct Stats {
    nested_tables: usize,
    text_boxes: usize,
    notes: usize,
    drawings: usize,
}

/// The text properties a style sets. `None` leaves what the parent style gave.
#[derive(Clone, Default)]
struct Props {
    bold: Option<bool>,
    italic: Option<bool>,
    underline: Option<bool>,
    strike: Option<bool>,
    script: Option<Option<Script>>,
    color: Option<Option<String>>,
    highlight: Option<Option<String>>,
    code: Option<bool>,
}

impl Props {
    fn read(element: &Element) -> Props {
        let attr = |name: &str| element.attr(name).map(str::trim);
        let not_none = |v: Option<&str>| v.map(|v| !v.is_empty() && v != "none");
        Props {
            bold: attr("fo:font-weight").map(|w| w == "bold" || w.parse::<u32>().is_ok_and(|n| n >= 600)),
            italic: attr("fo:font-style").map(|s| s == "italic" || s == "oblique"),
            underline: not_none(attr("style:text-underline-style")),
            strike: not_none(attr("style:text-line-through-style")),
            script: attr("style:text-position").map(|p| {
                let first = p.split_whitespace().next().unwrap_or("");
                if first == "super" || first.starts_with('+') || first.parse::<f64>().is_ok_and(|n| n > 0.0) {
                    Some(Script::Sup)
                } else if first == "sub" || first.starts_with('-') {
                    Some(Script::Sub)
                } else {
                    None
                }
            }),
            color: attr("fo:color").map(|c| {
                let hex = c.trim_start_matches('#');
                (hex.len() == 6 && !hex.eq_ignore_ascii_case("000000")).then(|| pen_name(hex))
            }),
            highlight: attr("fo:background-color").map(|c| {
                let hex = c.trim_start_matches('#');
                (hex.len() == 6 && !hex.eq_ignore_ascii_case("ffffff"))
                    .then(|| highlight_name(hex).map_or_else(|| "honey".to_owned(), str::to_owned))
            }),
            code: attr("style:font-name")
                .or(attr("fo:font-family"))
                .map(|f| f.to_lowercase())
                .map(|f| f.contains("courier") || f.contains("mono") || f.contains("consolas")),
        }
    }

    fn apply(&self, marks: &mut Marks) {
        if let Some(v) = self.bold {
            marks.strong = v;
        }
        if let Some(v) = self.italic {
            marks.emphasis = v;
        }
        if let Some(v) = self.underline {
            marks.underline = v;
        }
        if let Some(v) = self.strike {
            marks.strike = v;
        }
        if let Some(v) = self.script {
            marks.script = v;
        }
        if let Some(v) = &self.color {
            marks.color.clone_from(v);
        }
        if let Some(v) = &self.highlight {
            marks.highlight.clone_from(v);
        }
        if let Some(v) = self.code {
            marks.code = v;
        }
    }
}

#[derive(Default)]
struct Styles {
    parents: HashMap<String, String>,
    props: HashMap<String, Props>,
    ordered: HashMap<String, bool>,
}

impl Styles {
    fn read(&mut self, root: &Element) {
        for group in root.kids().filter(|e| e.name.ends_with("styles")) {
            for style in group.kids() {
                let Some(name) = style.attr("style:name").or(style.attr("text:name")) else {
                    continue;
                };
                match style.name.as_str() {
                    "style:style" => {
                        if let Some(parent) = style.attr("style:parent-style-name") {
                            self.parents.insert(name.to_owned(), parent.to_owned());
                        }
                        if let Some(text) = style.first("style:text-properties") {
                            self.props.insert(name.to_owned(), Props::read(text));
                        }
                    }
                    "text:list-style" => {
                        let ordered = style
                            .kids()
                            .next()
                            .is_some_and(|level| level.name == "text:list-level-style-number");
                        self.ordered.insert(name.to_owned(), ordered);
                    }
                    _ => {}
                }
            }
        }
    }

    /// The style and its parents, nearest first.
    fn chain<'a>(&'a self, name: &'a str) -> Vec<&'a str> {
        let mut chain = Vec::new();
        let mut current = Some(name);
        while let Some(style) = current {
            if chain.len() >= 8 || chain.contains(&style) {
                break;
            }
            chain.push(style);
            current = self.parents.get(style).map(String::as_str);
        }
        chain
    }

    /// The marks a text style gives, on top of `base`.
    fn marks(&self, name: &str, base: &Marks) -> Marks {
        let mut marks = base.clone();
        for style in self.chain(name).into_iter().rev() {
            if let Some(props) = self.props.get(style) {
                props.apply(&mut marks);
            }
        }
        marks
    }

    fn is_code(&self, name: &str) -> bool {
        self.chain(name).iter().any(|s| {
            let lower = s.to_lowercase();
            lower.contains("preformatted") || lower.contains("source_20_code") || lower == "code"
        })
    }

    fn is_title(&self, name: &str) -> bool {
        self.chain(name).contains(&"Title")
    }
}

struct Walker<'a> {
    styles: &'a Styles,
    stats: Stats,
    first_title: Option<String>,
}

impl Walker<'_> {
    fn blocks(&mut self, parent: &Element, out: &mut Vec<Block>) {
        for child in parent.kids() {
            self.block(child, out);
        }
    }

    fn block(&mut self, child: &Element, out: &mut Vec<Block>) {
        {
            match child.name.as_str() {
                "text:h" => {
                    let content = self.paragraph(child);
                    if content.is_empty() {
                        return;
                    }
                    let level = child
                        .attr("text:outline-level")
                        .and_then(|l| l.parse::<u8>().ok())
                        .unwrap_or(1)
                        .clamp(1, 6);
                    if self.first_title.is_none() {
                        self.first_title = Some(plain_text(&content));
                    }
                    out.push(Block::Heading { level, content });
                }
                "text:p" => self.text_paragraph(child, out),
                "text:list" => {
                    let list = self.list(child, None);
                    out.extend(list);
                }
                "table:table" => {
                    let table = self.table(child, false);
                    out.push(table);
                }
                "text:note" => self.stats.notes += 1,
                "draw:frame" | "draw:g" | "draw:custom-shape" => self.stats.drawings += 1,
                // Sections, tables of contents, and anything else that wraps blocks.
                _ => self.blocks(child, out),
            }
        }
    }

    fn text_paragraph(&mut self, element: &Element, out: &mut Vec<Block>) {
        let style = element.attr("text:style-name").unwrap_or("");
        if self.styles.is_code(style) {
            let text = element.all_text();
            match out.last_mut() {
                Some(Block::Code { text: last, .. }) => {
                    last.push('\n');
                    last.push_str(&text);
                }
                _ => out.push(Block::Code {
                    language: String::new(),
                    text,
                }),
            }
            return;
        }
        let content = self.paragraph_with(element, &self.styles.marks(style, &Marks::none()));
        if content.is_empty() {
            return;
        }
        if self.styles.is_title(style) {
            if self.first_title.is_none() {
                self.first_title = Some(plain_text(&content));
            }
            out.push(Block::Heading { level: 1, content });
        } else {
            out.push(Block::Paragraph(content));
        }
    }

    fn paragraph(&mut self, element: &Element) -> Vec<Inline> {
        let style = element.attr("text:style-name").unwrap_or("");
        let base = self.styles.marks(style, &Marks::none());
        self.paragraph_with(element, &base)
    }

    fn paragraph_with(&mut self, element: &Element, marks: &Marks) -> Vec<Inline> {
        let mut out = Vec::new();
        self.inlines(element, marks, &mut out);
        // Trailing and leading spaces make a paragraph look empty, so they go.
        trim(&mut out);
        out
    }

    fn inlines(&mut self, element: &Element, marks: &Marks, out: &mut Vec<Inline>) {
        for node in &element.children {
            let child = match node {
                Node::Text(text) => {
                    let text = collapse(text, out);
                    push_text(out, &text, marks);
                    continue;
                }
                Node::Element(child) => child,
            };
            match child.name.as_str() {
                "text:s" => {
                    let count = child.attr("text:c").and_then(|c| c.parse::<usize>().ok()).unwrap_or(1);
                    push_text(out, &" ".repeat(count.min(200)), marks);
                }
                "text:tab" => push_text(out, " ", marks),
                "text:line-break" => out.push(Inline::HardBreak),
                "text:span" => {
                    let inner = self.styles.marks(child.attr("text:style-name").unwrap_or(""), marks);
                    self.inlines(child, &inner, out);
                }
                "text:a" => {
                    let mut inner = marks.clone();
                    if let Some(ImportLink::Keep(link)) = child.attr("xlink:href").map(dest::for_import) {
                        inner.link = Some(link);
                    }
                    self.inlines(child, &inner, out);
                }
                "draw:frame" => self.frame(child, out),
                "text:note" => self.stats.notes += 1,
                "text:soft-page-break" | "text:bookmark" | "text:bookmark-start" | "text:bookmark-end" => {}
                _ => self.inlines(child, marks, out),
            }
        }
    }

    /// A frame holds a picture, a text box, or something drawn.
    fn frame(&mut self, frame: &Element, out: &mut Vec<Inline>) {
        if let Some(image) = frame.first("draw:image") {
            if let Some(href) = image
                .attr("xlink:href")
                .filter(|h| !h.starts_with('#') && !h.contains("://"))
            {
                let alt = frame
                    .first("svg:desc")
                    .or(frame.first("svg:title"))
                    .map(|d| d.all_text().trim().to_owned())
                    .unwrap_or_default();
                out.push(Inline::Image {
                    dest: format!("odt:{}", href.trim_start_matches("./")),
                    alt,
                });
                return;
            }
        }
        if let Some(text_box) = frame.first("draw:text-box") {
            self.stats.text_boxes += 1;
            let text = text_box.all_text();
            push_text(out, text.trim(), &Marks::none());
            return;
        }
        self.stats.drawings += 1;
    }

    fn list(&mut self, element: &Element, inherited: Option<bool>) -> Vec<Block> {
        let ordered = element
            .attr("text:style-name")
            .and_then(|s| self.styles.ordered.get(s).copied())
            .or(inherited)
            .unwrap_or(false);
        let mut items = Vec::new();
        for item in element
            .kids()
            .filter(|i| i.name == "text:list-item" || i.name == "text:list-header")
        {
            let mut blocks = Vec::new();
            for child in item.kids() {
                if child.name == "text:list" {
                    blocks.extend(self.list(child, Some(ordered)));
                } else {
                    self.block(child, &mut blocks);
                }
            }
            if !blocks.is_empty() {
                items.push(Item { task: None, blocks });
            }
        }
        if items.is_empty() {
            return Vec::new();
        }
        vec![Block::List {
            ordered,
            start: 1,
            items,
        }]
    }

    fn table(&mut self, table: &Element, nested: bool) -> Block {
        if nested {
            self.stats.nested_tables += 1;
        }
        let mut header_rows = 0;
        let mut rows: Vec<Vec<Vec<Inline>>> = Vec::new();
        for group in table.kids() {
            match group.name.as_str() {
                "table:table-header-rows" => {
                    for row in group.elements("table:table-row") {
                        self.row(row, &mut rows);
                    }
                    header_rows = rows.len();
                }
                "table:table-row" => self.row(group, &mut rows),
                "table:table-rows" => {
                    for row in group.elements("table:table-row") {
                        self.row(row, &mut rows);
                    }
                }
                _ => {}
            }
        }
        // A table sheet sets a row of cells that are all empty past the last real one, so drop trailing empties.
        while rows.last().is_some_and(|r| r.iter().all(Vec::is_empty)) {
            rows.pop();
        }
        Block::Table {
            header: header_rows > 0,
            rows,
        }
    }

    fn row(&mut self, row: &Element, rows: &mut Vec<Vec<Vec<Inline>>>) {
        let mut cells: Vec<Vec<Inline>> = Vec::new();
        for cell in row.kids() {
            let content = match cell.name.as_str() {
                "table:table-cell" => self.cell(cell),
                "table:covered-table-cell" => Vec::new(),
                _ => continue,
            };
            let repeat = cell
                .attr("table:number-columns-repeated")
                .and_then(|r| r.parse::<usize>().ok())
                .unwrap_or(1)
                .clamp(1, MAX_REPEAT);
            let repeat = if content.is_empty() { 1 } else { repeat };
            for _ in 0..repeat {
                cells.push(content.clone());
            }
        }
        let again = row
            .attr("table:number-rows-repeated")
            .and_then(|r| r.parse::<usize>().ok())
            .unwrap_or(1)
            .clamp(1, MAX_REPEAT);
        let again = if cells.iter().all(Vec::is_empty) { 1 } else { again };
        for _ in 0..again {
            rows.push(cells.clone());
        }
    }

    fn cell(&mut self, cell: &Element) -> Vec<Inline> {
        let mut out = Vec::new();
        for child in cell.kids() {
            let line = match child.name.as_str() {
                "text:p" | "text:h" => self.paragraph(child),
                "table:table" => {
                    self.stats.nested_tables += 1;
                    let text = child.all_text();
                    vec![Inline::text(text.split_whitespace().collect::<Vec<_>>().join(" "))]
                }
                _ => continue,
            };
            if line.is_empty() {
                continue;
            }
            if !out.is_empty() {
                out.push(Inline::HardBreak);
            }
            out.extend(line);
        }
        out
    }
}

/// Collapses runs of white space to one space, as OpenDocument does, and drops a space after one already there.
fn collapse(text: &str, so_far: &[Inline]) -> String {
    let mut out = String::with_capacity(text.len());
    let mut space = match so_far.last() {
        Some(Inline::Text { text, .. }) => text.ends_with(' '),
        Some(_) | None => true,
    };
    for c in text.chars() {
        if c.is_whitespace() {
            if !space {
                out.push(' ');
            }
            space = true;
        } else {
            out.push(c);
            space = false;
        }
    }
    out
}

fn trim(inlines: &mut Vec<Inline>) {
    while let Some(Inline::Text { text, .. }) = inlines.last_mut() {
        let trimmed = text.trim_end().len();
        text.truncate(trimmed);
        if text.is_empty() {
            inlines.pop();
        } else {
            break;
        }
    }
    while let Some(Inline::Text { text, .. }) = inlines.first_mut() {
        let rest = text.trim_start().to_owned();
        if rest.is_empty() {
            inlines.remove(0);
        } else {
            *text = rest;
            break;
        }
    }
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use super::*;
    use crate::testing::{png_bytes, zip_bytes, TestEnv};

    const CONTENT: &str = r#"<office:document-content xmlns:office="o" xmlns:text="t" xmlns:table="b" xmlns:xlink="x" xmlns:draw="d">
      <office:automatic-styles>
        <style:style style:name="T1"><style:text-properties fo:font-weight="bold"/></style:style>
        <text:list-style style:name="L1"><text:list-level-style-number/></text:list-style>
      </office:automatic-styles>
      <office:body><office:text>
        <text:h text:outline-level="1">Plan</text:h>
        <text:p>Some <text:span text:style-name="T1">bold</text:span> text with a
          <text:a xlink:href="https://example.org/">link</text:a>.</text:p>
        <text:list text:style-name="L1"><text:list-item><text:p>First</text:p></text:list-item>
          <text:list-item><text:p>Second</text:p></text:list-item></text:list>
        <table:table><table:table-header-rows><table:table-row>
          <table:table-cell><text:p>Name</text:p></table:table-cell><table:table-cell><text:p>Qty</text:p></table:table-cell>
        </table:table-row></table:table-header-rows>
        <table:table-row><table:table-cell><text:p>Pens</text:p></table:table-cell>
          <table:table-cell><text:p>4</text:p></table:table-cell></table:table-row></table:table>
        <text:p><draw:frame><draw:image xlink:href="Pictures/a.png"/></draw:frame></text:p>
      </office:text></office:body></office:document-content>"#;

    #[test]
    fn a_text_document_becomes_a_page_with_its_formatting() {
        let bytes = zip_bytes(&[
            ("content.xml", CONTENT.as_bytes()),
            ("Pictures/a.png", &png_bytes()),
            (
                "meta.xml",
                b"<office:document-meta><office:meta><dc:title>Quarter plan</dc:title>\
                  <meta:keyword>work</meta:keyword></office:meta></office:document-meta>",
            ),
        ]);
        let mut parts = Parts::from_reader(Cursor::new(bytes)).expect("opens");
        let world = TestEnv::new();
        let env = world.env();
        let done = convert_parts(&mut parts, "plan", &env).expect("converts");
        let page = &done.pages[0].page.page;
        assert_eq!(page.title, "Quarter plan");
        assert_eq!(page.tags, ["work"]);
        assert_eq!(page.blocks.len(), 3, "text, table, image");
        let text = page.blocks.iter().find_map(|b| match &b.data {
            opennote_core::model::BlockData::Text(t) => Some(t.markdown.to_string()),
            _ => None,
        });
        let text = text.expect("a text block");
        assert!(text.contains("# Plan") && text.contains("**bold**"), "{text}");
        assert!(
            text.contains("[link](https://example.org/)") && text.contains("1. First"),
            "{text}"
        );
    }

    #[test]
    fn a_file_without_content_is_refused_with_its_name() {
        let bytes = zip_bytes(&[("mimetype", b"x")]);
        let mut parts = Parts::from_reader(Cursor::new(bytes)).expect("opens");
        let world = TestEnv::new();
        let env = world.env();
        let error = convert_parts(&mut parts, "plan", &env)
            .map(|_| ())
            .expect_err("refused");
        assert!(error.to_string().contains("content.xml"), "{error}");
    }
}
