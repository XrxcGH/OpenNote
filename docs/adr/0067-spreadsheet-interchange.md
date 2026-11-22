# ADR 0067: Excel, Sheets, and clipboard interchange of formulas, formats, and styles

- Status: Accepted
- Date: 2026-11-21

## Context

Excel export wrote each cell's typed text, so formulas became strings and no format, fill, border, width, or merge traveled (`crates/interop/src/export/tables.rs`). Excel import keeps last values and reports formats and merges (`crates/interop/src/import/xlsx.rs`). Paste reads values and four format hints; copy writes ProseMirror's default HTML. The owner asked for copy and paste with Excel and Sheets with formatting and formulas, and `.xlsx` round trips of formats, formulas, and styles.

## Decision

- **Excel export** writes formulas with cached values (ADR 0061) and `fullCalcOnLoad`, so Excel recalculates on opening. When the value cache is stale, formulas go without values. The export report says so. It also writes formats and layout: number format codes, fonts, fills, borders, alignment, and merges. Codes with a built-in ID that every locale shows the same way (ECMA-376 Part 1, 18.8.30) use that ID; dates and other codes are custom formats from ID 164. Font sizes above 409 points are written at 409 and reported.
- **Widths** convert from page units to Excel's character units by ECMA-376 Part 1, 18.3.1.13 with a maximum digit width of 7 px: characters are `trunc((px - 5) / 7 * 100 + 0.5) / 100`, and the stored width is `trunc((chars * 7 + 5) / 7 * 256) / 256`. Row heights go in points (page units times 0.75). Freeze panes, hidden rows and columns, and outline levels go too.
- **ListObjects.** A table with a header row of distinct, plain names, at least one body row, and no merges becomes a ListObject with the nearest built-in table style (medium styles 2 to 7 follow the six theme accents). A column whose body cells all hold one formula is a calculated column. Other tables are plain ranges, and their structured references become A1 references.
- **Validation, conditional formats, names, and notes.** Rules become `dataValidation` and `conditionalFormatting` elements; conditional styles become differential formats (`dxf`). Table-scoped names belong to their sheet, page-scoped names to the workbook. Notes become legacy comments with the VML drawing that Excel needs to show them.
- **Excel import** reads all the above back into `data.sheet`, translating formulas; unknown functions keep their text and show `#NAME?` with a report line.
- **Formula translation** is token-level. Row numbers move by one when the table has a header row. OpenNote's bare `[Col]` becomes `Table[[#This Row],[Col]]` as a scalar. It becomes `Table[Col]` as an argument of a function that takes a range, and in a defined name. `E` becomes `EXP(1)`, and functions newer than Excel 2007 take the `_xlfn.` prefix of the file form (`_xlfn._xlws.` for `FILTER` and `SORT`). Rust has the tokenizer in `crates/interop/src/sheet/formula.rs`; TypeScript has a twin in `app/src/features/tables/engine/formula/excel.ts` for the clipboard. Both run the hand-worked golden cases of `app/src/features/tables/fixtures/translate.json`.
- **TSV export** sits beside CSV: tab-separated shown values with the same formula guard.
- **Copy out** writes three clipboard forms: HTML with inline CSS and Excel's `x:num` and `x:fmla` attributes and Sheets' `data-sheets-value`, `data-sheets-formula` (R1C1), and `data-sheets-numberformat`; tab-separated text of shown values; and OpenNote's own form for exact paste between OpenNote tables.
- **Paste in** reads formulas from those attributes (translated), styles from inline CSS and Excel's style blocks, number formats as codes, and merges from spans. Paste as text keeps today's rule that typed `=` text never becomes a formula.
- **What does not travel** is listed in the import and export reports: pivot caches, macros, charts other than mapped ones, external links, threaded comments, protection before R4. Spilled results of dynamic arrays and cell padding are not written yet.

## Options considered

| Option | For | Against |
|---|---|---|
| Full styles and translated formulas both ways (chosen) | Parity with Excel and Sheets workflows | Translation and style mapping to maintain in two languages |
| Values and formats only | Simpler | Formulas lost, the owner's request unmet |
| A JavaScript `.xlsx` library in the app | One language | Exporters already live in Rust; a second writer to keep identical |

## Consequences

- The Rust fuzz target extends to styles, formulas, and validation parts.
- Golden `.xlsx` parts are checked by XML assertions and reopened by our importer, whose values must equal the cached values. When the import lane lands, the reopened `data.sheet` must equal the exported one, and the nightly oracle job compares LibreOffice's recalculated values with our cached values.
