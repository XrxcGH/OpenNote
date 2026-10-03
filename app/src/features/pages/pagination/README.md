# Pagination

This folder decides where sheets start. It holds the sheet geometry (paper sizes, margins, the gap drawn between sheets), the paginator for flowing text, and the sheet lookups for floating blocks and ink. It is pure TypeScript over page units (1/96 inch), with no Document Object Model (DOM) and no React. The page view, print, and PDF export all use it, which is why a printed sheet matches the sheet on screen.

## How the paginator works

The caller describes a flow as blocks, in reading order, and gives a `Measure` function. The function returns each block's box, and for text its lines and for tables its rows, in natural coordinates, as if no sheet gap existed yet. `paginate` walks the blocks once and returns a `Plan`: the sheet count, the places a sheet starts, and warnings.

A break is a `SheetBreak` before a block, before one line of a text block, or before one row of a table. Its `push` is the height of the spacer the view inserts there: everything from that point down moves by it. Nothing is ever resized, so content under the pointer does not move when the view changes.

## Public API

All of it is re-exported from `features/pages`.

| Name                                                                                       | Purpose                                                                                                                      |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `paginate(g, blocks, measure, options?)`                                                   | The `Plan` for a flow on sheets of geometry `g`                                                                              |
| `sheetGeometry(size, margins)`, `paperDimensions(name, orientation, custom?)`              | A `SheetGeometry` from a paper size and margins                                                                              |
| `PAPER_SIZES`, `MARGIN_PRESETS`, `clampMargins`, `MIN_MARGIN`, `MIN_CONTENT`, `GAP_HALF`   | Letter, A4, A5, Legal, Tabloid, the margin presets, and their limits                                                         |
| `sheetTop`, `contentTop`, `contentBottom`, `contentBox`, `sheetAt`, `flowSheetAt`, `inGap` | Where a sheet and its content box are, and which sheet a y lies on                                                           |
| `sheetSpan(g, box)`, `sheetPieces(g, box)`, `sheetCount(g, bottoms)`, `belowBreak(g, box)` | Which sheets a floating block reaches, the part on each, and where "Move below page break" puts it                           |
| `inkBounds(points, width)`                                                                 | The box around a stroke                                                                                                      |
| `sheetsAfterWriting(g, sheets, y)`                                                         | The sheet count once the pen writes at `y`: writing past the last sheet adds the sheet it lands on, with the same background |
| `printSheet(size, pagePt?)`, `CHROMIUM_PAGES_PT`, `POINTS_PER_UNIT`                        | The sheet box that print uses, never larger than the page Chromium writes (ADR 0006, rule 2)                                 |

## Rules

- A heading never ends a sheet. It moves with the first lines of what follows it, and a run of headings moves together.
- A paragraph splits between lines, and never leaves fewer than `minLines` (default 2) alone at the bottom or the top of a sheet. A paragraph of three lines or fewer never splits.
- A table splits between rows, repeats its header rows on the new sheet, and keeps the header with the first body row. A table that fits on one sheet moves whole, unless keep together is off. A table taller than a sheet gives way and splits. A header that leaves the row after a break no room does not repeat.
- An image or other atom never splits. One taller than a content box is clipped and reported as `tooTall`. A piece a break has moved to the top of a sheet never moves again.
- Margins always leave a content box of at least `MIN_CONTENT` (48 units). Paper too small for one keeps its whole flow on one sheet and reports `noRoom`.
- A manual break starts a new sheet and takes no room. A break at the very bottom of a sheet adds no blank sheet, and two breaks in a row leave one. A break at the end counts a sheet.
- A floating block or ink stroke across a sheet edge is drawn on both sheets, clipped at each edge, and flagged so the interface can offer to move it.

## Tests

`paginate.test.ts` covers each rule above at several paper sizes. Its random-flow tests build hundreds of flows and check that every piece lies inside a content box, in order, and that no sheet ends with a heading. `geometry.test.ts` and `freeform.test.ts` cover the sheet math. `layout/plan.test.ts` repeats the properties with fast-check through the page layout.

## What the UI wiring needs

See [layout](../layout/README.md#what-the-ui-wiring-needs). The page view calls `planFlow` (which wraps `paginate`) and does not call `paginate` itself.
