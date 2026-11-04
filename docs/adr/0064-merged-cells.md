# ADR 0064: Merged cells are ranges by corner IDs over a whole grid

- Status: Proposed
- Date: 2026-11-01

## Context

The table block stores a full grid: every row has a cell for every column, keyed by column ID (format spec 6.3). The editor's normalizer (`app/src/editor/table/tableKit.ts`) splits any merged cell back into the grid. Excel, Sheets, Numbers, Calc, Word, and Docs all merge cells, and Word and Docs split them.

## Decision

We will keep the stored grid whole and record merges in `data.sheet.merges` as `{from: [rowId, colId], to: [rowId, colId]}`:

- The merge covers the rectangle between the two corner cells in the current order. Inserting rows or columns inside it grows it; deleting a corner moves the corner inward; a merge reduced to one cell is removed. Merges never overlap; a reader that finds an overlap from a concurrent merge keeps the merge with the lower ID.
- The anchor (top-left) cell holds the content. Merging clears the other cells after a warning, as Excel does; "Merge and keep all text" joins them with line breaks, as Word does. Covered cells keep empty Markdown, so a reader without merges shows a sensible table.
- The editor projects merges as `colspan` and `rowspan` on the anchor; the normalizer accepts exactly the declared spans and repairs anything else.
- Split cell unmerges a merged cell; on a plain cell it inserts rows and columns and merges the neighbors in the new bands so the table looks unchanged around it.
- Sorting a range that cuts through merges of different sizes is refused, as in Excel.

## Options considered

| Option | For | Against |
|---|---|---|
| Whole grid plus merge ranges by corner IDs (chosen) | Old readers stay correct; insert inside a merge behaves like Excel; merges survive row moves | Projection logic in the editor; overlap repair after concurrent edits |
| Spans stored on cells and covered cells removed | Matches HTML | Breaks the whole-grid rule every reader relies on; old readers misplace columns |
| Merges as row and column indices | Simple | Wrong after any insert, delete, or sort by an older client |

## Consequences

- Markdown, CSV, and other grid formats write the anchor's text and empty covered cells; HTML, Word, and Excel write real spans.
- Keyboard movement and selection treat a merged cell as one cell.
