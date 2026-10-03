//! Importing image bytes and Word's clipboard images into a page (owner after WP0: WP5).

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::{
    clipboard::ClipTokens,
    ipc::{IpcError, IpcResult},
};

#[derive(Debug, Clone, Serialize)]
pub struct ImportedAsset {
    pub id: String,
    pub asset: serde_json::Value,
}

/// A raw body with the header `x-opennote-image: {"page","name","mime"}`.
#[tauri::command]
pub async fn image_import(app: AppHandle, request: tauri::ipc::Request<'_>) -> IpcResult<ImportedAsset> {
    let _ = (app, request.headers());
    Err(IpcError::not_implemented("image_import"))
}

#[tauri::command]
pub async fn image_import_clip(
    app: AppHandle,
    tokens: State<'_, ClipTokens>,
    page: String,
    token: String,
) -> IpcResult<ImportedAsset> {
    let _ = (app, tokens.resolve(&token), page);
    Err(IpcError::not_implemented("image_import_clip"))
}
