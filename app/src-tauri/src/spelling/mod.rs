//! Spell check through the Windows Spell Checking API (Phase 4 ARCHITECTURE.md section 16; owner after WP0: WP7).
//! Ranges are in UTF-16 units, as the interface counts them. WP0's commands answer notImplemented.

pub mod windows;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};

use crate::ipc::{IpcError, IpcResult};

pub use self::windows::SpellService;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SpellLanguage {
    pub tag: String,
    pub name: String,
    pub is_default: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct SpellItem {
    pub id: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SpellResult {
    pub id: String,
    pub errors: Vec<SpellError>,
}

#[derive(Debug, Clone, Copy, Serialize)]
pub struct SpellError {
    pub start: u32,
    pub length: u32,
}

#[tauri::command]
pub async fn spell_languages(svc: State<'_, SpellService>) -> IpcResult<Vec<SpellLanguage>> {
    let _ = svc;
    Err(IpcError::not_implemented("spell_languages"))
}

/// At most 200 items and 256 KB of text in one call.
#[tauri::command]
pub async fn spell_check(
    svc: State<'_, SpellService>,
    items: Vec<SpellItem>,
    languages: Vec<String>,
) -> IpcResult<Vec<SpellResult>> {
    let _ = (svc, items, languages);
    Err(IpcError::not_implemented("spell_check"))
}

#[tauri::command]
pub async fn spell_suggest(
    svc: State<'_, SpellService>,
    word: String,
    languages: Vec<String>,
) -> IpcResult<Vec<String>> {
    let _ = (svc, word, languages);
    Err(IpcError::not_implemented("spell_suggest"))
}

#[tauri::command]
pub async fn spell_add_word(app: AppHandle, word: String) -> IpcResult<()> {
    let _ = (app, word);
    Err(IpcError::not_implemented("spell_add_word"))
}

#[tauri::command]
pub async fn spell_remove_word(app: AppHandle, word: String) -> IpcResult<()> {
    let _ = (app, word);
    Err(IpcError::not_implemented("spell_remove_word"))
}
