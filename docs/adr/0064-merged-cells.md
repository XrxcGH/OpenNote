# ADR 0064: Merged cells are ranges by corner IDs over a whole grid

- Status: Accepted
- Date: 2026-11-01

## Context

The table block stores a full grid: every row has a cell for every column, keyed by column ID (format spec 6.3). The editor's normalizer (`app/src/editor/table/tableKit.ts`) splits any merged cell back into the grid. Excel, Sheets, Numbers, Calc, Word, and Docs all merge cells, and Word and Docs split them.

## Decision

We will keep the stored grid whole and record merges in `data.sheet.merges` as `{from: [rowId, colId], to: [rowId, colId]}`:

- The merge covers the rectangle between the two corner cells in the current order. Inserting rows or columns inside it grows it; deleting a corner moves the corner inward; a merge reduced to one cell is removed. Merges never overlap; a reader that finds an overlap from a concurrent merge keeps the merge with the lower ID.
- The anchor (top-left) cell holds the content. Merging clears the other cells after a warning, as Excel does; "Merge and keep all text" joins them with line breaks, as Word does. Covered cells keep empty Markdown, so a reader without merges shows a sensible table.
- The editor projects merges as `colspan` and `rowspan` on the anchor; the normalizer accepts exactly the declared spans and repairs anything else. The table node carries the declaration as a `merges` attribute: spans by position, read from `data.sheet.merges` by `editor/table/spans.ts`. `tableDataToDoc` writes it with the anchors and leaves the covered cells out. `docToTableData` reads the anchor's text and the empty covered cells back through ProseMirror's table map. Pasted HTML carries no declaration, so a pasted span is split.
- Merge asks first when it removes text. The command returns the count (`warn`), the block shows a dialog, and a yes applies the data and the patch of `data.sheet` as one undo step.
- Spreadsheet keys treat a merged cell as one cell. An arrow leaves the far edge of the merge and keeps the row or column the merge starts in. It lands on the top-left slot of the cell it enters.
- Split cell unmerges a merged cell; on a plain cell it inserts rows and columns and merges the neighbors in the new bands so the table looks unchanged around it.
- Sorting a range that holds a merge across rows is refused, because rows sort one by one; merges inside one row are kept (`sortRefusal` in `sheet/merge/sort.ts`; `sortColumn` in `smart/ops.ts` calls it and announces the refusal).
- Move row up and Move row down are refused when either row of the swap lies inside a merge that spans more than one row, as in Excel (`cutsMerge` hook). A merge inside one row moves with its row. A refused merge or move is announced.
- Fill down, Fill right, and Clear skip the slots a merge covers, so the anchor keeps its own content.
- The Split cell dialog takes columns and rows (2 to 64 cells in all).
- Merge cells, Merge and keep all text, Merge and center, Merge across, Merge vertically, Unmerge, and Split cell are table operations of the structure hooks, so references follow them. Split on a plain cell inserts lines through the same code as Insert row and Insert column.

## Options considered

| Option | For | Against |
|---|---|---|
| Whole grid plus merge ranges by corner IDs (chosen) | Old readers stay correct; insert inside a merge behaves like Excel; merges stay whole because a row move that would cut one is refused | Projection logic in the editor; overlap repair after concurrent edits |
| Spans stored on cells and covered cells removed | Matches HTML | Breaks the whole-grid rule every reader relies on; old readers misplace columns |
| Merges as row and column indices | Simple | Wrong after any insert, delete, or sort by an older client |

## Consequences

- Markdown, CSV, and other grid formats write the anchor's text and empty covered cells; HTML, Word, and Excel write real spans.
- Keyboard movement and selection treat a merged cell as one cell.
