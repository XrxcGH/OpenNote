//! A Trash item's `item.json` (spec 12.1). Owned by WP1.
//!
//! The shape of `origin` depends on `itemKind`. The model keeps no unknown keys inside `origin`, so a reader
//! reports them as a warning.

use serde_json::Value;

use super::header;
use super::json::{self, Fields, Json, Obj};
use super::kinds;
use super::migrate::FileKind;
use super::page_json::{read_device, write_device};
use super::tree_json::{read_group, read_page_entry, write_group, write_page_entry};
use crate::error::{FormatError, FormatErrorKind};
use crate::limits::Limits;
use crate::model::{Named, NamedValue, TrashItemFile, TrashKind, TrashOrigin, Warning};

/// Reads `item.json`.
pub fn read_trash_item(bytes: &[u8], limits: &Limits) -> Result<TrashItemFile, FormatError> {
    let (mut fields, mut format) = header::read_file(bytes, limits, kinds::TRASH_ITEM, FileKind::TrashItem)?;
    let kind_text = fields.str("itemKind")?;
    let kind = TrashKind::from_name(&kind_text).ok_or_else(|| {
        FormatError::new(
            FormatErrorKind::Validation,
            format!("trash-item.itemKind: unknown kind {kind_text:?}"),
        )
    })?;
    let origin = read_origin(kind, fields.required("origin")?, &mut format.warnings)?;
    Ok(TrashItemFile {
        id: fields.id("id")?,
        kind,
        title: fields.str("title")?,
        deleted_at: fields.time("deletedAt")?,
        expires_at: fields.time("expiresAt")?,
        deleted_by: read_device(fields.required("deletedBy")?, "trash-item.deletedBy")?,
        reason: fields.named("reason")?.unwrap_or_default(),
        origin,
        contents: fields.ids("contents")?,
        extra: fields.rest(),
        format,
    })
}

fn read_origin(kind: TrashKind, value: Value, warnings: &mut Vec<Warning>) -> Result<TrashOrigin, FormatError> {
    let mut fields = Fields::new(value, "trash-item.origin")?;
    let origin = match kind {
        TrashKind::Page => TrashOrigin::Pages {
            section: fields.id("section")?,
            section_title: fields.str("sectionTitle")?,
            entries: fields
                .array("entries")?
                .into_iter()
                .enumerate()
                .map(|(i, item)| read_page_entry(item, &format!("trash-item.origin.entries[{i}]")))
                .collect::<Result<_, _>>()?,
        },
        TrashKind::Section => TrashOrigin::Section {
            group: fields.opt_id("group")?,
            order: fields.order("order")?,
            parent_title: fields.opt_str("parentTitle")?,
        },
        TrashKind::Group => TrashOrigin::Group {
            groups: fields
                .array("groups")?
                .into_iter()
                .enumerate()
                .map(|(i, item)| read_group(item, &format!("trash-item.origin.groups[{i}]")))
                .collect::<Result<_, _>>()?,
            parent_title: fields.opt_str("parentTitle")?,
        },
    };
    if fields.has_rest() {
        let keys: Vec<String> = fields.rest().into_iter().map(|(key, _)| key).collect();
        warnings.push(Warning::new("trash.origin.unknownKeys", keys.join(", ")));
    }
    Ok(origin)
}

/// Writes `item.json` in canonical form.
pub fn write_trash_item(file: &TrashItemFile) -> Vec<u8> {
    let mut obj = header::start(kinds::TRASH_ITEM);
    obj.put("id", Json::string(file.id.to_string()))
        .put("itemKind", Json::str(file.kind.name()))
        .put("title", Json::str(&file.title))
        .put("deletedAt", Json::string(file.deleted_at.to_rfc3339()))
        .put("expiresAt", Json::string(file.expires_at.to_rfc3339()))
        .put("deletedBy", write_device(&file.deleted_by))
        .unless("reason", file.reason == Named::default(), || {
            Json::str(file.reason.as_str())
        })
        .put("origin", write_origin(&file.origin))
        .put("contents", Json::strings(&file.contents));
    json::write_document(&obj.finish(&file.extra))
}

fn write_origin(origin: &TrashOrigin) -> Json<'_> {
    let mut obj = Obj::new();
    match origin {
        TrashOrigin::Pages {
            section,
            section_title,
            entries,
        } => {
            obj.put("section", Json::string(section.to_string()))
                .put("sectionTitle", Json::str(section_title))
                .put("entries", Json::Array(entries.iter().map(write_page_entry).collect()));
        }
        TrashOrigin::Section {
            group,
            order,
            parent_title,
        } => {
            obj.opt("group", group.map(|g| Json::string(g.to_string())))
                .put("order", Json::str(order.as_str()))
                .opt("parentTitle", parent_title.as_deref().map(Json::str));
        }
        TrashOrigin::Group { groups, parent_title } => {
            // The deleted group comes first, so the list keeps its order.
            obj.put("groups", Json::Array(groups.iter().map(write_group).collect()))
                .opt("parentTitle", parent_title.as_deref().map(Json::str));
        }
    }
    obj.done()
}
