//! Notion exports: IDs in names, subpage folders, row properties, callouts, and CSV databases.

use std::path::PathBuf;

use opennote_core::model::{BlockData, Page};
use opennote_interop::testing::{at, TestEnv};
use opennote_interop::{import_markdown_folder, MemorySink, Report};

fn export_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/corpus/notion/Export")
}

fn import() -> (MemorySink, Report) {
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    let report = import_markdown_folder(&export_dir(), &world.env(), &mut sink).expect("imports");
    (sink, report)
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

#[test]
fn names_lose_their_ids_and_subpages_nest_under_their_parent() {
    let (sink, report) = import();
    assert_eq!(sink.notebook.as_ref().map(|n| n.title.as_str()), Some("Export"));
    let mut titles: Vec<&str> = sink.pages.iter().map(|(_, p)| p.page.title.as_str()).collect();
    titles.sort_unstable();
    assert_eq!(titles, ["Biology", "Cell notes", "Dune", "Reading list"]);
    assert_eq!(sink.sections.len(), 1, "subpage folders do not become sections");
    let section = &sink.sections[0];
    let entry = |title: &str| section.pages.iter().find(|p| p.title == title).expect("an entry");
    assert_eq!(entry("Cell notes").parent, Some(entry("Biology").id));
    assert_eq!(entry("Dune").parent, Some(entry("Reading list").id));
    assert!(entry("Biology").parent.is_none());
    let markdown = report.to_markdown();
    assert!(
        markdown.contains("_all.csv"),
        "the repeated database file is reported: {markdown}"
    );
}

#[test]
fn a_page_keeps_its_callout_tasks_links_image_and_table() {
    let (sink, _) = import();
    let biology = page(&sink, "Biology");
    let body = text(biology);
    assert!(body.contains("> [!tip]"), "{body}");
    assert!(body.contains("Exam on Friday"), "{body}");
    assert!(
        body.contains("- [x] Cells") && body.contains("- [ ] Genetics"),
        "{body}"
    );
    let cell_notes = page(&sink, "Cell notes").id;
    let reading = page(&sink, "Reading list").id;
    assert!(body.contains(&format!("opennote:page/{cell_notes}")), "{body}");
    assert!(body.contains(&format!("opennote:page/{reading}")), "{body}");
    assert!(biology.blocks.iter().any(|b| matches!(b.data, BlockData::Image(_))));
    assert!(biology.blocks.iter().any(|b| matches!(b.data, BlockData::Table(_))));
    let back = text(page(&sink, "Cell notes"));
    assert!(back.contains(&format!("opennote:page/{}", biology.id)), "{back}");
}

#[test]
fn a_row_page_gives_its_properties_to_the_page() {
    let (sink, _) = import();
    let dune = page(&sink, "Dune");
    assert_eq!(dune.tags, ["scifi", "classic"]);
    assert_eq!(dune.created, at("2026-10-01T09:30:00Z"));
    let table = dune
        .blocks
        .iter()
        .find_map(|b| match &b.data {
            BlockData::Table(t) => Some(t),
            _ => None,
        })
        .expect("the remaining properties are a table");
    let cells: Vec<String> = table
        .rows
        .iter()
        .flat_map(|r| table.columns.iter().map(|c| r.cells[&c.id].markdown.clone()))
        .collect();
    assert_eq!(
        cells,
        ["Property", "Value", "Status", "Done", "Author", "Frank Herbert"]
    );
    assert!(text(dune).contains("desert planet"));
}

#[test]
fn a_csv_database_becomes_a_table_page() {
    let (sink, report) = import();
    let reading = page(&sink, "Reading list");
    let BlockData::Table(table) = &reading.blocks.iter().next().expect("a block").data else {
        panic!("a table");
    };
    assert!(table.header);
    assert_eq!((table.rows.len(), table.columns.len()), (3, 3));
    let second = &table.rows[2];
    assert_eq!(second.cells[&table.columns[0].id].markdown, "Cosmos, the series");
    assert!(report.to_markdown().contains("Notion database became a smart table"));
}

#[test]
fn a_database_becomes_a_smart_table_with_column_types() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/corpus/notion-database/Export");
    let world = TestEnv::new();
    let mut sink = MemorySink::default();
    let report = import_markdown_folder(&dir, &world.env(), &mut sink).expect("imports");
    let books = page(&sink, "Books");
    let BlockData::Table(table) = &books.blocks.iter().next().expect("a block").data else {
        panic!("a table");
    };
    let smart = table.extra.get("smart").expect("smart-table data");
    let kind = |n: usize| smart["columns"][table.columns[n].id.to_string()]["type"].as_str();
    assert_eq!(kind(0), None, "names stay text");
    assert_eq!(kind(1), Some("number"));
    assert_eq!(kind(2), Some("currency"));
    assert_eq!(kind(3), Some("date"));
    assert_eq!(kind(4), Some("checkbox"));
    assert_eq!(kind(5), Some("text"));
    let choices = &smart["columns"][table.columns[5].id.to_string()]["choices"];
    assert_eq!(choices, &serde_json::json!(["Done", "Reading", "To read"]));
    assert_eq!(kind(6), None);
    let due = |row: usize| table.rows[row].cells[&table.columns[3].id].markdown.to_string();
    assert_eq!(due(1), "2026-10-07");
    assert_eq!(due(3), "2026-10-12 15:30");
    let markdown = report.to_markdown();
    assert!(
        markdown
            .contains("column types: Pages (number), Price (currency), Due (date), Done (checkbox), Status (choice)"),
        "the report names the types: {markdown}"
    );
}
