# ADR 0067: Excel, Sheets, and clipboard interchange of formulas, formats, and styles

- Status: Proposed
- Date: 2026-11-01

## Context

Excel export writes each cell's typed text, so formulas become strings and no format, fill, border, width, or merge travels (`crates/interop/src/export/tables.rs`). Excel import keeps last values and reports formats and merges (`crates/interop/src/import/xlsx.rs`). Paste reads values and four format hints; copy writes ProseMirror's default HTML. The owner asked for copy and paste with Excel and Sheets with formatting and formulas, and `.xlsx` round trips of formats, formulas, and styles.

## Decision

- **Excel export** writes formulas with cached values (ADR 0061) and `fullCalcOnLoad`. It also writes formats and layout: number format codes, fonts, fills, borders, alignment, and merges. Widths convert from page units to Excel's character units at a maximum digit width of 7 px. Row heights, freeze panes, hidden rows and columns, and outline levels go too. So do a ListObject with the nearest built-in table style, validation, conditional formats, defined names, and notes.
- **Excel import** reads all the above back into `data.sheet`, translating formulas; unknown functions keep their text and show `#NAME?` with a report line.
- **Formula translation** is token-level: row numbers move by one when the table has a header row, OpenNote's `[Col]` becomes `[@Col]` inside the ListObject (or `Table[Col]` in aggregates), `E` becomes `EXP(1)`, and the region's separators become invariant. Rust has a small tokenizer in `crates/interop/src/sheet/formula.rs`; TypeScript uses the engine's parser. Both run the same golden file.
- **Copy out** writes three clipboard forms: HTML with inline CSS and Excel's `x:num` and `x:fmla` attributes and Sheets' `data-sheets-value`, `data-sheets-formula` (R1C1), and `data-sheets-numberformat`; tab-separated text of shown values; and OpenNote's own form for exact paste between OpenNote tables.
- **Paste in** reads formulas from those attributes (translated), styles from inline CSS and Excel's style blocks, number formats as codes, and merges from spans. Paste as text keeps today's rule that typed `=` text never becomes a formula.
- **What does not travel** is listed in the import and export reports: pivot caches, macros, charts other than mapped ones, external links, threaded comments, protection before R4.

## Options considered

| Option | For | Against |
|---|---|---|
| Full styles and translated formulas both ways (chosen) | Parity with Excel and Sheets workflows | Translation and style mapping to maintain in two languages |
| Values and formats only | Simpler | Formulas lost, the owner's request unmet |
| A JavaScript `.xlsx` library in the app | One language | Exporters already live in Rust; a second writer to keep identical |

## Consequences

- The Rust fuzz target extends to styles, formulas, and validation parts.
- Golden `.xlsx` files are checked part by part and, nightly, recalculated in LibreOffice, and compared with cached values.
