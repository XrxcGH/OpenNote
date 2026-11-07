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

## Implementation notes

- Lane tables:engine-eval. The state of a page (values, formulas, graph, spills, error origins, and cycles) lives in `engine/graph/engine.ts`. It is kept in a WeakMap beside the table object it produced. Each edit forks it; the fork shares every map and column until it changes one. Editing the same table twice from one starting point gives two independent results.
- The graph (`engine/graph/index.ts`) indexes reads per column: single cells by row, ranges in an implicit interval tree. A recalculation walks from the changed cells with Tarjan's algorithm (`tarjan.ts`). That one walk gives the evaluation order and the cycles.
- Volatile functions run on every edit. A function that returns a reference (`returnsRef`) records what it read while running; when that was calculated later in the same pass, the formula runs again (up to 8 rounds).
- Aggregates over the same fixed block share one result per recalculation. 1,000 cells of `SUM(A1:A10000)` compute the sum once.
- Cycles: Circular (`#REF!` in storage) without `iterate`. With `iterate: {max, change}`, the cycle runs in a fixed order until no value moves by `change` or `max` passes run. `max` is capped at Excel's documented 32,767, and a `change` that is not a finite number of 0 or more reads as the default 0.001 (`iterateLimits` in `model.ts`). A legacy array block that is not whole rows and columns inside the table gives `#REF!`.
- Keep one `EngineEnv` object per page and pass the same one on every edit. `recalculateCells` and `recalculateBookCells` compare it by identity: a new object, even with the same `today`, rebuilds the page from scratch and loses the incremental budget.
- Rows inserted, deleted, or moved in one table go through `changeBookRows` (`workbook.ts`) when the page has other tables. It rewrites their references to the changed table (Sales!B2, Sales[Amount]). `insertRows`, `deleteRows`, and `moveRows` in `edit.ts` adjust only the table itself.
- Manual calculation (`calc: 'manual'`): an edit calculates only formulas typed in that edit. `calculateTable` (F9) calculates everything, and `needsCalculation` says when something waits.
- Worker (`engine/worker/`): pages above 20,000 cells go to a module worker that returns changed cells. Past 2 seconds every formula cell shows `#BUSY!` until it answers. Functions passed through `EngineEnv.functions` do not cross into the worker.
- Measured on the development machine under heavy load from other work: 100,000 cells with 10,000 formulas, 2 ms per edit; the 10,000-deep chain, 17 ms; 1,000 sums over 10,000 rows, 3 ms. `engine.bench.test.ts` holds the budgets, multiplied by 3 on CI.
