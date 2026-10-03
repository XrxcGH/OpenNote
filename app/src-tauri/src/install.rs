//! Where the app lives, and where notes go (ARCHITECTURE.md sections 17.5 and 17.7): the install status, the
//! folder picker, folder checks, and moving the exe to `%LOCALAPPDATA%\Programs\OpenNote` with a Start menu
//! shortcut. Everything stays in the person's profile, with no administrator rights.
//!
//! Both folders are found from [`Paths`], not from the environment, so a test profile
//! (`OPENNOTE_PROFILE_DIR`) keeps its Programs folder and its Start menu shortcut inside the profile.

use std::{
    fs, io,
    path::{Path, PathBuf},
    thread,
    time::{Duration, Instant},
};

mod shortcut;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Manager, State, WebviewWindow};

pub use shortcut::create_shortcut;

use crate::{
    ipc::{IpcError, IpcResult},
    lifecycle::{self, ExitReason, ExitState, Relaunch},
    paths::{is_local_path, Paths},
};

/// The process's app user model ID. Taskbar pins and the Start menu shortcut share it, so they group together.
pub const APP_USER_MODEL_ID: &str = "org.opennote.app";

/// What the copy in the user's Programs folder is called, whatever the download was called.
pub const INSTALLED_EXE_NAME: &str = "OpenNote.exe";

/// How long the new copy keeps trying to delete the old exe, which antivirus may hold for a scan.
pub const DELETE_RETRY_FOR: Duration = Duration::from_secs(10);

/// A subfolder that holds one of these is a notebook, for the "your notes are already here" check. Phase 3's
/// storage decides the real layout; until it lands, this is the placeholder the setup step counts.
pub const NOTEBOOK_MARKER: &str = "notebook.json";

/// Where the running exe is and what the app may do there, matching the interface's `InstallStatus`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub struct InstallStatus {
    pub exe_path: String,
    /// The exe is in `%LOCALAPPDATA%\Programs\OpenNote\`.
    pub in_user_programs: bool,
    /// The exe's folder is writable, so the app can update itself there.
    pub folder_writable: bool,
    pub has_start_menu_shortcut: bool,
    pub is_dev_build: bool,
    /// Where setup proposes to keep notes: an `OpenNote` folder inside the person's Documents folder.
    pub proposed_notes_folder: String,
}

/// What a proposed notes folder holds, matching the interface's `FolderCheck`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS), ts(export, export_to = crate::BINDINGS))]
pub enum FolderCheck {
    Ok,
    WillCreate,
    HasLibrary { notebook_count: u32 },
    NotWritable,
    InsideAppFolder,
    NotAbsolute,
}

/// `%LOCALAPPDATA%\Programs\OpenNote`, next to the app's own data folder.
pub fn programs_dir(paths: &Paths) -> PathBuf {
    let local = paths.local.parent().unwrap_or(&paths.local);
    local.join("Programs").join("OpenNote")
}

/// The Start menu shortcut, `%APPDATA%\Microsoft\Windows\Start Menu\Programs\OpenNote.lnk`.
pub fn shortcut_path(paths: &Paths) -> PathBuf {
    let roaming = paths.roaming.parent().unwrap_or(&paths.roaming);
    roaming
        .join("Microsoft")
        .join("Windows")
        .join("Start Menu")
        .join("Programs")
        .join("OpenNote.lnk")
}

/// Whether two paths name the same folder. Case and trailing separators don't matter, as on Windows.
pub fn same_folder(a: &Path, b: &Path) -> bool {
    let norm = |path: &Path| {
        path.to_string_lossy()
            .trim_start_matches(r"\\?\")
            .trim_end_matches(['\\', '/'])
            .to_lowercase()
    };
    norm(a) == norm(b)
}

/// Whether `path` is `folder` or lies inside it.
pub fn is_inside(path: &Path, folder: &Path) -> bool {
    let (path, folder) = (
        path.to_string_lossy().trim_start_matches(r"\\?\").to_lowercase(),
        folder
            .to_string_lossy()
            .trim_start_matches(r"\\?\")
            .trim_end_matches(['\\', '/'])
            .to_lowercase(),
    );
    path == folder
        || path
            .strip_prefix(&folder)
            .is_some_and(|rest| rest.starts_with(['\\', '/']))
}

/// Whether the app can create a file in `dir`, checked by creating and deleting a probe file.
pub fn folder_writable(dir: &Path) -> bool {
    let probe = dir.join(format!(".opennote-write-check-{}", std::process::id()));
    let created = fs::File::create(&probe).is_ok();
    let _ = fs::remove_file(&probe);
    created
}

/// Reads the install status for the running exe.
pub fn status(paths: &Paths) -> InstallStatus {
    let exe = std::env::current_exe().unwrap_or_default();
    let folder = exe.parent().unwrap_or(Path::new(""));
    InstallStatus {
        exe_path: exe.display().to_string(),
        in_user_programs: same_folder(folder, &programs_dir(paths)),
        folder_writable: folder_writable(folder),
        has_start_menu_shortcut: shortcut_path(paths).is_file(),
        is_dev_build: cfg!(debug_assertions),
        proposed_notes_folder: paths.documents.join("OpenNote").display().to_string(),
    }
}

#[tauri::command]
pub fn install_status(paths: State<'_, Paths>) -> IpcResult<InstallStatus> {
    Ok(status(&paths))
}

/// Opens the Windows folder picker. Returns `None` when the person cancels.
#[tauri::command]
pub async fn install_pick_folder(window: WebviewWindow, initial: Option<String>) -> IpcResult<Option<String>> {
    // A window handle isn't `Send`, so it crosses to the dialog's thread as a number.
    let owner = window.hwnd().map(|hwnd| hwnd.0 as isize).unwrap_or(0);
    tauri::async_runtime::spawn_blocking(move || pick_folder(owner, initial))
        .await
        .map_err(|error| IpcError::new(crate::ipc::codes::INTERNAL, error.to_string()))?
}

#[cfg(windows)]
fn pick_folder(owner: isize, initial: Option<String>) -> IpcResult<Option<String>> {
    use windows::{
        core::HSTRING,
        Win32::{
            Foundation::{ERROR_CANCELLED, HWND},
            System::Com::{
                CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER,
                COINIT_APARTMENTTHREADED,
            },
            UI::Shell::{
                FileOpenDialog, IFileOpenDialog, IShellItem, SHCreateItemFromParsingName, FOS_FORCEFILESYSTEM,
                FOS_PICKFOLDERS, SIGDN_FILESYSPATH,
            },
        },
    };

    // SAFETY: COM is initialized for this thread and released before it returns, and every object below lives
    // within that span. The owner handle names the main window, or is null for none.
    unsafe {
        let apartment = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = (|| -> windows::core::Result<Option<String>> {
            let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
            dialog.SetOptions(dialog.GetOptions()? | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM)?;
            if let Some(folder) = initial.filter(|folder| Path::new(folder).is_dir()) {
                if let Ok(item) = SHCreateItemFromParsingName::<_, _, IShellItem>(&HSTRING::from(folder), None) {
                    dialog.SetFolder(&item)?;
                }
            }
            let parent = (owner != 0).then_some(HWND(owner as *mut _));
            if let Err(error) = dialog.Show(parent) {
                return if error.code() == ERROR_CANCELLED.to_hresult() {
                    Ok(None)
                } else {
                    Err(error)
                };
            }
            let name = dialog.GetResult()?.GetDisplayName(SIGDN_FILESYSPATH)?;
            let path = name.to_string().ok();
            CoTaskMemFree(Some(name.0.cast_const().cast()));
            Ok(path)
        })();
        if apartment.is_ok() {
            CoUninitialize();
        }
        Ok(result?)
    }
}

#[cfg(not(windows))]
fn pick_folder(_owner: isize, _initial: Option<String>) -> IpcResult<Option<String>> {
    Err(IpcError::not_implemented("install_pick_folder"))
}

/// How many direct subfolders of `dir` are notebooks.
fn count_notebooks(dir: &Path) -> u32 {
    let Ok(entries) = fs::read_dir(dir) else {
        return 0;
    };
    let count = entries
        .filter_map(Result::ok)
        .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
        .filter(|entry| entry.path().join(NOTEBOOK_MARKER).is_file())
        .count();
    u32::try_from(count).unwrap_or(u32::MAX)
}

/// What a proposed notes folder is like, given the folders the app itself lives in.
pub fn check_folder_with(path: &Path, app_folders: &[&Path]) -> FolderCheck {
    // A network or device path is refused before anything touches it, so the probe file below never goes there.
    if !is_local_path(path) {
        return FolderCheck::NotAbsolute;
    }
    if app_folders.iter().any(|folder| is_inside(path, folder)) {
        return FolderCheck::InsideAppFolder;
    }
    if path.is_dir() {
        if !folder_writable(path) {
            return FolderCheck::NotWritable;
        }
        return match count_notebooks(path) {
            0 => FolderCheck::Ok,
            notebook_count => FolderCheck::HasLibrary { notebook_count },
        };
    }
    if path.exists() {
        return FolderCheck::NotWritable;
    }
    // A folder that doesn't exist yet will be created, if the nearest folder above it takes new files.
    match path.ancestors().skip(1).find(|ancestor| ancestor.exists()) {
        Some(parent) if parent.is_dir() && folder_writable(parent) => FolderCheck::WillCreate,
        _ => FolderCheck::NotWritable,
    }
}

#[tauri::command]
pub fn install_check_folder(paths: State<'_, Paths>, path: String) -> IpcResult<FolderCheck> {
    let exe = std::env::current_exe().unwrap_or_default();
    let exe_folder = exe.parent().unwrap_or(Path::new(""));
    let programs = programs_dir(&paths);
    Ok(check_folder_with(Path::new(&path), &[exe_folder, &programs]))
}

/// The SHA-256 of a file.
fn file_hash(path: &Path) -> io::Result<Vec<u8>> {
    let mut hasher = Sha256::new();
    let mut file = fs::File::open(path)?;
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = io::Read::read(&mut file, &mut buffer)?;
        if read == 0 {
            return Ok(hasher.finalize().to_vec());
        }
        hasher.update(&buffer[..read]);
    }
}

/// Copies `source` to `dir\OpenNote.exe` and returns the new path. The copy goes through a `.tmp` file, which is
/// checked against the original first. `fs::copy` uses `CopyFileExW`, which copies alternate data streams, so
/// the copy keeps the Mark of the Web (`Zone.Identifier`) the download had. OpenNote never adds or removes one.
pub fn copy_exe(source: &Path, dir: &Path) -> io::Result<PathBuf> {
    fs::create_dir_all(dir)?;
    let target = dir.join(INSTALLED_EXE_NAME);
    let temp = dir.join(format!("{INSTALLED_EXE_NAME}.tmp"));
    fs::copy(source, &temp)?;
    if file_hash(source)? != file_hash(&temp)? {
        let _ = fs::remove_file(&temp);
        return Err(io::Error::other("The copy doesn't match the original."));
    }
    fs::rename(&temp, &target).inspect_err(|_| {
        let _ = fs::remove_file(&temp);
    })?;
    Ok(target)
}

/// Sets the process's app user model ID, so taskbar pins group with the Start menu shortcut.
#[cfg(windows)]
pub fn set_app_user_model_id() {
    use windows::{core::HSTRING, Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID};

    // SAFETY: the string is NUL-terminated and is copied by the call.
    if let Err(error) = unsafe { SetCurrentProcessExplicitAppUserModelID(&HSTRING::from(APP_USER_MODEL_ID)) } {
        log::warn!("Couldn't set the app user model ID: {error}");
    }
}

#[cfg(not(windows))]
pub fn set_app_user_model_id() {}

/// Copies the running exe into the user's Programs folder and adds the Start menu shortcut. Doesn't exit.
pub fn prepare_move(paths: &Paths) -> IpcResult<(PathBuf, PathBuf)> {
    if cfg!(debug_assertions) {
        return Err(IpcError::invalid("install", "A development build doesn't move itself."));
    }
    let current = std::env::current_exe()?;
    let dir = programs_dir(paths);
    if current.parent().is_some_and(|folder| same_folder(folder, &dir)) {
        return Err(IpcError::invalid(
            "install",
            "OpenNote already runs from its own folder.",
        ));
    }
    let target = copy_exe(&current, &dir)?;
    if let Err(error) = create_shortcut(&shortcut_path(paths), &target) {
        // The move still works without the shortcut, and Settings offers it again.
        log::warn!("Couldn't create the Start menu shortcut: {error}");
    }
    Ok((current, target))
}

/// Copies the app to the user's Programs folder, adds the Start menu shortcut, and relaunches from there once
/// the exit handshake allows it. When the interface refuses, the copy stays in place and nothing else changes.
#[tauri::command]
pub async fn install_move_to_user_programs(app: AppHandle) -> IpcResult<()> {
    let paths = app.state::<Paths>().inner().clone();
    let (current, target) = tauri::async_runtime::spawn_blocking(move || prepare_move(&paths))
        .await
        .map_err(|error| IpcError::new(crate::ipc::codes::INTERNAL, error.to_string()))??;
    app.state::<ExitState>().plan_relaunch(Relaunch {
        exe: target,
        args: vec!["--moved-from".into(), current.display().to_string()],
    });
    lifecycle::request_exit(&app, ExitReason::MoveApp);
    Ok(())
}

/// Why a `--moved-from` argument isn't the copy this one was made from, or `Ok` when it is. The argument comes
/// from the command line, which anything can write, so it is believed only when it matches what `copy_exe` made:
/// the running exe sits in the Programs folder, and `old` is a different file outside it, named like OpenNote's
/// exe, with the same bytes.
fn check_moved_from(running: &Path, programs: &Path, old: &Path) -> Result<(), &'static str> {
    if !running.parent().is_some_and(|folder| same_folder(folder, programs)) {
        return Err("this copy doesn't run from the Programs folder");
    }
    if is_inside(old, programs) || same_folder(old, running) {
        return Err("the file is this copy or lives in the Programs folder");
    }
    let name = old
        .file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if !name.starts_with("opennote") || !name.ends_with(".exe") {
        return Err("the file isn't named like OpenNote's exe");
    }
    match (file_hash(old), file_hash(running)) {
        (Ok(old_hash), Ok(running_hash)) if old_hash == running_hash => Ok(()),
        (Ok(_), Ok(_)) => Err("the file isn't a copy of this one"),
        _ => Err("the file can't be read"),
    }
}

/// Deletes the exe this copy was moved from, once the old process has let go of it. Returns whether the argument
/// was believed (see [`check_moved_from`]); anything else is left alone and logged.
pub fn delete_moved_from(paths: &Paths, old: PathBuf) -> bool {
    let running = std::env::current_exe().unwrap_or_default();
    if let Err(why) = check_moved_from(&running, &programs_dir(paths), &old) {
        log::warn!("Left {} alone: {why}.", old.display());
        return false;
    }
    remove_when_free(old, DELETE_RETRY_FOR);
    true
}

/// Deletes `old` on another thread, trying again while something holds it, for up to `retry_for`.
fn remove_when_free(old: PathBuf, retry_for: Duration) {
    thread::spawn(move || {
        let started = Instant::now();
        loop {
            match fs::remove_file(&old) {
                Ok(()) => return log::info!("Removed the old copy at {}.", old.display()),
                Err(error) if error.kind() == io::ErrorKind::NotFound => return,
                Err(error) if started.elapsed() >= retry_for => {
                    return log::warn!("Couldn't remove the old copy at {}: {error}", old.display());
                }
                Err(_) => thread::sleep(Duration::from_millis(250)),
            }
        }
    });
}

#[cfg(test)]
mod tests;
