//! The `data` of each version 1 block type (spec 6.3, 6.6, 6.7, and 8.1).
//!
//! Readers look at `data` without taking it apart, so a known type whose data is invalid keeps its JSON
//! exactly, as an unreadable block (spec 6.5).

use std::collections::BTreeMap;

use serde_json::Value;

use super::view::named;
use crate::format::json::{Json, Obj};
use crate::id::{ElementId, Id};
use crate::model::{
    AnchorQuote, BlockData, Crop, FileData, ImageData, InkAnchor, InkBlockData, JsonMap, Named, NamedValue, OtherData,
    TableCell, TableColumn, TableData, TableRow, TextData,
};

/// Reads `data` for a block type. Unknown types, and known types whose data fails, are kept as they are.
pub fn read_data(type_name: &str, data: JsonMap) -> BlockData {
    let parsed = match type_name {
        "text" => read_text(&data).map(BlockData::Text),
        "ink" => read_ink(&data).map(BlockData::Ink),
        "image" => read_image(&data).map(BlockData::Image),
        "file" => read_file(&data).map(BlockData::File),
        "table" => read_table(&data).map(BlockData::Table),
        _ => {
            return BlockData::Other(OtherData {
                type_name: type_name.into(),
                data,
                unreadable: None,
            })
        }
    };
    parsed.unwrap_or_else(|reason| {
        BlockData::Other(OtherData {
            type_name: type_name.into(),
            data,
            unreadable: Some(reason),
        })
    })
}

/// A read-only view of an object that remembers which keys were read.
struct View<'a> {
    map: &'a JsonMap,
    taken: Vec<&'static str>,
}

impl<'a> View<'a> {
    fn new(map: &'a JsonMap) -> View<'a> {
        View { map, taken: Vec::new() }
    }

    fn get(&mut self, key: &'static str) -> Option<&'a Value> {
        self.taken.push(key);
        self.map.get(key)
    }

    fn str(&mut self, key: &'static str) -> Result<&'a str, String> {
        self.get(key)
            .and_then(Value::as_str)
            .ok_or_else(|| format!("{key}: expected a string"))
    }

    fn str_or(&mut self, key: &'static str, default: &'a str) -> Result<&'a str, String> {
        match self.get(key) {
            None => Ok(default),
            Some(value) => value.as_str().ok_or_else(|| format!("{key}: expected a string")),
        }
    }

    fn id<T: From<Id>>(&mut self, key: &'static str) -> Result<T, String> {
        let text = self.str(key)?;
        parse_id(key, text)
    }

    fn bool_or(&mut self, key: &'static str, default: bool) -> Result<bool, String> {
        match self.get(key) {
            None => Ok(default),
            Some(value) => value.as_bool().ok_or_else(|| format!("{key}: expected true or false")),
        }
    }

    fn u32_or(&mut self, key: &'static str, default: u32) -> Result<u32, String> {
        match self.get(key) {
            None => Ok(default),
            Some(value) => value
                .as_u64()
                .and_then(|n| u32::try_from(n).ok())
                .ok_or_else(|| format!("{key}: expected a whole number")),
        }
    }

    fn number(&mut self, key: &'static str) -> Result<Option<f64>, String> {
        match self.get(key) {
            None => Ok(None),
            Some(value) => number(key, value).map(Some),
        }
    }

    fn named<T: NamedValue>(&mut self, key: &'static str) -> Result<Option<Named<T>>, String> {
        match self.get(key) {
            None => Ok(None),
            Some(value) => value
                .as_str()
                .map(|text| Some(Named::parse(text)))
                .ok_or_else(|| format!("{key}: expected a string")),
        }
    }

    fn array(&mut self, key: &'static str) -> Result<&'a [Value], String> {
        match self.get(key) {
            None => Ok(&[]),
            Some(Value::Array(items)) => Ok(items),
            Some(_) => Err(format!("{key}: expected an array")),
        }
    }

    fn object(&mut self, key: &'static str) -> Result<Option<&'a JsonMap>, String> {
        match self.get(key) {
            None => Ok(None),
            Some(Value::Object(map)) => Ok(Some(map)),
            Some(_) => Err(format!("{key}: expected an object")),
        }
    }

    fn rest(self) -> JsonMap {
        self.map
            .iter()
            .filter(|(key, _)| !self.taken.contains(&key.as_str()))
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect()
    }
}

fn parse_id<T: From<Id>>(key: &str, text: &str) -> Result<T, String> {
    Id::parse(text).map(T::from).map_err(|_| format!("{key}: not an ID"))
}

fn number(key: &str, value: &Value) -> Result<f64, String> {
    value
        .as_f64()
        .filter(|v| v.is_finite())
        .ok_or_else(|| format!("{key}: expected a number"))
}

fn strings(key: &str, items: &[Value]) -> Result<Vec<String>, String> {
    items
        .iter()
        .map(|item| {
            item.as_str()
                .map(str::to_owned)
                .ok_or_else(|| format!("{key}: expected strings"))
        })
        .collect()
}

fn element_ids<T: FromIterator<ElementId>>(key: &str, items: &[Value]) -> Result<T, String> {
    items
        .iter()
        .map(|item| {
            item.as_str()
                .ok_or_else(|| format!("{key}: expected IDs"))
                .and_then(|t| parse_id(key, t))
        })
        .collect()
}

fn read_text(map: &JsonMap) -> Result<TextData, String> {
    let mut view = View::new(map);
    let markdown = view.str("markdown")?.into();
    let ids = element_ids("ids", view.array("ids")?)?;
    let checked = element_ids("checked", view.array("checked")?)?;
    let mut tags = BTreeMap::new();
    for (key, value) in view.object("tags")?.into_iter().flatten() {
        let list = value.as_array().ok_or("tags: expected arrays of tags")?;
        tags.insert(parse_id("tags", key)?, strings("tags", list)?);
    }
    let mut styles = BTreeMap::new();
    for (key, value) in view.object("styles")?.into_iter().flatten() {
        let style = value.as_str().ok_or("styles: expected style names")?;
        styles.insert(parse_id("styles", key)?, style.to_owned());
    }
    Ok(TextData {
        markdown,
        ids,
        tags,
        styles,
        checked,
        extra: view.rest(),
    })
}

fn read_ink(map: &JsonMap) -> Result<InkBlockData, String> {
    let mut view = View::new(map);
    let role = view.named("role")?.ok_or("role: missing")?;
    let stroke_count = view.u32_or("strokeCount", 0)?;
    let anchor = view.object("anchor")?.map(read_anchor).transpose()?;
    Ok(InkBlockData {
        role,
        stroke_count,
        anchor,
        alt: view.str_or("alt", "")?.to_owned(),
        decorative: view.bool_or("decorative", false)?,
        extra: view.rest(),
    })
}

fn read_anchor(map: &JsonMap) -> Result<InkAnchor, String> {
    let mut view = View::new(map);
    let block = view.id("block")?;
    let para = match view.get("para") {
        None => None,
        Some(_) => Some(view.id("para")?),
    };
    let at = match view.get("at") {
        None => None,
        Some(_) => Some(view.u32_or("at", 0)?),
    };
    let quote = view.object("quote")?.map(read_quote).transpose()?;
    Ok(InkAnchor {
        block,
        para,
        at,
        quote,
        dx: view.number("dx")?.unwrap_or(0.0),
        dy: view.number("dy")?.unwrap_or(0.0),
        extra: view.rest(),
    })
}

fn read_quote(map: &JsonMap) -> Result<AnchorQuote, String> {
    let mut view = View::new(map);
    Ok(AnchorQuote {
        prefix: view.str_or("prefix", "")?.to_owned(),
        exact: view.str("exact")?.to_owned(),
        suffix: view.str_or("suffix", "")?.to_owned(),
        extra: view.rest(),
    })
}

fn read_image(map: &JsonMap) -> Result<ImageData, String> {
    let mut view = View::new(map);
    let crop = view.object("crop")?.map(read_crop).transpose()?;
    Ok(ImageData {
        asset: view.id("asset")?,
        alt: view.str_or("alt", "")?.to_owned(),
        decorative: view.bool_or("decorative", false)?,
        crop,
        extra: view.rest(),
    })
}

fn read_crop(map: &JsonMap) -> Result<Crop, String> {
    let mut view = View::new(map);
    let mut part = |key| view.number(key)?.ok_or(format!("crop.{key}: missing"));
    Ok(Crop {
        x: part("x")?,
        y: part("y")?,
        w: part("w")?,
        h: part("h")?,
        extra: view.rest(),
    })
}

fn read_file(map: &JsonMap) -> Result<FileData, String> {
    let mut view = View::new(map);
    Ok(FileData {
        asset: view.id("asset")?,
        display: view.named("display")?.unwrap_or_default(),
        alt: view.str_or("alt", "")?.to_owned(),
        decorative: view.bool_or("decorative", false)?,
        extra: view.rest(),
    })
}

fn read_table(map: &JsonMap) -> Result<TableData, String> {
    let mut view = View::new(map);
    let header = view.bool_or("header", false)?;
    let columns = view
        .array("columns")?
        .iter()
        .map(read_column)
        .collect::<Result<_, _>>()?;
    let rows = view.array("rows")?.iter().map(read_row).collect::<Result<_, _>>()?;
    Ok(TableData {
        header,
        columns,
        rows,
        extra: view.rest(),
    })
}

fn read_column(value: &Value) -> Result<TableColumn, String> {
    let mut view = View::new(value.as_object().ok_or("columns: expected objects")?);
    Ok(TableColumn {
        id: view.id("id")?,
        width: view.number("width")?,
        extra: view.rest(),
    })
}

fn read_row(value: &Value) -> Result<TableRow, String> {
    let mut view = View::new(value.as_object().ok_or("rows: expected objects")?);
    let id = view.id("id")?;
    let mut cells = BTreeMap::new();
    for (key, cell) in view.object("cells")?.into_iter().flatten() {
        let mut cell_view = View::new(cell.as_object().ok_or("cells: expected objects")?);
        let markdown = cell_view.str("markdown")?.to_owned();
        let cell = TableCell {
            markdown,
            extra: cell_view.rest(),
        };
        cells.insert(parse_id("cells", key)?, cell);
    }
    Ok(TableRow {
        id,
        cells,
        extra: view.rest(),
    })
}

/// Writes `data` for a block.
pub fn write_data(data: &BlockData) -> Json<'_> {
    match data {
        BlockData::Text(text) => write_text(text),
        BlockData::Ink(ink) => write_ink(ink),
        BlockData::Image(image) => write_image(image),
        BlockData::File(file) => write_file(file),
        BlockData::Table(table) => write_table(table),
        BlockData::Other(other) => Obj::new().finish(&other.data),
    }
}

fn id_string(id: impl ToString) -> Json<'static> {
    Json::string(id.to_string())
}

fn write_text(text: &TextData) -> Json<'_> {
    let mut obj = Obj::new();
    obj.put("markdown", Json::str(&text.markdown))
        .unless("ids", text.ids.is_empty(), || Json::strings(&text.ids));
    obj.unless("tags", text.tags.is_empty(), || {
        let items = text.tags.iter().map(|(id, tags)| (id.to_string(), Json::strings(tags)));
        Json::keyed(items)
    });
    obj.unless("styles", text.styles.is_empty(), || {
        Json::keyed(text.styles.iter().map(|(id, style)| (id.to_string(), Json::str(style))))
    });
    obj.unless("checked", text.checked.is_empty(), || Json::strings(&text.checked));
    obj.finish(&text.extra)
}

fn write_ink(ink: &InkBlockData) -> Json<'_> {
    let mut obj = Obj::new();
    obj.put("role", named(&ink.role))
        .put("strokeCount", Json::Int(ink.stroke_count.into()));
    obj.opt("anchor", ink.anchor.as_ref().map(write_anchor));
    obj.unless("alt", ink.alt.is_empty(), || Json::str(&ink.alt))
        .unless("decorative", !ink.decorative, || Json::Bool(true));
    obj.finish(&ink.extra)
}

fn write_image(image: &ImageData) -> Json<'_> {
    let mut obj = Obj::new();
    obj.put("asset", id_string(image.asset))
        .unless("alt", image.alt.is_empty(), || Json::str(&image.alt))
        .unless("decorative", !image.decorative, || Json::Bool(true));
    obj.opt(
        "crop",
        image.crop.as_ref().map(|crop| {
            let mut c = Obj::new();
            for (key, value) in [("x", crop.x), ("y", crop.y), ("w", crop.w), ("h", crop.h)] {
                c.put(key, Json::Fixed(value, 6));
            }
            c.finish(&crop.extra)
        }),
    );
    obj.finish(&image.extra)
}

fn write_file(file: &FileData) -> Json<'_> {
    let mut obj = Obj::new();
    obj.put("asset", id_string(file.asset))
        .unless("display", file.display == Named::default(), || named(&file.display))
        .unless("alt", file.alt.is_empty(), || Json::str(&file.alt))
        .unless("decorative", !file.decorative, || Json::Bool(true));
    obj.finish(&file.extra)
}

fn write_table(table: &TableData) -> Json<'_> {
    let columns = table.columns.iter().map(|column| {
        let mut obj = Obj::new();
        obj.put("id", id_string(column.id))
            .opt("width", column.width.map(Json::Geometry));
        obj.finish(&column.extra)
    });
    let rows = table.rows.iter().map(|row| {
        let cells = row.cells.iter().map(|(id, cell)| {
            let mut obj = Obj::new();
            obj.put("markdown", Json::str(&cell.markdown));
            (id.to_string(), obj.finish(&cell.extra))
        });
        let mut obj = Obj::new();
        obj.put("id", id_string(row.id)).put("cells", Json::keyed(cells));
        obj.finish(&row.extra)
    });
    let mut obj = Obj::new();
    obj.unless("header", !table.header, || Json::Bool(true))
        .put("columns", Json::Array(columns.collect()))
        .put("rows", Json::Array(rows.collect()));
    obj.finish(&table.extra)
}

fn write_anchor(anchor: &InkAnchor) -> Json<'_> {
    let mut a = Obj::new();
    a.put("block", id_string(anchor.block))
        .opt("para", anchor.para.map(id_string))
        .opt("at", anchor.at.map(|at| Json::Int(at.into())))
        .opt("quote", anchor.quote.as_ref().map(write_quote))
        .unless("dx", anchor.dx == 0.0, || Json::Geometry(anchor.dx))
        .unless("dy", anchor.dy == 0.0, || Json::Geometry(anchor.dy));
    a.finish(&anchor.extra)
}

fn write_quote(quote: &AnchorQuote) -> Json<'_> {
    let mut q = Obj::new();
    q.unless("prefix", quote.prefix.is_empty(), || Json::str(&quote.prefix))
        .put("exact", Json::str(&quote.exact))
        .unless("suffix", quote.suffix.is_empty(), || Json::str(&quote.suffix));
    q.finish(&quote.extra)
}
