//! Phase 2 only: the in-memory notes service's snapshot, `%LOCALAPPDATA%\OpenNote\phase2-notes.json`, behind the
//! `notes.memorySnapshot` flag, so development and nightly builds keep their notes between starts. Rust writes it
//! atomically and caps it at 5 MB. Phase 3's storage replaces it.

use std::{fs, io, path::Path};

use tauri::State;

use crate::{
    ipc::{IpcError, IpcResult},
    paths::Paths,
    settings::file::write_atomic,
};

/// The largest snapshot Rust accepts.
pub const MAX_SNAPSHOT_BYTES: usize = 5 * 1024 * 1024;

/// Reads the snapshot, or `None` when there isn't one.
pub fn load(path: &Path) -> io::Result<Option<String>> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(Some(text)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

/// Writes the snapshot atomically, after checking its size and that it is JSON.
pub fn save(path: &Path, json: &str) -> IpcResult<()> {
    if json.len() > MAX_SNAPSHOT_BYTES {
        return Err(IpcError::invalid("json", "The notes snapshot is larger than 5 MB."));
    }
    if serde_json::from_str::<serde::de::IgnoredAny>(json).is_err() {
        return Err(IpcError::invalid("json", "The notes snapshot isn't valid JSON."));
    }
    if let Some(folder) = path.parent() {
        fs::create_dir_all(folder)?;
    }
    Ok(write_atomic(path, json.as_bytes())?)
}

/// The saved snapshot, or `None` when there isn't one.
#[tauri::command]
pub fn notes_snapshot_load(paths: State<'_, Paths>) -> IpcResult<Option<String>> {
    Ok(load(&paths.snapshot_file)?)
}

#[tauri::command]
pub fn notes_snapshot_save(paths: State<'_, Paths>, json: String) -> IpcResult<()> {
    save(&paths.snapshot_file, &json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_snapshot_is_none_and_a_saved_one_comes_back() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let path = dir.path().join("local").join("phase2-notes.json");
        assert_eq!(load(&path).expect("reads"), None);
        save(&path, r#"{"notebooks":[]}"#).expect("saves");
        assert_eq!(load(&path).expect("reads").as_deref(), Some(r#"{"notebooks":[]}"#));
        save(&path, r#"{"notebooks":[1]}"#).expect("replaces");
        assert_eq!(load(&path).expect("reads").as_deref(), Some(r#"{"notebooks":[1]}"#));
    }

    #[test]
    fn refuses_more_than_five_megabytes_and_anything_but_json() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let path = dir.path().join("notes.json");
        let big = format!("\"{}\"", "a".repeat(MAX_SNAPSHOT_BYTES));
        assert_eq!(save(&path, &big).expect_err("too big").code, "invalid");
        assert_eq!(save(&path, "{not json").expect_err("not JSON").code, "invalid");
        assert!(!path.exists(), "a refused snapshot leaves nothing behind");
    }
}
