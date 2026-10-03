use super::*;

fn scrubber() -> Scrubber {
    let mut scrubber = Scrubber::new();
    scrubber.add_name("jdoe");
    scrubber.add_name("JANES-LAPTOP");
    scrubber.add_private("Holiday Plans");
    scrubber
}

fn environment() -> Environment {
    Environment {
        app_version: "1.0.0-beta.2".to_owned(),
        os: "Windows 10.0.26200 x86_64".to_owned(),
        time_unix: 1_760_000_000,
    }
}

/// A backtrace as the standard library prints it, with the paths of a build machine and a person's computer.
const BACKTRACE: &str = "   0: std::backtrace_rs::backtrace::win64::trace
             at /rustc/abc123/library/std/src/backtrace.rs:1:2
   1: opennote_crashreport::hook::capture
             at C:\\Users\\jdoe\\GitHub\\OpenNote\\crates\\crashreport\\src\\hook.rs:40:9
   2: std::panicking::rust_panic_with_hook
   3: rust_begin_unwind
   4: core::panicking::panic_fmt
   5: opennote_core::store::Store::save_page
             at C:\\Users\\jdoe\\GitHub\\OpenNote\\crates\\core\\src\\store.rs:120:9
   6: opennote_app::run::{{closure}}
             at C:\\Users\\jdoe\\Documents\\Holiday Plans\\main.rs:7:1
   7: std::sys::backtrace::__rust_begin_short_backtrace
note: Some details are omitted, C:\\Users\\jdoe\\Holiday Plans
";

fn capture() -> Capture {
    Capture {
        kind: Kind::Panic,
        message: Some("called `Option::unwrap()` on a `None` value"),
        location: Some("C:\\Users\\jdoe\\GitHub\\OpenNote\\crates\\core\\src\\store.rs:120:9".to_owned()),
        exception_code: None,
        frames: vec![
            RawFrame {
                module: Some(r"C:\Program Files\OpenNote\opennote.exe".to_owned()),
                offset: Some(0x1a2b3c),
                ..RawFrame::default()
            },
            RawFrame {
                module: Some("ntdll.dll".to_owned()),
                offset: Some(0x9f),
                ..RawFrame::default()
            },
            RawFrame {
                module: None,
                offset: Some(0xdead_beef),
                ..RawFrame::default()
            },
            RawFrame {
                module: Some(r"C:\Users\jdoe\Holiday Plans.dll".to_owned()),
                offset: Some(1),
                ..RawFrame::default()
            },
        ],
        backtrace: drop_panic_frames(BACKTRACE),
    }
}

#[test]
fn builds_a_report_with_code_positions_only() {
    let report = Report::build(capture(), &environment(), &scrubber());
    assert_eq!(report.kind, Kind::Panic);
    assert_eq!(report.app_version, "1.0.0-beta.2");
    assert_eq!(
        report.message.as_deref(),
        Some("called `Option::unwrap()` on a `None` value")
    );
    assert_eq!(report.location.as_deref(), Some("store.rs:120:9"));
    assert_eq!(
        report.frames,
        [Frame::new("opennote.exe", "0x1a2b3c"), Frame::new("ntdll.dll", "0x9f")]
    );
    assert_eq!(
        report.backtrace,
        [
            "5: opennote_core::store::Store::save_page",
            "at store.rs:120:9",
            "6: opennote_app::run::{{closure}}",
            "at main.rs:7:1",
            "7: std::sys::backtrace::__rust_begin_short_backtrace",
        ]
    );
}

#[test]
fn the_report_never_holds_names_folders_or_paths() {
    let json = Report::build(capture(), &environment(), &scrubber()).to_json();
    for secret in [
        "jdoe",
        "Holiday",
        "C:\\",
        "Users",
        "Documents",
        "GitHub",
        "Program Files",
        "/rustc/",
    ] {
        assert!(!json.contains(secret), "{secret:?} in {json}");
    }
}

#[test]
fn panic_machinery_is_dropped_from_the_top() {
    let text = drop_panic_frames(BACKTRACE);
    assert!(text.starts_with("5: opennote_core::store::Store::save_page\nat "));
    assert!(
        text.contains("7: std::sys::backtrace"),
        "frames below the panic are kept"
    );
    // Text that has no machinery on top is kept whole.
    assert_eq!(drop_panic_frames("0: a::b\nat x.rs:1:2\n"), "0: a::b\nat x.rs:1:2\n");
    assert_eq!(drop_panic_frames(""), "");
}

#[test]
fn a_windows_exception_has_a_code_and_offsets() {
    let capture = Capture {
        kind: Kind::Exception,
        message: None,
        location: None,
        exception_code: Some(0xC000_0005),
        frames: vec![RawFrame {
            module: Some("opennote.exe".into()),
            offset: Some(0x42),
            ..RawFrame::default()
        }],
        backtrace: String::new(),
    };
    let report = Report::build(capture, &environment(), &scrubber());
    assert_eq!(report.exception_code.as_deref(), Some("0xc0000005"));
    assert_eq!(report.frames.len(), 1);
    assert!(report.backtrace.is_empty());
}

#[test]
fn scrubbing_a_built_report_changes_nothing() {
    let report = Report::build(capture(), &environment(), &scrubber());
    assert_eq!(report.scrubbed(&scrubber()), report);
}

#[test]
fn a_report_round_trips_through_json() {
    let report = Report::build(capture(), &environment(), &scrubber());
    assert_eq!(Report::from_json(&report.to_json()).unwrap(), report);
}

#[test]
fn a_loaded_report_is_checked_again() {
    // A report file that was edited, or written by something else, holds private text in every field.
    let tampered = Report {
        format: FORMAT,
        kind: Kind::Panic,
        app_version: "C:\\Users\\jdoe\\secret".into(),
        os: "Windows of jdoe".into(),
        time_unix: 1,
        message: Some("failed to save \"my diary\" to /home/jdoe/notes/diary.json".into()),
        location: Some("C:\\Users\\jdoe\\Holiday Plans\\page.json:1:1".into()),
        exception_code: Some("secret".into()),
        frames: vec![
            Frame::new("Holiday Plans.dll", "0x1"),
            Frame::new("ntdll.dll", "C:\\Users\\jdoe"),
            Frame::new("ntdll.dll", "0x10"),
        ],
        backtrace: vec![
            "0: C:\\Users\\jdoe\\a".into(),
            "my diary entry".into(),
            "at C:\\Users\\jdoe\\Holiday Plans\\x.rs:1:2".into(),
        ],
    };
    let report = tampered.scrubbed(&scrubber());
    assert_eq!(report.app_version, "unknown");
    assert_eq!(report.os, "Windows of <user>");
    assert_eq!(report.message.as_deref(), Some("failed to save \"<text>\" to <path>"));
    assert_eq!(report.location.as_deref(), Some("<path>"));
    assert_eq!(report.exception_code, None);
    assert_eq!(report.frames, [Frame::new("ntdll.dll", "0x10")]);
    assert_eq!(report.backtrace, ["0: <symbol>", "at x.rs:1:2"]);
    let json = report.to_json();
    for secret in ["jdoe", "Holiday", "diary"] {
        assert!(!json.contains(secret), "{secret:?} in {json}");
    }
}

#[test]
fn old_reports_without_optional_lists_still_load() {
    let json = r#"{"format":1,"kind":"panic","app_version":"0.1.0","os":"Windows","time_unix":5,
                   "message":null,"location":null,"exception_code":null}"#;
    let report = Report::from_json(json).unwrap();
    assert!(report.frames.is_empty() && report.backtrace.is_empty());
    assert!(Report::from_json("not json").is_err());
}

#[test]
fn long_text_is_cut() {
    let capture = Capture {
        message: Some(&*Box::leak("x".repeat(1000).into_boxed_str())),
        ..capture()
    };
    let report = Report::build(capture, &environment(), &scrubber());
    assert_eq!(report.message.unwrap().chars().count(), MAX_MESSAGE);
}

#[test]
fn the_example_report_is_clean_and_in_the_real_format() {
    let example = Report::example("1.0.0-beta.2", 1_790_000_000);
    assert_eq!(example.scrubbed(&scrubber()), example);
    assert_eq!(Report::from_json(&example.to_json()).unwrap(), example);
    assert!(example.frames.iter().all(|f| f.debug_id.is_some()));
    let json = example.to_json();
    for secret in ["Users", "jdoe", "Documents", ":\\"] {
        assert!(!json.contains(secret), "{secret:?} in {json}");
    }
}
