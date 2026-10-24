//! The JSON the interface reads and writes for the self-check and the feedback file. The fixtures in
//! `tests/fixtures` are checked here against the real types, and `app/src/features/diagnostics/contract.test.ts`
//! checks the same files against the interface's types and functions. To rewrite them after a deliberate change,
//! run these tests with `OPENNOTE_UPDATE_FIXTURES=1`.

use std::fs;
use std::path::PathBuf;

use opennote_crashreport::Redactions;
use opennote_diagnostics::bundle::BundleOptions;
use opennote_diagnostics::selfcheck::{CodeCount, PendingUpdate, Problem, RolledBack, StorageNote, SyncName};
use opennote_diagnostics::summary::{NotebookCounts, SystemFacts};
use opennote_diagnostics::{Bundle, CheckId, CheckItem, Detail, Section, SectionId, SelfCheck, Status};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;

fn assert_fixture<T: Serialize + DeserializeOwned + PartialEq + std::fmt::Debug>(name: &str, value: &T) {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures")
        .join(name);
    let actual = serde_json::to_value(value).unwrap();
    if std::env::var_os("OPENNOTE_UPDATE_FIXTURES").is_some() {
        fs::write(&path, serde_json::to_string_pretty(&actual).unwrap() + "\n").unwrap();
    }
    let text = fs::read_to_string(&path).unwrap_or_else(|_| panic!("missing fixture {}", path.display()));
    let expected: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(actual, expected, "{name} differs from the real type's JSON");
    let back: T = serde_json::from_value(expected).unwrap();
    assert_eq!(&back, value, "{name} does not read back as the same value");
}

fn item(id: CheckId, status: Status, detail: Detail) -> CheckItem {
    CheckItem { id, status, detail }
}

#[test]
fn the_self_check_is_the_json_the_screen_reads() {
    let check = SelfCheck {
        created_unix: 1_790_000_000,
        items: vec![
            item(
                CheckId::DiskNotebook,
                Status::Warn,
                Detail::FreeSpace {
                    free_bytes: 314_572_800,
                    warn_below: 524_288_000,
                    fail_below: 52_428_800,
                },
            ),
            item(
                CheckId::DiskApp,
                Status::Warn,
                Detail::Unavailable {
                    reason: "PermissionDenied".into(),
                },
            ),
            item(
                CheckId::NotebookWritable,
                Status::Fail,
                Detail::Writable {
                    writable: false,
                    reason: Some("NotFound".into()),
                },
            ),
            item(
                CheckId::NotebookStorage,
                Status::Warn,
                Detail::Storage {
                    file_system: "NTFS".into(),
                    notes: vec![
                        StorageNote::NetworkShare,
                        StorageNote::NoMetadataLog,
                        StorageNote::SyncFolder(SyncName::OneDrive),
                    ],
                },
            ),
            item(
                CheckId::NotebookHealth,
                Status::Fail,
                Detail::Health {
                    files: 40,
                    problem_count: 3,
                    by_code: vec![
                        CodeCount {
                            code: "page.checksum".into(),
                            count: 2,
                        },
                        CodeCount {
                            code: "section.reference".into(),
                            count: 1,
                        },
                    ],
                    problems: vec![Problem {
                        code: "page.checksum".into(),
                        file: "Lectures/Mitosis/page.json".into(),
                    }],
                    unsaved_changes: true,
                    failed: None,
                },
            ),
            item(
                CheckId::Updates,
                Status::Warn,
                Detail::Updates {
                    last_check: Some("2026-09-20T10:00:00Z".into()),
                    days_since_check: Some(1),
                    staged_version: Some("0.5.0".into()),
                    pending: Some(PendingUpdate {
                        version: "0.5.0".into(),
                        from: "0.4.0".into(),
                        attempts: 2,
                    }),
                    rolled_back: Some(RolledBack {
                        from: "0.5.0".into(),
                        to: "0.4.0".into(),
                        at: "2026-09-20T10:09:12Z".into(),
                    }),
                    blocked_versions: vec!["0.4.1".into()],
                },
            ),
            item(CheckId::CrashReports, Status::Pass, Detail::Reports { count: 2 }),
            item(CheckId::DiskNotebook, Status::Skipped, Detail::NotApplicable),
        ],
    };
    assert_fixture("self-check.json", &check);
}

#[test]
fn the_feedback_file_is_the_json_the_dialog_reads() {
    let removed = Redactions {
        paths: 3,
        quoted: 1,
        links: 1,
        ids: 1,
        ..Redactions::default()
    };
    let bundle = Bundle {
        created_unix: 1_790_000_000,
        sections: vec![
            Section {
                id: SectionId::Description,
                title: "What you wrote".into(),
                body: "It crashed when I opened a page.".into(),
                redactions: Redactions::default(),
                items: 32,
            },
            Section {
                id: SectionId::System,
                title: "System".into(),
                body: "OpenNote: 1.0.0-beta.2\n".into(),
                redactions: Redactions::default(),
                items: 1,
            },
            Section {
                id: SectionId::Logs,
                title: "Recent log lines".into(),
                body: "== opennote.log\n".into(),
                redactions: removed,
                items: 0,
            },
        ],
        redactions: removed,
    };
    assert_fixture("bundle.json", &bundle);
}

#[test]
fn the_form_and_the_facts_are_the_json_the_app_sends() {
    assert_fixture("bundle-options.json", &BundleOptions::default());
    let facts = SystemFacts {
        app_version: "1.0.0-beta.2".into(),
        channel: "beta".into(),
        webview2_version: Some("154.0.3512.22".into()),
        locale: Some("en-US".into()),
        display_scale_percent: Some(150),
        text_size_percent: Some(100),
        theme: Some("dark".into()),
        density: Some("touch".into()),
        enabled_flags: vec!["shell.customFrame".into()],
        notebooks: Some(NotebookCounts {
            notebooks: 2,
            sections: 5,
            pages: 90,
        }),
    };
    assert_fixture("system-facts.json", &facts);
}

#[test]
fn the_start_report_and_session_counts_are_the_json_the_dialog_reads() {
    use opennote_diagnostics::sessions::{PreviousEnd, SessionStats, StartReport};
    assert_fixture(
        "start-report.json",
        &StartReport {
            previous: PreviousEnd::Crashed,
            crashes_in_a_row: 2,
            offer_safe_mode: true,
            previous_was_safe: false,
        },
    );
    assert_fixture(
        "session-stats.json",
        &SessionStats {
            sessions: 10,
            clean: 8,
            crashed: 2,
        },
    );
}
