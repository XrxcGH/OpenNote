# ADR 0057: Number formats are spreadsheet format codes

- Status: Proposed
- Date: 2026-11-01

## Context

Smart tables format numbers per column with a type (number, currency, percent, date) and a count of decimals, through `Intl.NumberFormat` and one medium date style (`app/src/features/tables/engine/format.ts`). Excel, Sheets, and Calc share one language of format codes (`#,##0.00;[Red]-#,##0.00`, `yyyy-mm-dd`, `[h]:mm:ss`, `# ?/?`), defined for files in ECMA-376 Part 1 section 18.8.31. People paste and import these codes today, and OpenNote reduces them to four hints (`engine/paste/formatHints.ts`).

## Decision

We will store a cell's number format as a format code in the style property `fmt` (ADR 0056). The code is in the invariant (en-US) form `.xlsx` files use. `app/src/features/tables/engine/numfmt/` implements the whole code language. That covers four sections, conditions, the 8 named colors and the 56 indexed colors, digit placeholders, thousands scaling, percent, scientific, fractions, text, literals, `_` and `*`, date and time tokens including elapsed time, locale and currency tags, General, and the built-in format IDs. Codes display in the person's region. Column types stay for reading typed text and map to codes for display when no `fmt` is set.

## Options considered

| Option | For | Against |
|---|---|---|
| Spreadsheet format codes (chosen) | Lossless with Excel, Sheets, Calc, the clipboard, and `.xlsx`; documented semantics to test against | A real parser and renderer to write and test (about 400 known-answer cases) |
| More options on column types | Small change | Cannot express sections, conditions, colors, or custom dates; lossy on import |
| ICU number skeletons and `Intl` patterns | Built into the platform | A different language from every spreadsheet; no conditions or sections; lossy both ways |

## Consequences

- Import, export, and paste carry formats exactly.
- `Intl` remains the source of month and day names and of digit grouping for unusual regions.
- Format-code colors follow the theme so `[Red]` keeps contrast in dark mode, which differs from Excel's fixed colors; the differences file lists it.
