//! Stamping a page with the lowest format version its content needs (spec 15.6, ADR 0078).
//!
//! The rows of the stamping table that need version 2 are `R-STAMP-8` to `R-STAMP-13`: a mark of version 2 or a
//! foreign mark, a footnote reference, a note, comment, or suggestion record, a `break` block, and spreadsheet
//! data that a version 1 reader would misread. Everything else, including paragraph formatting, lists, styles,
//! text settings, and code blocks, stays version 1, so older devices can still edit the page.

use serde_json::Value;

use super::inline;
use crate::format::header::Stamp;
use crate::model::{Block, BlockData, JsonMap, Page, TableData};

/// The block type that version 2 defines (spec 6.12).
pub const BREAK_TYPE: &str = "break";

/// The version keys a writer gives the page (`R-VER-8`). A page of a later version keeps its keys (`R-VER-5`).
pub fn page_stamp(page: &Page) -> Stamp {
    if let Some(kept) = Stamp::kept(&page.format) {
        return kept;
    }
    Stamp::new(if page_needs_v2(page) { 2 } else { 1 })
}

/// Whether any block of the page holds a feature of version 2.
pub fn page_needs_v2(page: &Page) -> bool {
    page.blocks.iter().any(|block| block_needs_v2(block))
}

/// Whether a block holds a feature of version 2.
pub fn block_needs_v2(block: &Block) -> bool {
    match &block.data {
        BlockData::Text(text) => has_records(&text.extra) || inline::needs_v2(&text.markdown),
        BlockData::Table(table) => table_needs_v2(table),
        BlockData::Other(other) => match other.type_name.as_ref() {
            BREAK_TYPE => true,
            // A text or table block whose data could not be read keeps its JSON, which still counts.
            "text" => {
                has_records(&other.data)
                    || other
                        .data
                        .get("markdown")
                        .and_then(Value::as_str)
                        .is_some_and(inline::needs_v2)
            }
            "table" => has_records(&other.data) || raw_table_needs_v2(&other.data),
            _ => false,
        },
        BlockData::Ink(_) | BlockData::Image(_) | BlockData::File(_) => false,
    }
}

/// `R-STAMP-10`: an entry in `data.notes`, `data.comments`, or `data.suggestions`. An empty map holds none.
fn has_records(data: &JsonMap) -> bool {
    ["notes", "comments", "suggestions"]
        .iter()
        .any(|key| data.get(*key).is_some_and(truthy))
}

/// Whether a value holds anything, as the stamping table counts it: an empty map, list, or string, `false`,
/// `0`, and `null` hold nothing.
fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|v| v != 0.0),
        Value::String(s) => !s.is_empty(),
        Value::Array(items) => !items.is_empty(),
        Value::Object(map) => !map.is_empty(),
    }
}

fn table_needs_v2(table: &TableData) -> bool {
    let cells: Vec<&str> = table
        .rows
        .iter()
        .flat_map(|row| row.cells.values().map(|cell| cell.markdown.as_str()))
        .collect();
    has_records(&table.extra)
        || cells.iter().any(|md| inline::needs_v2(md))
        || sheet_needs_v2(table.extra.get("sheet"), &cells)
}

fn raw_table_needs_v2(data: &JsonMap) -> bool {
    let rows = data
        .get("rows")
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default();
    let cells: Vec<&str> = rows
        .iter()
        .filter_map(|row| row.get("cells").and_then(Value::as_object))
        .flat_map(|cells| cells.values())
        .filter_map(|cell| cell.get("markdown").and_then(Value::as_str))
        .collect();
    cells.iter().any(|md| inline::needs_v2(md)) || sheet_needs_v2(data.get("sheet"), &cells)
}

/// `R-STAMP-12` and `R-STAMP-13`: spreadsheet data that a version 1 reader would misread.
fn sheet_needs_v2(sheet: Option<&Value>, cells: &[&str]) -> bool {
    let Some(sheet) = sheet.and_then(Value::as_object) else {
        return false;
    };
    let records = ["merges", "names", "validation", "conditional", "values"];
    records.iter().any(|key| sheet.get(*key).is_some_and(truthy))
        || (sheet.contains_key("v") && cells.iter().any(|md| is_formula(md)))
}

/// A formula cell (`R-SHT-5`): its readable text starts with `=`.
pub fn is_formula(markdown: &str) -> bool {
    inline::readable_text(markdown).starts_with('=')
}

#[cfg(test)]
mod tests;
