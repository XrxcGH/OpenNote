//! Handwriting in exports: a page's strokes become one SVG picture where the format can hold a picture.

use std::collections::BTreeMap;
use std::fs;

use opennote_core::model::NotebookFile;
use opennote_core::testing::sample::{sample_asset_id, sample_page};
use opennote_core::NotebookId;
use opennote_interop::testing::{at, png_bytes, TestEnv};
use opennote_interop::tree::{section_orders, SectionBuilder};
use opennote_interop::{
    export_docx, export_files, export_html_single, Control, Format, ImportedPage, MemorySource, Outcome, PageReport,
    Scope,
};

/// A notebook with one page: the core's sample page, which has text, a picture, and one stroke.
fn notebook_with_ink(env: &opennote_interop::ImportEnv<'_>) -> MemorySource {
    let created = at("2026-09-30T14:03:22Z");
    let mut source = MemorySource::new(NotebookFile::new(NotebookId::generate(env.clock), "Biology", created));
    let page = sample_page();
    let mut section = SectionBuilder::new(env, "Notes", created);
    section.add_page(&page, None);
    let asset_bytes = BTreeMap::from([(sample_asset_id(), png_bytes())]);
    source.add_page(ImportedPage { page, asset_bytes });
    let order = section_orders(1).expect("a key").remove(0);
    source.add_section(section.finish(order).expect("the section builds"));
    source
}

fn ink_entry(report: &PageReport) -> &opennote_interop::Entry {
    report
        .entries
        .iter()
        .find(|e| e.what.contains("handwriting"))
        .expect("an entry about the handwriting")
}

#[test]
fn a_markdown_export_keeps_the_handwriting_as_a_picture_beside_the_pages() {
    let world = TestEnv::new();
    let source = notebook_with_ink(&world.env());
    let out = tempfile::tempdir().expect("a temp folder");
    let exported = export_files(&source, Scope::Notebook, Format::Markdown, out.path()).expect("exports");
    let page = fs::read_to_string(exported.root.join("Notes").join("Photosynthesis.md")).expect("reads");
    assert!(
        page.contains("![Handwriting on this page](<../assets/Photosynthesis handwriting.svg>)"),
        "{page}"
    );
    let svg = fs::read_to_string(exported.root.join("assets").join("Photosynthesis handwriting.svg")).expect("reads");
    assert!(svg.contains("<svg") && svg.contains("<path"), "{svg}");
    let report = &exported.report.pages[0];
    assert_eq!(ink_entry(report).outcome, Outcome::Simplified);
}

#[test]
fn a_single_web_page_file_carries_the_handwriting_inside() {
    let world = TestEnv::new();
    let source = notebook_with_ink(&world.env());
    let out = tempfile::tempdir().expect("a temp folder");
    let exported = export_html_single(&source, Scope::Notebook, out.path(), &Control::none()).expect("exports");
    let html = fs::read_to_string(&exported.files[0]).expect("reads");
    assert!(html.contains("data:image/svg+xml;base64,"), "the picture is inside");
    assert!(html.contains("Handwriting on this page"));
}

#[test]
fn a_word_export_still_says_it_cannot_hold_the_handwriting() {
    let world = TestEnv::new();
    let source = notebook_with_ink(&world.env());
    let out = tempfile::tempdir().expect("a temp folder");
    let exported = export_docx(&source, Scope::Notebook, out.path()).expect("exports");
    let entry = ink_entry(&exported.report.pages[0]);
    assert_eq!(entry.outcome, Outcome::Skipped);
    assert!(entry.why.as_deref().is_some_and(|w| w.contains("PDF")));
}
