//! The applied-changes frame for undo, redo, and changes pushed to other windows (plan 11.4). Owned by WP5.
//!
//! A frame is a `u32` JSON length, little-endian, the JSON, and then any stroke records in the segment record
//! format: the strokes the change added, or whose properties it changed, as they are now.

use std::collections::BTreeMap;

use serde::Serialize;

use super::WireError;
use crate::id::BlockId;
use crate::ops::AppliedChanges;

/// A `u32` JSON length, the JSON with the changes and the selection to restore, and then any stroke records.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AppliedFrame {
    /// The encoded frame.
    pub bytes: Vec<u8>,
}

/// The JSON part of a frame.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrameInfo {
    /// The journal sequence number of the change.
    pub seq: u64,
    /// What changed.
    pub changes: AppliedChanges,
    /// The selection to restore, opaque to the core.
    pub ui: Option<serde_json::Value>,
    /// The new Markdown of each changed text block, so the editor replaces only the range that differs.
    pub texts: BTreeMap<BlockId, String>,
    /// The page's title, when page fields changed.
    pub title: Option<String>,
    /// Whether the client can undo now.
    pub can_undo: bool,
    /// Whether the client can redo now.
    pub can_redo: bool,
    /// How many stroke records follow the JSON.
    pub strokes: u32,
}

/// Encodes a frame.
pub fn encode(info: &FrameInfo, records: &[u8]) -> Result<AppliedFrame, WireError> {
    let json = serde_json::to_vec(info).map_err(|_| WireError::Json)?;
    let len = u32::try_from(json.len()).map_err(|_| WireError::TooLarge)?;
    let mut bytes = Vec::with_capacity(json.len().saturating_add(records.len()).saturating_add(4));
    bytes.extend_from_slice(&len.to_le_bytes());
    bytes.extend_from_slice(&json);
    bytes.extend_from_slice(records);
    Ok(AppliedFrame { bytes })
}

/// Reads a frame back: its JSON and its stroke records.
pub fn decode(bytes: &[u8]) -> Result<(serde_json::Value, &[u8]), WireError> {
    let len_bytes: [u8; 4] = bytes
        .get(..4)
        .and_then(|b| b.try_into().ok())
        .ok_or(WireError::Truncated)?;
    let len = usize::try_from(u32::from_le_bytes(len_bytes)).map_err(|_| WireError::TooLarge)?;
    let json = bytes.get(4..len.saturating_add(4)).ok_or(WireError::Truncated)?;
    let records = bytes.get(len.saturating_add(4)..).ok_or(WireError::Truncated)?;
    let value = serde_json::from_slice(json).map_err(|_| WireError::Json)?;
    Ok((value, records))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::indexing_slicing)]

    use super::*;
    use crate::id::Id;

    #[test]
    fn round_trips_the_json_and_the_records() {
        let block = BlockId(Id::from_parts(1, 2));
        let info = FrameInfo {
            seq: 9,
            changes: AppliedChanges {
                blocks_changed: vec![block],
                ..AppliedChanges::default()
            },
            ui: Some(serde_json::json!({"anchor": 3})),
            texts: BTreeMap::from([(block, "Hello".to_owned())]),
            title: None,
            can_undo: false,
            can_redo: true,
            strokes: 0,
        };
        let frame = encode(&info, b"records").unwrap();
        let (json, records) = decode(&frame.bytes).unwrap();
        assert_eq!(records, b"records");
        assert_eq!(json["seq"], 9);
        assert_eq!(json["canRedo"], true);
        assert_eq!(json["texts"][block.to_string()], "Hello");
        assert_eq!(json["changes"]["blocksChanged"][0], block.to_string());
        assert_eq!(decode(&frame.bytes[..3]), Err(WireError::Truncated));
        assert_eq!(decode(&[9, 0, 0, 0, b'{']), Err(WireError::Truncated));
    }
}
