//! A block's view: the JSON object that `PatchBlock` patches.
//!
//! The view holds `lock`, `data`, and `fallback`, written as `page.json` writes them. Reading a view back gives
//! the block with those three parts replaced. Reading and then writing a view that [`block_view`] wrote gives
//! the same view, so patches between views are exact.

mod data;
pub(crate) mod fields;

use serde_json::Value;

use crate::model::{Block, BlockData, Fallback, JsonMap, Lock, Named, OtherData};

use fields::{Fields, Out};

pub use data::{
    file_from_json, file_to_json, image_from_json, image_to_json, ink_from_json, ink_to_json, table_from_json,
    table_to_json, text_from_json, text_to_json,
};

/// The keys of a view.
pub const VIEW_KEYS: [&str; 3] = ["lock", "data", "fallback"];

/// The block types of version 1 (spec 6.3).
pub const V1_TYPES: [&str; 5] = ["text", "ink", "image", "file", "table"];

/// Type names reserved for later versions (spec 6.4).
pub const RESERVED_TYPES: [&str; 10] = [
    "chart", "math", "graph", "embed", "audio", "pdf", "card", "break", "shape", "group",
];

/// The prefix of OpenNote's own extension types (spec 6.4), such as `ext:org.opennote/recording`.
pub const OWN_EXTENSION_PREFIX: &str = "ext:org.opennote/";

/// Whether this writer may change a block's `data` and `fallback`. Version 1 types may be edited, and so may
/// OpenNote's own extension types, because OpenNote knows them. Any other unknown type, and a known type whose
/// data failed to read, is kept exactly (spec 6.5): it can be moved, locked, and deleted, but not edited.
pub fn data_editable(data: &BlockData) -> bool {
    match data {
        BlockData::Other(other) => other.unreadable.is_none() && other.type_name.starts_with(OWN_EXTENSION_PREFIX),
        _ => true,
    }
}

/// The block's `lock`, `data`, and `fallback`, as `page.json` writes them.
pub fn block_view(block: &Block) -> JsonMap {
    let mut view = JsonMap::new();
    if let Some(lock) = &block.lock {
        view.insert("lock".to_owned(), Value::from(lock.as_str()));
    }
    view.insert("data".to_owned(), Value::Object(data_to_json(&block.data)));
    if let Some(fallback) = &block.fallback {
        view.insert("fallback".to_owned(), Value::Object(fallback_to_json(fallback)));
    }
    view
}

/// The block with its `lock`, `data`, and `fallback` read from `view`. The block keeps its type: an unknown
/// or unreadable type keeps its `data` object as it is.
pub fn apply_view(block: &Block, view: &JsonMap) -> Result<Block, String> {
    if let Some(key) = view.keys().find(|key| !VIEW_KEYS.contains(&key.as_str())) {
        return Err(format!("a block patch can't change {key:?}"));
    }
    let f = Fields::new(view, "block", &VIEW_KEYS);
    let lock = f.str("lock")?.map(Named::<Lock>::parse);
    let data = f.object("data")?.ok_or("a block must keep its data")?;
    let data = match &block.data {
        BlockData::Other(other) => BlockData::Other(OtherData {
            data: data.clone(),
            ..other.clone()
        }),
        known => data_from_json(block_type(known), data)?,
    };
    let fallback = f.object("fallback")?.map(fallback_from_json).transpose()?;
    Ok(Block {
        lock,
        data,
        fallback,
        ..block.clone()
    })
}

fn block_type(data: &BlockData) -> &str {
    match data {
        BlockData::Text(_) => "text",
        BlockData::Ink(_) => "ink",
        BlockData::Image(_) => "image",
        BlockData::File(_) => "file",
        BlockData::Table(_) => "table",
        BlockData::Other(other) => &other.type_name,
    }
}

/// A block's `data` object.
pub fn data_to_json(data: &BlockData) -> JsonMap {
    match data {
        BlockData::Text(text) => text_to_json(text),
        BlockData::Ink(ink) => ink_to_json(ink),
        BlockData::Image(image) => image_to_json(image),
        BlockData::File(file) => file_to_json(file),
        BlockData::Table(table) => table_to_json(table),
        BlockData::Other(other) => other.data.clone(),
    }
}

/// Reads the `data` of a block of type `type_name`. Types other than those of version 1 are kept as they are.
pub fn data_from_json(type_name: &str, data: &JsonMap) -> Result<BlockData, String> {
    Ok(match type_name {
        "text" => BlockData::Text(text_from_json(data)?),
        "ink" => BlockData::Ink(ink_from_json(data)?),
        "image" => BlockData::Image(image_from_json(data)?),
        "file" => BlockData::File(file_from_json(data)?),
        "table" => BlockData::Table(table_from_json(data)?),
        other => BlockData::Other(OtherData {
            type_name: other.into(),
            data: data.clone(),
            unreadable: None,
        }),
    })
}

/// A fallback object (spec 6.5).
pub fn fallback_to_json(fallback: &Fallback) -> JsonMap {
    let mut out = Out::new(&fallback.extra);
    out.put("markdown", fallback.markdown.clone());
    out.put_if(fallback.image.is_some(), "image", || {
        fallback.image.map_or(Value::Null, |id| Value::from(id.to_string()))
    });
    out.done()
}

/// Reads a fallback object.
pub fn fallback_from_json(map: &JsonMap) -> Result<Fallback, String> {
    let f = Fields::new(map, "fallback", &["markdown", "image"]);
    Ok(Fallback {
        markdown: f.required_str("markdown")?.to_owned(),
        image: f.id("image")?,
        extra: f.extra(),
    })
}

#[cfg(test)]
mod tests;
