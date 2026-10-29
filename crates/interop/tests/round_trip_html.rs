//! Round trips through the HTML bundle: what goes out as linked HTML pages comes back in with the same content.

use opennote_core::model::Page;
use opennote_interop::testing::{describe_pages, png_bytes, sample_notebook, TestEnv};
use opennote_interop::{export_files, import_html_folder, Format, MemorySink, MemorySource, Scope};

fn pages(sink: &MemorySink) -> Vec<&Page> {
    sink.pages.iter().map(|(_, imported)| &imported.page).collect()
}

fn round_trip(source: &MemorySource, world: &TestEnv, out: &std::path::Path) -> MemorySink {
    let exported = export_files(source, Scope::Notebook, Format::Html, out).expect("exports");
    let mut sink = MemorySink::default();
    import_html_folder(&exported.root, &world.env(), &mut sink).expect("imports");
    sink
}

#[test]
fn a_notebook_exported_as_html_imports_with_the_same_content() {
    let world = TestEnv::new();
    let sample = sample_notebook(&world.env());
    let out = tempfile::tempdir().expect("a temp folder");
    let imported = round_trip(&sample.source, &world, out.path());

    let before = describe_pages(&sample.source.pages());
    let after = describe_pages(&pages(&imported));
    assert_eq!(
        after,
        before,
        "the pages differ after a round trip:\n{}",
        after.join("\n---\n")
    );
    let mut sections: Vec<&str> = imported.sections.iter().map(|s| s.title.as_str()).collect();
    sections.sort_unstable();
    assert_eq!(sections, vec!["Lab", "Semester 1"]);
    let photo = imported
        .pages
        .iter()
        .find(|(_, p)| p.page.title == "Photosynthesis")
        .expect("the page");
    assert!(photo.1.asset_bytes.values().any(|bytes| bytes == &png_bytes()));
}

#[test]
fn the_index_page_is_not_imported_as_a_page() {
    let world = TestEnv::new();
    let sample = sample_notebook(&world.env());
    let out = tempfile::tempdir().expect("a temp folder");
    let exported = export_files(&sample.source, Scope::Notebook, Format::Html, out.path()).expect("exports");
    let mut sink = MemorySink::default();
    let report = import_html_folder(&exported.root, &world.env(), &mut sink).expect("imports");
    assert_eq!(sink.pages.len(), 3, "three pages and no index");
    let markdown = report.to_markdown();
    assert!(markdown.contains("index"), "the report names the index: {markdown}");
}

#[test]
fn a_second_html_round_trip_changes_nothing() {
    let world = TestEnv::new();
    let sample = sample_notebook(&world.env());
    let first_out = tempfile::tempdir().expect("a temp folder");
    let first = round_trip(&sample.source, &world, first_out.path());
    let second_out = tempfile::tempdir().expect("a temp folder");
    let second = round_trip(
        &MemorySource::from_sink(first).expect("a notebook"),
        &world,
        second_out.path(),
    );
    assert_eq!(describe_pages(&pages(&second)), describe_pages(&sample.source.pages()));
}
