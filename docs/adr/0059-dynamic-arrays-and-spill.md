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
