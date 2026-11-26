// The work the recalculation worker does, as plain functions so tests run them without a worker: recalculate the
// page and list the cells that changed, and on the page, apply such a list back to the tables.

import { loadStatistics, statisticsLoaded } from '../formula/fn/statsKit';
import type { Cell, Table } from '../model';
import { recalculateBook } from '../workbook';
import { err, isError, type Scalar, type Value } from '../values';
import type { CellChange, RecalcReply, RecalcRequest } from './protocol';

function same(a: Value, b: Value): boolean {
  return Object.is(a, b) || (isError(a) && isError(b) && a.error === b.error);
}

/** Recalculates the tables of a request and lists the changed cells. */
export function respond(request: RecalcRequest): RecalcReply {
  const result = recalculateBook(request.tables, { today: () => request.today, title: request.title });
  const changes: CellChange[] = [];
  result.forEach((table, s) => {
    const before = request.tables[s];
    if (table === before) return;
    table.rows.forEach((row, r) => {
      if (row === before.rows[r]) return;
      row.cells.forEach((cell, c) => {
        const old = before.rows[r].cells[c];
        if (same(old.value, cell.value) && old.spill === cell.spill) return;
        changes.push({ table: s, row: r, col: c, value: cell.value as Scalar, ...(cell.spill ? { spill: true } : {}) });
      });
    });
  });
  return { id: request.id, changes };
}

/**
 * Answers a request in the worker. A statistical function that runs before its lazy chunk has loaded gives #BUSY! and
 * starts the load (fn/statsKit.ts). The worker has no page to recalculate later, so it waits for the chunk and answers
 * again; a failed load keeps the first answer.
 */
export async function respondWhenReady(request: RecalcRequest): Promise<RecalcReply> {
  const loadedBefore = statisticsLoaded();
  const first = respond(request);
  if (loadedBefore || !first.changes.some((change) => isError(change.value) && change.value.error === 'BUSY')) {
    return first;
  }
  try {
    await loadStatistics();
  } catch {
    return first;
  }
  return respond(request);
}

/** An error value that crossed the worker boundary as a copy becomes the engine's own again. */
function revive(value: Scalar): Scalar {
  return isError(value) ? err(value.error) : value;
}

/** Applies a list of changed cells, copying only the rows they touch. */
export function applyChanges(tables: readonly Table[], changes: readonly CellChange[]): Table[] {
  const out = [...tables];
  const touched = new Map<number, Map<number, Cell[]>>();
  for (const change of changes) {
    const table = tables[change.table];
    const row = table?.rows[change.row];
    if (!row || !row.cells[change.col]) continue;
    let rows = touched.get(change.table);
    if (!rows) touched.set(change.table, (rows = new Map()));
    let cells = rows.get(change.row);
    if (!cells) rows.set(change.row, (cells = [...row.cells]));
    const next: Cell = { ...cells[change.col], value: revive(change.value) };
    if (change.spill) next.spill = true;
    else delete next.spill;
    cells[change.col] = next;
  }
  for (const [s, rows] of touched) {
    const table = tables[s];
    out[s] = { ...table, rows: table.rows.map((row, r) => (rows.has(r) ? { ...row, cells: rows.get(r)! } : row)) };
  }
  return out;
}

/** The tables with every formula cell showing #BUSY!, while the worker is still calculating. */
export function busyTables(tables: readonly Table[]): Table[] {
  const busy = err('BUSY');
  return tables.map((table) => ({
    ...table,
    rows: table.rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell, c) =>
        cell.formula !== undefined || table.columns[c].formula !== undefined ? { ...cell, value: busy } : cell,
      ),
    })),
  }));
}
