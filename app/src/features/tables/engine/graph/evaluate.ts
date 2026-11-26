// Running units (ADR 0065): a cell formula once, a calculated column on every row, with the result written to the
// state's values. Arrays spill through arrays/spill.ts.

import type { Ctx } from '../formula/compile';
import type { ErrorOrigin } from '../formula/explain';
import { fitTo } from '../arrays';
import { claimArea, releaseSpill, spill } from '../arrays/spill';
import { afterDynamic } from './cycles';
import type { Engine } from './engine';
import { cellKey, finishScalar, type Unit } from './units';
import { err, isArray, type Scalar, type Value } from '../values';

export function prepare(e: Engine, unit: Unit, row: number): Ctx {
  const ctx = e.ctx;
  ctx.cols = e.sheets[unit.s];
  ctx.sheet = unit.s;
  ctx.row = row;
  ctx.col = unit.col;
  ctx.env = null;
  ctx.depth = 0;
  ctx.origin = null;
  ctx.dyn = unit.compiled.dynamic ? [] : null;
  return ctx;
}

export function runFn(unit: Unit, ctx: Ctx): Value {
  try {
    const value = unit.compiled.fn(ctx);
    // A legacy array formula fills its block. addUnit keeps only blocks inside the table.
    return unit.array && unit.row !== null ? fitTo(value, unit.array.rows, unit.array.cols) : value;
  } catch (error) {
    if (error instanceof RangeError) return err('NUM');
    throw error;
  }
}

export function evaluate(e: Engine, unit: Unit): void {
  if (unit.row === null) evaluateColumn(e, unit);
  else evaluateCell(e, unit, unit.row);
  if (e.cycles.size > 0) e.cycles.delete(unit.id);
}

export function evaluateColumn(e: Engine, unit: Unit): void {
  const ctx = prepare(e, unit, 0);
  const { s, col } = unit;
  const rows = e.tables[s].rows.length;
  for (let r = 0; r < rows; r++) {
    ctx.row = r;
    ctx.origin = null;
    ctx.env = null;
    ctx.depth = 0;
    const value = runFn(unit, ctx);
    // A calculated column holds one value per row; a larger array has nowhere to spill.
    const v = isArray(value) && value.rows * value.cols !== 1 ? err('SPILL') : finishScalar(value);
    e.write(s, col, r, v);
    const key = cellKey(s, col, r);
    if (typeof v === 'object' && v !== null) e.setOrigin(key, v, ctx.origin);
    else if (e.origins.size > 0 && e.origins.has(key)) e.origins.delete(key);
  }
  afterDynamic(e, unit, ctx);
}

export function evaluateCell(e: Engine, unit: Unit, r: number): void {
  const ctx = prepare(e, unit, r);
  let value = runFn(unit, ctx);
  if (isArray(value) && value.rows * value.cols === 0) value = err('CALC');
  if (isArray(value) && value.rows * value.cols > 1) spill(e, unit, r, value, ctx.origin);
  else {
    if (e.attempted.size > 0) claimArea(e, unit, null);
    if (e.spills.size > 0) releaseSpill(e, unit, null);
    finishCell(e, unit, r, finishScalar(value), ctx.origin);
  }
  afterDynamic(e, unit, ctx);
}

export function finishCell(e: Engine, unit: Unit, r: number, v: Scalar, origin: ErrorOrigin | null): void {
  e.write(unit.s, unit.col, r, v);
  e.setOrigin(cellKey(unit.s, unit.col, r), v, origin);
}
