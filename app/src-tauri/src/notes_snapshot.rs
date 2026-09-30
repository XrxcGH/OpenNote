//! Phase 2 only: the in-memory notes service's snapshot, `%LOCALAPPDATA%\OpenNote\phase2-notes.json`, behind the
//! `notes.memorySnapshot` flag, so development and nightly builds keep their notes between starts. Rust writes it
//! atomically and caps it at 5 MB. Phase 3's storage replaces it. The shell work package adds the reads and
//! writes.

use crate::ipc::{IpcError, IpcResult};

/// The largest snapshot Rust accepts.
pub const MAX_SNAPSHOT_BYTES: usize = 5 * 1024 * 1024;

/// The saved snapshot, or `None` when there isn't one.
#[tauri::command]
pub fn notes_snapshot_load() -> IpcResult<Option<String>> {
    Ok(None)
}

#[tauri::command]
pub fn notes_snapshot_save(json: String) -> IpcResult<()> {
    if json.len() > MAX_SNAPSHOT_BYTES {
        return Err(IpcError::invalid("json", "The notes snapshot is larger than 5 MB."));
    }
    Err(IpcError::not_implemented("notes_snapshot_save"))
}
