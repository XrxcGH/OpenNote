//! Goodnotes, Notability, and Samsung Notes files (ADR 0053), from synthetic packages built in the documented
//! layouts: detection, the import job, a written notebook that the core opens and verifies, and the corpus of
//! malformed packages in `corpus/notes-apps`, each of which must import or be refused quickly and without a panic.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use opennote_core::format::CanonicalCodec;
use opennote_core::limits::Limits;
use opennote_core::session::core::{Core, CoreConfig};
use opennote_core::session::page::read_page_dir;
use opennote_core::store::std_fs::StdFs;
use opennote_core::testing::fakes::NullSink;
use opennote_core::Timings;
use opennote_interop::import::notes_apps_fuzzing::fixtures;
use opennote_interop::testing::{zip_bytes, TestEnv};
use opennote_interop::{
    detect, fuzzing, import, import_notes_apps, DiskSink, ImportOptions, InteropError, MemorySink, Outcome, SourceKind,
};

fn write(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
    let path = dir.join(name);
    fs::write(&path, bytes).expect("writes the fixture");
    path
}

#[test]
fn synthetic_notes_app_files_are_told_by_extension_and_package() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let note = write(dir.path(), "Bio.note", &fixtures::notability_note());
    let found = detect(&note).expect("detects");
    assert_eq!(
        (found.kind, found.label.as_str()),
        (SourceKind::NotesApp, "Notability note")
    );
    let goodnotes = write(dir.path(), "Phys.goodnotes", &fixtures::goodnotes_document());
    assert_eq!(detect(&goodnotes).expect("detects").label, "Goodnotes document");
    let samsung = write(dir.path(), "Trip.sdocx", &fixtures::samsung_note());
    assert_eq!(detect(&samsung).expect("detects").label, "Samsung Notes note");

    let plain = write(dir.path(), "Old.note", b"a text note from another app");
    match detect(&plain) {
        Err(InteropError::Unsupported { why, .. }) => assert!(why.contains("export the note as a PDF in Notability")),
        other => panic!("a plain .note file is refused, not {other:?}"),
    }
    let pdf = write(dir.path(), "Export.pdf", b"%PDF-1.7\n");
    match detect(&pdf) {
        Err(InteropError::Unsupported { why, .. }) => assert!(why.contains("Goodnotes, Notability, or Samsung Notes")),
        other => panic!("a PDF is pointed at Import PDF, not {other:?}"),
    }

    let backup = dir.path().join("Backup");
    fs::create_dir_all(&backup).expect("a folder");
    write(&backup, "A.goodnotes", &fixtures::goodnotes_document());
    write(&backup, "B.goodnotes", &fixtures::goodnotes_document());
    assert_eq!(detect(&backup).expect("detects").kind, SourceKind::NotesApp);
    let zipped = write(
        dir.path(),
        "Backup.zip",
        &zip_bytes(&[("School/A.goodnotes", &fixtures::goodnotes_document())]),
    );
    let found = detect(&zipped).expect("detects");
    assert_eq!((found.kind, found.zipped), (SourceKind::NotesApp, true));
}

#[test]
fn a_zipped_synthetic_goodnotes_backup_imports_through_the_job_with_its_folders() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let zipped = write(
        dir.path(),
        "Backup.zip",
        &zip_bytes(&[
            ("School/Physics.goodnotes", &fixtures::goodnotes_document()),
            ("Lab.sdocx", &fixtures::samsung_note()),
        ]),
    );
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    let report = import(&zipped, &ImportOptions::default(), &world.env(), &mut sink).expect("imports");
    assert_eq!(report.pages.len(), 4);
    let mut sections: Vec<String> = sink.sections.iter().map(|s| s.title.clone()).collect();
    sections.sort();
    assert_eq!(sections, ["Lab", "School / Physics"]);
    assert!(sink.finished);
}

#[test]
fn a_synthetic_notability_import_written_to_disk_opens_verifies_and_keeps_its_strokes() {
    let source = tempfile::tempdir().expect("a temp folder");
    let note = write(source.path(), "Biology.note", &fixtures::notability_note());
    let library = tempfile::tempdir().expect("a temp folder");
    let world = TestEnv::new();
    let mut sink = DiskSink::standard(library.path());
    import_notes_apps(&note, &world.env(), &mut sink).expect("imports");
    let dir = sink.notebook_dir().expect("the import finished").to_path_buf();

    let data = tempfile::tempdir().expect("a temp folder");
    let config = CoreConfig::production(data.path().to_path_buf(), "test".to_owned()).expect("a core config");
    let core = Core::start(config, Arc::new(NullSink), None).expect("a core");
    let notebook = core.open_notebook(&dir).expect("the core opens the import");
    let verify = notebook.verify().expect("verifies");
    assert!(verify.is_clean(), "problems: {:?}", verify.problems);
    notebook.close().expect("closes");
    core.shutdown(Duration::from_secs(5));

    let fs = StdFs::new(&Timings::default());
    let page_dir = find_page_dir(&dir).expect("a page folder");
    let loaded = read_page_dir(&fs, &CanonicalCodec, &page_dir, &Limits::default()).expect("reads the page");
    assert_eq!(loaded.page.ink.len(), 2);
    assert_eq!(loaded.page.title, "Biology");
}

fn find_page_dir(dir: &Path) -> Option<PathBuf> {
    for entry in fs::read_dir(dir).ok()?.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if path.join("page.json").is_file() {
                return Some(path);
            }
            if let Some(found) = find_page_dir(&path) {
                return Some(found);
            }
        }
    }
    None
}

#[test]
fn every_malformed_package_in_the_corpus_returns_quickly_without_a_panic() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/corpus/notes-apps");
    let mut seen = 0;
    for entry in fs::read_dir(&root).expect("lists the corpus").flatten() {
        let path = entry.path();
        let bytes = fs::read(&path).expect("reads");
        let started = Instant::now();
        fuzzing::notes_app(&bytes);
        let world = TestEnv::new();
        let mut sink = MemorySink::default();
        let outcome = import_notes_apps(&path, &world.env(), &mut sink);
        let took = started.elapsed();
        assert!(took < Duration::from_secs(20), "{} took {took:?}", path.display());
        if let Ok(report) = &outcome {
            let total: usize =
                report.pages.iter().map(|p| p.entries.len()).sum::<usize>() + report.general.entries.len();
            assert!(total > 0, "{} says what happened", path.display());
        }
        seen += 1;
    }
    assert!(seen >= 10, "the corpus holds its files");

    // The bomb's picture is left out, and its page still comes in.
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    let report = import_notes_apps(&root.join("bomb.sdocx"), &world.env(), &mut sink).expect("imports");
    assert!(report
        .general
        .entries
        .iter()
        .any(|e| e.outcome == Outcome::Skipped && e.what == "media/zeros.jpg"));
    assert_eq!(sink.pages.len(), 1);
}
