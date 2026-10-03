use super::*;

fn scrubber() -> Scrubber {
    let mut scrubber = Scrubber::new();
    scrubber.add_name("jdoe");
    scrubber
}

fn line(ms: u64, level: &str, target: &str, message: &str) -> String {
    format!("{ms} {level:<5} {target} {message}")
}

#[test]
fn shows_the_time_level_module_and_message() {
    let out = clean_line(
        &line(1_790_000_123_456, "INFO", "opennote::notes", "Opened a notebook"),
        &scrubber(),
    );
    assert_eq!(out, "2026-09-21T14:15:23Z INFO  opennote::notes Opened a notebook");
}

#[test]
fn removes_private_text_from_the_message_and_the_module() {
    let out = clean_line(
        &line(
            1_790_000_000_000,
            "WARN",
            "opennote::notes",
            r#"Couldn't read C:\Users\jdoe\Notes\Holiday Plans\page.json for "Holiday Plans" (jdoe@example.org)"#,
        ),
        &scrubber(),
    );
    for secret in ["jdoe", "Holiday", "page.json", "example.org"] {
        assert!(!out.contains(secret), "{secret:?} in {out}");
    }
    let odd = clean_line(
        &line(1_790_000_000_000, "ERROR", r"C:\Users\jdoe", "failed"),
        &scrubber(),
    );
    assert!(odd.contains("<module>") && !odd.contains("jdoe"), "{odd}");
}

#[test]
fn removes_paths_as_the_app_log_writes_them() {
    // The app's logger replaces the profile folder with %USERPROFILE% before it writes a line.
    let cases = [
        (
            r"Couldn't save %USERPROFILE%\Documents\My Notes\Diary.onb: Access is denied. (os error 5)",
            "Couldn't save <path>: Access is denied. (os error 5)",
        ),
        (
            r"Left %USERPROFILE%\Desktop\Holiday plans\OpenNote.exe alone: in use.",
            "Left <path>: in use.",
        ),
        (
            r"failed to read notebooks\Holiday plans\page-1.json (os error 2)",
            "failed to read <path>",
        ),
    ];
    for (message, expected) in cases {
        let out = clean_line(
            &line(1_790_000_000_000, "WARN", "opennote::notes", message),
            &scrubber(),
        );
        assert!(out.ends_with(&format!("opennote::notes {expected}")), "{out}");
    }
}

#[test]
fn keeps_only_where_a_panic_started() {
    let messages = [
        // The logger writes a panic's two lines as one, joined by " | ".
        r"Panic: panicked at src\store.rs:120:9: | no section named Holiday plans",
        r"Panic: panicked at C:\Users\jdoe\opennote\src\store.rs:120:9: no section named Holiday plans",
        "Panic: panicked at store.rs:120:9: page title: Holiday plans with Alex",
    ];
    for message in messages {
        let out = clean_line(&line(1_790_000_000_000, "ERROR", "opennote", message), &scrubber());
        assert!(
            out.ends_with("opennote Panic: panicked at store.rs:120:9: <message left out>"),
            "{out}"
        );
    }
    let odd = clean_line(
        &line(1_790_000_000_000, "ERROR", "opennote", "Panic: Holiday plans with Alex"),
        &scrubber(),
    );
    assert!(odd.ends_with("Panic: panicked at <path>: <message left out>"), "{odd}");
    let unparsed = clean_line("garbled Panic: panicked at a.rs:1:2: Holiday plans", &scrubber());
    assert_eq!(unparsed, "? Panic: panicked at a.rs:1:2: <message left out>");
}

#[test]
fn a_line_in_another_shape_is_scrubbed_whole_and_marked() {
    for bad in [
        r"free text about C:\Users\jdoe\a.json",
        "notanumber INFO opennote::x message",
        "1790000000000 LOUD opennote::x message",
        "1790000000000",
        "",
    ] {
        let out = clean_line(bad, &scrubber());
        assert!(out.starts_with("? "), "{out}");
        assert!(!out.contains("jdoe"), "{out}");
    }
}

#[test]
fn control_characters_cannot_break_a_line_and_long_lines_are_cut() {
    let out = clean_line(
        &line(1_790_000_000_000, "INFO", "opennote::x", "one\ttwo\rthree\u{1b}[31m"),
        &scrubber(),
    );
    assert!(!out.chars().any(char::is_control), "{out:?}");
    let long = clean_line(
        &line(1_790_000_000_000, "INFO", "opennote::x", &"word ".repeat(500)),
        &scrubber(),
    );
    assert_eq!(long.chars().count(), MAX_LINE);
}

fn write_logs(dir: &Path) {
    for (name, count) in [("opennote.log", 5), ("opennote.1.log", 5), ("opennote.2.log", 5)] {
        let text: String = (0..count)
            .map(|n| {
                line(
                    1_790_000_000_000 + n * 1000,
                    "INFO",
                    "opennote::x",
                    &format!("{name} line {n}"),
                ) + "\n"
            })
            .collect();
        fs::write(dir.join(name), text).unwrap();
    }
    fs::write(dir.join("notes.txt"), "not a log").unwrap();
    fs::write(dir.join("opennote.9.log"), "not kept by the app").unwrap();
}

#[test]
fn collects_the_newest_files_first_and_ignores_other_files() {
    let dir = tempfile::tempdir().unwrap();
    write_logs(dir.path());
    let excerpt = collect(dir.path(), &scrubber(), DEFAULT_BUDGET);
    let names: Vec<_> = excerpt.files.iter().map(|f| f.name.as_str()).collect();
    assert_eq!(names, ["opennote.log", "opennote.1.log", "opennote.2.log"]);
    assert_eq!(excerpt.line_count(), 15);
    assert!(!excerpt.truncated);
    let text = excerpt.render();
    assert!(text.starts_with("== opennote.log\n"));
    assert!(!text.contains("not a log") && !text.contains("not kept"));
}

#[test]
fn keeps_the_newest_lines_when_the_budget_is_small() {
    let dir = tempfile::tempdir().unwrap();
    write_logs(dir.path());
    let one_line = clean_line(
        &line(1_790_000_000_000, "INFO", "opennote::x", "opennote.log line 0"),
        &scrubber(),
    )
    .len()
        + 1;
    // Room for three lines: the newest three of the first file, and nothing of the older files.
    let excerpt = collect(dir.path(), &scrubber(), one_line * 3);
    assert!(excerpt.truncated);
    assert_eq!(excerpt.files.len(), 1);
    assert_eq!(excerpt.files[0].lines.len(), 3);
    assert_eq!(excerpt.files[0].omitted_lines, 2);
    assert!(excerpt.files[0].lines[2].ends_with("opennote.log line 4"));
    assert!(excerpt.render().contains("(2 older lines left out)"));
    // No budget keeps nothing.
    let none = collect(dir.path(), &scrubber(), 0);
    assert!(none.files.is_empty() && none.truncated);
}

#[test]
fn a_folder_without_logs_gives_an_empty_excerpt() {
    let dir = tempfile::tempdir().unwrap();
    let excerpt = collect(dir.path(), &scrubber(), DEFAULT_BUDGET);
    assert_eq!(excerpt, LogExcerpt::default());
    assert_eq!(
        collect(&dir.path().join("missing"), &scrubber(), DEFAULT_BUDGET),
        LogExcerpt::default()
    );
}

#[test]
fn counts_what_was_removed() {
    let dir = tempfile::tempdir().unwrap();
    let text = format!(
        "{}\n{}\n",
        line(1_790_000_000_000, "INFO", "opennote::x", r"opened C:\Users\jdoe\a.json"),
        line(
            1_790_000_001_000,
            "INFO",
            "opennote::x",
            r#"title "Plans" from https://example.org/x"#
        ),
    );
    fs::write(dir.path().join("opennote.log"), text).unwrap();
    let excerpt = collect(dir.path(), &scrubber(), DEFAULT_BUDGET);
    assert_eq!(excerpt.redactions.paths, 1);
    assert_eq!(excerpt.redactions.quoted, 1);
    assert_eq!(excerpt.redactions.links, 1);
}
