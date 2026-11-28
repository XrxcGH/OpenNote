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
| Window         | A virtual table draws one run of rows near the view, with a margin on each side as large as the visible rows (at least 20). The window moves once the visible rows have less than three quarters of a margin beyond its edge, so each move draws about a quarter of a margin of new rows.                        |
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

## Scroll frames

In CI the scroll frames failed 2 of 3 runs once the benchmark was quiet: 8.1 to 8.2 ms at the laptop's speed. Most frames take 2 ms. The slow ones are the frames where the window moves, about one in six, so they set the 99th percentile. A trace of those frames found the browser restyling every drawn row, about 555 elements, for the 12 rows that came:

| Cause                                                                                                                                                                                                                                                  | Fix                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The padding's heights were ordinary custom properties on the element around the editor. They are inherited, so each new height restyled every drawn cell.                                                                                              | `@property` registers them as not inherited. The editor and the table's wrapper take them with `inherit`, so only those two restyle (`virtual.module.css`).      |
| The text styles' first block rule (`blocks.module.css`) had `:first-child` before a `+`. A table block's editor carries the text class itself, so the browser tried the rule on every row. When the first drawn row changed, it restyled all its siblings. | `:not(* + *)` says first child without the sibling test on rows, and `:where(:not(tr))` turns rows away. The rule matches the same blocks, with the same weight. |

A window move now restyles about 196 elements, close to the 175 it restyles with no style rules at all. The page's scroll container holds container queries, so the browser does that restyle inside layout. In a trace it showed as 7 to 10 ms of layout per move under load. It is now about 2.5 ms.

`sheet-tables.perf.spec.ts` counts the restyled elements of each move and fails at half the drawn elements. `app/src/features/page/tables/virtual/restyle.css.test.ts` keeps both rules from coming back.

What a move still costs is mostly ProseMirror's. Its view update visits every one of the 10,000 row views once, and looks each one up in every decoration set that marks drawn rows. That second part grows with the rows a move changes: the window's marks, and the spreadsheet keys' numbers for the rows that come and go. Under load, the script of a move took these times:

| Rows that come and go | Script per move |
| --------------------- | --------------- |
| 12 each way           | 8.1 ms          |
| 7 each way            | about 4 ms      |
| 1 each way            | 3.0 ms          |

So the window now moves a quarter of a margin at a time (`nextWindow` in `rows.ts`). It keeps at least three quarters of a margin drawn ahead, more than before. It moves about twice as often: 78 moves in the test's 240 frames instead of 42. Most frames still move nothing.

Results on the development machine, 2026-11-28, with other jobs keeping its processor at 70 to 100% busy. Each row is 10 passes of the test's scroll, the two builds in turn in one browser, so both met the same load:

| CPU throttling | Scroll frame p99, before | After   | Move frame median, before | After   |
| -------------- | ------------------------ | ------- | ------------------------- | ------- |
| 1x             | 24.7 ms                  | 17.9 ms | 19.8 ms                   | 13.2 ms |
| 4x             | 174 ms                   | 120 ms  | 62.8 ms                   | 47.8 ms |

The spec itself ran 10 times on each of two builds: the build before, and the build with the two style fixes but not the smaller moves. The scale was about 2.1. The frames' p99 over the scale went from a median of 9.5 to 7.6 ms. That is the laptop's speed under load, where frames slow more than the benchmark. The load kept the machine from showing the quiet number. CI's runs are in pull request 260.

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
