// The pieces of recalculation that the engine's modules share (ADR 0065): units (one formula cell or one calculated
// column), cell keys, parsing with a cache, and small comparisons.

import { asExprError, type Node } from '../../../../core/expr';
import { compile, colKey, type Compiled, type Scope, type SheetInfo } from '../formula/compile';
import type { Env, FnSpec2 } from '../formula/fn';
import { parseFormula, type ParseResult } from '../formula/parser';
import type { Box } from '.';
import type { Cell, Table } from '../model';
import { err, isError, toScalar, type Scalar, type Value } from '../values';

/** What the engine gives every formula. `functions` adds functions before the library's, by name in capitals. */
export interface EngineEnv extends Env {
  functions?: ReadonlyMap<string, FnSpec2>;
}

export interface CycleCell {
  col: number;
  /** Null when the whole calculated column is in a cycle. */
  row: number | null;
  /** The table's index on the page. Always 0 for a table on its own. */
  table?: number;
}

/** A changed cell, by data row and column. */
export interface CellRef {
  row: number;
  col: number;
}

export interface Unit {
  readonly id: number;
  readonly s: number;
  readonly col: number;
  readonly row: number | null;
  readonly formula: string;
  readonly compiled: Compiled;
  readonly array?: { readonly rows: number; readonly cols: number };
}

export const ROWS = 4194304;
export const cellKey = (s: number, c: number, r: number): number => colKey(s, c) * ROWS + r;
/** A unit planned to run in the current round of a recalculation. */
export const PLANNED = 1;

export const parsed = new Map<string, ParseResult>();

/** Parses a formula once. `legacy` is true for a table without data.sheet.v (formula/legacy.ts). */
export function parseCached(formula: string, legacy: boolean): ParseResult {
  const key = `${legacy ? 'L' : 'X'}${formula}`;
  let result = parsed.get(key);
  if (!result) {
    if (parsed.size > 20_000) parsed.clear();
    result = parseFormula(formula, undefined, { legacy });
    parsed.set(key, result);
  }
  return result;
}

export function parseName(text: string): Node | null {
  const result = parseCached(text, false);
  return result.ok ? result.node : null;
}

/** A formula that does not read: #REF! when reference adjustment left one in it, else #VALUE!. */
export function refused(formula: string): Compiled {
  const value = err(formula.includes('#REF!') ? 'REF' : 'VALUE');
  return { fn: () => value, reads: [], volatile: false, dynamic: false, subtotal: false };
}

export function sameValue(a: Value, b: Value): boolean {
  return Object.is(a, b) || (isError(a) && isError(b) && a.error === b.error);
}

export function sameBox(a: Box | undefined | null, b: Box | undefined | null): boolean {
  if (!a || !b) return !a && !b;
  return a.s === b.s && a.r1 === b.r1 && a.c1 === b.c1 && a.r2 === b.r2 && a.c2 === b.c2;
}

export function inBox(box: Box, r: number, c: number): boolean {
  return r >= box.r1 && r <= box.r2 && c >= box.c1 && c <= box.c2;
}

/** The value a cell holds by itself, before any formula spills over it. */
export function inputOf(cell: Cell): Scalar {
  return cell.spill ? null : toScalar(cell.value);
}

/** A result as one cell's value: numbers that are not finite are #NUM!. */
export function finishScalar(value: Value): Scalar {
  const v = toScalar(value);
  return typeof v === 'number' && !Number.isFinite(v) ? err('NUM') : v;
}

export function sheetInfo(table: Table, index: number): SheetInfo {
  return {
    name: table.name ?? `Table${index + 1}`,
    columns: table.columns,
    rowCount: table.rows.length,
    ...(table.names ? { names: table.names } : {}),
  };
}

/** True when a legacy array block of whole rows and columns, at least 1 by 1, fits in the table from its corner. */
export function arrayFits(array: NonNullable<Cell['array']>, row: number, col: number, table: Table): boolean {
  const { rows, cols } = array;
  return (
    Number.isInteger(rows) &&
    Number.isInteger(cols) &&
    rows >= 1 &&
    cols >= 1 &&
    row + rows <= table.rows.length &&
    col + cols <= table.columns.length
  );
}

export function sameShapeArray(a: Unit['array'], b: Cell['array']): boolean {
  return a?.rows === b?.rows && a?.cols === b?.cols;
}

/** Compiles a parsed formula. One too deep to walk is refused like one that does not parse, not left to throw. */
export function compileSafely(
  node: Node,
  scope: Scope,
  owner: { col: number; row: number | null },
  text: string,
): Compiled {
  try {
    return compile(node, scope, owner);
  } catch (error) {
    if (asExprError(error) === null && !(error instanceof RangeError)) throw error;
    return refused(text);
  }
}
