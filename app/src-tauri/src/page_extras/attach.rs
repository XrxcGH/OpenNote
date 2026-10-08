//! Attached files that save back. A file attached to a page is an asset of that page. Opening it writes a copy to a
//! temporary folder, hands the copy to Windows to open in its own app, and watches the copy. Each time the app
//! has saved a change (the file stops changing for one check), the core imports the new bytes as a new asset and
//! the attachment is pointed at it: by the interface in one undo step when the page is open, or by the shell
//! when it isn't, so a change saved after the person moved on still reaches the note. The WebView names a page and
//! an asset, never a path.

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
    model::JsonMap,
    ops::resolve::{Edit, TxnRequest},
    session::page::PageHandle,
    store::assets::{mime_for_name, AssetSource},
    AssetId, EditError,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{ipc::InvokeBody, AppHandle, Emitter, Manager};

use crate::{
    core_bridge::{run_notes, Bridge, CoreBridge},
    images::{
        import::{asset_json, errors, on_blocking, open_page, percent_decode},
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

/// The client the shell saves an attachment back as, when no window has the page open.
const SAVE_BACK_CLIENT: &str = "attachments";

/// A copy being watched. A watch outlives the page's view: a change saved after the person moved to another page
/// still comes back into the note. It ends when the app does, or after [`WATCH_LIMIT`].
struct Watch {
    page: String,
    /// The asset the copy matches now: the one it was made from, then each change saved back.
    asset: String,
    stop: Arc<AtomicBool>,
    path: PathBuf,
}

static WATCHES: Mutex<Vec<Watch>> = Mutex::new(Vec::new());

fn temp_root() -> PathBuf {
    std::env::temp_dir().join("OpenNote").join("attachments")
}

fn temp_folder(asset: &str) -> PathBuf {
    temp_root().join(asset)
}

/// The file in an asset's folder that names the copy it was saved back from, when that copy lives in the folder of
/// an earlier asset.
const COPY_MARK: &str = "copy-path.txt";

/// Where the copy of an asset named `name` is: the copy it was saved back from, if that is still there, so changes
/// made to it after its watch ended are found; otherwise a new one in the asset's own folder.
fn copy_path(asset: &str, name: &str) -> PathBuf {
    let marked = std::fs::read_to_string(temp_folder(asset).join(COPY_MARK))
        .ok()
        .map(|text| PathBuf::from(text.trim()))
        // Only a copy of ours, of the same name: the name decided how it may open.
        .filter(|path| {
            path.starts_with(temp_root()) && path.file_name().is_some_and(|file| file == name) && path.exists()
        });
    marked.unwrap_or_else(|| temp_folder(asset).join(name))
}

/// Notes in `asset`'s folder that its copy is the file at `path`. Returns the folder, so the watch can remove it
/// with the copy.
fn mark_copy(asset: &str, path: &Path) -> Option<PathBuf> {
    let folder = temp_folder(asset);
    if path.parent() == Some(folder.as_path()) {
        return None;
    }
    std::fs::create_dir_all(&folder).ok()?;
    std::fs::write(folder.join(COPY_MARK), path.to_string_lossy().as_bytes()).ok()?;
    Some(folder)
}

/// The watched copy of a page's asset, if it is still there: the copy a watch made of it, or one now at `path`, where
/// a copy of it goes. A copy whose change came back but whose page didn't take it yet is still the asset's copy, so
/// a second watch never starts on one file.
fn watched_copy(page: &str, asset: &str, path: &Path) -> Option<PathBuf> {
    let watches = WATCHES.lock().ok()?;
    let watch = watches
        .iter()
        .find(|watch| watch.page == page && (watch.asset == asset || watch.path == path))?;
    watch.path.exists().then(|| watch.path.clone())
}

/// Ends the watches of a page's asset or of the copy at `path`, such as one whose copy was deleted.
fn stop_watches(page: &str, asset: &str, path: &Path) {
    if let Ok(mut watches) = WATCHES.lock() {
        watches.retain(|watch| {
            let matches = watch.page == page && (watch.asset == asset || watch.path == path);
            if matches {
                watch.stop.store(true, Ordering::Relaxed);
            }
            !matches
        });
    }
}

/// What a note found where it puts an attachment's copy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Copy {
    /// Nothing: the copy was written from the asset.
    Written,
    /// A copy with the asset's bytes, or one the app holding it won't let anyone read. It is opened as it is.
    Kept,
    /// A copy with other bytes: changes saved after its watch ended, such as after the app was closed. They are
    /// saved back before the copy opens, never overwritten.
    Edited,
}

/// Makes sure `path` holds a copy of the asset whose bytes `asset` reads, without ever overwriting a copy that
/// differs from it.
fn prepare_copy(path: &Path, asset: impl FnOnce() -> IpcResult<Vec<u8>>) -> IpcResult<Copy> {
    let bytes = asset()?;
    if path.exists() {
        return Ok(match std::fs::read(path) {
            Ok(copy) if copy != bytes => Copy::Edited,
            _ => Copy::Kept,
        });
    }
    if let Some(folder) = path.parent() {
        std::fs::create_dir_all(folder).map_err(io_error)?;
    }
    std::fs::write(path, bytes).map_err(io_error)?;
    Ok(Copy::Written)
}

/// Runs `work` on the page: through a window's open session when there is one, or through a session of the
/// shell's own, opened for the work and closed after it.
fn with_page<T>(app: &AppHandle, page: &str, work: impl FnOnce(&PageHandle) -> IpcResult<T>) -> IpcResult<T> {
    if let Ok(handle) = open_page(app, page) {
        return work(&handle);
    }
    let bridge = app.state::<CoreBridge>();
    run_notes(app, &bridge, |bridge| {
        let handle = bridge.handle(page, SAVE_BACK_CLIENT)?;
        let result = work(&handle);
        let closed = bridge.close_handle(page, SAVE_BACK_CLIENT);
        let value = result?;
        closed.map(|()| value)
    })
}

/// Saves the copy's bytes back as a new asset of the page in place of `previous`, and tells the interface. When a
/// window has the page open, the interface points the attachment at the new asset, as one undo step. When none
/// has, the shell does it itself, so a change saved after the page closed still reaches the note.
fn save_back(app: &AppHandle, page: &str, previous: &str, path: &Path) -> IpcResult<ImportedAsset> {
    let asset = match open_page(app, page) {
        Ok(handle) => import_copy(&handle, path)?,
        Err(_) => {
            let bridge = app.state::<CoreBridge>();
            run_notes(app, &bridge, |bridge| save_back_closed(bridge, page, previous, path))?
        }
    };
    let saved = Saved {
        page: page.to_owned(),
        previous: previous.to_owned(),
        asset: asset.clone(),
    };
    let _ = app.emit(SAVED_EVENT, saved);
    Ok(asset)
}

fn import_copy(handle: &PageHandle, path: &Path) -> IpcResult<ImportedAsset> {
    let imported = handle.import_asset(AssetSource::path(path)).map_err(io_error)?;
    Ok(ImportedAsset {
        id: imported.id.to_string(),
        asset: asset_json(&imported),
    })
}

/// [`save_back`] for a page no window has open: imports the copy, and points the page's file blocks that showed
/// `previous` at it, in one transaction of the shell's own session. The earlier asset stays in the page, so undo
/// can bring it back.
fn save_back_closed(bridge: &mut Bridge, page: &str, previous: &str, path: &Path) -> IpcResult<ImportedAsset> {
    let previous =
        AssetId::parse(previous).map_err(|_| IpcError::invalid("asset", "The attachment's ID isn't valid."))?;
    let handle = bridge.handle(page, SAVE_BACK_CLIENT)?;
    let result = import_copy(&handle, path).and_then(|asset| {
        let blocks = handle.file_blocks_of(previous);
        if blocks.is_empty() {
            return Ok(asset);
        }
        let id = AssetId::parse(&asset.id).map_err(io_error)?;
        let mut edits = vec![Edit::AddAsset { asset: id }];
        for block in blocks {
            let mut data = JsonMap::new();
            data.insert("asset".to_owned(), Value::String(asset.id.clone()));
            edits.push(Edit::PatchBlock {
                block,
                lock: None,
                data: Some(data),
                fallback: None,
            });
        }
        apply_next(&handle, edits)?;
        Ok(asset)
    });
    let closed = bridge.close_handle(page, SAVE_BACK_CLIENT);
    let asset = result?;
    closed.map(|()| asset)
}

/// Applies edits as the next transaction of the handle's client. The shell's client may have sent some before in
/// this session of the page, so a refused number is replaced by the one the page expects.
fn apply_next(handle: &PageHandle, edits: Vec<Edit>) -> IpcResult<()> {
    let request = |client_seq| TxnRequest {
        page: handle.id(),
        client: handle.client().clone(),
        client_seq,
        coalesce: None,
        ui: None,
        edits: edits.clone(),
    };
    let edit_error = |error: EditError| IpcError::new(error.code(), error.to_string());
    match handle.apply(request(1)) {
        Ok(_) => Ok(()),
        Err(EditError::OutOfOrder { expected }) => handle.apply(request(expected)).map(|_| ()).map_err(edit_error),
        Err(error) => Err(edit_error(error)),
    }
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
        let id = AssetId::parse(&asset).map_err(|_| IpcError::invalid("asset", "The attachment's ID isn't valid."))?;
        let path = copy_path(&asset, &name);
        let path = match watched_copy(&page, &asset, &path) {
            Some(path) => path,
            None => {
                stop_watches(&page, &asset, &path);
                let read = || {
                    with_page(&app, &page, |handle| {
                        Ok(handle.asset_bytes(id, None).map_err(io_error)?.bytes)
                    })
                };
                // A copy left from an earlier watch holds changes that never came back: they come back now.
                let current = match prepare_copy(&path, read)? {
                    Copy::Edited => save_back(&app, &page, &asset, &path)?.id,
                    Copy::Written | Copy::Kept => asset,
                };
                let marks = mark_copy(&current, &path).into_iter().collect();
                start_watch(app, page, current, path.clone(), marks);
                path
            }
        };
        mark_from_internet(&path);
        if opening == Opening::App {
            open_default(&path).map(|()| Shown::App)
        } else {
            crate::interop::commands::reveal(&path).map(|()| Shown::Folder)
        }
    })
    .await
}

type Stamp = (u64, Option<SystemTime>);

fn stamp(path: &Path) -> Option<Stamp> {
    let meta = std::fs::metadata(path).ok()?;
    Some((meta.len(), meta.modified().ok()))
}

/// Watches the copy at `path` of the page's `asset`. `marks` are folders whose [`COPY_MARK`] points at the copy; they
/// go with it.
fn start_watch(app: AppHandle, page: String, asset: String, path: PathBuf, mut marks: Vec<PathBuf>) {
    let stop = Arc::new(AtomicBool::new(false));
    if let Ok(mut watches) = WATCHES.lock() {
        watches.push(Watch {
            page: page.clone(),
            asset: asset.clone(),
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
            match save_back(&app, &page, &current, &path) {
                Ok(saved) => {
                    seen = Some(now);
                    pending = None;
                    current = saved.id;
                    marks.extend(mark_copy(&current, &path));
                    if let Ok(mut watches) = WATCHES.lock() {
                        if let Some(watch) = watches.iter_mut().find(|watch| Arc::ptr_eq(&watch.stop, &stop)) {
                            watch.asset = current.clone();
                        }
                    }
                }
                // The page is gone, so nothing can take the change. The copy is kept.
                Err(error) if error.code == errors::NOT_FOUND => break,
                // The app may still hold the file; the next check tries again.
                Err(_) => pending = None,
            }
        }
        if let Ok(mut watches) = WATCHES.lock() {
            watches.retain(|watch| !Arc::ptr_eq(&watch.stop, &stop));
        }
        // A copy whose last change came back is removed. One with a change that didn't is kept, and the next open
        // saves it back.
        if stamp(&path) == seen {
            let _ = std::fs::remove_file(&path);
            if let Some(folder) = path.parent() {
                let _ = std::fs::remove_dir(folder);
            }
            for folder in marks {
                let _ = std::fs::remove_file(folder.join(COPY_MARK));
                let _ = std::fs::remove_dir(folder);
            }
        }
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

    #[test]
    fn a_copy_with_changes_is_never_overwritten_with_the_older_asset() {
        // F3-2: a copy edited after its watch ended was rewritten with the asset's old bytes on the next open.
        let dir = tempfile::tempdir().expect("a temp folder");
        let path = dir.path().join("asset").join("Budget.xlsx");
        let asset = || Ok(b"old cells".to_vec());
        assert_eq!(prepare_copy(&path, asset).expect("writes"), Copy::Written);
        assert_eq!(std::fs::read(&path).expect("reads"), b"old cells");
        assert_eq!(prepare_copy(&path, asset).expect("keeps"), Copy::Kept);
        std::fs::write(&path, b"new cells").expect("the other app saves");
        assert_eq!(prepare_copy(&path, asset).expect("keeps"), Copy::Edited);
        assert_eq!(std::fs::read(&path).expect("reads"), b"new cells");
    }

    #[test]
    fn a_saved_back_asset_finds_the_copy_it_came_from() {
        // After a save-back the attachment shows a newer asset, but its copy stays in the first asset's folder.
        // Changes made to that copy after its watch ended must be found when the newer asset opens.
        let first = format!("test-{}", std::process::id());
        let later = format!("{first}-later");
        let copy = temp_folder(&first).join("Budget.xlsx");
        std::fs::create_dir_all(temp_folder(&first)).expect("a folder");
        std::fs::write(&copy, b"edited").expect("writes");
        assert_eq!(
            copy_path(&later, "Budget.xlsx"),
            temp_folder(&later).join("Budget.xlsx")
        );
        let marked = mark_copy(&later, &copy).expect("marked");
        assert_eq!(copy_path(&later, "Budget.xlsx"), copy);
        // A copy of another name is never opened in place of this one: its name decided how it may open.
        assert_eq!(copy_path(&later, "Budget.exe"), temp_folder(&later).join("Budget.exe"));
        let _ = std::fs::remove_dir_all(marked);
        let _ = std::fs::remove_dir_all(temp_folder(&first));
    }

    /// A page with a file block that shows an attachment, in a notebook of `notes`. Returns the page and the asset.
    fn a_page_with_an_attachment(bridge: &CoreBridge, notes: &Path) -> (String, AssetId) {
        bridge
            .notes(Some(notes.to_path_buf()), |bridge| {
                let create = |bridge: &mut Bridge, kind: &str, parent: Option<String>| {
                    let input =
                        serde_json::json!({ "kind": kind, "placement": { "parentId": parent, "beforeId": null } });
                    let node = bridge.dispatch("notes_create", &serde_json::json!({ "input": input }))?;
                    Ok::<_, IpcError>(node["id"].as_str().unwrap_or_default().to_owned())
                };
                let notebook = create(bridge, "notebook", None)?;
                let section = create(bridge, "section", Some(notebook))?;
                let page = create(bridge, "page", Some(section))?;
                let handle = bridge.handle(&page, "main-1")?;
                let asset = handle
                    .import_asset(AssetSource::bytes(
                        "Budget.csv".to_owned(),
                        "text/csv".to_owned(),
                        b"a,b\n1,2\n".to_vec(),
                    ))
                    .map_err(io_error)?;
                let block: opennote_core::ops::resolve::NewBlock = serde_json::from_value(serde_json::json!({
                    "id": "01k6f00000000000000000b001", "type": "file", "data": { "asset": asset.id.to_string() }
                }))
                .map_err(io_error)?;
                apply_next(
                    &handle,
                    vec![
                        Edit::AddAsset { asset: asset.id },
                        Edit::InsertBlock {
                            block,
                            after: None,
                            before: None,
                        },
                    ],
                )?;
                // The person moves to another page: the window's session closes.
                bridge.close_handle(&page, "main-1")?;
                Ok((page, asset.id))
            })
            .expect("a page")
    }

    #[test]
    fn a_change_saved_after_the_page_closed_reaches_the_note() {
        // F3-2: the watch gave up when the page wasn't open in a window, so the change never came back.
        let dir = tempfile::tempdir().expect("a temp folder");
        let notes = dir.path().join("Notes");
        let bridge = CoreBridge::at(dir.path().join("local"));
        let (page, previous) = a_page_with_an_attachment(&bridge, &notes);
        let copy = dir.path().join("copy").join("Budget.csv");
        std::fs::create_dir_all(copy.parent().expect("a folder")).expect("a folder");
        std::fs::write(&copy, b"a,b\n1,3\n").expect("the other app saves");
        let (saved, blocks, bytes, closed) = bridge
            .notes(Some(notes), |bridge| {
                let saved = save_back_closed(bridge, &page, &previous.to_string(), &copy)?;
                let closed = !bridge
                    .open
                    .keys()
                    .any(|(_, client)| client.as_str() == SAVE_BACK_CLIENT);
                let handle = bridge.handle(&page, "main-1")?;
                let new = AssetId::parse(&saved.id).map_err(io_error)?;
                let bytes = handle.asset_bytes(new, None).map_err(io_error)?.bytes;
                Ok((new, handle.file_blocks_of(new).len(), bytes, closed))
            })
            .expect("saves back");
        bridge.shutdown();
        assert_ne!(saved, previous);
        assert_eq!(blocks, 1, "the file block shows the new copy");
        assert_eq!(bytes, b"a,b\n1,3\n");
        assert!(closed, "the shell's own session of the page is closed again");
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
