// Writing a recalculation back (ADR 0065): new table objects with every changed cell replaced. Tables and rows
// without changes are kept as they were, so the editor redraws only what changed.

import type { Engine } from './engine';
import { ROWS, cellKey, sameValue } from './units';
import type { Cell, Row, Table } from '../model';

/**
 * A cell with a new value. It spreads the old cell, so a field another lane adds to Cell (formats, comments,
 * validation) survives every recalculation. Only changed cells are copied, a few thousand per edit at most.
 */
function withValue(cell: Cell, value: Cell['value'], spilled: boolean): Cell {
  const next: Cell = { ...cell, value };
  if (spilled) next.spill = true;
  else delete next.spill;
  return next;
}

/** The tables with every changed cell replaced. Tables and rows without changes are kept as they were. */
export function writeResults(e: Engine): Table[] {
  const bySheet = new Map<number, Map<number, number[]>>();
  for (const key of e.changed) {
    const r = key % ROWS;
    const k = (key - r) / ROWS;
    const c = k % 65536;
    const s = (k - c) / 65536;
    let rows = bySheet.get(s);
    if (!rows) bySheet.set(s, (rows = new Map()));
    const cols = rows.get(r);
    if (cols) cols.push(c);
    else rows.set(r, [c]);
  }
  e.changed.clear();
  const out = [...e.tables];
  for (const [s, changedRows] of bySheet) {
    const table = e.tables[s];
    if (!table) continue;
    const rows: Row[] = [...table.rows];
    let any = false;
    for (const [r, cols] of changedRows) {
      const row = rows[r];
      if (!row) continue;
      let cells: Cell[] | null = null;
      for (const c of cols) {
        const cell = row.cells[c];
        if (!cell) continue;
        const value = e.sheets[s][c][r];
        const spilled = e.spilledBy.has(cellKey(s, c, r)) && cell.raw === '' && cell.formula === undefined;
        if (sameValue(cell.value, value) && (cell.spill === true) === spilled) continue;
        cells ??= [...row.cells];
        cells[c] = withValue(cell, value, spilled);
      }
      if (cells) {
        rows[r] = { ...row, cells };
        any = true;
      }
    }
    if (any) out[s] = { ...table, rows };
  }
  e.tables = out;
  return out;
}
