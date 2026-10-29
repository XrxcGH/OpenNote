//! Phase 5's ink commands over the core bridge. New strokes arrive as binary records with the edits that go before
//! them in the same transaction (`page_add_strokes`), and a page whose envelope held only the strokes near the
//! viewport reads the rest at once (`page_read_strokes`).
//!
//! Both commands work on the client's open session of a page, which `page_open` made from the page's folder in its
//! notebook. So the strokes go to that folder's ink segments, with the page: they survive a restart, travel with a
//! copied notes folder, and go to Trash and back with their page.
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
    let records = records.to_vec();
    bridge
        .run(move |bridge| {
            let handle = bridge.with_named("page_add_strokes", |bridge| {
                bridge.open_handle(&header.page, &header.client)
            })?;
            add_strokes(&handle, header, &records)
        })
        .await
}

/// Every live stroke of the page as ink records, in drawing order.
#[tauri::command]
pub async fn page_read_strokes(bridge: State<'_, CoreBridge>, page: String, client: String) -> IpcResult<Response> {
    bridge
        .run(move |bridge| {
            let handle = bridge.with_named("page_read_strokes", |bridge| bridge.open_handle(&page, &client))?;
            Ok(Response::new(handle.read_strokes(None, None).records))
        })
        .await
}

#[cfg(test)]
#[path = "ink_bridge_tests.rs"]
mod tests;
