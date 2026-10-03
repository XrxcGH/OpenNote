//! `page.md` (spec 11.1): front matter, the title, the handwriting line, and the blocks in reading order.

use super::{quoted, seal};
use crate::format::markdown::{escape_text, one_line, rewrite_links, write_destination};
use crate::id::{AssetId, BlockId, PageId};
use crate::model::{Block, BlockData, InkBlockData, InkRole, Page, TableData};
use crate::seams::LinkResolver;

/// The line for a block of a type this version doesn't know, and for a block that couldn't be read.
pub const NEWER_VERSION_LINE: &str = "*This part of the page needs a newer version of OpenNote.*";
/// The line that shows the page's handwriting.
pub const HANDWRITING_LINE: &str = "![Handwriting on this page](ink.svg)";

/// Resolves assets from the page's own table first.
struct PageLinks<'a> {
    page: &'a Page,
    links: &'a dyn LinkResolver,
}

impl LinkResolver for PageLinks<'_> {
    fn page_md(&self, from: PageId, to: PageId) -> Option<String> {
        self.links.page_md(from, to)
    }

    fn asset_file(&self, asset: AssetId) -> Option<String> {
        match self.page.assets.get(&asset) {
            Some(entry) => Some(entry.file.clone()),
            None => self.links.asset_file(asset),
        }
    }
}

/// One part of the body of `page.md`, which a blank line separates from the next.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BodyPart {
    /// The block the part renders, or `None` for the title and the handwriting line.
    pub block: Option<BlockId>,
    /// The part as `page.md` writes it, never empty.
    pub text: String,
}

/// The parts of the body of `page.md`, in the order the file writes them.
pub fn body_parts(page: &Page, links: &dyn LinkResolver) -> Vec<BodyPart> {
    let links = PageLinks { page, links };
    let mut parts = Vec::new();
    let title = one_line(&page.title);
    if !title.is_empty() {
        parts.push(BodyPart {
            block: None,
            text: format!("# {}", escape_text(&title, true)),
        });
    }
    if has_ink(page) {
        parts.push(BodyPart {
            block: None,
            text: HANDWRITING_LINE.to_owned(),
        });
    }
    for id in page.reading_order() {
        if let Some(block) = page.blocks.get(id) {
            let text = render_block(block, &links).filter(|text| !text.is_empty());
            parts.extend(text.map(|text| BodyPart { block: Some(id), text }));
        }
    }
    parts
}

/// Renders `page.md` with its checksum (spec 11.1).
pub fn render_page_md(page: &Page, links: &dyn LinkResolver) -> Vec<u8> {
    let mut text = front_matter(page);
    let parts: Vec<String> = body_parts(page, links).into_iter().map(|part| part.text).collect();
    if !parts.is_empty() {
        text.push('\n');
        // Markdown never holds U+0000, which CommonMark reads as U+FFFD (spec 7.6). A zero byte would also make
        // the file look damaged by a power cut (spec 11.2).
        text.push_str(&parts.join("\n\n").replace('\0', "\u{fffd}"));
        text.push('\n');
    }
    seal(text)
}

fn front_matter(page: &Page) -> String {
    let mut out = String::from("---\n");
    out.push_str(&format!("title: {}\n", quoted(&page.title)));
    if !page.tags.is_empty() {
        let tags: Vec<String> = page.tags.iter().map(|t| quoted(t)).collect();
        out.push_str(&format!("tags: [{}]\n", tags.join(", ")));
    }
    out.push_str(&format!("created: \"{}\"\n", page.created.to_rfc3339()));
    out.push_str(&format!("modified: \"{}\"\n", page.modified.to_rfc3339()));
    out.push_str("opennote:\n");
    out.push_str(&format!("  page: \"{}\"\n", page.id));
    out.push_str(&format!("  revision: \"{}\"\n", page.revision.id));
    out.push_str(&format!("  format: {}\n", crate::FORMAT_VERSION));
    out.push_str("  checksum: \"crc32:00000000\"\n---\n");
    out
}

/// Whether the page has at least one stroke: live ink, or an ink block that counts strokes when the ink
/// isn't loaded.
pub fn has_ink(page: &Page) -> bool {
    !page.ink.is_empty()
        || page
            .blocks
            .iter()
            .any(|b| matches!(&b.data, BlockData::Ink(ink) if ink.stroke_count > 0))
}

fn render_block(block: &Block, links: &PageLinks<'_>) -> Option<String> {
    match &block.data {
        BlockData::Text(text) => Some(rewrite_links(&text.markdown, links.page.id, links)),
        BlockData::Image(image) => {
            let alt = if image.decorative {
                String::new()
            } else {
                inline_text(&image.alt)
            };
            Some(format!("![{alt}]({})", asset_destination(image.asset, links)))
        }
        BlockData::File(file) => {
            let name = links
                .page
                .assets
                .get(&file.asset)
                .map_or_else(|| file.asset.to_string(), |a| a.name.clone());
            Some(format!(
                "[{}]({})",
                inline_text(&name),
                asset_destination(file.asset, links)
            ))
        }
        BlockData::Table(table) => render_table(table, links),
        BlockData::Ink(ink) => drawing_line(ink),
        BlockData::Other(_) => {
            let fallback = block
                .fallback
                .as_ref()
                .map(|f| f.markdown.trim())
                .filter(|m| !m.is_empty());
            Some(match fallback {
                Some(markdown) => rewrite_links(markdown, links.page.id, links),
                None => NEWER_VERSION_LINE.to_owned(),
            })
        }
    }
}

/// Text inside a line: on one line, trimmed, and escaped.
fn inline_text(text: &str) -> String {
    escape_text(one_line(text).trim(), false)
}

fn asset_destination(asset: AssetId, links: &PageLinks<'_>) -> String {
    match links.asset_file(asset) {
        Some(file) => write_destination(&format!("assets/{file}")),
        None => format!("asset:{asset}"),
    }
}

/// A drawing's description, in italics, unless it is decorative or has none.
fn drawing_line(ink: &InkBlockData) -> Option<String> {
    let text = inline_text(&ink.alt);
    let drawing = ink.role.known() == Some(InkRole::Drawing);
    (drawing && !ink.decorative && !text.is_empty()).then(|| format!("*{text}*"))
}

/// A GFM table, with an empty header row when the table has none. `None` for a table without columns.
fn render_table(table: &TableData, links: &PageLinks<'_>) -> Option<String> {
    if table.columns.is_empty() {
        return None;
    }
    let row_line = |cells: Vec<String>| format!("| {} |", cells.join(" | "));
    let cells_of = |row: &crate::model::TableRow| -> Vec<String> {
        table
            .columns
            .iter()
            .map(|column| {
                row.cells
                    .get(&column.id)
                    .map(|cell| table_cell(&rewrite_links(&cell.markdown, links.page.id, links)))
                    .unwrap_or_default()
            })
            .collect()
    };
    let (header, body) = match table.rows.split_first() {
        Some((first, rest)) if table.header => (cells_of(first), rest),
        _ => (vec![String::new(); table.columns.len()], table.rows.as_slice()),
    };
    let mut lines = vec![row_line(header), row_line(vec!["---".to_owned(); table.columns.len()])];
    lines.extend(body.iter().map(|row| row_line(cells_of(row))));
    Some(lines.join("\n"))
}

/// A cell's Markdown for a GFM table: hard breaks become `<br>`, and a `|` not already escaped gets a
/// backslash.
fn table_cell(markdown: &str) -> String {
    let text = markdown.replace("\\\n", "<br>").replace('\n', " ");
    let mut out = String::with_capacity(text.len());
    let mut escaped = false;
    for c in text.chars() {
        if c == '|' && !escaped {
            out.push('\\');
        }
        escaped = c == '\\' && !escaped;
        out.push(c);
    }
    out
}
