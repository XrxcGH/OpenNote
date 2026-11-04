//! The device's fonts (ADR 0080). `fonts_list` will list the font families on this device with `fontdb`: names,
//! faces, metrics, and embedding permissions. The list never leaves the device.
//!
//! This stub lands first, so the command name, the permission, and the Cargo lines are in place.
//! text:native-bridge owns the module from here and fills it in.

use crate::ipc::{IpcError, IpcResult};

/// The font families on this device. Not built yet.
#[tauri::command]
pub fn fonts_list() -> IpcResult<Vec<serde_json::Value>> {
    Err(IpcError::not_implemented("The font list"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn says_it_is_not_built_yet() {
        assert_eq!(
            fonts_list().expect_err("a stub").code,
            crate::ipc::codes::NOT_IMPLEMENTED
        );
    }
}
