//! `StdFs` on the real disk, on every platform (plan 13.1): each primitive, its errors, locks, identities, and
//! long paths.

mod common;

use std::path::{Path, PathBuf};
use std::time::Duration;

use opennote_core::store::fs::{Durability, Fs};
use opennote_core::store::layout::parse_temp_name;
use opennote_core::store::std_fs::StdFs;
use opennote_core::{FsErrorKind, Timings};

fn fs() -> StdFs {
    StdFs {
        busy_retries: vec![Duration::from_millis(1); 3],
    }
}

/// Names of temporary files left in a folder.
fn temp_files(dir: &Path) -> Vec<String> {
    std::fs::read_dir(dir)
        .unwrap()
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|name| parse_temp_name(name).is_some())
        .collect()
}

#[test]
fn new_takes_the_busy_retries_from_the_timings() {
    let timings = Timings::default();
    assert_eq!(StdFs::new(&timings).busy_retries, timings.busy_retries);
}

#[test]
fn replace_durable_writes_and_replaces_without_leftovers() {
    let dir = common::temp_dir();
    let fs = fs();
    let path = dir.path().join("page.json");
    let first = fs.replace_durable(&path, b"one").unwrap();
    assert_eq!(first.durability, Durability::Confirmed);
    assert_eq!(std::fs::read(&path).unwrap(), b"one");
    let second = fs.replace_durable(&path, b"two, longer").unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"two, longer");
    assert_eq!(second.stamp.len, 11);
    assert_ne!(first.stamp.file_id, second.stamp.file_id, "a replace makes a new file");
    assert_eq!(fs.metadata(&path).unwrap().stamp, second.stamp);
    assert!(temp_files(dir.path()).is_empty());
}

#[test]
fn create_durable_never_replaces_but_accepts_an_identical_retry() {
    let dir = common::temp_dir();
    let fs = fs();
    let path = dir.path().join("0001.onk");
    let made = fs.create_durable(&path, b"segment").unwrap();
    assert_eq!(made.durability, Durability::Confirmed);
    let again = fs.create_durable(&path, b"segment").unwrap();
    assert_eq!(again.stamp, made.stamp, "the retry reports the file that is there");
    let err = fs.create_durable(&path, b"different").unwrap_err();
    assert_eq!(err.kind, FsErrorKind::AlreadyExists);
    assert_eq!(err.path, path);
    let err = fs.create_durable(&path, b"segment and more").unwrap_err();
    assert_eq!(err.kind, FsErrorKind::AlreadyExists);
    assert_eq!(std::fs::read(&path).unwrap(), b"segment");
    assert!(temp_files(dir.path()).is_empty());
}

#[test]
fn write_derived_replaces_without_leftovers() {
    let dir = common::temp_dir();
    let fs = fs();
    let path = dir.path().join("page.md");
    fs.write_derived(&path, b"# One").unwrap();
    fs.write_derived(&path, b"# Two").unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"# Two");
    assert!(temp_files(dir.path()).is_empty());
}

#[test]
fn writes_into_a_missing_folder_fail_cleanly() {
    let dir = common::temp_dir();
    let fs = fs();
    let path = dir.path().join("missing").join("page.json");
    assert_eq!(fs.replace_durable(&path, b"x").unwrap_err().kind, FsErrorKind::NotFound);
    assert_eq!(fs.create_durable(&path, b"x").unwrap_err().kind, FsErrorKind::NotFound);
    assert_eq!(fs.write_derived(&path, b"x").unwrap_err().kind, FsErrorKind::NotFound);
}

#[test]
fn reads_whole_files_prefixes_and_ranges() {
    let dir = common::temp_dir();
    let fs = fs();
    let path = dir.path().join("data.bin");
    std::fs::write(&path, b"0123456789").unwrap();
    assert_eq!(fs.read(&path, 10).unwrap(), b"0123456789");
    let err = fs.read(&path, 9).unwrap_err();
    assert_eq!((err.kind, err.path), (FsErrorKind::TooLarge, path.clone()));
    assert_eq!(fs.read_prefix(&path, 4).unwrap(), b"0123");
    assert_eq!(fs.read_prefix(&path, 100).unwrap(), b"0123456789");
    assert_eq!(fs.read_range(&path, 2..5).unwrap(), b"234");
    assert_eq!(fs.read_range(&path, 8..100).unwrap(), b"89");
    assert_eq!(fs.read_range(&path, 20..30).unwrap(), b"");
    assert_eq!(fs.read_range(&path, 5..5).unwrap(), b"");
    let missing = dir.path().join("missing.bin");
    assert_eq!(fs.read(&missing, 10).unwrap_err().kind, FsErrorKind::NotFound);
    assert_eq!(fs.read_range(&missing, 0..0).unwrap_err().kind, FsErrorKind::NotFound);
    assert_eq!(fs.read_prefix(&missing, 1).unwrap_err().kind, FsErrorKind::NotFound);
}

#[test]
fn lists_folders_sorted_by_name() {
    let dir = common::temp_dir();
    let fs = fs();
    for name in ["b.json", "a.json", "C.txt"] {
        std::fs::write(dir.path().join(name), name).unwrap();
    }
    std::fs::create_dir(dir.path().join("ink")).unwrap();
    let entries = fs.read_dir(dir.path()).unwrap();
    let names: Vec<&str> = entries.iter().map(|e| e.name.as_str()).collect();
    assert_eq!(names, ["C.txt", "a.json", "b.json", "ink"]);
    let ink = entries.iter().find(|e| e.name == "ink").unwrap();
    assert!(ink.is_dir && ink.len == 0);
    let a = entries.iter().find(|e| e.name == "a.json").unwrap();
    assert!(!a.is_dir && a.len == 6);
    assert_eq!(
        fs.read_dir(&dir.path().join("nope")).unwrap_err().kind,
        FsErrorKind::NotFound
    );
}

#[test]
fn metadata_reports_files_folders_and_read_only() {
    let dir = common::temp_dir();
    let fs = fs();
    let path = dir.path().join("page.json");
    fs.replace_durable(&path, b"{}").unwrap();
    let meta = fs.metadata(&path).unwrap();
    assert!(!meta.is_dir && !meta.read_only && !meta.placeholder);
    assert_eq!(meta.stamp.len, 2);
    assert!(fs.metadata(dir.path()).unwrap().is_dir);
    let mut permissions = std::fs::metadata(&path).unwrap().permissions();
    permissions.set_readonly(true);
    std::fs::set_permissions(&path, permissions).unwrap();
    assert!(fs.metadata(&path).unwrap().read_only);
    fs.clear_read_only(&path).unwrap();
    assert!(!fs.metadata(&path).unwrap().read_only);
    assert_eq!(
        fs.metadata(&dir.path().join("x")).unwrap_err().kind,
        FsErrorKind::NotFound
    );
}

#[test]
fn creates_renames_and_removes_folders() {
    let dir = common::temp_dir();
    let fs = fs();
    let a = dir.path().join("a");
    assert_eq!(fs.create_dir_durable(&a).unwrap(), Durability::Confirmed);
    assert_eq!(fs.create_dir_durable(&a).unwrap_err().kind, FsErrorKind::AlreadyExists);
    let deep = dir.path().join("x").join("y");
    assert_eq!(fs.create_dir_durable(&deep).unwrap_err().kind, FsErrorKind::NotFound);
    fs.replace_durable(&a.join("page.json"), b"{}").unwrap();
    let b = dir.path().join("b");
    assert_eq!(fs.rename_dir(&a, &b).unwrap(), Durability::Confirmed);
    assert!(!a.exists() && b.join("page.json").exists());
    std::fs::create_dir(&a).unwrap();
    let err = fs.rename_dir(&b, &a).unwrap_err();
    assert_eq!(
        err.kind,
        FsErrorKind::AlreadyExists,
        "never replaces, even an empty folder"
    );
    assert!(b.join("page.json").exists());
    assert_eq!(
        fs.rename_dir(&dir.path().join("gone"), &dir.path().join("c"))
            .unwrap_err()
            .kind,
        FsErrorKind::NotFound
    );
    fs.remove_dir_all(&b).unwrap();
    assert!(!b.exists());
    fs.remove_file(&dir.path().join("none")).unwrap_err();
    std::fs::write(a.join("f"), b"x").unwrap();
    fs.remove_file(&a.join("f")).unwrap();
    assert!(!a.join("f").exists());
}

#[test]
fn identities_are_stable_and_survive_renames() {
    let dir = common::temp_dir();
    let fs = fs();
    let (a, b) = (dir.path().join("a"), dir.path().join("b"));
    fs.create_dir_durable(&a).unwrap();
    fs.create_dir_durable(&b).unwrap();
    let id_a = fs.folder_identity(&a).unwrap();
    assert_eq!(fs.folder_identity(&a).unwrap(), id_a);
    assert_ne!(fs.folder_identity(&b).unwrap(), id_a);
    let moved = dir.path().join("moved");
    fs.rename_dir(&a, &moved).unwrap();
    assert_eq!(fs.folder_identity(&moved).unwrap(), id_a);
    let boot = fs.boot_id().unwrap();
    assert!(!boot.is_empty());
    assert_eq!(fs.boot_id().unwrap(), boot);
}

#[test]
fn reports_a_local_volume() {
    let dir = common::temp_dir();
    let volume = fs().volume(dir.path()).unwrap();
    assert!(!volume.remote);
    assert_eq!(volume.sync_root, None);
    let probe = fs().probe(dir.path()).unwrap();
    assert!(probe.flush_folder.is_ok());
    assert_eq!(probe.volume, volume);
}

#[test]
fn appends_hold_a_lock_that_blocks_other_writers_but_not_readers() {
    let dir = common::temp_dir();
    let fs = fs();
    let path = dir.path().join("journal.onj");
    assert_eq!(fs.open_append(&path, false).err().unwrap().kind, FsErrorKind::NotFound);
    let mut file = fs.open_append(&path, true).unwrap();
    assert!(file.is_empty());
    file.append(b"record one;").unwrap();
    file.append(b"two").unwrap();
    file.sync().unwrap();
    assert_eq!(file.len(), 14);
    assert_eq!(
        fs.read(&path, 100).unwrap(),
        b"record one;two",
        "reads work while the lock is held"
    );
    assert_eq!(fs.open_append(&path, false).err().unwrap().kind, FsErrorKind::Busy);
    assert!(
        fs.try_lock(&path).unwrap().is_none(),
        "recovery sees that the owner is alive"
    );
    assert_eq!(
        fs.open_append(&path, true).err().unwrap().kind,
        FsErrorKind::AlreadyExists
    );
    drop(file);
    let lock = fs.try_lock(&path).unwrap().expect("free once the writer is gone");
    assert_eq!(
        fs.read(&path, 100).unwrap(),
        b"record one;two",
        "reads work under the recovery lock too"
    );
    drop(lock);
    let mut again = fs.open_append(&path, false).unwrap();
    assert_eq!(again.len(), 14);
    again.append(b"!").unwrap();
    drop(again);
    assert_eq!(std::fs::read(&path).unwrap(), b"record one;two!");
}

#[test]
fn locks_are_exclusive_and_released_on_drop() {
    let dir = common::temp_dir();
    let fs = fs();
    let path = dir.path().join("notebook.lock");
    let lock = fs.try_lock(&path).unwrap().expect("a new lock");
    assert!(path.exists());
    assert!(fs.try_lock(&path).unwrap().is_none());
    drop(lock);
    assert!(fs.try_lock(&path).unwrap().is_some());
}

#[test]
fn relative_paths_work() {
    let dir = tempfile::tempdir_in(".").unwrap();
    let name = dir.path().file_name().unwrap();
    let fs = fs();
    let path = PathBuf::from(name).join("page.json");
    fs.replace_durable(&path, b"rel").unwrap();
    assert_eq!(fs.read(&path, 10).unwrap(), b"rel");
    assert_eq!(fs.read_dir(Path::new(name)).unwrap().len(), 1);
}

#[test]
fn long_paths_work_everywhere() {
    let dir = common::temp_dir();
    let fs = fs();
    let mut deep = dir.path().to_path_buf();
    while deep.as_os_str().len() < 300 {
        deep.push("a-folder-name-long-enough-to-matter");
        fs.create_dir_durable(&deep).unwrap();
    }
    let file = deep.join("page.json");
    fs.replace_durable(&file, b"deep").unwrap();
    fs.create_durable(&deep.join("seg.onk"), b"s").unwrap();
    fs.write_derived(&deep.join("page.md"), b"m").unwrap();
    assert_eq!(fs.read(&file, 10).unwrap(), b"deep");
    assert_eq!(fs.read_dir(&deep).unwrap().len(), 3);
    assert_eq!(fs.metadata(&file).unwrap().stamp.len, 4);
    let renamed = deep.with_file_name("renamed-folder-with-a-long-name-too");
    fs.rename_dir(&deep, &renamed).unwrap();
    let mut journal = fs.open_append(&renamed.join("j.onj"), true).unwrap();
    journal.append(b"x").unwrap();
    journal.sync().unwrap();
    drop(journal);
    fs.remove_file(&renamed.join("page.md")).unwrap();
    fs.remove_dir_all(&renamed).unwrap();
    assert!(fs.metadata(&renamed).is_err());
}
