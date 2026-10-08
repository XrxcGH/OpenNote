//! The quality-of-life features' own choices: the backup schedule, the quick capture shortcut, whether to start
//! on Home, and so on. They live in `qol.json` in the roaming folder, so they follow the person and, in portable
//! mode, stay beside the program. Each is a top-level key; a call merges the keys it is given.

use std::{fs, path::Path, sync::Mutex};

use serde_json::{Map, Value};
use tauri::{AppHandle, Manager};

use super::{arg, ok};
use crate::{
    ipc::{IpcError, IpcResult},
    paths::Paths,
};

static LOCK: Mutex<()> = Mutex::new(());

/// The file name in the roaming folder.
pub const FILE: &str = "qol.json";

/// Reads the choices. A missing or damaged file reads as no choices.
pub fn read_from(dir: &Path) -> Map<String, Value> {
    fs::read(dir.join(FILE))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .and_then(|value| match value {
            Value::Object(map) => Some(map),
            _ => None,
        })
        .unwrap_or_default()
}

/// Merges keys into the file. A key set to null is removed.
pub fn merge_into(dir: &Path, patch: &Map<String, Value>) -> std::io::Result<Map<String, Value>> {
    let _guard = LOCK.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    let mut current = read_from(dir);
    for (key, value) in patch {
        if value.is_null() {
            current.remove(key);
        } else {
            current.insert(key.clone(), value.clone());
        }
    }
    fs::create_dir_all(dir)?;
    let target = dir.join(FILE);
    let temp = dir.join(format!("{FILE}.tmp"));
    fs::write(&temp, serde_json::to_vec_pretty(&Value::Object(current.clone()))?)?;
    fs::rename(&temp, &target)?;
    Ok(current)
}

pub fn read(app: &AppHandle) -> Map<String, Value> {
    read_from(&app.state::<Paths>().roaming)
}

pub fn write(app: &AppHandle, patch: &Map<String, Value>) -> IpcResult<Map<String, Value>> {
    merge_into(&app.state::<Paths>().roaming, patch).map_err(IpcError::from)
}

pub fn call(app: &AppHandle, name: &str, args: &Value) -> IpcResult<Value> {
    match name {
        "prefs.get" => Ok(Value::Object(read(app))),
        "prefs.set" => {
            let patch: Map<String, Value> = arg(args, "patch")?;
            let merged = write(app, &patch)?;
            if patch.contains_key("quickCapture") {
                super::quick::apply(app);
            }
            Ok(Value::Object(merged))
        }
        _ => ok(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn merges_keys_and_removes_nulls() {
        let dir = tempfile::tempdir().expect("a temp folder");
        assert!(read_from(dir.path()).is_empty());
        let first = json!({ "a": 1, "b": { "x": true } });
        merge_into(dir.path(), first.as_object().expect("an object")).expect("writes");
        let second = json!({ "a": null, "c": "z" });
        let merged = merge_into(dir.path(), second.as_object().expect("an object")).expect("writes");
        assert_eq!(Value::Object(merged), json!({ "b": { "x": true }, "c": "z" }));
        assert_eq!(read_from(dir.path()).len(), 2);
    }

    #[test]
    fn a_damaged_file_reads_as_empty() {
        let dir = tempfile::tempdir().expect("a temp folder");
        fs::write(dir.path().join(FILE), b"{not json").expect("writes");
        assert!(read_from(dir.path()).is_empty());
    }
}
