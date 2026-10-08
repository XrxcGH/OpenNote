//! The `data` object of each version 1 block type (spec 6.3, 6.6, 6.7, and 8.1), to and from JSON.
//!
//! Values equal to their defaults are left out, as `page.json` leaves them out. Reading and then writing an
//! object that was written this way gives the same object.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::Value;

use super::fields::{id_array, item_id, item_object, item_string, number, Fields, Out};
use crate::id::{ColumnId, ElementId};
use crate::model::{
    AnchorQuote, Crop, FileData, FileDisplay, ImageData, InkAnchor, InkBlockData, JsonMap, Named, TableCell,
    TableColumn, TableData, TableRow, TextData,
};

const TEXT_KEYS: &[&str] = &["markdown", "ids", "tags", "styles", "checked"];
const INK_KEYS: &[&str] = &["role", "strokeCount", "anchor", "alt", "decorative"];
const IMAGE_KEYS: &[&str] = &["asset", "alt", "decorative", "crop"];
const FILE_KEYS: &[&str] = &["asset", "display", "alt", "decorative"];
const TABLE_KEYS: &[&str] = &["header", "columns", "rows"];

/// A text block's `data`.
pub fn text_to_json(text: &TextData) -> JsonMap {
    let mut out = Out::new(&text.extra);
    out.put("markdown", &*text.markdown);
    out.put_if(!text.ids.is_empty(), "ids", || id_array(&text.ids));
    out.put_if(!text.tags.is_empty(), "tags", || {
        let tags = text
            .tags
            .iter()
            .map(|(id, tags)| (id.to_string(), Value::from(tags.clone())));
        Value::Object(tags.collect())
    });
    out.put_if(!text.styles.is_empty(), "styles", || {
        let styles = text
            .styles
            .iter()
            .map(|(id, style)| (id.to_string(), Value::from(style.clone())));
        Value::Object(styles.collect())
    });
    out.put_if(!text.checked.is_empty(), "checked", || id_array(&text.checked));
    out.done()
}

/// Reads a text block's `data`.
pub fn text_from_json(map: &JsonMap) -> Result<TextData, String> {
    let f = Fields::new(map, "data", TEXT_KEYS);
    let ids = f
        .array("ids")?
        .iter()
        .map(|v| item_id(v, "ids"))
        .collect::<Result<_, _>>()?;
    let mut tags = BTreeMap::new();
    for (key, value) in f.object("tags")?.into_iter().flatten() {
        let list = value.as_array().ok_or("each value of tags must be an array")?;
        let list = list.iter().map(|v| item_string(v, "tags")).collect::<Result<_, _>>()?;
        tags.insert(element_key(key)?, list);
    }
    let mut styles = BTreeMap::new();
    for (key, value) in f.object("styles")?.into_iter().flatten() {
        styles.insert(element_key(key)?, item_string(value, "styles")?);
    }
    let checked: BTreeSet<ElementId> = f
        .array("checked")?
        .iter()
        .map(|v| item_id(v, "checked"))
        .collect::<Result<_, _>>()?;
    Ok(TextData {
        markdown: f.string_or("markdown", "")?.into(),
        ids,
        tags,
        styles,
        checked,
        extra: f.extra(),
    })
}

fn element_key(key: &str) -> Result<ElementId, String> {
    key.parse().map_err(|_| format!("{key:?} is not an element ID"))
}

/// An ink block's `data`.
pub fn ink_to_json(ink: &InkBlockData) -> JsonMap {
    let mut out = Out::new(&ink.extra);
    out.put("role", ink.role.as_str());
    out.put("strokeCount", ink.stroke_count);
    out.put_if(ink.anchor.is_some(), "anchor", || {
        ink.anchor.as_ref().map_or(Value::Null, anchor_to_json)
    });
    out.put_if(!ink.alt.is_empty(), "alt", || Value::from(ink.alt.clone()));
    out.put_if(ink.decorative, "decorative", || Value::Bool(true));
    out.done()
}

/// Reads an ink block's `data`.
pub fn ink_from_json(map: &JsonMap) -> Result<InkBlockData, String> {
    let f = Fields::new(map, "data", INK_KEYS);
    let anchor = f.object("anchor")?.map(anchor_from_json).transpose()?;
    Ok(InkBlockData {
        role: f.named("role")?,
        stroke_count: f.count("strokeCount")?.unwrap_or(0),
        anchor,
        alt: f.string_or("alt", "")?,
        decorative: f.flag("decorative")?,
        extra: f.extra(),
    })
}

const ANCHOR_KEYS: &[&str] = &["block", "para", "at", "quote", "dx", "dy"];
const QUOTE_KEYS: &[&str] = &["prefix", "exact", "suffix"];

fn anchor_to_json(anchor: &InkAnchor) -> Value {
    let mut out = Out::new(&anchor.extra);
    out.put("block", anchor.block.to_string());
    out.put_if(anchor.para.is_some(), "para", || {
        anchor.para.map_or(Value::Null, |para| Value::from(para.to_string()))
    });
    out.put_if(anchor.at.is_some(), "at", || anchor.at.map_or(Value::Null, Value::from));
    out.put_if(anchor.quote.is_some(), "quote", || {
        anchor.quote.as_ref().map_or(Value::Null, |quote| {
            let mut q = Out::new(&quote.extra);
            q.put_if(!quote.prefix.is_empty(), "prefix", || Value::from(quote.prefix.clone()));
            q.put("exact", quote.exact.clone());
            q.put_if(!quote.suffix.is_empty(), "suffix", || Value::from(quote.suffix.clone()));
            Value::Object(q.done())
        })
    });
    out.put_if(anchor.dx != 0.0, "dx", || number(anchor.dx));
    out.put_if(anchor.dy != 0.0, "dy", || number(anchor.dy));
    Value::Object(out.done())
}

fn anchor_from_json(map: &JsonMap) -> Result<InkAnchor, String> {
    let a = Fields::new(map, "anchor", ANCHOR_KEYS);
    let quote = match a.object("quote")? {
        None => None,
        Some(quote) => {
            let q = Fields::new(quote, "anchor.quote", QUOTE_KEYS);
            Some(AnchorQuote {
                prefix: q.string_or("prefix", "")?,
                exact: q.required_str("exact")?.to_owned(),
                suffix: q.string_or("suffix", "")?,
                extra: q.extra(),
            })
        }
    };
    Ok(InkAnchor {
        block: a.required_id("block")?,
        para: a.id("para")?,
        at: a.count("at")?,
        quote,
        dx: a.geometry("dx")?.unwrap_or(0.0),
        dy: a.geometry("dy")?.unwrap_or(0.0),
        extra: a.extra(),
    })
}

/// An image block's `data`.
pub fn image_to_json(image: &ImageData) -> JsonMap {
    let mut out = Out::new(&image.extra);
    out.put("asset", image.asset.to_string());
    out.put_if(!image.alt.is_empty(), "alt", || Value::from(image.alt.clone()));
    out.put_if(image.decorative, "decorative", || Value::Bool(true));
    if let Some(crop) = &image.crop {
        let mut crop_out = Out::new(&crop.extra);
        for (key, value) in [("x", crop.x), ("y", crop.y), ("w", crop.w), ("h", crop.h)] {
            crop_out.put(key, number(value));
        }
        out.put("crop", Value::Object(crop_out.done()));
    }
    out.done()
}

/// Reads an image block's `data`.
pub fn image_from_json(map: &JsonMap) -> Result<ImageData, String> {
    let f = Fields::new(map, "data", IMAGE_KEYS);
    let crop = match f.object("crop")? {
        None => None,
        Some(crop) => {
            let c = Fields::new(crop, "crop", &["x", "y", "w", "h"]);
            // Crops are written with 6 decimals.
            let part = |key| c.required_number(key).map(|v| crate::format::json::fixed_value(v, 6));
            Some(Crop {
                x: part("x")?,
                y: part("y")?,
                w: part("w")?,
                h: part("h")?,
                extra: c.extra(),
            })
        }
    };
    Ok(ImageData {
        asset: f.required_id("asset")?,
        alt: f.string_or("alt", "")?,
        decorative: f.flag("decorative")?,
        crop,
        extra: f.extra(),
    })
}

/// A file block's `data`.
pub fn file_to_json(file: &FileData) -> JsonMap {
    let mut out = Out::new(&file.extra);
    out.put("asset", file.asset.to_string());
    let default_display = file.display == Named::Known(FileDisplay::Icon);
    out.put_if(!default_display, "display", || Value::from(file.display.as_str()));
    out.put_if(!file.alt.is_empty(), "alt", || Value::from(file.alt.clone()));
    out.put_if(file.decorative, "decorative", || Value::Bool(true));
    out.done()
}

/// Reads a file block's `data`.
pub fn file_from_json(map: &JsonMap) -> Result<FileData, String> {
    let f = Fields::new(map, "data", FILE_KEYS);
    Ok(FileData {
        asset: f.required_id("asset")?,
        display: f.named("display")?,
        alt: f.string_or("alt", "")?,
        decorative: f.flag("decorative")?,
        extra: f.extra(),
    })
}

/// A table block's `data`.
pub fn table_to_json(table: &TableData) -> JsonMap {
    let mut out = Out::new(&table.extra);
    out.put_if(table.header, "header", || Value::Bool(true));
    let columns = table.columns.iter().map(|column| {
        let mut c = Out::new(&column.extra);
        c.put("id", column.id.to_string());
        c.put_if(column.width.is_some(), "width", || {
            column.width.map_or(Value::Null, number)
        });
        Value::Object(c.done())
    });
    out.put("columns", Value::Array(columns.collect()));
    let rows = table.rows.iter().map(|row| {
        let cells = row.cells.iter().map(|(column, cell)| {
            let mut c = Out::new(&cell.extra);
            c.put("markdown", cell.markdown.clone());
            (column.to_string(), Value::Object(c.done()))
        });
        let mut r = Out::new(&row.extra);
        r.put("id", row.id.to_string());
        r.put("cells", Value::Object(cells.collect()));
        Value::Object(r.done())
    });
    out.put("rows", Value::Array(rows.collect()));
    out.done()
}

/// Reads a table block's `data`.
pub fn table_from_json(map: &JsonMap) -> Result<TableData, String> {
    let f = Fields::new(map, "data", TABLE_KEYS);
    let columns = f
        .array("columns")?
        .iter()
        .map(|value| {
            let c = Fields::new(item_object(value, "columns")?, "column", &["id", "width"]);
            Ok(TableColumn {
                id: c.required_id("id")?,
                width: c.geometry("width")?,
                extra: c.extra(),
            })
        })
        .collect::<Result<_, String>>()?;
    let rows = f.array("rows")?.iter().map(table_row).collect::<Result<_, String>>()?;
    Ok(TableData {
        header: f.flag("header")?,
        columns,
        rows,
        extra: f.extra(),
    })
}

fn table_row(value: &Value) -> Result<TableRow, String> {
    let r = Fields::new(item_object(value, "rows")?, "row", &["id", "cells"]);
    let mut cells = BTreeMap::new();
    for (key, cell) in r.object("cells")?.into_iter().flatten() {
        let column: ColumnId = key.parse().map_err(|_| format!("{key:?} is not a column ID"))?;
        let c = Fields::new(item_object(cell, "cells")?, "cell", &["markdown"]);
        let cell = TableCell {
            markdown: c.string_or("markdown", "")?,
            extra: c.extra(),
        };
        cells.insert(column, cell);
    }
    Ok(TableRow {
        id: r.required_id("id")?,
        cells,
        extra: r.extra(),
    })
}
