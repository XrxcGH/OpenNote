// Spilling (ADR 0059): an array result fills the cells below and to the right of its formula. A typed cell, a
// calculated column, another spill, or the table's edge in the way gives #SPILL!, and the explanation names the
// blocking cell. The block a spill wants is registered as a read, so typing into it recalculates the formula.

import type { ErrorOrigin, OriginCell } from '../formula/explain';
import type { Box } from '../graph';
import type { Engine } from '../graph/engine';
import { finishCell } from '../graph/evaluate';
import { cellKey, finishScalar, inBox, inputOf, PLANNED, sameBox, type Unit } from '../graph/units';
import { err, isError, type ArrayValue, type FormulaError } from '../values';

/** Registers the block a spill wants, so typing into it recalculates the spilling formula. */
export function claimArea(e: Engine, unit: Unit, box: Box | null): void {
  const before = e.attempted.get(unit.id);
  if (sameBox(before, box)) return;
  if (box) e.attempted.set(unit.id, box);
  else e.attempted.delete(unit.id);
  e.graph.setReads(unit.id, e.readsOf(unit));
}

export function blocker(e: Engine, unit: Unit, box: Box): OriginCell | 'edge' | null {
  const table = e.tables[box.s];
  if (box.r2 >= table.rows.length || box.c2 >= table.columns.length) return 'edge';
  for (let r = box.r1; r <= box.r2; r++) {
    const cells = table.rows[r].cells;
    for (let c = box.c1; c <= box.c2; c++) {
      if (r === box.r1 && c === box.c1) continue;
      const cell = cells[c];
      const typed = (cell.raw !== '' && !cell.spill) || cell.formula !== undefined;
      const owner = e.spilledBy.get(cellKey(box.s, c, r));
      if (typed || table.columns[c].formula !== undefined || (owner !== undefined && owner !== unit.id)) {
        return { table: box.s, col: c, row: r };
      }
    }
  }
  return null;
}

export function spill(e: Engine, unit: Unit, r: number, value: ArrayValue, origin: ErrorOrigin | null): void {
  const { s, col } = unit;
  const box: Box = { s, r1: r, c1: col, r2: r + value.rows - 1, c2: col + value.cols - 1 };
  const before = e.spills.get(unit.id);
  claimArea(e, unit, box);
  const blocked = blocker(e, unit, box);
  if (blocked !== null) {
    releaseSpill(e, unit, null);
    const cell = blocked === 'edge' ? undefined : blocked;
    finishCell(e, unit, r, err('SPILL'), { code: 'SPILL', kind: 'spill', ...(cell ? { cell } : {}) });
    if (before) lateReaders(e, unit, before);
    return;
  }
  releaseSpill(e, unit, box);
  for (let rr = box.r1; rr <= box.r2; rr++) {
    for (let cc = box.c1; cc <= box.c2; cc++) {
      if (rr === box.r1 && cc === box.c1) continue;
      const key = cellKey(s, cc, rr);
      if (e.spilledBy.get(key) !== unit.id) {
        e.spilledBy.set(key, unit.id);
        e.changed.add(key);
      }
      const v = finishScalar(value.data[(rr - box.r1) * value.cols + (cc - box.c1)]);
      e.write(s, cc, rr, v);
      if (typeof v === 'object' && v !== null) e.setOrigin(key, v, null);
      else if (e.origins.has(key)) e.origins.delete(key);
    }
  }
  e.spills.set(unit.id, box);
  finishCell(e, unit, r, finishScalar(value.data[0]), origin);
  if (!sameBox(before, box)) lateReaders(e, unit, box, before);
}

/** Gives back the cells of a spill that are not in `keep`, each with the value it holds by itself. */
export function releaseSpill(e: Engine, unit: Unit, keep: Box | null): void {
  const box = e.spills.get(unit.id);
  if (!box) return;
  const table = e.tables[box.s];
  for (let r = box.r1; r <= box.r2; r++) {
    for (let c = box.c1; c <= box.c2; c++) {
      if ((r === box.r1 && c === box.c1) || (keep && inBox(keep, r, c))) continue;
      const key = cellKey(box.s, c, r);
      if (e.spilledBy.get(key) !== unit.id) continue;
      e.spilledBy.delete(key);
      e.changed.add(key);
      const cell = table.rows[r]?.cells[c];
      e.write(box.s, c, r, cell ? inputOf(cell) : null);
      if (e.origins.has(key)) e.origins.delete(key);
    }
  }
  if (keep) e.spills.set(unit.id, keep);
  else e.spills.delete(unit.id);
}

/** A spill changed size: the readers of the cells it took or gave back run again if they already ran. */
export function lateReaders(e: Engine, unit: Unit, ...boxes: (Box | undefined)[]): void {
  for (const box of boxes) {
    if (!box) continue;
    e.graph.readers(box, true, (id) => {
      if (id !== unit.id && e.mark[id] !== PLANNED) e.late.add(id);
    });
  }
}

export function spillBox(e: Engine, s: number, c: number, r: number): Box | FormulaError {
  const id = e.cellUnit.get(cellKey(s, c, r));
  if (id === undefined) return err('REF');
  const box = e.spills.get(id);
  if (box) return box;
  const v = e.sheets[s][c][r];
  return isError(v) ? v : { s, r1: r, c1: c, r2: r, c2: c };
}
