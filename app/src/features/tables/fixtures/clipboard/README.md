# Clipboard fixtures

The table clipboard tests (ADR 0067) read hand-written clipboard HTML from `engine/paste.fixtures.ts`:

- `EXCEL_STYLED`: Excel's HTML clipboard form, with a style block, `x:num`, and `x:fmla`.
- `sheetsFormulaTable()`: Google Sheets' form, with `data-sheets-value` and `data-sheets-formula` in R1C1.
- `EXCEL_EN`, `EXCEL_DE`, `sheetsTable()`, and `CALC_TABLE`: values and number formats from earlier lanes.

Each one holds only what the reader uses. The expected values come from the cells written in the fixture and from
hand-worked arithmetic, never from the code's output.

Real captures from Excel and Sheets (decision N5, captures X01 to X10 and GX01 to GX10) go in this folder once the
owner saves them. Tests that need them are added then.
