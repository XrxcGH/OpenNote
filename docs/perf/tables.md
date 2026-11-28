# Long tables: row virtualization

DESIGN.md section 18 (tables) sets two rendering budgets for a table of 10,000 rows:

- First paint within 250 ms of opening its page, with row virtualization. Under 2,000 rows, every row renders.
- Scrolling with no frame over 8 ms on the reference laptop (Surface Laptop Studio 2, 120 Hz).

Typing in one of its cells keeps the typing budget of every page: 16 ms of script per key, at the 95th percentile.

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

- **First paint.** From the click on the page in the tree to the second animation frame after the new page's table appears. The page that was open has the same table, so the timer waits for a new table element.
- **Five opens.** The test opens five pages with the same table, one after another. The median of the five holds the budget.
- **Scrolling.** 240 frames of 80 pixels each, about 600 rows. Each frame's work runs from the start of its animation frame to the first task after it. The test scrolls three such passes. The 8 ms target holds for the median of the passes' 99th percentiles, each the third slowest of its 240 frames. In the median pass, no frame may take over twice the target. So one stray frame under load does not fail the run. Ten jumps of 4,000 pixels follow, as a scroll bar drag does. They must show the rows they land on. Each draws a whole new screen of rows, so the frame budget does not apply to them.
- **Scale.** The fixed benchmark of `tree.perf.spec.ts` tells how fast the machine is. A faster machine is throttled to the laptop's speed. A slower one, such as a CI runner, scales every budget by how much slower it is. The benchmark runs before each open and after each scroll pass, and the scale is the median of those eight samples (`tests/ui/perf/calibration.ts`).
- **Alone.** CI runs the perf project in its own step, in one worker, after the rest of the UI suite (`OPENNOTE_UI_PERF`). Beside another test, the runner's speed changed from one second to the next, so one benchmark sample did not tell the speed the opens and the frames met.
- **Each jump.** Three frames after each jump, a drawn row must cover the middle of the screen, unless the table does not reach it.
- **Typing.** Forty keys typed into a cell, 120 ms apart, with the typing benchmark's key timer. The script time per key (p95) must meet the 16 ms budget, scaled as above. The run also reports the frames over 50 ms.
- **Keys.** Ctrl+End selects the last cell. The cell has `aria-rowindex` 10,001, the table has `aria-rowcount` 10,001, and the live region says its address.
- **Threshold.** A 1,999-row table draws all 1,999 rows.

## Results

Development machine, 2026-11-22, CPU load about 6% before the run, scale about 1.6 to 1.8:

| Measure            | Budget at that scale | Result        |
| ------------------ | -------------------- | ------------- |
| First paint        | about 440 ms         | 367 to 413 ms |
| Worst scroll frame | about 14 ms          | 11 ms         |

The same machine later that day, at scale 1.7 to 1.8, after the typing work below (four runs):

| Measure                | Budget at that scale | Result      |
| ---------------------- | -------------------- | ----------- |
| Scroll frame, p99      | about 14 ms          | 10 to 13 ms |
| Worst scroll frame     | about 28 ms          | 11 to 14 ms |
| Typing, script per key | about 28 ms          | 17 to 18 ms |

## Typing in a long table

Each key made a new document, and several passes walked every row of it. A profile of forty keys in the 10,000-row table found these:

| Cost per key                                                 | Fix                                                                                                  |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| The table normalizer laid out and stamped IDs on every row   | skipped when every step stays inside one cell of a table already whole (`editor/table/cellEdits.ts`) |
| The spreadsheet keys built the whole grid to find one cell   | one row is read; the cell under a position comes from its indexes                                    |
| The spreadsheet keys read every cell's text on each key      | each row's texts are kept by row node, so only the typed row is read again                           |
| The drawn cells' numbers were made again over every row      | mapped through a change inside one cell; a window move adds and drops only the rows that change      |
| The table sync compared the table's shape as text            | rows the key left alone are compared by reference                                                    |
| The formula bar built the whole grid to find the edited cell | one row is read                                                                                      |

Together they took the script time per key from about 32 ms to about 16 ms on the development machine, unthrottled. The first key after a table opens still checks the whole table once.

Before this work, the same table took about 1.7 s to first paint, and the page laid out all 10,000 rows on each change.

## Sheet styles in a long table

- **Measuring.** The measuring pass of the sheet styles (`features/tables/sheet/render/measure.ts`) finds each drawn row's number in its `aria-rowindex`, so its values land on the right row. When the window moves, the rows it now draws are measured.
- **Decorations.** Only the drawn rows get the sheet style decorations. ProseMirror would wrap a placeholder comment that gets attributes in an element.
- **Frozen rows.** The frozen leading rows stay drawn wherever the window is (`setPinnedRows`, up to 200 rows). The padding above holds only the rows between them and the window.
- **Range selection.** The spreadsheet keys mark `aria-selected` on the drawn rows only.
- **Sync.** Reading the table back to its data redoes only the rows that changed since the last read, when no row was added, removed, or merged.

## What is left

- Table find is not built yet. When it lands, it must call `revealRow` for each match in a long table, so the row is drawn before it is scrolled to or marked.
- prosemirror-tables still makes a new table map on each key (about 1 ms here), and ProseMirror still visits every row view once per key and once per window move.
- A large range selection still costs one prosemirror-tables decoration per selected cell.

- A read-only page shows a long table's every row; it has no editor to virtualize.
- The scroll frames still walk all 10,000 row views once per window move, inside ProseMirror. That is about 3 ms on the development machine. Each decoration set with marks on drawn rows adds to it, since ProseMirror looks up every row in each set.
- Raising the paste and import limits from 10,000 rows is owner decision 17, planned for R3.
