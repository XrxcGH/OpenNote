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

/// Types a note opens in their own app: documents, pictures, audio, video, and ZIP folders, whose apps show them
/// rather than run them. Every other type is shown selected in its folder instead, where the person decides what to
/// do with it, and [`BLOCKED`] types are not even shown. A list of what may open, rather than of what may not, means
/// a type nobody thought of (Windows has hundreds that run something) is never opened by a click in a note.
#[rustfmt::skip]
const OPENS: &[&str] = &[
    // Documents.
    "pdf", "txt", "text", "md", "markdown", "csv", "tsv", "log", "rtf", "doc", "docx", "dotx", "xls", "xlsx", "xltx",
    "ppt", "pptx", "potx", "ppsx", "odt", "ods", "odp", "odg",
    // Pictures.
    "png", "jpg", "jpeg", "jfif", "gif", "bmp", "webp", "tif", "tiff", "heic", "heif", "avif",
    // Audio.
    "mp3", "wav", "m4a", "aac", "flac", "ogg", "oga", "opus", "wma", "mid", "midi",
    // Video.
    "mp4", "m4v", "mov", "avi", "wmv", "mkv", "webm", "mpg", "mpeg", "3gp",
    // A ZIP file opens as a folder.
    "zip",
];

/// Types that run code, change Windows, or reach out to the network as soon as Windows opens them or Explorer
/// shows them. They can be attached and kept, but a note neither opens them nor shows them in a folder.
#[rustfmt::skip]
const BLOCKED: &[&str] = &[
    // Programs and installers.
    "exe", "com", "scr", "pif", "msi", "msp", "mst", "msu", "msix", "msixbundle", "appx", "appxbundle",
    "appinstaller", "application", "appref-ms", "xbap", "vsto", "gadget", "jar", "jnlp", "dll", "ocx", "cpl", "sys",
    "drv",
    // Scripts.
    "bat", "cmd", "ps1", "ps1xml", "ps2", "ps2xml", "psc1", "psc2", "psd1", "psm1", "msh", "msh1", "msh2",
    "mshxml", "msh1xml", "msh2xml", "vb", "vbs", "vbe", "js", "jse", "ws", "wsf", "wsh", "wsc", "sct", "hta", "py",
    "pyw", "pyc", "pyo", "pyz", "pl", "rb", "shs", "shb",
    // Shortcuts and shell files that run or fetch what they point at.
    "lnk", "url", "website", "scf", "library-ms", "search-ms", "searchconnector-ms", "settingcontent-ms", "inf",
    "reg", "job", "rdp", "ica",
    // Help, consoles, and troubleshooters that run script.
    "chm", "hlp", "msc", "diagcab", "diagcfg", "diagpkg",
    // Disk images, which mount as drives.
    "iso", "img", "vhd", "vhdx",
    // Office add-ins and databases that run code.
    "xll", "xla", "xlam", "ppa", "ppam", "mda", "mde", "accde", "ade", "adp",
    // Themes, which fetch files from where they point.
    "theme", "themepack", "deskthemepack",
];

/// How a note opens an attached file. See [`OPENS`] and [`BLOCKED`].
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Opening {
    /// In its own app.
    App,
    /// Shown selected in its folder.
    Folder,
    /// Not at all.
    Blocked,
}

/// Where the attachment was shown, for the interface's message.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Shown {
    App,
    Folder,
}

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

/// How a note opens a file of this name. Only the last extension counts, as it does for Windows.
pub fn opening(name: &str) -> Opening {
    let Some((_, extension)) = name.rsplit_once('.') else {
        return Opening::Folder;
    };
    let extension = extension.to_ascii_lowercase();
    if BLOCKED.contains(&extension.as_str()) {
        Opening::Blocked
    } else if OPENS.contains(&extension.as_str()) {
        Opening::App
    } else {
        Opening::Folder
    }
}

/// Marks a copy as coming from the internet (zone 3), as a browser marks a download. Office then opens it in
/// Protected View, and Windows asks before it runs anything in it. A drive without alternate streams, such as a
/// FAT32 stick, can't hold the mark; the copy opens anyway.
fn mark_from_internet(path: &Path) {
    let mut stream = path.as_os_str().to_owned();
    stream.push(":Zone.Identifier");
    if let Err(error) = std::fs::write(PathBuf::from(stream), "[ZoneTransfer]\r\nZoneId=3\r\n") {
        ::log::warn!("Couldn't mark an attachment's copy as coming from the internet: {error}");
    }
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

/// Opens the attached file in its own app, or shows it in its folder when it is not a type a note opens (see
/// [`OPENS`]), and starts watching the copy.
#[tauri::command]
pub async fn attachment_open(app: AppHandle, page: String, asset: String, name: String) -> IpcResult<Shown> {
    let name = safe_name(&name);
    let opening = opening(&name);
    if opening == Opening::Blocked {
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
        mark_from_internet(&path);
        if opening == Opening::App {
            open_default(&path).map(|()| Shown::App)
        } else {
            crate::interop::commands::reveal(&path).map(|()| Shown::Folder)
        }
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
    fn only_documents_and_media_open_in_their_app() {
        for name in [
            "notes.docx",
            "sheet.XLSX",
            "slides.pptx",
            "scan.pdf",
            "photo.jpeg",
            "voice.m4a",
            "clip.mp4",
            "archive.zip",
        ] {
            assert_eq!(opening(name), Opening::App, "{name}");
        }
    }

    #[test]
    fn files_that_run_something_are_never_opened() {
        // The types the review named, which the old list of what may not open had missed, and the usual programs.
        for name in [
            "Timesheet.settingcontent-ms",
            "help.chm",
            "console.MSC",
            "fix.diagcab",
            "disk.iso",
            "disk.img",
            "disk.vhd",
            "disk.vhdx",
            "a.wsc",
            "a.sct",
            "x.library-ms",
            "x.search-ms",
            "x.website",
            "tool.pyw",
            "tool.py",
            "a.vb",
            "a.ws",
            "dark.theme",
            "dark.themepack",
            "dark.deskthemepack",
            "addin.xll",
            "x.xbap",
            "x.msh",
            "x.mshxml",
            "x.ps1xml",
            "x.psd1",
            "setup.EXE",
            "run.bat",
            "a.ps1",
            "shortcut.lnk",
            "x.JS",
            "report.pdf.lnk",
        ] {
            assert_eq!(opening(name), Opening::Blocked, "{name}");
        }
    }

    #[test]
    fn other_types_are_shown_in_their_folder() {
        // A type no list names, like one Windows adds next year, is never handed to Windows to open.
        for name in [
            "readme",
            "drawing.dwg",
            "macro.xlsm",
            "page.html",
            "logo.svg",
            "new.unheardof",
        ] {
            assert_eq!(opening(name), Opening::Folder, "{name}");
        }
    }

    #[cfg(windows)]
    #[test]
    fn a_copy_is_marked_as_coming_from_the_internet() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let path = dir.path().join("Budget.xlsx");
        std::fs::write(&path, b"cells").expect("writes");
        mark_from_internet(&path);
        let mut stream = path.as_os_str().to_owned();
        stream.push(":Zone.Identifier");
        let mark = std::fs::read_to_string(PathBuf::from(stream)).expect("the mark");
        assert!(mark.contains("ZoneId=3"), "{mark}");
        assert_eq!(std::fs::read(&path).expect("reads"), b"cells");
    }
}
