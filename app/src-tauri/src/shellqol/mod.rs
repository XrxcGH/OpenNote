//! Shell extras for the quality-of-life features: pins, archive, duplicate, Copy to, docking, the mini window,
//! power status, backups on a schedule, edits from other programs, opening a notebook from any folder, the check,
//! quick capture, and Windows shortcuts. One command, `shellqol_call`, carries each by name with JSON arguments,
//! so the command list and the capability file stay short (like `search_call`). Events go out on one channel,
//! `shellqol://event`, as `{ "kind": ..., ... }`.

pub mod backup;
pub mod cloud;
pub mod conflicts;
pub mod dock;
pub mod external;
pub mod library;
pub mod notes_ops;
pub mod power;
pub mod prefs;
pub mod quick;
pub mod shortcuts;
pub mod windows_ops;

pub use shortcuts::QUICK_NOTE_ARG;

use serde::{de::DeserializeOwned, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};

use crate::{
    core_bridge::CoreBridge,
    ipc::{IpcError, IpcResult},
};

/// The channel every event of this module goes out on.
pub const EVENT: &str = "shellqol://event";

/// Sends one event to every window.
pub fn emit(app: &AppHandle, kind: &str, mut body: Value) {
    if let Value::Object(map) = &mut body {
        map.insert("kind".to_owned(), Value::String(kind.to_owned()));
    }
    if let Err(error) = app.emit(EVENT, body) {
        ::log::debug!("Couldn't send the {kind} event: {error}");
    }
}

/// A required argument.
pub(crate) fn arg<T: DeserializeOwned>(args: &Value, name: &str) -> IpcResult<T> {
    serde_json::from_value(args.get(name).cloned().unwrap_or(Value::Null))
        .map_err(|error| IpcError::invalid(name, &error.to_string()))
}

/// An argument that may be missing.
pub(crate) fn opt<T: DeserializeOwned>(args: &Value, name: &str) -> IpcResult<Option<T>> {
    match args.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(value) => serde_json::from_value(value.clone())
            .map(Some)
            .map_err(|error| IpcError::invalid(name, &error.to_string())),
    }
}

pub(crate) fn out<T: Serialize>(value: T) -> IpcResult<Value> {
    serde_json::to_value(value).map_err(|error| IpcError::new("io", error.to_string()))
}

/// Starts what runs on its own: the backup schedule, the folder watcher, the power watcher, and the quick capture
/// shortcut, each only when the person has turned it on.
pub fn start(app: &AppHandle) {
    // The jump list's "New quick note" starts the program with this argument.
    if std::env::args().any(|arg| arg == QUICK_NOTE_ARG) {
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1500));
            let _ = windows_ops::open_capture(&app);
        });
    }
    backup::start(app);
    external::start(app);
    quick::start(app);
    power::start(app);
}

/// Runs one named call.
#[tauri::command]
pub async fn shellqol_call(
    app: AppHandle,
    bridge: State<'_, CoreBridge>,
    name: String,
    args: Value,
) -> IpcResult<Value> {
    // Rebuilding the search index is the search lane's call, so this runs it as the interface would.
    if name == "library.rebuildIndex" {
        return crate::core_bridge::search::search_call(app, bridge, "rebuild".to_owned(), json!({})).await;
    }
    let (group, _) = name.split_once('.').unwrap_or((name.as_str(), ""));
    match group {
        "notes" => notes_ops::call(&app, &bridge, &name, &args),
        "window" => windows_ops::call(&app, &name, &args),
        "dock" => dock::call(&app, &name, &args),
        "power" => power::call(&app, &name),
        "cloud" => cloud::call(&app, &name, &args),
        "conflict" => conflicts::call(&app, &name, &args),
        "backup" => backup::call(&app, &bridge, &name, &args),
        "library" => library::call(&app, &bridge, &name, &args),
        "quick" => quick::call(&app, &bridge, &name, &args),
        "shortcut" => shortcuts::call(&app, &bridge, &name, &args),
        "external" => external::call(&app, &name, &args),
        "prefs" => prefs::call(&app, &name, &args),
        _ => Err(IpcError::invalid("name", &format!("{name} isn't a shell call"))),
    }
}

/// A small `{ ok: true }` answer.
pub(crate) fn ok() -> IpcResult<Value> {
    Ok(json!({ "ok": true }))
}
