//! A page with a table that has a sheet, through the conversion to Word: the file holds the cached result of a
//! formula cell when it is fresh, and the formula text with a report line that names the table when it is stale.
//! The expected values are worked out by hand: `=2*3` is 6.

use super::*;
use crate::docx::{build, read_parts, Part, Setup, WordInput};
use crate::source::NoteSource;
use crate::testing::{at, sample_notebook, TestEnv};
use opennote_core::model::{BlockData, TableCell, TableColumn, TableData, TableRow};
use opennote_core::{ColumnId, RowId};
use serde_json::{json, Map};
use std::collections::HashMap;

struct Nothing;

impl Resolver for Nothing {
    fn asset(&mut self, _page: &Page, _asset: &Asset) -> Option<String> {
        None
    }

    fn page(&mut self, _from: PageId, _to: PageId) -> Option<String> {
        None
    }
}

fn sheet_table(first_cell: &str, fresh: bool) -> TableData {
    let columns: Vec<TableColumn> = ["01m3sbcmt0000000000000k001", "01m3sbcmt0000000000000k002"]
        .iter()
        .map(|id| TableColumn {
            id: ColumnId::parse(id).unwrap(),
            width: None,
            extra: Map::new(),
        })
        .collect();
    let row = |id: &str, texts: [&str; 2]| TableRow {
        id: RowId::parse(id).unwrap(),
        cells: columns
            .iter()
            .zip(texts)
            .map(|(c, t)| {
                let cell = TableCell {
                    markdown: t.to_owned(),
                    extra: Map::new(),
                };
                (c.id, cell)
            })
            .collect(),
        extra: Map::new(),
    };
    let second = "01m3sbcmt0000000000000r002";
    let mut table = TableData {
        header: true,
        rows: vec![
            row("01m3sbcmt0000000000000r001", ["Item", "Total"]),
            row(second, ["x", first_cell]),
        ],
        columns,
        extra: Map::new(),
    };
    let of = if fresh {
        crate::sheet::fingerprint(&table)
    } else {
        "fnv1a:0000000000000000".to_owned()
    };
    let column = table.columns[1].id.to_string();
    let sheet = json!({
        "values": {second: {column: 6}},
        "valuesOf": of,
        "table": {"name": "Totals"}
    });
    table.extra.insert("sheet".to_owned(), sheet);
    table
}

/// Converts a page whose only table is `table`, and returns the Word body and the report lines.
fn word_of(table: TableData) -> (String, Vec<String>) {
    let world = TestEnv::new();
    let env = world.env();
    let sample = sample_notebook(&env);
    let mut page = sample.source.page(sample.photo).expect("the page");
    let block = page
        .blocks
        .iter()
        .find(|b| matches!(b.data, BlockData::Table(_)))
        .cloned()
        .expect("a table block");
    let mut changed = (*block).clone();
    changed.data = BlockData::Table(table);
    page.blocks.replace(std::sync::Arc::new(changed)).expect("replaced");
    let mut report = PageReport::default();
    let document = page_to_document(&page, &mut Nothing, &mut report);
    let input = WordInput {
        title: "Test".to_owned(),
        created: at("2026-01-05T09:30:00Z"),
        modified: at("2026-02-10T18:45:00Z"),
        parts: vec![Part::Blocks(document.blocks)],
        media: HashMap::new(),
        setup: Setup::default(),
    };
    let parts = read_parts(&build(&input).expect("the file builds"));
    let xml = parts
        .iter()
        .find(|(name, _)| name == "word/document.xml")
        .map(|(_, bytes)| String::from_utf8_lossy(bytes).into_owned())
        .expect("a document");
    let lines = report
        .entries
        .iter()
        .map(|e| format!("{} {}", e.what, e.why.clone().unwrap_or_default()))
        .collect();
    (xml, lines)
}

#[test]
fn a_fresh_formula_cell_is_its_cached_result_in_the_word_file() {
    let (xml, lines) = word_of(sheet_table("=2*3", true));
    assert!(xml.contains("<w:t xml:space=\"preserve\">6</w:t>"), "{xml}");
    assert!(!xml.contains("=2*3"), "{xml}");
    assert!(!lines.iter().any(|l| l.contains("table Totals")), "{lines:?}");
}

#[test]
fn a_stale_formula_cell_keeps_its_text_and_the_report_names_the_table() {
    let (xml, lines) = word_of(sheet_table("=2*3", false));
    assert!(xml.contains("=2*3"), "{xml}");
    assert!(!xml.contains("<w:t xml:space=\"preserve\">6</w:t>"), "{xml}");
    assert!(lines.iter().any(|l| l.starts_with("table Totals ")), "{lines:?}");
}

#[test]
fn a_bold_formula_cell_is_a_formula_by_its_readable_text() {
    let (xml, lines) = word_of(sheet_table("**=2*3**", true));
    assert!(xml.contains("<w:t xml:space=\"preserve\">6</w:t>"), "{xml}");
    assert!(!lines.iter().any(|l| l.contains("table Totals")), "{lines:?}");
    let (stale, lines) = word_of(sheet_table("**=2*3**", false));
    assert!(stale.contains("=2*3"), "{stale}");
    assert!(lines.iter().any(|l| l.starts_with("table Totals ")), "{lines:?}");
}
