//! What every spreadsheet importer shares: a grid of cell text with fixed limits, and the table page made from it.
//!
//! The Excel (`.xlsx`, `.xls`, `.xlsb`) and OpenDocument (`.ods`) readers put each cell into a [`GridBuilder`],
//! which drops what no page could hold before it allocates anything for it. [`sheet_page`] then turns the grid into
//! a table page with its report.

use super::files::ConvertedPage;
use super::sheet::{cell, rows_that_fit, MAX_TABLE_ROWS};
use crate::doc::{Block, Inline};
use crate::error::Result;
use crate::page_builder::PageBuilder;
use crate::report::PageReport;
use crate::sink::ImportEnv;
use opennote_core::Timestamp;

/// The widest table a sheet becomes.
pub(super) const MAX_COLUMNS: usize = 1_000;

/// The most cells a grid keeps, so a sheet of millions of small cells cannot exhaust memory.
const MAX_CELLS: usize = 2_000_000;

/// The most text a grid keeps, in bytes. A page holds far less, so nothing that fits is lost.
const MAX_TEXT_BYTES: usize = 64 << 20;

/// The cells of a sheet as text.
#[derive(Default)]
pub(super) struct Grid {
    /// The rows, from the first row with a value, each as wide as the widest.
    pub rows: Vec<Vec<String>>,
    /// The number of columns.
    pub width: usize,
    /// Cells that hold a formula.
    pub formulas: usize,
    /// Merged ranges.
    pub merged: usize,
    /// Cells whose number format was not kept.
    pub other_formats: usize,
    /// Cells past the widest column a table takes.
    pub cut_columns: usize,
    /// Rows past the most a table takes, or past the memory limits, that were never read in.
    pub cut_rows: usize,
}

/// Collects cells in any order and makes a [`Grid`].
#[derive(Default)]
pub(super) struct GridBuilder {
    cells: Vec<(usize, usize, String)>,
    bytes: usize,
    /// Counts that pass straight into the grid.
    pub grid: Grid,
    dropped_rows: Vec<usize>,
}

impl GridBuilder {
    /// Adds a cell at a row and column, both counted from 0. Empty text adds nothing.
    pub fn push(&mut self, row: usize, col: usize, text: String) {
        if text.is_empty() {
            return;
        }
        if col >= MAX_COLUMNS {
            self.grid.cut_columns += 1;
            return;
        }
        if self.cells.len() >= MAX_CELLS || self.bytes.saturating_add(text.len()) > MAX_TEXT_BYTES {
            if self.dropped_rows.last() != Some(&row) && self.dropped_rows.len() < MAX_TABLE_ROWS {
                self.dropped_rows.push(row);
            }
            return;
        }
        self.bytes += text.len();
        self.cells.push((row, col, text));
    }

    /// Whether the grid takes no more cells, so a reader can stop early.
    pub fn is_full(&self) -> bool {
        self.cells.len() >= MAX_CELLS || self.bytes >= MAX_TEXT_BYTES
    }

    /// The grid, at most one header row and [`MAX_TABLE_ROWS`] rows below it tall.
    pub fn finish(mut self) -> Grid {
        let mut grid = std::mem::take(&mut self.grid);
        let Some(first_row) = self.cells.iter().map(|c| c.0).min() else {
            grid.cut_rows += self.dropped_rows.len();
            return grid;
        };
        let tallest = MAX_TABLE_ROWS + 1;
        let mut cut: Vec<usize> = self
            .cells
            .iter()
            .map(|c| c.0 - first_row)
            .filter(|r| *r >= tallest)
            .chain(self.dropped_rows.iter().map(|r| r.saturating_sub(first_row)))
            .collect();
        cut.sort_unstable();
        cut.dedup();
        grid.cut_rows += cut.len();
        let kept = self.cells.into_iter().filter(|c| c.0 - first_row < tallest);
        let kept: Vec<(usize, usize, String)> = kept.collect();
        let height = kept.iter().map(|c| c.0 - first_row + 1).max().unwrap_or(0);
        let width = kept.iter().map(|c| c.1 + 1).max().unwrap_or(0);
        let mut rows = vec![vec![String::new(); width]; height];
        for (r, c, text) in kept {
            if let Some(slot) = rows.get_mut(r - first_row).and_then(|row| row.get_mut(c)) {
                *slot = text;
            }
        }
        grid.rows = rows;
        grid.width = width;
        grid
    }
}

/// When a sheet's file was made and changed.
pub(super) struct Dates {
    pub created: Timestamp,
    pub modified: Timestamp,
}

/// A table page for one sheet, with its report. `source` names the file in the report.
pub(super) fn sheet_page(
    env: &ImportEnv<'_>,
    title: &str,
    source: &str,
    dates: &Dates,
    grid: Grid,
) -> Result<ConvertedPage> {
    let mut report = PageReport {
        title: title.to_owned(),
        source: source.to_owned(),
        entries: Vec::new(),
    };
    let mut builder = PageBuilder::new(env, title, dates.created, dates.modified);
    if grid.rows.is_empty() {
        report.skipped("sheet", "The sheet has no cells with values.");
        builder.push_blocks(vec![Block::Paragraph(vec![Inline::text("This sheet was empty.")])]);
    } else {
        let kept = rows_that_fit(&grid.rows);
        let rows: Vec<Vec<Vec<Inline>>> = grid
            .rows
            .iter()
            .take(kept)
            .map(|r| r.iter().map(|c| cell(c)).collect())
            .collect();
        report.came_over(format!("{} rows and {} columns", kept.saturating_sub(1), grid.width));
        let (one, many, why) = if kept > MAX_TABLE_ROWS || grid.cut_rows > 0 {
            (
                "row beyond the first 10,000",
                "rows beyond the first 10,000",
                "A page holds one table of at most that size.",
            )
        } else {
            (
                "row that did not fit on the page",
                "rows that did not fit on the page",
                "A page holds one table of at most about 32 MiB.",
            )
        };
        report.skipped_count(grid.rows.len() - kept + grid.cut_rows, (one, many), why);
        builder.push_blocks(vec![Block::Table { header: true, rows }]);
    }
    report_counts(&mut report, &grid);
    Ok(ConvertedPage {
        section: None,
        page: builder.finish()?,
        report,
    })
}

fn report_counts(report: &mut PageReport, grid: &Grid) {
    report.simplified_count(
        grid.formulas,
        ("formula", "formulas"),
        "A formula shows its last calculated value, or its text when the file holds no value.",
    );
    report.simplified_count(
        grid.merged,
        ("merged range", "merged ranges"),
        "Each merged range became its first cell and empty cells.",
    );
    report.simplified_count(
        grid.other_formats,
        ("cell with a number format", "cells with number formats"),
        "Only date and percentage formats are kept. The others show the plain number.",
    );
    report.skipped_count(
        grid.cut_columns,
        ("column beyond the first 1,000", "columns beyond the first 1,000"),
        "A table holds at most that many columns.",
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_far_away_cell_is_counted_instead_of_allocated() {
        let mut builder = GridBuilder::default();
        builder.push(3, 0, "first".to_owned());
        builder.push(usize::MAX - 1, 2, "far".to_owned());
        builder.push(4, 5_000, "wide".to_owned());
        let grid = builder.finish();
        assert_eq!(grid.rows, vec![vec!["first".to_owned()]]);
        assert_eq!((grid.cut_rows, grid.cut_columns), (1, 1));
    }

    #[test]
    fn rows_start_at_the_first_row_with_a_value() {
        let mut builder = GridBuilder::default();
        builder.push(5, 1, "b".to_owned());
        builder.push(4, 0, "a".to_owned());
        let grid = builder.finish();
        assert_eq!(
            grid.rows,
            vec![vec!["a".to_owned(), String::new()], vec![String::new(), "b".to_owned()]]
        );
        assert_eq!(grid.width, 2);
    }
}
