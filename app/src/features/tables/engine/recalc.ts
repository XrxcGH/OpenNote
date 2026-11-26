// Recalculation (ADR 0065), the engine's public face. The state for a table (values, units, the graph, spills, and
// error origins) lives in graph/engine.ts and is kept beside the table object it produced, so the next edit of that
// table starts from it.

import { Engine } from './graph/engine';
import type { Box } from './graph';
import type { ErrorOrigin } from './formula/explain';
import { todayDays } from './dates';
import type { Table } from './model';
import type { CellRef, CycleCell, EngineEnv } from './graph/units';

export { Engine } from './graph/engine';
export { sheetInfo } from './graph/units';
export type { CellRef, CycleCell, EngineEnv } from './graph/units';

export const DEFAULT_ENV: EngineEnv = { today: () => todayDays() };

const STATES = new WeakMap<object, Engine>();

/** The engine state that produced `key` (a table, or a page's list of tables), if it is still known. */
export function engineOf(key: object): Engine | undefined {
  return STATES.get(key);
}

export function rememberEngine(key: object, engine: Engine): void {
  STATES.set(key, engine);
}

/** Recalculates every formula, then returns the table with the changed cells replaced. */
export function recalculateWithCycles(
  table: Table,
  env: EngineEnv = DEFAULT_ENV,
): { table: Table; cycles: CycleCell[] } {
  const engine = Engine.build([table], env);
  const [result] = engine.results();
  rememberEngine(result, engine);
  return { table: result, cycles: engine.cycleCells().map(({ col, row }) => ({ col, row })) };
}

export function recalculate(table: Table, env: EngineEnv = DEFAULT_ENV): Table {
  return recalculateWithCycles(table, env).table;
}

/**
 * Recalculates after an edit of cells: `next` is `before` with the cells in `cells` replaced. When the state of
 * `before` is known, only the formulas that read the changed cells run; otherwise everything does.
 */
export function recalculateCells(
  before: Table,
  next: Table,
  cells: readonly CellRef[],
  env: EngineEnv = DEFAULT_ENV,
): Table {
  const known = STATES.get(before);
  if (known === undefined || known.env !== env || !known.sameShape([next])) return recalculate(next, env);
  const engine = known.fork();
  engine.beginEdit();
  engine.applyCells([next], cells);
  const [result] = engine.results();
  rememberEngine(result, engine);
  return result;
}

/** Calculates every formula of a table now, as F9 does in manual calculation. */
export function calculateNow(table: Table, env: EngineEnv = DEFAULT_ENV): Table {
  return recalculate(table, env);
}

/** True when a table in manual calculation has formulas waiting for F9. */
export function needsCalculation(table: Table): boolean {
  return STATES.get(table)?.needsCalculation ?? false;
}

function engineFor(table: Table): Engine {
  let engine = STATES.get(table);
  if (engine === undefined) {
    engine = Engine.build([table], DEFAULT_ENV);
    STATES.set(table, engine);
  }
  return engine;
}

/** Where the error in a cell came from, for the formula bar. Undefined when the cell holds no error. */
export function errorOrigin(table: Table, col: number, row: number): ErrorOrigin | undefined {
  return engineFor(table).originAt(0, col, row);
}

/** The block a formula cell spills into, when it spills. */
export function spillRange(table: Table, col: number, row: number): Box | undefined {
  return engineFor(table).spillAt(0, col, row);
}
