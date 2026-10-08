//! Imports from Windows Sticky Notes, read from the app's SQLite file and its write-ahead log.
//!
//! The fixture in `tests/corpus/sticky/LocalState` was written by SQLite itself: five notes in the main file, and
//! in the log a sixth note, a picture, and a change to the second note.

use std::fs;
use std::path::{Path, PathBuf};

use opennote_core::model::{BlockData, Color, Page};
use opennote_interop::sqlite::{Database, Value};
use opennote_interop::testing::{at, TestEnv};
use opennote_interop::{detect, import, import_sticky_notes, ImportOptions, MemorySink, Outcome, SourceKind};

fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/corpus/sticky/LocalState")
}

fn page<'a>(sink: &'a MemorySink, title: &str) -> &'a Page {
    &sink
        .pages
        .iter()
        .find(|(_, p)| p.page.title == title)
        .unwrap_or_else(|| panic!("a page titled {title}"))
        .1
        .page
}

fn text(page: &Page) -> String {
    page.blocks
        .iter()
        .filter_map(|b| match &b.data {
            BlockData::Text(t) => Some(t.markdown.to_string()),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("\n\n")
}

fn run(path: &Path) -> (MemorySink, opennote_interop::Report) {
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    let report = import_sticky_notes(path, &world.env(), &mut sink).expect("imports");
    (sink, report)
}

#[test]
fn the_reader_finds_the_tables_and_rows_of_a_real_sqlite_file() {
    let database = Database::open(&fixture().join("plum.sqlite")).expect("opens");
    let note = database.table("note").expect("a Note table");
    assert!(note.has_column("Theme") && note.has_column("UpdatedAt"));
    assert!(database.table("Media").is_some());
    let mut ids = Vec::new();
    database
        .for_each_row(note, &mut |row| {
            ids.push(row.text("Id").to_owned());
            Ok(())
        })
        .expect("walks");
    assert_eq!(ids, ["note-1", "note-2", "note-3", "note-4", "note-5", "note-6"]);
}

#[test]
fn the_log_holds_rows_and_changes_newer_than_the_main_file() {
    // Without the log the file would show five notes and the old text of the second.
    let main_only = fs::read(fixture().join("plum.sqlite")).expect("reads");
    let database = Database::from_bytes(main_only, None).expect("opens");
    let mut texts = Vec::new();
    database
        .for_each_row(database.table("Note").expect("a Note table"), &mut |row| {
            texts.push(row.text("Text").to_owned());
            Ok(())
        })
        .expect("walks");
    assert_eq!(texts.len(), 5);
    assert!(texts[1].contains("Physics lab\r"));

    let with_log = Database::open(&fixture().join("plum.sqlite")).expect("opens");
    let mut media = 0;
    with_log
        .for_each_row(with_log.table("Media").expect("a Media table"), &mut |row| {
            assert_eq!(row.get("Data"), &Value::Blob(b"\x89PNG fake".to_vec()));
            media += 1;
            Ok(())
        })
        .expect("walks");
    assert_eq!(media, 1);
}

#[test]
fn notes_become_pages_with_colors_dates_and_the_newest_text() {
    let (sink, report) = run(&fixture());
    let mut titles: Vec<&str> = sink.pages.iter().map(|(_, p)| p.page.title.as_str()).collect();
    titles.sort_unstable();
    assert_eq!(
        titles,
        [
            "Added while the app was open",
            "Groceries",
            // A title is cut to 80 characters.
            "Line 1 of a long note that reaches past one page of the file, so that its text i",
            "Physics lab (updated)",
        ]
    );
    assert_eq!(sink.notebook.as_ref().expect("a notebook").title, "Sticky Notes");
    assert_eq!(sink.sections.len(), 1);
    assert_eq!(sink.sections[0].title, "Sticky Notes");

    let groceries = page(&sink, "Groceries");
    assert_eq!(text(groceries), "Groceries\n\nmilk\n\neggs");
    assert_eq!(groceries.created, at("2024-01-05T14:30:00Z"));
    assert_eq!(groceries.modified, at("2024-01-05T15:30:00Z"));
    assert!(text(page(&sink, "Physics lab (updated)")).contains("Room 204"));

    // A long note keeps every line, though its text sits on overflow pages.
    let long = sink
        .pages
        .iter()
        .map(|(_, p)| &p.page)
        .find(|p| p.title.starts_with("Line 1 "))
        .expect("the long note");
    assert!(text(long).contains("Line 119 of a long note"));

    // The pages list their colors in the section file.
    let colors: Vec<(String, Option<Color>)> = sink.sections[0]
        .pages
        .iter()
        .map(|e| (e.title.clone(), e.color.clone()))
        .collect();
    assert!(colors.contains(&("Groceries".to_owned(), Color::parse("amber").ok())));
    assert!(colors.contains(&("Physics lab (updated)".to_owned(), Color::parse("indigo").ok())));
    assert!(colors.contains(&("Added while the app was open".to_owned(), Color::parse("ink").ok())));

    assert_eq!(report.pages.len(), 4);
}

#[test]
fn trashed_and_empty_notes_and_pictures_are_reported() {
    let (_, report) = run(&fixture());
    let skipped: Vec<&str> = report
        .general
        .entries
        .iter()
        .filter(|e| e.outcome == Outcome::Skipped)
        .filter_map(|e| e.why.as_deref())
        .collect();
    assert!(skipped.iter().any(|w| w.contains("trash")), "{skipped:?}");
    assert!(skipped.iter().any(|w| w.contains("empty")), "{skipped:?}");
    let picture_note = report
        .pages
        .iter()
        .find(|p| p.title == "Added while the app was open")
        .expect("its report");
    assert!(
        picture_note
            .entries
            .iter()
            .any(|e| e.outcome == Outcome::CameOver && e.what.contains("picture")),
        "{picture_note:?}"
    );
}

#[test]
fn the_file_is_detected_alone_in_a_folder_and_through_the_job() {
    let found = detect(&fixture().join("plum.sqlite")).expect("known");
    assert_eq!(found.kind, SourceKind::StickyNotes);
    assert_eq!(detect(&fixture()).expect("known").kind, SourceKind::StickyNotes);

    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    import(
        &fixture().join("plum.sqlite"),
        &ImportOptions::default(),
        &world.env(),
        &mut sink,
    )
    .expect("imports");
    assert_eq!(sink.pages.len(), 4);
}

#[test]
fn other_databases_and_old_sticky_notes_files_get_advice() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let other = dir.path().join("other.sqlite");
    fs::write(&other, b"not a database").expect("writes");
    assert!(detect(&other).is_err());
    let old = dir.path().join("StickyNotes.snt");
    fs::write(&old, b"x").expect("writes");
    let error = detect(&old).expect_err("not supported").to_string();
    assert!(error.contains("plum.sqlite"), "{error}");
}

#[test]
fn damaged_copies_stop_with_an_error_and_never_panic() {
    let original = fs::read(fixture().join("plum.sqlite")).expect("reads");
    let log = fs::read(fixture().join("plum.sqlite-wal")).expect("reads");
    let dir = tempfile::tempdir().expect("a temp folder");
    let mut state = 0x2545_f491_4f6c_dd1du64;
    let mut next = move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        state
    };
    for round in 0..120 {
        let mut bytes = original.clone();
        match round % 3 {
            0 => bytes.truncate((next() as usize) % bytes.len()),
            1 => {
                for _ in 0..6 {
                    let at = (next() as usize) % bytes.len();
                    bytes[at] = (next() & 0xff) as u8;
                }
            }
            _ => {
                let at = 4096 + (next() as usize) % (bytes.len() - 4096);
                bytes[at..].fill(0xff);
            }
        }
        let file = dir.path().join("plum.sqlite");
        fs::write(&file, &bytes).expect("writes");
        fs::write(
            dir.path().join("plum.sqlite-wal"),
            &log[..(next() as usize) % log.len()],
        )
        .expect("writes");
        let world = TestEnv::new();
        let _ = import_sticky_notes(dir.path(), &world.env(), &mut MemorySink::default());
    }
}
