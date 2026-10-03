use opennote_crashreport::{Frame, Kind, Report, FORMAT};

use super::*;
use crate::disk::FixedDisk;
use crate::selfcheck::{self, Inputs};
use crate::summary::NotebookCounts;

const NOW: u64 = 1_790_000_000;

fn os() -> OsFacts {
    OsFacts {
        os: "Windows 10.0.26200 x86_64".into(),
        arch: "x86_64".into(),
        cpus: Some(8),
        memory_mb: Some(16384),
    }
}

fn facts() -> SystemFacts {
    SystemFacts {
        app_version: "1.0.0-beta.2".into(),
        channel: "beta".into(),
        webview2_version: Some("154.0.3512.22".into()),
        locale: Some("en-US".into()),
        theme: Some("dark".into()),
        notebooks: Some(NotebookCounts {
            notebooks: 2,
            sections: 5,
            pages: 90,
        }),
        enabled_flags: vec!["shell.customFrame".into()],
        ..SystemFacts::default()
    }
}

fn scrubber() -> Scrubber {
    let mut scrubber = Scrubber::new();
    scrubber.add_name("jdoe");
    scrubber.add_name("JANES-LAPTOP");
    scrubber.add_private("Taxes 2025");
    scrubber
}

fn log_line(ms: u64, message: &str) -> String {
    format!("{ms} INFO  opennote::notes {message}\n")
}

/// A logs folder and a crash folder, both holding text that must not get through.
struct World {
    dir: tempfile::TempDir,
    store: CrashStore,
}

impl World {
    fn new() -> World {
        let dir = tempfile::tempdir().unwrap();
        let logs = dir.path().join("logs");
        fs::create_dir_all(&logs).unwrap();
        let text = [
            log_line(1_790_000_000_000, "Started"),
            log_line(
                1_790_000_001_000,
                r#"Couldn't read C:\Users\jdoe\Documents\Taxes 2025\page.json for "My Diary""#,
            ),
            log_line(
                1_790_000_002_000,
                "Update from https://example.org/latest.json for jane@example.org",
            ),
            log_line(
                1_790_000_003_000,
                "Device 6B29FC40-CA47-1067-B31D-00DD010662DA on JANES-LAPTOP",
            ),
        ]
        .concat();
        fs::write(logs.join("opennote.log"), text).unwrap();
        let store = CrashStore::new(dir.path().join("crashes"));
        for time in [100, 200, 300, 400] {
            let report = Report {
                format: FORMAT,
                kind: Kind::Exception,
                app_version: "1.0.0".into(),
                os: "Windows".into(),
                time_unix: time,
                message: None,
                location: None,
                exception_code: Some("0xc0000005".into()),
                frames: vec![Frame::new("opennote.exe", "0x1a2b3c")],
                backtrace: Vec::new(),
            };
            store.save(&report).unwrap();
        }
        World { dir, store }
    }

    fn logs(&self) -> PathBuf {
        self.dir.path().join("logs")
    }
}

fn build(world: &World, options: &BundleOptions, with_logs: bool) -> Bundle {
    let scrubber = scrubber();
    let facts = facts();
    let logs = world.logs();
    let app = world.dir.path().to_path_buf();
    let check = selfcheck::run(
        &Inputs {
            now_unix: NOW,
            app_data_dir: &app,
            updates_dir: None,
            notebook: None,
            crash_store: Some(&world.store),
        },
        &FixedDisk(10 << 30),
    );
    Bundle::build_with(
        &BundleInputs {
            facts: &facts,
            self_check: Some(&check),
            logs_dir: with_logs.then_some(logs.as_path()),
            crash_store: Some(&world.store),
            scrubber: &scrubber,
            now_unix: NOW,
            options,
        },
        &os(),
    )
}

#[test]
fn holds_a_summary_the_self_check_and_the_logs_by_default() {
    let world = World::new();
    let bundle = build(&world, &BundleOptions::default(), true);
    let ids: Vec<_> = bundle.sections.iter().map(|s| s.id).collect();
    assert_eq!(ids, [SectionId::System, SectionId::SelfCheck, SectionId::Logs]);
    let text = bundle.render();
    assert!(
        text.starts_with("OpenNote feedback bundle\nMade: 2026-09-21T14:13:20Z\n"),
        "{text}"
    );
    assert!(text.contains("- Crash reports: not included"));
    assert!(text.contains("=== System ===\nOpenNote: 1.0.0-beta.2\n"));
    assert!(text.contains("=== Self-check ===\nOverall: pass\n"));
    assert!(text
        .contains("=== Recent log lines ===\n== opennote.log\n2026-09-21T14:13:20Z INFO  opennote::notes Started\n"));
    assert!(bundle.section(SectionId::CrashReports).is_none());
}

#[test]
fn nothing_private_gets_through_from_any_part() {
    let world = World::new();
    let options = BundleOptions {
        include_crash_reports: true,
        ..BundleOptions::default()
    };
    let text = build(&world, &options, true).render();
    for secret in [
        "jdoe",
        "Diary",
        "Taxes",
        "page.json",
        "example.org",
        "jane@",
        "JANES",
        "6B29FC40",
        r"C:\",
        "Documents",
    ] {
        assert!(!text.contains(secret), "{secret:?} in the bundle:\n{text}");
    }
    assert!(text.contains("<path>") && text.contains("<id>") && text.contains("<url>"));
}

#[test]
fn says_what_was_removed_and_counts_it_per_part() {
    let world = World::new();
    let bundle = build(&world, &BundleOptions::default(), true);
    let logs = bundle.section(SectionId::Logs).unwrap();
    assert!(logs.redactions.total() >= 6, "{:?}", logs.redactions);
    assert_eq!(
        bundle.redactions.total(),
        logs.redactions.total() + bundle.section(SectionId::System).unwrap().redactions.total()
    );
    let text = bundle.render();
    let removed = text.lines().find(|l| l.starts_with("Removed from this file:")).unwrap();
    assert!(
        removed.contains("paths") && removed.contains("web links") && removed.contains("identifiers"),
        "{removed}"
    );
    assert!(text.contains("- Recent log lines: 4 lines, "), "{text}");
}

#[test]
fn a_clean_bundle_says_so() {
    let world = World::new();
    fs::remove_dir_all(world.logs()).unwrap();
    let bundle = build(&world, &BundleOptions::default(), true);
    assert_eq!(bundle.redactions.total(), 0);
    assert!(bundle
        .render()
        .contains("Removed from this file: nothing needed to be removed"));
    assert_eq!(
        bundle.section(SectionId::Logs).unwrap().body,
        "No log files were found."
    );
}

#[test]
fn the_persons_own_words_are_kept_as_written_up_to_a_limit() {
    let world = World::new();
    let options = BundleOptions {
        description: "It crashed when I opened Taxes 2025\tafter the update.\u{1b}".into(),
        ..BundleOptions::default()
    };
    let bundle = build(&world, &options, false);
    let section = bundle.section(SectionId::Description).unwrap();
    assert_eq!(section.body, "It crashed when I opened Taxes 2025 after the update.");
    assert_eq!(
        bundle.sections[0].id,
        SectionId::Description,
        "what they wrote comes first"
    );
    assert!(bundle
        .render()
        .contains("- What you wrote: 53 characters, as you wrote them"));
    let long = BundleOptions {
        description: "word ".repeat(1000),
        ..BundleOptions::default()
    };
    let kept = build(&world, &long, false)
        .section(SectionId::Description)
        .unwrap()
        .body
        .chars()
        .count();
    assert!(kept <= MAX_NOTE, "{kept} characters");
    let blank = BundleOptions {
        description: "  \n ".into(),
        ..BundleOptions::default()
    };
    assert!(build(&world, &blank, false).section(SectionId::Description).is_none());
}

#[test]
fn crash_reports_are_included_only_when_asked_for_and_at_most_three_newest() {
    let world = World::new();
    let without = build(&world, &BundleOptions::default(), false);
    assert!(without.section(SectionId::CrashReports).is_none());
    assert!(without.section(SectionId::Logs).is_none(), "no folder, no section");
    let options = BundleOptions {
        include_crash_reports: true,
        include_logs: false,
        ..BundleOptions::default()
    };
    let bundle = build(&world, &options, true);
    let section = bundle.section(SectionId::CrashReports).unwrap();
    assert_eq!(section.items as usize, MAX_CRASH_REPORTS);
    assert!(section.body.contains("crash-400-0") && section.body.contains("crash-200-0"));
    assert!(!section.body.contains("crash-100-0"), "only the newest three");
    assert!(bundle.section(SectionId::Logs).is_none(), "logs were switched off");
    assert!(bundle.render().contains("- Recent log lines: not included"));
}

#[test]
fn the_shared_self_check_has_no_file_names() {
    let world = World::new();
    let bundle = build(&world, &BundleOptions::default(), false);
    let body = &bundle.section(SectionId::SelfCheck).unwrap().body;
    assert!(body.contains("diskApp: pass {\"kind\":\"freeSpace\""), "{body}");
    assert!(
        body.contains("crashReports: pass {\"kind\":\"reports\",\"count\":4}"),
        "{body}"
    );
    assert!(!body.contains("jdoe"));
}

#[test]
fn only_the_reviewed_text_can_be_saved() {
    let world = World::new();
    let review = build(&world, &BundleOptions::default(), true).review();
    assert!(review
        .suggested_file_name()
        .starts_with("OpenNote-feedback-2026-09-21-14-13-20"));
    assert!(review.suggested_file_name().ends_with(".txt"));
    assert_eq!(review.digest().len(), 64);
    let out = tempfile::tempdir().unwrap();
    assert!(matches!(review.save("0000", out.path()), Err(BundleError::NotReviewed)));
    assert_eq!(
        fs::read_dir(out.path()).unwrap().count(),
        0,
        "nothing is written without the digest"
    );

    let saved = review.save(review.digest(), out.path()).unwrap();
    assert_eq!(fs::read_to_string(&saved).unwrap(), review.text());
    // A second save never overwrites the first.
    let again = review.save(review.digest(), out.path()).unwrap();
    assert_ne!(saved, again);
    assert!(again.file_name().unwrap().to_string_lossy().ends_with("-1.txt"));
    assert_eq!(fs::read_to_string(&saved).unwrap(), fs::read_to_string(&again).unwrap());
    // A folder that does not exist is a plain error.
    assert!(matches!(
        review.save(review.digest(), &out.path().join("missing")),
        Err(BundleError::Io(_))
    ));
}

#[test]
fn another_bundle_has_another_digest_so_an_old_review_cannot_save_new_text() {
    let world = World::new();
    let first = build(&world, &BundleOptions::default(), true).review();
    let options = BundleOptions {
        description: "changed".into(),
        ..BundleOptions::default()
    };
    let second = build(&world, &options, true).review();
    assert_ne!(first.digest(), second.digest());
    let out = tempfile::tempdir().unwrap();
    assert!(matches!(
        second.save(first.digest(), out.path()),
        Err(BundleError::NotReviewed)
    ));
}

#[test]
fn the_bundle_is_json_for_the_interface() {
    let world = World::new();
    let bundle = build(&world, &BundleOptions::default(), true);
    let json = serde_json::to_value(&bundle).unwrap();
    assert_eq!(json["createdUnix"], NOW);
    assert_eq!(json["sections"][0]["id"], "system");
    assert!(json["redactions"]["paths"].as_u64().unwrap() >= 1);
    assert_eq!(serde_json::from_value::<Bundle>(json).unwrap(), bundle);
    let options: BundleOptions = serde_json::from_str("{}").unwrap();
    assert_eq!(options, BundleOptions::default());
    assert!(!options.include_crash_reports, "crash reports are opt-in");
}
