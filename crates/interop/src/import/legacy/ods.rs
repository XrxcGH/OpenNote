//! Importing OpenDocument spreadsheets (`.ods`), the format of LibreOffice Calc and many other apps.
//!
//! An `.ods` file is a ZIP archive whose `content.xml` holds each table's rows and cells. A cell's paragraphs are
//! its shown text, already formatted by the app that saved it, so this reader keeps that text. Rows and cells may
//! say they repeat, often a million times for the empty rest of a sheet. Only repeats with text are read, and no
//! more of them than a page could hold.

use std::collections::HashSet;
use std::io::{Read, Seek};

use super::super::sheet::MAX_TABLE_ROWS;
use super::super::workbook::{GridBuilder, MAX_COLUMNS};
use super::super::xmltree::{Element, Node};
use super::super::zipxml::{ElementExt, Parts};
use super::book::{Book, Sheet, SheetKind, MAX_SHEETS};
use crate::error::{InteropError, Result};

/// The deepest row groups followed.
const MAX_GROUP_DEPTH: usize = 16;
/// The most spaces one `text:s` adds.
const MAX_SPACES: usize = 64;

/// Reads an opened `.ods` file.
pub(super) fn read<R: Read + Seek>(parts: &mut Parts<R>, name: &str) -> Result<Book> {
    let content = parts.xml("content.xml")?.ok_or_else(|| {
        InteropError::format(
            name,
            "it is not an OpenDocument spreadsheet: the file has no content.xml",
        )
    })?;
    let hidden = hidden_styles(&content);
    let spreadsheet = content
        .first("office:body")
        .and_then(|b| b.first("office:spreadsheet"))
        .ok_or_else(|| InteropError::format(name, "it is not an OpenDocument spreadsheet"))?;
    let mut book = Book {
        drawings: !parts.names_under("Object ").is_empty() || !parts.names_under("Pictures/").is_empty(),
        ..Book::default()
    };
    for table in spreadsheet.elements("table:table").take(MAX_SHEETS) {
        let title = table.attr("table:name").unwrap_or("Sheet").to_owned();
        let kind = if table.attr("table:style-name").is_some_and(|s| hidden.contains(s)) {
            SheetKind::Hidden
        } else {
            let mut grid = GridBuilder::default();
            let mut row = 0usize;
            rows(table, &mut grid, &mut row, 0);
            SheetKind::Cells(grid.finish())
        };
        book.sheets.push(Sheet { title, kind });
    }
    Ok(book)
}

/// The table styles that hide their table.
fn hidden_styles(content: &Element) -> HashSet<String> {
    let Some(styles) = content.first("office:automatic-styles") else {
        return HashSet::new();
    };
    styles
        .elements("style:style")
        .filter(|s| s.attr("style:family") == Some("table"))
        .filter(|s| {
            s.first("style:table-properties")
                .and_then(|p| p.attr("table:display"))
                .is_some_and(|d| d == "false")
        })
        .filter_map(|s| s.attr("style:name").map(str::to_owned))
        .collect()
}

/// A repeat count from an attribute, at least 1.
fn repeat(element: &Element, attr: &str) -> usize {
    element
        .attr(attr)
        .and_then(|r| r.trim().parse::<usize>().ok())
        .unwrap_or(1)
        .max(1)
}

/// Reads the rows of a table or a row group into the grid. `row` is the next row's number.
fn rows(parent: &Element, grid: &mut GridBuilder, row: &mut usize, depth: usize) {
    for child in parent.kids() {
        if grid.is_full() {
            return;
        }
        match child.name.as_str() {
            "table:table-row" => {
                let times = repeat(child, "table:number-rows-repeated");
                let cells = cells(child, grid);
                if cells.is_empty() {
                    *row = row.saturating_add(times);
                    continue;
                }
                let kept = times.min(MAX_TABLE_ROWS + 1);
                grid.grid.cut_rows += times - kept;
                for _ in 0..kept {
                    if grid.is_full() {
                        return;
                    }
                    for (col, text) in &cells {
                        grid.push(*row, *col, text.clone());
                    }
                    *row = row.saturating_add(1);
                }
            }
            "table:table-header-rows" | "table:table-row-group" | "table:table-rows" if depth < MAX_GROUP_DEPTH => {
                rows(child, grid, row, depth + 1);
            }
            _ => {}
        }
    }
}

/// The cells of a row with text, each with its column.
fn cells(row: &Element, grid: &mut GridBuilder) -> Vec<(usize, String)> {
    let mut out = Vec::new();
    let mut col = 0usize;
    for cell in row.kids() {
        if !matches!(cell.name.as_str(), "table:table-cell" | "table:covered-table-cell") {
            continue;
        }
        let times = repeat(cell, "table:number-columns-repeated");
        let text = cell_text(cell);
        if !text.is_empty() {
            grid.grid.formulas += usize::from(cell.attr("table:formula").is_some());
            let spans =
                repeat(cell, "table:number-columns-spanned") > 1 || repeat(cell, "table:number-rows-spanned") > 1;
            grid.grid.merged += usize::from(spans);
            let kept = times.min(MAX_COLUMNS.saturating_sub(col));
            grid.grid.cut_columns += times - kept;
            out.extend((0..kept).map(|i| (col + i, text.clone())));
        }
        col = col.saturating_add(times);
    }
    out
}

/// A cell's shown text: its paragraphs joined by line breaks, or its value when it has none.
fn cell_text(cell: &Element) -> String {
    let paragraphs: Vec<String> = cell
        .elements("text:p")
        .map(|p| {
            let mut text = String::new();
            inline_text(p, &mut text, 0);
            text
        })
        .collect();
    if !paragraphs.is_empty() {
        return paragraphs.join("\n");
    }
    [
        "office:value",
        "office:date-value",
        "office:time-value",
        "office:boolean-value",
        "office:string-value",
    ]
    .iter()
    .find_map(|a| cell.attr(a))
    .unwrap_or("")
    .to_owned()
}

fn inline_text(element: &Element, out: &mut String, depth: usize) {
    for node in &element.children {
        match node {
            Node::Text(text) => out.push_str(text),
            Node::Element(e) => match e.name.as_str() {
                "text:s" => out.extend(std::iter::repeat_n(' ', repeat(e, "text:c").min(MAX_SPACES))),
                "text:tab" => out.push('\t'),
                "text:line-break" => out.push('\n'),
                "office:annotation" => {}
                _ if depth < MAX_GROUP_DEPTH => inline_text(e, out, depth + 1),
                _ => {}
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::xmltree::parse;

    #[test]
    fn repeats_are_bounded_and_empty_repeats_cost_nothing() {
        let xml = concat!(
            r#"<table:table table:name="S"><table:table-row>"#,
            r#"<table:table-cell office:value-type="string"><text:p>a<text:s text:c="2"/>b</text:p></table:table-cell>"#,
            r#"<table:table-cell table:number-columns-repeated="16384"/>"#,
            r#"<table:table-cell office:value="3"><text:p>3.0</text:p></table:table-cell></table:table-row>"#,
            r#"<table:table-row table:number-rows-repeated="1048000">"#,
            r#"<table:table-cell table:number-columns-repeated="1024"/></table:table-row>"#,
            r#"<table:table-row table:number-rows-repeated="99999">"#,
            r#"<table:table-cell table:number-columns-repeated="5000"><text:p>x</text:p></table:table-cell>"#,
            r#"</table:table-row></table:table>"#,
        );
        let table = parse(xml);
        let mut grid = GridBuilder::default();
        let mut row = 0;
        rows(&table, &mut grid, &mut row, 0);
        let grid = grid.finish();
        assert_eq!(grid.rows[0][0], "a  b");
        assert_eq!(grid.width, MAX_COLUMNS);
        assert!(grid.cut_rows > 0 && grid.cut_columns > 0);
    }
}
