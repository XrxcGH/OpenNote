//! Clipboard facts for paste (Phase 4 ARCHITECTURE.md section 15.2; owner after WP0: WP5): the clipboard sequence
//! number, a hash of its text, CF_HTML's source address, whether OneNote put its formats there, and file tokens for
//! the temporary images Word leaves. WP0's commands answer notImplemented; the tokens are real.

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Mutex, PoisonError},
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::State;

use crate::ipc::{IpcError, IpcResult};

/// How long a file token stays valid.
const TOKEN_LIFE: Duration = Duration::from_secs(60);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardFacts {
    pub sequence: u32,
    pub text_sha256: Option<String>,
    pub source_url: Option<String>,
    pub has_one_note: bool,
    pub word_images: Vec<ClipImage>,
}

#[derive(Debug, Clone, Serialize)]
pub struct ClipImage {
    pub src: String,
    pub token: String,
}

/// Tokens that name files the shell found, so the interface never sends a path back.
#[derive(Default)]
pub struct ClipTokens {
    tokens: Mutex<HashMap<String, (PathBuf, Instant)>>,
    next: Mutex<u64>,
}

impl ClipTokens {
    pub fn issue(&self, path: PathBuf) -> String {
        let mut next = self.next.lock().unwrap_or_else(PoisonError::into_inner);
        *next += 1;
        let token = format!("clip-{next}");
        let mut tokens = self.tokens.lock().unwrap_or_else(PoisonError::into_inner);
        tokens.retain(|_, (_, at)| at.elapsed() < TOKEN_LIFE);
        tokens.insert(token.clone(), (path, Instant::now()));
        token
    }

    pub fn resolve(&self, token: &str) -> Option<PathBuf> {
        let tokens = self.tokens.lock().unwrap_or_else(PoisonError::into_inner);
        let (path, at) = tokens.get(token)?;
        (at.elapsed() < TOKEN_LIFE).then(|| path.clone())
    }
}

#[tauri::command]
pub async fn clipboard_facts(tokens: State<'_, ClipTokens>) -> IpcResult<ClipboardFacts> {
    let _ = tokens;
    Err(IpcError::not_implemented("clipboard_facts"))
}

/// The JSON length as 4 bytes, the JSON (facts, html, text), then BMP bytes if the clipboard holds an image.
#[tauri::command]
pub async fn clipboard_read(tokens: State<'_, ClipTokens>) -> IpcResult<tauri::ipc::Response> {
    let _ = tokens;
    Err(IpcError::not_implemented("clipboard_read"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_name_their_files_and_unknown_ones_name_nothing() {
        let tokens = ClipTokens::default();
        let token = tokens.issue(PathBuf::from("a.png"));
        assert_eq!(tokens.resolve(&token), Some(PathBuf::from("a.png")));
        assert_eq!(tokens.resolve("clip-999"), None);
        assert_ne!(tokens.issue(PathBuf::from("b.png")), token);
    }
}
