//! Importing small Obsidian and Joplin folders.

use std::fs;
use std::path::Path;

use opennote_core::model::{BlockData, Page};
use opennote_interop::report::Outcome;
use opennote_interop::testing::{at, png_bytes, TestEnv};
use opennote_interop::{import_markdown_folder, MemorySink, Report};

fn write(root: &Path, path: &str, content: &[u8]) {
    let full = root.join(path);
    fs::create_dir_all(full.parent().expect("a parent folder")).expect("creates folders");
    fs::write(full, content).expect("writes the file");
}

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

fn page_named<'a>(sink: &'a MemorySink, title: &str) -> &'a Page {
    let found = sink.pages.iter().find(|(_, p)| p.page.title == title);
    &found.unwrap_or_else(|| panic!("no page {title}")).1.page
}

/// Two notes that link to each other, with an image, a PDF, a table, and a file that nothing uses.
fn vault(root: &Path) {
    write(root, ".obsidian/app.json", b"{}");
    let welcome =
        "---\ntags: [intro, bio]\ncreated: 2024-03-01 09:30:00\naliases: [Start]\ncssclass: wide\n---\n# Welcome\n\n\
        Read [[Cells]] and [[Biology/Cells#Mitosis|the mitosis notes]], or [[Nowhere]].\n\n\
        ==Key idea== with a #study/plan tag. <abbr>HTML</abbr> is simplified.\n\n![[leaf.png|200]]\n\n\
        > [!tip] Hint\n> Sleep well.\n";
    write(root, "Welcome.md", welcome.as_bytes());
    let cells = "Back to [start](../Welcome.md).\n\nA figure:\n\n![leaf](../attachments/leaf.png)\n\n\
        Notes are in [[notes.pdf]].\n\n| a | b |\n|---|---|\n| 1 | 2 |\n";
    write(root, "Biology/Cells.md", cells.as_bytes());
    write(root, "attachments/leaf.png", &png_bytes());
    write(root, "attachments/notes.pdf", b"%PDF-1.4 tiny");
    write(root, "attachments/unused.zip", b"PK");
}

fn import_vault() -> (MemorySink, Report) {
    let world = TestEnv::new();
    let root = tempfile::tempdir().expect("a temp folder");
    vault(root.path());
    let mut sink = MemorySink::default();
    let report = import_markdown_folder(root.path(), &world.env(), &mut sink).expect("imports");
    (sink, report)
}

#[test]
fn a_vault_becomes_sections_and_pages_with_links_between_them() {
    let (sink, _) = import_vault();
    let titles: Vec<&str> = sink.sections.iter().map(|s| s.title.as_str()).collect();
    assert_eq!(titles.len(), 2);
    assert!(titles.contains(&"Biology"), "{titles:?}");
    let welcome = page_named(&sink, "Welcome");
    let cells = page_named(&sink, "Cells");
    assert_eq!(welcome.created, at("2024-03-01T09:30:00Z"));
    assert_eq!(welcome.tags, vec!["intro", "bio", "study/plan"]);

    let text = texts(welcome);
    assert!(!text.starts_with("# Welcome"), "the repeated title is dropped: {text}");
    assert!(text.contains(&format!("[Cells](opennote:page/{})", cells.id)), "{text}");
    let mitosis = format!("[the mitosis notes](opennote:page/{})", cells.id);
    assert!(text.contains(&mitosis), "{text}");
    assert!(text.contains("Nowhere") && !text.contains("](wiki:"), "{text}");
    assert!(
        text.contains("==Key idea== with a \\#study/plan tag. HTML is simplified."),
        "{text}"
    );
    assert!(text.contains("> [!tip] Hint\n> Sleep well."), "{text}");
    let back = format!("[start](opennote:page/{})", welcome.id);
    assert!(texts(cells).contains(&back), "{}", texts(cells));
}

#[test]
fn images_attachments_and_tables_become_blocks() {
    let (sink, _) = import_vault();
    let welcome = page_named(&sink, "Welcome");
    let cells = page_named(&sink, "Cells");
    assert_eq!(
        kinds(welcome),
        vec!["text", "image", "text"],
        "the embedded image came over"
    );
    assert_eq!(welcome.assets.len(), 1);
    assert_eq!(kinds(cells), vec!["text", "image", "text", "file", "table"]);
    let cells_bytes = &sink
        .pages
        .iter()
        .find(|(_, p)| p.page.id == cells.id)
        .expect("the page")
        .1
        .asset_bytes;
    assert!(cells_bytes.values().any(|bytes| bytes == &png_bytes()));
}

#[test]
fn the_report_says_what_came_over_what_changed_and_what_was_skipped() {
    let (_, report) = import_vault();
    let markdown = report.to_markdown();
    assert!(markdown.contains("Obsidian vault"), "{markdown}");
    assert!(markdown.contains("Skipped: front matter keys: cssclass"), "{markdown}");
    assert!(
        markdown.contains("1 link to a note that is not in the import"),
        "{markdown}"
    );
    assert!(markdown.contains("1 file that no note uses"), "{markdown}");
    let welcome = report
        .pages
        .iter()
        .find(|p| p.title == "Welcome")
        .expect("a page report");
    assert!(welcome
        .entries
        .iter()
        .any(|e| e.outcome == Outcome::CameOver && e.what == "original dates"));
}

#[test]
fn a_joplin_export_keeps_front_matter_dates_tags_and_resources() {
    let world = TestEnv::new();
    let root = tempfile::tempdir().expect("a temp folder");
    let note = "---\ntitle: Lab day 1\nupdated: 2023-05-06 07:23:04Z\ncreated: 2023-05-06 07:20:00Z\n\
        tags:\n  - chemistry\n  - lab\n---\n\nMix the reagents.\n\n![diagram](../_resources/abc123.png)\n\n\
        See the [data](:/abc123) too.\n";
    write(root.path(), "Chemistry/Lab day 1.md", note.as_bytes());
    write(root.path(), "_resources/abc123.png", &png_bytes());
    let mut sink = MemorySink::default();
    let report = import_markdown_folder(root.path(), &world.env(), &mut sink).expect("imports");

    let page = page_named(&sink, "Lab day 1");
    assert_eq!(page.created, at("2023-05-06T07:20:00Z"));
    assert_eq!(page.modified, at("2023-05-06T07:23:04Z"));
    assert_eq!(page.tags, vec!["chemistry", "lab"]);
    assert_eq!(page.assets.len(), 1, "both references share one asset");
    assert_eq!(
        kinds(page),
        vec!["text", "image", "text", "file"],
        "the attachment follows its text"
    );
    assert!(report.to_markdown().contains("Joplin export"));
    assert_eq!(sink.sections[0].title, "Chemistry");
}

#[test]
fn links_by_alias_or_title_find_the_note() {
    let dir = tempfile::tempdir().expect("a temp folder");
    let root = dir.path();
    write(
        root,
        "Cells.md",
        b"---
aliases: [Cytology, Cell theory]
title: Cell biology
---
Text.
",
    );
    write(
        root,
        "Index.md",
        b"See [[Cytology]], [[cell theory]], and [[Cell biology]].
",
    );
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    import_markdown_folder(root, &world.env(), &mut sink).expect("imports");
    let cells = sink
        .pages
        .iter()
        .find(|(_, p)| p.page.title == "Cell biology")
        .expect("a page")
        .1
        .page
        .id;
    let index = texts(page_named(&sink, "Index"));
    assert_eq!(index.matches(&format!("opennote:page/{cells}")).count(), 3, "{index}");
}

#[test]
fn links_to_scripts_files_and_other_apps_keep_only_their_text() {
    let world = TestEnv::new();
    let root = tempfile::tempdir().expect("a temp folder");
    let note = "[a](javascript:alert(1)) [b](<java\tscript:alert(1)>) [c](file:///C:/Windows/notepad.exe) \
        [d](//server/share/x.exe) [e](data:text/html,x) [f](tel:+15551234) [g](https://example.org)\n";
    write(root.path(), "Links.md", note.as_bytes());
    let mut sink = MemorySink::default();
    let report = import_markdown_folder(root.path(), &world.env(), &mut sink).expect("imports");
    let page = page_named(&sink, "Links");
    assert_eq!(texts(page), "a b c d e [f](tel:+15551234) [g](https://example.org)");
    let text = report.to_markdown();
    assert!(text.contains("5 links that cannot be followed"), "{text}");
}
