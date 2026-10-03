//! Downloading a web image for import, over the updater's TLS stack (owner after WP0: WP5).

use tauri::AppHandle;

use super::ImportedAsset;
use crate::ipc::{IpcError, IpcResult};

#[tauri::command]
pub async fn image_import_url(app: AppHandle, page: String, url: String) -> IpcResult<ImportedAsset> {
    let _ = (app, page, url);
    Err(IpcError::not_implemented("image_import_url"))
}
