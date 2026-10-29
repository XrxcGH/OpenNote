//! Turning a core page into document blocks, for the export formats that cannot hold a whole page.
//!
//! Text blocks keep their Markdown. Image, file, and table blocks become the closest document blocks. Ink becomes
//! one picture of the page's handwriting when the exporter can hold a picture, and is left out otherwise. The
//! report says which.

use opennote_core::format::readable::render_ink_svg;
use opennote_core::model::{
    Asset, Block as PageBlock, BlockData, FileData, ImageData, InkBlockData, InkRole, Page, TableData,
};
use opennote_core::{AssetId, PageId};

use crate::doc::parse::{parse, SoftBreaks};
use crate::doc::{visit_inlines_mut, Block, Inline, Marks};
use crate::report::PageReport;

/// Decides where the assets and other pages of an export end up.
pub trait Resolver {
    /// The destination for an asset of the page, such as `assets/leaf.png`. `None` when it cannot be exported.
    fn asset(&mut self, page: &Page, asset: &Asset) -> Option<String>;

    /// The destination for a link to another page. `None` when that page is not part of the export.
    fn page(&mut self, from: PageId, to: PageId) -> Option<String>;

    /// The destination for a picture of all the page's handwriting, drawn as SVG. The exporter keeps `svg` and
    /// writes or embeds it. `None`, which is the default, when the format cannot hold the picture.
    fn ink(&mut self, _page: &Page, _svg: Vec<u8>) -> Option<String> {
        None
    }
}

#[derive(Default)]
struct Tally {
    text: usize,
    images: usize,
    files: usize,
    tables: usize,
    links: usize,
    dead_links: usize,
    missing_assets: usize,
    ink_blocks: usize,
    strokes: u32,
    /// Whether the picture of the handwriting was asked for, so it is made once for a page.
    ink_tried: bool,
    /// Whether the picture of the handwriting is on the page.
    ink_pictured: bool,
    floating: usize,
    with_fallback: usize,
    /// Blocks of OpenNote's own extra types (flashcards, study tape, live citations), which a file shows as text.
    own_with_fallback: usize,
    unknown: Vec<String>,
}

impl Tally {
    fn describe(&self, report: &mut PageReport) {
        report.came_over_count(self.text, "text block", "text blocks");
        report.came_over_count(self.images, "image", "images");
        report.came_over_count(self.files, "attachment", "attachments");
        report.came_over_count(self.tables, "table", "tables");
        report.came_over_count(self.links, "link to another page", "links to other pages");
        let free = ("block placed freely", "blocks placed freely");
        report.simplified_count(
            self.floating,
            free,
            "They follow the page's reading order in the export.",
        );
        let dead = ("link to a page outside the export", "links to pages outside the export");
        report.simplified_count(self.dead_links, dead, "Only the link text was kept.");
        let newer = ("block from a newer version", "blocks from a newer version");
        report.simplified_count(self.with_fallback, newer, "Their readable stand-in was used.");
        let own = ("live block shown as text", "live blocks shown as text");
        report.simplified_count(
            self.own_with_fallback,
            own,
            "Flashcards, study tape, and citations that follow a style stay as the text saved with them.",
        );
        if self.ink_blocks > 0 && self.strokes > 0 {
            let what = format!("handwriting and drawings ({} strokes)", self.strokes);
            if self.ink_pictured {
                let why = concat!(
                    "They are one picture now: not editable, and not placed beside the text. ",
                    "Export to PDF to keep the layout."
                );
                report.simplified(what, why);
            } else {
                report.skipped(what, "This format cannot hold ink. Export to PDF to keep it.");
            }
        }
        let missing = ("file that was not found", "files that were not found");
        report.skipped_count(self.missing_assets, missing, "Their names stay in the text.");
        for name in &self.unknown {
            report.skipped(format!("a block of type {name}"), "It has no readable stand-in.");
        }
    }
}

/// Converts a page. The report gets what came over, what was simplified, and what was skipped.
pub fn page_to_blocks(page: &Page, resolver: &mut dyn Resolver, report: &mut PageReport) -> Vec<Block> {
    page_to_blocks_traced(page, resolver, report).0
}

/// Converts a page like [`page_to_blocks`], and also says which page block each converted block came from, so an
/// export can look at that block's own data, such as the choices of a table's columns.
pub fn page_to_blocks_traced(
    page: &Page,
    resolver: &mut dyn Resolver,
    report: &mut PageReport,
) -> (Vec<Block>, Vec<opennote_core::BlockId>) {
    let converted = convert_page(page, resolver, report, None);
    (converted.blocks, converted.origins)
}

/// A converted page, for the exports that keep more than the blocks.
pub(super) struct Converted {
    pub blocks: Vec<Block>,
    /// The page block that each of `blocks` came from.
    pub origins: Vec<opennote_core::BlockId>,
    /// The footnotes of the page, as the inlines of each one. Only a LaTeX conversion has any.
    pub notes: Vec<Vec<Inline>>,
}

/// Converts a page. With a `label_prefix`, which is the LaTeX export's, equation labels and references keep their
/// `\label` and `\eqref` form under that prefix, and footnote definitions are taken out of the text (see
/// `footnotes`). Without one, labeled equations get their numbers written in.
pub(super) fn convert_page(
    page: &Page,
    resolver: &mut dyn Resolver,
    report: &mut PageReport,
    label_prefix: Option<&str>,
) -> Converted {
    // Equation numbers run across the whole page, so the texts are numbered together, in reading order.
    let order = page.reading_order();
    let texts: Vec<(opennote_core::BlockId, &str)> = order
        .iter()
        .filter_map(|id| match &page.blocks.get(*id)?.data {
            BlockData::Text(text) => Some((*id, &*text.markdown)),
            _ => None,
        })
        .collect();
    let plain: Vec<&str> = texts.iter().map(|(_, m)| *m).collect();
    let mut numbered = match label_prefix {
        Some(prefix) => super::equations::prefixed_texts(&plain, prefix),
        None => super::equations::number_texts(&plain),
    };
    let note_markdown = if label_prefix.is_some() {
        super::footnotes::extract(&mut numbered)
    } else {
        Vec::new()
    };
    let mut convert = Convert {
        page,
        resolver,
        tally: Tally::default(),
        numbered: texts.iter().map(|(id, _)| *id).zip(numbered).collect(),
    };
    let mut out = Vec::new();
    let mut origins = Vec::new();
    for id in page.reading_order() {
        let Some(block) = page.blocks.get(id) else {
            continue;
        };
        if block.is_floating() {
            convert.tally.floating += 1;
        }
        let before = out.len();
        convert.block(block, &mut out);
        origins.extend(std::iter::repeat_n(block.id, out.len() - before));
    }
    let notes = note_markdown.iter().map(|markdown| convert.note(markdown)).collect();
    convert.tally.describe(report);
    Converted {
        blocks: out,
        origins,
        notes,
    }
}

struct Convert<'a> {
    page: &'a Page,
    resolver: &'a mut dyn Resolver,
    tally: Tally,
    /// The text blocks with equation numbers and references written in, by block.
    numbered: std::collections::HashMap<opennote_core::BlockId, String>,
}

impl Convert<'_> {
    fn block(&mut self, block: &PageBlock, out: &mut Vec<Block>) {
        match &block.data {
            BlockData::Text(text) => {
                self.tally.text += 1;
                let markdown = self
                    .numbered
                    .remove(&block.id)
                    .unwrap_or_else(|| text.markdown.to_string());
                out.extend(self.markdown(&markdown));
            }
            BlockData::Image(image) => self.image(image, out),
            BlockData::File(file) => self.file(file, out),
            BlockData::Table(table) => out.push(self.table(table)),
            BlockData::Ink(ink) => self.ink(ink, out),
            BlockData::Other(other) => match &block.fallback {
                Some(fallback) => {
                    if other.type_name.starts_with("ext:org.opennote/") {
                        self.tally.own_with_fallback += 1;
                    } else {
                        self.tally.with_fallback += 1;
                    }
                    out.extend(self.markdown(&fallback.markdown));
                    if let Some(asset) = fallback.image {
                        self.image_paragraph(asset, "", out);
                    }
                }
                None => self.tally.unknown.push(other.type_name.to_string()),
            },
        }
    }

    /// The inlines of a footnote: its paragraphs, joined by spaces.
    fn note(&mut self, markdown: &str) -> Vec<Inline> {
        let mut inlines = Vec::new();
        for block in self.markdown(markdown) {
            if let Block::Paragraph(content) = block {
                if !inlines.is_empty() {
                    inlines.push(Inline::text(" "));
                }
                inlines.extend(content);
            }
        }
        inlines
    }

    fn markdown(&mut self, markdown: &str) -> Vec<Block> {
        let mut blocks = parse(markdown, SoftBreaks::Space).blocks;
        visit_inlines_mut(&mut blocks, &mut |inlines| self.fix_inlines(inlines));
        blocks
    }

    fn image(&mut self, image: &ImageData, out: &mut Vec<Block>) {
        let alt = if image.decorative { "" } else { image.alt.as_str() };
        self.image_paragraph(image.asset, alt, out);
    }

    fn image_paragraph(&mut self, asset: AssetId, alt: &str, out: &mut Vec<Block>) {
        match self.asset_dest(asset) {
            Some(dest) => {
                self.tally.images += 1;
                out.push(Block::Paragraph(vec![Inline::Image {
                    dest,
                    alt: alt.to_owned(),
                }]));
            }
            None => self.tally.missing_assets += 1,
        }
    }

    fn file(&mut self, file: &FileData, out: &mut Vec<Block>) {
        let Some(asset) = self.page.assets.get(&file.asset) else {
            self.tally.missing_assets += 1;
            return;
        };
        match self.resolver.asset(self.page, asset) {
            Some(dest) => {
                self.tally.files += 1;
                let name = if asset.name.is_empty() {
                    &asset.file
                } else {
                    &asset.name
                };
                out.push(Block::Paragraph(vec![Inline::marked(name.clone(), Marks::link(dest))]));
            }
            None => self.tally.missing_assets += 1,
        }
    }

    fn table(&mut self, table: &TableData) -> Block {
        self.tally.tables += 1;
        let rows = table
            .rows
            .iter()
            .map(|row| {
                let cells = table.columns.iter().map(|column| row.cells.get(&column.id));
                cells
                    .map(|cell| self.cell(cell.map_or("", |c| c.markdown.as_str())))
                    .collect()
            })
            .collect();
        Block::Table {
            header: table.header,
            rows,
        }
    }

    /// The inlines of a table cell: its paragraphs, joined by breaks.
    fn cell(&mut self, markdown: &str) -> Vec<Inline> {
        let mut inlines = Vec::new();
        for block in self.markdown(markdown) {
            if let Block::Paragraph(content) = block {
                if !inlines.is_empty() {
                    inlines.push(Inline::HardBreak);
                }
                inlines.extend(content);
            }
        }
        inlines
    }

    fn ink(&mut self, ink: &InkBlockData, out: &mut Vec<Block>) {
        self.tally.ink_blocks += 1;
        self.tally.strokes += ink.stroke_count;
        if !self.tally.ink_tried && ink.stroke_count > 0 {
            self.tally.ink_tried = true;
            let svg = render_ink_svg(self.page);
            if let Some(dest) = self.resolver.ink(self.page, svg) {
                self.tally.ink_pictured = true;
                out.push(Block::Paragraph(vec![Inline::Image {
                    dest,
                    alt: "Handwriting on this page".to_owned(),
                }]));
            }
        }
        let described = ink.role.known() == Some(InkRole::Drawing) && !ink.decorative && !ink.alt.is_empty();
        if described {
            let marks = Marks {
                emphasis: true,
                ..Marks::none()
            };
            out.push(Block::Paragraph(vec![Inline::marked(
                format!("Drawing: {}", ink.alt),
                marks,
            )]));
        }
    }

    fn asset_dest(&mut self, id: AssetId) -> Option<String> {
        let asset = self.page.assets.get(&id)?;
        self.resolver.asset(self.page, asset)
    }

    fn fix_inlines(&mut self, inlines: &mut [Inline]) {
        for inline in inlines {
            match inline {
                Inline::Image { dest, alt } => *inline = self.fix_image(dest, alt),
                Inline::Text { marks, .. } => {
                    if let Some(dest) = marks.link.take() {
                        marks.link = self.link(&dest);
                    }
                }
                Inline::HardBreak | Inline::SoftBreak => {}
            }
        }
    }

    /// The image with its new destination, or its description in brackets when the file is missing.
    fn fix_image(&mut self, dest: &str, alt: &str) -> Inline {
        let new_dest = match asset_id(dest) {
            Some(id) => self.asset_dest(id),
            None => Some(dest.to_owned()),
        };
        match new_dest {
            Some(dest) => Inline::Image {
                dest,
                alt: alt.to_owned(),
            },
            None => {
                self.tally.missing_assets += 1;
                let name = if alt.is_empty() { "image" } else { alt };
                Inline::text(format!("[{name}]"))
            }
        }
    }

    /// The new destination of a link, or `None` to keep only its text.
    fn link(&mut self, dest: &str) -> Option<String> {
        if let Some(rest) = dest.strip_prefix("opennote:page/") {
            let target = rest.split('#').next().and_then(|id| PageId::parse(id).ok());
            let path = target.and_then(|to| self.resolver.page(self.page.id, to));
            match path {
                Some(_) => self.tally.links += 1,
                None => self.tally.dead_links += 1,
            }
            return path;
        }
        if dest.starts_with("opennote:") {
            self.tally.dead_links += 1;
            return None;
        }
        match asset_id(dest) {
            Some(id) => self.asset_dest(id),
            None => Some(dest.to_owned()),
        }
    }
}

fn asset_id(dest: &str) -> Option<AssetId> {
    AssetId::parse(dest.strip_prefix("asset:")?).ok()
}
