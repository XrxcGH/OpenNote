//! The fixture corpus: one small export from each source app, imported without errors.
//!
//! `tests/corpus/README.md` says where each case comes from. Every case is detected, previewed, imported into
//! memory, and then written through the core's own storage into a folder that a real core opens and verifies.

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use opennote_core::session::core::{Core, CoreConfig};
use opennote_core::testing::fakes::NullSink;
use opennote_interop::testing::{zip_dir, TestEnv};
use opennote_interop::{detect, import, preview, DiskSink, ImportOptions, MemorySink, SourceKind};

/// One case: where the input is, what it is, and what the import should make.
struct Case {
    name: &'static str,
    /// Makes the input in a temp folder, or points into the corpus.
    input: fn(&Path) -> PathBuf,
    kind: SourceKind,
    pages: usize,
    sections: usize,
}

fn corpus(path: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests").join(path)
}

fn packed_docx(temp: &Path) -> PathBuf {
    let file = temp.join("onenote-section.docx");
    fs::write(&file, zip_dir(&corpus("corpus/word/onenote-section"))).expect("writes the docx");
    file
}

fn zipped_notion(temp: &Path) -> PathBuf {
    let file = temp.join("Notion export.zip");
    fs::write(&file, zip_dir(&corpus("corpus/notion/Export"))).expect("writes the zip");
    file
}

const CASES: &[Case] = &[
    Case {
        name: "Obsidian vault",
        input: |_| corpus("corpus/obsidian/Vault"),
        kind: SourceKind::Markdown,
        pages: 2,
        sections: 2,
    },
    Case {
        name: "Joplin export",
        input: |_| corpus("corpus/joplin/Export"),
        kind: SourceKind::Markdown,
        pages: 2,
        sections: 1,
    },
    Case {
        name: "Logseq graph",
        input: |_| corpus("corpus/logseq/graph"),
        kind: SourceKind::Markdown,
        pages: 3,
        sections: 2,
    },
    Case {
        name: "Notion folder",
        input: |_| corpus("corpus/notion/Export"),
        kind: SourceKind::Notion,
        pages: 4,
        sections: 1,
    },
    Case {
        name: "Notion ZIP",
        input: zipped_notion,
        kind: SourceKind::Notion,
        pages: 4,
        sections: 1,
    },
    Case {
        name: "Evernote ENEX",
        input: |_| corpus("data/sample.enex"),
        kind: SourceKind::Evernote,
        pages: 2,
        sections: 1,
    },
    Case {
        name: "OneNote Word export",
        input: packed_docx,
        kind: SourceKind::Word,
        pages: 2,
        sections: 1,
    },
    Case {
        name: "OneNote web page archive",
        input: |_| corpus("corpus/onenote-mht/Lecture 3.mht"),
        kind: SourceKind::WebArchive,
        pages: 1,
        sections: 1,
    },
    Case {
        name: "HTML folder",
        input: |_| corpus("corpus/html/site"),
        kind: SourceKind::Html,
        pages: 3,
        sections: 2,
    },
    Case {
        name: "Text folder",
        input: |_| corpus("corpus/text/notes"),
        kind: SourceKind::Text,
        pages: 3,
        sections: 2,
    },
    Case {
        name: "Google Keep Takeout",
        input: |_| corpus("corpus/keep/Takeout"),
        kind: SourceKind::GoogleKeep,
        pages: 3,
        sections: 1,
    },
    Case {
        name: "Bear TextBundles",
        input: |_| corpus("corpus/textbundle/Bear"),
        kind: SourceKind::TextBundle,
        pages: 2,
        sections: 1,
    },
    Case {
        name: "Windows Sticky Notes",
        input: |_| corpus("corpus/sticky/LocalState"),
        kind: SourceKind::StickyNotes,
        pages: 4,
        sections: 1,
    },
    Case {
        name: "CSV files",
        input: |_| corpus("corpus/csv/data"),
        kind: SourceKind::Csv,
        pages: 2,
        sections: 1,
    },
];

#[test]
fn every_case_is_detected_and_imports_without_errors() {
    for case in CASES {
        let temp = tempfile::tempdir().expect("a temp folder");
        let input = (case.input)(temp.path());
        let found = detect(&input).unwrap_or_else(|e| panic!("{}: {e}", case.name));
        assert_eq!(found.kind, case.kind, "{}", case.name);
        assert!(found.supported, "{}", case.name);

        let world = TestEnv::new();
        let mut sink = MemorySink::default();
        let report = import(&input, &ImportOptions::default(), &world.env(), &mut sink)
            .unwrap_or_else(|e| panic!("{}: {e}", case.name));
        assert_eq!(sink.pages.len(), case.pages, "{}: pages", case.name);
        assert_eq!(sink.sections.len(), case.sections, "{}: sections", case.name);
        assert!(sink.finished, "{}", case.name);
        assert_eq!(report.pages.len(), case.pages, "{}: report pages", case.name);
        let broken: Vec<_> = report
            .general
            .entries
            .iter()
            .filter(|e| {
                e.why
                    .as_deref()
                    .is_some_and(|w| w.contains("could not") || w.contains("is not readable"))
            })
            .collect();
        assert!(broken.is_empty(), "{}: errors in the report: {broken:?}", case.name);
        for (_, page) in &sink.pages {
            assert!(
                !page.page.title.trim().is_empty(),
                "{}: every page has a title",
                case.name
            );
        }
    }
}

#[test]
fn a_preview_of_every_case_agrees_with_its_import() {
    for case in CASES {
        let temp = tempfile::tempdir().expect("a temp folder");
        let input = (case.input)(temp.path());
        let world = TestEnv::new();
        let result =
            preview(&input, &ImportOptions::default(), &world.env()).unwrap_or_else(|e| panic!("{}: {e}", case.name));
        assert_eq!(result.pages, case.pages, "{}", case.name);
        assert_eq!(result.sections.len(), case.sections, "{}", case.name);
        assert_eq!(
            result.sections.iter().map(|s| s.pages).sum::<usize>(),
            case.pages,
            "{}",
            case.name
        );
    }
}

#[test]
fn every_case_written_through_the_core_opens_and_verifies_clean() {
    let data = tempfile::tempdir().expect("a temp folder");
    let config = CoreConfig::production(data.path().to_path_buf(), "test".to_owned()).expect("a core config");
    let core = Core::start(config, Arc::new(NullSink), None).expect("a core");
    for case in CASES {
        let temp = tempfile::tempdir().expect("a temp folder");
        let input = (case.input)(temp.path());
        let library = tempfile::tempdir().expect("a temp folder");
        let world = TestEnv::new();
        let mut sink = DiskSink::standard(library.path());
        import(&input, &ImportOptions::default(), &world.env(), &mut sink)
            .unwrap_or_else(|e| panic!("{}: {e}", case.name));
        let dir = sink.notebook_dir().expect("the import finished").to_path_buf();
        let notebook = core
            .open_notebook(&dir)
            .unwrap_or_else(|e| panic!("{}: {e}", case.name));
        let verify = notebook.verify().unwrap_or_else(|e| panic!("{}: {e}", case.name));
        assert!(verify.is_clean(), "{}: {:?}", case.name, verify.problems);
        let pages: usize = notebook.tree().sections.iter().map(|s| s.pages.len()).sum();
        assert_eq!(pages, case.pages, "{}", case.name);
        notebook.close().expect("closes");
    }
    core.shutdown(std::time::Duration::from_secs(5));
}

/// Runs the corpus checks on real exports in the folder named by `OPENNOTE_CORPUS`.
#[test]
#[ignore = "needs OPENNOTE_CORPUS to name a folder of exports"]
fn donated_exports_import_without_errors() {
    let Some(dir) = std::env::var_os("OPENNOTE_CORPUS") else {
        eprintln!("OPENNOTE_CORPUS is not set, so there is nothing to check");
        return;
    };
    let mut entries: Vec<_> = fs::read_dir(&dir).expect("lists the corpus folder").flatten().collect();
    entries.sort_by_key(fs::DirEntry::file_name);
    let mut failures = Vec::new();
    for entry in entries {
        let path = entry.path();
        let world = TestEnv::new();
        let mut sink = MemorySink::default();
        match import(&path, &ImportOptions::default(), &world.env(), &mut sink) {
            Ok(report) => {
                let (changed, skipped) = report.loss_counts();
                println!(
                    "{}: {} pages, {changed} changed, {skipped} parts skipped",
                    entry.file_name().to_string_lossy(),
                    report.pages.len()
                );
            }
            Err(error) => failures.push(format!("{}: {error}", entry.file_name().to_string_lossy())),
        }
    }
    assert!(failures.is_empty(), "imports that stopped:\n{}", failures.join("\n"));
}
