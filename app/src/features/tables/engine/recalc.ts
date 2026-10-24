// Dependency-ordered recalculation. A unit is a calculated column (run on every row) or one cell entered as a
// formula. Units are ordered with Kahn's algorithm, so each runs after the units it reads. A unit in a cycle gets the
// circular error in every cell it owns, and units that only read a cycle see that error and pass it on.
// Every change recalculates every formula, which the benchmark in engine.bench.test.ts keeps well under budget.

import { asExprError, type Node } from '../../../core/expr';
import { compile, type Compiled, type Ctx, type Dep, type Owner, type Scope } from './formula/compile';
import type { Env } from './formula/functions';
import { parseFormula, type ParseResult } from './formula/parser';
import { todayDays } from './dates';
import type { Cell, Row, Table } from './model';
import { err, isError, type Value } from './values';

export const DEFAULT_ENV: Env = { today: () => todayDays() };

interface Unit extends Owner {
  compiled: Compiled;
}

export interface CycleCell {
  col: number;
  /** Null when the whole calculated column is in a cycle. */
  row: number | null;
}

const parsed = new Map<string, ParseResult>();

function parseCached(formula: string): ParseResult {
  let result = parsed.get(formula);
  if (!result) {
    if (parsed.size > 500) parsed.clear();
    result = parseFormula(formula);
    parsed.set(formula, result);
  }
  return result;
}

const REFUSED: Compiled = { fn: () => err('VALUE'), deps: [] };

function buildUnit(formula: string, table: Table, owner: Owner, env: Env): Unit {
  const result = parseCached(formula);
  const scope = { columns: table.columns, rowCount: table.rows.length, env };
  return { ...owner, compiled: result.ok ? compileSafely(result.node, scope, owner) : REFUSED };
}

/** Compiles a parsed formula. One too deep to walk is refused like one that does not parse, not left to throw. */
function compileSafely(node: Node, scope: Scope, owner: Owner): Compiled {
  try {
    return compile(node, scope, owner);
  } catch (error) {
    if (asExprError(error) === null) throw error;
    return REFUSED;
  }
}

function collectUnits(table: Table, env: Env): Unit[] {
  const units: Unit[] = [];
  table.columns.forEach((column, col) => {
    if (column.formula !== undefined) units.push(buildUnit(column.formula, table, { col, row: null }, env));
  });
  table.rows.forEach((row, r) => {
    row.cells.forEach((cell, col) => {
      if (cell.formula !== undefined && table.columns[col].formula === undefined) {
        units.push(buildUnit(cell.formula, table, { col, row: r }, env));
      }
    });
  });
  return units;
}

function pushTo(map: Map<number, number[]>, key: number, value: number): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function covers(unit: Unit, dep: Dep): boolean {
  if (unit.col !== dep.col) return false;
  return unit.row === null ? dep.from <= dep.to : unit.row >= dep.from && unit.row <= dep.to;
}

/** For each unit, the units it reads from. A unit that reads itself is listed as needing itself. */
function findNeeds(units: Unit[]): Set<number>[] {
  const byCol = new Map<number, number[]>();
  units.forEach((u, i) => pushTo(byCol, u.col, i));
  return units.map((unit) => {
    const needs = new Set<number>();
    for (const dep of unit.compiled.deps) {
      for (const v of byCol.get(dep.col) ?? []) if (covers(units[v], dep)) needs.add(v);
    }
    return needs;
  });
}

/** Kahn's algorithm over `ids`, ignoring needs outside them. Returns the order and the units never made ready. */
function order(ids: number[], needs: Set<number>[]): { order: number[]; rest: number[] } {
  const inside = new Set(ids);
  const waiting = new Map<number, number>();
  const users = new Map<number, number[]>();
  for (const id of ids) {
    let count = 0;
    for (const need of needs[id]) {
      if (!inside.has(need)) continue;
      count++;
      pushTo(users, need, id);
    }
    waiting.set(id, count);
  }
  const ready = ids.filter((id) => waiting.get(id) === 0);
  const done: number[] = [];
  while (ready.length) {
    const id = ready.pop()!;
    done.push(id);
    for (const user of users.get(id) ?? []) {
      const left = waiting.get(user)! - 1;
      waiting.set(user, left);
      if (left === 0) ready.push(user);
    }
  }
  const finished = new Set(done);
  return { order: done, rest: ids.filter((id) => !finished.has(id)) };
}

/**
 * Keeps the units that are in a cycle or between cycles, and drops those that only read a cycle. A unit no other kept
 * unit reads is peeled off, which may leave the units it read unread in turn. Counting readers makes this linear in
 * the number of dependencies.
 */
function cycleCore(rest: number[], needs: Set<number>[]): Set<number> {
  const core = new Set(rest);
  const readers = new Map<number, number>(rest.map((id) => [id, 0]));
  for (const id of rest) for (const need of needs[id]) if (core.has(need)) readers.set(need, readers.get(need)! + 1);
  const unread = rest.filter((id) => readers.get(id) === 0);
  while (unread.length > 0) {
    const id = unread.pop()!;
    core.delete(id);
    for (const need of needs[id]) {
      if (!core.has(need)) continue;
      const left = readers.get(need)! - 1;
      readers.set(need, left);
      if (left === 0) unread.push(need);
    }
  }
  return core;
}

function run(unit: Unit, ctx: Ctx, rowCount: number): void {
  ctx.epoch++;
  const column = ctx.cols[unit.col];
  const store = (r: number): void => {
    ctx.row = r;
    const v = unit.compiled.fn(ctx);
    column[r] = typeof v === 'number' && !Number.isFinite(v) ? err('NUM') : v;
  };
  if (unit.row === null) for (let r = 0; r < rowCount; r++) store(r);
  else store(unit.row);
}

function markCycle(unit: Unit, ctx: Ctx, rowCount: number): void {
  const column = ctx.cols[unit.col];
  if (unit.row === null) column.fill(err('CYCLE'), 0, rowCount);
  else column[unit.row] = err('CYCLE');
}

function sameValue(a: Value, b: Value): boolean {
  return Object.is(a, b) || (isError(a) && isError(b) && a.error === b.error);
}

function writeBack(table: Table, units: Unit[], cols: Value[][]): Table {
  const changed = new Map<number, Cell[]>();
  const update = (r: number, col: number): void => {
    const cell = table.rows[r].cells[col];
    const value = cols[col][r];
    if (sameValue(cell.value, value)) return;
    const cells = changed.get(r) ?? [...table.rows[r].cells];
    cells[col] = { ...cell, value };
    changed.set(r, cells);
  };
  for (const unit of units) {
    if (unit.row === null) for (let r = 0; r < table.rows.length; r++) update(r, unit.col);
    else update(unit.row, unit.col);
  }
  if (changed.size === 0) return table;
  const rows: Row[] = table.rows.map((row, r) => (changed.has(r) ? { ...row, cells: changed.get(r)! } : row));
  return { ...table, rows };
}

/** Recalculates every formula, then returns the table with the changed cells replaced. */
export function recalculateWithCycles(table: Table, env: Env = DEFAULT_ENV): { table: Table; cycles: CycleCell[] } {
  const units = collectUnits(table, env);
  if (units.length === 0) return { table, cycles: [] };
  const rowCount = table.rows.length;
  const cols = table.columns.map((_, c) => table.rows.map((row) => row.cells[c].value));
  const ctx: Ctx = { cols, row: 0, epoch: 0 };
  const needs = findNeeds(units);
  const first = order(
    units.map((_, i) => i),
    needs,
  );
  const core = cycleCore(first.rest, needs);
  for (const id of first.order) run(units[id], ctx, rowCount);
  for (const id of core) markCycle(units[id], ctx, rowCount);
  for (const id of order(
    first.rest.filter((id) => !core.has(id)),
    needs,
  ).order)
    run(units[id], ctx, rowCount);
  const cycles = [...core].map((id) => ({ col: units[id].col, row: units[id].row }));
  return { table: writeBack(table, units, cols), cycles };
}

export function recalculate(table: Table, env: Env = DEFAULT_ENV): Table {
  return recalculateWithCycles(table, env).table;
}
