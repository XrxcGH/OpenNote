# Page layout model

This folder turns a page's view settings into geometry and plans where its blocks land on sheets. It is pure TypeScript over page units (1/96 inch), with no Document Object Model (DOM) and no React. The page view, the page setup dialog, print, and export all use it.

## What it does

- Reads and writes the `view` object of `page.json` (format spec 5.4). A bad value falls back to its default and is reported, unknown keys and unknown enum values are kept, and writing leaves out every default (spec 2.2).
- Changes the view with pure functions (`setPaperSize`, `setOrientation`, `setMargins`, `setMode`, and so on) and stores a change as a JSON merge patch (`viewPatch`, Request for Comments (RFC) 7396).
- Derives the geometry: the sheet, the sheet the flow of text fills (Cornell paper shrinks it to the notes area), and the text column.
- Plans a page: paginates the flowing blocks, places the floating blocks and ink on sheets, and reports the sheet count of both together.

## Public API

All of it is re-exported from `features/pages`.

| Name                                                                                                                                       | Purpose                                                                                      |
| ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `readView(raw)`                                                                                                                            | Reads a `view` object. Returns the `PageViewSpec` and a list of warnings                     |
| `writeView(view)`                                                                                                                          | The `view` object as stored, with defaults left out                                          |
| `viewPatch(from, to)`                                                                                                                      | The merge patch between two views, or `null` when nothing changed                            |
| `applyPatch`, `diffPatch`, `mergeLayers`                                                                                                   | Merge patch helpers                                                                          |
| `newPageView(region, notebook?, section?)`                                                                                                 | The view of a new page: app defaults for the region, then the notebook's, then the section's |
| `setPaperSize`, `setCustomPaper`, `setOrientation`, `setMargins`, `setMode`, `setLayout`, `setBackground`, `setSpacing`, `setContentWidth` | Pure view changes. Each returns a new view                                                   |
| `describePaper(width, height)`                                                                                                             | The size name and orientation a width and height stand for                                   |
| `pageLayout(view, lookup?)`                                                                                                                | The `PageLayout`: sheet, flow sheet, column, and background                                  |
| `planFlow(sheet, blocks, measure)`                                                                                                         | Paginates a flow and places every line, row, and block                                       |
| `planFloating(sheet, items)`                                                                                                               | Places floating blocks and ink on sheets, and finds the ones across a break                  |
| `planPage(layout, content)`                                                                                                                | Both together, with a `SheetPlan` for each sheet                                             |
| `displayY(flow, y)`, `naturalY(flow, y)`                                                                                                   | Map a position between the flow before and after its spacers                                 |
| `slicesBySheet(flow)`                                                                                                                      | The part of each block on each sheet                                                         |

## Rules worth knowing

- A flow page's text column is the whole content box, or `contentWidth` centered in it when that is narrower. Infinite and paginated view use the same column, so switching never rewraps text and nothing moves under the pointer. (The format's "reading width" is therefore the content box width.)
- Print and export paginate every page, so a page in infinite view still exports on its paper.
- `planPage` takes the larger sheet count of the flow and the floating blocks, up to `MAX_SHEETS` (2,000). It reports the sheets past that as `cut`.
- Paper sides stay between `MIN_PAPER` and `MAX_PAPER` (1 and 200 inches). `readView` falls back to the default paper for a size outside that range, and `setCustomPaper` moves each side into it.
- Turning the paper turns the margins with it, so the same edge keeps the same margin.
- A value that returns to its default becomes `null` in the patch, as the format requires.

## What the UI wiring needs

1. A measure for the browser: the paginator needs each block's line and row boxes before any spacer exists. `features/pages/print` has a DOM helper for export. The page view needs one over its own DOM, in page units, read once per block.
2. Spacers: for each break in `plan.breaks`, the view inserts a spacer of `push` page units before the piece at `pos`. A table break with `repeatHeader` draws the header rows again inside the spacer. The view draws the gap and the sheet edges over the content and never moves it.
3. A re-plan trigger: run `planFlow` after any edit that changes a block's height, debounced to a frame. The plan is cheap (see `docs/perf/phase-6-core.md`).
4. Saving a change: send `viewPatch(before, after)` as the `setPage` change, and keep `readingOrder` in step with the blocks as format spec 6.2 says.
5. Strings: the page setup dialog needs strings for the paper names, margin presets, and warnings. This folder has none.
