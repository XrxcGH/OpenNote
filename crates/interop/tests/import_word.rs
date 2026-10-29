//! Word files as OneNote and Word write them: titles, date lines, lists, tables, pictures, and what is left out.

use std::fs;
use std::path::PathBuf;

use opennote_core::model::{BlockData, Page};
use opennote_interop::testing::{at, zip_dir, TestEnv};
use opennote_interop::{import_docx, import_docx_with, InteropError, MemorySink, Report, WordPages};

fn corpus(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/corpus/word")
        .join(name)
}

/// Packs the unpacked parts of a corpus case into a `.docx` file in a temp folder.
fn docx_of(case: &str, dir: &std::path::Path) -> PathBuf {
    let path = dir.join(format!("{case}.docx"));
    fs::write(&path, zip_dir(&corpus(case))).expect("writes the docx");
    path
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

fn import(pages: WordPages) -> (MemorySink, Report) {
    let dir = tempfile::tempdir().expect("a temp folder");
    let file = docx_of("onenote-section", dir.path());
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    let report = import_docx_with(&file, pages, &world.env(), &mut sink).expect("imports");
    (sink, report)
}

fn page<'a>(sink: &'a MemorySink, title: &str) -> &'a Page {
    &sink
        .pages
        .iter()
        .find(|(_, p)| p.page.title == title)
        .expect("a page")
        .1
        .page
}

#[test]
fn a_section_exported_by_onenote_becomes_pages_with_their_dates() {
    let (sink, _) = import(WordPages::Auto);
    assert_eq!(
        sink.notebook.as_ref().map(|n| n.title.as_str()),
        Some("onenote-section")
    );
    let titles: Vec<&str> = sink.pages.iter().map(|(_, p)| p.page.title.as_str()).collect();
    assert_eq!(titles, ["Lecture 3: Cell division", "Lecture 4: Genetics"]);
    let first = page(&sink, "Lecture 3: Cell division");
    assert_eq!(
        first.created,
        at("2026-10-02T10:15:00Z"),
        "the date and time lines under the title"
    );
    assert_eq!(first.tags, ["biology", "lectures"]);
    assert!(
        !text(first).contains("Friday, October 2"),
        "the date lines are not repeated in the text"
    );
    let second = page(&sink, "Lecture 4: Genetics");
    assert_eq!(
        second.created,
        at("2026-09-01T08:00:00Z"),
        "a page without date lines takes the file's date"
    );
    assert!(text(second).contains("> Nothing in biology"), "{}", text(second));
}

#[test]
fn text_formatting_links_lists_and_tasks_come_over() {
    let (sink, _) = import(WordPages::Auto);
    let body = text(page(&sink, "Lecture 3: Cell division"));
    assert!(body.contains("# Mitosis"), "{body}");
    assert!(body.contains("**four**"), "{body}");
    assert!(body.contains("[this page](https://example.org/mitosis)"), "{body}");
    assert!(
        !body.contains("onenote:"),
        "links to OneNote itself are dropped: {body}"
    );
    assert!(body.contains("the notebook."), "{body}");
    assert!(
        body.contains("- Prophase") && body.contains("  - *chromosomes condense*"),
        "{body}"
    );
    assert!(body.contains("- Metaphase"), "{body}");
    assert!(body.contains("1. First, copy the DNA"), "{body}");
    assert!(
        body.contains("- [ ] Review slides") && body.contains("- [x] Read chapter 5"),
        "{body}"
    );
    assert!(body.contains("An idea"), "{body}");
    assert!(!body.contains("secret"), "hidden text stays out: {body}");
}

#[test]
fn tables_pictures_and_text_boxes_are_read_and_the_rest_is_reported() {
    let (sink, report) = import(WordPages::Auto);
    let first = page(&sink, "Lecture 3: Cell division");
    let table = first
        .blocks
        .iter()
        .find_map(|b| match &b.data {
            BlockData::Table(t) => Some(t),
            _ => None,
        })
        .expect("a table");
    assert!(table.header);
    assert_eq!(table.columns.len(), 3, "the merged cell keeps the width");
    let row = &table.rows[1];
    assert_eq!(
        row.cells[&table.columns[1].id].markdown, "Chromatids part\\\nCell elongates",
        "a hard break inside a cell"
    );
    let images: Vec<_> = first
        .blocks
        .iter()
        .filter_map(|b| match &b.data {
            BlockData::Image(i) => Some(i),
            _ => None,
        })
        .collect();
    assert_eq!(
        images.len(),
        1,
        "the EMF picture that is not in the file is not an image"
    );
    assert_eq!(images[0].alt, "A cell under the microscope");
    let body = text(first);
    assert!(
        body.contains("Remember the stages") && !body.contains("fallback"),
        "{body}"
    );
    assert!(body.contains("Old diagram"), "{body}");
    let markdown = report.to_markdown();
    for expected in [
        "merged table cell",
        "text box",
        "footnote",
        "hidden text",
        "2 pages",
        "image that could not be read",
    ] {
        assert!(
            markdown.contains(expected),
            "the report names {expected:?}:\n{markdown}"
        );
    }
}

#[test]
fn the_split_can_be_chosen() {
    let (single, _) = import(WordPages::Single);
    assert_eq!(single.pages.len(), 1);
    assert_eq!(single.pages[0].1.page.title, "Lecture 3: Cell division");
    let (by_break, _) = import(WordPages::ByPageBreak);
    assert_eq!(by_break.pages.len(), 2);
}

#[test]
fn things_that_are_not_word_files_fail_with_a_clear_error() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let bogus = dir.path().join("notes.docx");
    fs::write(&bogus, "this is text").expect("writes");
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    let report = import_docx(&bogus, &world.env(), &mut sink).expect("the failure is reported, not raised");
    assert!(sink.pages.is_empty());
    assert!(
        report.to_markdown().contains("not a ZIP file"),
        "{}",
        report.to_markdown()
    );

    let empty = dir.path().join("empty");
    fs::create_dir_all(&empty).expect("creates");
    let outcome = import_docx(&empty, &world.env(), &mut MemorySink::default());
    assert!(matches!(outcome, Err(InteropError::Format { .. })));
}
