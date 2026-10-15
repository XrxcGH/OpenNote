//! Attached files that save back. A file attached to a page is an asset of that page. Opening it writes a copy to a
//! temporary folder, hands the copy to Windows to open in its own app, and watches the copy. Each time the app
//! has saved a change (the file stops changing for one check), the core imports the new bytes as a new asset and
//! the attachment is pointed at it: by the window in one undo step when it shows the page and says it made the
//! change, or else by the shell, so a change saved after the person moved on still reaches the note. Each copy has
//! a record of the bytes it last shared with the note, so a copy is never overwritten while it holds changes the
//! note lacks, and is removed once it holds none. The WebView names a page and an asset, never a path.

use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex, PoisonError,
    },
    thread,
    time::{Duration, Instant, SystemTime},
};

use opennote_core::{
    model::JsonMap,
    ops::resolve::{Edit, TxnRequest},
    session::page::PageHandle,
    store::assets::{mime_for_name, AssetSource},
    AssetId, BlockId, EditError, PageId,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::{ipc::InvokeBody, AppHandle, Emitter, Manager};

use crate::{
    core_bridge::{run_notes, Bridge, CoreBridge},
    images::{
        import::{asset_json, on_blocking, open_page, percent_decode},
        ImportedAsset,
    },
    ipc::{codes, IpcError, IpcResult},
};

/// Files over 200 MB are refused.
pub const MAX_ATTACHMENT_BYTES: usize = 200 * 1024 * 1024;
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
    /// The asset the copy was last saved back as.
    previous: String,
    /// Every asset the copy has been, oldest first: after an undo, a block may show an earlier one.
    replaces: Vec<String>,
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

/// The client the shell saves an attachment back as, when no window makes the change. Undo is kept per client, so a
/// change the shell makes is not on a window's Ctrl+Z; the earlier asset stays in the page's table, and in its
/// history.
const SAVE_BACK_CLIENT: &str = "attachments";

/// How often and how long a watch looks, so tests can run one quickly.
#[derive(Debug, Clone, Copy)]
struct Timing {
    /// How often the copy is checked.
    poll: Duration,
    /// A watch ends after this long, so a forgotten copy does not keep a thread for days.
    limit: Duration,
    /// How long a window that shows the page has to make a change saved back, before the shell makes it.
    window: Duration,
}

const TIMING: Timing = Timing {
    poll: Duration::from_millis(1000),
    limit: Duration::from_secs(12 * 60 * 60),
    window: Duration::from_secs(5),
};

/// What saving back needs from the app: the core's notes and the windows. Tests run it on a bridge alone.
trait Notes: Clone + Send + 'static {
    /// Runs `work` on the started bridge.
    fn bridge<T>(&self, work: impl FnOnce(&mut Bridge) -> IpcResult<T>) -> IpcResult<T>;
    /// Tells the windows that a change came back, so one that shows the page points the attachment at it.
    fn tell(&self, saved: &Saved);
}

#[derive(Clone)]
struct AppNotes(AppHandle);

impl Notes for AppNotes {
    fn bridge<T>(&self, work: impl FnOnce(&mut Bridge) -> IpcResult<T>) -> IpcResult<T> {
        let bridge = self.0.state::<CoreBridge>();
        run_notes(&self.0, &bridge, work)
    }

    fn tell(&self, saved: &Saved) {
        if let Err(error) = self.0.emit(SAVED_EVENT, saved) {
            ::log::warn!("Couldn't send {SAVED_EVENT}: {error}");
        }
    }
}

/// Runs `work` on the page through the shell's own session of it, opened for the work and closed after it. The
/// bridge is held meanwhile, so two watches never share the session. `work` also learns whether a window has the
/// page open.
fn in_shell<N: Notes, T>(notes: &N, page: &str, work: impl FnOnce(&PageHandle, bool) -> IpcResult<T>) -> IpcResult<T> {
    notes.bridge(|bridge| {
        let window = in_window(bridge, page);
        let handle = bridge.handle(page, SAVE_BACK_CLIENT)?;
        let result = work(&handle, window);
        let closed = bridge.close_handle(page, SAVE_BACK_CLIENT);
        let value = result?;
        closed.map(|()| value)
    })
}

/// Whether a window has the page open and can change it. A window that shows it read-only is never asked, so the
/// shell doesn't wait on a change the window won't make.
fn in_window(bridge: &Bridge, page: &str) -> bool {
    let Ok(id) = PageId::parse(page) else {
        return false;
    };
    bridge.open.iter().any(|((open, client), handle)| {
        *open == id && client.as_str() != SAVE_BACK_CLIENT && handle.read_only().is_none()
    })
}

/// Changes saved back that a window made, as (page, asset), until the watch that waits for them takes them.
static APPLIED: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());
static APPLIED_WAKE: Condvar = Condvar::new();

fn applied(page: &str, asset: &str) {
    let mut list = APPLIED.lock().unwrap_or_else(PoisonError::into_inner);
    list.push((page.to_owned(), asset.to_owned()));
    // One no watch waited for, as after a timeout, isn't kept for long.
    if list.len() > 64 {
        list.remove(0);
    }
    APPLIED_WAKE.notify_all();
}

/// How often a wait for a window checks that the window can still make the change.
const WINDOW_CHECK: Duration = Duration::from_millis(100);

/// Takes the window's word that it pointed the page's attachment at `asset`, if it gave it.
fn take_applied(page: &str, asset: &str) -> bool {
    let mut list = APPLIED.lock().unwrap_or_else(PoisonError::into_inner);
    let found = list.iter().position(|(p, a)| p == page && a == asset);
    found.map(|index| list.remove(index)).is_some()
}

/// Waits up to `timeout` for a window to say it pointed the page's attachment at `asset`. Gives up early once
/// `window` says no window can make it any more, as when the page closed or turned read-only.
fn wait_applied(page: &str, asset: &str, timeout: Duration, window: impl Fn() -> bool) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        let list = APPLIED.lock().unwrap_or_else(PoisonError::into_inner);
        if list.iter().any(|(p, a)| p == page && a == asset) {
            drop(list);
            return take_applied(page, asset);
        }
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return false;
        }
        drop(APPLIED_WAKE.wait_timeout(list, left.min(WINDOW_CHECK)));
        // Checked without the list held: the check takes the bridge, which a window's call may hold meanwhile.
        if !window() {
            return take_applied(page, asset);
        }
    }
}

/// The window pointed its page's attachment at a change saved back (see [`SAVED_EVENT`]). Until it says so, the
/// shell can't know the change reached the note: the page may have closed, or turned read-only, before it could.
#[tauri::command]
pub fn attachment_applied(page: String, asset: String) -> IpcResult<()> {
    PageId::parse(&page).map_err(|_| IpcError::invalid("page", "The page's ID isn't valid."))?;
    AssetId::parse(&asset).map_err(|_| IpcError::invalid("asset", "The attachment's ID isn't valid."))?;
    applied(&page, &asset);
    Ok(())
}

/// A copy being watched. A watch outlives the page's view: a change saved after the person moved to another page
/// still comes back into the note. It ends when the app does, or after [`Timing::limit`].
struct Watch {
    page: String,
    /// The assets the copy has been, oldest first: the one it was made from, then each change saved back.
    lineage: Vec<String>,
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

/// Where the hash of the bytes a copy last shared with the note is kept: in a folder beside the copy's, never in
/// it, so the folder shown to the person holds only the copy. Asset folders have no dot in their names.
fn record_path(copy: &Path) -> Option<PathBuf> {
    let folder = copy.parent()?;
    let mut name = folder.file_name()?.to_owned();
    name.push(".synced");
    Some(folder.with_file_name(name).join(copy.file_name()?))
}

fn hash(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().map(|byte| format!("{byte:02x}")).collect()
}

/// Notes that the copy at `copy` holds bytes with this hash, which the note has as an asset.
fn write_record(copy: &Path, hash: &str) {
    let Some(record) = record_path(copy) else {
        return;
    };
    let written = match record.parent() {
        Some(folder) => std::fs::create_dir_all(folder).and_then(|()| std::fs::write(&record, hash)),
        None => Ok(()),
    };
    if let Err(error) = written {
        ::log::warn!("Couldn't note what an attachment's copy holds: {error}");
    }
}

fn read_record(copy: &Path) -> Option<String> {
    let text = std::fs::read_to_string(record_path(copy)?).ok()?;
    Some(text.trim().to_owned())
}

/// Whether the copy holds just what the note had of it when it last came back or was written: removing or rewriting
/// it loses nothing.
fn in_sync(copy: &Path) -> bool {
    match (read_record(copy), std::fs::read(copy)) {
        (Some(record), Ok(bytes)) => record == hash(&bytes),
        _ => false,
    }
}

/// Removes a copy, its record, and their folders once empty. An app that still holds the copy keeps it.
fn remove_copy(copy: &Path) {
    if std::fs::remove_file(copy).is_err() {
        return;
    }
    if let Some(record) = record_path(copy) {
        let _ = std::fs::remove_file(&record);
        if let Some(folder) = record.parent() {
            let _ = std::fs::remove_dir(folder);
        }
    }
    if let Some(folder) = copy.parent() {
        let _ = std::fs::remove_dir(folder);
    }
}

/// Removes the copies earlier runs left that hold nothing the note lacks, and marks and records of copies that are
/// gone. A copy with changes that never came back stays until its attachment opens again, which saves them back.
fn sweep(root: &Path) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    let mut records = Vec::new();
    for entry in entries.flatten() {
        let folder = entry.path();
        if !folder.is_dir() {
            continue;
        }
        if folder.extension().is_some_and(|extension| extension == "synced") {
            records.push(folder);
            continue;
        }
        for file in std::fs::read_dir(&folder).into_iter().flatten().flatten() {
            let path = file.path();
            if !path.is_file() {
                continue;
            }
            if in_sync(&path) {
                remove_copy(&path);
            } else if path.file_name().is_some_and(|name| name == COPY_MARK) {
                let marked = std::fs::read_to_string(&path).map(|text| PathBuf::from(text.trim()));
                if marked.is_ok_and(|marked| marked.starts_with(root) && !marked.exists()) {
                    let _ = std::fs::remove_file(&path);
                }
            }
        }
        let _ = std::fs::remove_dir(&folder);
    }
    for folder in records {
        let copies = folder.with_extension("");
        for file in std::fs::read_dir(&folder).into_iter().flatten().flatten() {
            if !copies.join(file.file_name()).exists() {
                let _ = std::fs::remove_file(file.path());
            }
        }
        let _ = std::fs::remove_dir(&folder);
    }
}

/// At start, in the background: clears the copies earlier runs left (see [`sweep`]).
pub fn sweep_old_copies() {
    let spawned = thread::Builder::new()
        .name("attachment-sweep".into())
        .spawn(|| sweep(&temp_root()));
    if let Err(error) = spawned {
        ::log::warn!("Couldn't start clearing old attachment copies: {error}");
    }
}

/// At exit: ends the watches, and removes their copies that hold nothing the note lacks.
pub fn shutdown() {
    let watches = std::mem::take(&mut *WATCHES.lock().unwrap_or_else(PoisonError::into_inner));
    for watch in watches {
        watch.stop.store(true, Ordering::Relaxed);
        if in_sync(&watch.path) {
            remove_copy(&watch.path);
        }
    }
}

/// The watched copy of a page's asset, if it is still there: the copy a watch made of it or of a later version, or
/// one now at `path`, where a copy of it goes. A second watch never starts on one file.
fn watched_copy(page: &str, asset: &str, path: &Path) -> Option<PathBuf> {
    let watches = WATCHES.lock().ok()?;
    let watch = watches
        .iter()
        .find(|watch| watch.page == page && (watch.lineage.iter().any(|id| id == asset) || watch.path == path))?;
    watch.path.exists().then(|| watch.path.clone())
}

/// Ends the watches of a page's asset or of the copy at `path`, such as one whose copy was deleted.
fn stop_watches(page: &str, asset: &str, path: &Path) {
    if let Ok(mut watches) = WATCHES.lock() {
        watches.retain(|watch| {
            let matches = watch.page == page && (watch.lineage.iter().any(|id| id == asset) || watch.path == path);
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
    /// Nothing, or a copy of a version the note had before, such as the one an undo took back: the copy was written
    /// from the asset.
    Written,
    /// A copy with the asset's bytes, or one the app holding it won't let anyone read or write. It is opened as it
    /// is.
    Kept,
    /// A copy with changes the note doesn't have: saved after its watch ended, such as after the app was closed.
    /// They are saved back before the copy opens, never overwritten.
    Edited,
}

/// Makes sure `path` holds a copy of an asset with these bytes, without ever overwriting changes the note lacks.
fn prepare_copy(path: &Path, bytes: &[u8]) -> IpcResult<Copy> {
    let synced = hash(bytes);
    if path.exists() {
        let Ok(copy) = std::fs::read(path) else {
            return Ok(Copy::Kept);
        };
        if copy == bytes {
            write_record(path, &synced);
            return Ok(Copy::Kept);
        }
        // Without a record, as for a copy from an earlier version of the app, any difference is a change.
        if read_record(path) != Some(hash(&copy)) {
            return Ok(Copy::Edited);
        }
        return Ok(match std::fs::write(path, bytes) {
            Ok(()) => {
                write_record(path, &synced);
                Copy::Written
            }
            Err(_) => Copy::Kept,
        });
    }
    if let Some(folder) = path.parent() {
        std::fs::create_dir_all(folder).map_err(io_error)?;
    }
    std::fs::write(path, bytes).map_err(io_error)?;
    write_record(path, &synced);
    Ok(Copy::Written)
}

/// Why a change couldn't be saved back.
#[derive(Debug)]
enum Failure {
    /// The copy can't be read now, as while its app writes it. The next check tries again.
    Retry(IpcError),
    /// The page can't take it: it is gone or read-only, or refused the change. The copy keeps the change, and the
    /// next open of the attachment tries again.
    Stop(IpcError),
}

fn read_only(reason: impl std::fmt::Debug) -> IpcError {
    IpcError::new("readOnly", format!("The page is read-only: {reason:?}"))
}

/// The file blocks that show any of `assets` except `except`.
fn blocks_showing(handle: &PageHandle, assets: &[AssetId], except: Option<AssetId>) -> Vec<BlockId> {
    assets
        .iter()
        .filter(|asset| Some(**asset) != except)
        .flat_map(|asset| handle.file_blocks_of(*asset))
        .collect()
}

/// Points the file blocks that show any of `lineage` at `asset`, in one transaction of the handle's client.
fn point_at(handle: &PageHandle, lineage: &[AssetId], asset: AssetId) -> IpcResult<()> {
    if let Some(reason) = handle.read_only() {
        return Err(read_only(reason));
    }
    let blocks = blocks_showing(handle, lineage, Some(asset));
    if blocks.is_empty() {
        return Ok(());
    }
    let mut edits = vec![Edit::AddAsset { asset }];
    for block in blocks {
        let mut data = JsonMap::new();
        data.insert("asset".to_owned(), Value::String(asset.to_string()));
        edits.push(Edit::PatchBlock {
            block,
            lock: None,
            data: Some(data),
            fallback: None,
        });
    }
    apply_next(handle, edits)
}

/// Saves the copy's bytes back as an asset of the page, and points the file blocks that show any asset the copy has
/// been (`lineage`, oldest first) at it: after an undo a block may show an earlier one. A window that shows the page
/// makes that change, as one step its Ctrl+Z takes back. When none does, or the window doesn't say it did within
/// [`Timing::window`], the shell makes it. Answers the assets the save made, oldest first, the last being the one
/// the page shows; `None` when no block shows the copy any more.
fn save_back<N: Notes>(
    notes: &N,
    page: &str,
    lineage: &[String],
    path: &Path,
    timing: Timing,
) -> Result<Option<Vec<String>>, Failure> {
    let ids = lineage
        .iter()
        .map(|id| AssetId::parse(id))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| Failure::Stop(IpcError::invalid("asset", "The attachment's ID isn't valid.")))?;
    let bytes = std::fs::read(path).map_err(|error| Failure::Retry(io_error(error)))?;
    if bytes.len() > MAX_ATTACHMENT_BYTES {
        return Err(Failure::Stop(IpcError::new(
            "tooLarge",
            "Files over 200 MB can't be attached.",
        )));
    }
    let synced = hash(&bytes);
    let name = safe_name(&path.file_name().unwrap_or_default().to_string_lossy());
    let mime = mime_for_name(&name).to_owned();
    let source = || AssetSource::bytes(name.clone(), mime.clone(), bytes.clone());
    // An import is kept only while a session of the page is open: with no window showing the page, the shell's own
    // session closes after its work, so it makes the change in the same session as the import.
    let imported = in_shell(notes, page, |handle, window| {
        // Checked before the import, so a page that can't take the change gets no asset it never shows.
        if let Some(reason) = handle.read_only() {
            return Err(read_only(reason));
        }
        if blocks_showing(handle, &ids, None).is_empty() {
            return Ok(None);
        }
        let asset = handle.import_asset(source()).map_err(io_error)?;
        let changes = !blocks_showing(handle, &ids, Some(asset.id)).is_empty();
        if changes && !window {
            point_at(handle, &ids, asset.id)?;
        }
        Ok(Some((asset, changes && window)))
    })
    .map_err(Failure::Stop)?;
    let Some((asset, by_window)) = imported else {
        return Ok(None);
    };
    if by_window {
        notes.tell(&Saved {
            page: page.to_owned(),
            previous: lineage.last().cloned().unwrap_or_default(),
            replaces: lineage.to_vec(),
            asset: ImportedAsset {
                id: asset.id.to_string(),
                asset: asset_json(&asset),
            },
        });
        let window = || notes.bridge(|bridge| Ok(in_window(bridge, page))).unwrap_or(false);
        if !wait_applied(page, &asset.id.to_string(), timing.window, window) {
            // The window closed the page, or couldn't make the change, and the import may have gone with the page's
            // session. The shell imports the copy again and makes the change itself. The window may still have made
            // it, only late, so blocks that show the first import are pointed at the new one too, and the watch
            // keeps both: a block that shows either is still the copy's.
            let mut shown = ids.clone();
            shown.push(asset.id);
            let again = in_shell(notes, page, |handle, _| {
                let again = handle.import_asset(source()).map_err(io_error)?;
                point_at(handle, &shown, again.id)?;
                Ok(again)
            })
            .map_err(Failure::Stop)?;
            write_record(path, &synced);
            return Ok(Some(vec![asset.id.to_string(), again.id.to_string()]));
        }
    }
    write_record(path, &synced);
    Ok(Some(vec![asset.id.to_string()]))
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
/// [`OPENS`]), and watches the copy.
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
        let path = open_copy(&AppNotes(app), &page, &asset, &name, TIMING)?;
        mark_from_internet(&path);
        if opening == Opening::App {
            open_default(&path).map(|()| Shown::App)
        } else {
            crate::interop::commands::reveal(&path).map(|()| Shown::Folder)
        }
    })
    .await
}

/// Puts the attachment's copy where it opens, and makes sure a watch saves its changes back. A copy with changes the
/// note lacks, such as ones saved after the app closed, is saved back first, never overwritten.
fn open_copy<N: Notes>(notes: &N, page: &str, asset: &str, name: &str, timing: Timing) -> IpcResult<PathBuf> {
    let id = AssetId::parse(asset).map_err(|_| IpcError::invalid("asset", "The attachment's ID isn't valid."))?;
    let watched = watched_copy(page, asset, &copy_path(asset, name));
    let path = watched.clone().unwrap_or_else(|| copy_path(asset, name));
    let bytes = in_shell(notes, page, |handle, _| {
        Ok(handle.asset_bytes(id, None).map_err(io_error)?.bytes)
    })?;
    let copy = prepare_copy(&path, &bytes)?;
    if watched.is_some() {
        // Its watch saves any change back.
        return Ok(path);
    }
    stop_watches(page, asset, &path);
    let mut lineage = vec![asset.to_owned()];
    if copy == Copy::Edited {
        match save_back(notes, page, &lineage, &path, timing) {
            Ok(Some(made)) => lineage.extend(made.into_iter().filter(|id| id != asset)),
            Ok(None) => {}
            Err(Failure::Retry(error) | Failure::Stop(error)) => {
                ::log::warn!("Couldn't save an attachment's earlier changes back: {}", error.message);
            }
        }
    }
    let marks = lineage
        .last()
        .and_then(|current| mark_copy(current, &path))
        .into_iter()
        .collect();
    start_watch(notes.clone(), page.to_owned(), lineage, path.clone(), marks, timing);
    Ok(path)
}

type Stamp = (u64, Option<SystemTime>);

fn stamp(path: &Path) -> Option<Stamp> {
    let meta = std::fs::metadata(path).ok()?;
    Some((meta.len(), meta.modified().ok()))
}

/// Watches the copy at `path` of a page's attachment, whose versions so far are `lineage`. `marks` are folders whose
/// [`COPY_MARK`] points at the copy; they go with it.
fn start_watch<N: Notes>(
    notes: N,
    page: String,
    mut lineage: Vec<String>,
    path: PathBuf,
    mut marks: Vec<PathBuf>,
    timing: Timing,
) {
    let stop = Arc::new(AtomicBool::new(false));
    if let Ok(mut watches) = WATCHES.lock() {
        watches.push(Watch {
            page: page.clone(),
            lineage: lineage.clone(),
            stop: stop.clone(),
            path: path.clone(),
        });
    }
    // Taken now, not when the thread starts: a change saved meanwhile would otherwise be taken for the copy as written.
    let mut seen = stamp(&path);
    thread::spawn(move || {
        let started = Instant::now();
        let mut pending: Option<Stamp> = None;
        while !stop.load(Ordering::Relaxed) && started.elapsed() < timing.limit {
            thread::sleep(timing.poll);
            if stop.load(Ordering::Relaxed) {
                break;
            }
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
            match save_back(&notes, &page, &lineage, &path, timing) {
                Ok(Some(made)) => {
                    seen = Some(now);
                    pending = None;
                    for id in made {
                        marks.extend(mark_copy(&id, &path));
                        if !lineage.contains(&id) {
                            lineage.push(id);
                        }
                    }
                    if let Ok(mut watches) = WATCHES.lock() {
                        if let Some(watch) = watches.iter_mut().find(|watch| Arc::ptr_eq(&watch.stop, &stop)) {
                            watch.lineage = lineage.clone();
                        }
                    }
                }
                Ok(None) => {
                    ::log::info!("An attachment's copy changed, but no block on its page shows it any more.");
                    break;
                }
                // The app may still hold the file; the next check tries again.
                Err(Failure::Retry(_)) => pending = None,
                // The page can't take the change. The copy keeps it, and the next open tries again.
                Err(Failure::Stop(error)) => {
                    ::log::warn!("Stopped saving an attachment back: {}", error.message);
                    break;
                }
            }
        }
        if let Ok(mut watches) = WATCHES.lock() {
            watches.retain(|watch| !Arc::ptr_eq(&watch.stop, &stop));
        }
        // A copy that holds what the note has is removed. One with a change that didn't come back is kept, and the
        // next open saves it back.
        if in_sync(&path) {
            remove_copy(&path);
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
        assert_eq!(prepare_copy(&path, b"old cells").expect("writes"), Copy::Written);
        assert_eq!(std::fs::read(&path).expect("reads"), b"old cells");
        assert!(in_sync(&path), "the copy's record names what it holds");
        assert_eq!(prepare_copy(&path, b"old cells").expect("keeps"), Copy::Kept);
        std::fs::write(&path, b"new cells").expect("the other app saves");
        assert!(!in_sync(&path));
        assert_eq!(prepare_copy(&path, b"old cells").expect("keeps"), Copy::Edited);
        assert_eq!(std::fs::read(&path).expect("reads"), b"new cells");
    }

    #[test]
    fn a_copy_of_a_version_the_note_moved_away_from_is_rewritten() {
        // F3-2 (G3): after a save-back and an undo, the copy holds the newer version the note already has as an asset.
        // That is no change of the person's, so opening the earlier version rewrites the copy rather than saving it
        // back over the undo.
        let dir = tempfile::tempdir().expect("a temp folder");
        let path = dir.path().join("asset").join("Budget.xlsx");
        prepare_copy(&path, b"v1").expect("writes");
        std::fs::write(&path, b"v2").expect("the other app saves");
        write_record(&path, &hash(b"v2"));
        assert_eq!(prepare_copy(&path, b"v1").expect("rewrites"), Copy::Written);
        assert_eq!(std::fs::read(&path).expect("reads"), b"v1");
        // A copy from before records existed counts any difference as a change.
        let old = dir.path().join("old").join("Notes.docx");
        std::fs::create_dir_all(old.parent().expect("a folder")).expect("a folder");
        std::fs::write(&old, b"edited").expect("writes");
        assert_eq!(prepare_copy(&old, b"original").expect("keeps"), Copy::Edited);
        // The record lives beside the copy's folder, never in it.
        let record = record_path(&path).expect("a record");
        assert_ne!(record.parent(), path.parent());
    }

    #[test]
    fn the_sweep_removes_only_copies_that_hold_nothing_new() {
        // F3-2 (G8): copies of every attachment ever opened piled up in the temporary folder.
        let dir = tempfile::tempdir().expect("a temp folder");
        let root = dir.path();
        let copy = |folder: &str, name: &str, bytes: &[u8], record: Option<&[u8]>| {
            let path = root.join(folder).join(name);
            std::fs::create_dir_all(path.parent().expect("a folder")).expect("a folder");
            std::fs::write(&path, bytes).expect("writes");
            if let Some(record) = record {
                write_record(&path, &hash(record));
            }
            path
        };
        let synced = copy("a1", "Budget.xlsx", b"cells", Some(b"cells"));
        let edited = copy("a2", "Notes.docx", b"edited", Some(b"original"));
        let unknown = copy("a3", "Plan.pptx", b"slides", None);
        let mark = copy(
            "a4",
            COPY_MARK,
            root.join("gone").join("x.pdf").to_string_lossy().as_bytes(),
            None,
        );
        std::fs::create_dir_all(root.join("a5.synced")).expect("a folder");
        std::fs::write(root.join("a5.synced").join("Gone.pdf"), "hash").expect("writes");
        sweep(root);
        assert!(
            !synced.exists() && !root.join("a1").exists(),
            "a copy the note has is removed"
        );
        assert!(!record_path(&synced).expect("a record").exists());
        assert!(!root.join("a1.synced").exists());
        assert!(
            edited.exists() && record_path(&edited).expect("a record").exists(),
            "changes are kept"
        );
        assert!(unknown.exists(), "a copy without a record may hold changes");
        assert!(
            !mark.exists() && !root.join("a4").exists(),
            "a mark of a copy that is gone is removed"
        );
        assert!(
            !root.join("a5.synced").exists(),
            "a record of a copy that is gone is removed"
        );
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

    /// The window's client in these tests.
    const WINDOW: &str = "main-1";

    const FAST: Timing = Timing {
        poll: Duration::from_millis(30),
        limit: Duration::from_secs(120),
        window: Duration::from_millis(400),
    };

    /// The app for a watch, without windows: a bridge, and a window that shows the page when `WINDOW` has it open.
    #[derive(Clone)]
    struct TestNotes {
        bridge: Arc<CoreBridge>,
        notes: PathBuf,
        /// Whether the window makes a change it is told about, as its interface does, and says so.
        window_applies: bool,
        told: Arc<Mutex<Vec<Saved>>>,
        /// Every use of the bridge fails with this code once set, as for a page that turned read-only.
        fail: Arc<Mutex<Option<&'static str>>>,
        calls: Arc<std::sync::atomic::AtomicUsize>,
        /// The window makes a change but its word never reaches the shell, as when it comes too late.
        silent: Arc<AtomicBool>,
    }

    impl Notes for TestNotes {
        fn bridge<T>(&self, work: impl FnOnce(&mut Bridge) -> IpcResult<T>) -> IpcResult<T> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if let Some(code) = *self.fail.lock().expect("the flag") {
                return Err(IpcError::new(code, "refused"));
            }
            self.bridge.notes(Some(self.notes.clone()), work)
        }

        fn tell(&self, saved: &Saved) {
            self.told.lock().expect("the list").push(saved.clone());
            if !self.window_applies {
                return;
            }
            // As the interface does: one transaction of the window's client, then it says so.
            let made = self.bridge.notes(Some(self.notes.clone()), |bridge| {
                let handle = bridge.handle(&saved.page, WINDOW)?;
                let asset = AssetId::parse(&saved.asset.id).map_err(io_error)?;
                let lineage = saved
                    .replaces
                    .iter()
                    .map(|id| AssetId::parse(id).map_err(io_error))
                    .collect::<IpcResult<Vec<_>>>()?;
                point_at(&handle, &lineage, asset)
            });
            if made.is_ok() && !self.silent.load(Ordering::SeqCst) {
                applied(&saved.page, &saved.asset.id);
            }
        }
    }

    struct Setup {
        _dir: tempfile::TempDir,
        notes: TestNotes,
        page: String,
        asset: AssetId,
        /// The assets the attachment may show: the first, and each one a change came back as.
        known: Mutex<Vec<AssetId>>,
    }

    impl Setup {
        /// A page with a file block that shows `Budget.csv`. `window` keeps it open in the window.
        fn new(window: bool, window_applies: bool) -> Setup {
            let dir = tempfile::tempdir().expect("a temp folder");
            let notes_folder = dir.path().join("Notes");
            let bridge = Arc::new(CoreBridge::at(dir.path().join("local")));
            let (page, asset) = a_page_with_an_attachment(&bridge, &notes_folder, window);
            let notes = TestNotes {
                bridge,
                notes: notes_folder,
                window_applies,
                told: Arc::default(),
                fail: Arc::default(),
                calls: Arc::default(),
                silent: Arc::default(),
            };
            Setup {
                _dir: dir,
                notes,
                page,
                asset,
                known: Mutex::new(vec![asset]),
            }
        }

        /// Runs `work` on the window's session of the page, which stays closed if it was.
        fn with_window<T>(&self, work: impl FnOnce(&PageHandle) -> IpcResult<T>) -> T {
            self.notes
                .bridge
                .notes(Some(self.notes.notes.clone()), |bridge| {
                    let was_open = in_window_of(bridge, &self.page);
                    let result = work(&bridge.handle(&self.page, WINDOW)?);
                    if !was_open {
                        bridge.close_handle(&self.page, WINDOW)?;
                    }
                    result
                })
                .expect("the page")
        }

        /// The asset the file block shows.
        fn shown(&self) -> AssetId {
            let mut known = self.known.lock().expect("the list");
            let watched: Vec<String> = WATCHES
                .lock()
                .expect("the watches")
                .iter()
                .filter(|watch| watch.page == self.page)
                .flat_map(|watch| watch.lineage.clone())
                .collect();
            let told: Vec<String> = self
                .notes
                .told
                .lock()
                .expect("the list")
                .iter()
                .map(|saved| saved.asset.id.clone())
                .collect();
            for id in watched.into_iter().chain(told) {
                let id = AssetId::parse(&id).expect("an asset");
                if !known.contains(&id) {
                    known.push(id);
                }
            }
            let known = known.clone();
            self.with_window(|handle| {
                Ok(known
                    .iter()
                    .copied()
                    .find(|asset| !handle.file_blocks_of(*asset).is_empty())
                    .unwrap_or(self.asset))
            })
        }

        fn bytes(&self, asset: AssetId) -> Vec<u8> {
            self.with_window(|handle| Ok(handle.asset_bytes(asset, None).map_err(io_error)?.bytes))
        }

        fn open(&self) -> PathBuf {
            open_copy(&self.notes, &self.page, &self.asset.to_string(), "Budget.csv", FAST).expect("opens")
        }

        fn watches(&self) -> usize {
            WATCHES
                .lock()
                .expect("the watches")
                .iter()
                .filter(|watch| watch.page == self.page)
                .count()
        }

        /// Ends the page's watches and waits for their threads to finish.
        fn stop(&self, copy: &Path) {
            stop_watches(&self.page, &self.asset.to_string(), copy);
            thread::sleep(FAST.poll * 4);
        }
    }

    impl Drop for Setup {
        fn drop(&mut self) {
            if let Ok(mut watches) = WATCHES.lock() {
                watches.retain(|watch| {
                    let ours = watch.page == self.page;
                    if ours {
                        watch.stop.store(true, Ordering::Relaxed);
                    }
                    !ours
                });
            }
            thread::sleep(FAST.poll * 4);
            self.notes.bridge.shutdown();
        }
    }

    fn in_window_of(bridge: &Bridge, page: &str) -> bool {
        bridge
            .open
            .keys()
            .any(|(open, client)| open.to_string() == page && client.as_str() == WINDOW)
    }

    fn eventually(what: &str, done: impl Fn() -> bool) {
        let deadline = Instant::now() + Duration::from_secs(20);
        while !done() {
            assert!(Instant::now() < deadline, "timed out waiting until {what}");
            thread::sleep(Duration::from_millis(20));
        }
    }

    /// The other app saves the copy: the bytes, then a later modified time, as an app's save does.
    fn save_in_other_app(copy: &Path, bytes: &[u8]) {
        thread::sleep(Duration::from_millis(20));
        std::fs::write(copy, bytes).expect("the other app saves");
    }

    /// A page with a file block that shows an attachment, in a notebook of `notes`. Returns the page and the asset.
    /// Unless `window`, the window's session closes, as when the person moves to another page.
    fn a_page_with_an_attachment(bridge: &CoreBridge, notes: &Path, window: bool) -> (String, AssetId) {
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
                let handle = bridge.handle(&page, WINDOW)?;
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
                if !window {
                    bridge.close_handle(&page, WINDOW)?;
                }
                Ok((page, asset.id))
            })
            .expect("a page")
    }

    #[test]
    fn a_change_saved_after_the_page_closed_reaches_the_note() {
        // F3-2: the watch gave up when the page wasn't open in a window, so the change never came back.
        let setup = Setup::new(false, false);
        let copy = setup.open();
        assert_eq!(std::fs::read(&copy).expect("the copy"), b"a,b\n1,2\n");
        save_in_other_app(&copy, b"a,b\n1,3\n");
        eventually("the file block shows the change", || setup.shown() != setup.asset);
        assert_eq!(setup.bytes(setup.shown()), b"a,b\n1,3\n");
        assert!(
            setup.notes.told.lock().expect("the list").is_empty(),
            "no window shows the page"
        );
        let shell_open = setup.notes.bridge.notes(Some(setup.notes.notes.clone()), |bridge| {
            Ok(bridge
                .open
                .keys()
                .any(|(_, client)| client.as_str() == SAVE_BACK_CLIENT))
        });
        assert!(
            !shell_open.expect("the bridge"),
            "the shell's own session of the page is closed again"
        );
        // A second change follows the asset the first became.
        let first = setup.shown();
        save_in_other_app(&copy, b"a,b\n1,4\n");
        // Until the watch learns the new asset, `shown` can't name it and answers the first one.
        eventually("the second change comes back", || {
            ![first, setup.asset].contains(&setup.shown())
        });
        assert_eq!(setup.bytes(setup.shown()), b"a,b\n1,4\n");
        // The watch ends; its copy holds what the note has, so it goes (G8).
        assert!(in_sync(&copy));
        setup.stop(&copy);
        eventually("the copy is removed", || !copy.exists());
        assert!(!record_path(&copy).expect("a record").exists());
    }

    #[test]
    fn a_window_that_shows_the_page_makes_the_change_as_one_undo_step() {
        let setup = Setup::new(true, true);
        let copy = setup.open();
        save_in_other_app(&copy, b"a,b\n9,9\n");
        eventually("the file block shows the change", || setup.shown() != setup.asset);
        let told = setup.notes.told.lock().expect("the list").clone();
        assert_eq!(told.len(), 1);
        assert_eq!(told[0].replaces, vec![setup.asset.to_string()]);
        // The window's Ctrl+Z takes the change back (G7).
        setup.with_window(|handle| {
            handle
                .undo(handle.client())
                .map_err(|error| IpcError::new(error.code(), error.to_string()))
        });
        assert_eq!(setup.shown(), setup.asset);
    }

    #[test]
    fn a_change_the_window_never_makes_is_made_by_the_shell() {
        // F3-2 (G4): the window was told, but it closed the page (or the page turned read-only) before it made the
        // change. The watch moved on anyway and later deleted the copy, so the change was left only as an asset no
        // block showed.
        let setup = Setup::new(true, false);
        let copy = setup.open();
        save_in_other_app(&copy, b"a,b\n7,7\n");
        eventually("the shell makes the change", || setup.shown() != setup.asset);
        assert_eq!(setup.notes.told.lock().expect("the list").len(), 1);
        assert_eq!(setup.bytes(setup.shown()), b"a,b\n7,7\n");
    }

    #[test]
    fn a_change_the_window_made_too_late_to_say_so_keeps_coming_back() {
        // F3-2: the window made the change but its word came after the wait, so the shell made it again. The block
        // shows the window's asset, which the shell must point at its own, and later changes must still come back.
        let setup = Setup::new(true, true);
        setup.notes.silent.store(true, Ordering::SeqCst);
        let copy = setup.open();
        save_in_other_app(&copy, b"a,b\n3,3\n");
        eventually("the window makes the change", || setup.shown() != setup.asset);
        // The shell waits out the window, then makes the change itself.
        thread::sleep(FAST.window * 3);
        let shown = setup.shown();
        assert_eq!(
            setup.bytes(shown),
            b"a,b
3,3
"
        );
        let lineage: Vec<String> = WATCHES
            .lock()
            .expect("the watches")
            .iter()
            .filter(|watch| watch.page == setup.page)
            .flat_map(|watch| watch.lineage.clone())
            .collect();
        assert!(
            lineage.contains(&shown.to_string()),
            "the watch knows what the block shows"
        );
        setup.notes.silent.store(false, Ordering::SeqCst);
        save_in_other_app(&copy, b"a,b\n4,4\n");
        eventually("the next change comes back", || {
            setup.bytes(setup.shown()) == b"a,b\n4,4\n"
        });
        assert_eq!(setup.watches(), 1, "the watch goes on");
    }

    #[test]
    fn a_wait_for_the_window_ends_once_no_window_can_make_the_change() {
        let started = Instant::now();
        assert!(!wait_applied("page", "asset", Duration::from_secs(30), || false));
        assert!(started.elapsed() < Duration::from_secs(5));
        applied("page", "said");
        assert!(wait_applied("page", "said", Duration::from_secs(30), || false));
    }

    #[test]
    fn an_undone_save_back_stays_undone_after_a_restart() {
        // F3-2 (G3): after a save-back (A1 to A2), Ctrl+Z (back to A1), and a restart, opening the attachment found the
        // copy differed from A1, took it for an edit, and pointed the block at A2's bytes again.
        let setup = Setup::new(true, true);
        let copy = setup.open();
        save_in_other_app(&copy, b"a,b\n5,5\n");
        eventually("the change comes back", || setup.shown() != setup.asset);
        setup.with_window(|handle| {
            handle
                .undo(handle.client())
                .map_err(|error| IpcError::new(error.code(), error.to_string()))
        });
        assert_eq!(setup.shown(), setup.asset);
        // The app ends without clearing the copy, as when the other app still holds it.
        let held = std::fs::read(&copy).expect("the copy");
        let record = std::fs::read(record_path(&copy).expect("a record")).expect("the record");
        setup.stop(&copy);
        std::fs::create_dir_all(copy.parent().expect("a folder")).expect("a folder");
        std::fs::write(&copy, &held).expect("the copy stays");
        write_record(&copy, &String::from_utf8(record).expect("text"));
        let opened = setup.open();
        assert_eq!(opened, copy);
        assert_eq!(setup.shown(), setup.asset, "the undo stands");
        assert_eq!(
            std::fs::read(&copy).expect("the copy"),
            b"a,b\n1,2\n",
            "the copy shows what the note does"
        );
    }

    #[test]
    fn a_copy_edited_while_no_watch_ran_is_saved_back_when_it_opens() {
        let setup = Setup::new(false, false);
        let copy = copy_path(&setup.asset.to_string(), "Budget.csv");
        std::fs::create_dir_all(copy.parent().expect("a folder")).expect("a folder");
        std::fs::write(&copy, b"a,b\n3,3\n").expect("edited after the app closed");
        assert_eq!(setup.open(), copy);
        assert_ne!(setup.shown(), setup.asset, "the change came back as the copy opened");
        assert_eq!(setup.bytes(setup.shown()), b"a,b\n3,3\n");
        assert_eq!(
            std::fs::read(&copy).expect("the copy"),
            b"a,b\n3,3\n",
            "the copy was not overwritten"
        );
        setup.stop(&copy);
    }

    #[test]
    fn opening_a_watched_copy_again_keeps_its_one_watch() {
        let setup = Setup::new(false, false);
        let copy = setup.open();
        assert_eq!(setup.watches(), 1);
        assert_eq!(setup.open(), copy);
        assert_eq!(setup.watches(), 1, "a second watch never starts on one file");
        stop_watches(&setup.page, &setup.asset.to_string(), &copy);
        assert_eq!(setup.watches(), 0);
        eventually("a copy without changes goes with its watch", || !copy.exists());
    }

    #[test]
    fn a_page_that_cannot_take_the_change_ends_the_watch() {
        // F3-2 (G5): on a read-only page, every check imported the copy again and failed, every 2 seconds for 12 hours.
        let setup = Setup::new(false, false);
        let copy = setup.open();
        *setup.notes.fail.lock().expect("the flag") = Some("readOnly");
        let before = setup.notes.calls.load(Ordering::SeqCst);
        save_in_other_app(&copy, b"a,b\n6,6\n");
        eventually("the watch ends", || setup.watches() == 0);
        thread::sleep(FAST.poll * 10);
        assert_eq!(
            setup.notes.calls.load(Ordering::SeqCst) - before,
            1,
            "one try, then the watch ends"
        );
        assert!(
            copy.exists() && !in_sync(&copy),
            "the copy keeps the change for the next open"
        );
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
