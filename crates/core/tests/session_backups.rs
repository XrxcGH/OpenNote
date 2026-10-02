//! Scheduled backups through the public API: sets of changed files, a read-only way to open them, and the
//! sync-tool notice (docs/FEATURES.md, Phase 3).

mod real_core;

use std::time::Duration;

use opennote_core::id::{BlockId, Id};
use opennote_core::model::ReadOnlyReason;
use opennote_core::ops::resolve::{Edit, NewBlock};
use opennote_core::session::notebook::{NodePlacement, ParentRef};
use opennote_core::store::backup::BackupPolicy;
use real_core::Real;
use serde_json::json;

fn add_text(real: &mut Real, n: u128, markdown: &str) {
    let block = NewBlock {
        id: BlockId(Id::from_parts(1_800_000_000_000, n)),
        type_name: "text".into(),
        frame: None,
        data: json!({"markdown": markdown}).as_object().cloned().unwrap(),
        fallback: None,
    };
    let edit = Edit::InsertBlock {
        block,
        after: None,
        before: None,
    };
    real.open().apply(real.request(vec![edit])).unwrap();
}

#[test]
fn a_backup_copies_what_is_on_screen_and_then_only_what_changed() {
    let mut real = Real::new();
    add_text(&mut real, 1, "First");
    let dest = real.dir.path().join("backups");
    let policy = BackupPolicy::default();
    assert!(real.core.last_backup(real.notebook.path(), &dest).is_none());

    let first = real.notebook.backup_to(&dest, &policy, 0).unwrap();
    assert!(first.copied_files > 3, "the page was saved first and copied: {first:?}");
    assert!(real.core.last_backup(real.notebook.path(), &dest).is_some());
    let again = real.notebook.backup_to(&dest, &policy, 0).unwrap();
    assert_eq!((again.copied_files, again.removed_files), (0, 0), "nothing changed");

    real.clock.advance(Duration::from_secs(5));
    add_text(&mut real, 2, "Second");
    let third = real.notebook.backup_to(&dest, &policy, 0).unwrap();
    assert!(third.copied_files >= 1, "the saved page was copied again: {third:?}");
    assert_eq!(first.set, third.set, "runs on one day share a set");
}

#[test]
fn a_backup_inside_the_notebook_is_refused() {
    let real = Real::new();
    let inside = real.notebook.path().join("backups");
    let error = real
        .notebook
        .backup_to(&inside, &BackupPolicy::default(), 0)
        .unwrap_err();
    assert!(error.to_string().contains("inside"), "{error}");
}

#[test]
fn backups_run_when_due() {
    let real = Real::new();
    let dest = real.dir.path().join("backups");
    let (every, policy) = (Duration::from_secs(3_600), BackupPolicy::default());
    assert!(real.notebook.backup_if_due(&dest, every, &policy, 0).unwrap().is_some());
    assert!(real.notebook.backup_if_due(&dest, every, &policy, 0).unwrap().is_none());
    real.clock.advance(every);
    assert!(real.notebook.backup_if_due(&dest, every, &policy, 0).unwrap().is_some());
}

#[test]
fn a_backup_opens_read_only_and_leaves_the_original_alone() {
    let mut real = Real::new();
    add_text(&mut real, 1, "First");
    let dest = real.dir.path().join("backups");
    let report = real.notebook.backup_to(&dest, &BackupPolicy::default(), 0).unwrap();

    let backup = real.core.open_notebook(&report.set).unwrap();
    assert!(backup.is_backup());
    let top = NodePlacement {
        parent: ParentRef::Notebook,
        before: None,
    };
    assert!(backup.create_section("New", top).is_err(), "a backup can't be changed");
    let section = backup.tree().sections[0].id;
    let page = backup.flat_pages(section).unwrap()[0].id;
    let handle = backup.open_page(page, real.client.clone()).unwrap();
    assert!(handle.read_only().is_some());
    let edit = Edit::SetPage {
        title: Some("Changed".into()),
        tags: None,
        view: None,
    };
    let request = opennote_core::ops::resolve::TxnRequest {
        page,
        client: real.client.clone(),
        client_seq: 1,
        coalesce: None,
        ui: None,
        edits: vec![edit],
    };
    assert_eq!(handle.apply(request).unwrap_err().code(), "readOnly");
    assert!(matches!(handle.read_only(), Some(ReadOnlyReason::Backup)));

    // The original is not taken for a copy, and stays writable while the backup is open.
    let original = real.core.find_open(real.notebook.path()).unwrap();
    assert!(!original.is_backup());
    assert!(original.create_section("Still works", top).is_ok());
}

#[test]
fn sync_folders_are_named() {
    let real = Real::new();
    assert!(real.core.sync_notice(real.dir.path()).is_none());
    assert!(real.notebook.sync_notice().is_none());
    for (folder, name) in [
        ("Dropbox", "Dropbox"),
        ("iCloudDrive", "iCloud Drive"),
        ("Google Drive", "Google Drive"),
    ] {
        let inside = real.dir.path().join(folder).join("Notes");
        std::fs::create_dir_all(&inside).unwrap();
        let notice = real.core.sync_notice(&inside).unwrap();
        assert_eq!(notice.name, name);
        assert!(notice.files_on_demand);
    }
}
