//! Structural checks of a page (spec 16). Owned by WP1.
//!
//! Errors make a page damaged and read-only (spec 16). Warnings are problems a writer corrects at the next
//! save, such as a wrong `strokeCount`, or problems the reader works around, such as a block whose data
//! couldn't be read (spec 6.5).

use std::collections::HashSet;

use crate::format::markdown::{outgoing_links, LinkTarget};
use crate::format::names::check_asset_file_name;
use crate::id::{AssetId, Id};
use crate::limits::Limits;
use crate::model::{Block, BlockData, Page, TableData, TextData, Warning};

/// The problems a page has: errors make it damaged, and warnings are corrected at the next save.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ValidationReport {
    /// Problems that make the page damaged and read-only.
    pub errors: Vec<Warning>,
    /// Problems a writer corrects at the next save, such as a wrong `strokeCount`.
    pub warnings: Vec<Warning>,
}

impl ValidationReport {
    /// Whether the page has no errors.
    pub fn is_valid(&self) -> bool {
        self.errors.is_empty()
    }

    fn error(&mut self, code: &'static str, detail: impl Into<String>) {
        self.errors.push(Warning::new(code, detail));
    }

    fn warn(&mut self, code: &'static str, detail: impl Into<String>) {
        self.warnings.push(Warning::new(code, detail));
    }
}

/// Checks every limit and structural rule of spec 16 on a page.
pub fn validate_page(page: &Page, limits: &Limits) -> ValidationReport {
    let mut report = ValidationReport::default();
    check_page_fields(page, limits, &mut report);
    let mut ids: HashSet<Id> = page.blocks.iter().map(|b| b.id.0).collect();
    for block in page.blocks.iter() {
        check_block(page, block, limits, &mut ids, &mut report);
    }
    check_assets(page, &mut report);
    check_ink(page, limits, &mut report);
    report
}

fn check_page_fields(page: &Page, limits: &Limits, report: &mut ValidationReport) {
    let chars = page.title.chars().count();
    if chars > limits.title_chars as usize {
        report.error("limit.title", format!("{chars} characters"));
    }
    check_tags(&page.tags, limits, "page", report);
    if page.blocks.len() > limits.blocks_per_page as usize {
        report.error("limit.blocks", format!("{} blocks", page.blocks.len()));
    }
    let view = &page.view;
    let paper = &view.paper;
    let mut geometry = vec![paper.width, paper.height, view.background.spacing];
    geometry.extend(paper.margins);
    geometry.extend(view.content_width);
    for value in geometry {
        check_geometry(value, limits, "page.view", report);
    }
    if paper.width <= 0.0 || paper.height <= 0.0 {
        report.error("view.paper", "the paper has no area");
    }
    for id in &view.reading_order {
        if !page.blocks.contains(*id) {
            report.warn("page.readingOrder", format!("{id} names no block"));
        }
    }
}

fn check_tags(tags: &[String], limits: &Limits, owner: &str, report: &mut ValidationReport) {
    if tags.len() > limits.tags_per_page as usize {
        report.error("limit.tags", format!("{owner} has {} tags", tags.len()));
    }
    if tags.iter().any(|t| t.chars().count() > limits.tag_chars as usize) {
        report.error("limit.tagChars", format!("a tag of {owner} is too long"));
    }
}

fn check_geometry(value: f64, limits: &Limits, owner: &str, report: &mut ValidationReport) {
    if !value.is_finite() || value.abs() > limits.geometry_abs {
        report.error("limit.geometry", format!("{owner}: {value}"));
    }
}

fn check_block(page: &Page, block: &Block, limits: &Limits, ids: &mut HashSet<Id>, report: &mut ValidationReport) {
    let owner = format!("block {}", block.id);
    if block.order.as_str().len() > limits.order_key_len as usize {
        report.error("limit.orderKey", owner.clone());
    }
    if let Some(frame) = &block.frame {
        for value in [frame.x, frame.y, frame.w, frame.h, frame.rotate].into_iter().flatten() {
            check_geometry(value, limits, &owner, report);
        }
        if frame.w.is_some_and(|w| w < 0.0) || frame.h.is_some_and(|h| h < 0.0) {
            report.error("block.frame", format!("{owner} has a negative size"));
        }
    }
    let asset = |id: AssetId, report: &mut ValidationReport| {
        if !page.assets.contains_key(&id) {
            report.error("block.asset", format!("{owner}: {id} is not in the asset table"));
        }
    };
    if let Some(image) = block.fallback.as_ref().and_then(|f| f.image) {
        asset(image, report);
    }
    match &block.data {
        BlockData::Text(text) => check_text(page, text, limits, (&owner, ids), report),
        BlockData::Image(image) => {
            asset(image.asset, report);
            let crop_ok = image
                .crop
                .as_ref()
                .is_none_or(|c| [c.x, c.y, c.w, c.h].iter().all(|v| (0.0..=1.0).contains(v)));
            if !crop_ok {
                report.error("block.crop", format!("{owner}: the crop is outside the image"));
            }
        }
        BlockData::File(file) => asset(file.asset, report),
        BlockData::Table(table) => check_table(table, limits, &owner, report),
        BlockData::Ink(_) => {}
        BlockData::Other(other) => match &other.unreadable {
            Some(reason) => report.warn("block.unreadable", format!("{owner}: {reason}")),
            None if block.fallback.is_none() => report.warn("block.fallback", format!("{owner} has no fallback")),
            None => {}
        },
    }
}

fn check_text(
    page: &Page,
    text: &TextData,
    limits: &Limits,
    (owner, ids): (&str, &mut HashSet<Id>),
    report: &mut ValidationReport,
) {
    if text.markdown.len() as u64 > limits.markdown_bytes {
        report.error("limit.markdown", format!("{owner}: {} bytes", text.markdown.len()));
    }
    if text.ids.len() > limits.elements_per_block as usize {
        report.error("limit.elements", format!("{owner}: {} element IDs", text.ids.len()));
    }
    for element in &text.ids {
        if !ids.insert(element.0) {
            report.error(
                "id.duplicate",
                format!("{owner}: the element ID {element} is used twice"),
            );
        }
    }
    for tags in text.tags.values() {
        check_tags(tags, limits, owner, report);
    }
    for link in outgoing_links(&text.markdown) {
        if let LinkTarget::Asset(asset) = link {
            if !page.assets.contains_key(&asset) {
                report.error(
                    "block.asset",
                    format!("{owner}: the image {asset} is not in the asset table"),
                );
            }
        }
    }
}

fn check_table(table: &TableData, limits: &Limits, owner: &str, report: &mut ValidationReport) {
    let mut own = HashSet::new();
    let columns = table.columns.iter().map(|c| c.id.0);
    for id in columns.chain(table.rows.iter().map(|r| r.id.0)) {
        if !own.insert(id) {
            report.error(
                "id.duplicate",
                format!("{owner}: the row or column ID {id} is used twice"),
            );
        }
    }
    for width in table.columns.iter().filter_map(|c| c.width) {
        check_geometry(width, limits, owner, report);
        if width < 0.0 {
            report.error("block.table", format!("{owner}: a column has a negative width"));
        }
    }
}

fn check_assets(page: &Page, report: &mut ValidationReport) {
    for (id, asset) in &page.assets {
        if asset.id != *id {
            report.error("asset.id", format!("the entry {id} holds asset {}", asset.id));
        }
        if !check_asset_file_name(*id, &asset.file) {
            report.error(
                "asset.file",
                format!("{id}: {:?} is not a valid asset file name", asset.file),
            );
        }
    }
}

fn check_ink(page: &Page, limits: &Limits, report: &mut ValidationReport) {
    let segments = page.ink.segments();
    if segments.len() > limits.segments_per_page as usize {
        report.error("limit.segments", format!("{} segments", segments.len()));
    }
    let mut seen = HashSet::new();
    for segment in segments {
        if !seen.insert(segment.id) {
            report.error("id.duplicate", format!("the segment {} is listed twice", segment.id));
        }
    }
    if page.ink.len() > limits.strokes_per_page as usize {
        report.error("limit.strokes", format!("{} strokes", page.ink.len()));
    }
    for stroke in page.ink.strokes() {
        let in_ink_block = page
            .blocks
            .get(stroke.block)
            .is_some_and(|b| matches!(b.data, BlockData::Ink(_)));
        if !in_ink_block {
            report.error("ink.block", format!("stroke {} is not in an ink block", stroke.id));
        }
        if stroke.point_count == 0 || stroke.point_count > limits.points_per_stroke {
            report.error(
                "limit.points",
                format!("stroke {} has {} points", stroke.id, stroke.point_count),
            );
        }
    }
    // Stroke counts can only be checked against loaded ink: a page as read holds its segment list only.
    let loaded = !page.ink.is_empty() || !page.ink.pending().is_empty() || segments.is_empty();
    if loaded {
        for block in page.blocks.iter() {
            if let BlockData::Ink(ink) = &block.data {
                let live = page.ink.count_in_block(block.id);
                if ink.stroke_count != live {
                    report.warn(
                        "ink.strokeCount",
                        format!("block {}: {} stored, {live} live", block.id, ink.stroke_count),
                    );
                }
            }
        }
    }
}

#[cfg(test)]
mod tests;
