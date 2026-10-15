//! The extra interop operations behind one command, `interop_more`. The interface names an operation and sends its
//! arguments as JSON. One command keeps the list of Tauri commands, the permissions, and the handler list short while
//! the import and export area grows. Saving an import report, sending a copy to a folder, sharing as a file, and
//! the rest each add a match arm and a function here.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use super::jobs;
use crate::ipc::{IpcError, IpcResult};

/// Runs the operation `op` with its arguments.
#[tauri::command]
pub async fn interop_more(app: AppHandle, op: String, args: Value) -> IpcResult<Value> {
    let data = app.path().app_data_dir().unwrap_or_else(|_| std::env::temp_dir());
    tauri::async_runtime::spawn_blocking(move || dispatch(&op, args, &data))
        .await
        .map_err(|e| IpcError::invalid("op", &e.to_string()))?
}

fn dispatch(op: &str, args: Value, data: &Path) -> IpcResult<Value> {
    match op {
        "save_report" => save_report(parse(args)?),
        "send_state" => send::state(data, parse(args)?),
        "send_favorite" => send::favorite(data, parse(args)?),
        "send_record" => send::record(data, parse(args)?),
        other => Err(IpcError::invalid(
            "op",
            &format!("There is no operation called {other}."),
        )),
    }
}

/// Reads the arguments of an operation.
pub(super) fn parse<T: for<'de> Deserialize<'de>>(args: Value) -> IpcResult<T> {
    serde_json::from_value(args).map_err(|e| IpcError::invalid("args", &e.to_string()))
}

/// The first name like `Name.ext`, `Name (2).ext`, and so on that does not exist in `folder`.
pub(super) fn unique_path(folder: &Path, stem: &str, ext: &str) -> PathBuf {
    let mut path = folder.join(format!("{stem}.{ext}"));
    let mut n = 2;
    while path.exists() {
        path = folder.join(format!("{stem} ({n}).{ext}"));
        n += 1;
    }
    path
}

#[derive(Deserialize)]
struct SaveReport {
    job: String,
    folder: String,
}

/// Writes the Markdown report of a finished import into a folder the person chose.
fn save_report(args: SaveReport) -> IpcResult<Value> {
    let folder = Path::new(&args.folder);
    if !folder.is_dir() {
        return Err(IpcError::invalid("folder", "Choose a folder that exists."));
    }
    let markdown = jobs::report_for(&args.job)
        .ok_or_else(|| IpcError::invalid("job", "That import has no report to save any more."))?;
    let path = unique_path(folder, "OpenNote import report", "md");
    std::fs::write(&path, markdown)
        .map_err(|e| IpcError::invalid("folder", &format!("The report could not be saved: {e}")))?;
    Ok(json!({ "path": path.to_string_lossy() }))
}

/// The folders a person sends copies to, and the copies already sent, for "Update the copy".
mod send {
    use super::*;

    /// What is kept in `send_to.json`.
    #[derive(Default, Serialize, Deserialize)]
    struct Store {
        favorites: Vec<String>,
        copies: Vec<Copy>,
    }

    #[derive(Clone, Serialize, Deserialize)]
    pub struct Copy {
        /// The node of the interface's tree that was sent.
        node: String,
        format: String,
        path: String,
    }

    fn file(data: &Path) -> PathBuf {
        data.join("send_to.json")
    }

    fn load(data: &Path) -> Store {
        std::fs::read(file(data))
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default()
    }

    fn save(data: &Path, store: &Store) -> IpcResult<()> {
        std::fs::create_dir_all(data).map_err(|e| IpcError::invalid("folder", &e.to_string()))?;
        let bytes = serde_json::to_vec_pretty(store).map_err(|e| IpcError::invalid("store", &e.to_string()))?;
        std::fs::write(file(data), bytes).map_err(|e| IpcError::invalid("folder", &e.to_string()))
    }

    #[derive(Deserialize)]
    pub struct StateArgs {
        node: Option<String>,
    }

    /// The favorite folders that still exist, and the copies of a node whose files still exist.
    pub fn state(data: &Path, args: StateArgs) -> IpcResult<Value> {
        let store = load(data);
        let favorites: Vec<&String> = store.favorites.iter().filter(|f| Path::new(f).is_dir()).collect();
        let copies: Vec<&Copy> = store
            .copies
            .iter()
            .filter(|c| args.node.as_deref().is_none_or(|n| n == c.node) && Path::new(&c.path).is_file())
            .collect();
        Ok(json!({ "favorites": favorites, "copies": copies }))
    }

    #[derive(Deserialize)]
    pub struct FavoriteArgs {
        path: String,
        add: bool,
    }

    /// Adds a folder to the favorites or removes it.
    pub fn favorite(data: &Path, args: FavoriteArgs) -> IpcResult<Value> {
        let mut store = load(data);
        store.favorites.retain(|f| f != &args.path);
        if args.add {
            if !Path::new(&args.path).is_dir() {
                return Err(IpcError::invalid("path", "Choose a folder that exists."));
            }
            store.favorites.insert(0, args.path);
            store.favorites.truncate(12);
        }
        save(data, &store)?;
        Ok(json!({ "favorites": store.favorites }))
    }

    /// Remembers a copy that was sent, replacing an earlier record of the same file.
    pub fn record(data: &Path, copy: Copy) -> IpcResult<Value> {
        let mut store = load(data);
        store.copies.retain(|c| c.path != copy.path);
        store.copies.insert(0, copy);
        store.copies.truncate(50);
        save(data, &store)?;
        Ok(json!({}))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn favorite_folders_and_sent_copies_are_kept() {
        let dir = tempfile::tempdir().expect("a folder");
        let data = dir.path().join("data");
        let target = dir.path().join("OneDrive");
        std::fs::create_dir(&target).expect("a folder");
        let file = target.join("Notes.docx");
        std::fs::write(&file, b"x").expect("a file");
        let path = target.to_string_lossy();
        dispatch("send_favorite", json!({ "path": path, "add": true }), &data).expect("adds");
        let copy = json!({ "node": "n1", "format": "docx", "path": file.to_string_lossy() });
        dispatch("send_record", copy, &data).expect("records");
        let state = dispatch("send_state", json!({ "node": "n1" }), &data).expect("reads");
        assert_eq!(state["favorites"].as_array().map(Vec::len), Some(1));
        assert_eq!(state["copies"].as_array().map(Vec::len), Some(1));
        let other = dispatch("send_state", json!({ "node": "n2" }), &data).expect("reads");
        assert_eq!(other["copies"].as_array().map(Vec::len), Some(0));
        std::fs::remove_file(&file).expect("removes");
        let gone = dispatch("send_state", json!({ "node": "n1" }), &data).expect("reads");
        assert_eq!(gone["copies"].as_array().map(Vec::len), Some(0));
        dispatch("send_favorite", json!({ "path": path, "add": false }), &data).expect("removes");
        let none = dispatch("send_state", json!({}), &data).expect("reads");
        assert_eq!(none["favorites"].as_array().map(Vec::len), Some(0));
    }

    #[test]
    fn a_saved_report_gets_a_new_name_each_time() {
        let dir = tempfile::tempdir().expect("a folder");
        jobs::remember_report("import-1", "# Report".to_owned());
        let args = || json!({ "job": "import-1", "folder": dir.path().to_string_lossy() });
        let first = dispatch("save_report", args(), dir.path()).expect("saves");
        let second = dispatch("save_report", args(), dir.path()).expect("saves again");
        assert_ne!(first["path"], second["path"]);
        assert_eq!(
            std::fs::read_to_string(first["path"].as_str().expect("a path")).expect("reads"),
            "# Report"
        );
        assert!(dispatch(
            "save_report",
            json!({ "job": "gone", "folder": dir.path().to_string_lossy() }),
            dir.path()
        )
        .is_err());
        assert!(dispatch("nothing", json!({}), dir.path()).is_err());
    }
}
