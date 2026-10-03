//! Notes folders inside OneDrive, Dropbox, iCloud Drive, or Google Drive. Setup and Settings explain what that
//! means and offer "Always keep on this device", which for OneDrive pins the folder's files so Windows never
//! turns them into cloud-only placeholders. The check reads the folder's path, so it never touches the network.

use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::AppHandle;

use super::{arg, out};
use crate::ipc::{IpcError, IpcResult};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudInfo {
    /// `oneDrive`, `dropbox`, `iCloud`, or `googleDrive`.
    pub service: &'static str,
    /// The name to show.
    pub name: &'static str,
    /// Whether Windows can pin the folder from here, which only OneDrive allows.
    pub can_pin: bool,
}

const ONE_DRIVE: CloudInfo = CloudInfo {
    service: "oneDrive",
    name: "OneDrive",
    can_pin: true,
};
const DROPBOX: CloudInfo = CloudInfo {
    service: "dropbox",
    name: "Dropbox",
    can_pin: false,
};
const ICLOUD: CloudInfo = CloudInfo {
    service: "iCloud",
    name: "iCloud Drive",
    can_pin: false,
};
const GOOGLE_DRIVE: CloudInfo = CloudInfo {
    service: "googleDrive",
    name: "Google Drive",
    can_pin: false,
};

/// The service a folder name belongs to: `OneDrive` and `OneDrive - Contoso`, `Dropbox` and `Dropbox (Personal)`,
/// `iCloudDrive`, and `Google Drive` or `My Drive`.
fn service_of(name: &str) -> Option<CloudInfo> {
    let lower = name.to_lowercase();
    if lower.starts_with("onedrive") {
        Some(ONE_DRIVE)
    } else if lower.starts_with("dropbox") {
        Some(DROPBOX)
    } else if lower == "icloud drive" || lower == "iclouddrive" {
        Some(ICLOUD)
    } else if lower == "google drive" || lower == "googledrive" || lower == "my drive" {
        Some(GOOGLE_DRIVE)
    } else {
        None
    }
}

/// The sync service that holds `path`, if one does. `roots` are the sync folders Windows reports (OneDrive's
/// environment variables), which catch a renamed folder.
pub fn detect_in(path: &Path, roots: &[PathBuf]) -> Option<CloudInfo> {
    let lower = path.to_string_lossy().to_lowercase();
    if roots
        .iter()
        .any(|root| !root.as_os_str().is_empty() && lower.starts_with(&root.to_string_lossy().to_lowercase()))
    {
        return Some(ONE_DRIVE);
    }
    path.components().find_map(|component| match component {
        Component::Normal(part) => part.to_str().and_then(service_of),
        _ => None,
    })
}

/// [`detect_in`] with the OneDrive folders of this PC.
pub fn detect(path: &Path) -> Option<CloudInfo> {
    let roots: Vec<PathBuf> = ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]
        .iter()
        .filter_map(|name| std::env::var_os(name).map(PathBuf::from))
        .collect();
    detect_in(path, &roots)
}

/// Pins a folder's files and folders on this device (the "Always keep on this device" attribute).
#[cfg(windows)]
fn pin(path: &Path) -> Result<(), String> {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let run = |target: String, extra: &[&str]| -> Result<(), String> {
        let status = std::process::Command::new("attrib")
            .args(["+P", "-U"])
            .arg(target)
            .args(extra)
            .creation_flags(CREATE_NO_WINDOW)
            .status()
            .map_err(|error| error.to_string())?;
        status.success().then_some(()).ok_or_else(|| "attrib didn't finish".to_owned())
    };
    let folder = path.to_string_lossy().trim_end_matches('\\').to_owned();
    run(folder.clone(), &[])?;
    run(format!("{folder}\\*"), &["/S", "/D"])
}

#[cfg(not(windows))]
fn pin(_path: &Path) -> Result<(), String> {
    Err("Pinning needs Windows.".to_owned())
}

pub fn call(_app: &AppHandle, name: &str, args: &Value) -> IpcResult<Value> {
    match name {
        "cloud.detect" => {
            let path: String = arg(args, "path")?;
            out(detect(Path::new(&path)))
        }
        "cloud.keepOnDevice" => {
            let path: String = arg(args, "path")?;
            let found = detect(Path::new(&path)).filter(|info| info.can_pin);
            if found.is_none() {
                return Ok(json!({ "ok": false, "reason": "manual" }));
            }
            match pin(Path::new(&path)) {
                Ok(()) => Ok(json!({ "ok": true })),
                Err(message) => Err(IpcError::new("io", message)),
            }
        }
        _ => Err(IpcError::invalid("name", "isn't a cloud call")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn name_of(path: &str) -> Option<&'static str> {
        detect_in(Path::new(path), &[]).map(|info| info.service)
    }

    #[test]
    fn finds_each_service_by_its_folder_name() {
        assert_eq!(name_of(r"C:\Users\ada\OneDrive\Notes"), Some("oneDrive"));
        assert_eq!(name_of(r"C:\Users\ada\OneDrive - Contoso\Notes"), Some("oneDrive"));
        assert_eq!(name_of(r"D:\Dropbox (Personal)\Notes"), Some("dropbox"));
        assert_eq!(name_of(r"C:\Users\ada\iCloudDrive\Notes"), Some("iCloud"));
        assert_eq!(name_of(r"G:\My Drive\Notes"), Some("googleDrive"));
        assert_eq!(name_of(r"C:\Users\ada\Documents\OpenNote"), None);
    }

    #[test]
    fn a_renamed_onedrive_folder_is_found_by_its_root() {
        let roots = [PathBuf::from(r"C:\Users\ada\Cloud")];
        let found = detect_in(Path::new(r"c:\users\ada\cloud\Notes"), &roots);
        assert_eq!(found.map(|info| info.name), Some("OneDrive"));
        assert!(detect_in(Path::new(r"C:\Users\ada\Other"), &roots).is_none());
    }

    #[test]
    fn only_onedrive_can_be_pinned_from_here() {
        assert!(ONE_DRIVE.can_pin && !DROPBOX.can_pin && !ICLOUD.can_pin && !GOOGLE_DRIVE.can_pin);
    }
}
