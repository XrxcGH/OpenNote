//! `section.json` and `notebook.json` (spec 4), and merging sync-tool copies of them (spec 14.3). Owned by WP1.
//!
//! Writers put page entries in display order (spec 4.4), and groups in key order, then ID order (spec 2.8). The
//! same tree then always gives the same bytes, whatever order the model holds them in.

mod entries;
mod merge;
mod styles;

use super::header::{self, restrict};
use super::json::{self, Json};
use super::kinds;
use super::migrate::FileKind;
use crate::error::FormatError;
use crate::limits::Limits;
use crate::model::{NotebookFile, ReadOnlyReason, SectionFile};

pub use entries::{read_group, read_page_entry, sorted_groups, sorted_pages, write_group, write_page_entry};
pub use merge::{merge_notebooks, merge_sections};

/// Reads `section.json`. A section with `encryption` is read-only (spec 5.7).
pub fn read_section(bytes: &[u8], limits: &Limits) -> Result<SectionFile, FormatError> {
    let (mut fields, mut format) = header::read_file(bytes, limits, kinds::SECTION, FileKind::Section)?;
    let pages = fields
        .array("pages")?
        .into_iter()
        .enumerate()
        .map(|(index, item)| read_page_entry(item, &format!("section.pages[{index}]")))
        .collect::<Result<Vec<_>, _>>()?;
    let file = SectionFile {
        id: fields.id("id")?,
        title: fields.str("title")?,
        color: fields.color("color")?,
        group: fields.opt_id("group")?,
        order: fields.order("order")?,
        created: fields.time("created")?,
        changed: fields.time("changed")?,
        defaults: fields.opt_object("defaults")?,
        encryption: fields.take("encryption"),
        pages,
        extra: fields.rest(),
        format: Default::default(),
    };
    if file.encryption.is_some() {
        restrict(&mut format, ReadOnlyReason::Encrypted);
    }
    Ok(SectionFile { format, ..file })
}

/// Writes `section.json` in canonical form.
pub fn write_section(file: &SectionFile) -> Vec<u8> {
    let mut obj = header::start(kinds::SECTION);
    obj.put("id", Json::string(file.id.to_string()))
        .put("title", Json::str(&file.title))
        .opt("color", file.color.as_ref().map(|c| Json::string(c.to_text())))
        .opt("group", file.group.map(|g| Json::string(g.to_string())))
        .put("order", Json::str(file.order.as_str()))
        .put("created", Json::string(file.created.to_rfc3339()))
        .put("changed", Json::string(file.changed.to_rfc3339()))
        .opt("defaults", file.defaults.as_ref().map(|d| json::Obj::new().finish(d)))
        .opt("encryption", file.encryption.as_ref().map(Json::Raw));
    let pages: Vec<Json<'_>> = sorted_pages(&file.pages).into_iter().map(write_page_entry).collect();
    obj.unless("pages", pages.is_empty(), || Json::Array(pages));
    json::write_document(&obj.finish(&file.extra))
}

/// Reads `notebook.json`.
pub fn read_notebook(bytes: &[u8], limits: &Limits) -> Result<NotebookFile, FormatError> {
    let (mut fields, format) = header::read_file(bytes, limits, kinds::NOTEBOOK, FileKind::Notebook)?;
    let groups = fields
        .array("groups")?
        .into_iter()
        .enumerate()
        .map(|(index, item)| read_group(item, &format!("notebook.groups[{index}]")))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(NotebookFile {
        id: fields.id("id")?,
        title: fields.str("title")?,
        color: fields.color("color")?,
        created: fields.time("created")?,
        changed: fields.time("changed")?,
        defaults: fields.opt_object("defaults")?,
        styles: fields
            .take("styles")
            .map(styles::read_styles)
            .transpose()?
            .unwrap_or_default(),
        groups,
        extra: fields.rest(),
        format,
    })
}

/// Writes `notebook.json` in canonical form.
pub fn write_notebook(file: &NotebookFile) -> Vec<u8> {
    let mut obj = header::start(kinds::NOTEBOOK);
    obj.put("id", Json::string(file.id.to_string()))
        .put("title", Json::str(&file.title))
        .opt("color", file.color.as_ref().map(|c| Json::string(c.to_text())))
        .put("created", Json::string(file.created.to_rfc3339()))
        .put("changed", Json::string(file.changed.to_rfc3339()))
        .opt("defaults", file.defaults.as_ref().map(|d| json::Obj::new().finish(d)))
        .unless("styles", file.styles.is_empty(), || styles::write_styles(&file.styles));
    let groups: Vec<Json<'_>> = sorted_groups(&file.groups).into_iter().map(write_group).collect();
    obj.unless("groups", groups.is_empty(), || Json::Array(groups));
    json::write_document(&obj.finish(&file.extra))
}

#[cfg(test)]
mod tests;
