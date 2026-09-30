//! Parts of `page.json` inside journal JSON: blocks, a view, and asset table entries (spec 20.7).
//!
//! The journal writes these "as in `page.json`", so it borrows the page codec instead of keeping a second
//! writer. A fragment is written by putting it on an otherwise empty page, writing that page, and taking the
//! field back out. When the codec doesn't write JSON, as the registry codec of the tests doesn't, the fragment
//! is the codec's whole output as a string, which reads back the same way.

use std::sync::Arc;

use serde_json::Value;

use crate::error::{FormatError, FormatErrorKind};
use crate::format::names::asset_file_name;
use crate::id::{AssetId, DeviceId, Id, PageId, RevisionId};
use crate::limits::Limits;
use crate::model::{Asset, Block, DeviceRef, JsonMap, Page, PageView, Revision};
use crate::seams::Codec;
use crate::time::Timestamp;

/// The `page.json` key of each fragment.
const BLOCKS: &str = "blocks";
const VIEW: &str = "view";
const ASSETS: &str = "assets";

/// An empty page, the frame for fragments.
fn skeleton() -> Page {
    let device = DeviceRef {
        id: DeviceId::ZERO,
        label: String::new(),
    };
    let revision = Revision::new(RevisionId::ZERO, Timestamp::EPOCH, device, "");
    Page::new(PageId::ZERO, Timestamp::EPOCH, revision)
}

/// Writes blocks as `page.json` writes them.
pub fn write_blocks(codec: &dyn Codec, blocks: &[Arc<Block>]) -> Value {
    let mut page = skeleton();
    for block in blocks {
        // Blocks of one operation have distinct IDs, so an insert fails only on a writer bug, which the
        // decoder then reports.
        let _ = page.blocks.insert(block.clone());
    }
    write_field(codec, &page, BLOCKS)
}

/// Reads blocks written by [`write_blocks`], in order key and ID order.
pub fn read_blocks(codec: &dyn Codec, value: &Value, limits: &Limits) -> Result<Vec<Arc<Block>>, FormatError> {
    let assets = referenced_assets(value);
    let page = read_field(codec, value, BLOCKS, &assets, limits)?;
    Ok(page.blocks.iter().cloned().collect())
}

/// Writes a view as `page.json` writes it.
pub fn write_view(codec: &dyn Codec, view: &PageView) -> Value {
    let mut page = skeleton();
    page.view = view.clone();
    write_field(codec, &page, VIEW)
}

/// Reads a view written by [`write_view`].
pub fn read_view(codec: &dyn Codec, value: &Value, limits: &Limits) -> Result<PageView, FormatError> {
    Ok(read_field(codec, value, VIEW, &[], limits)?.view)
}

/// Writes an asset table entry, with its ID under `id`.
pub fn write_asset(codec: &dyn Codec, asset: &Asset) -> Value {
    let mut page = skeleton();
    page.assets.insert(asset.id, asset.clone());
    match write_field(codec, &page, ASSETS) {
        Value::Object(mut table) => match table.remove(&asset.id.to_string()) {
            Some(Value::Object(mut entry)) => {
                entry.insert("id".to_owned(), Value::String(asset.id.to_string()));
                Value::Object(entry)
            }
            _ => Value::Null,
        },
        other => other,
    }
}

/// Reads an asset table entry written by [`write_asset`].
pub fn read_asset(codec: &dyn Codec, value: &Value, limits: &Limits) -> Result<Asset, FormatError> {
    let table = match value {
        Value::Object(entry) => {
            let mut entry = entry.clone();
            let id = entry
                .remove("id")
                .and_then(|id| id.as_str().map(str::to_owned))
                .ok_or_else(|| invalid("an asset without its ID"))?;
            let mut table = JsonMap::new();
            table.insert(id, Value::Object(entry));
            Value::Object(table)
        }
        other => other.clone(),
    };
    let page = read_field(codec, &table, ASSETS, &[], limits)?;
    page.assets.into_values().next().ok_or_else(|| invalid("no asset"))
}

fn write_field(codec: &dyn Codec, page: &Page, key: &str) -> Value {
    let bytes = codec.write_page(page);
    match serde_json::from_slice::<Value>(&bytes) {
        Ok(Value::Object(mut map)) => map.remove(key).unwrap_or(Value::Null),
        _ => Value::String(String::from_utf8_lossy(&bytes).into_owned()),
    }
}

fn read_field(
    codec: &dyn Codec,
    value: &Value,
    key: &str,
    assets: &[AssetId],
    limits: &Limits,
) -> Result<Page, FormatError> {
    match value {
        Value::String(token) => Ok(codec.read_page(token.as_bytes(), limits)?.page),
        Value::Null => Ok(skeleton()),
        field => {
            let mut frame = skeleton();
            for &id in assets {
                frame.assets.insert(id, placeholder_asset(id));
            }
            let Ok(Value::Object(mut map)) = serde_json::from_slice::<Value>(&codec.write_page(&frame)) else {
                return Err(invalid("the codec doesn't write JSON pages"));
            };
            map.insert(key.to_owned(), field.clone());
            let bytes = serde_json::to_vec(&Value::Object(map)).map_err(|err| invalid(&err.to_string()))?;
            Ok(codec.read_page(&bytes, limits)?.page)
        }
    }
}

/// An asset table entry for an asset that blocks refer to, so the frame page passes the structural checks of
/// spec 16. It never leaves the decoder.
fn placeholder_asset(id: AssetId) -> Asset {
    let mime = "application/octet-stream";
    Asset {
        id,
        file: asset_file_name(id, "asset", mime),
        mime: mime.to_owned(),
        bytes: 0,
        sha256: [0; 32],
        name: "asset".to_owned(),
        width: None,
        height: None,
        created: Timestamp::EPOCH,
        extra: JsonMap::new(),
    }
}

/// Every asset ID the blocks name: in `data.asset`, `fallback.image`, and `asset:` links in Markdown.
fn referenced_assets(value: &Value) -> Vec<AssetId> {
    let mut found = Vec::new();
    for block in value.as_array().into_iter().flatten() {
        let named = [block.pointer("/data/asset"), block.pointer("/fallback/image")];
        found.extend(named.into_iter().flatten().filter_map(parse_asset));
        let texts = [block.pointer("/data/markdown"), block.pointer("/fallback/markdown")];
        for text in texts.into_iter().flatten().filter_map(Value::as_str) {
            found.extend(markdown_assets(text));
        }
    }
    found.sort();
    found.dedup();
    found
}

fn parse_asset(value: &Value) -> Option<AssetId> {
    value.as_str().and_then(|text| AssetId::parse(text).ok())
}

fn markdown_assets(text: &str) -> impl Iterator<Item = AssetId> + '_ {
    text.match_indices("asset:").filter_map(|(at, link)| {
        let start = at.checked_add(link.len())?;
        let end = start.checked_add(Id::TEXT_LEN)?;
        text.get(start..end).and_then(|id| AssetId::parse(id).ok())
    })
}

fn invalid(detail: &str) -> FormatError {
    FormatError::new(FormatErrorKind::Validation, format!("journal: {detail}"))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::indexing_slicing)]

    use super::*;
    use crate::testing::sample::{sample_asset_id, sample_page};
    use crate::testing::RegistryCodec;

    #[test]
    fn fragments_round_trip_through_a_token_codec() {
        let codec = RegistryCodec::new();
        let page = sample_page();
        let blocks: Vec<Arc<Block>> = page.blocks.iter().cloned().collect();
        let limits = Limits::default();
        assert_eq!(
            read_blocks(&codec, &write_blocks(&codec, &blocks), &limits).unwrap(),
            blocks
        );
        assert_eq!(
            read_view(&codec, &write_view(&codec, &page.view), &limits).unwrap(),
            page.view
        );
        let asset = page.assets[&sample_asset_id()].clone();
        assert_eq!(
            read_asset(&codec, &write_asset(&codec, &asset), &limits).unwrap(),
            asset
        );
        assert!(read_blocks(&codec, &Value::Null, &limits).unwrap().is_empty());
    }

    #[test]
    fn finds_assets_that_blocks_name() {
        let id = "01m3sa43z1tp9rdr5e8df2jbxy";
        let blocks = serde_json::json!([
            {"data": {"asset": id}},
            {"data": {"markdown": format!("![leaf](asset:{id}) and asset:nonsense")}},
            {"fallback": {"image": "01m3sa43z1tp9rdr5e8df2jbxz"}},
        ]);
        let found = referenced_assets(&blocks);
        assert_eq!(found.len(), 2);
        assert_eq!(found[0].to_string(), id);
    }
}
