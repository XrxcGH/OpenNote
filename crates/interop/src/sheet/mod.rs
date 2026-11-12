//! The reader of a table's `data.sheet` for exports (format spec 6.3, ADR 0067). It resolves each cell's style,
//! finds the active merges, and takes the cached results of formula cells when they are fresh. The page-to-document
//! conversion calls it, so the Word and HTML tables draw the cells as the spreadsheet does.

mod numfmt;
mod read;

pub use read::{fingerprint, read, MERGE_LIMIT};

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

/// What a merge makes of one cell.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Slot {
    /// The cell holds the content of the merge.
    Anchor(Merge),
    /// The cell is inside the merge but is not its anchor.
    Covered(Merge),
}

/// Where each merge sits, built once per table so a writer asks per cell in constant time. The merges do not
/// overlap, so the index holds at most one entry per cell of the grid.
#[derive(Debug, Default)]
pub struct MergeIndex(std::collections::HashMap<(usize, usize), Slot>);

impl MergeIndex {
    /// Indexes `merges`. A merge outside the grid of `rows` by `columns` is cut to it, and a cell a merge already
    /// holds keeps its first merge.
    pub fn new(merges: &[Merge], rows: usize, columns: usize) -> Self {
        let mut map = std::collections::HashMap::new();
        for m in merges {
            if m.top >= rows || m.left >= columns {
                continue;
            }
            for r in m.top..=m.bottom.min(rows - 1) {
                for c in m.left..=m.right.min(columns - 1) {
                    let slot = if (r, c) == (m.top, m.left) {
                        Slot::Anchor(*m)
                    } else {
                        Slot::Covered(*m)
                    };
                    map.entry((r, c)).or_insert(slot);
                }
            }
        }
        Self(map)
    }

    /// What the merges make of the cell at `row` and `column`, if anything.
    pub fn slot(&self, row: usize, column: usize) -> Option<Slot> {
        self.0.get(&(row, column)).copied()
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
