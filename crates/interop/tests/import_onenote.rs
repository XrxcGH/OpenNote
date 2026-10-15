//! OneNote's own files (A3-17): section files, notebook packages, and notebook folders.
//!
//! The section files are written by `onenote::write` from the published format description. The package in
//! `tests/data/onenote/Trip.onepkg` was made by Windows' own `makecab` tool with MSZIP compression, so the
//! Cabinet reader is checked against an independent writer (see `src/onenote/README.md`).

use std::fs;
use std::path::{Path, PathBuf};

use opennote_core::model::{BlockData, Page};
use opennote_interop::onenote::write::{package, sample_section, section, PageSpec, ParaSpec, SectionSpec};
use opennote_interop::testing::{at, TestEnv};
use opennote_interop::{detect, import, import_onenote, ImportOptions, InteropError, MemorySink, Report, SourceKind};

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

fn run(path: &Path) -> (MemorySink, Report) {
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    let report = import_onenote(path, &world.env(), &mut sink).expect("imports");
    (sink, report)
}

fn write(dir: &Path, name: &str, bytes: &[u8]) -> PathBuf {
    let path = dir.join(name);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("makes the folder");
    }
    fs::write(&path, bytes).expect("writes the file");
    path
}

#[test]
fn a_section_file_becomes_pages_with_text_lists_tags_tables_pictures_and_files() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let file = write(dir.path(), "Travel.one", &sample_section());
    let found = detect(&file).expect("detects");
    assert_eq!((found.kind, found.supported), (SourceKind::OneNoteFile, true));
    let (sink, report) = run(&file);

    let titles: Vec<&str> = sink.pages.iter().map(|(_, p)| p.page.title.as_str()).collect();
    assert_eq!(
        titles,
        ["Trip plan", "Budget", "Receipts"],
        "the newest revision's title wins"
    );
    let trip = page(&sink, "Trip plan");
    let body = text(trip);
    assert!(body.contains("## Packing"), "{body}");
    assert!(body.contains("- [x] Bring the **passport**"), "{body}");
    assert!(body.contains("1. Book the train"), "{body}");
    assert!(
        body.contains("    - Window seat") || body.contains("   - Window seat"),
        "{body}"
    );
    assert!(trip.blocks.iter().any(|b| matches!(b.data, BlockData::Table(_))));
    assert!(trip.blocks.iter().any(|b| matches!(b.data, BlockData::Image(_))));
    assert!(trip.blocks.iter().any(|b| matches!(b.data, BlockData::File(_))));
    assert_eq!(trip.tags, ["To Do"]);
    assert_eq!(trip.created, at("2026-01-01T00:00:00Z"));
    assert_eq!(trip.modified, at("2026-01-02T00:00:00Z"));
    assert_eq!(page(&sink, "Budget").tags, ["Important"]);
    assert!(text(page(&sink, "Budget")).contains("Café: 40 €"));

    let section = &sink.sections[0];
    assert_eq!(section.title, "Travel");
    let budget = section.pages.iter().find(|p| p.title == "Budget").expect("listed");
    let receipts = section.pages.iter().find(|p| p.title == "Receipts").expect("listed");
    assert_eq!(
        receipts.parent,
        Some(budget.id),
        "a level 2 page is a subpage of the page above it"
    );

    let lines = report.to_markdown();
    assert!(
        lines.contains("1 item of a kind OpenNote cannot read"),
        "ink is reported: {lines}"
    );
    assert!(
        lines.contains("1 picture") && lines.contains("1 attached file"),
        "{lines}"
    );
}

#[test]
fn a_package_unpacks_its_sections_and_section_groups() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let one = sample_section();
    let pkg = package(&[
        ("Open Notebook.onetoc2", b"not read"),
        ("Travel.one", &one),
        ("Work\\Plans.one", &one),
        ("..\\escape.one", &one),
    ]);
    let file = write(dir.path(), "Notebook.onepkg", &pkg);
    let (sink, _) = run(&file);
    let mut names: Vec<&str> = sink.sections.iter().map(|s| s.title.as_str()).collect();
    names.sort_unstable();
    assert_eq!(
        names,
        ["Travel", "Work / Plans"],
        "the name that climbs out is not unpacked"
    );
    assert!(!dir.path().join("escape.one").exists());
    assert_eq!(sink.notebook.as_ref().map(|n| n.title.as_str()), Some("Notebook"));
}

#[test]
fn a_package_made_by_makecab_with_mszip_is_read() {
    let file = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/data/onenote/Trip.onepkg");
    let (sink, _) = run(&file);
    let mut names: Vec<&str> = sink.sections.iter().map(|s| s.title.as_str()).collect();
    names.sort_unstable();
    assert_eq!(names, ["Group / Budget", "Trip"]);
    // The picture of the first page sits in the onefiles folder, past the first 32 KB block of the cabinet.
    let trip = sink
        .pages
        .iter()
        .find(|(s, p)| {
            p.page.title == "Trip plan" && *s == sink.sections.iter().find(|x| x.title == "Trip").unwrap().id
        })
        .expect("the Trip page");
    assert!(trip.1.page.blocks.iter().any(|b| matches!(b.data, BlockData::Image(_))));
}

#[test]
fn a_folder_of_sections_skips_the_recycle_bin() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let root = dir.path().join("Notebook");
    write(&root, "A.one", &sample_section());
    write(&root, "OneNote_RecycleBin/OneNote_DeletedPages.one", &sample_section());
    write(&root, "Open Notebook.onetoc2", b"toc");
    assert_eq!(detect(&root).expect("detects").kind, SourceKind::OneNoteFile);
    let (sink, report) = run(&root);
    assert_eq!(sink.sections.len(), 1);
    assert!(report.to_markdown().contains("deleted pages"));
}

#[test]
fn password_protected_sections_are_skipped_with_advice() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let spec = SectionSpec {
        pages: vec![PageSpec {
            title: "Secret".into(),
            ..PageSpec::default()
        }],
        encrypted: true,
        ..SectionSpec::default()
    };
    write(dir.path(), "Locked.one", &section(&spec));
    write(dir.path(), "Open.one", &sample_section());
    let (sink, report) = run(dir.path());
    assert_eq!(sink.sections.len(), 1);
    assert!(report.to_markdown().contains("password-protected"));
}

#[test]
fn nodes_past_the_last_committed_transaction_are_ignored() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let spec = SectionSpec {
        pages: vec![PageSpec {
            title: "Kept".into(),
            paragraphs: vec![ParaSpec {
                runs: vec![("Body".into(), false)],
                ..ParaSpec::default()
            }],
            ..PageSpec::default()
        }],
        uncommitted_root: true,
        ..SectionSpec::default()
    };
    let file = write(dir.path(), "Half written.one", &section(&spec));
    let (sink, _) = run(&file);
    assert_eq!(page(&sink, "Kept").title, "Kept");
}

#[test]
fn a_damaged_section_fails_the_job_cleanly() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let mut bytes = sample_section();
    bytes.truncate(1500);
    let file = write(dir.path(), "Biology.one", &bytes);
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    let outcome = import(&file, &ImportOptions::default(), &world.env(), &mut sink);
    let Err(InteropError::Format { detail, .. }) = outcome else {
        panic!("a damaged file is a format error: {outcome:?}");
    };
    assert!(detail.contains("damaged"), "{detail}");
    assert!(sink.aborted && sink.pages.is_empty());
}

#[test]
fn the_table_of_contents_alone_is_refused_with_advice() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let file = write(dir.path(), "Open Notebook.onetoc2", b"toc");
    let Err(InteropError::Unsupported { why, .. }) = detect(&file) else {
        panic!("a table of contents holds no pages");
    };
    assert!(why.contains("folder"), "{why}");
}

/// The name of the picture in the onefiles folder of the makecab fixture.
const ONEBIN: &str = "6f1d7e2a-0b3c-4d5e-8f90-a1b2c3d4e5f6.onebin";

/// The picture of the makecab fixture: a PNG followed by 100 KB of varied text, so the cabinet needs several
/// MSZIP blocks that refer back to earlier ones.
fn fixture_picture() -> Vec<u8> {
    let mut bytes = opennote_interop::testing::png_bytes();
    let mut n = 7u32;
    while bytes.len() < 100_000 {
        n = n.wrapping_mul(1_103_515_245).wrapping_add(12_345);
        bytes.extend_from_slice(
            format!(
                "line {} of the notes {}
",
                n % 977,
                n % 13
            )
            .as_bytes(),
        );
    }
    bytes
}

#[test]
fn the_makecab_fixture_holds_the_sections_it_was_made_from() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/data/onenote/Trip.onepkg");
    let bytes = fs::read(path).expect("reads the fixture");
    let mut files = opennote_interop::onenote::unpack_for_tests(&bytes).expect("unpacks");
    files.sort();
    let names: Vec<&str> = files.iter().map(|(n, _)| n.as_str()).collect();
    assert_eq!(
        names,
        [r"Group\Budget.one", "Trip.one", &format!(r"Trip_onefiles\{ONEBIN}")]
    );
    assert_eq!(files[0].1, sample_section());
    assert_eq!(
        files[1].1,
        opennote_interop::onenote::write::sample_section_with_onefiles(ONEBIN)
    );
    assert_eq!(files[2].1, fixture_picture());
}

/// Writes the files of the makecab fixture into the folder named by `OPENNOTE_WRITE_ONENOTE_SAMPLE`.
#[test]
#[ignore = "writes fixture files on request"]
fn write_the_fixture_files() {
    if let Ok(dir) = std::env::var("OPENNOTE_WRITE_ONENOTE_SAMPLE") {
        let dir = PathBuf::from(dir);
        write(
            &dir,
            "Trip.one",
            &opennote_interop::onenote::write::sample_section_with_onefiles(ONEBIN),
        );
        write(&dir, "Group/Budget.one", &sample_section());
        write(&dir, &format!("Trip_onefiles/{ONEBIN}"), &fixture_picture());
    }
}

/// Imports every `.one` and `.onepkg` file in the folder named by `OPENNOTE_ONENOTE_CORPUS`, such as files that
/// OneNote saved, and prints only counts, never the notes themselves.
#[test]
#[ignore = "reads a folder of real OneNote files on request"]
fn real_files_from_a_corpus_folder() {
    let Ok(dir) = std::env::var("OPENNOTE_ONENOTE_CORPUS") else {
        return;
    };
    for entry in fs::read_dir(dir).expect("reads the folder").flatten() {
        let path = entry.path();
        let world = TestEnv::new();
        let mut sink = MemorySink::default();
        match import_onenote(&path, &world.env(), &mut sink) {
            Ok(report) => {
                let blocks: usize = sink.pages.iter().map(|(_, p)| p.page.blocks.len()).sum();
                let (simplified, skipped) = report.loss_counts();
                println!(
                    "{} sections, {} pages, {blocks} blocks, {simplified} simplified, {skipped} skipped",
                    sink.sections.len(),
                    sink.pages.len()
                );
                for group in report.loss_groups() {
                    println!("  {group:?}");
                }
            }
            Err(error) => println!("failed: {error}"),
        }
    }
}
