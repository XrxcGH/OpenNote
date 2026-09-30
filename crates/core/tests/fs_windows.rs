//! `StdFs` behaviors that only Windows has (plan 13.1): replacing a file another handle holds, with and without
//! delete sharing, read-only targets, folders with open files, and renames by handle. Tests that need FAT32,
//! exFAT, a network share, or a small full disk run when an environment variable names a folder there.

#![cfg(windows)]

mod common;

use std::fs::{File, OpenOptions};
use std::io::Read;
use std::os::windows::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use opennote_core::store::fs::{Durability, Fs, VolumeKind};
use opennote_core::store::std_fs::{RenameMethod, StdFs};
use opennote_core::FsErrorKind;

const SHARE_READ: u32 = 1;
const SHARE_WRITE: u32 = 2;
const SHARE_DELETE: u32 = 4;

fn fs() -> StdFs {
    StdFs {
        busy_retries: vec![Duration::from_millis(1); 3],
    }
}

/// Opens a file the way a scanner or sync client might.
fn hold(path: &Path, share: u32) -> File {
    OpenOptions::new().read(true).share_mode(share).open(path).unwrap()
}

/// A folder named by an environment variable, for tests that need special volumes.
fn env_dir(var: &str) -> Option<PathBuf> {
    let dir = PathBuf::from(std::env::var_os(var)?);
    let sub = dir.join(format!("opennote-test-{}", std::process::id()));
    std::fs::create_dir_all(&sub).ok()?;
    Some(sub)
}

#[test]
fn replaces_a_file_held_with_delete_sharing_and_the_holder_keeps_the_old_bytes() {
    let dir = common::temp_dir();
    let path = dir.path().join("page.json");
    std::fs::write(&path, b"old").unwrap();
    let mut holder = hold(&path, SHARE_READ | SHARE_WRITE | SHARE_DELETE);
    let committed = fs().replace_durable(&path, b"new").unwrap();
    assert_eq!(committed.durability, Durability::Confirmed);
    let mut seen = Vec::new();
    holder.read_to_end(&mut seen).unwrap();
    assert_eq!(seen, b"old", "POSIX semantics let the holder keep reading the old file");
    assert_eq!(std::fs::read(&path).unwrap(), b"new");
}

#[test]
fn a_file_held_without_delete_sharing_is_busy_then_blocked() {
    let dir = common::temp_dir();
    let path = dir.path().join("page.json");
    std::fs::write(&path, b"old").unwrap();
    let holder = hold(&path, SHARE_READ | SHARE_WRITE);
    let err = fs().replace_durable(&path, b"new").unwrap_err();
    assert!(matches!(err.kind, FsErrorKind::Busy | FsErrorKind::Blocked), "{err}");
    assert_eq!(err.path, path);
    assert!(err.os_code.is_some());
    assert_eq!(fs().remove_file(&path).unwrap_err().kind, err.kind);
    drop(holder);
    assert_eq!(std::fs::read(&path).unwrap(), b"old");
    let leftovers = std::fs::read_dir(dir.path()).unwrap().count();
    assert_eq!(leftovers, 1, "the temporary file is deleted after a failure");
}

#[test]
fn the_busy_retries_outlast_a_short_hold() {
    let dir = common::temp_dir();
    let path = dir.path().join("page.json");
    std::fs::write(&path, b"old").unwrap();
    let holder = hold(&path, SHARE_READ | SHARE_WRITE);
    let release = std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(30));
        drop(holder);
    });
    let patient = StdFs {
        busy_retries: vec![Duration::from_millis(20); 10],
    };
    patient.replace_durable(&path, b"new").unwrap();
    release.join().unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"new");
}

#[test]
fn read_only_targets_are_reported_and_not_retried() {
    let dir = common::temp_dir();
    let path = dir.path().join("page.json");
    std::fs::write(&path, b"old").unwrap();
    let mut permissions = std::fs::metadata(&path).unwrap().permissions();
    permissions.set_readonly(true);
    std::fs::set_permissions(&path, permissions).unwrap();
    let slow = StdFs {
        busy_retries: vec![Duration::from_secs(5)],
    };
    let started = std::time::Instant::now();
    assert_eq!(
        slow.replace_durable(&path, b"new").unwrap_err().kind,
        FsErrorKind::ReadOnlyFile
    );
    assert_eq!(slow.remove_file(&path).unwrap_err().kind, FsErrorKind::ReadOnlyFile);
    assert_eq!(
        slow.open_append(&path, false).err().unwrap().kind,
        FsErrorKind::ReadOnlyFile
    );
    assert!(
        started.elapsed() < Duration::from_secs(4),
        "read-only files are not retried"
    );
    slow.clear_read_only(&path).unwrap();
    slow.replace_durable(&path, b"new").unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"new");
}

#[test]
fn a_folder_with_an_open_file_inside_cannot_be_renamed() {
    let dir = common::temp_dir();
    let page = dir.path().join("page-a");
    std::fs::create_dir(&page).unwrap();
    std::fs::write(page.join("page.json"), b"{}").unwrap();
    for share in [SHARE_READ | SHARE_WRITE, SHARE_READ | SHARE_WRITE | SHARE_DELETE] {
        let holder = hold(&page.join("page.json"), share);
        let err = fs().rename_dir(&page, &dir.path().join("page-b")).unwrap_err();
        assert!(matches!(err.kind, FsErrorKind::Busy | FsErrorKind::Blocked), "{err}");
        drop(holder);
    }
    fs().rename_dir(&page, &dir.path().join("page-b")).unwrap();
}

#[test]
fn renames_by_handle_with_posix_semantics_on_ntfs() {
    let dir = common::temp_dir();
    let probe = fs().probe(dir.path()).unwrap();
    if probe.volume.kind == VolumeKind::Ntfs {
        assert_eq!(probe.method, RenameMethod::PosixByHandle);
        assert!(probe.flush_folder.is_ok());
        assert!(!probe.volume.remote);
    }
}

#[test]
fn verbatim_and_forward_slash_paths_both_work() {
    let dir = common::temp_dir();
    let fs = fs();
    let slashed = PathBuf::from(dir.path().to_string_lossy().replace('\\', "/")).join("a.json");
    fs.replace_durable(&slashed, b"x").unwrap();
    let verbatim = PathBuf::from(format!(r"\\?\{}", dir.path().display())).join("a.json");
    assert_eq!(fs.read(&verbatim, 10).unwrap(), b"x");
}

/// `OPENNOTE_TEST_FAT_DIR`: a folder on FAT32 or exFAT, where renames also flush the folder.
#[test]
fn fat_volumes_flush_folders_and_confirm() {
    let Some(dir) = env_dir("OPENNOTE_TEST_FAT_DIR") else {
        eprintln!("skipped: OPENNOTE_TEST_FAT_DIR is not set");
        return;
    };
    let fs = fs();
    let volume = fs.volume(&dir).unwrap();
    assert!(matches!(
        volume.kind,
        VolumeKind::Fat32 | VolumeKind::ExFat | VolumeKind::Fat
    ));
    let committed = fs.replace_durable(&dir.join("page.json"), b"fat").unwrap();
    assert_eq!(committed.durability, Durability::Confirmed);
    assert_eq!(fs.create_dir_durable(&dir.join("sub")).unwrap(), Durability::Confirmed);
    fs.remove_dir_all(&dir).unwrap();
}

/// `OPENNOTE_TEST_SHARE_DIR`: a folder on a network share, where nothing is confirmed (spec 17.5).
#[test]
fn network_shares_are_never_confirmed() {
    let Some(dir) = env_dir("OPENNOTE_TEST_SHARE_DIR") else {
        eprintln!("skipped: OPENNOTE_TEST_SHARE_DIR is not set");
        return;
    };
    let fs = fs();
    assert!(fs.volume(&dir).unwrap().remote);
    let committed = fs.replace_durable(&dir.join("page.json"), b"remote").unwrap();
    assert_eq!(committed.durability, Durability::Unconfirmed);
    assert_eq!(fs.read(&dir.join("page.json"), 10).unwrap(), b"remote");
    fs.remove_dir_all(&dir).unwrap();
}

/// `OPENNOTE_TEST_FULL_DIR`: a folder on a small volume that the test fills up.
#[test]
fn a_full_disk_is_reported_and_leaves_no_temporary_file() {
    let Some(dir) = env_dir("OPENNOTE_TEST_FULL_DIR") else {
        eprintln!("skipped: OPENNOTE_TEST_FULL_DIR is not set");
        return;
    };
    let fs = fs();
    let chunk = vec![7u8; 16 << 20];
    let mut kind = None;
    for i in 0..10_000 {
        if let Err(err) = fs.create_durable(&dir.join(format!("fill-{i}.bin")), &chunk) {
            kind = Some(err.kind);
            break;
        }
    }
    assert_eq!(kind, Some(FsErrorKind::DiskFull));
    let temps = std::fs::read_dir(&dir)
        .unwrap()
        .filter(|e| e.as_ref().unwrap().file_name().to_string_lossy().ends_with(".tmp"))
        .count();
    assert_eq!(temps, 0);
    fs.remove_dir_all(&dir).unwrap();
}
