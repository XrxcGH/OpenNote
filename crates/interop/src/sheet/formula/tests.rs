use super::*;
use serde_json::Value;

/// The golden file both test suites read.
const GOLDEN: &str = include_str!("../../../../../app/src/features/tables/fixtures/translate.json");

fn books(golden: &Value) -> std::collections::HashMap<String, Vec<TableRef>> {
    let mut out = std::collections::HashMap::new();
    for (key, tables) in golden["books"].as_object().expect("books") {
        let refs = tables
            .as_array()
            .expect("tables")
            .iter()
            .map(|t| TableRef {
                name: t["name"].as_str().expect("name").to_owned(),
                excel: t["excel"].as_str().map(str::to_owned),
                sheet: t["sheet"].as_str().expect("sheet").to_owned(),
                header: t["header"].as_bool().expect("header"),
                columns: t["columns"]
                    .as_array()
                    .expect("columns")
                    .iter()
                    .map(|c| c.as_str().expect("a column").to_owned())
                    .collect(),
                rows: t["rows"].as_u64().expect("rows") as usize,
            })
            .collect();
        out.insert(key.clone(), refs);
    }
    out
}

#[test]
fn every_golden_case_translates_both_ways() {
    let golden: Value = serde_json::from_str(GOLDEN).expect("the golden file");
    let books = books(&golden);
    let cases = golden["cases"].as_array().expect("cases");
    assert!(cases.len() >= 20);
    for case in cases {
        let name = case["name"].as_str().expect("name");
        let book = &books[case["book"].as_str().expect("book")];
        let cx = Context {
            book,
            own: 0,
            row: case["row"].as_u64().map(|r| r as usize),
        };
        let opennote = case["opennote"].as_str().expect("opennote");
        let excel = case["excel"].as_str().expect("excel");
        let direction = case["direction"].as_str().expect("direction");
        if direction != "fromExcel" {
            assert_eq!(to_excel(opennote, &cx), excel, "to Excel: {name}");
        }
        if direction != "toExcel" {
            assert_eq!(from_excel(excel, &cx), opennote, "from Excel: {name}");
        }
    }
}

#[test]
fn sheet_names_are_quoted_when_they_must_be() {
    assert_eq!(sheet_prefix("Prices"), "Prices!");
    assert_eq!(sheet_prefix("My sheet"), "'My sheet'!");
    assert_eq!(sheet_prefix("Bob's"), "'Bob''s'!");
    // A name that reads as a cell needs quotes.
    assert_eq!(sheet_prefix("A1"), "'A1'!");
}

#[test]
fn columns_past_xfd_are_names_not_cells() {
    assert!(cell_of("XFD1").is_some());
    assert!(cell_of("XFE1").is_none());
    assert!(cell_of("A0").is_none());
    assert_eq!(column_letters(16_383), "XFD");
}

#[test]
fn non_ascii_names_never_split_a_character() {
    // Byte 6 falls inside the second "É" and byte 12 inside "ü": slicing by bytes would panic.
    assert_eq!(strip_prefixes("ÉCARTÉ"), "ÉCARTÉ");
    assert_eq!(strip_prefixes("_xlfn.ÉCARTÉ"), "ÉCARTÉ");
    assert_eq!(after_prefix("Preis je Stück", "[#This Row],"), None);
    assert_eq!(after_prefix("[#this row],[X]", "[#This Row],"), Some("[X]"));
}

#[test]
fn a_missing_own_table_leaves_the_formula_unchanged() {
    let cx = Context {
        book: &[],
        own: 0,
        row: Some(2),
    };
    assert_eq!(to_excel("SUM([Qty])+A1", &cx), "SUM([Qty])+A1");
    assert_eq!(from_excel("Table1[@Qty]+A2", &cx), "Table1[@Qty]+A2");
}
