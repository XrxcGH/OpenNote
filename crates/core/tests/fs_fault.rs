//! `FaultFs` loses exactly what each durability model allows (plan 6 and 14.3), and its faults, holds, locks,
//! call log, and sync tool behave as documented.

mod common;

use std::collections::BTreeSet;
use std::path::PathBuf;

use opennote_core::store::fs::{Durability, Fs};
use opennote_core::testing::fault_fs::{CrashKind, DurabilityModel, FaultFs, FaultRule};
use opennote_core::FsErrorKind;

const MODELS: [DurabilityModel; 4] = [
    DurabilityModel::Ntfs,
    DurabilityModel::Ext4,
    DurabilityModel::Fat,
    DurabilityModel::Network,
];

fn p(path: &str) -> PathBuf {
    PathBuf::from(path)
}

fn setup(model: DurabilityModel) -> FaultFs {
    let fs = FaultFs::new(model);
    fs.mkdir_all(&p("/nb/a"));
    fs.mkdir_all(&p("/nb/b"));
    fs
}

/// Cuts the power after the calls made so far, on a copy, and returns what the next start sees.
fn power_cut(fs: &FaultFs, seed: u64) -> FaultFs {
    let copy = fs.fork();
    copy.crash_at_call(copy.calls(), CrashKind::PowerCut { seed });
    copy.reboot()
}

fn temps(fs: &FaultFs) -> usize {
    fs.files()
        .iter()
        .filter(|f| f.file_name().unwrap().to_string_lossy().ends_with(".tmp"))
        .count()
}

#[test]
fn an_app_crash_keeps_every_volatile_change() {
    for model in MODELS {
        let fs = setup(model);
        fs.put(&p("/nb/a/gone.txt"), b"x");
        fs.write_derived(&p("/nb/a/page.md"), b"derived").unwrap();
        fs.remove_file(&p("/nb/a/gone.txt")).unwrap();
        fs.create_dir_durable(&p("/nb/c")).unwrap();
        let mut journal = fs.open_append(&p("/nb/j.onj"), true).unwrap();
        journal.append(b"unsynced").unwrap();
        fs.crash_at_call(fs.calls(), CrashKind::App);
        let after = fs.reboot();
        assert_eq!(after.get(&p("/nb/a/page.md")).unwrap(), b"derived");
        assert!(!after.exists(&p("/nb/a/gone.txt")) && after.exists(&p("/nb/c")));
        assert_eq!(after.get(&p("/nb/j.onj")).unwrap(), b"unsynced");
        assert_eq!(
            after.boot_id().unwrap(),
            "fault-boot-1",
            "{model:?}: the system didn't restart"
        );
        assert_eq!(journal.append(b"late").unwrap_err().kind, FsErrorKind::Crashed);
    }
}

#[test]
fn a_finished_durable_write_survives_every_power_cut() {
    for model in MODELS {
        for seed in 0..40 {
            let fs = setup(model);
            fs.put(&p("/nb/a/page.json"), b"old");
            let replaced = fs.replace_durable(&p("/nb/a/page.json"), b"new").unwrap();
            let created = fs.create_durable(&p("/nb/a/seg.onk"), b"segment").unwrap();
            let expected = if model == DurabilityModel::Network {
                Durability::Unconfirmed
            } else {
                Durability::Confirmed
            };
            assert_eq!((replaced.durability, created.durability), (expected, expected));
            let after = power_cut(&fs, seed);
            assert_eq!(after.get(&p("/nb/a/page.json")).unwrap(), b"new", "{model:?} {seed}");
            assert_eq!(after.get(&p("/nb/a/seg.onk")).unwrap(), b"segment", "{model:?} {seed}");
            assert_eq!(after.boot_id().unwrap(), "fault-boot-2");
        }
    }
}

#[test]
fn a_power_cut_during_a_replace_leaves_the_old_or_the_new_file_whole() {
    for model in MODELS {
        let mut seen = BTreeSet::new();
        let mut temp_left = false;
        for seed in 0..300 {
            let fs = setup(model);
            fs.put(&p("/nb/a/page.json"), b"old");
            fs.crash_at_call(0, CrashKind::PowerCut { seed });
            let err = fs.replace_durable(&p("/nb/a/page.json"), b"new").unwrap_err();
            assert_eq!(err.kind, FsErrorKind::Crashed);
            let after = fs.reboot();
            let bytes = after.get(&p("/nb/a/page.json")).unwrap();
            assert!(bytes == b"old" || bytes == b"new", "{model:?} {seed}: {bytes:?}");
            seen.insert(bytes);
            temp_left |= temps(&after) > 0;
        }
        assert_eq!(seen.len(), 2, "{model:?}: both outcomes happen");
        assert!(temp_left, "{model:?}: a crash can leave a temporary file");
    }
}

#[test]
fn unflushed_data_is_lost_cut_or_padded() {
    let new = b"0123456789abcdefghijklmnopqrstuvwxyz".to_vec();
    let mut kinds = BTreeSet::new();
    for seed in 0..400 {
        let fs = setup(DurabilityModel::Ntfs);
        fs.put(&p("/nb/a/page.md"), b"old");
        fs.write_derived(&p("/nb/a/page.md"), &new).unwrap();
        let after = power_cut(&fs, seed);
        let bytes = after.get(&p("/nb/a/page.md")).unwrap();
        let kind = if bytes == b"old" {
            "rename lost"
        } else if bytes.len() < new.len() {
            assert!(new.starts_with(&bytes), "{seed}: a prefix");
            if bytes.is_empty() {
                "data lost"
            } else {
                "cut"
            }
        } else if bytes == new {
            "whole"
        } else {
            let cut = bytes.iter().zip(&new).take_while(|(a, b)| a == b).count();
            if bytes[cut..].iter().all(|&b| b == 0) {
                "zero padded"
            } else {
                "random padded"
            }
        };
        kinds.insert(kind);
    }
    let all = [
        "cut",
        "data lost",
        "random padded",
        "rename lost",
        "whole",
        "zero padded",
    ];
    assert_eq!(kinds.into_iter().collect::<Vec<_>>(), all);
}

#[test]
fn appends_survive_up_to_the_last_sync() {
    for model in MODELS {
        let mut outcomes = BTreeSet::new();
        for seed in 0..100 {
            let fs = setup(model);
            let mut journal = fs.open_append(&p("/nb/j.onj"), true).unwrap();
            journal.append(b"synced;").unwrap();
            journal.sync().unwrap();
            journal.append(b"volatile").unwrap();
            let after = power_cut(&fs, seed);
            let bytes = after.get(&p("/nb/j.onj")).expect("the synced file survives");
            assert!(bytes.starts_with(b"synced;"), "{model:?} {seed}");
            assert!(bytes.len() <= 15);
            outcomes.insert(bytes.len() == 7);
        }
        assert_eq!(
            outcomes.len(),
            2,
            "{model:?}: the tail is sometimes lost and sometimes kept"
        );
    }
}

#[test]
fn ntfs_commits_earlier_changes_with_any_flush_and_ext4_needs_the_folder() {
    let fs = setup(DurabilityModel::Ntfs);
    fs.create_dir_durable(&p("/nb/c")).unwrap();
    fs.put(&p("/nb/a/x"), b"x");
    fs.remove_file(&p("/nb/a/x")).unwrap();
    assert_eq!(fs.volatile_changes(), 2);
    fs.replace_durable(&p("/nb/b/other.json"), b"flush").unwrap();
    assert_eq!(fs.volatile_changes(), 0, "one flush commits the whole log before it");
    for seed in 0..20 {
        let after = power_cut(&fs, seed);
        assert!(after.exists(&p("/nb/c")) && !after.exists(&p("/nb/a/x")));
    }

    let fs = setup(DurabilityModel::Ext4);
    fs.create_dir_durable(&p("/nb/c")).unwrap();
    assert_eq!(fs.volatile_changes(), 0, "ext4 flushes the parent folder");
    fs.put(&p("/nb/a/x"), b"x");
    fs.remove_file(&p("/nb/a/x")).unwrap();
    fs.replace_durable(&p("/nb/b/other.json"), b"other folder").unwrap();
    assert_eq!(fs.volatile_changes(), 1, "a flush of another folder doesn't help");
    let came_back = (0..40)
        .filter(|&seed| power_cut(&fs, seed).exists(&p("/nb/a/x")))
        .count();
    assert!(came_back > 0 && came_back < 40);
    fs.replace_durable(&p("/nb/a/same.json"), b"same folder").unwrap();
    assert_eq!(fs.volatile_changes(), 0);
    assert!((0..20).all(|seed| !power_cut(&fs, seed).exists(&p("/nb/a/x"))));
}

#[test]
fn network_shares_on_their_own_volume_are_never_confirmed() {
    let fs = setup(DurabilityModel::Ntfs);
    fs.add_volume(&p("/share"), DurabilityModel::Network);
    fs.mkdir_all(&p("/share/nb"));
    let remote = fs.replace_durable(&p("/share/nb/page.json"), b"x").unwrap();
    let local = fs.replace_durable(&p("/nb/a/page.json"), b"x").unwrap();
    assert_eq!(
        (remote.durability, local.durability),
        (Durability::Unconfirmed, Durability::Confirmed)
    );
    assert_eq!(
        fs.create_dir_durable(&p("/share/nb/s")).unwrap(),
        Durability::Unconfirmed
    );
    assert!(fs.volume(&p("/share/nb")).unwrap().remote && !fs.volume(&p("/nb")).unwrap().remote);
    let err = fs.rename_dir(&p("/share/nb/s"), &p("/nb/s")).unwrap_err();
    assert_eq!(err.kind, FsErrorKind::Unsupported);
    assert_ne!(
        fs.folder_identity(&p("/share/nb")).unwrap(),
        fs.folder_identity(&p("/nb")).unwrap()
    );
}

#[test]
fn every_call_counts_and_a_crash_stops_them_all() {
    let fs = setup(DurabilityModel::Ntfs);
    fs.put(&p("/nb/a/page.json"), b"old");
    fs.read(&p("/nb/a/page.json"), 10).unwrap();
    fs.read(&p("/nb/a/missing"), 10).unwrap_err();
    fs.metadata(&p("/nb/a")).unwrap();
    assert_eq!(fs.calls(), 3, "failed calls count too");
    let ops: Vec<&str> = fs.log().iter().map(|c| c.op).collect();
    assert_eq!(ops, ["read", "read", "metadata"]);
    assert_eq!(fs.log()[1].index, 1);
    fs.crash_at_call(4, CrashKind::App);
    fs.read_dir(&p("/nb")).unwrap();
    let err = fs.replace_durable(&p("/nb/a/page.json"), b"new").unwrap_err();
    assert_eq!(err.kind, FsErrorKind::Crashed);
    assert!(fs.crashed());
    assert_eq!(
        fs.read(&p("/nb/a/page.json"), 10).unwrap_err().kind,
        FsErrorKind::Crashed
    );
    assert_eq!(fs.calls(), 4);
    let after = fs.reboot();
    assert_eq!(
        after.get(&p("/nb/a/page.json")).unwrap(),
        b"old",
        "an app crash stops before the call"
    );
    assert_eq!((after.calls(), after.log().len(), after.crashed()), (0, 0, false));
}

#[test]
fn a_crash_no_call_reaches_happens_at_reboot() {
    let fs = setup(DurabilityModel::Ntfs);
    fs.crash_at_call(100, CrashKind::PowerCut { seed: 3 });
    fs.write_derived(&p("/nb/a/page.md"), b"volatile").unwrap();
    let after = fs.reboot();
    assert!(fs.crashed());
    assert_eq!(after.boot_id().unwrap(), "fault-boot-2", "the power cut happened");
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
