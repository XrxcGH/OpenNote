# ADR 0058: Table formulas follow Excel's semantics

- Status: Proposed
- Date: 2026-11-01

## Context

The table engine shares the expression engine (`app/src/core/expr`) with the calculator and the grapher, and uses textbook rules: `-2^2` is -4 and `2^3^2` is 512, where Excel, Sheets, and Calc give 4 and 64. Dates are day numbers since 1970, so `=DATE(2020,1,1)` shown as a number is 18262 where every spreadsheet shows 43831. Every arithmetic result is rounded to 15 significant digits, which differs from Excel in documented cases. `0^0` gives 1 as an operator and `#NUM!` as `POWER(0,0)`. Cells show plain words in place of error tokens. The owner asked for parity with Excel and Sheets.

## Decision

We will give table formulas Excel's semantics through options of the sheet dialect and the table engine, and leave the calculator and grapher unchanged:

- A leading minus binds tighter than `^`, and `^` groups left to right.
- Day numbers are spreadsheet serials with day 0 on 1899-12-30, equal to Excel's serial from 1900-03-01; import and export adjust earlier dates by Excel's extra day.
- Numbers are full doubles inside a formula; a formula's final addition or subtraction within rounding error of zero gives 0; display and typed input keep 15 significant digits; `=` compares the 15-digit forms.
- Coercion and aggregate rules follow Excel's documentation, including currency, percent, date, and fraction text in arithmetic. `0^0` is `#NUM!` both ways.
- Error values add `#N/A`, `#NULL!`, `#SPILL!`, `#CALC!`, `#FIELD!`, and `#BUSY!`. Cells show the Excel token, with the plain words in a tooltip, in the formula bar, and in screen reader output (PLAN.md decision 3).
- `E` stops being a constant in table formulas; it is a valid column name in Excel.
- A1 row 1 stays the first data row below the header, as today. Export and the clipboard add one to row numbers when a header row exists.

Saved notes keep their formula text. When a formula written before this change is compiled, a rewrite keeps its old meaning: `-x^y` becomes `-(x^y)`, `a^b^c` becomes `a^(b^c)`, and `E` becomes `EXP(1)`. The stored text changes only when the person edits the cell or accepts a one-time notice ("Formulas in this table were updated to spreadsheet rules") with Undo. A formula is "written before" when its table has no `data.sheet.v`; every table that holds a formula and is written by this version gets `v` (a table with no formula does not, so it does not raise the page's format version; review note, NEXT-PLAN section 3.1). Because a formula's meaning now depends on `v`, a table with `v` and any formula is a version 2 feature: Beta 8 opens that page read-only, and its old engine may show different results for `-x^y`, `a^b^c` and `E` there.

## Options considered

| Option | For | Against |
|---|---|---|
| Excel semantics in tables, textbook rules in the calculator (chosen) | Parity; formulas copied from Excel mean the same; exports round-trip | Two precedence rules in one app; a compile-time rewrite for old formulas |
| Keep textbook rules everywhere | One rule; no change | Every `=-A1^2` from Excel computes a different number |
| Excel rules everywhere, calculator included | One rule | Breaks the calculator's and grapher's mathematical conventions and their tests |

## Consequences

- The date change touches the ten files that use the 1970 epoch; they move to two helpers in `engine/dates.ts`. Charts, calendar, and timeline views do not change visibly.
- The differences file (`features/tables/fixtures/fn/DIFFERENCES.md`) lists every place where Excel, Sheets, and Calc disagree and which one OpenNote follows.
- Revisit the row numbering only together with a format version that can migrate formula text.

## Implementation notes

- `sheetDialect` takes `rules: 'excel'` for table formulas and keeps the textbook rules by default, so the calculator, the grapher, and quick math in a note read text as before. The Excel rules set the dialect options `signBindsTighter`, `powerAssociativity: 'left'`, `inputDigits: 15`, and `excelRefs`.
- The engine's `Table` carries `sheetVersion` for `data.sheet.v`. Without it, `formula/legacy.ts` rewrites a formula's text before it is read, and text the old rules refused is still refused there. Writing `v` belongs to the lane that saves `data.sheet`.
- The near-zero rule sets the result of a formula's last `+` or `-` to 0 when it is smaller than 2^-48 of the larger operand. Microsoft documents the behavior, not the bound, so the bound is ours and the two documented examples pin it.
- Text in arithmetic reads US forms until the engine knows the person's region: `$`, `%`, grouped digits, accounting brackets, `1 1/2`, times, ISO and month-first dates, and English month names.
- `DATE` keeps its year rule (years 0 to 99 add 1900; other years count as written), so `DATE(1899,12,30)` is serial 0. `fixtures/fn/DIFFERENCES.md` lists Excel's rule.
