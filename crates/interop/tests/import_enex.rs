//! Importing a tiny hand-written Evernote export (`data/sample.enex`).

use std::path::Path;

use opennote_core::model::{BlockData, Page};
use opennote_interop::testing::{at, png_bytes, TestEnv};
use opennote_interop::{import_enex, import_enex_reader, MemorySink, Report};

const SAMPLE: &str = include_str!("data/sample.enex");

fn texts(page: &Page) -> String {
    let blocks = page.blocks.iter().filter_map(|block| match &block.data {
        BlockData::Text(text) => Some(text.markdown.to_string()),
        _ => None,
    });
    blocks.collect::<Vec<_>>().join("\n\n")
}

fn kinds(page: &Page) -> Vec<&str> {
    page.blocks.iter().map(|b| b.type_name()).collect()
}

fn import(enex: &str) -> (MemorySink, Report) {
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    let report = import_enex_reader(enex.as_bytes(), "Lab", &world.env(), &mut sink).expect("imports");
    (sink, report)
}

#[test]
fn notes_keep_their_titles_dates_and_tags() {
    let (sink, _) = import(SAMPLE);
    assert_eq!(sink.notebook.as_ref().expect("a notebook").title, "Lab");
    assert_eq!(sink.sections.len(), 1);
    assert_eq!(sink.pages.len(), 2);
    let lab = &sink.pages[0].1.page;
    assert_eq!(lab.title, "Lab notes & ideas");
    assert_eq!(lab.created, at("2024-01-05T14:30:00Z"));
    assert_eq!(lab.modified, at("2024-01-06T10:15:00Z"));
    assert_eq!(lab.tags, vec!["biology", "exam/unit-3"]);
    let clip = &sink.pages[1].1.page;
    assert_eq!(
        clip.created,
        at("2026-09-30T14:00:00Z"),
        "a note with no date gets the date of the import"
    );
    let entries = &sink.sections[0].pages;
    assert_eq!(
        entries.iter().map(|e| e.title.as_str()).collect::<Vec<_>>(),
        vec!["Lab notes & ideas", "Web clip"]
    );
}

#[test]
fn enml_becomes_formatted_text_lists_tasks_quotes_code_and_tables() {
    let (sink, _) = import(SAMPLE);
    let lab = &sink.pages[0].1.page;
    let text = texts(lab);
    assert!(
        text.contains("Plants make **sugar** from *light* and <u>water</u>. See [the leaf](https://example.org/leaf)"),
        "{text}"
    );
    assert!(
        text.contains("and another note."),
        "the Evernote link keeps only its text: {text}"
    );
    assert!(
        text.contains("**<span data-color=\"#c00000\">Red and bold</span>**"),
        "{text}"
    );
    assert!(text.contains("- [x] Read chapter 8\n- [ ] Write the report"), "{text}");
    assert!(text.contains("- First point\n- Second **point**"), "{text}");
    assert!(text.contains("> Life finds a way."), "{text}");
    assert!(text.contains("```\nlet x = 1;\nlet y = 2;\n```"), "{text}");
    assert!(text.contains("Secret: \\[encrypted text\\]"), "{text}");
    let table = lab.blocks.iter().find_map(|b| match &b.data {
        BlockData::Table(table) => Some(table.clone()),
        _ => None,
    });
    let table = table.expect("a table block");
    assert!(table.header);
    assert_eq!(table.rows.len(), 2);
}

#[test]
fn attachments_become_assets_and_blocks_and_unplaced_ones_go_last() {
    let (sink, _) = import(SAMPLE);
    let (_, imported) = &sink.pages[0];
    let lab = &imported.page;
    assert_eq!(
        kinds(lab),
        vec!["text", "image", "text", "file", "text", "table", "text", "file", "text"]
    );
    assert_eq!(lab.assets.len(), 3);
    assert!(imported.asset_bytes.values().any(|bytes| bytes == &png_bytes()));
    assert!(lab
        .assets
        .values()
        .any(|a| a.name == "Leaf section.png" && a.mime == "image/png" && a.width == Some(1)));
    assert!(lab.assets.values().any(|a| a.name == "loose.txt"));
    assert!(texts(lab).ends_with("Source: [https://example.org/source](https://example.org/source)"));
    let clip = texts(&sink.pages[1].1.page);
    assert!(clip.contains("[A picture](https://example.org/pic.png)"), "{clip}");
}

#[test]
fn the_report_lists_what_came_over_what_changed_and_what_was_skipped() {
    let (_, report) = import(SAMPLE);
    let text = report.to_markdown();
    assert!(text.contains("Evernote export \"Lab\""), "{text}");
    assert!(text.contains("Came over: original dates"), "{text}");
    assert!(text.contains("Came over: 1 image"), "{text}");
    assert!(
        text.contains("Simplified: 1 attachment that the text did not show"),
        "{text}"
    );
    assert!(text.contains("Simplified: 1 link to another Evernote note"), "{text}");
    assert!(text.contains("Skipped: 1 encrypted passage"), "{text}");
    assert!(
        text.contains("Skipped: note details, such as author and location"),
        "{text}"
    );
    assert!(text.contains("Simplified: 1 image on the web"), "{text}");
}

#[test]
fn a_file_on_disk_imports_like_its_text() {
    let world = TestEnv::new();
    let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/data/sample.enex");
    let mut sink = MemorySink::default();
    let report = import_enex(&path, &world.env(), &mut sink).expect("imports");
    assert_eq!(sink.notebook.as_ref().expect("a notebook").title, "sample");
    assert_eq!(sink.pages.len(), 2);
    assert_eq!(report.pages.len(), 2);
}

#[test]
fn a_file_cut_short_keeps_the_notes_before_the_cut() {
    let cut = SAMPLE.find("<title>Web clip</title>").expect("the second note") + 10;
    let (sink, report) = import(&SAMPLE[..cut]);
    assert_eq!(sink.pages.len(), 1);
    let skipped = &report.general.entries;
    assert!(skipped.iter().any(|e| e.what == "the rest of the file"), "{skipped:?}");
}
