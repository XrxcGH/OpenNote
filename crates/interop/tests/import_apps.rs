//! Imports from other note apps: Google Keep, Bear, and Logseq.

use std::path::PathBuf;

use opennote_core::model::{BlockData, Page};
use opennote_interop::testing::{at, TestEnv};
use opennote_interop::{
    detect, import, import_keep_folder, import_logseq_folder, import_textbundle_folder, ImportOptions, MemorySink,
    Report, SourceKind,
};

fn corpus(path: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/corpus")
        .join(path)
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

fn run(
    path: &str,
    import_fn: fn(
        &std::path::Path,
        &opennote_interop::ImportEnv<'_>,
        &mut dyn opennote_interop::ImportSink,
    ) -> opennote_interop::Result<Report>,
) -> (MemorySink, Report) {
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    let report = import_fn(&corpus(path), &world.env(), &mut sink).expect("imports");
    (sink, report)
}

#[test]
fn keep_notes_become_pages_with_labels_checklists_and_attachments() {
    let (sink, report) = run("keep/Takeout", import_keep_folder);
    let mut titles: Vec<&str> = sink.pages.iter().map(|(_, p)| p.page.title.as_str()).collect();
    titles.sort_unstable();
    assert_eq!(
        titles,
        [
            "Call the plumber about the kitchen sink before the weekend b...",
            "Garden idea",
            "Shopping"
        ]
    );
    let shopping = page(&sink, "Shopping");
    assert_eq!(shopping.tags, ["Home", "Weekly", "pinned"]);
    assert_eq!(shopping.created, at("2026-09-21T14:13:20Z"));
    assert_eq!(shopping.modified, at("2026-09-21T15:13:20Z"));
    let body = text(shopping);
    assert!(
        body.contains("- [x] Milk") && body.contains("- [ ] Eggs") && body.contains("- [ ] Flour"),
        "{body}"
    );

    let idea = &sink
        .pages
        .iter()
        .find(|(_, p)| p.page.title == "Garden idea")
        .expect("page")
        .1;
    assert!(idea.page.blocks.iter().any(|b| matches!(b.data, BlockData::Image(_))));
    let body = text(&idea.page);
    assert!(
        body.contains("Maybe add a pond.") && body.contains("[How to build a pond](https://example.org/pond)"),
        "{body}"
    );

    let voice = page(&sink, "Call the plumber about the kitchen sink before the weekend b...");
    assert!(voice.tags.contains(&"archived".to_owned()));
    assert!(
        voice.blocks.iter().any(|b| matches!(b.data, BlockData::File(_))),
        "the audio is an attachment"
    );

    let markdown = report.to_markdown();
    assert!(markdown.contains("The note is in the Trash"), "{markdown}");
    assert!(markdown.contains("note color"), "{markdown}");
    assert!(
        !markdown.contains("Shopping.html"),
        "the HTML copies are not reported: {markdown}"
    );
}

#[test]
fn a_takeout_folder_is_detected_as_keep() {
    assert_eq!(
        detect(&corpus("keep/Takeout")).expect("known").kind,
        SourceKind::GoogleKeep
    );
    assert_eq!(
        detect(&corpus("textbundle/Bear")).expect("known").kind,
        SourceKind::TextBundle
    );
    let found = detect(&corpus("logseq/graph")).expect("known");
    assert_eq!(
        (found.kind, found.label.as_str()),
        (SourceKind::Markdown, "Logseq graph")
    );
}

#[test]
fn bear_bundles_become_pages_titled_by_heading_or_bundle_name() {
    let (sink, _) = run("textbundle/Bear", import_textbundle_folder);
    assert_eq!(sink.sections.len(), 1, "the bundle folders are not sections");
    assert_eq!(sink.sections[0].title, "Bear");
    let first = page(&sink, "Trip planning");
    assert_eq!(first.tags, ["camping", "gear/cooking"]);
    let imported = &sink
        .pages
        .iter()
        .find(|(_, p)| p.page.title == "Trip planning")
        .expect("page")
        .1;
    assert!(
        imported
            .page
            .blocks
            .iter()
            .any(|b| matches!(b.data, BlockData::Image(_))),
        "assets/pic.png came over"
    );
    assert!(text(first).contains("- [x] Buy fuel"));
    let second = page(&sink, "Second note");
    assert_eq!(second.tags, ["later"]);
}

#[test]
fn logseq_pages_get_titles_tasks_tags_and_journal_dates() {
    let (sink, report) = run("logseq/graph", import_logseq_folder);
    let mut titles: Vec<&str> = sink.pages.iter().map(|(_, p)| p.page.title.as_str()).collect();
    titles.sort_unstable();
    assert_eq!(titles, ["2026-10-02", "Cell biology", "Photosynthesis"]);
    let cells = page(&sink, "Cell biology");
    assert_eq!(cells.tags, ["biology", "exam", "energy source"]);
    let body = text(cells);
    assert!(body.contains("- [ ] review"), "{body}");
    assert!(body.contains("- [x] read chapter 1"), "{body}");
    assert!(body.contains("block reference") && !body.contains("{{"), "{body}");
    assert!(!body.contains("id::") && !body.contains("title::"), "{body}");
    let photo = page(&sink, "Photosynthesis");
    assert!(
        text(photo).contains(&format!("opennote:page/{}", cells.id)),
        "links resolve to the page: {}",
        text(photo)
    );
    let journal = page(&sink, "2026-10-02");
    assert_eq!(journal.created, at("2026-10-02T00:00:00Z"));
    let journal_text = text(journal);
    assert!(
        journal_text.contains("Scheduled: 2026-10-05") && !journal_text.contains("CLOCK"),
        "{journal_text}"
    );
    let mut sections: Vec<&str> = sink.sections.iter().map(|s| s.title.as_str()).collect();
    sections.sort_unstable();
    assert_eq!(sections, ["Journals", "Pages"]);
    let markdown = report.to_markdown();
    assert!(
        markdown.contains("logbook") && markdown.contains("embed or query"),
        "{markdown}"
    );
}

#[test]
fn the_entry_point_runs_each_of_them_from_detection_alone() {
    for (path, pages) in [("keep/Takeout", 3), ("textbundle/Bear", 2), ("logseq/graph", 3)] {
        let world = TestEnv::new();
        let mut sink = MemorySink::default();
        import(&corpus(path), &ImportOptions::default(), &world.env(), &mut sink).expect("imports");
        assert_eq!(sink.pages.len(), pages, "{path}");
    }
}
