//! Importing CSV files as tables: one page for each file.
//!
//! The first row is the table's header. Cells hold text, with line breaks kept. A table holds at most 10,000 rows
//! and about 32 MiB of page data. A longer file becomes a table of the rows that fit, and the report counts the
//! rest. A folder of CSV files becomes sections and pages like any other folder of notes.

use std::path::Path;

use super::folder::{import_folder, NoteContent, NoteReader};
use super::scan::NoteFile;
use crate::csv;
use crate::doc::{Block, Inline};
use crate::error::Result;
use crate::report::{PageReport, Report};
use crate::sink::{ImportEnv, ImportSink};

/// The most rows of a file that become one table. The rest are reported as skipped.
pub(super) const MAX_TABLE_ROWS: usize = 10_000;

/// The most columns a table from a sheet or a CSV file has. Cells beyond them are reported as skipped.
pub(super) const MAX_TABLE_COLUMNS: usize = 1_000;

/// About how much page data one table may take, half of what a page may hold (spec 16). Each cell costs its text
/// and about [`CELL_COST`] bytes of JSON besides, so a wide file can reach the limit well before 10,000 rows.
const MAX_TABLE_BYTES: usize = 32 << 20;

/// About how many bytes of JSON a cell or a row takes besides its text.
const CELL_COST: usize = 64;

/// Imports a CSV file, or a folder of them, into a new notebook.
pub fn import_csv(path: &Path, env: &ImportEnv<'_>, sink: &mut dyn ImportSink) -> Result<Report> {
    import_folder(path, &CsvReader, env, sink)
}

/// Reads CSV files.
pub(super) struct CsvReader;

impl NoteReader for CsvReader {
    fn label(&self, _root: &Path) -> String {
        "CSV files".to_owned()
    }

    fn extensions(&self) -> &'static [&'static str] {
        &["csv", "tsv"]
    }

    fn read(&self, text: &str, note: &NoteFile) -> NoteContent {
        table_content(text, note.stem.clone(), None)
    }
}

/// A page that holds the table of a CSV text. `simplified` names what a source app's database lost, if the
/// file came from one, as a short name and the reason.
pub(super) fn table_content(text: &str, title: String, simplified: Option<(&str, &str)>) -> NoteContent {
    // The file is cut to the table's limits while it is read, so its own size never sizes an allocation.
    let table = csv::parse(
        text,
        csv::Limits {
            rows: MAX_TABLE_ROWS + 1,
            columns: MAX_TABLE_COLUMNS,
        },
    );
    if table.rows.is_empty() {
        return NoteContent {
            skip: Some("The file has no rows.".to_owned()),
            ..NoteContent::default()
        };
    }
    let width = table.width();
    let kept = rows_that_fit(table.rows.iter().map(|row| row.iter().map(String::len).sum()), width);
    let rows: Vec<Vec<Vec<Inline>>> = table
        .rows
        .iter()
        .take(kept)
        .map(|row| {
            (0..width)
                .map(|i| cell(row.get(i).map_or("", String::as_str)))
                .collect()
        })
        .collect();
    let mut report = PageReport::default();
    report.came_over(format!("{} rows and {} columns", kept - 1, width));
    if let Some((what, why)) = simplified {
        report.simplified(what, why);
    }
    let (one, many, why) = if kept > MAX_TABLE_ROWS {
        (
            "row beyond the first 10,000",
            "rows beyond the first 10,000",
            "A page holds one table of at most that size.",
        )
    } else {
        (
            "row that did not fit on the page",
            "rows that did not fit on the page",
            "A page holds one table of at most about 32 MiB, and the cells before these filled it.",
        )
    };
    report.skipped_count(table.rows.len() + table.cut_rows - kept, (one, many), why);
    report.skipped_count(
        table.cut_cells,
        (
            "cell beyond the first 1,000 columns",
            "cells beyond the first 1,000 columns",
        ),
        "A table holds at most that many columns.",
    );
    NoteContent {
        title,
        blocks: vec![Block::Table { header: true, rows }],
        notes: report.entries,
        ..NoteContent::default()
    }
}

/// How many rows, the header among them, become the table: at most [`MAX_TABLE_ROWS`] after the header, and only
/// as many as fit in [`MAX_TABLE_BYTES`]. `row_text` gives the bytes of text in each row, and every row has
/// `width` cells, so a caller can count a grid before it builds one.
pub(super) fn rows_that_fit(row_text: impl IntoIterator<Item = usize>, width: usize) -> usize {
    let row_cost = CELL_COST.saturating_mul(width.saturating_add(1));
    let mut bytes = 0usize;
    let mut kept = 0usize;
    for (n, text) in row_text.into_iter().enumerate().take(MAX_TABLE_ROWS + 1) {
        bytes = bytes.saturating_add(row_cost).saturating_add(text);
        if bytes > MAX_TABLE_BYTES && n > 0 {
            return n;
        }
        kept = n + 1;
    }
    kept
}

/// The inlines of a cell: its lines, joined by breaks.
pub(super) fn cell(text: &str) -> Vec<Inline> {
    let mut inlines = Vec::new();
    for (n, line) in text.split('\n').enumerate() {
        if n > 0 {
            inlines.push(Inline::HardBreak);
        }
        if !line.is_empty() {
            inlines.push(Inline::text(line));
        }
    }
    inlines
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::page_builder::PageBuilder;
    use crate::testing::TestEnv;

    #[test]
    fn a_wide_file_keeps_only_the_rows_that_fit_on_a_page() {
        let row = vec!["x".repeat(4); 200].join(",");
        let text = vec![row.as_str(); 10_001].join("\n");
        let content = table_content(&text, "Wide".to_owned(), None);
        let Some(Block::Table { rows, .. }) = content.blocks.first() else {
            panic!("a table");
        };
        assert!(rows.len() < 10_001 && rows.len() > 1_000, "{} rows", rows.len());
        let skipped = content
            .notes
            .iter()
            .find(|e| e.what.contains("did not fit"))
            .expect("an entry");
        assert!(
            skipped.what.starts_with(&format!("{} rows", 10_001 - rows.len())),
            "{}",
            skipped.what
        );

        let world = TestEnv::new();
        let env = world.env();
        let now = env.clock.now();
        let mut builder = PageBuilder::new(&env, "Wide", now, now);
        builder.push_blocks(content.blocks);
        builder.finish().expect("the table fits on its page");
    }

    #[test]
    fn a_huge_file_is_cut_to_the_table_before_it_is_padded() {
        // A line of 100,000 commas over 100,000 one-cell lines: padding every row to the widest row would make
        // 10^10 cells. The table keeps at most 1,000 columns and the rows that fit, and reports the rest.
        let mut text = ",".repeat(100_000);
        text.push('\n');
        text.push_str(&"x\n".repeat(100_000));
        let content = table_content(&text, "Huge".to_owned(), None);
        let Some(Block::Table { rows, .. }) = content.blocks.first() else {
            panic!("a table");
        };
        assert!(rows.iter().all(|row| row.len() == MAX_TABLE_COLUMNS));
        assert!(rows.len() <= MAX_TABLE_ROWS + 1);
        let skipped_rows = content
            .notes
            .iter()
            .find(|e| e.what.contains("rows that did not fit"))
            .expect("an entry for the rows");
        assert!(
            skipped_rows.what.starts_with(&format!("{} rows", 100_001 - rows.len())),
            "{}",
            skipped_rows.what
        );
        assert!(content.notes.iter().any(|e| e.what.starts_with("99001 cells beyond")));
    }
}
