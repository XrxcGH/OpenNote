//! The asset table, the ink segment list, and the revision of `page.json` (spec 5.3, 8.3, and 10.2), and the
//! device object that other files share.

use std::collections::BTreeMap;

use serde_json::Value;

use crate::error::FormatError;
use crate::format::json::{Fields, Json, Obj};
use crate::id::{AssetId, Id};
use crate::model::{Asset, DeviceRef, JsonMap, Revision, SegmentRef, Warning};

/// Reads the asset table, keyed by asset ID.
pub fn read_assets(map: JsonMap) -> Result<BTreeMap<AssetId, Asset>, FormatError> {
    let mut assets = BTreeMap::new();
    for (key, value) in map {
        let context = format!("page.assets.{key}");
        let mut fields = Fields::new(value, &context)?;
        let id: AssetId = fields.parse_id("id", &key)?;
        let sha256 = fields.str("sha256")?;
        let asset = Asset {
            id,
            file: fields.str("file")?,
            mime: fields.str("mime")?,
            bytes: fields.u64("bytes")?,
            sha256: parse_sha256(&sha256).ok_or_else(|| fields.error("sha256", "expected 64 hexadecimal digits"))?,
            name: fields.str("name")?,
            width: fields.opt_u32("width")?,
            height: fields.opt_u32("height")?,
            created: fields.time("created")?,
            extra: fields.rest(),
        };
        assets.insert(id, asset);
    }
    Ok(assets)
}

fn parse_sha256(text: &str) -> Option<[u8; 32]> {
    let mut out = [0u8; 32];
    if text.len() != 64 {
        return None;
    }
    for (slot, pair) in out.iter_mut().zip(text.as_bytes().chunks(2)) {
        let pair = std::str::from_utf8(pair).ok()?;
        *slot = u8::from_str_radix(pair, 16).ok()?;
    }
    Some(out)
}

/// Writes the asset table in ID order.
pub fn write_assets(assets: &BTreeMap<AssetId, Asset>) -> Json<'_> {
    Json::keyed(assets.iter().map(|(id, asset)| {
        let mut obj = Obj::new();
        obj.put("file", Json::str(&asset.file))
            .put("mime", Json::str(&asset.mime))
            .put("bytes", Json::Int(asset.bytes.into()))
            .put("sha256", Json::string(asset.sha256_hex()))
            .put("name", Json::str(&asset.name))
            .opt("width", asset.width.map(|w| Json::Int(w.into())))
            .opt("height", asset.height.map(|h| Json::Int(h.into())))
            .put("created", Json::string(asset.created.to_rfc3339()));
        (id.to_string(), obj.finish(&asset.extra))
    }))
}

/// Reads the `ink` object: the segment list. Unknown keys of the `ink` object itself have nowhere to go in
/// the model, so they are reported as a warning.
pub fn read_ink(value: Value, warnings: &mut Vec<Warning>) -> Result<Vec<SegmentRef>, FormatError> {
    let mut fields = Fields::new(value, "page.ink")?;
    let items = fields.array("segments")?;
    if fields.has_rest() {
        let keys: Vec<String> = fields.rest().into_iter().map(|(key, _)| key).collect();
        warnings.push(Warning::new("page.ink.unknownKeys", keys.join(", ")));
    }
    items
        .into_iter()
        .enumerate()
        .map(|(index, item)| read_segment_ref(item, index))
        .collect()
}

fn read_segment_ref(value: Value, index: usize) -> Result<SegmentRef, FormatError> {
    let mut fields = Fields::new(value, format_args!("page.ink.segments[{index}]"))?;
    let crc = fields.str("crc32")?;
    let crc32 = parse_crc(&crc).ok_or_else(|| fields.error("crc32", "expected 8 hexadecimal digits"))?;
    Ok(SegmentRef {
        id: fields.id("id")?,
        bytes: fields.u64("bytes")?,
        records: fields.u32("records")?,
        crc32,
        extra: fields.rest(),
    })
}

/// A CRC-32 written as 8 hexadecimal digits (spec 2.1).
pub fn parse_crc(text: &str) -> Option<u32> {
    if text.len() != 8 || !text.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    u32::from_str_radix(text, 16).ok()
}

/// Writes the `ink` object, or nothing when there are no segments.
pub fn write_ink(segments: &[SegmentRef]) -> Option<Json<'_>> {
    if segments.is_empty() {
        return None;
    }
    let items = segments.iter().map(|segment| {
        let mut obj = Obj::new();
        obj.put("id", Json::string(segment.id.to_string()))
            .put("bytes", Json::Int(segment.bytes.into()))
            .put("records", Json::Int(segment.records.into()))
            .put("crc32", Json::string(format!("{:08x}", segment.crc32)));
        obj.finish(&segment.extra)
    });
    let mut obj = Obj::new();
    obj.put("segments", Json::Array(items.collect()));
    Some(obj.done())
}

/// Reads the revision object (spec 5.3).
pub fn read_revision(value: Value) -> Result<Revision, FormatError> {
    let mut fields = Fields::new(value, "page.revision")?;
    Ok(Revision {
        id: fields.id("id")?,
        parents: fields.ids("parents")?,
        ancestors: fields.ids("ancestors")?,
        saved_at: fields.time("savedAt")?,
        device: read_device(fields.required("device")?, "page.revision.device")?,
        writer: fields.str("writer")?,
        extra: fields.rest(),
    })
}

/// Writes the revision object.
pub fn write_revision(revision: &Revision) -> Json<'_> {
    let mut obj = Obj::new();
    obj.put("id", Json::string(revision.id.to_string()))
        .put("parents", Json::strings(&revision.parents))
        .put("ancestors", Json::strings(&revision.ancestors))
        .put("savedAt", Json::string(revision.saved_at.to_rfc3339()))
        .put("device", write_device(&revision.device))
        .put("writer", Json::str(&revision.writer));
    obj.finish(&revision.extra)
}

/// Reads a device object: its ID and label. The model keeps no unknown keys for it.
pub fn read_device(value: Value, context: &str) -> Result<DeviceRef, FormatError> {
    let mut fields = Fields::new(value, context)?;
    let id: Id = fields.id("id")?;
    Ok(DeviceRef {
        id: id.into(),
        label: fields.str("label")?,
    })
}

/// Writes a device object.
pub fn write_device(device: &DeviceRef) -> Json<'_> {
    let mut obj = Obj::new();
    obj.put("id", Json::string(device.id.to_string()))
        .put("label", Json::str(&device.label));
    obj.done()
}
