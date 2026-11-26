//! Running code with the person's installed toolchains (tier 2, ADR 0071): detection, consent, the working
//! folder, and the sandboxed run step. Behind the `code.tier2` flag.
//!
//! This stub lands first, so the command names and the permissions are in place. code:L16 owns the module from
//! here and fills it in.

use crate::ipc::{IpcError, IpcResult};

/// The toolchains found on this device, with their versions. Not built yet.
#[tauri::command]
pub fn coderun_detect() -> IpcResult<Vec<serde_json::Value>> {
    Err(IpcError::not_implemented("Toolchain detection"))
}

/// Starts a run of a project with an installed toolchain. Not built yet.
#[tauri::command]
pub fn coderun_start(request: serde_json::Value) -> IpcResult<String> {
    let _ = request;
    Err(IpcError::not_implemented("Running code with installed toolchains"))
}

/// Stops a run. Not built yet.
#[tauri::command]
pub fn coderun_cancel(run: String) -> IpcResult<()> {
    let _ = run;
    Err(IpcError::not_implemented("Stopping a run"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn says_it_is_not_built_yet() {
        let code = crate::ipc::codes::NOT_IMPLEMENTED;
        assert_eq!(coderun_detect().expect_err("a stub").code, code);
        assert_eq!(coderun_start(serde_json::Value::Null).expect_err("a stub").code, code);
        assert_eq!(coderun_cancel("run-1".into()).expect_err("a stub").code, code);
    }
}
