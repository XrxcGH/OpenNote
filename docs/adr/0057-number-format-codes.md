# ADR 0057: Number formats are spreadsheet format codes

- Status: Proposed
- Date: 2026-11-01

## Context

Smart tables format numbers per column with a type (number, currency, percent, date) and a count of decimals, through `Intl.NumberFormat` and one medium date style (`app/src/features/tables/engine/format.ts`). Excel, Sheets, and Calc share one language of format codes (`#,##0.00;[Red]-#,##0.00`, `yyyy-mm-dd`, `[h]:mm:ss`, `# ?/?`), defined for files in ECMA-376 Part 1 section 18.8.31. People paste and import these codes today, and OpenNote reduces them to four hints (`engine/paste/formatHints.ts`).

## Decision

We will store a cell's number format as a format code in the style property `fmt` (ADR 0056). The code is in the invariant (en-US) form `.xlsx` files use. `app/src/features/tables/engine/numfmt/` implements the whole code language. That covers four sections, conditions, the 8 named colors and the 56 indexed colors, digit placeholders, thousands scaling, percent, scientific, fractions, text, literals, `_` and `*`, date and time tokens including elapsed time, locale and currency tags, General, and the built-in format IDs. Codes display in the person's region. Column types stay for reading typed text and map to codes for display when no `fmt` is set.

## Options considered

| Option                                   | For                                                                                                 | Against                                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Spreadsheet format codes (chosen)        | Lossless with Excel, Sheets, Calc, the clipboard, and `.xlsx`; documented semantics to test against | A real parser and renderer to write and test (about 400 known-answer cases)             |
| More options on column types             | Small change                                                                                        | Cannot express sections, conditions, colors, or custom dates; lossy on import           |
| ICU number skeletons and `Intl` patterns | Built into the platform                                                                             | A different language from every spreadsheet; no conditions or sections; lossy both ways |

## Consequences

- Import, export, and paste carry formats exactly.
- `Intl` remains the source of month and day names and of digit grouping for unusual regions.
- Format-code colors follow the theme so `[Red]` keeps contrast in dark mode, which differs from Excel's fixed colors; the differences file lists it.

## Implementation notes

- `engine/numfmt/parse.ts` compiles a code into up to four sections of tokens and caches the result by code (1,024 codes). A code it can't read (an open quote or bracket, a trailing `\`, `_` or `*`, a condition without a number, or five sections) renders as General. Unknown brackets such as `[DBNum1]` are ignored.
- `render.ts` returns text, a color token (`red`, `color12`), the `*` fill position, and overflow (`#` when the text is longer than `maxChars`, a date is out of range, or no section matches).
- Sections: one section serves every number and adds the minus sign; two sections show negatives without a sign; three add zero; the fourth, or a last section with `@`, is text. With conditions, a section that matches is used. A section whose condition is `<` or `<=` a number at or below zero shows negatives without a sign, like the default negative section; any other section adds the sign.
- Digits read the value to 15 significant digits first and then round half away from zero, so `1.005` with `0.00` is `1.01`.
- Dates count serials with day 0 on 1899-12-30, as the engine does (ADR 0058), so serials below 61 are one day earlier than Excel's and negative serials are dates. Times round to the shown precision first, then each field is cut down. `m` and `mm` right after hours or right before seconds are minutes.
- General keeps at most 11 characters with the sign. It writes the decimal form unless the scientific form keeps more significant digits.
- Regions: the decimal mark, the digit group separator and sizes (en-IN 12,34,567), the space before `%` (de-DE `25,60 %`), month and day names, and AM and PM come from the `Locale` and `Intl`. The built-in IDs 14 and 22, the East Asian date IDs, `[$-F800]`, `[$-F400]`, and the date column preset use codes read from `Intl.DateTimeFormat` parts. `localizeCode` and `delocalizeCode` convert separators and percent spacing in number sections; date sections keep their letters and literals.
- Presets (`format.ts` `columnCode`): number with decimals is `#,##0.00`; without decimals the value decides them, up to 10, so columns show what they showed before. Percent is `0%` or `0.00%` (decimals up to 2 from the value when unset). Currency is the region's currency code with the region's language ID, such as `[$$-409]#,##0.00`. Date is the region's medium date, with the short time when the serial has one. Unit and notation columns keep their own display and win over `fmt`.
- Known differences from Excel are listed in `app/src/features/tables/fixtures/numfmt/DIFFERENCES.md`.
