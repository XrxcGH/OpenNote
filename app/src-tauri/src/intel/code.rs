//! The on-device code models (ADR 0072): completion at the cursor, with cancel. Behind the `code.models` flag.
//!
//! This stub lands first, so the command names and the permissions are in place. code:L13a owns the module from
//! here and fills it in.

use crate::ipc::{IpcError, IpcResult};

/// Completes code at the cursor with a code model. Not built yet.
#[tauri::command]
pub fn code_complete(request: serde_json::Value) -> IpcResult<String> {
    let _ = request;
    Err(IpcError::not_implemented("Code completion with a code model"))
}

/// Cancels a completion. Not built yet.
#[tauri::command]
pub fn code_cancel(id: String) -> IpcResult<()> {
    let _ = id;
    Err(IpcError::not_implemented("Canceling a code completion"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn says_it_is_not_built_yet() {
        let code = crate::ipc::codes::NOT_IMPLEMENTED;
        assert_eq!(code_complete(serde_json::Value::Null).expect_err("a stub").code, code);
        assert_eq!(code_cancel("1".into()).expect_err("a stub").code, code);
    }
}
