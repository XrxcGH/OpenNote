use super::*;
use crate::redactions::Redactions;

/// A scrubber that knows a made-up person and computer.
fn scrubber() -> Scrubber {
    let mut scrubber = Scrubber::new();
    scrubber.add_name("jdoe");
    scrubber.add_name("Jane Doe");
    scrubber.add_name("JANES-LAPTOP");
    scrubber.add_private("Taxes 2025");
    scrubber
}

/// Asserts that none of `secrets` survives scrubbing `input`, in any letter case.
fn assert_gone(input: &str, secrets: &[&str]) {
    let output = scrubber().text(input);
    for secret in secrets {
        assert!(
            !output.to_lowercase().contains(&secret.to_lowercase()),
            "{secret:?} survived in {output:?} (from {input:?})"
        );
    }
}

/// Asserts that each input scrubs to the expected text.
fn assert_scrubs(cases: &[(&str, &str)]) {
    for (input, expected) in cases {
        assert_eq!(scrubber().text(input), *expected, "{input}");
    }
}

#[test]
fn removes_windows_paths_with_spaces() {
    let cases = [
        r"failed to open C:\Users\Jane Doe\Documents\OpenNote\Holiday Plans\Page 3.json",
        r"failed to open c:/users/jane doe/documents/opennote/holiday plans/page 3.json",
        r"failed to open \\FILESERVER\share\Holiday Plans\Page 3.json",
        r"failed to open \\?\C:\Users\Jane Doe\Holiday Plans\Page 3.json",
        "failed to open file:///C:/Users/Jane%20Doe/Holiday%20Plans/Page%203.json",
    ];
    for case in cases {
        assert_gone(case, &["jane", "doe", "holiday", "page 3", "fileserver", "documents"]);
        assert!(scrubber().text(case).starts_with("failed to open <path>"));
    }
}

#[test]
fn removes_paths_as_the_app_log_writes_them_and_relative_paths() {
    assert_scrubs(&[
        (
            r"Couldn't save %USERPROFILE%\Documents\My Notes\Diary.onb: Access is denied. (os error 5)",
            "Couldn't save <path>: Access is denied. (os error 5)",
        ),
        (
            r"Left %USERPROFILE%\Desktop\Holiday plans\OpenNote.exe alone: in use.",
            "Left <path>: in use.",
        ),
        ("open %LOCALAPPDATA%/Holiday plans/a.json", "open <path>"),
        (
            r"failed to read notebooks\Holiday plans\page-1.json (os error 2)",
            "failed to read <path>",
        ),
        (r"open .\Holiday plans\a.json", "open <path>"),
        (r"open ..\Holiday plans\a.json", "open <path>"),
        (r"open \Users\Holiday plans\a.json", "open <path>"),
        (r"open DESKTOP-1\Holiday plans", "open <path>"),
    ]);
    // Rust's debug form doubles each backslash.
    assert_gone(r#"open "notebooks\\Holiday plans\\a.json""#, &["holiday", "a.json"]);
    // A percent sign or a backslash alone is no path.
    for message in ["100% done", "50%/s", r"a \ b", r"ends with\"] {
        assert_eq!(scrubber().text(message), message);
    }
}

#[test]
fn a_mark_or_prefix_inside_a_path_does_not_cut_it_short() {
    assert_scrubs(&[
        (
            r"open C:\Users\Sam\Notes\bob@example.com\Secret Plans.onb failed",
            "open <path>",
        ),
        (
            r"canonical \\?\UNC\nas01\family\Sam\Holiday plans.onb is locked",
            "canonical <path>",
        ),
        (r"open \\.\pipe\Holiday plans now", "open <path>"),
        (r"C:\Users\Sam\Notes\'a' b\secret.onb gone", "<path>"),
        (r"C:\Users\Sam\https://x.example\Secret Plans.onb gone", "<path>"),
    ]);
}

#[test]
fn removes_unix_paths() {
    assert_gone(
        "cannot read /home/jdoe/notes/Holiday Plans/page.json",
        &["jdoe", "holiday", "page.json"],
    );
    assert_gone("cannot read ~/Notes/Holiday Plans/page.json", &["holiday", "page.json"]);
    assert_gone("cannot read '/Users/jdoe/Notes/page.json'", &["jdoe", "page.json"]);
}

#[test]
fn keeps_what_follows_a_path() {
    let out = scrubber().text(r"could not open C:\Users\jdoe\a b.json: Access is denied. (os error 5)");
    assert_eq!(out, "could not open <path>: Access is denied. (os error 5)");
}

#[test]
fn removes_links_and_addresses() {
    assert_gone(
        "upload to https://example.com/u/jdoe?token=abc123 failed",
        &["jdoe", "abc123", "example.com"],
    );
    assert_gone(
        "contact jane.doe+notes@example.co.uk now",
        &["jane.doe", "example.co.uk"],
    );
    assert_eq!(scrubber().text("a@b and x @ y.z stay"), "a@b and x @ y.z stay");
}

#[test]
fn removes_registered_names_as_whole_words_in_any_case() {
    assert_eq!(
        scrubber().text("JDoe and jdoe_backup and JANES-laptop"),
        "<user> and <user>_backup and <user>"
    );
    assert_eq!(scrubber().text("Jane Doe wrote Taxes 2025"), "<user> wrote <private>");
    // Part of a longer word is not the name.
    assert_eq!(scrubber().text("jdoeful"), "jdoeful");
}

#[test]
fn matches_names_with_accents_in_any_case() {
    let mut scrubber = Scrubber::new();
    scrubber.add_name("José Ñandú");
    assert_eq!(scrubber.text("by JOSÉ ÑANDÚ and josé ñandú"), "by <user> and <user>");
}

#[test]
fn ignores_one_character_names() {
    let mut scrubber = Scrubber::new();
    scrubber.add_name("a");
    scrubber.add_name("  ");
    assert_eq!(scrubber.text("a cat"), "a cat");
}

#[test]
fn leaves_ordinary_static_messages_alone() {
    for message in [
        "called `Option::unwrap()` on a `None` value",
        "index out of bounds: the len is 3 but the index is 7",
        "attempt to divide by zero",
        "and/or 1/2 he/she",
        "`async fn` resumed after completion",
        "called `Result::unwrap()` on an `Err` value",
    ] {
        assert_eq!(scrubber().text(message), message);
    }
}

#[test]
fn source_keeps_only_a_rust_file_name_and_line() {
    let s = scrubber();
    assert_eq!(
        s.source(r"C:\Users\Jane Doe\.cargo\registry\src\serde-1.0\src\de.rs:12:5"),
        "de.rs:12:5"
    );
    assert_eq!(
        s.source("/rustc/abc123/library/core/src/option.rs:1:2"),
        "option.rs:1:2"
    );
    assert_eq!(s.source("store.rs"), "store.rs");
    assert_eq!(s.source(r"C:\Users\Jane Doe\Holiday Plans\page.json:3:4"), "<path>");
    assert_eq!(s.source("src/lib.rs:x:4"), "<path>");
    assert_eq!(s.source("src/lib.rs:1:2:3:4"), "lib.rs:1:2:3:4");
    assert_eq!(s.source(""), "<path>");
}

#[test]
fn symbols_must_look_like_function_names() {
    let s = scrubber();
    assert_eq!(
        s.symbol("opennote_core::store::Store::save_page::{{closure}}"),
        "opennote_core::store::Store::save_page::{{closure}}"
    );
    assert_eq!(
        s.symbol("<alloc::vec::Vec<T> as core::ops::drop::Drop>::drop"),
        "<alloc::vec::Vec<T> as core::ops::drop::Drop>::drop"
    );
    assert_eq!(s.symbol(r"C:\Users\Jane Doe\a.rs"), "<symbol>");
    assert_eq!(s.symbol("has \"quotes\""), "<symbol>");
    assert_eq!(s.symbol(""), "<symbol>");
    assert_eq!(s.symbol(&"a".repeat(MAX_SYMBOL + 1)), "<symbol>");
    assert_eq!(s.symbol("jdoe::run"), "<user>::run");
}

#[test]
fn modules_are_file_names_only() {
    let s = scrubber();
    assert_eq!(
        s.module(r"C:\Program Files\OpenNote\opennote.exe").as_deref(),
        Some("opennote.exe")
    );
    assert_eq!(s.module("ntdll.dll").as_deref(), Some("ntdll.dll"));
    assert_eq!(s.module(r"C:\Users\jdoe\Holiday Plans.dll"), None);
    assert_eq!(s.module("notes.txt"), None);
    assert_eq!(s.module(""), None);
}

#[test]
fn scrubbing_twice_changes_nothing() {
    let s = scrubber();
    for input in [
        r#"open C:\Users\jdoe\a b.json: "secret" by Jane Doe at https://x.example/y"#,
        // A placeholder can open a shape that the text it replaced did not.
        "mail a@b.example/home/x",
        "route 192.168.1.0/24",
        "by jdoe/home/x",
        "copied 'A' to \"B\" and `C`",
    ] {
        let once = s.text(input);
        assert_eq!(s.text(&once), once, "{input}");
    }
}

/// A small deterministic random generator, so a failure can be replayed.
struct Random(u64);

impl Random {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }

    fn pick<'a>(&mut self, items: &[&'a str]) -> &'a str {
        items[(self.next() % items.len() as u64) as usize]
    }

    /// A made-up note title of one to four words, with spaces, accents, and punctuation.
    fn title(&mut self) -> String {
        let words = [
            "Budget",
            "Ünïcode",
            "日本語",
            "Mum's",
            "draft",
            "Q3",
            "plan(1)",
            "ideas",
            "résumé",
            "Zebra",
            "#7",
        ];
        let count = 1 + self.next() % 4;
        (0..count).map(|_| self.pick(&words)).collect::<Vec<_>>().join(" ")
    }
}

#[test]
fn random_notes_never_survive_in_quotes_or_paths() {
    let mut random = Random(0x9E37_79B9_7F4A_7C15);
    for _ in 0..500 {
        let (title, folder) = (random.title(), random.title());
        let shapes = [
            format!("Parse(\"{title}\")"),
            format!("failed to open C:\\Users\\jdoe\\{folder}\\{title}.json: denied"),
            format!("failed to open /home/jdoe/{folder}/{title}.json"),
            format!("failed to open \\\\server\\share\\{folder}\\{title}.json"),
            format!("Err(Io {{ path: \"{folder}/{title}\" }})"),
        ];
        for shape in shapes {
            let out = scrubber().text(&shape);
            for secret in [&title, &folder] {
                assert!(
                    !out.contains(secret.as_str()),
                    "{secret:?} survived in {out:?} (from {shape:?})"
                );
            }
        }
    }
}

#[test]
fn counts_what_was_removed() {
    let s = scrubber();
    let out = s.text(
        r#"open C:\Users\jdoe\a.json for "Jane" at https://x.example/y, mail a@b.example, host 10.0.0.7, Taxes 2025"#,
    );
    let counts = Redactions::count(&out);
    assert_eq!(counts.paths, 1, "{out}");
    assert_eq!(counts.quoted, 1, "{out}");
    assert_eq!(counts.links, 1, "{out}");
    assert_eq!(counts.emails, 1, "{out}");
    assert_eq!(counts.ids, 1, "{out}");
    assert_eq!(counts.private, 1, "{out}");
    assert_eq!(counts.total(), 6);
    let mut sum = Redactions::default();
    sum.add(counts);
    sum.add(counts);
    assert_eq!(sum.total(), 12);
    assert_eq!(Redactions::count("nothing private here").total(), 0);
}
