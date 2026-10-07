//! Importing CSV files as tables: one page for each file.
//!
//! The first row is the table's header. Cells hold text, with line breaks kept. A table holds at most 10,000 rows
//! and about 32 MiB of page data. A longer file becomes a table of the rows that fit, and the report counts the
//! rest. A folder of CSV files becomes sections and pages like any other folder of notes.

use std::path::Path;

use super::database;
use super::folder::{import_folder, NoteContent, NoteReader};
use super::scan::NoteFile;
use crate::csv;
use crate::doc::{Block, Inline};
use crate::error::Result;
use crate::report::{PageReport, Report};
use crate::sink::{ImportEnv, ImportSink};

/// The most rows of a file that become one table. The rest are reported as skipped.
pub(super) const MAX_TABLE_ROWS: usize = 10_000;

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
    typed_table_content(text, title, simplified, false)
}

/// Like [`table_content`]. With `typed`, the column types are read from the cells, date cells are written in ISO
/// form, and the page's table becomes a smart table with those types (see [`super::database`]).
pub(super) fn typed_table_content(
    text: &str,
    title: String,
    simplified: Option<(&str, &str)>,
    typed: bool,
) -> NoteContent {
    let mut table = csv::parse(text);
    if table.rows.is_empty() {
        return NoteContent {
            skip: Some("The file has no rows.".to_owned()),
            ..NoteContent::default()
        };
    }
    let kept = rows_that_fit(&table.rows);
    let kinds = if typed {
        let kinds = database::infer_columns(&table.rows[..kept]);
        database::normalize_dates(&mut table.rows[..kept], &kinds);
        kinds
    } else {
        Vec::new()
    };
    let rows: Vec<Vec<Vec<Inline>>> = table
        .rows
        .iter()
        .take(kept)
        .map(|row| row.iter().map(|c| cell(c)).collect())
        .collect();
    let mut report = PageReport::default();
    report.came_over(format!("{} rows and {} columns", kept - 1, table.width()));
    if let Some(types) = database::describe(&table.rows[0], &kinds) {
        report.came_over(types);
    }
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
    report.skipped_count(table.rows.len() - kept, (one, many), why);
    NoteContent {
        title,
        blocks: vec![Block::Table { header: true, rows }],
        notes: report.entries,
        table_kinds: kinds,
        ..NoteContent::default()
    }
}

/// How many rows, the header among them, become the table: at most [`MAX_TABLE_ROWS`] after the header, and only
/// as many as fit in [`MAX_TABLE_BYTES`].
pub(super) fn rows_that_fit(rows: &[Vec<String>]) -> usize {
    let mut bytes = 0usize;
    for (n, row) in rows.iter().enumerate().take(MAX_TABLE_ROWS + 1) {
        bytes += CELL_COST + row.iter().map(|cell| cell.len() + CELL_COST).sum::<usize>();
        if bytes > MAX_TABLE_BYTES && n > 0 {
            return n;
        }
    }
    rows.len().min(MAX_TABLE_ROWS + 1)
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
}
