# ADR 0059: Dynamic arrays and spill ranges in tables

- Status: Proposed
- Date: 2026-11-01

## Context

A value in the table engine (`app/src/features/tables/engine/values.ts`) is one number, text, boolean, empty, or error. FILTER, SORT, UNIQUE, SEQUENCE, MMULT, TRANSPOSE, LET with arrays, the LAMBDA helpers, and array constants all need array values, and Excel 365 and Sheets show array results by spilling them into neighboring cells.

## Decision

We will add array, reference, and lambda values to the engine, and spill the array results of single-cell formulas into the cells to the right and below, as Excel 365 does:

- Spilled cells hold no Markdown; their values exist after recalculation and in the value cache (ADR 0061).
- A blocked spill (typed text, another spill, or a merge in the way) gives `#SPILL!` and names the blocking cell.
- `A1#` refers to a spill range; `@` gives the old implicit intersection.
- Operators and scalar functions broadcast over arrays with Excel's size rules (a single row or column stretches; mismatched sizes give `#N/A` in the extra cells).
- Calculated columns keep their per-row meaning; inside them `[Col]` is this row (Excel's `[@Col]`).
- Legacy array formulas from imported files become ordinary formulas that spill to the same area.
- Array results are capped at 1,000,000 elements.

## Options considered

| Option | For | Against |
|---|---|---|
| Excel 365 spill model (chosen) | Matches Excel and Sheets; formulas copy over unchanged | Spill areas change with inputs; layout must handle blocked spills |
| Legacy array formulas only (Ctrl+Shift+Enter over a fixed range) | Fixed layout | Obsolete in Excel; FILTER and UNIQUE need a variable size |
| Arrays only inside a formula, never shown | No layout change | Cannot show FILTER, SORT, or SEQUENCE results, which people expect |

## Consequences

- Recalculation orders spills before readers of the spilled cells and re-checks blocking on every pass.
- Exports write spilled formulas as dynamic array formulas with each spilled cell's cached value.
- Older OpenNote versions see empty cells where a spill lands and the formula text in the anchor cell.

## Implementation notes

- Lane tables:engine-eval. A formula's value may be an array or a function made by LAMBDA (`engine/values.ts`). The compiler (`engine/formula/compile.ts`, `refs.ts`, `calls.ts`) reads a reference to more than one cell as an array where a value is needed. Operators and single-value parameters broadcast through `engine/arrays/index.ts`.
- A cell formula whose result is larger than one cell spills (`engine/arrays/spill.ts`). Spilled cells keep empty text and carry `spill: true` on the engine's `Cell`. Typed text, a single-cell formula, a calculated column, another spill, or the table's edge blocks a spill with `#SPILL!`. The error origin names the blocking cell.
- The block a spill wants is registered in the dependency graph as a "blocker" read. Typing into it recalculates the spilling formula, but the formula's own results there do not, so a spill never reads itself.
- When a spill grows or shrinks, formulas that read the cells it took or gave back run again in the same recalculation.
- `A1#` reads the current spill block of A1, or `#REF!` when A1 holds no formula. `@` takes the cell on the formula's own row or column, or the first item of an array.
- A calculated column that gives an array larger than one cell shows `#SPILL!` in that row, as Excel tables do.
- Legacy array formulas: a cell with `array: {rows, cols}` fills exactly that block, with `#N/A` where the result is smaller. Import sets it.
- Tables hold at most 10,000 rows and 100 columns, so the table's edge stops any spill past 1,000,000 cells. No separate cap was needed.
