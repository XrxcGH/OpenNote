//! Study tools in the shell (Phase 10): reading and writing Anki packages for the Flashcards window. The
//! interface hands over a package's bytes and gets its notes back, or hands over a deck and gets a package.

pub mod anki;
mod zip;
mod zotero;
mod zotero_wp;

use std::time::{SystemTime, UNIX_EPOCH};

use tauri::ipc::{InvokeBody, Request, Response};

use crate::ipc::{codes, IpcError, IpcResult};

/// The largest package that is read, in bytes.
const MAX_PACKAGE_BYTES: usize = 512 * 1024 * 1024;

/// Reads an Anki package sent as the raw body. A package in a newer format fails with the code `newer`.
#[tauri::command]
pub async fn study_anki_read(request: Request<'_>) -> IpcResult<anki::Read> {
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) if bytes.len() <= MAX_PACKAGE_BYTES => bytes.clone(),
        InvokeBody::Raw(_) => return Err(IpcError::invalid("body", "The package is too large.")),
        InvokeBody::Json(_) => return Err(IpcError::invalid("body", "The package must come as raw bytes.")),
    };
    tauri::async_runtime::spawn_blocking(move || anki::read(&bytes))
        .await
        .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))?
        .map_err(|reason| {
            if reason == "newer" {
                IpcError::new("newer", "The package is in a newer Anki format.")
            } else {
                IpcError::new(codes::IO, reason)
            }
        })
}

/// Writes a deck as an Anki package and returns its bytes.
#[tauri::command]
pub async fn study_anki_write(deck: anki::DeckIn) -> IpcResult<Response> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |elapsed| elapsed.as_millis() as i64);
    let bytes = tauri::async_runtime::spawn_blocking(move || anki::write(&deck, now))
        .await
        .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))?
        .map_err(|reason| IpcError::new(codes::IO, reason))?;
    Ok(Response::new(bytes))
}

/// Asks Zotero on this computer for the person's library. Fails with the code `zoteroOff` when its local API is
/// off, and `zoteroMissing` when Zotero is not running.
#[tauri::command]
pub async fn study_zotero_items() -> IpcResult<String> {
    tauri::async_runtime::spawn_blocking(zotero::fetch)
        .await
        .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))?
        .map_err(|reason| match reason.as_str() {
            "disabled" => IpcError::new("zoteroOff", "Zotero's local API is off."),
            "unreachable" => IpcError::new("zoteroMissing", "Zotero is not running."),
            _ => IpcError::new(codes::IO, reason),
        })
}

/// One call from Zotero, handed to the page.
#[derive(serde::Serialize)]
pub struct ZoteroCall {
    txid: u32,
    method: String,
    args: Vec<serde_json::Value>,
}

/// Runs one Zotero integration command (Add or Edit Citation, Add Bibliography, Refresh, and so on). Zotero shows its
/// own dialogs and calls back into the page; every call arrives on `calls` and is answered with `study_zotero_reply`.
/// Resolves when Zotero finishes or closes the connection. Fails with `zoteroMissing` when Zotero is not running.
#[tauri::command]
pub async fn study_zotero_run(
    command: String,
    calls: tauri::ipc::Channel<ZoteroCall>,
) -> IpcResult<serde_json::Value> {
    tauri::async_runtime::spawn_blocking(move || {
        zotero_wp::run_for_page(
            &command,
            &mut |call| {
                let _ = calls.send(ZoteroCall {
                    txid: call.txid,
                    method: call.method.clone(),
                    args: call.args.clone(),
                });
            },
            zotero_wp::default_addr(),
        )
    })
    .await
    .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))?
    .map(|outcome| {
        serde_json::json!({ "calls": outcome.calls, "completed": outcome.completed, "errors": outcome.errors })
    })
    .map_err(|error| match error {
        zotero_wp::SessionError::NotRunning(_) => IpcError::new("zoteroMissing", "Zotero is not running."),
        zotero_wp::SessionError::Io(reason) | zotero_wp::SessionError::Protocol(reason) => {
            IpcError::new(codes::IO, reason)
        }
    })
}

/// The page's answer to a Zotero call: `ok` with the value, or an error message in `value`.
#[tauri::command]
pub fn study_zotero_reply(txid: u32, ok: bool, value: serde_json::Value) -> IpcResult<bool> {
    let answer = if ok { Ok(value) } else { Err(value.as_str().unwrap_or("failed").to_owned()) };
    Ok(zotero_wp::reply(txid, answer))
}
