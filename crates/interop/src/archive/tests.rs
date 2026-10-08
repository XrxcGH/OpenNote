//! Tests of the ZIP reader: dates, roots, names that leave the folder or that Windows refuses, and Cancel.

use std::io::Cursor;

use super::*;
use crate::docx::zip::ZipWriter;

fn archive(files: &[(&str, &[u8])]) -> Vec<u8> {
    let mut zip = ZipWriter::new();
    for (name, data) in files {
        zip.add(name, data).expect("adds");
    }
    zip.finish().expect("finishes")
}

#[test]
fn reads_stored_and_deflated_entries_by_name() {
    let big = "abc".repeat(1000).into_bytes();
    let bytes = archive(&[("dir/big.txt", &big), ("small.bin", b"x")]);
    let mut zip = ZipArchive::new(Cursor::new(bytes), ArchiveLimits::default()).expect("opens");
    assert_eq!(zip.entries().len(), 2);
    assert_eq!(zip.read_named("dir/big.txt").expect("reads"), big);
    assert_eq!(zip.read_named("SMALL.bin").expect("reads"), b"x");
    assert!(zip.read_named("missing").is_err());
}

#[test]
fn a_damaged_entry_fails_its_check() {
    let mut bytes = archive(&[("a.txt", b"hello world")]);
    let at = bytes
        .windows(11)
        .position(|w| w == b"hello world")
        .expect("stored data");
    bytes[at] = b'J';
    let mut zip = ZipArchive::new(Cursor::new(bytes), ArchiveLimits::default()).expect("opens");
    assert!(matches!(zip.read(0), Err(InteropError::Format { .. })));
}

#[test]
fn an_entry_over_the_limit_is_refused() {
    let bytes = archive(&[("a.txt", &[7u8; 5000])]);
    let limits = ArchiveLimits {
        entry_bytes: 100,
        ..ArchiveLimits::default()
    };
    let mut zip = ZipArchive::new(Cursor::new(bytes), limits).expect("opens");
    assert!(matches!(zip.read(0), Err(InteropError::TooBig(_))));
}

#[test]
fn dos_dates_become_times_and_a_single_top_folder_can_be_stripped() {
    let time = dos_to_system_time(20_573, 25_692).expect("a valid DOS time");
    let seconds = time
        .duration_since(std::time::UNIX_EPOCH)
        .expect("after 1970")
        .as_secs();
    assert_eq!(seconds, 1_582_979_696, "2020-02-29 12:34:56 UTC");
    assert!(dos_to_system_time(0, 0).is_none(), "month 0 is not a date");

    let bytes = archive(&[
        ("Export/a.md", b"a"),
        ("Export/sub/b.md", b"b"),
        ("__MACOSX/Export/._a.md", b"x"),
    ]);
    let mut zip = ZipArchive::new(Cursor::new(bytes), ArchiveLimits::default()).expect("opens");
    assert_eq!(zip.common_root().as_deref(), Some("Export"));
    let dir = tempfile::tempdir().expect("a temp folder");
    zip.extract(dir.path(), true, &mut Vec::new(), &Control::none())
        .expect("extracts");
    assert!(dir.path().join("a.md").is_file() && dir.path().join("sub/b.md").is_file());
    let two = archive(&[("a.md", b"a"), ("dir/b.md", b"b")]);
    let zip = ZipArchive::new(Cursor::new(two), ArchiveLimits::default()).expect("opens");
    assert_eq!(zip.common_root(), None);
}

#[test]
fn something_that_is_not_a_zip_is_a_format_error() {
    let result = ZipArchive::new(Cursor::new(b"just some text".to_vec()), ArchiveLimits::default());
    assert!(matches!(result, Err(InteropError::Format { .. })));
}

#[test]
fn extraction_stays_inside_the_folder() {
    let bytes = archive(&[
        ("ok/a.txt", b"a"),
        ("../evil.txt", b"x"),
        ("/abs.txt", b"x"),
        ("c:/drive.txt", b"x"),
    ]);
    let mut zip = ZipArchive::new(Cursor::new(bytes), ArchiveLimits::default()).expect("opens");
    let dir = tempfile::tempdir().expect("a temp folder");
    let mut skipped = Vec::new();
    let written = zip
        .extract(dir.path(), false, &mut skipped, &Control::none())
        .expect("extracts");
    // A leading slash is dropped, and a drive letter's colon is cleaned, so both files land inside the folder.
    // The name that climbs out is refused.
    assert_eq!(written.len(), 3);
    assert!(dir.path().join("ok/a.txt").is_file() && dir.path().join("abs.txt").is_file());
    assert!(dir.path().join("c_/drive.txt").is_file());
    assert_eq!(skipped.len(), 1, "{skipped:?}");
    assert!(!dir.path().parent().expect("a parent").join("evil.txt").exists());
}

#[test]
fn names_windows_refuses_unpack_under_clean_names() {
    let bytes = archive(&[
        ("Vault/What is a cell?.md", b"a"),
        ("Vault/CON.md", b"b"),
        ("Vault/aux/notes.md", b"c"),
        ("Vault/Plan: week 1.md", b"d"),
        ("Vault/ends with a dot.", b"e"),
    ]);
    let mut zip = ZipArchive::new(Cursor::new(bytes), ArchiveLimits::default()).expect("opens");
    let dir = tempfile::tempdir().expect("a temp folder");
    let mut skipped = Vec::new();
    let written = zip
        .extract(dir.path(), true, &mut skipped, &Control::none())
        .expect("extracts");
    assert!(skipped.is_empty(), "{skipped:?}");
    assert_eq!(written.len(), 5);
    for name in [
        "What is a cell_.md",
        "CON_.md",
        "aux_/notes.md",
        "Plan_ week 1.md",
        "ends with a dot",
    ] {
        assert!(dir.path().join(name).is_file(), "{name}");
    }
}

#[test]
fn a_canceled_extraction_stops_before_the_next_entry() {
    let bytes = archive(&[("a.md", b"a"), ("b.md", b"b")]);
    let mut zip = ZipArchive::new(Cursor::new(bytes), ArchiveLimits::default()).expect("opens");
    let dir = tempfile::tempdir().expect("a temp folder");
    let token = crate::run::CancelToken::new();
    token.cancel();
    let control = Control::with_cancel(token);
    let outcome = zip.extract(dir.path(), false, &mut Vec::new(), &control);
    assert!(matches!(outcome, Err(InteropError::Canceled)));
    assert!(!dir.path().join("a.md").exists());
}
