//! What deleting for good touches beyond the core's own folders (A2-4, A4-3): the pages inside a Trash item, so
//! their search entries and transcripts can be forgotten, and the Recycle Bin for a notebook's folder. OpenNote never
//! deletes a notebook folder outright. Delete folder moves it to the Recycle Bin, and Windows warns before a drive
//! without one would delete it for good.

use std::path::{Path, PathBuf};

use opennote_core::PageId;

use super::NOTEBOOK_FILE;
use crate::ipc::{IpcError, IpcResult};

/// How deep a page folder can sit inside a Trash item or a notebook: groups, a section, and nested pages.
const MAX_DEPTH: usize = 12;

/// The pages under `dir`: each folder named by a page ID that holds a `page.json`. Links are not followed.
pub fn pages_under(dir: &Path) -> Vec<PageId> {
    let mut pages = Vec::new();
    let mut pending: Vec<(PathBuf, usize)> = vec![(dir.to_path_buf(), 0)];
    while let Some((folder, depth)) = pending.pop() {
        let Ok(entries) = std::fs::read_dir(&folder) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            if !kind.is_dir() || kind.is_symlink() {
                continue;
            }
            let path = entry.path();
            let name = entry.file_name();
            if let Some(page) = name.to_str().and_then(|name| PageId::parse(name).ok()) {
                if path.join("page.json").is_file() {
                    pages.push(page);
                }
            }
            if depth < MAX_DEPTH {
                pending.push((path, depth + 1));
            }
        }
    }
    pages.sort_unstable_by_key(ToString::to_string);
    pages.dedup();
    pages
}

/// Checks that `path` is a notebook folder that may go to the Recycle Bin: absolute, local, with its
/// `notebook.json`. A network folder has no Recycle Bin, so it is refused and File Explorer can delete it.
pub fn check_recyclable(path: &Path) -> IpcResult<()> {
    let text = path.to_string_lossy();
    if !path.is_absolute() || text.starts_with(r"\\") || text.starts_with("//") {
        return Err(IpcError::new(
            "unavailable",
            "Only a folder on this PC can go to the Recycle Bin.",
        ));
    }
    if !path.join(NOTEBOOK_FILE).is_file() {
        return Err(IpcError::new("not-found", "That folder isn't a notebook."));
    }
    Ok(())
}

/// Moves a notebook's folder to the Recycle Bin.
pub fn recycle(path: &Path) -> IpcResult<()> {
    check_recyclable(path)?;
    recycle_folder(path)
}

#[cfg(windows)]
fn recycle_folder(path: &Path) -> IpcResult<()> {
    use std::os::windows::ffi::OsStrExt;

    use windows::{
        core::PCWSTR,
        Win32::UI::Shell::{
            SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT, FOF_WANTNUKEWARNING,
            FO_DELETE, SHFILEOPSTRUCTW,
        },
    };

    // The list of paths ends with two zeros.
    let mut from: Vec<u16> = path.as_os_str().encode_wide().collect();
    from.extend([0, 0]);
    let flags = FOF_ALLOWUNDO.0 | FOF_NOCONFIRMATION.0 | FOF_SILENT.0 | FOF_NOERRORUI.0 | FOF_WANTNUKEWARNING.0;
    let mut operation = SHFILEOPSTRUCTW {
        wFunc: FO_DELETE,
        pFrom: PCWSTR(from.as_ptr()),
        fFlags: u16::try_from(flags).unwrap_or(u16::MAX),
        ..Default::default()
    };
    // SAFETY: `operation` points at `from`, a list of one path ending with two zeros, which outlives the call.
    let result = unsafe { SHFileOperationW(&mut operation) };
    if result != 0 || operation.fAnyOperationsAborted.as_bool() || path.exists() {
        ::log::warn!("The notebook folder didn't go to the Recycle Bin (code {result})");
        return Err(IpcError::new("io", "The folder couldn't go to the Recycle Bin."));
    }
    Ok(())
}

#[cfg(not(windows))]
fn recycle_folder(_path: &Path) -> IpcResult<()> {
    Err(IpcError::new("unavailable", "Delete the folder in your file manager."))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_pages_inside_a_folder_at_any_depth() {
        let dir = tempfile::tempdir().expect("a temp folder");
        let page = "01m3sa12426sg32pmtyffjaqcf";
        let nested = "01m3sa8yf8bryf28a7sjgb7mmc";
        let section = dir.path().join("01m3s9q9xbpmxwz4cz4ht6twg9");
        std::fs::create_dir_all(section.join(page).join(nested)).expect("folders");
        std::fs::write(section.join(page).join("page.json"), b"{}").expect("a page");
        std::fs::write(section.join(page).join(nested).join("page.json"), b"{}").expect("a page");
        // A folder named like a page without a page.json is not a page.
        std::fs::create_dir_all(dir.path().join("01m3sa43z1tp9rdr5e8df2jbxy")).expect("a folder");
        let found: Vec<String> = pages_under(dir.path()).iter().map(ToString::to_string).collect();
        assert_eq!(found, [page, nested]);
        assert!(pages_under(&dir.path().join("missing")).is_empty());
    }

    #[test]
    fn only_a_local_notebook_folder_can_go_to_the_recycle_bin() {
        let dir = tempfile::tempdir().expect("a temp folder");
        assert!(check_recyclable(dir.path()).is_err(), "no notebook.json");
        std::fs::write(dir.path().join(NOTEBOOK_FILE), b"{}").expect("a notebook file");
        assert!(check_recyclable(dir.path()).is_ok());
        assert!(check_recyclable(Path::new(r"\\server\share\Notes")).is_err());
        assert!(check_recyclable(Path::new("Notes")).is_err());
    }
}
