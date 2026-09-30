//! Where the app lives, and where notes go (ARCHITECTURE.md sections 17.5 and 17.7): the install status, the
//! folder picker, folder checks, and moving the exe to `%LOCALAPPDATA%\Programs\OpenNote` with a Start menu
//! shortcut. Everything stays in the person's profile, with no administrator rights.
//!
//! The status here reports only what's cheap to know. The shell work package adds the real checks, the
//! `IFileOpenDialog` picker, and the move with its hash check and relaunch.

use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::ipc::{IpcError, IpcResult};

/// Where the running exe is and what the app may do there, matching the interface's `InstallStatus`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallStatus {
    pub exe_path: String,
    /// The exe is in `%LOCALAPPDATA%\Programs\OpenNote\`.
    pub in_user_programs: bool,
    /// The exe's folder is writable, so the app can update itself there.
    pub folder_writable: bool,
    pub has_start_menu_shortcut: bool,
    pub is_dev_build: bool,
}

/// What a proposed notes folder holds, matching the interface's `FolderCheck`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum FolderCheck {
    Ok,
    WillCreate,
    HasLibrary { notebook_count: u32 },
    NotWritable,
    InsideAppFolder,
    NotAbsolute,
}

#[tauri::command]
pub fn install_status() -> IpcResult<InstallStatus> {
    Ok(InstallStatus {
        exe_path: std::env::current_exe()?.display().to_string(),
        in_user_programs: false,
        folder_writable: false,
        has_start_menu_shortcut: false,
        is_dev_build: cfg!(debug_assertions),
    })
}

/// Opens the Windows folder picker. Returns `None` when the person cancels.
#[tauri::command]
pub fn install_pick_folder(initial: Option<String>) -> IpcResult<Option<String>> {
    let _ = initial;
    Err(IpcError::not_implemented("install_pick_folder"))
}

#[tauri::command]
pub fn install_check_folder(path: String) -> IpcResult<FolderCheck> {
    if !Path::new(&path).is_absolute() {
        return Ok(FolderCheck::NotAbsolute);
    }
    Err(IpcError::not_implemented("install_check_folder"))
}

/// Copies the exe to the user's Programs folder, adds the Start menu shortcut, and relaunches from there.
#[tauri::command]
pub fn install_move_to_user_programs() -> IpcResult<()> {
    Err(IpcError::not_implemented("install_move_to_user_programs"))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn serializes_folder_checks_by_kind() {
        let check = FolderCheck::HasLibrary { notebook_count: 3 };
        assert_eq!(
            serde_json::to_value(check).expect("serializes"),
            json!({ "kind": "hasLibrary", "notebookCount": 3 })
        );
        assert_eq!(
            serde_json::to_value(FolderCheck::WillCreate).expect("serializes"),
            json!({ "kind": "willCreate" })
        );
    }

    #[test]
    fn a_relative_folder_is_never_accepted() {
        assert_eq!(install_check_folder("notes".into()), Ok(FolderCheck::NotAbsolute));
    }
}
