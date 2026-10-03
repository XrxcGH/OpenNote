//! Study tools in the shell (Phase 10): reading and writing Anki packages for the Flashcards window. The
//! interface hands over a package's bytes and gets its notes back, or hands over a deck and gets a package.

pub mod anki;
mod zip;
mod zotero;

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
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |elapsed| elapsed.as_millis() as i64);
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
