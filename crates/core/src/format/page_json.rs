//! `page.json` (spec 5 and 6). Owned by WP1.

mod blocks;
mod data;
mod parts;
mod view;

use std::collections::{BTreeMap, HashSet};

use super::header::{self, restrict};
use super::json::{self, Json};
use super::kinds;
use super::migrate::FileKind;
use crate::error::FormatError;
use crate::format::ReadPage;
use crate::limits::Limits;
use crate::model::validate::validate_page;
use crate::model::{FormatInfo, Ink, Page, ReadOnlyReason, Warning};

pub use parts::{parse_crc, read_device, write_device};

/// Reads `page.json`, upgrading older versions in memory. Sets `format.access` to read-only for newer
/// versions, damaged data, and reserved content such as encryption.
///
/// The page's ink holds the segment list only. The store reads the segments and replays them. A file that
/// can't be parsed, or that misses a required field, is an error. A page that parses but fails a structural
/// check of spec 16 is returned read-only as damaged, with the problems as warnings, so it can be shown.
pub fn read_page(bytes: &[u8], limits: &Limits) -> Result<ReadPage, FormatError> {
    let (mut fields, info) = header::read_file(bytes, limits, kinds::PAGE, FileKind::Page)?;
    let mut warnings = Vec::new();
    let id = fields.id("id")?;
    let title = fields.str("title")?;
    let created = fields.time("created")?;
    let modified = fields.time("modified")?;
    let tags = fields.strings("tags")?;
    let view = view::read_view(fields.required("view")?)?;
    let blocks = blocks::read_blocks(fields.array("blocks")?)?;
    let reading_order = fields.ids("readingOrder")?;
    let assets = match fields.opt_object("assets")? {
        Some(map) => parts::read_assets(map)?,
        None => BTreeMap::new(),
    };
    let segments = match fields.take("ink") {
        Some(value) => parts::read_ink(value, &mut warnings)?,
        None => Vec::new(),
    };
    let recordings = fields.take("recordings");
    let encryption = fields.take("encryption");
    let revision = parts::read_revision(fields.required("revision")?)?;
    let mut ink = Ink::default();
    ink.commit(0, segments, 0);
    let page = Page {
        id,
        title,
        created,
        modified,
        tags,
        view,
        blocks,
        reading_order,
        assets,
        ink,
        recordings,
        encryption,
        revision,
        extra: fields.rest(),
        format: Default::default(),
    };
    Ok(check(page, info, warnings, limits))
}

/// Validates a page as read, and decides whether it may be changed.
fn check(mut page: Page, mut info: FormatInfo, mut warnings: Vec<Warning>, limits: &Limits) -> ReadPage {
    let report = validate_page(&page, limits);
    if page.encryption.is_some() {
        restrict(&mut info, ReadOnlyReason::Encrypted);
    }
    if !report.errors.is_empty() {
        restrict(&mut info, ReadOnlyReason::Damaged);
    }
    warnings.extend(report.errors);
    warnings.extend(report.warnings);
    info.warnings.clone_from(&warnings);
    page.format = info;
    ReadPage { page, warnings }
}

/// Writes `page.json` in canonical form (spec 2.2).
///
/// `readingOrder` keeps only IDs of blocks on the page, once each (spec 6.2). Everything else is written as
/// the page holds it.
pub fn write_page(page: &Page) -> Vec<u8> {
    let mut obj = header::start(kinds::PAGE);
    obj.put("id", Json::string(page.id.to_string()))
        .put("title", Json::str(&page.title))
        .put("created", Json::string(page.created.to_rfc3339()))
        .put("modified", Json::string(page.modified.to_rfc3339()))
        .unless("tags", page.tags.is_empty(), || Json::strings(&page.tags))
        .put("view", view::write_view(&page.view))
        .unless("blocks", page.blocks.is_empty(), || blocks::write_blocks(&page.blocks));
    let mut seen = HashSet::new();
    let reading: Vec<_> = page
        .reading_order
        .iter()
        .filter(|id| page.blocks.contains(**id) && seen.insert(**id))
        .collect();
    obj.unless("readingOrder", reading.is_empty(), || Json::strings(reading))
        .unless("assets", page.assets.is_empty(), || parts::write_assets(&page.assets))
        .opt("ink", parts::write_ink(page.ink.segments()))
        .opt("recordings", page.recordings.as_ref().map(Json::Raw))
        .opt("encryption", page.encryption.as_ref().map(Json::Raw))
        .put("revision", parts::write_revision(&page.revision));
    json::write_document(&obj.finish(&page.extra))
}

/// The page's title without a full parse, for the scan. `None` when the file isn't a JSON object with a
/// string `title` at its top level.
pub fn page_title_prefix(bytes: &[u8]) -> Option<String> {
    json::top_level_string(bytes, "title")
}

#[cfg(test)]
mod tests;
