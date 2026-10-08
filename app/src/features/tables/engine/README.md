# Smart-table engine

This folder holds the core of Phase 7: typed tables, formulas, quick math, pasting, and chart specs. It is pure TypeScript with no React and no document object model, so it runs in Node tests and in a worker. The table view, the chart view, and the editor wiring are in `../smart/`.

## Contents

- [Modules](#modules)
- [How the pieces fit](#how-the-pieces-fit)
- [Formulas](#formulas)
- [Pasting](#pasting)
- [Charts](#charts)
- [Tests and the budget](#tests-and-the-budget)
- [What the interface stage did and did not do](#what-the-interface-stage-did-and-did-not-do)

## Modules

| File or folder                       | What it does                                                                                                |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `values.ts`, `locale.ts`, `dates.ts` | Values and error tokens, regional number reading, and calendar days                                         |
| `model.ts`, `edit.ts`                | Typed columns and cells, and edits that return a new, recalculated table                                    |
| `canonical.ts`, `format.ts`          | Locale-free cell text for storage, and display text in the person's region                                  |
| `formula/`                           | The formula dialect, the compiler, and the functions. Reading text is the shared engine's job (`core/expr`) |
| `recalc.ts`                          | Dependency-ordered recalculation with cycle detection                                                       |
| `sort.ts`, `filter.ts`, `totals.ts`  | Multi-column sort, filters, and the totals row                                                              |
| `quickMath.ts`                       | The "2.5*9.81=" evaluator, on the same engine                                                               |
| `paste/`                             | Delimited text, Excel, Sheets, and LibreOffice tables, and type inference                                   |
| `chart/`                             | The chart spec builder, palette slots, and two-click defaults                                               |

## How the pieces fit

A table is an immutable value with typed columns. Each cell keeps the text as typed (`raw`) and its meaning (`value`). Every edit in `edit.ts` returns a new table and recalculates all formulas, sharing the rows that did not change.

A view is a list of row indices: `viewIndices` filters, then sorts. Totals and charts read a view, so a filter or sort changes both.

## Formulas

A calculated column runs one formula on every row. `[Price]*[Qty]` reads this row's values, and inside an aggregate such as `SUM([Price])` a column means every row. References by column ID (`{c1}`) and A1 references (`B2`, `A1:B5`, `B:B`) work too.

- **Reading.** The tokenizer and parser are the shared expression engine's (`core/expr`), with its spreadsheet dialect. The calculator and the grapher use the same engine, so `2^3^2` and `-2^2` mean the same everywhere.
- **Forms.** Formulas are stored with a period and a comma. `convertFormula` moves text to and from a region's form, such as a comma decimal mark with semicolons between arguments.
- **A1 addressing.** Columns are letters, and rows count data rows from 1, so the header is not row 1. A1 references address stored order, so `sortTable` changes what they mean. Sorting as a view never does.
- **Single cells.** Typed text that starts with "=" becomes a formula in that cell. Pasted text never does.
- **Errors.** The values are `#DIV/0!`, `#VALUE!`, `#REF!`, `#NAME?`, and `#NUM!`. A cycle shows as `#REF!` in storage and as "Circular" on screen. `setColumnFormula` refuses a formula with a syntax error or a cycle.
- **Numbers.** Results round to 15 significant digits, so 0.1 + 0.2 is 0.3. `ROUND` rounds half away from zero, and -2^2 is -4.

## Pasting

`tableFromClipboard` reads one HTML table when the clipboard has one, and otherwise delimited text. It reads raw numbers and formats from Excel, Google Sheets, and LibreOffice, and it needs no document object model. Columns are typed when 90% of their values fit, the decimal mark is voted against the region, and the other date order is tried when a value contradicts the region. Limits are 10,000 rows and 100 columns.

## Charts

`buildChartSpec` turns a table, its view, and a config into a plain spec. `spec.plot` holds Observable Plot options with marks as data, and `realizePlot(Plot, spec.plot)` makes the real marks. A pie has no Plot mark, so `spec.pie` holds slices with angles.

Series use palette slots `--chart-s0` to `--chart-s6`. The token build must emit those variables from `chart/palette.ts`. From the fourth series, or when asked, fills get patterns and lines get dashes and shapes.

## Tests and the budget

Run `npm run app:test`, or `npx vitest run --config app/vitest.config.ts --project unit app/src/features/tables`. The benchmark in `engine.bench.test.ts` edits a cell, filters, sorts on two columns, and builds two chart specs for 1,000 rows. It takes about 16 ms against a 100 ms budget.

## What the interface stage did and did not do

`../smart/` wires the engine into the page's table block through the table extras seam (`features/page/tables/extras.ts`).

- **Storage.** A cell keeps the text as typed, so a formula is the cell's text, such as `=B2*C2`. Column formats, totals, filters, and charts live in the block's `data.smart`, a key the file format passes through. Columns, filters, and charts name columns by ID.
- **Display.** Decorations draw each result over its cell while the cell is not being edited. A rule hides the rows a filter leaves out.
- **Changes.** The Data menu and the palette sort, filter, format, total, fill, and chart. Each is one undo step.
- **Charts.** They draw below their table through Observable Plot, loaded only when a page has one.

Not done:

- Calculated columns in the interface. The engine supports them.
- Quick math after an equals sign in text.
- Decoding CSV files by byte order mark.
- Reading the region from Rust. The browser's locale stands in.
- A Windows notification for a finished timer.
