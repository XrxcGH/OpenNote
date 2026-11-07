// Cycles and references known only while running (ADR 0065). A cycle shows Circular in every cell it owns, or
// iterates when the table turns on iterative calculation. A function's returned reference is recorded as a read, and
// the formula runs again in the same recalculation when what it read was calculated after it.

import type { Ctx } from '../formula/compile';
import type { ErrorOrigin } from '../formula/explain';
import { claimArea, releaseSpill } from '../arrays/spill';
import { evaluate, finishCell } from './evaluate';
import type { Engine } from './engine';
import { cellKey, PLANNED, sameBox, sameValue, type Unit } from './units';
import { colKey } from '../formula/compile';
import { err, type Scalar } from '../values';
import { iterateLimits } from '../model';

/** Records the blocks a function's returned references read, and runs again if one of them ran later. */
export function afterDynamic(e: Engine, unit: Unit, ctx: Ctx): void {
  if (ctx.dyn === null) return;
  const boxes = ctx.dyn;
  const before = e.dynamicReads.get(unit.id) ?? [];
  const same = before.length === boxes.length && before.every((b, i) => sameBox(b, boxes[i]));
  if (!same) {
    if (boxes.length > 0) e.dynamicReads.set(unit.id, boxes);
    else e.dynamicReads.delete(unit.id);
    e.graph.setReads(unit.id, e.readsOf(unit));
  }
  for (const box of boxes) {
    for (let c = box.c1; c <= box.c2; c++) {
      const owner = e.colUnit.get(colKey(box.s, c));
      if (owner !== undefined && e.mark[owner] === PLANNED) e.late.add(unit.id);
    }
    if ((box.r2 - box.r1 + 1) * (box.c2 - box.c1 + 1) > 4096) continue;
    for (let r = box.r1; r <= box.r2; r++) {
      for (let c = box.c1; c <= box.c2; c++) {
        const owner = e.cellUnit.get(cellKey(box.s, c, r)) ?? e.spilledBy.get(cellKey(box.s, c, r));
        if (owner !== undefined && owner !== unit.id && e.mark[owner] === PLANNED) {
          e.late.add(unit.id);
        }
      }
    }
  }
}

export function markCycle(e: Engine, unit: Unit): void {
  const origin: ErrorOrigin = { code: 'CYCLE', kind: 'cycle' };
  if (unit.row === null) {
    const rows = e.tables[unit.s].rows.length;
    for (let r = 0; r < rows; r++) {
      e.write(unit.s, unit.col, r, err('CYCLE'));
      e.origins.set(cellKey(unit.s, unit.col, r), origin);
    }
  } else {
    claimArea(e, unit, null);
    releaseSpill(e, unit, null);
    finishCell(e, unit, unit.row, err('CYCLE'), origin);
  }
  e.cycles.set(unit.id, true);
}

export function snapshot(e: Engine, unit: Unit): Scalar[] {
  const column = e.sheets[unit.s][unit.col];
  return unit.row === null ? column.slice() : [column[unit.row]];
}

/** Runs a cycle with iterative calculation: in a fixed order, until no value moves by `change` or more. */
export function iterateCycle(e: Engine, units: Unit[], max: number, change: number): void {
  for (let pass = 0; pass < max; pass++) {
    let largest = 0;
    e.ctx.memo.clear();
    e.ctx.memoCols.clear();
    for (const unit of units) {
      const before = snapshot(e, unit);
      evaluate(e, unit);
      const after = snapshot(e, unit);
      for (let i = 0; i < after.length; i++) {
        const a = before[i];
        const b = after[i];
        const moved = typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) : sameValue(a, b) ? 0 : Infinity;
        largest = Math.max(largest, moved);
      }
    }
    if (largest < change) return;
  }
}

export function cycle(e: Engine, ids: readonly number[]): void {
  const units = ids
    .map((id) => e.units.get(id)!)
    .sort((a, b) => a.s - b.s || (a.row ?? -1) - (b.row ?? -1) || a.col - b.col);
  const settings = e.tables[units[0].s].iterate;
  if (settings === undefined) for (const unit of units) markCycle(e, unit);
  else {
    const { max, change } = iterateLimits(settings);
    iterateCycle(e, units, max, change);
  }
}
