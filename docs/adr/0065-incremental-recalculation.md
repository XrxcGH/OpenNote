# ADR 0065: Incremental recalculation, iterative calculation, and the worker

- Status: Proposed
- Date: 2026-11-01

## Context

`app/src/features/tables/engine/recalc.ts` recalculates every formula on every edit and finds dependencies by comparing each dependency with every formula in the same column. Measured on the development machine: 11 ms per edit for 100,000 cells with 3 calculated columns, 81 ms with 10,000 single-cell formulas, and 737 ms for a 10,000-deep chain. The owner's bar is spreadsheet-like speed on 100,000 cells, and a 120 Hz display gives 8 ms per frame.

## Decision

- **Incremental graph** in `engine/graph/`. It keeps precise cell dependencies, plus a per-column interval index for ranges. Changed cells mark their dependents dirty, and the dirty set is evaluated in topological order. Dynamic dependencies (INDIRECT, OFFSET, references returned by INDEX) are recorded during evaluation and corrected on the next pass. `recalc.ts` keeps its public functions.
- **Volatile functions** (NOW, TODAY, RAND, RANDBETWEEN, RANDARRAY, OFFSET, INDIRECT, CELL, INFO) are dirty on every pass.
- **Cycles** found with Tarjan's algorithm. Iterative calculation is off by default; when a table turns it on, cycles iterate with Excel's defaults (100 passes, 0.001 maximum change) or the table's settings.
- **Manual calculation** per table, with F9.
- **Worker**: tables above 20,000 cells recalculate in a worker; results come back as changed values and apply in one transaction without an undo step. A pass over 2 seconds marks the rest `#BUSY!` and offers Continue or Stop.
- **Shared range work**: repeated aggregates over the same range reuse per-pass sums.

## Options considered

| Option | For | Against |
|---|---|---|
| Incremental graph, worker above a size (chosen) | Meets the budgets; small tables stay simple and synchronous | More code; dynamic dependencies need care |
| Keep full recalculation and optimize `findNeeds` | Small change | Still recalculates everything per keystroke; misses budgets for 10,000 formulas |
| Always in a worker | Main thread always free | Latency and complexity for the common small table |

## Consequences

- Budgets in DESIGN.md section 18 become tests in `engine/engine.bench.test.ts`.
- Recalculation order must account for spills (ADR 0059) and cross-table references (ADR 0062).
