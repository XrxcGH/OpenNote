use std::cell::RefCell;
use std::sync::Arc;

use opennote_core::model::Warning;
use opennote_core::session::core::{Core, CoreConfig};
use opennote_core::session::notebook::{NodePlacement, ParentRef};
use opennote_core::testing::fakes::NullSink;
use opennote_crashreport::{Kind, Report, FORMAT};
use opennote_updater::state::{PendingRecord, RolledBackRecord, StagedRecord};

use super::*;
use crate::disk::{FixedDisk, SystemDisk};

const NOW: u64 = 1_790_000_000;
const GIB: u64 = 1024 * MIB;

/// A notebook folder with a made-up check result.
struct Fake {
    dir: PathBuf,
    report: RefCell<Result<VerifyReport, CoreError>>,
    unsaved: bool,
}

impl NotebookProbe for Fake {
    fn path(&self) -> &Path {
        &self.dir
    }

    fn verify(&self) -> Result<VerifyReport, CoreError> {
        match &*self.report.borrow() {
            Ok(report) => Ok(report.clone()),
            Err(_) => Err(CoreError::NotFound("a page".to_owned())),
        }
    }

    fn has_unsaved(&self) -> bool {
        self.unsaved
    }
}

fn fake(dir: &Path, problems: &[(&str, &'static str)], unsaved: bool) -> Fake {
    Fake {
        dir: dir.to_path_buf(),
        report: RefCell::new(Ok(VerifyReport {
            files: 40,
            problems: problems
                .iter()
                .map(|(file, code)| {
                    (
                        dir.join(file),
                        Warning::new(code, "detail with C:\\Users\\jdoe\\secret"),
                    )
                })
                .collect(),
        })),
        unsaved,
    }
}

fn run_with(notebook: Option<&dyn NotebookProbe>, free: u64, app: &Path, updates: Option<&Path>) -> SelfCheck {
    run(
        &Inputs {
            now_unix: NOW,
            app_data_dir: app,
            updates_dir: updates,
            notebook,
            crash_store: None,
        },
        &FixedDisk(free),
    )
}

fn status(check: &SelfCheck, id: CheckId) -> Status {
    check.item(id).unwrap().status
}

#[test]
fn a_healthy_setup_passes_everywhere_it_looks() {
    let dir = tempfile::tempdir().unwrap();
    let book = fake(dir.path(), &[], false);
    let check = run_with(Some(&book), 20 * GIB, dir.path(), None);
    for id in [
        CheckId::DiskNotebook,
        CheckId::DiskApp,
        CheckId::NotebookWritable,
        CheckId::NotebookHealth,
    ] {
        assert_eq!(status(&check, id), Status::Pass, "{id:?}");
    }
    assert_eq!(status(&check, CheckId::Updates), Status::Skipped);
    assert_eq!(status(&check, CheckId::CrashReports), Status::Skipped);
    assert_eq!(check.overall(), Status::Pass);
    assert_eq!(check.items.len(), 7);
    assert_eq!(check.created_unix, NOW);
}

#[test]
fn free_space_warns_and_fails_at_the_documented_limits() {
    let dir = tempfile::tempdir().unwrap();
    let book = fake(dir.path(), &[], false);
    let at = |free| run_with(Some(&book), free, dir.path(), None);
    assert_eq!(status(&at(NOTEBOOK_WARN_BELOW), CheckId::DiskNotebook), Status::Pass);
    assert_eq!(
        status(&at(NOTEBOOK_WARN_BELOW - 1), CheckId::DiskNotebook),
        Status::Warn
    );
    assert_eq!(status(&at(NOTEBOOK_FAIL_BELOW), CheckId::DiskNotebook), Status::Warn);
    assert_eq!(
        status(&at(NOTEBOOK_FAIL_BELOW - 1), CheckId::DiskNotebook),
        Status::Fail
    );
    assert_eq!(status(&at(APP_WARN_BELOW), CheckId::DiskApp), Status::Pass);
    assert_eq!(status(&at(APP_WARN_BELOW - 1), CheckId::DiskApp), Status::Warn);
    assert_eq!(status(&at(APP_FAIL_BELOW - 1), CheckId::DiskApp), Status::Fail);
    assert_eq!(at(0).overall(), Status::Fail);
    match &at(123).item(CheckId::DiskNotebook).unwrap().detail {
        Detail::FreeSpace {
            free_bytes,
            warn_below,
            fail_below,
        } => assert_eq!(
            (*free_bytes, *warn_below, *fail_below),
            (123, NOTEBOOK_WARN_BELOW, NOTEBOOK_FAIL_BELOW)
        ),
        other => panic!("{other:?}"),
    }
}

#[test]
fn without_a_notebook_only_the_app_checks_run() {
    let dir = tempfile::tempdir().unwrap();
    let check = run_with(None, 20 * GIB, dir.path(), None);
    for id in [
        CheckId::DiskNotebook,
        CheckId::NotebookWritable,
        CheckId::NotebookStorage,
        CheckId::NotebookHealth,
    ] {
        assert_eq!(status(&check, id), Status::Skipped, "{id:?}");
    }
    assert_eq!(status(&check, CheckId::DiskApp), Status::Pass);
    assert_eq!(check.overall(), Status::Pass);
    assert_eq!(
        SelfCheck {
            created_unix: 0,
            items: Vec::new()
        }
        .overall(),
        Status::Skipped
    );
}

#[test]
fn a_disk_that_cannot_be_asked_warns_with_the_kind_of_error_only() {
    struct Broken;
    impl DiskProbe for Broken {
        fn free_bytes(&self, _path: &Path) -> io::Result<u64> {
            Err(io::Error::new(io::ErrorKind::PermissionDenied, r"C:\Users\jdoe\secret"))
        }
    }
    let dir = tempfile::tempdir().unwrap();
    let check = run(
        &Inputs {
            now_unix: NOW,
            app_data_dir: dir.path(),
            updates_dir: None,
            notebook: None,
            crash_store: None,
        },
        &Broken,
    );
    let item = check.item(CheckId::DiskApp).unwrap();
    assert_eq!(item.status, Status::Warn);
    assert_eq!(
        item.detail,
        Detail::Unavailable {
            reason: "PermissionDenied".into()
        }
    );
    assert!(!serde_json::to_string(&check).unwrap().contains("jdoe"));
}

#[test]
fn a_notebook_folder_that_cannot_be_written_fails() {
    let dir = tempfile::tempdir().unwrap();
    let missing = fake(&dir.path().join("not-here"), &[], false);
    let check = run_with(Some(&missing), 20 * GIB, dir.path(), None);
    let item = check.item(CheckId::NotebookWritable).unwrap();
    assert_eq!(item.status, Status::Fail);
    assert_eq!(
        item.detail,
        Detail::Writable {
            writable: false,
            reason: Some("NotFound".into())
        }
    );
    assert_eq!(check.overall(), Status::Fail);
    // The probe file is removed again, and nothing else is left in a folder that can be written.
    let book = fake(dir.path(), &[], false);
    let ok = run_with(Some(&book), 20 * GIB, dir.path(), None);
    assert_eq!(
        ok.item(CheckId::NotebookWritable).unwrap().detail,
        Detail::Writable {
            writable: true,
            reason: None
        }
    );
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
}

#[test]
fn problems_are_grouped_by_code_and_listed_with_their_relative_files() {
    let dir = tempfile::tempdir().unwrap();
    let book = fake(
        dir.path(),
        &[
            ("Lectures/Mitosis/page.json", "page.checksum"),
            ("Lectures/Meiosis/page.json", "page.checksum"),
            ("Lectures/section.json", "section.reference"),
        ],
        false,
    );
    let check = run_with(Some(&book), 20 * GIB, dir.path(), None);
    let item = check.item(CheckId::NotebookHealth).unwrap();
    assert_eq!(item.status, Status::Fail);
    let Detail::Health {
        files,
        problem_count,
        by_code,
        problems,
        failed,
        ..
    } = &item.detail
    else {
        panic!("{:?}", item.detail)
    };
    assert_eq!((*files, *problem_count, failed.as_deref()), (40, 3, None));
    assert_eq!(
        by_code,
        &[
            CodeCount {
                code: "page.checksum".into(),
                count: 2
            },
            CodeCount {
                code: "section.reference".into(),
                count: 1
            },
        ]
    );
    assert_eq!(
        problems[0],
        Problem {
            code: "page.checksum".into(),
            file: "Lectures/Mitosis/page.json".into()
        }
    );
    // The details of a warning can hold paths, so they are never copied.
    assert!(!serde_json::to_string(&check).unwrap().contains("jdoe"));
}

#[test]
fn only_the_first_problems_are_listed_but_all_are_counted() {
    let dir = tempfile::tempdir().unwrap();
    let many: Vec<(String, &'static str)> = (0..50).map(|n| (format!("p{n}/page.json"), "page.checksum")).collect();
    let refs: Vec<(&str, &'static str)> = many.iter().map(|(f, c)| (f.as_str(), *c)).collect();
    let book = fake(dir.path(), &refs, false);
    let check = run_with(Some(&book), 20 * GIB, dir.path(), None);
    let Detail::Health {
        problem_count,
        problems,
        ..
    } = &check.item(CheckId::NotebookHealth).unwrap().detail
    else {
        panic!()
    };
    assert_eq!((*problem_count, problems.len()), (50, MAX_LISTED_PROBLEMS));
}

#[test]
fn unsaved_changes_warn_and_a_failed_check_fails_without_its_message() {
    let dir = tempfile::tempdir().unwrap();
    let unsaved = fake(dir.path(), &[], true);
    let check = run_with(Some(&unsaved), 20 * GIB, dir.path(), None);
    assert_eq!(status(&check, CheckId::NotebookHealth), Status::Warn);
    let broken = fake(dir.path(), &[], false);
    *broken.report.borrow_mut() = Err(CoreError::NotFound("x".into()));
    let check = run_with(Some(&broken), 20 * GIB, dir.path(), None);
    let item = check.item(CheckId::NotebookHealth).unwrap();
    assert_eq!(item.status, Status::Fail);
    let Detail::Health { failed, .. } = &item.detail else {
        panic!()
    };
    assert_eq!(failed.as_deref(), Some("notFound"));
}

#[test]
fn redacting_drops_the_files_and_keeps_the_codes() {
    let dir = tempfile::tempdir().unwrap();
    let book = fake(dir.path(), &[("Private Section/page.json", "page.checksum")], false);
    let check = run_with(Some(&book), 20 * GIB, dir.path(), None);
    assert!(serde_json::to_string(&check).unwrap().contains("Private Section"));
    let shared = check.redacted();
    let json = serde_json::to_string(&shared).unwrap();
    assert!(!json.contains("Private Section"), "{json}");
    assert!(json.contains("page.checksum"));
    assert_eq!(shared.overall(), check.overall());
}

fn state_in(dir: &Path, change: impl FnOnce(&mut UpdaterState)) {
    let mut state = UpdaterState::default();
    change(&mut state);
    state.save(dir).unwrap();
}

fn updates_of(dir: &Path) -> CheckItem {
    let app = tempfile::tempdir().unwrap();
    run_with(None, 20 * GIB, app.path(), Some(dir))
        .item(CheckId::Updates)
        .unwrap()
        .clone()
}

#[test]
fn an_updater_that_has_never_run_passes() {
    let dir = tempfile::tempdir().unwrap();
    let item = updates_of(&dir.path().join("updates"));
    assert_eq!(item.status, Status::Pass);
    let Detail::Updates {
        last_check,
        days_since_check,
        staged_version,
        ..
    } = item.detail
    else {
        panic!()
    };
    assert_eq!((last_check, days_since_check, staged_version), (None, None, None));
}

#[test]
fn a_recent_check_with_an_update_waiting_passes() {
    let dir = tempfile::tempdir().unwrap();
    state_in(dir.path(), |state| {
        state.last_check = Some("2026-09-20T10:00:00Z".to_owned());
        state.staged = Some(StagedRecord {
            version: "0.5.0".into(),
            platform: "windows-x86_64".into(),
            file: "OpenNote_Windows64.exe".into(),
            path: r"C:\Users\jdoe\AppData\updates\x.exe".into(),
            sha256: "ab".into(),
            size: 0,
            signature: String::new(),
            notes: String::new(),
            unknown: Default::default(),
        });
    });
    let item = updates_of(dir.path());
    assert_eq!(item.status, Status::Pass);
    let Detail::Updates {
        days_since_check,
        staged_version,
        ..
    } = &item.detail
    else {
        panic!()
    };
    // 2026-09-20T10:00:00Z is 1,789,898,400 seconds; NOW is 1,790,000,000, a little over a day later.
    assert_eq!((*days_since_check, staged_version.as_deref()), (Some(1), Some("0.5.0")));
    assert!(
        !serde_json::to_string(&item).unwrap().contains("jdoe"),
        "paths from the file are never copied"
    );
}

#[test]
fn a_rollback_a_stuck_version_or_an_old_check_warns() {
    let dir = tempfile::tempdir().unwrap();
    state_in(dir.path(), |state| {
        state.rolled_back = Some(RolledBackRecord {
            from: "0.5.0".into(),
            to: "0.4.0".into(),
            at: "2026-09-20T10:00:00Z".into(),
            unknown: Default::default(),
        });
    });
    let item = updates_of(dir.path());
    assert_eq!(item.status, Status::Warn);
    let Detail::Updates { rolled_back, .. } = item.detail else {
        panic!()
    };
    assert_eq!(rolled_back.unwrap().to, "0.4.0");

    state_in(dir.path(), |state| {
        state.pending = Some(PendingRecord {
            version: "0.5.0".into(),
            from: "0.4.0".into(),
            attempts: 1,
            unknown: Default::default(),
        });
    });
    assert_eq!(
        updates_of(dir.path()).status,
        Status::Pass,
        "the first start of a new version is normal"
    );
    state_in(dir.path(), |state| {
        state.pending = Some(PendingRecord {
            version: "0.5.0".into(),
            from: "0.4.0".into(),
            attempts: 2,
            unknown: Default::default(),
        });
    });
    assert_eq!(updates_of(dir.path()).status, Status::Warn);

    state_in(dir.path(), |state| {
        state.last_check = Some("2026-09-01T00:00:00Z".to_owned())
    });
    let item = updates_of(dir.path());
    assert_eq!(item.status, Status::Warn);
    let Detail::Updates { days_since_check, .. } = item.detail else {
        panic!()
    };
    assert_eq!(days_since_check, Some(20));
}

#[test]
fn saved_crash_reports_are_counted() {
    let dir = tempfile::tempdir().unwrap();
    let store = CrashStore::new(dir.path().join("crashes"));
    let report = Report {
        format: FORMAT,
        kind: Kind::Panic,
        app_version: "1.0.0".into(),
        os: "Windows".into(),
        time_unix: 5,
        message: None,
        location: None,
        exception_code: None,
        frames: Vec::new(),
        backtrace: Vec::new(),
    };
    store.save(&report).unwrap();
    store.save(&Report { time_unix: 6, ..report }).unwrap();
    let check = run(
        &Inputs {
            now_unix: NOW,
            app_data_dir: dir.path(),
            updates_dir: None,
            notebook: None,
            crash_store: Some(&store),
        },
        &FixedDisk(20 * GIB),
    );
    assert_eq!(
        check.item(CheckId::CrashReports).unwrap().detail,
        Detail::Reports { count: 2 }
    );
}

#[test]
fn the_result_is_the_json_the_interface_reads() {
    let dir = tempfile::tempdir().unwrap();
    let book = fake(dir.path(), &[("a/page.json", "page.checksum")], true);
    let check = run_with(Some(&book), 100 * MIB, dir.path(), None);
    let json = serde_json::to_value(&check).unwrap();
    assert_eq!(json["createdUnix"], NOW);
    assert_eq!(json["items"][0]["id"], "diskNotebook");
    assert_eq!(json["items"][0]["status"], "warn");
    assert_eq!(json["items"][0]["detail"]["kind"], "freeSpace");
    assert_eq!(json["items"][0]["detail"]["freeBytes"], 100 * MIB);
    let health = &json["items"][4];
    assert_eq!(health["id"], "notebookHealth");
    assert_eq!(health["detail"]["kind"], "health");
    assert_eq!(health["detail"]["problemCount"], 1);
    assert_eq!(health["detail"]["unsavedChanges"], true);
    assert_eq!(serde_json::from_value::<SelfCheck>(json).unwrap(), check);
}

/// The real storage core: a notebook it made is clean, and a damaged section file is found by its own check.
#[test]
fn the_storage_cores_own_check_runs_on_a_real_notebook() {
    let dir = tempfile::tempdir().unwrap();
    let config = CoreConfig::production(dir.path().join("data"), "0.0.0-test".to_owned()).unwrap();
    let core = Core::start(config, Arc::new(NullSink), None).unwrap();
    let parent = dir.path().join("notebooks");
    std::fs::create_dir_all(&parent).unwrap();
    let notebook = core.create_notebook(&parent, "Biology 101").unwrap();
    let top = NodePlacement {
        parent: ParentRef::Notebook,
        before: None,
    };
    notebook.create_section("Lectures", top).unwrap();

    let app = dir.path().join("app");
    std::fs::create_dir_all(&app).unwrap();
    let check = run(
        &Inputs {
            now_unix: NOW,
            app_data_dir: &app,
            updates_dir: None,
            notebook: Some(&notebook),
            crash_store: None,
        },
        &SystemDisk,
    );
    let health = check.item(CheckId::NotebookHealth).unwrap();
    assert_eq!(health.status, Status::Pass, "{health:?}");
    let Detail::Health { files, .. } = &health.detail else {
        panic!()
    };
    assert!(*files > 0);
    assert_eq!(status(&check, CheckId::NotebookWritable), Status::Pass);
    assert_ne!(status(&check, CheckId::NotebookStorage), Status::Fail);

    // Damage the section's file. The notebook's check finds it, names it relative to the notebook, and keeps
    // the notebook's folder name out of the shared copy.
    let section_json = std::fs::read_dir(notebook.path())
        .unwrap()
        .filter_map(Result::ok)
        .map(|e| e.path().join("section.json"))
        .find(|p| p.exists())
        .expect("the section has a file");
    std::fs::write(&section_json, "{ not json").unwrap();
    let check = run(
        &Inputs {
            now_unix: NOW,
            app_data_dir: &app,
            updates_dir: None,
            notebook: Some(&notebook),
            crash_store: None,
        },
        &SystemDisk,
    );
    let health = check.item(CheckId::NotebookHealth).unwrap();
    assert_eq!(health.status, Status::Fail, "{health:?}");
    let Detail::Health { problems, .. } = &health.detail else {
        panic!()
    };
    assert!(
        problems
            .iter()
            .any(|p| p.file.ends_with("section.json") && !p.file.contains(':')),
        "{problems:?}"
    );
    let shared = serde_json::to_string(&check.redacted()).unwrap();
    assert!(!shared.contains("Lectures") && !shared.contains("Biology"), "{shared}");
}

#[test]
fn text_from_a_file_other_programs_can_write_is_not_repeated() {
    let dir = tempfile::tempdir().unwrap();
    let hostile = r#"{
        "lastCheck": "C:/Users/jdoe/Holiday Plans",
        "staged": { "version": "C:/Users/jdoe/x", "platform": "p", "file": "f", "path": "p", "sha256": "ab" },
        "pending": { "version": "my diary", "from": "0.4.0", "attempts": 3 },
        "rolledBack": { "from": "0.5.0", "to": "jane@example.org", "at": "yesterday after lunch" },
        "blockedVersions": ["0.4.1", "https://example.org/x"]
    }"#;
    std::fs::write(dir.path().join("state.json"), hostile).unwrap();
    let item = updates_of(dir.path());
    let json = serde_json::to_string(&item).unwrap();
    for leak in ["jdoe", "Holiday", "diary", "jane", "example.org", "lunch"] {
        assert!(!json.contains(leak), "{leak:?} in {json}");
    }
    let Detail::Updates {
        last_check,
        staged_version,
        rolled_back,
        blocked_versions,
        pending,
        ..
    } = item.detail
    else {
        panic!()
    };
    assert_eq!(last_check, None);
    assert_eq!(staged_version.as_deref(), Some("unknown"));
    assert_eq!(rolled_back.unwrap().at, "unknown");
    assert_eq!(blocked_versions, ["0.4.1", "unknown"]);
    assert_eq!(pending.unwrap().from, "0.4.0");
    assert_eq!(item.status, Status::Warn, "a rollback and a stuck version still warn");
}
