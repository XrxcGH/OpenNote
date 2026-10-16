//! Web page archives as OneNote saves them: the HTML, the pictures found by name, and the date lines.

use std::path::PathBuf;

use opennote_core::model::{BlockData, Page};
use opennote_interop::testing::{at, TestEnv};
use opennote_interop::{import_mht, MemorySink, Report};

fn import() -> (MemorySink, Report) {
    let file = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/corpus/onenote-mht/Lecture 3.mht");
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    let report = import_mht(&file, &world.env(), &mut sink).expect("imports");
    (sink, report)
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

#[test]
fn the_page_has_its_title_date_and_cleaned_text() {
    let (sink, _) = import();
    assert_eq!(sink.pages.len(), 1);
    let page = &sink.pages[0].1.page;
    assert_eq!(page.title, "Lecture 3: Cell division");
    assert_eq!(page.created, at("2026-10-02T10:15:00Z"));
    let body = text(page);
    assert!(
        !body.contains("Friday, October 2"),
        "the date lines are removed: {body}"
    );
    assert!(!body.contains("10:15 AM"), "{body}");
    assert!(
        body.starts_with("## Mitosis") || body.starts_with("# Mitosis"),
        "{body}"
    );
    assert!(
        body.contains("**four** phases \u{2014} see [this page](https://example.org/mitosis)"),
        "{body}"
    );
    assert!(
        !body.contains("onenote:") && !body.contains("#top"),
        "links that cannot work are dropped: {body}"
    );
    assert!(body.contains("the notebook, and the top.\\\nSecond line."), "{body}");
    assert!(body.contains("- Prophase") && body.contains("*chromosomes condense*") && body.contains("- Metaphase"));
    assert!(!body.contains("var a"), "scripts are not text: {body}");
}

#[test]
fn pictures_are_found_by_path_or_file_name_and_missing_ones_are_reported() {
    let (sink, report) = import();
    let imported = &sink.pages[0].1;
    let images = imported
        .page
        .blocks
        .iter()
        .filter(|b| matches!(b.data, BlockData::Image(_)))
        .count();
    assert_eq!(images, 2, "one picture by its path and one by its file name");
    assert_eq!(
        imported.asset_bytes.len(),
        1,
        "both files have the same bytes, so they share one asset"
    );
    assert!(report.to_markdown().contains("image that is not in the archive"));
}

#[test]
fn a_table_comes_over_as_a_table() {
    let (sink, _) = import();
    let page = &sink.pages[0].1.page;
    let table = page
        .blocks
        .iter()
        .find_map(|b| match &b.data {
            BlockData::Table(t) => Some(t),
            _ => None,
        })
        .expect("a table");
    assert_eq!(table.rows.len(), 2);
    assert_eq!(table.rows[1].cells[&table.columns[1].id].markdown, "Chromatids part");
}

#[test]
fn links_with_hidden_or_unknown_schemes_are_dropped() {
    let html = "<html><body><p><a href=\"java&#9;script:alert(1)\">tab</a> \
        <a href=\"&#1;javascript:alert(1)\">control</a> <a href=\"JaVaScRiPt:alert(1)\">case</a> \
        <a href=\"ms-word:ofe|u|x\">app</a> <a href=\"tel:+15551234\">call</a> \
        <a href=\"https://example.org\">site</a></p></body></html>";
    let mht = format!("MIME-Version: 1.0\r\nContent-Type: text/html; charset=\"utf-8\"\r\n\r\n{html}\r\n");
    let folder = tempfile::tempdir().expect("a temp folder");
    let file = folder.path().join("Links.mht");
    std::fs::write(&file, mht).expect("writes");
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    let report = import_mht(&file, &world.env(), &mut sink).expect("imports");
    let body = text(&sink.pages[0].1.page);
    assert_eq!(
        body,
        "tab control case app [call](tel:+15551234) [site](https://example.org)"
    );
    assert!(
        report.to_markdown().contains("4 links that cannot be followed"),
        "{}",
        report.to_markdown()
    );
}

#[test]
fn color_and_size_names_that_could_close_their_tag_are_dropped() {
    let evil = "x&quot;&gt;&lt;img src=&quot;https://example.org/p.png&quot;&gt;";
    let html = format!(
        "<html><body><p><span data-color=\"{evil}\">a</span> <mark data-color=\"{evil}\">b</mark> \
        <span data-size=\"{evil}\">c</span> <span data-color=\"mint\">d</span></p></body></html>"
    );
    let mht = format!("MIME-Version: 1.0\r\nContent-Type: text/html; charset=\"utf-8\"\r\n\r\n{html}\r\n");
    let folder = tempfile::tempdir().expect("a temp folder");
    let file = folder.path().join("Marks.mht");
    std::fs::write(&file, mht).expect("writes");
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    import_mht(&file, &world.env(), &mut sink).expect("imports");
    let body = text(&sink.pages[0].1.page);
    assert_eq!(body, "a b c <span data-color=\"mint\">d</span>");
}
