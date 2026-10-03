//! The sync tool of `FaultFs` (plan 13.4): conflict copies with each tool's names, out-of-order delivery, old
//! folders coming back, and a write between two of the app's calls.

use std::path::PathBuf;

use opennote_core::store::fs::Fs;
use opennote_core::testing::fault_fs::{CrashKind, DurabilityModel, FaultFs};

fn p(path: &str) -> PathBuf {
    PathBuf::from(path)
}

fn setup(model: DurabilityModel) -> FaultFs {
    let fs = FaultFs::new(model);
    fs.mkdir_all(&p("/nb/a"));
    fs.mkdir_all(&p("/nb/b"));
    fs
}

fn power_cut(fs: &FaultFs, seed: u64) -> FaultFs {
    let copy = fs.fork();
    copy.crash_at_call(copy.calls(), CrashKind::PowerCut { seed });
    copy.reboot()
}

#[test]
fn sync_tool_copies_withholds_and_brings_back() {
    use opennote_core::testing::fault_fs::{ConflictStyle, SyncAction};
    let fs = setup(DurabilityModel::Ntfs);
    let sync = fs.sync_tool();
    let names: Vec<String> = ConflictStyle::ALL.iter().map(|s| s.name_for("page.json")).collect();
    assert_eq!(
        names,
        [
            "page (Sam's conflicted copy 2026-09-30).json",
            "page-LAPTOP.json",
            "page.sync-conflict-20260930-140312-ABCDEFG.json",
            "page (conflicted copy 2026-09-30 140312).json",
            "page 2.json",
            "page (1).json",
        ]
    );
    let page = p("/nb/a/page.json");
    let copy = sync.conflict_copy(&page, ConflictStyle::OneDrive, b"theirs");
    assert_eq!(copy, p("/nb/a/page-LAPTOP.json"));
    assert_eq!(fs.get(&copy).unwrap(), b"theirs");
    sync.write(&p("/nb/a/ink/1.onk"), b"seg");
    sync.withhold(&p("/nb/a/ink/1.onk"));
    assert!(!fs.exists(&p("/nb/a/ink/1.onk")));
    assert_eq!(sync.deliver(), 1);
    assert_eq!(fs.get(&p("/nb/a/ink/1.onk")).unwrap(), b"seg");
    let snapshot = sync.snapshot(&p("/nb/a"));
    fs.remove_dir_all(&p("/nb/a")).unwrap();
    sync.bring_back(&snapshot);
    assert_eq!(fs.get(&p("/nb/a/ink/1.onk")).unwrap(), b"seg");
    assert_eq!(fs.calls(), 1, "the sync tool's changes aren't the app's calls");

    fs.put(&page, b"R");
    let check = fs.calls();
    sync.before_call(
        check + 1,
        SyncAction::Write {
            path: page.clone(),
            bytes: b"theirs".to_vec(),
        },
    );
    assert_eq!(fs.read(&page, 10).unwrap(), b"R", "the fingerprint check sees R");
    fs.replace_durable(&page, b"R'").unwrap();
    assert_eq!(
        fs.get(&page).unwrap(),
        b"R'",
        "the write between the check and the replace is replaced"
    );
}

#[test]
fn outside_changes_are_durable_at_once() {
    let fs = setup(DurabilityModel::Ext4);
    fs.sync_tool().write(&p("/nb/a/page.json"), b"from elsewhere");
    let durable = fs.durable_files();
    assert!(durable.contains(&(p("/nb/a/page.json"), b"from elsewhere".to_vec())));
    assert!((0..10).all(|seed| power_cut(&fs, seed).get(&p("/nb/a/page.json")).is_some()));
}
