//! "Update" for a file this session exported: replace it without asking, but never lose the old one.
//!
//! `export_replace` takes the same body as `export_write`, for a path an earlier export wrote. It copies the old file
//! aside, moves the old file to the Recycle Bin, then writes the new file atomically. If the Recycle Bin can't take
//! it (a network drive, a removable disk), the old file is kept beside the new one as "Name (replaced).ext", and the
//! answer says so. `export_undo_replace` puts the old file back and removes the new one. Nothing is deleted for good:
//! a failed write puts the old file back before it answers.

use std::{
    collections::HashMap,
    fs, io,
    path::{Path, PathBuf},
    sync::Mutex,
};

use serde::{Deserialize, Serialize};
use tauri::{ipc::InvokeBody, AppHandle, Manager};

use crate::{
    images::import::percent_decode,
    ipc::{codes, IpcError, IpcResult},
    page_export::{write_parts, ExportGrants, Part},
};

/// How the old file was kept.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Kept {
    /// There was no earlier file at the path; nothing was replaced.
    Nothing,
    /// The old file is in the Recycle Bin (and a private copy backs Undo).
    Recycled,
    /// The Recycle Bin couldn't take it, so a copy sits beside the new file.
    Beside,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceReceipt {
    kept: Kept,
    /// The kept copy's file name when it sits beside the new file.
    kept_as: Option<String>,
}

/// What Undo needs for one replaced file.
#[derive(Debug, Clone)]
struct Backup {
    file: PathBuf,
    beside: bool,
}

/// The replaced files this session can still undo, by the path they were written to.
#[derive(Default)]
pub struct ReplaceUndo {
    backups: Mutex<HashMap<PathBuf, Backup>>,
}

/// Moves a file to the Recycle Bin. A fake stands in for it in tests.
pub type Recycler<'a> = &'a dyn Fn(&Path) -> io::Result<()>;

/// A name beside `path` that is free: "Name (replaced).ext", then "Name (replaced 2).ext", and so on.
fn beside_name(path: &Path) -> PathBuf {
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("export");
    let extension = path.extension().and_then(|e| e.to_str());
    let mut n = 1u32;
    loop {
        let label = if n == 1 {
            "replaced".to_string()
        } else {
            format!("replaced {n}")
        };
        let name = match extension {
            Some(extension) => format!("{stem} ({label}).{extension}"),
            None => format!("{stem} ({label})"),
        };
        let candidate = path.with_file_name(name);
        if !candidate.exists() {
            return candidate;
        }
        n += 1;
    }
}

/// A private copy's place: a folder under `backup_dir`, so two files with one name never meet.
fn backup_path(backup_dir: &Path, path: &Path) -> io::Result<PathBuf> {
    fs::create_dir_all(backup_dir)?;
    let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("export");
    let mut n = 0u32;
    loop {
        let candidate = backup_dir.join(format!("{n}-{name}"));
        if !candidate.exists() {
            return Ok(candidate);
        }
        n += 1;
    }
}

/// Replaces the file at `path`, as the module says. `write` makes the new file. Answers how the old one was kept and
/// the backup Undo needs.
fn replace_with(
    path: &Path,
    backup_dir: &Path,
    recycle: Recycler<'_>,
    write: impl FnOnce() -> IpcResult<()>,
) -> IpcResult<(ReplaceReceipt, Option<Backup>)> {
    if !path.is_file() {
        write()?;
        return Ok((
            ReplaceReceipt {
                kept: Kept::Nothing,
                kept_as: None,
            },
            None,
        ));
    }
    let private = backup_path(backup_dir, path)?;
    fs::copy(path, &private)?;
    match recycle(path) {
        Ok(()) if !path.exists() => {
            if let Err(error) = write() {
                // Put the old file back, so a failed update changes nothing.
                let _ = fs::copy(&private, path);
                let _ = fs::remove_file(&private);
                return Err(error);
            }
            let backup = Backup {
                file: private,
                beside: false,
            };
            Ok((
                ReplaceReceipt {
                    kept: Kept::Recycled,
                    kept_as: None,
                },
                Some(backup),
            ))
        }
        _ => {
            // The Recycle Bin didn't take it (or left it): keep a copy beside the new file instead.
            let beside = beside_name(path);
            fs::rename(&private, &beside).or_else(|_| fs::copy(&private, &beside).map(|_| ()))?;
            let _ = fs::remove_file(&private);
            if let Err(error) = write() {
                let _ = fs::remove_file(&beside);
                return Err(error);
            }
            let kept_as = beside.file_name().map(|n| n.to_string_lossy().into_owned());
            let backup = Backup {
                file: beside,
                beside: true,
            };
            Ok((
                ReplaceReceipt {
                    kept: Kept::Beside,
                    kept_as,
                },
                Some(backup),
            ))
        }
    }
}

/// Puts the old file back over the new one. A copy kept beside moves back; a private copy is copied and removed.
fn restore(path: &Path, backup: &Backup) -> io::Result<()> {
    if backup.beside {
        fs::rename(&backup.file, path)
    } else {
        let temp = path.with_extension("restore.part");
        let copied = fs::copy(&backup.file, &temp).and_then(|_| fs::rename(&temp, path));
        if copied.is_err() {
            let _ = fs::remove_file(&temp);
        }
        copied?;
        let _ = fs::remove_file(&backup.file);
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
struct ReplaceHeader {
    path: String,
    parts: Vec<Part>,
}

fn backup_dir() -> PathBuf {
    std::env::temp_dir().join("OpenNote-replaced")
}

/// Replaces a file this session exported. The body and header are `export_write`'s.
#[tauri::command]
pub async fn export_replace(app: AppHandle, request: tauri::ipc::Request<'_>) -> IpcResult<ReplaceReceipt> {
    let header = request
        .headers()
        .get("x-opennote-export")
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| IpcError::invalid("x-opennote-export", "The export header is missing."))?;
    let header: ReplaceHeader = serde_json::from_str(&percent_decode(header))
        .map_err(|_| IpcError::invalid("x-opennote-export", "The export header isn't valid JSON."))?;
    let body = match request.body() {
        InvokeBody::Raw(bytes) => bytes.clone(),
        InvokeBody::Json(_) => return Err(IpcError::invalid("body", "The files must come as raw bytes.")),
    };
    let path = PathBuf::from(&header.path);
    if !app.state::<ExportGrants>().was_written(&path) {
        return Err(IpcError::invalid(
            "path",
            "Only a file this export saved can be updated.",
        ));
    }
    let target = path.clone();
    let (receipt, backup) = tauri::async_runtime::spawn_blocking(move || {
        replace_with(&target, &backup_dir(), &recycle_file, || {
            write_parts(&target, &header.parts, &body)
        })
    })
    .await
    .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))??;
    let undo = app.state::<ReplaceUndo>();
    if let Ok(mut backups) = undo.backups.lock() {
        match backup {
            Some(backup) => backups.insert(path, backup),
            None => backups.remove(&path),
        };
    }
    Ok(receipt)
}

/// Puts back the file the last `export_replace` at this path replaced, and removes the new one.
#[tauri::command]
pub async fn export_undo_replace(app: AppHandle, path: String) -> IpcResult<()> {
    let path = PathBuf::from(path);
    let backup = app
        .state::<ReplaceUndo>()
        .backups
        .lock()
        .ok()
        .and_then(|mut backups| backups.remove(&path))
        .ok_or_else(|| IpcError::invalid("path", "There is no earlier file to put back."))?;
    tauri::async_runtime::spawn_blocking(move || restore(&path, &backup))
        .await
        .map_err(|error| IpcError::new(codes::INTERNAL, error.to_string()))??;
    Ok(())
}

/// `GetDriveTypeW`'s answer for a fixed local disk (`DRIVE_FIXED`).
#[cfg(windows)]
const DRIVE_FIXED: u32 = 3;

/// Moves a file to the Recycle Bin, so Windows can restore it. Only a file on a fixed local drive goes there: on a
/// network or removable drive the Bin would delete it for good, so those are refused and the caller keeps a copy.
#[cfg(windows)]
fn recycle_file(path: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::{
            Storage::FileSystem::GetDriveTypeW,
            UI::Shell::{
                SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT, FO_DELETE,
                SHFILEOPSTRUCTW,
            },
        },
    };

    let wide: Vec<u16> = path.as_os_str().encode_wide().collect();
    let drive_letter = matches!(
        wide.as_slice(),
        [d, colon, ..] if *colon == u16::from(b':') && *d < 128 && (*d as u8).is_ascii_alphabetic()
    );
    if !drive_letter {
        return Err(io::Error::new(io::ErrorKind::Unsupported, "not on a local drive"));
    }
    let root: Vec<u16> = wide[..2].iter().copied().chain([u16::from(b'\\'), 0]).collect();
    // SAFETY: `root` is a null-terminated wide string that outlives the call.
    if unsafe { GetDriveTypeW(PCWSTR(root.as_ptr())) } != DRIVE_FIXED {
        return Err(io::Error::new(io::ErrorKind::Unsupported, "not a fixed drive"));
    }
    // SHFileOperation wants the path list double-null-terminated.
    let from: Vec<u16> = wide.iter().copied().chain([0, 0]).collect();
    let mut operation = SHFILEOPSTRUCTW {
        wFunc: FO_DELETE,
        pFrom: PCWSTR(from.as_ptr()),
        fFlags: (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_NOERRORUI | FOF_SILENT).0 as u16,
        ..Default::default()
    };
    // SAFETY: `operation` points at `from`, which is double-null-terminated and outlives the call.
    let code = unsafe { SHFileOperationW(&mut operation) };
    if code != 0 || operation.fAnyOperationsAborted.as_bool() {
        return Err(io::Error::other(format!("the Recycle Bin refused the file ({code})")));
    }
    Ok(())
}

#[cfg(not(windows))]
fn recycle_file(_path: &Path) -> io::Result<()> {
    Err(io::Error::new(io::ErrorKind::Unsupported, "no Recycle Bin here"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write_new(path: &Path) -> impl FnOnce() -> IpcResult<()> + '_ {
        move || Ok(fs::write(path, b"new")?)
    }

    /// A stand-in Recycle Bin: moves the file into a folder.
    fn bin(dir: &Path) -> impl Fn(&Path) -> io::Result<()> + '_ {
        move |path| {
            fs::create_dir_all(dir)?;
            fs::rename(path, dir.join(path.file_name().unwrap()))
        }
    }

    #[test]
    fn a_first_write_replaces_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("Page.pdf");
        let none = |_: &Path| Err(io::Error::other("unused"));
        let (receipt, backup) = replace_with(&file, &dir.path().join("b"), &none, write_new(&file)).unwrap();
        assert_eq!(receipt.kept, Kept::Nothing);
        assert!(backup.is_none());
        assert_eq!(fs::read(&file).unwrap(), b"new");
    }

    #[test]
    fn the_old_file_goes_to_the_bin_and_undo_brings_it_back() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("Page.pdf");
        fs::write(&file, b"old").unwrap();
        let bin_dir = dir.path().join("bin");
        let (receipt, backup) = replace_with(&file, &dir.path().join("b"), &bin(&bin_dir), write_new(&file)).unwrap();
        assert_eq!(receipt.kept, Kept::Recycled);
        assert_eq!(fs::read(bin_dir.join("Page.pdf")).unwrap(), b"old");
        assert_eq!(fs::read(&file).unwrap(), b"new");
        restore(&file, &backup.unwrap()).unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"old");
    }

    #[test]
    fn a_refused_bin_keeps_a_copy_beside_and_undo_moves_it_back() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("Page.pdf");
        fs::write(&file, b"old").unwrap();
        let refuse = |_: &Path| Err(io::Error::new(io::ErrorKind::Unsupported, "network"));
        let (receipt, backup) = replace_with(&file, &dir.path().join("b"), &refuse, write_new(&file)).unwrap();
        assert_eq!(receipt.kept, Kept::Beside);
        assert_eq!(receipt.kept_as.as_deref(), Some("Page (replaced).pdf"));
        assert_eq!(fs::read(dir.path().join("Page (replaced).pdf")).unwrap(), b"old");
        assert_eq!(fs::read(&file).unwrap(), b"new");
        restore(&file, &backup.unwrap()).unwrap();
        assert_eq!(fs::read(&file).unwrap(), b"old");
        assert!(!dir.path().join("Page (replaced).pdf").exists());
    }

    #[test]
    fn a_second_kept_copy_gets_its_own_name() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("Page.pdf");
        fs::write(dir.path().join("Page (replaced).pdf"), b"earlier").unwrap();
        assert_eq!(beside_name(&file), dir.path().join("Page (replaced 2).pdf"));
    }

    #[test]
    fn a_failed_write_puts_the_old_file_back() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("Page.pdf");
        fs::write(&file, b"old").unwrap();
        let bin_dir = dir.path().join("bin");
        let fail = || Err(IpcError::new(codes::INTERNAL, "disk full"));
        assert!(replace_with(&file, &dir.path().join("b"), &bin(&bin_dir), fail).is_err());
        assert_eq!(fs::read(&file).unwrap(), b"old");
        // The same with a refused bin: the old file stays and no stray copy is left.
        let refuse = |_: &Path| Err(io::Error::other("no"));
        assert!(replace_with(&file, &dir.path().join("b"), &refuse, fail).is_err());
        assert_eq!(fs::read(&file).unwrap(), b"old");
        assert!(!dir.path().join("Page (replaced).pdf").exists());
    }

    #[test]
    fn a_bin_that_leaves_the_file_counts_as_refused() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("Page.pdf");
        fs::write(&file, b"old").unwrap();
        let lazy = |_: &Path| Ok(());
        let (receipt, _) = replace_with(&file, &dir.path().join("b"), &lazy, write_new(&file)).unwrap();
        assert_eq!(receipt.kept, Kept::Beside);
    }
}
