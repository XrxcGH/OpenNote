//! A notebook's named styles, kept in its `notebook.json` (ADR 0082). `notebook_styles_get` will read them and
//! `notebook_styles_set` will write them, merged per style when two devices change one notebook.
//!
//! This stub lands first, so the command names and the permissions are in place. text:native-bridge owns the
//! module from here and fills it in.

use crate::ipc::{IpcError, IpcResult};

/// The notebook's named styles. Not built yet.
#[tauri::command]
pub fn notebook_styles_get(notebook: String) -> IpcResult<serde_json::Value> {
    let _ = notebook;
    Err(IpcError::not_implemented("Notebook styles"))
}

/// Saves the notebook's named styles. Not built yet.
#[tauri::command]
pub fn notebook_styles_set(notebook: String, styles: serde_json::Value) -> IpcResult<()> {
    let _ = (notebook, styles);
    Err(IpcError::not_implemented("Notebook styles"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn say_they_are_not_built_yet() {
        let get = notebook_styles_get("n1".into()).expect_err("a stub");
        let set = notebook_styles_set("n1".into(), serde_json::json!({})).expect_err("a stub");
        let code = crate::ipc::codes::NOT_IMPLEMENTED;
        assert_eq!((get.code.as_str(), set.code.as_str()), (code, code));
    }
}
