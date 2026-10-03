//! The extra interop operations behind one command, `interop_more`. The interface names an operation and sends its
//! arguments as JSON. One command keeps the list of Tauri commands, the permissions, and the handler list short while
//! the import and export area grows: saving an import report, sending a copy to a folder, sharing as a file, and
//! the rest each add a match arm and a function here.

use std::path::{Path, PathBuf};

use serde::Deserialize;
use serde_json::{json, Value};

use super::jobs;
use crate::ipc::{IpcError, IpcResult};

/// Runs the operation `op` with its arguments.
#[tauri::command]
pub async fn interop_more(op: String, args: Value) -> IpcResult<Value> {
    tauri::async_runtime::spawn_blocking(move || dispatch(&op, args))
        .await
        .map_err(|e| IpcError::invalid("op", &e.to_string()))?
}

fn dispatch(op: &str, args: Value) -> IpcResult<Value> {
    match op {
        "save_report" => save_report(parse(args)?),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_saved_report_gets_a_new_name_each_time() {
        let dir = tempfile::tempdir().expect("a folder");
        jobs::remember_report("import-1", "# Report".to_owned());
        let args = || json!({ "job": "import-1", "folder": dir.path().to_string_lossy() });
        let first = dispatch("save_report", args()).expect("saves");
        let second = dispatch("save_report", args()).expect("saves again");
        assert_ne!(first["path"], second["path"]);
        assert_eq!(
            std::fs::read_to_string(first["path"].as_str().expect("a path")).expect("reads"),
            "# Report"
        );
        assert!(dispatch(
            "save_report",
            json!({ "job": "gone", "folder": dir.path().to_string_lossy() })
        )
        .is_err());
        assert!(dispatch("nothing", json!({})).is_err());
    }
}
