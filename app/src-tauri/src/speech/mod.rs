//! The read-aloud fallback over Windows' speech synthesis (Phase 4 ARCHITECTURE.md section 19.1; owner after WP0:
//! WP7). Read aloud uses the browser's Web Speech voices; these commands are built only if spike S2 shows WebView2
//! lacks them, and until then answer notImplemented.

use serde::Serialize;

use crate::ipc::{IpcError, IpcResult};

#[derive(Debug, Clone, Serialize)]
pub struct Voice {
    pub id: String,
    pub name: String,
    pub language: String,
}

#[tauri::command]
pub async fn speech_voices() -> IpcResult<Vec<Voice>> {
    Err(IpcError::not_implemented("speech_voices"))
}

/// The JSON length as 4 bytes, the word boundaries as JSON, then the WAV bytes.
#[tauri::command]
pub async fn speech_synthesize(text: String, voice: String) -> IpcResult<tauri::ipc::Response> {
    let _ = (text, voice);
    Err(IpcError::not_implemented("speech_synthesize"))
}
