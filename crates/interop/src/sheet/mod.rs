//! The reader of a table's `data.sheet` for exports (format spec 6.3, ADR 0067). It resolves each cell's style,
//! finds the active merges, and takes the cached results of formula cells when they are fresh. The page-to-document
//! conversion calls it, so the Word and HTML tables draw the cells as the spreadsheet does.

mod read;

pub use read::{fingerprint, read};

use crate::doc::cell_style::CellStyle;

/// A merged range, as zero-based row and column positions of its corners.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Merge {
    /// The first row, which holds the anchor.
    pub top: usize,
    /// The first column, which holds the anchor.
    pub left: usize,
    /// The last row.
    pub bottom: usize,
    /// The last column.
    pub right: usize,
}

impl Merge {
    /// Whether the cell at `row` and `column` is inside the merge but is not its anchor.
    pub fn covers(&self, row: usize, column: usize) -> bool {
        row >= self.top
            && row <= self.bottom
            && column >= self.left
            && column <= self.right
            && (row, column) != (self.top, self.left)
    }
}

/// What the sheet adds to a table.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct TableSheet {
    /// The resolved style of each cell, by row and column. A cell no layer styles holds `None`.
    pub styles: Vec<Vec<Option<CellStyle>>>,
    /// The merges that apply, in ID order.
    pub merges: Vec<Merge>,
    /// The text of a formula or spilled cell's cached result, by row and column. `None` keeps the cell as it is.
    pub results: Vec<Vec<Option<String>>>,
    /// Whether the table has formula cells whose cached results are missing or out of date, so they show their text.
    pub stale: bool,
    /// The table's name, when the sheet gives one.
    pub name: Option<String>,
}

#[cfg(test)]
mod tests;
