//! Spreadsheet data in table blocks (spec 6.3, `data.sheet`). The core does not read the sheet: it keeps it among
//! the table's unknown keys (spec 2.9). These tests pin that a sheet survives a read and a write exactly, and that
//! the version the core stamps follows the stamping table (spec 15.6). Every test has `fixture` in its name, so
//! the fixture CI job runs it.

mod common;

use opennote_core::format::page_json::{read_page, write_page};
use opennote_core::model::{BlockData, Page};
use opennote_core::Limits;
use serde_json::{json, Value};

fn limits() -> Limits {
    Limits::default()
}

/// Every case in `docs/format/fixtures/table-sheet`, by file name.
fn cases() -> Vec<(String, Value)> {
    let dir = common::fixtures_dir().join("table-sheet");
    let mut out: Vec<(String, Value)> = std::fs::read_dir(&dir)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().is_some_and(|ext| ext == "json"))
        .map(|path| {
            let name = path.file_name().unwrap().to_string_lossy().into_owned();
            (name, serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap())
        })
        .collect();
    out.sort_by(|a, b| a.0.cmp(&b.0));
    assert!(out.len() >= 30, "the table-sheet fixtures are there");
    out
}

fn read(value: &Value) -> Page {
    read_page(&serde_json::to_vec(value).unwrap(), &limits()).unwrap().page
}

/// The page without `formatVersion`, `minReaderVersion`, and `minWriterVersion`.
fn without_versions(page: &Value) -> Value {
    let mut page = page.clone();
    let map = page.as_object_mut().unwrap();
    for key in ["formatVersion", "minReaderVersion", "minWriterVersion"] {
        map.remove(key);
    }
    page
}

fn first_block_data(value: &Value) -> &Value {
    &value["blocks"][0]["data"]
}

/// A page with `data.sheet` reads into the core's model and writes back with the same keys and values, and what
/// the core writes it reads and writes again byte for byte.
#[test]
fn fixture_table_sheet_pages_write_back_exactly() {
    for (name, case) in cases() {
        let page = &case["page"];
        let written = write_page(&read(page));
        let value: Value = serde_json::from_slice(&written).unwrap();
        // The version keys follow the stamping table, which the next test pins.
        assert_eq!(
            without_versions(&value),
            without_versions(page),
            "{name}: the page comes back as it was"
        );
        assert_eq!(
            first_block_data(&value).get("sheet"),
            first_block_data(page).get("sheet"),
            "{name}: data.sheet is kept exactly"
        );
        let again = write_page(&read_page(&written, &limits()).unwrap().page);
        assert!(again == written, "{name}: a second trip writes the same bytes");
    }
}

/// A page without `data.sheet` keeps format version 1 on save, unless its cells hold a version 2 text feature
/// (`R-STAMP-8` to `R-STAMP-11`, whose rows apply to table cells too). Of these fixtures only `v.json` does: its
/// cell `<span data-x="1">=x</span>` is a foreign mark (`R-INL-7`), so it stays at version 2 by `R-STAMP-8`.
#[test]
fn fixture_a_table_without_a_sheet_keeps_version_1() {
    const TEXT_V2: [&str; 1] = ["v.json"];
    for (name, case) in cases() {
        let mut page = case["page"].clone();
        page["blocks"][0]["data"].as_object_mut().unwrap().remove("sheet");
        let version = if TEXT_V2.contains(&name.as_str()) { 2 } else { 1 };
        let value: Value = serde_json::from_slice(&write_page(&read(&page))).unwrap();
        assert_eq!(value["formatVersion"], json!(version), "{name}");
        assert_eq!(value["minReaderVersion"], json!(1), "{name}");
    }
}

/// A page with `data.sheet` writes the version the owner chose (PLAN decision 1: a feature-gated version 2 with
/// `minReaderVersion` 1). A sheet with only version 1 keys stays at version 1, so Beta 8 still edits it. Every
/// sheet page keeps `minReaderVersion` 1, so Beta 8 still opens it. The version 2 rows of the stamping table
/// belong to the core's version 2 writer (text:core-format-v2), which stamps `stamp.formatVersion` 2 itself.
#[test]
fn fixture_a_table_with_a_sheet_writes_the_chosen_version() {
    for (name, case) in cases() {
        let stamp = &case["stamp"];
        let value: Value = serde_json::from_slice(&write_page(&read(&case["page"]))).unwrap();
        assert_eq!(
            value["minReaderVersion"], stamp["minReaderVersion"],
            "{name}: a version 1 reader still opens the page"
        );
        if stamp["formatVersion"] == json!(1) {
            assert_eq!(
                value["formatVersion"],
                json!(1),
                "{name}: version 1 keys keep version 1"
            );
            assert!(
                value.get("minWriterVersion").is_none(),
                "{name}: no writer bound at version 1"
            );
        }
    }
}

/// `TableData.extra` holds a nested sheet object, and the core keeps every level of it through a write and a
/// read: objects, arrays, strings, booleans, null inside an array, and numbers with fractions and exponents.
#[test]
fn fixture_table_extra_round_trips_a_nested_sheet() {
    let (_, case) = cases().into_iter().find(|(name, _)| name == "cells.json").unwrap();
    let mut page = read(&case["page"]);
    let block = page.blocks.iter().next().unwrap().clone();
    let mut edited = (*block).clone();
    let BlockData::Table(table) = &mut edited.data else {
        panic!("the fixture holds a table");
    };
    let sheet = json!({
        "styles": { "s1": { "bold": true, "fill": "#fde68a", "numFmt": "0.00%" } },
        "cols": { "k1": { "style": "s1", "hidden": false } },
        "merges": { "m1": { "from": ["r1", "k1"], "to": ["r2", "k2"] } },
        "values": { "r2": { "k2": 2.5e-7 } },
        "deep": { "a": [1, [2, [3, { "b": [null, "text", -0.125, 1e21] }]]] },
        "names": { "Rate": { "ref": "=0.07", "scope": "table" } },
        "note": "Grüße, 東京, \u{1F600}"
    });
    table.extra.insert("sheet".to_owned(), sheet.clone());
    let column = table.columns[0].id;
    table.columns[0]
        .extra
        .insert("future".to_owned(), json!({ "nested": [true] }));
    table.rows[0].extra.insert("future".to_owned(), json!(["row"]));
    table.rows[0]
        .cells
        .get_mut(&column)
        .unwrap()
        .extra
        .insert("v".to_owned(), json!(42.5));
    let expected = table.clone();
    page.blocks.replace(std::sync::Arc::new(edited)).unwrap();
    let written = write_page(&page);
    let back = read_page(&written, &limits()).unwrap().page;
    let block = back.blocks.iter().next().unwrap();
    let BlockData::Table(read_back) = &block.data else {
        panic!("the table reads back as a table");
    };
    assert_eq!(read_back, &expected, "the table reads back with every unknown key");
    assert_eq!(read_back.extra.get("sheet"), Some(&sheet));
    assert!(write_page(&back) == written, "a second trip writes the same bytes");
}
