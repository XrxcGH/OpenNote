//! Storage calls of beta 5: Delete folder for a notebook in Trash, and the calls the later storage features add.
//! Each argument is checked here before it reaches the core.

use serde_json::{json, Value};
use tauri::AppHandle;

use super::arg;
use crate::{
    core_bridge::{run_notes, CoreBridge},
    ipc::{IpcError, IpcResult},
};

/// The longest node ID the calls take. Node IDs are 26 characters.
const MAX_ID: usize = 64;

/// A node ID argument: short and plain, as the core's IDs are.
pub(crate) fn node_id(args: &Value, name: &str) -> IpcResult<String> {
    let id: String = arg(args, name)?;
    let plain = id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    if id.is_empty() || id.len() > MAX_ID || !plain {
        return Err(IpcError::invalid(name, "isn't an ID"));
    }
    Ok(id)
}

pub fn call(app: &AppHandle, bridge: &CoreBridge, name: &str, args: &Value) -> IpcResult<Value> {
    match name {
        "trash.deleteFolder" => {
            let id = node_id(args, "id")?;
            let pages = run_notes(app, bridge, |b| b.delete_notebook_folder(&id))?;
            bridge.forget_pages(&pages);
            Ok(json!({ "ok": true, "pages": pages.len() }))
        }
        "storage.moveNotes" | "storage.cancelMove" => super::notes_move::call(app, bridge, name, args),
        "check.repair" | "check.undo" => super::repairs::call(app, bridge, name, args),
        // Lock entry (A2-17): the name this PC has in OpenNote, for the stamp. The core stamps time and hash.
        "lock.device" => run_notes(app, bridge, |b| Ok(json!({ "label": b.core.device().label }))),
        _ if name.starts_with("edits.")
            || name == "source.openExternal"
            || name == "storage.cloudOnly"
            || name == "storage.download" =>
        {
            super::edits::call(app, name, args)
        }
        _ => Err(IpcError::invalid("name", &format!("{name} isn't a storage call"))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn node_ids_are_checked() {
        assert_eq!(
            node_id(&json!({ "id": "01m3sa12426sg32pmtyffjaqcf" }), "id")
                .ok()
                .as_deref(),
            Some("01m3sa12426sg32pmtyffjaqcf")
        );
        for bad in [
            json!({ "id": "" }),
            json!({ "id": "..\\x" }),
            json!({ "id": 3 }),
            json!({}),
            json!({ "id": "a".repeat(65) }),
        ] {
            assert!(node_id(&bad, "id").is_err(), "{bad}");
        }
    }
}
