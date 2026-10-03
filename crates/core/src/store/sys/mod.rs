//! Platform code behind `StdFs` (spec 17.3 and 17.4). Owned by WP2.
//!
//! The only modules allowed to use `unsafe`, and every `unsafe` block has a `// SAFETY:` comment. Both
//! platforms offer the same functions, re-exported as `platform`, so `StdFs` has no platform code of its own.

use std::path::{Component, Path};
use std::time::Duration;

use crate::error::{FsError, FsErrorKind};
use crate::store::fs::{SyncTool, VolumeKind};

#[cfg(unix)]
pub(crate) mod unix;
#[cfg(windows)]
pub(crate) mod windows;

#[cfg(unix)]
pub(crate) use unix as platform;
#[cfg(windows)]
pub(crate) use windows as platform;

/// How a write treats the target (spec 17.2).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum CommitMode {
    /// `replace_durable`: flushes, and replaces an existing target.
    Replace,
    /// `create_durable`: flushes, and fails if the target exists.
    Create,
    /// `write_derived`: replaces an existing target, without flushes.
    Derived,
}

impl CommitMode {
    /// Whether the write flushes.
    pub(crate) fn durable(self) -> bool {
        self != CommitMode::Derived
    }

    /// Whether the rename replaces an existing target.
    pub(crate) fn replaces(self) -> bool {
        self != CommitMode::Create
    }
}

/// What a failed call was doing, which decides how its error is classified (spec 17.6).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum FsOp {
    /// Opening or reading a file or folder.
    Read,
    /// Creating a temporary file or a folder. Access denied here is `Blocked` at once.
    Create,
    /// Writing or flushing.
    Write,
    /// Renaming.
    Rename,
    /// Deleting.
    Remove,
}

/// How a durable write's rename was done. Only a rename by handle can be confirmed on Windows (spec 17.5).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RenameMethod {
    /// Windows: `FileRenameInfoEx` with POSIX semantics, by handle.
    PosixByHandle,
    /// Windows: `FileRenameInfo`, by handle, for file systems without POSIX semantics.
    ByHandle,
    /// Windows: the `MoveFileExW` fallback, which is never confirmed.
    MoveFile,
    /// Unix: `rename`, `renameat2`, or `renamex_np`.
    Rename,
    /// Unix: `link` and `unlink`, where an atomic create without replace isn't available.
    Link,
}

/// Runs `attempt`, and again after each wait while it fails with `Busy` (spec 17.6).
pub(crate) fn with_retries<T>(
    retries: &[Duration],
    mut attempt: impl FnMut() -> Result<T, FsError>,
) -> Result<T, FsError> {
    let mut waits = retries.iter();
    loop {
        match attempt() {
            Err(err) if err.kind == FsErrorKind::Busy => match waits.next() {
                Some(wait) => std::thread::sleep(*wait),
                None => return Err(err),
            },
            other => return other,
        }
    }
}

/// Whether `target` is a page's `page.json`, whose save steps have their own crash points.
fn is_page_json(target: &Path) -> bool {
    target.file_name().is_some_and(|name| name == "page.json")
}

/// The crash points after the temporary file is flushed, before the rename.
pub(crate) fn temp_flushed(target: &Path) {
    crate::fail_point!("fs.tmp_flushed");
    if is_page_json(target) {
        crate::fail_point!("save.page.tmp_flushed");
    }
}

/// The crash points after the rename, before its flush.
pub(crate) fn renamed(target: &Path) {
    crate::fail_point!("fs.renamed");
    if is_page_json(target) {
        crate::fail_point!("save.page.renamed");
    }
}

/// The volume kind for a file system's name, as Windows or macOS reports it.
// Linux names file systems by number instead.
#[cfg_attr(not(any(windows, target_vendor = "apple")), allow(dead_code))]
pub(crate) fn kind_from_name(name: &str) -> VolumeKind {
    match name.to_ascii_lowercase().as_str() {
        "ntfs" => VolumeKind::Ntfs,
        "refs" => VolumeKind::Refs,
        "fat32" => VolumeKind::Fat32,
        "exfat" => VolumeKind::ExFat,
        "fat" | "fat12" | "fat16" | "msdos" => VolumeKind::Fat,
        "apfs" => VolumeKind::Apfs,
        "ext4" => VolumeKind::Ext4,
        _ => VolumeKind::Other(name.into()),
    }
}

/// Whether a volume kind keeps no metadata log, so a rename needs a flush of its folder too (spec 17.5).
// Unix flushes the folder after every rename, whatever the file system.
#[cfg_attr(not(windows), allow(dead_code))]
pub(crate) fn is_fat(kind: &VolumeKind) -> bool {
    matches!(kind, VolumeKind::Fat32 | VolumeKind::ExFat | VolumeKind::Fat)
}

/// The sync tool that manages `path`, judged by the folders it is in and by OneDrive's environment variables.
pub(crate) fn sync_root(path: &Path) -> Option<SyncTool> {
    let under_onedrive_var = ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"]
        .iter()
        .filter_map(std::env::var_os)
        .any(|root| !root.is_empty() && path.starts_with(&root));
    if under_onedrive_var {
        return Some(SyncTool::OneDrive);
    }
    path.components().find_map(|component| match component {
        Component::Normal(name) => tool_for_folder(&name.to_string_lossy()),
        _ => None,
    })
}

/// The sync tool that a folder with this name belongs to, by the names the tools give their folders.
fn tool_for_folder(name: &str) -> Option<SyncTool> {
    let lower = name.to_ascii_lowercase();
    if lower == "onedrive" || lower.starts_with("onedrive - ") || lower.starts_with("onedrive-") {
        Some(SyncTool::OneDrive)
    } else if lower == "dropbox" || lower.starts_with("dropbox (") {
        Some(SyncTool::Dropbox)
    } else if lower == "google drive" || lower == "my drive" || lower.starts_with("googledrive-") {
        Some(SyncTool::GoogleDrive)
    } else if lower == "iclouddrive" || lower == "icloud drive" || lower == "mobile documents" {
        Some(SyncTool::ICloud)
    } else if ["nextcloud", "owncloud", "pcloud drive", "box", "syncthing"].contains(&lower.as_str()) {
        Some(SyncTool::Other)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::path::PathBuf;

    #[test]
    fn retries_busy_errors_only() {
        let waits = [Duration::ZERO; 3];
        let tries = Cell::new(0u32);
        let busy = || {
            tries.set(tries.get().saturating_add(1));
            Err::<(), _>(FsError::new(FsErrorKind::Busy, "x"))
        };
        assert_eq!(with_retries(&waits, busy).map_err(|e| e.kind), Err(FsErrorKind::Busy));
        assert_eq!(tries.get(), 4);
        tries.set(0);
        let full = || {
            tries.set(tries.get().saturating_add(1));
            Err::<(), _>(FsError::new(FsErrorKind::DiskFull, "x"))
        };
        assert_eq!(
            with_retries(&waits, full).map_err(|e| e.kind),
            Err(FsErrorKind::DiskFull)
        );
        assert_eq!(tries.get(), 1);
        tries.set(0);
        let later = || {
            tries.set(tries.get().saturating_add(1));
            if tries.get() < 3 {
                Err(FsError::new(FsErrorKind::Busy, "x"))
            } else {
                Ok(7)
            }
        };
        assert_eq!(with_retries(&waits, later), Ok(7));
    }

    #[test]
    fn names_volume_kinds() {
        assert_eq!(kind_from_name("NTFS"), VolumeKind::Ntfs);
        assert_eq!(kind_from_name("exFAT"), VolumeKind::ExFat);
        assert_eq!(kind_from_name("FAT32"), VolumeKind::Fat32);
        assert_eq!(kind_from_name("msdos"), VolumeKind::Fat);
        assert_eq!(kind_from_name("apfs"), VolumeKind::Apfs);
        assert_eq!(kind_from_name("zfs"), VolumeKind::Other("zfs".into()));
        assert!(is_fat(&VolumeKind::ExFat) && is_fat(&VolumeKind::Fat32) && is_fat(&VolumeKind::Fat));
        assert!(!is_fat(&VolumeKind::Ntfs) && !is_fat(&VolumeKind::Ext4));
    }

    #[test]
    fn finds_sync_tools_by_folder_name() {
        let tool = |p: &str| sync_root(&PathBuf::from(p));
        assert_eq!(tool("/home/sam/Dropbox/Notes"), Some(SyncTool::Dropbox));
        assert_eq!(
            tool("/Users/sam/Library/CloudStorage/OneDrive-Contoso/Notes"),
            Some(SyncTool::OneDrive)
        );
        assert_eq!(
            tool("/Users/sam/Library/Mobile Documents/com~apple~CloudDocs"),
            Some(SyncTool::ICloud)
        );
        assert_eq!(
            tool("/Volumes/GoogleDrive-123/My Drive/Notes"),
            Some(SyncTool::GoogleDrive)
        );
        assert_eq!(tool("/home/sam/Nextcloud/Notes"), Some(SyncTool::Other));
        assert_eq!(tool("/home/sam/Documents/Notes"), None);
    }

    #[test]
    fn modes_say_what_they_do() {
        assert!(CommitMode::Replace.durable() && CommitMode::Replace.replaces());
        assert!(CommitMode::Create.durable() && !CommitMode::Create.replaces());
        assert!(!CommitMode::Derived.durable() && CommitMode::Derived.replaces());
        assert!(is_page_json(Path::new("a/page.json")) && !is_page_json(Path::new("a/page.md")));
        temp_flushed(Path::new("a/page.json"));
        renamed(Path::new("a/page.json"));
    }
}
