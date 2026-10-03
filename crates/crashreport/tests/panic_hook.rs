//! Real panics, caught, with the real hook installed. The hooks are global, so this file has one test.
//! It proves that no note text, file name, or user name reaches a saved report, however the panic is made.

use std::panic::{catch_unwind, panic_any};

use opennote_crashreport::{
    add_private, install, is_enabled, set_enabled, Config, CrashStore, Kind, Scrubber, Settings,
};

const NOTE: &str = "my secret diary entry about Holiday Plans";

fn raw_reports(store: &CrashStore) -> Vec<String> {
    let entries = std::fs::read_dir(store.dir()).into_iter().flatten().flatten();
    entries
        .map(|entry| std::fs::read_to_string(entry.path()).unwrap())
        .collect()
}

/// A call that fails with an error that holds note text, as a real save might.
#[inline(never)]
fn failing_call() -> Result<(), String> {
    Err(NOTE.to_owned())
}

/// Text that must never appear in a report, in any letter case.
fn forbidden(temp: &std::path::Path) -> Vec<String> {
    let mut words = vec![
        "secret".to_owned(),
        "diary".to_owned(),
        "Holiday".to_owned(),
        "AppData".to_owned(),
    ];
    words.push(temp.to_string_lossy().into_owned());
    for var in ["USERNAME", "USER", "COMPUTERNAME", "USERPROFILE", "HOME"] {
        words.extend(std::env::var(var).ok().filter(|value| value.len() >= 4));
    }
    words
}

#[test]
fn panics_are_saved_without_note_content() {
    let dir = tempfile::tempdir().unwrap();
    let store = CrashStore::new(dir.path().join("crashes"));
    let config = Config {
        app_version: "9.9.9".into(),
        store: store.clone(),
        settings: Settings::default(),
    };
    assert!(install(config.clone()), "the first install works");
    assert!(!install(config), "the second does nothing");
    add_private("Holiday Plans");

    // Reports are off by default, so this panic leaves nothing.
    assert!(!is_enabled());
    let _ = catch_unwind(|| panic!("{NOTE}"));
    assert!(raw_reports(&store).is_empty());

    // Turned on, each way of panicking with note text leaves a report that holds none of it.
    set_enabled(true);
    let _ = catch_unwind(|| panic!("{NOTE}"));
    let _ = catch_unwind(|| failing_call().unwrap());
    // A string literal can't hold note content, so its message is kept. This is the third report.
    let _ = catch_unwind(|| panic!("this message is a literal"));
    // A run saves at most three reports, so this one and the next leave nothing.
    let _ = catch_unwind(|| panic_any(NOTE.to_owned()));
    let _ = catch_unwind(|| panic!("a fourth literal"));

    let reports = raw_reports(&store);
    assert_eq!(reports.len(), 3, "a run saves at most three reports");
    let withheld = reports.iter().filter(|r| r.contains("\"message\": null")).count();
    assert_eq!(withheld, 2, "messages built at run time are withheld");
    assert!(reports
        .iter()
        .any(|r| r.contains("\"message\": \"this message is a literal\"")));
    assert!(!reports.iter().any(|r| r.contains("fourth")));
    assert_clean(&reports, dir.path());
    assert_interface_view(&store);
}

/// No report holds note text, a user name, or a path, and each one names the panic location.
fn assert_clean(reports: &[String], temp: &std::path::Path) {
    for report in reports {
        for text in forbidden(temp) {
            assert!(
                !report.to_lowercase().contains(&text.to_lowercase()),
                "{text:?} in {report}"
            );
        }
        assert!(report.contains("\"app_version\": \"9.9.9\""));
        assert!(
            report.contains("panic_hook.rs:"),
            "the location is a file name and a line, never a path"
        );
    }
}

/// The same reports through the store, as the interface lists and shows them.
fn assert_interface_view(store: &CrashStore) {
    let listed = store.list();
    assert_eq!(listed.len(), 3);
    assert!(listed.iter().all(|s| s.kind == Kind::Panic && s.app_version == "9.9.9"));
    let shown = store.load(&listed[0].id, &Scrubber::detect()).unwrap();
    assert!(!shown.backtrace.is_empty(), "the backtrace is kept");
    #[cfg(windows)]
    assert!(
        shown.frames.iter().any(|f| f.module.ends_with(".exe")),
        "the stack has code offsets"
    );
}
