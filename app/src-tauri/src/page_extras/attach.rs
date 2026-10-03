//! Attached files that save back. A file attached to a page is an asset of that page. Opening it writes a copy to a
//! temporary folder, hands the copy to Windows to open in its own app, and watches the copy. Each time the app
//! has saved a change (the file stops changing for one check), the core imports the new bytes as a new asset and
//! the interface is told, so it can point the attachment at the new asset in one undo step. The WebView names a
//! page and an asset, never a path.

use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, SystemTime},
};

use opennote_core::{
    store::assets::{mime_for_name, AssetSource},
    AssetId,
};
use serde::{Deserialize, Serialize};
use tauri::{ipc::InvokeBody, AppHandle, Emitter};

use crate::{
    images::{
        import::{asset_json, on_blocking, open_page, percent_decode},
        ImportedAsset,
    },
    ipc::{codes, IpcError, IpcResult},
};

/// Files over 200 MB are refused.
pub const MAX_ATTACHMENT_BYTES: usize = 200 * 1024 * 1024;
/// How often the copy is checked.
const POLL: Duration = Duration::from_millis(1000);
/// A watch ends after this long, so a forgotten copy does not keep a thread for days.
const WATCH_LIMIT: Duration = Duration::from_secs(12 * 60 * 60);
/// The event the interface hears when a change is saved back.
pub const SAVED_EVENT: &str = "attachment://saved";

/// Types that run code when opened. They can be attached and kept, but not opened from a note.
const BLOCKED: &[&str] = &[
    "exe", "com", "scr", "pif", "bat", "cmd", "msi", "msp", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh",
    "hta", "lnk", "url", "reg", "dll", "cpl", "jar", "appx", "msix", "gadget", "inf", "scf", "application",
];

#[derive(Debug, Deserialize)]
struct ImportHeader {
    page: String,
    name: String,
    #[serde(default)]
    mime: String,
}

#[derive(Debug, Clone, Serialize)]
struct Saved {
    page: String,
    previous: String,
    asset: ImportedAsset,
}

/// A name that is safe as a file name in the temporary folder: no folders, no reserved characters.
pub fn safe_name(name: &str) -> String {
    let last = name.rsplit(['/', '\\']).next().unwrap_or("");
    let cleaned: String = last
        .chars()
        .filter(|c| !c.is_control() && !"<>:\"|?*".contains(*c))
        .collect();
    let trimmed = cleaned.trim().trim_end_matches('.').trim();
    if trimmed.is_empty() {
        "attachment".to_owned()
    } else {
        trimmed.chars().take(120).collect()
    }
}

/// Whether Windows would run this file rather than show it.
pub fn is_blocked(name: &str) -> bool {
    name.rsplit_once('.')
        .is_some_and(|(_, extension)| BLOCKED.contains(&extension.to_ascii_lowercase().as_str()))
}

fn io_error(error: impl std::fmt::Display) -> IpcError {
    IpcError::new(codes::IO, error.to_string())
}

/// A raw body with the header `x-opennote-attachment: {"page","name","mime"}`.
#[tauri::command]
pub async fn attachment_import(app: AppHandle, request: tauri::ipc::Request<'_>) -> IpcResult<ImportedAsset> {
    let header = request
        .headers()
        .get("x-opennote-attachment")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| IpcError::invalid("x-opennote-attachment", "The file header is missing."))?;
    let header: ImportHeader = serde_json::from_str(header)
        .map_err(|_| IpcError::invalid("x-opennote-attachment", "The file header isn't valid JSON."))?;
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        InvokeBody::Json(_) => return Err(IpcError::invalid("body", "The file must come as raw bytes.")),
    };
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(IpcError::new("tooLarge", "Files over 200 MB can't be attached."));
    }
    on_blocking(move || {
        let handle = open_page(&app, &header.page)?;
        let name = safe_name(&percent_decode(&header.name));
        // The name decides the type, so a file called leaf.png is checked as a picture by the core.
        let mime = match header.mime.trim() {
            "" | "application/octet-stream" => mime_for_name(&name).to_owned(),
            declared => declared.to_owned(),
        };
        let asset = handle
            .import_asset(AssetSource::bytes(name, mime, bytes))
            .map_err(io_error)?;
        Ok(ImportedAsset {
            id: asset.id.to_string(),
            asset: asset_json(&asset),
        })
    })
    .await
}

struct Watch {
    page: String,
    stop: Arc<AtomicBool>,
    path: PathBuf,
}

static WATCHES: Mutex<Vec<Watch>> = Mutex::new(Vec::new());

fn temp_folder(asset: &str) -> PathBuf {
    std::env::temp_dir().join("OpenNote").join("attachments").join(asset)
}

/// Opens the attached file in its own app and starts watching the copy.
#[tauri::command]
pub async fn attachment_open(app: AppHandle, page: String, asset: String, name: String) -> IpcResult<()> {
    let name = safe_name(&name);
    if is_blocked(&name) {
        return Err(IpcError::new(
            "blockedType",
            "Windows would run this file instead of opening it, so a note won't open it.",
        ));
    }
    on_blocking(move || {
        let handle = open_page(&app, &page)?;
        let id = AssetId::parse(&asset).map_err(|_| IpcError::invalid("asset", "The attachment's ID isn't valid."))?;
        let folder = temp_folder(&asset);
        let path = folder.join(&name);
        let watching = WATCHES
            .lock()
            .map(|watches| watches.iter().any(|watch| watch.path == path))
            .unwrap_or(false);
        if !(watching && path.exists()) {
            let bytes = handle.asset_bytes(id, None).map_err(io_error)?.bytes;
            std::fs::create_dir_all(&folder).map_err(io_error)?;
            std::fs::write(&path, bytes).map_err(io_error)?;
        }
        if !watching {
            start_watch(app, page, asset, path.clone());
        }
        open_default(&path)
    })
    .await
}

/// Stops watching a page's attachments and removes the copies, when the page closes.
#[tauri::command]
pub async fn attachment_stop(page: String) -> IpcResult<()> {
    let mut watches = WATCHES.lock().map_err(io_error)?;
    watches.retain(|watch| {
        if watch.page != page {
            return true;
        }
        watch.stop.store(true, Ordering::Relaxed);
        false
    });
    Ok(())
}

type Stamp = (u64, Option<SystemTime>);

fn stamp(path: &Path) -> Option<Stamp> {
    let meta = std::fs::metadata(path).ok()?;
    Some((meta.len(), meta.modified().ok()))
}

fn start_watch(app: AppHandle, page: String, asset: String, path: PathBuf) {
    let stop = Arc::new(AtomicBool::new(false));
    if let Ok(mut watches) = WATCHES.lock() {
        watches.push(Watch {
            page: page.clone(),
            stop: stop.clone(),
            path: path.clone(),
        });
    }
    thread::spawn(move || {
        let started = std::time::Instant::now();
        let mut current = asset;
        let mut seen = stamp(&path);
        let mut pending: Option<Stamp> = None;
        while !stop.load(Ordering::Relaxed) && started.elapsed() < WATCH_LIMIT {
            thread::sleep(POLL);
            let Some(now) = stamp(&path) else { continue };
            if Some(now) == seen {
                pending = None;
                continue;
            }
            // A change counts once the file has stayed the same for a whole check, so a half-written file isn't taken.
            if pending != Some(now) {
                pending = Some(now);
                continue;
            }
            let Ok(handle) = open_page(&app, &page) else { break };
            match handle.import_asset(AssetSource::path(&path)) {
                Ok(imported) => {
                    seen = Some(now);
                    pending = None;
                    let saved = Saved {
                        page: page.clone(),
                        previous: current.clone(),
                        asset: ImportedAsset {
                            id: imported.id.to_string(),
                            asset: asset_json(&imported),
                        },
                    };
                    current = saved.asset.id.clone();
                    let _ = app.emit(SAVED_EVENT, saved);
                }
                // The app may still hold the file; the next check tries again.
                Err(_) => pending = None,
            }
        }
        if let Ok(mut watches) = WATCHES.lock() {
            watches.retain(|watch| !Arc::ptr_eq(&watch.stop, &stop));
        }
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_dir(temp_folder(&current));
    });
}

#[cfg(windows)]
fn open_default(file: &Path) -> IpcResult<()> {
    use windows::{
        core::{w, HSTRING},
        Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
    };

    // SAFETY: both strings outlive the call, and ShellExecuteW takes no other pointers.
    let result = unsafe {
        ShellExecuteW(
            None,
            w!("open"),
            &HSTRING::from(file.as_os_str()),
            None,
            None,
            SW_SHOWNORMAL,
        )
    };
    // ShellExecute reports success with a value above 32.
    if (result.0 as isize) > 32 {
        Ok(())
    } else {
        Err(IpcError::new(
            "noApp",
            "Windows has no app set up to open this kind of file.",
        ))
    }
}

#[cfg(not(windows))]
fn open_default(_file: &Path) -> IpcResult<()> {
    Err(IpcError::not_implemented("attachment_open"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_lose_folders_and_reserved_characters() {
        assert_eq!(safe_name("..\\..\\Budget: 2026?.xlsx"), "Budget 2026.xlsx");
        assert_eq!(safe_name("a/b/report.pdf"), "report.pdf");
        assert_eq!(safe_name("  ...  "), "attachment");
        assert_eq!(safe_name(&"x".repeat(300)).chars().count(), 120);
    }

    #[test]
    fn programs_are_never_opened() {
        for name in ["setup.EXE", "run.bat", "a.ps1", "shortcut.lnk", "x.JS"] {
            assert!(is_blocked(name), "{name}");
        }
        for name in ["notes.docx", "sheet.xlsx", "slides.pptx", "scan.pdf", "readme", "archive.zip"] {
            assert!(!is_blocked(name), "{name}");
        }
    }
}
