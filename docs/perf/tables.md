# Long tables: row virtualization

DESIGN.md section 18 (tables) sets two rendering budgets for a table of 10,000 rows:

- First paint within 250 ms of opening its page, with row virtualization. Under 2,000 rows, every row renders.
- Scrolling with no frame over 8 ms on the reference laptop (Surface Laptop Studio 2, 120 Hz).

This page says how the table meets them and how the test measures them.

## How it works

The code is in `app/src/features/page/tables/virtual/`.

| Part           | What it does                                                                                                                                                                                                                                                                                                      |
| -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Threshold      | A table of more than 2,000 rows is virtual. A smaller table keeps exactly the document object model (DOM) it had before: no attribute, no placeholder, and no padding.                                                                                                                                            |
| Window         | A virtual table draws one run of rows near the view, with a margin on each side as large as the visible rows (at least 20). The window moves only when the visible rows come within half a margin of its edge.                                                                                                    |
| Placeholders   | Every other row is an empty comment node. The browser never styles or lays out a comment. A hidden `<tr>` was tried first: each row that came or went then restyled the 10,000 rows beside it, about 17 ms a move.                                                                                                |
| Place          | Padding above and below the table holds the place of the rows outside the window. Each row counts at the height it had when last drawn. A row never drawn counts at the typical drawn row's height. The heights are CSS variables on the element around the editor, so the editor's DOM observer never sees them. |
| Node views     | A node view per row draws the row or its placeholder. The row node asks `editor/table/rowViewSeam.ts` for it, because Tiptap draws an editor's first view before any plugin is in. When the window moves, a decoration marks only the rows that come and go. Typing and moving the caret cost nothing here.       |
| Selection      | The window moves to the row of the selection's head, so the caret is always in a drawn row. Ctrl+End draws the last row, and the browser scrolls to it.                                                                                                                                                           |
| Screen readers | The `<table>` carries `aria-rowcount`, and each drawn row its `aria-rowindex`. The spreadsheet keys number the drawn cells only. Placeholders are not in the accessibility tree.                                                                                                                                  |
| Find           | The document stays whole. Commands, undo, sync, and the table's data-model find see every row. `revealRow` draws a row for a caller that needs its element; the caller scrolls it into view.                                                                                                                      |

## Opening a long table

Profiling the first paint of a 10,000-row table found more than virtualization to fix:

| Cost                                                                              | Before          | After                                |
| --------------------------------------------------------------------------------- | --------------- | ------------------------------------ |
| Spelling asked the view for every cell's element, a walk over every row each time | about 800 ms    | skipped for placeholder rows         |
| Tiptap's first view drew every row before the plugin's node view arrived          | about 500 ms    | placeholders from the first view     |
| A row view found its index by resolving its position                              | about 120 ms    | binary search over cached row starts |
| The Markdown parser ran on 30,000 plain cells                                     | about 150 ms    | plain words and numbers skip it      |
| The static view built every row before the editor replaced it                     | the whole table | the first 60 rows                    |
| The sync read the document twice when it attached                                 | two reads       | one read                             |

The times are from one unthrottled run on the development machine and show only the size of each cost.

## The test

`tests/ui/perf/sheet-tables.perf.spec.ts` runs in the perf project of the UI suite. It uses two page fixtures: `tenThousandRows` (a header and 10,000 rows) and `rows1999`.

- **First paint.** From the click on the page in the tree to the second animation frame after the long table's editor appears.
- **Scrolling.** 240 frames of 80 pixels each, about 600 rows. Each frame's work runs from the start of its animation frame to the first task after it. Ten jumps of 4,000 pixels follow, as a scroll bar drag does. They must show the rows they land on. Each draws a whole new screen of rows, so the frame budget does not apply to them.
- **Scale.** The fixed benchmark of `tree.perf.spec.ts` tells how fast the machine is. A faster machine is throttled to the laptop's speed. A slower one, such as a CI runner, scales both budgets by how much slower it is.
- **Keys.** Ctrl+End selects the last cell. The cell has `aria-rowindex` 10,001, the table has `aria-rowcount` 10,001, and the live region says its address.
- **Threshold.** A 1,999-row table draws all 1,999 rows.

## Results

Development machine, 2026-11-22, CPU load about 6% before the run, scale about 1.6 to 1.8:

| Measure            | Budget at that scale | Result        |
| ------------------ | -------------------- | ------------- |
| First paint        | about 440 ms         | 367 to 413 ms |
| Worst scroll frame | about 14 ms          | 11 ms         |

Before this work, the same table took about 1.7 s to first paint, and the page laid out all 10,000 rows on each change.

## What is left

- A read-only page shows a long table's every row; it has no editor to virtualize.
- The scroll frames still walk all 10,000 row views once per window move, inside ProseMirror. That is about 3 ms on the development machine.
- Raising the paste and import limits from 10,000 rows is owner decision 17, planned for R3.
