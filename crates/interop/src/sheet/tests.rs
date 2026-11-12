// checks-disable-file brand-consistency: the test data holds color values to check how they are written
use super::*;
use opennote_core::model::{TableCell, TableColumn, TableData, TableRow};
use opennote_core::{ColumnId, RowId};
use serde_json::{json, Map, Value};

use crate::doc::cell_style::Fill;

const K: [&str; 3] = [
    "01m3sbcmt0000000000000k001",
    "01m3sbcmt0000000000000k002",
    "01m3sbcmt0000000000000k003",
];
const R: [&str; 3] = [
    "01m3sbcmt0000000000000r001",
    "01m3sbcmt0000000000000r002",
    "01m3sbcmt0000000000000r003",
];

/// A table of `columns` columns with the given rows of cell Markdown, and `extra` for its keys.
fn table(columns: usize, rows: &[&[&str]], extra: Value) -> TableData {
    TableData {
        header: true,
        columns: K[..columns]
            .iter()
            .map(|id| TableColumn {
                id: ColumnId::parse(id).unwrap(),
                width: Some(120.0),
                extra: Map::new(),
            })
            .collect(),
        rows: rows
            .iter()
            .enumerate()
            .map(|(i, cells)| TableRow {
                id: RowId::parse(R[i]).unwrap(),
                cells: cells
                    .iter()
                    .enumerate()
                    .map(|(c, text)| {
                        (
                            ColumnId::parse(K[c]).unwrap(),
                            TableCell {
                                markdown: (*text).to_owned(),
                                extra: Map::new(),
                            },
                        )
                    })
                    .collect(),
                extra: Map::new(),
            })
            .collect(),
        extra: extra.as_object().cloned().unwrap_or_default(),
    }
}

#[test]
fn the_fingerprint_matches_the_spec_fixture() {
    // The fixture `table-sheet/valuesOf.json` of the format spec gives this fingerprint for this table.
    let smart = json!({"smart": {"columns": {K[1]: {"type": "number", "decimals": 2}}}});
    let t = table(2, &[&["Item", "Price"], &["Tea", "2.5"], &["Rice", "4"]], smart);
    assert_eq!(fingerprint(&t), "fnv1a:0e8265540bd3b4a9");
}

fn formula_table(fresh: bool) -> TableData {
    let rows: &[&[&str]] = &[&["A", "B"], &["x", "=2*3"]];
    let mut t = table(2, rows, json!({}));
    let of = if fresh {
        fingerprint(&t)
    } else {
        "fnv1a:0000000000000000".to_owned()
    };
    let sheet = json!({"values": {R[1]: {K[1]: 6}}, "valuesOf": of});
    t.extra.insert("sheet".to_owned(), sheet);
    t
}

#[test]
fn a_fresh_cache_gives_the_result_of_a_formula_cell() {
    let sheet = read(&formula_table(true)).unwrap();
    assert_eq!(sheet.results[1][1].as_deref(), Some("6"));
    assert!(!sheet.stale);
}

#[test]
fn a_stale_cache_keeps_the_formula_text_and_flags_the_table() {
    let sheet = read(&formula_table(false)).unwrap();
    assert_eq!(sheet.results[1][1], None);
    assert!(sheet.stale);
}

#[test]
fn a_table_without_a_sheet_has_none() {
    assert!(read(&table(1, &[&["a"]], json!({}))).is_none());
}

#[test]
fn merges_are_in_id_order_and_the_lower_id_wins_an_overlap() {
    let rows: &[&[&str]] = &[&["a", "b", "c"], &["d", "e", "f"], &["g", "h", "i"]];
    let merges = json!({
        "m1": {"from": [R[1], K[1]], "to": [R[2], K[2]]},
        "m2": {"from": [R[2], K[2]], "to": [R[2], K[2]]},
        "m3": {"from": [R[0], K[0]], "to": [R[1], K[1]]},
        "m4": {"from": [R[0], K[0]], "to": [R[0], K[1]]}
    });
    let t = table(3, rows, json!({"sheet": {"merges": merges}}));
    let found = read(&t).unwrap().merges;
    // m1 is B2:C3. m2 covers one cell. m3 overlaps m1 at B2, so m1 wins and m3 is ignored. m4 is A1:B1.
    let m1 = Merge {
        top: 1,
        left: 1,
        bottom: 2,
        right: 2,
    };
    let m4 = Merge {
        top: 0,
        left: 0,
        bottom: 0,
        right: 1,
    };
    assert_eq!(found, vec![m1, m4]);
}

#[test]
fn a_cell_style_layers_the_table_column_row_and_cell_styles() {
    let sheet = json!({
        "styles": {
            "t": {"font": {"size": 11}, "fill": "#eeeeee"},
            "c": {"font": {"bold": true}},
            "x": {"align": {"v": "middle"}, "border": {"b": {"style": "double"}}}
        },
        "table": {"style": "t"},
        "cols": {K[0]: {"style": "c"}},
        "cells": {R[1]: {K[0]: "x"}}
    });
    let t = table(2, &[&["a", "b"], &["c", "d"]], json!({"sheet": sheet}));
    let styles = read(&t).unwrap().styles;
    let cell = styles[1][0].as_ref().unwrap();
    assert_eq!(cell.font.size, Some(11.0));
    assert_eq!(cell.font.bold, Some(true));
    assert_eq!(cell.fill, Some(Fill::Color("#eeeeee".to_owned())));
    assert_eq!(cell.align.vertical.as_deref(), Some("middle"));
    assert_eq!(cell.border.bottom.as_ref().map(|b| b.style.as_str()), Some("double"));
    // The other column has only the table's style.
    let other = styles[1][1].as_ref().unwrap();
    assert_eq!(other.font.bold, None);
}

fn with_values(cell: &str, stored: Value) -> TableData {
    let mut t = table(2, &[&["A", "B"], &["x", cell]], json!({}));
    let of = fingerprint(&t);
    t.extra.insert(
        "sheet".to_owned(),
        json!({"values": {R[1]: {K[1]: stored}}, "valuesOf": of}),
    );
    t
}

#[test]
fn a_formula_cell_is_found_by_its_readable_text() {
    // R-SHT-5: marks do not hide a formula. A bold `=2*3` shows its result when fresh and flags the table when stale.
    let sheet = read(&with_values("**=2*3**", json!(6))).unwrap();
    assert_eq!(sheet.results[1][1].as_deref(), Some("6"));
    assert!(!sheet.stale);
    let mut stale = with_values("**=2*3**", json!(6));
    stale.extra.get_mut("sheet").unwrap()["valuesOf"] = json!("fnv1a:0000000000000000");
    let sheet = read(&stale).unwrap();
    assert_eq!(sheet.results[1][1], None);
    assert!(sheet.stale);
    // A cell whose readable text does not start with `=` is plain text.
    assert_eq!(read(&with_values("a =2*3", json!(6))).unwrap().results[1][1], None);
}

#[test]
fn an_invalid_cached_entry_is_ignored_and_the_formula_text_stays() {
    // R-SHT-17: an array, or an object that is not a lone error code, is not a cached value.
    for bad in [
        json!([1, 2]),
        json!({"x": 1}),
        json!({"e": "#N/A", "x": 1}),
        json!({"e": 5}),
    ] {
        let sheet = read(&with_values("=2*3", bad.clone())).unwrap();
        assert_eq!(sheet.results[1][1], None, "{bad}");
        assert!(!sheet.stale, "{bad}");
    }
    assert_eq!(
        read(&with_values("=1/0", json!({"e": "#DIV/0!"}))).unwrap().results[1][1].as_deref(),
        Some("#DIV/0!")
    );
    assert_eq!(
        read(&with_values("=A1", json!(null))).unwrap().results[1][1].as_deref(),
        Some("")
    );
}

#[test]
fn only_the_first_ten_thousand_merges_are_read() {
    let rows: &[&[&str]] = &[&["a", "b", "c"], &["d", "e", "f"], &["g", "h", "i"]];
    let mut merges = Map::new();
    // IDs sort as text. The first 10,000 are the same whole-table merge, so one is active. The 10,001st would be
    // valid, but is past the limit.
    for i in 0..MERGE_LIMIT {
        merges.insert(format!("a{i:05}"), json!({"from": [R[0], K[0]], "to": [R[2], K[2]]}));
    }
    merges.insert("b".to_owned(), json!({"from": [R[0], K[0]], "to": [R[0], K[1]]}));
    let t = table(3, rows, json!({"sheet": {"merges": Value::Object(merges)}}));
    assert_eq!(read(&t).unwrap().merges.len(), 1);
    // With room left, a merge that does not overlap is read: drop all but 9,999 of the first group.
    let mut few = Map::new();
    for i in 0..MERGE_LIMIT - 1 {
        few.insert(format!("a{i:05}"), json!({"from": [R[2], K[0]], "to": [R[2], K[2]]}));
    }
    few.insert("b".to_owned(), json!({"from": [R[0], K[0]], "to": [R[0], K[1]]}));
    few.insert("c".to_owned(), json!({"from": [R[1], K[0]], "to": [R[1], K[1]]}));
    let t = table(3, rows, json!({"sheet": {"merges": Value::Object(few)}}));
    // Entry 10,000 is `b` and is read. `c` is the 10,001st and is not.
    assert_eq!(read(&t).unwrap().merges.len(), 2);
}

#[test]
fn the_merge_index_names_each_cell_once() {
    let m = Merge {
        top: 0,
        left: 0,
        bottom: 1,
        right: 1,
    };
    let index = MergeIndex::new(&[m], 3, 3);
    assert_eq!(index.slot(0, 0), Some(Slot::Anchor(m)));
    assert_eq!(index.slot(0, 1), Some(Slot::Covered(m)));
    assert_eq!(index.slot(1, 0), Some(Slot::Covered(m)));
    assert_eq!(index.slot(2, 2), None);
    // A merge past the grid is cut to it, and one that starts outside is left out.
    let wide = Merge {
        top: 2,
        left: 2,
        bottom: 9,
        right: 9,
    };
    let far = Merge {
        top: 5,
        left: 0,
        bottom: 6,
        right: 0,
    };
    let cut = MergeIndex::new(&[wide, far], 3, 3);
    assert_eq!(cut.slot(2, 2), Some(Slot::Anchor(wide)));
    assert_eq!(cut.slot(5, 0), None);
}

/// A table of `rows` by `columns` empty cells with generated IDs.
fn grid(rows: usize, columns: usize, extra: Value) -> TableData {
    let col_ids: Vec<String> = (0..columns).map(|i| format!("01m3sbcmt2{i:016}")).collect();
    let row_ids: Vec<String> = (0..rows).map(|i| format!("01m3sbcmt1{i:016}")).collect();
    TableData {
        header: true,
        columns: col_ids
            .iter()
            .map(|id| TableColumn {
                id: ColumnId::parse(id).unwrap(),
                width: None,
                extra: Map::new(),
            })
            .collect(),
        rows: row_ids
            .iter()
            .map(|id| TableRow {
                id: RowId::parse(id).unwrap(),
                cells: col_ids
                    .iter()
                    .map(|c| {
                        (
                            ColumnId::parse(c).unwrap(),
                            TableCell {
                                markdown: String::new(),
                                extra: Map::new(),
                            },
                        )
                    })
                    .collect(),
                extra: Map::new(),
            })
            .collect(),
        extra: extra.as_object().cloned().unwrap_or_default(),
    }
}

#[test]
fn ten_thousand_merges_in_a_large_table_read_fast() {
    // The limits of the format: 1,000 rows, 100 columns, 10,000 merges. Each merge spans two columns of one row, so
    // none overlaps. The check against taken cells must not grow with the table (it took a minute in debug before).
    let (rows, columns) = (1_000, 100);
    let mut merges = Map::new();
    for i in 0..MERGE_LIMIT {
        let (r, c) = (i / 10, (i % 10) * 2);
        merges.insert(
            format!("m{i:05}"),
            json!({"from": [format!("01m3sbcmt1{r:016}"), format!("01m3sbcmt2{c:016}")],
                   "to": [format!("01m3sbcmt1{r:016}"), format!("01m3sbcmt2{:016}", c + 1)]}),
        );
    }
    let t = grid(rows, columns, json!({"sheet": {"merges": Value::Object(merges)}}));
    let start = std::time::Instant::now();
    let sheet = read(&t).unwrap();
    assert_eq!(sheet.merges.len(), MERGE_LIMIT);
    assert!(start.elapsed().as_secs() < 5, "reading took {:?}", start.elapsed());
    let start = std::time::Instant::now();
    let index = MergeIndex::new(&sheet.merges, rows, columns);
    assert!(index.slot(999, 19).is_some());
    assert!(start.elapsed().as_secs() < 5);
}

#[test]
fn a_style_value_outside_the_schema_range_is_dropped() {
    // R-SHT ranges: padding 0 to 1584 points, indent 0 to 15, border width 0.25 to 6, rotation -90 to 90, size 1 to 1638.
    let style = json!({
        "pad": {"t": 1e300, "r": -50, "b": 10, "l": 1584},
        "align": {"indent": 255, "rotate": 91},
        "border": {"t": {"style": "single", "width": 99}},
        "font": {"size": 0, "weight": 1000}
    });
    let t = table(
        1,
        &[&["a"], &["b"]],
        json!({"sheet": {"styles": {"h": style}, "table": {"style": "h"}}}),
    );
    let cell = read(&t).unwrap().styles[0][0].clone().unwrap();
    assert_eq!(cell.pad.top, None);
    assert_eq!(cell.pad.right, None);
    assert_eq!(cell.pad.bottom, Some(10.0));
    assert_eq!(cell.pad.left, Some(1584.0));
    assert_eq!(cell.align.indent, None);
    assert_eq!(cell.align.rotate, None);
    assert_eq!(cell.border.top.and_then(|b| b.width), None);
    assert_eq!(cell.font.size, None);
    assert_eq!(cell.font.weight, None);
}

fn shown_result(value: Value, fmt: &str) -> Option<String> {
    let mut t = table(2, &[&["A", "B"], &["x", "=1/4"]], json!({}));
    let of = fingerprint(&t);
    t.extra.insert(
        "sheet".to_owned(),
        json!({"values": {R[1]: {K[1]: value}}, "valuesOf": of, "styles": {"f": {"fmt": fmt}}, "cols": {K[1]: {"style": "f"}}}),
    );
    read(&t).unwrap().results[1][1].clone()
}

#[test]
fn a_result_shows_under_the_number_format_of_its_cell() {
    // Hand-worked: 0.25 as a percent is 25%. Serial 45000 is 2023-03-15 (ECMA-376 18.17.4.1, 1900 date system).
    assert_eq!(shown_result(json!(0.25), "0%").as_deref(), Some("25%"));
    assert_eq!(shown_result(json!(0.256), "0.0%").as_deref(), Some("25.6%"));
    assert_eq!(shown_result(json!(1234.5), "#,##0.00").as_deref(), Some("1,234.50"));
    assert_eq!(shown_result(json!(7), "0.00").as_deref(), Some("7.00"));
    assert_eq!(shown_result(json!(1234.5), "\"$\"#,##0").as_deref(), Some("$1,235"));
    assert_eq!(shown_result(json!(45000), "yyyy-mm-dd").as_deref(), Some("2023-03-15"));
    assert_eq!(
        shown_result(json!(45000.5), "d mmm yyyy h:mm").as_deref(),
        Some("15 Mar 2023 12:00")
    );
    assert_eq!(shown_result(json!(45000), "dddd").as_deref(), Some("Wednesday"));
    // General, an unsupported code, and a value that is not a number keep the plain text.
    assert_eq!(shown_result(json!(0.25), "General").as_deref(), Some("0.25"));
    assert_eq!(shown_result(json!(0.25), "[Red]0.0E+0").as_deref(), Some("0.25"));
    assert_eq!(shown_result(json!("hi"), "0%").as_deref(), Some("hi"));
}
