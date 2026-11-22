// checks-disable-file brand-consistency, length: the test data holds color values to check how they are written
use super::*;
use crate::sheet::{fingerprint, read};
use opennote_core::model::{TableCell, TableColumn, TableRow};
use opennote_core::{ColumnId, RowId};
use serde_json::{json, Map};

/// The every-key fixture of the sheet model, which the TypeScript tests also read.
const EVERY_KEY: &str = include_str!("../../../../../app/src/features/tables/fixtures/sheet/every-key.json");

fn column_id(n: usize) -> String {
    format!("01m3sbcmt0000000000000k{n:03}")
}

fn row_id(n: usize) -> String {
    format!("01m3sbcmt0000000000000r{n:03}")
}

/// A table with a header row, the given cell Markdown, and column widths in page units.
fn table(rows: &[&[&str]], widths: &[f64]) -> TableData {
    TableData {
        header: true,
        columns: widths
            .iter()
            .enumerate()
            .map(|(c, w)| TableColumn {
                id: ColumnId::parse(&column_id(c + 1)).unwrap(),
                width: Some(*w),
                extra: Map::new(),
            })
            .collect(),
        rows: rows
            .iter()
            .enumerate()
            .map(|(r, cells)| TableRow {
                id: RowId::parse(&row_id(r + 1)).unwrap(),
                cells: cells
                    .iter()
                    .enumerate()
                    .map(|(c, text)| {
                        (
                            ColumnId::parse(&column_id(c + 1)).unwrap(),
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
        extra: Map::new(),
    }
}

fn texts(table: &TableData) -> Vec<Vec<String>> {
    table
        .rows
        .iter()
        .map(|row| {
            table
                .columns
                .iter()
                .map(|c| row.cells.get(&c.id).map_or(String::new(), |cell| cell.markdown.clone()))
                .collect()
        })
        .collect()
}

fn book(table: &TableData, excel: Option<&str>) -> Vec<TableRef> {
    let head = texts(table).remove(0);
    vec![TableRef {
        name: "Table1".to_owned(),
        excel: excel.map(str::to_owned),
        sheet: "Prices".to_owned(),
        header: true,
        columns: head,
        rows: table.rows.len(),
    }]
}

fn write(table: &TableData, excel: Option<&str>) -> (Written, StyleSheet) {
    let sheet = read(table);
    let book = book(table, excel);
    let texts = texts(table);
    let mut styles = StyleSheet::default();
    let input = Input {
        texts: &texts,
        table: Some(table),
        sheet: sheet.as_ref(),
        header: true,
        book: &book,
        own: 0,
        lists: &[],
        table_id: 1,
        sheet_number: 1,
    };
    (worksheet(&input, &mut styles), styles)
}

/// The prices table of the lane's golden test: a calculated column `Total` and one plain formula in `Check`.
pub(crate) fn prices() -> TableData {
    let mut t = table(
        &[
            &["Item", "Qty", "Price", "Total", "Check"],
            &["Pens", "2", "5", "=[Qty]*[Price]", "=B2*C2"],
            &["Ink", "3", "4", "=[Qty]*[Price]", ""],
        ],
        &[160.0, 80.0, 80.0, 80.0, 80.0],
    );
    let values = json!({
        row_id(2): { column_id(4): 10, column_id(5): 10 },
        row_id(3): { column_id(4): 12 },
    });
    let sheet = json!({
        "v": 1,
        "valuesOf": fingerprint(&t),
        "values": values,
        "styles": {
            "f1": { "fill": "#FDE68A" },
            "b1": { "border": { "b": { "style": "double" } } }
        },
        "cells": {
            row_id(2): { column_id(1): "f1" },
            row_id(3): { column_id(1): "b1" }
        }
    });
    t.extra.insert("sheet".to_owned(), sheet);
    t
}

#[test]
fn formulas_export_translated_with_their_cached_values() {
    let (written, _) = write(&prices(), Some("Table1"));
    let xml = &written.sheet;
    assert!(
        xml.contains("<f>Table1[[#This Row],[Qty]]*Table1[[#This Row],[Price]]</f><v>10</v>"),
        "{xml}"
    );
    assert!(
        xml.contains("<f>Table1[[#This Row],[Qty]]*Table1[[#This Row],[Price]]</f><v>12</v>"),
        "{xml}"
    );
    assert!(xml.contains("<c r=\"E2\"><f>B3*C3</f><v>10</v></c>"), "{xml}");
    let part = written.table.expect("a ListObject");
    assert!(
        part.contains("ref=\"A1:E3\"") && part.contains("name=\"Table1\""),
        "{part}"
    );
    assert!(
        part.contains("<tableColumn id=\"4\" name=\"Total\"><calculatedColumnFormula>Table1[[#This Row],[Qty]]*Table1[[#This Row],[Price]]</calculatedColumnFormula></tableColumn>"),
        "{part}"
    );
    assert!(part.contains("<tableColumn id=\"5\" name=\"Check\"/>"), "{part}");
    assert!(xml.contains("<tablePart r:id=\"rId1\"/>"), "{xml}");
}

#[test]
fn a_stale_cache_exports_formulas_without_values() {
    let mut t = prices();
    t.rows[1].cells.values_mut().next().expect("a cell").markdown = "Pencils".to_owned();
    let (written, _) = write(&t, Some("Table1"));
    assert!(written.sheet.contains("<f>B3*C3</f></c>"), "{}", written.sheet);
    assert!(!written.sheet.contains("<v>10</v>"), "{}", written.sheet);
}

#[test]
fn fills_and_borders_reach_the_style_sheet() {
    let (written, styles) = write(&prices(), Some("Table1"));
    let xml = styles.xml();
    assert!(
        xml.contains("<patternFill patternType=\"solid\"><fgColor rgb=\"FFFDE68A\"/>"),
        "{xml}"
    );
    assert!(xml.contains("<bottom style=\"double\">"), "{xml}");
    assert!(written.sheet.contains("<c r=\"A2\" s=\""), "{}", written.sheet);
}

#[test]
fn a_column_of_160_page_units_has_the_documented_width() {
    // ECMA-376 Part 1, 18.3.1.13 with a maximum digit width of 7: characters are trunc((160 - 5) / 7 * 100 + 0.5)
    // / 100 = 22.14, and the width is trunc((22.14 * 7 + 5) / 7 * 256) / 256 = 5850 / 256 = 22.8515625.
    assert!((column_width(160.0) - 22.85).abs() < 0.1);
    assert_eq!(column_width(160.0), 5850.0 / 256.0);
    let (written, _) = write(&prices(), Some("Table1"));
    assert!(
        written
            .sheet
            .contains("<col min=\"1\" max=\"1\" width=\"22.8515625\" customWidth=\"1\"/>"),
        "{}",
        written.sheet
    );
}

#[test]
fn every_sheet_key_reaches_the_worksheet() {
    let fixture: Value = serde_json::from_str(EVERY_KEY).expect("the fixture");
    let mut t = table(
        &[&["A1", "B1", "C1"], &["A2", "B2", "C2"], &["A3", "B3", "C3"]],
        &[120.0; 3],
    );
    t.extra.insert("sheet".to_owned(), fixture["data"]["sheet"].clone());
    let (written, styles) = write(&t, None);
    let xml = &written.sheet;
    // The row of height 28 page units is 21 points. Column B, 120 page units wide, is trunc((115 / 7 * 100 + 0.5)) / 100
    // = 16.43 characters, so trunc((16.43 * 7 + 5) / 7 * 256) / 256 = 4388 / 256 wide, at outline level 1.
    assert!(xml.contains("<row r=\"2\" ht=\"21\" customHeight=\"1\">"), "{xml}");
    assert!(
        xml.contains("<col min=\"2\" max=\"2\" width=\"17.140625\" customWidth=\"1\" outlineLevel=\"1\"/>"),
        "{xml}"
    );
    assert!(xml.contains("outlineLevelCol=\"1\""), "{xml}");
    assert!(
        xml.contains("<pane ySplit=\"1\" topLeftCell=\"A2\" activePane=\"bottomLeft\" state=\"frozen\"/>"),
        "{xml}"
    );
    assert!(
        xml.contains("<mergeCells count=\"1\"><mergeCell ref=\"A1:B1\"/></mergeCells>"),
        "{xml}"
    );
    assert!(
        xml.contains("<dataValidation type=\"decimal\" operator=\"between\" allowBlank=\"1\" showErrorMessage=\"1\" sqref=\"B1:B3\"><formula1>0</formula1><formula2>100</formula2></dataValidation>"),
        "{xml}"
    );
    assert!(
        xml.contains("<conditionalFormatting sqref=\"C1:C3\"><cfRule type=\"colorScale\" priority=\"1\"><colorScale><cfvo type=\"min\"/><cfvo type=\"max\"/><color rgb=\"FFB0342A\"/><color rgb=\"FF2E7048\"/></colorScale></cfRule></conditionalFormatting>"),
        "{xml}"
    );
    assert!(xml.contains("<legacyDrawing r:id=\"rId3\"/>"), "{xml}");
    // A merge rules out a ListObject.
    assert!(written.table.is_none());
    let (comments, vml) = written.comments.expect("comments");
    assert!(
        comments
            .contains("<comment ref=\"A2\" authorId=\"0\"><text><r><t xml:space=\"preserve\">Check with the lab.</t>"),
        "{comments}"
    );
    assert!(vml.contains("<x:Row>1</x:Row><x:Column>0</x:Column>"), "{vml}");
    // The fill of the fixture's style.
    assert!(styles.xml().contains("FFFDE68A"));
}

#[test]
fn conditional_rules_with_styles_use_differential_formats() {
    let mut t = table(&[&["N"], &["5"], &["-1"]], &[80.0]);
    t.extra.insert(
        "sheet".to_owned(),
        json!({
            "styles": { "red": { "font": { "color": "brick" }, "fill": "rose" } },
            "conditional": {
                "c1": { "order": 2, "ranges": [ { "col": column_id(1) } ], "type": "cell", "op": "less", "a": "0", "style": "red" },
                "c2": { "order": 1, "ranges": [ { "col": column_id(1) } ], "type": "text", "op": "begins", "text": "N", "style": "red", "stop": true }
            }
        }),
    );
    let (written, styles) = write(&t, None);
    let xml = &written.sheet;
    assert!(
        xml.contains("<cfRule type=\"beginsWith\" operator=\"beginsWith\" text=\"N\" dxfId=\"0\" priority=\"1\" stopIfTrue=\"1\"><formula>LEFT(A1,LEN(&quot;N&quot;))=&quot;N&quot;</formula></cfRule>"),
        "{xml}"
    );
    assert!(
        xml.contains(
            "<cfRule type=\"cellIs\" operator=\"lessThan\" dxfId=\"0\" priority=\"2\"><formula>0</formula></cfRule>"
        ),
        "{xml}"
    );
    assert!(styles.xml().contains("<dxfs count=\"1\">"));
}

#[test]
fn rule_operands_become_excel_values() {
    let one = [TableRef {
        name: "Table1".to_owned(),
        header: true,
        columns: vec!["A".to_owned()],
        rows: 3,
        ..TableRef::default()
    }];
    let cx = Context {
        book: &one,
        own: 0,
        row: Some(2),
    };
    assert_eq!(operand("12.5", &cx), "12.5");
    assert_eq!(operand("2026-03-04", &cx), "DATE(2026,3,4)");
    assert_eq!(operand("09:30", &cx), "TIME(9,30,0)");
    assert_eq!(operand("say \"hi\"", &cx), "\"say \"\"hi\"\"\"");
    assert_eq!(operand("=A1*2", &cx), "A2*2");
}
