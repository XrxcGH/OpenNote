//! Page entries (spec 4.2) and section groups (spec 4.3), which `section.json`, `notebook.json`, and Trash items
//! share.

use serde_json::Value;

use crate::error::FormatError;
use crate::format::json::{Fields, Json, Obj};
use crate::id::{SectionId, TrashItemId};
use crate::model::section::page_levels;
use crate::model::{Group, Moving, PageEntry};

/// Reads a page entry.
pub fn read_page_entry(value: Value, context: &str) -> Result<PageEntry, FormatError> {
    let mut fields = Fields::new(value, context)?;
    let moving = match fields.opt_object("moving")? {
        None => None,
        Some(map) => Some(read_moving(Fields::from_map(map, format_args!("{context}.moving")))?),
    };
    Ok(PageEntry {
        id: fields.id("id")?,
        title: fields.str("title")?,
        parent: fields.opt_id("parent")?,
        order: fields.order("order")?,
        pinned: fields.bool_or("pinned", false)?,
        color: fields.color("color")?,
        changed: fields.time("changed")?,
        moving,
        extra: fields.rest(),
    })
}

/// Reads `moving`: `{"from": <section ID>}` or `{"fromTrash": <Trash item ID>}`.
fn read_moving(mut fields: Fields) -> Result<Moving, FormatError> {
    let from: Option<SectionId> = fields.opt_id("from")?;
    let from_trash: Option<TrashItemId> = fields.opt_id("fromTrash")?;
    match (from, from_trash) {
        (Some(section), None) => Ok(Moving::From(section)),
        (None, Some(item)) => Ok(Moving::FromTrash(item)),
        _ => Err(fields.error("from", "expected from or fromTrash")),
    }
}

/// Writes a page entry.
pub fn write_page_entry(entry: &PageEntry) -> Json<'_> {
    let mut obj = Obj::new();
    obj.put("id", Json::string(entry.id.to_string()))
        .put("title", Json::str(&entry.title))
        .opt("parent", entry.parent.map(|p| Json::string(p.to_string())))
        .put("order", Json::str(entry.order.as_str()))
        .unless("pinned", !entry.pinned, || Json::Bool(true))
        .opt("color", entry.color.as_ref().map(|c| Json::string(c.to_text())))
        .put("changed", Json::string(entry.changed.to_rfc3339()));
    obj.opt(
        "moving",
        entry.moving.map(|moving| {
            let mut m = Obj::new();
            match moving {
                Moving::From(section) => m.put("from", Json::string(section.to_string())),
                Moving::FromTrash(item) => m.put("fromTrash", Json::string(item.to_string())),
            };
            m.done()
        }),
    );
    obj.finish(&entry.extra)
}

/// Page entries in display order: each page followed by its subpages, siblings by order key, then ID.
pub fn sorted_pages(entries: &[PageEntry]) -> Vec<&PageEntry> {
    let sorted: Vec<&PageEntry> = page_levels(entries)
        .into_iter()
        .filter_map(|(index, _)| entries.get(index))
        .collect();
    // Display order lists every entry once. Should it ever miss one, the order is not worth losing it.
    if sorted.len() == entries.len() {
        sorted
    } else {
        entries.iter().collect()
    }
}

/// Reads a section group.
pub fn read_group(value: Value, context: &str) -> Result<Group, FormatError> {
    let mut fields = Fields::new(value, context)?;
    Ok(Group {
        id: fields.id("id")?,
        title: fields.str("title")?,
        color: fields.color("color")?,
        parent: fields.opt_id("parent")?,
        order: fields.order("order")?,
        created: fields.time("created")?,
        changed: fields.time("changed")?,
        extra: fields.rest(),
    })
}

/// Writes a section group.
pub fn write_group(group: &Group) -> Json<'_> {
    let mut obj = Obj::new();
    obj.put("id", Json::string(group.id.to_string()))
        .put("title", Json::str(&group.title))
        .opt("color", group.color.as_ref().map(|c| Json::string(c.to_text())))
        .opt("parent", group.parent.map(|p| Json::string(p.to_string())))
        .put("order", Json::str(group.order.as_str()))
        .put("created", Json::string(group.created.to_rfc3339()))
        .put("changed", Json::string(group.changed.to_rfc3339()));
    obj.finish(&group.extra)
}

/// Groups by order key, then ID.
pub fn sorted_groups(groups: &[Group]) -> Vec<&Group> {
    let mut sorted: Vec<&Group> = groups.iter().collect();
    sorted.sort_by(|a, b| (&a.order, a.id).cmp(&(&b.order, b.id)));
    sorted
}
