//! Phase 5's ink commands over the core bridge. New strokes arrive as binary records with the edits that go before
//! them in the same transaction (`page_add_strokes`), and a page whose envelope held only the strokes near the
//! viewport reads the rest at once (`page_read_strokes`).
//!
//! A `page_add_strokes` body is a `u32` length, little-endian, then that many bytes of JSON (`StrokesHeader`), and
//! then the stroke records in the segment record format. The JSON rides in the body rather than a header, so a
//! partial erase that removes many strokes never runs into a header size limit.

use opennote_core::{
    ops::{
        resolve::{Edit, StrokeTxnMeta},
        CoalesceKey,
    },
    session::page::{PageHandle, TxnAck},
};
use serde::Deserialize;
use serde_json::Value;
use tauri::{
    ipc::{InvokeBody, Response},
    State,
};

use crate::{
    core_bridge::CoreBridge,
    ipc::{IpcError, IpcResult},
};

/// The JSON part of a `page_add_strokes` body: the interface's page, its client, and the transaction's metadata.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StrokesHeader {
    page: String,
    client: String,
    client_seq: u64,
    #[serde(default)]
    coalesce: Option<CoalesceKey>,
    #[serde(default)]
    ui: Option<Value>,
    #[serde(default)]
    edits: Vec<Edit>,
}

/// Splits a body into its header and its records.
pub fn split_body(body: &[u8]) -> IpcResult<(StrokesHeader, &[u8])> {
    let bad = |message: &str| IpcError::invalid("body", message);
    let length = body
        .get(..4)
        .map(|bytes| u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) as usize)
        .ok_or_else(|| bad("The strokes body is too short."))?;
    let json = body
        .get(4..4 + length)
        .ok_or_else(|| bad("The strokes header runs past the body."))?;
    let header: StrokesHeader =
        serde_json::from_slice(json).map_err(|error| bad(&format!("The strokes header isn't valid: {error}")))?;
    Ok((header, &body[4 + length..]))
}

/// Adds the records to the page as one transaction, after the header's edits.
pub fn add_strokes(handle: &PageHandle, header: StrokesHeader, records: &[u8]) -> IpcResult<TxnAck> {
    let meta = StrokeTxnMeta {
        page: handle.id(),
        client: handle.client().clone(),
        client_seq: header.client_seq,
        coalesce: header.coalesce,
        ui: header.ui,
        edits: header.edits,
    };
    handle
        .add_strokes(meta, records)
        .map_err(|error| IpcError::new(error.code(), error.to_string()))
}

/// New strokes and the edits before them, as one transaction (see the module comment for the body).
#[tauri::command]
pub async fn page_add_strokes(bridge: State<'_, CoreBridge>, request: tauri::ipc::Request<'_>) -> IpcResult<TxnAck> {
    let InvokeBody::Raw(body) = request.body() else {
        return Err(IpcError::invalid("body", "The strokes must come as raw bytes."));
    };
    let (header, records) = split_body(body)?;
    let handle = bridge.page_for(&header.page, &header.client)?;
    add_strokes(&handle, header, records)
}

/// Every live stroke of the page as ink records, in drawing order.
#[tauri::command]
pub async fn page_read_strokes(bridge: State<'_, CoreBridge>, page: String, client: String) -> IpcResult<Response> {
    let handle = bridge.page_for(&page, &client)?;
    Ok(Response::new(handle.read_strokes(None, None).records))
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use opennote_core::{
        format::{points::encode_points, segment::encode_records},
        model::{Channels, InkRecord, Point, Stroke, StrokeStyle},
        BlockId, StrokeId, Timestamp,
    };
    use serde_json::json;

    use super::*;

    const INK: &str = "01k6f00000000000000000k001";

    fn stroke(id: &str) -> Vec<u8> {
        let points = [
            Point {
                x: 640,
                y: 1_280,
                pressure: 32_768,
                ..Point::default()
            },
            Point {
                x: 720,
                y: 1_440,
                pressure: 36_044,
                ..Point::default()
            },
        ];
        let channels = Channels(Channels::PRESSURE);
        let mut encoded = Vec::new();
        let bbox = encode_points(&points, channels, &mut encoded).expect("points encode");
        let stroke = Stroke {
            id: StrokeId::parse(id).expect("a stroke ID"),
            block: BlockId::parse(INK).expect("a block ID"),
            start: Timestamp::from_unix_ms(1_790_777_258_345),
            start_unknown: false,
            style: StrokeStyle {
                tool: 0,
                palette: 1,
                color: [0x2b, 0x25, 0x21, 0xff],
                width: 2.0,
            },
            transform: None,
            origin: None,
            bbox,
            channels,
            point_count: 2,
            points: Arc::from(encoded),
        };
        encode_records(&[InkRecord::Stroke(Arc::new(stroke))])
    }

    fn body(header: &Value, records: &[u8]) -> Vec<u8> {
        let json = serde_json::to_vec(header).expect("JSON");
        let mut out = u32::try_from(json.len()).expect("short").to_le_bytes().to_vec();
        out.extend_from_slice(&json);
        out.extend_from_slice(records);
        out
    }

    fn header(seq: u64, edits: Value) -> Value {
        json!({ "page": "p-ink", "client": "main-1", "clientSeq": seq, "edits": edits })
    }

    fn new_layer() -> Value {
        json!([{ "edit": "insertBlock", "block": {
            "id": INK, "type": "ink", "frame": { "x": 0, "y": 0 }, "data": { "role": "layer" }
        } }])
    }

    #[test]
    fn a_body_splits_into_its_header_and_records() {
        let records = stroke("01k6f00000000000000000s001");
        let sent = body(&header(3, json!([])), &records);
        let (parsed, rest) = split_body(&sent).expect("splits");
        assert_eq!(parsed.client_seq, 3);
        assert_eq!(parsed.page, "p-ink");
        assert_eq!(rest, records.as_slice());
    }

    #[test]
    fn a_short_or_damaged_body_is_invalid() {
        assert_eq!(split_body(&[1, 0]).err().map(|e| e.code), Some("invalid".to_owned()));
        assert_eq!(
            split_body(&[200, 0, 0, 0, b'{']).err().map(|e| e.code),
            Some("invalid".to_owned())
        );
        let bad = body(&json!({ "page": 1 }), &[]);
        assert_eq!(split_body(&bad).err().map(|e| e.code), Some("invalid".to_owned()));
    }

    #[test]
    fn strokes_and_their_layer_land_in_one_step_and_read_back() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let bridge = CoreBridge::at(dir.path().to_owned());
        let handle = bridge.page_for("p-ink", "main-1").expect("a page");
        let records = stroke("01k6f00000000000000000s001");
        let sent = body(&header(1, new_layer()), &records);
        let (parsed, rest) = split_body(&sent).expect("splits");
        let ack = add_strokes(&handle, parsed, rest).expect("adds");
        assert!(ack.can_undo);
        let read = handle.read_strokes(None, None);
        assert_eq!(read.strokes, 1);
        assert_eq!(read.records, records);
        let frame = handle.undo(handle.client()).expect("undoes").expect("a frame");
        assert!(!frame.bytes.is_empty());
        assert_eq!(handle.read_strokes(None, None).strokes, 0);
        bridge.shutdown();
    }

    #[test]
    fn a_stroke_without_its_ink_block_is_refused() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let bridge = CoreBridge::at(dir.path().to_owned());
        let handle = bridge.page_for("p-ink", "main-1").expect("a page");
        let sent = body(&header(1, json!([])), &stroke("01k6f00000000000000000s002"));
        let (parsed, rest) = split_body(&sent).expect("splits");
        let refused = add_strokes(&handle, parsed, rest).expect_err("no ink block");
        assert_ne!(refused.code, "internal");
        bridge.shutdown();
    }
}
