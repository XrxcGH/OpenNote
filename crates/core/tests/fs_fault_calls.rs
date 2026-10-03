//! `FaultFs` faults, hostile readers, locks, and errors (plan 6 and 14.3). Injected faults fail matching calls
//! until they clear. Holds block what measurement M6 found they block. Each primitive reports the errors that
//! `StdFs` reports.

use std::path::PathBuf;

use opennote_core::store::fs::Fs;
use opennote_core::testing::fault_fs::{DurabilityModel, FaultFs, FaultRule};
use opennote_core::FsErrorKind;

fn p(path: &str) -> PathBuf {
    PathBuf::from(path)
}

fn setup(model: DurabilityModel) -> FaultFs {
    let fs = FaultFs::new(model);
    fs.mkdir_all(&p("/nb/a"));
    fs.mkdir_all(&p("/nb/b"));
    fs
}

fn temps(fs: &FaultFs) -> usize {
    fs.files()
        .iter()
        .filter(|f| f.file_name().unwrap().to_string_lossy().ends_with(".tmp"))
        .count()
}

#[test]
fn faults_fail_matching_calls_until_they_clear() {
    let fs = setup(DurabilityModel::Ntfs);
    fs.put(&p("/nb/a/page.json"), b"old");
    let busy = FaultRule {
        pattern: "a/page.json".into(),
        kind: FsErrorKind::Busy,
        times: Some(2),
    };
    fs.inject(busy);
    for _ in 0..2 {
        assert_eq!(
            fs.replace_durable(&p("/nb/a/page.json"), b"x").unwrap_err().kind,
            FsErrorKind::Busy
        );
    }
    fs.replace_durable(&p("/nb/a/page.json"), b"x").unwrap();
    fs.inject(FaultRule {
        pattern: "/nb/b".into(),
        kind: FsErrorKind::DiskFull,
        times: None,
    });
    fs.put(&p("/nb/b/seg.onk"), b"s");
    assert_eq!(
        fs.read(&p("/nb/b/seg.onk"), 10).unwrap(),
        b"s",
        "a full disk still reads"
    );
    for _ in 0..3 {
        let err = fs.create_durable(&p("/nb/b/new.onk"), b"n").unwrap_err();
        assert_eq!(err.kind, FsErrorKind::DiskFull);
    }
    assert_eq!(temps(&fs), 0);
    fs.inject(FaultRule {
        pattern: "seg.onk".into(),
        kind: FsErrorKind::CloudPlaceholder,
        times: None,
    });
    assert_eq!(
        fs.read(&p("/nb/b/seg.onk"), 10).unwrap_err().kind,
        FsErrorKind::CloudPlaceholder
    );
    fs.metadata(&p("/nb/b/seg.onk")).unwrap();
}

#[test]
fn hostile_readers_block_replaces_deletes_and_folder_renames() {
    let fs = setup(DurabilityModel::Ntfs);
    let page = p("/nb/a/page.json");
    fs.put(&page, b"old");
    fs.hold_open(&page, false, 3);
    assert_eq!(fs.replace_durable(&page, b"new").unwrap_err().kind, FsErrorKind::Busy);
    assert_eq!(fs.remove_file(&page).unwrap_err().kind, FsErrorKind::Busy);
    assert_eq!(fs.remove_dir_all(&p("/nb/a")).unwrap_err().kind, FsErrorKind::Busy);
    fs.replace_durable(&page, b"new").unwrap();
    fs.hold_open(&page, true, 10);
    fs.replace_durable(&page, b"newer").unwrap();
    let err = fs.rename_dir(&p("/nb/a"), &p("/nb/moved")).unwrap_err();
    assert_eq!(
        err.kind,
        FsErrorKind::Busy,
        "a folder with an open file can't be renamed"
    );
    fs.remove_dir_all(&p("/nb/a")).unwrap();
    assert!(!fs.exists(&p("/nb/a")));
}

#[test]
fn holds_follow_each_models_sharing_rules() {
    for (model, replace, delete_folder) in [
        (DurabilityModel::Fat, true, true),
        (DurabilityModel::Network, true, true),
        (DurabilityModel::Ext4, false, false),
    ] {
        let fs = setup(model);
        let page = p("/nb/a/page.json");
        fs.put(&page, b"old");
        fs.hold_open(&page, true, 100);
        let busy = |result: Result<(), opennote_core::FsError>| result.is_err_and(|e| e.kind == FsErrorKind::Busy);
        assert_eq!(
            busy(fs.replace_durable(&page, b"new").map(|_| ())),
            replace,
            "{model:?}: replace"
        );
        assert_eq!(
            busy(fs.rename_dir(&p("/nb/a"), &p("/nb/c")).map(|_| ())),
            model != DurabilityModel::Ext4
        );
        assert_eq!(
            busy(fs.remove_dir_all(&p("/nb/a"))),
            delete_folder,
            "{model:?}: delete the folder"
        );
    }
}

#[test]
fn locks_and_appends_are_exclusive() {
    let fs = setup(DurabilityModel::Ext4);
    let path = p("/nb/j.onj");
    assert_eq!(fs.open_append(&path, false).err().unwrap().kind, FsErrorKind::NotFound);
    let mut file = fs.open_append(&path, true).unwrap();
    file.append(b"abc").unwrap();
    assert_eq!(file.len(), 3);
    assert_eq!(fs.open_append(&path, false).err().unwrap().kind, FsErrorKind::Busy);
    assert!(fs.try_lock(&path).unwrap().is_none());
    assert_eq!(fs.remove_file(&path).unwrap_err().kind, FsErrorKind::Busy);
    assert_eq!(fs.read(&path, 10).unwrap(), b"abc");
    drop(file);
    let lock = fs.try_lock(&path).unwrap().unwrap();
    assert!(fs.try_lock(&path).unwrap().is_none());
    drop(lock);
    let lock = fs.try_lock(&p("/nb/new.lock")).unwrap();
    assert!(lock.is_some() && fs.exists(&p("/nb/new.lock")));
    let after = fs.reboot();
    assert!(
        after.try_lock(&p("/nb/new.lock")).unwrap().is_some(),
        "a crash releases locks"
    );
}

#[test]
fn primitives_report_errors_like_std_fs() {
    let fs = setup(DurabilityModel::Ntfs);
    let seg = p("/nb/a/seg.onk");
    fs.create_durable(&seg, b"s").unwrap();
    let again = fs.create_durable(&seg, b"s").unwrap();
    assert_eq!(again.stamp.len, 1);
    assert_eq!(
        fs.create_durable(&seg, b"t").unwrap_err().kind,
        FsErrorKind::AlreadyExists
    );
    assert_eq!(
        fs.replace_durable(&p("/nb/x/y"), b"t").unwrap_err().kind,
        FsErrorKind::NotFound
    );
    fs.set_read_only(&seg, true);
    assert!(fs.metadata(&seg).unwrap().read_only);
    assert_eq!(
        fs.replace_durable(&seg, b"t").unwrap_err().kind,
        FsErrorKind::ReadOnlyFile
    );
    fs.clear_read_only(&seg).unwrap();
    assert_eq!(fs.read(&seg, 0).unwrap_err().kind, FsErrorKind::TooLarge);
    assert_eq!(fs.read_range(&seg, 0..10).unwrap(), b"s");
    assert_eq!(fs.read_prefix(&seg, 0).unwrap(), b"");
    fs.set_placeholder(&seg, true);
    assert_eq!(fs.read(&seg, 9).unwrap_err().kind, FsErrorKind::CloudPlaceholder);
    assert_eq!(
        fs.create_dir_durable(&p("/nb/a")).unwrap_err().kind,
        FsErrorKind::AlreadyExists
    );
    fs.rename_dir(&p("/nb/a"), &p("/nb/c")).unwrap();
    assert_eq!(
        fs.rename_dir(&p("/nb/c"), &p("/nb/b")).unwrap_err().kind,
        FsErrorKind::AlreadyExists
    );
    assert_eq!(
        fs.rename_dir(&p("/nb/c"), &p("/nb/c/d")).unwrap_err().kind,
        FsErrorKind::NotFound
    );
    let names: Vec<String> = fs.read_dir(&p("/nb")).unwrap().into_iter().map(|e| e.name).collect();
    assert_eq!(names, ["b", "c"]);
}
