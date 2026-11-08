// What compiled formulas run in (ADR 0059). Here are the context a closure reads and what the compiler knows about
// the page. Here too is how a block of cells is read into a value. compile.ts builds closures over these. refs.ts
// and calls.ts compile references and library calls through the `Host` the compiler gives them.

import type { Node } from '../../../../core/expr';
import { err, toScalar, type FormulaError, type Scalar, type Value } from '../values';
import { makeArray } from '../arrays';
import type { Box } from '../graph';
import type { Env, FnSpec2 } from './fn';
import type { ErrorOrigin } from './explain';
import type { Frame } from './special';
import type { TableName } from '../model';

/** What the compiler knows about one table of the page. */
export interface SheetInfo {
  /** The name other tables use, such as "Sales". */
  readonly name: string;
  readonly columns: readonly { readonly id: string; readonly name: string; readonly formula?: string }[];
  readonly rowCount: number;
  readonly names?: readonly TableName[];
}

export interface Scope {
  /** The formula's own table. */
  columns: readonly { id: string; name: string }[];
  rowCount: number;
  env: Env;
  /** The formula's table's index in `book`. Default 0. */
  sheet?: number;
  /** Every table on the page. Default: the own table alone, named Table1. */
  book?: readonly SheetInfo[];
  /** Functions to use before the library's, by name in capitals. */
  functions?: ReadonlyMap<string, FnSpec2>;
  /** Reads the text of a defined name, with Excel's rules. Without it, names give #NAME?. */
  parse?: (text: string) => Node | null;
}

/** What the engine lends a running formula. */
export interface Runtime {
  /** The block a formula cell spills into, the cell itself when it does not spill, or its error. */
  spillBox(s: number, col: number, row: number): Box | FormulaError;
  /** The stored formula of a cell or of its calculated column, without "=". Null when it has none. */
  formulaAt?(s: number, col: number, row: number): string | null;
}

/** What a closure reads while it runs. One context serves a whole recalculation. */
export interface Ctx {
  /** The columns of the formula's own table. */
  cols: Value[][];
  /** The columns of every table on the page. */
  sheets: Value[][][];
  /** The formula's table. */
  sheet: number;
  /** The row being calculated: the formula's row, or each row of a calculated column in turn. */
  row: number;
  /** The formula's column. */
  col: number;
  /** A number that changes with every recalculation. */
  epoch: number;
  env: Frame | null;
  depth: number;
  /** Aggregates over the same cells in one recalculation, by a key made when compiling. */
  memo: Map<string, Value>;
  /** The columns the memo has read, so a write there can clear it. */
  memoCols: Set<number>;
  /** Where the first error of this evaluation came from. */
  origin: ErrorOrigin | null;
  /** The blocks read through references that functions returned. */
  dyn: Box[] | null;
  rt: Runtime;
}

export type Fn = (ctx: Ctx) => Value;

/** The cell or column a formula belongs to. A row of null means a calculated column, run on every row. */
export interface Owner {
  col: number;
  row: number | null;
}

export interface Compiled {
  fn: Fn;
  /** The blocks the formula reads, known when compiling. */
  reads: Box[];
  /** Reads a volatile function, so it recalculates every time. */
  volatile: boolean;
  /** Calls a function that returns a reference, whose target is known only when it runs. */
  dynamic: boolean;
}

/** A reference found while running: one block, several (a union), or an error. */
export type RefResult = Box | Box[] | FormulaError;

/** A compiled reference: how to find its block when running, and the block when it is fixed. */
export interface RefPart {
  fn: (ctx: Ctx) => RefResult;
  fixed?: RefResult;
}

/** The compiler as refs.ts and calls.ts see it. */
export interface Host {
  readonly scope: Scope;
  readonly owner: Owner;
  readonly ownSheet: number;
  readonly book: readonly SheetInfo[];
  /** The table references resolve in. A defined name from another table switches it while compiling. */
  sheet: number;
  volatile: boolean;
  dynamic: boolean;
  read(box: Box): void;
  columnIndex(s: number, by: 'name' | 'id', key: string): number;
  sheetNamed(name: string): number;
  value(node: Node): Fn;
  /** One cell's value, registered as a read. */
  cellValue(s: number, col: number, row: number): Fn;
  refOrNull(node: Node): RefPart | null;
  deref(ref: RefPart): Fn;
  local(name: string): { hops: number; slot: number } | null;
  lookup(name: string): FnSpec2 | undefined;
}

const NO_RUNTIME: Runtime = { spillBox: () => err('REF') };

/** A context for running one formula alone, as quick math does. */
export function newCtx(cols: Value[][] = [], rt: Runtime = NO_RUNTIME): Ctx {
  return {
    cols,
    sheets: [cols],
    sheet: 0,
    row: 0,
    col: 0,
    epoch: 1,
    env: null,
    depth: 0,
    memo: new Map(),
    memoCols: new Set(),
    origin: null,
    dyn: null,
    rt,
  };
}

/** The key of column `c` of table `s`, as the memo and the graph use it. */
export const colKey = (s: number, c: number): number => s * 65536 + c;

export const constant =
  (value: Value): Fn =>
  () =>
    value;

/** True for a reference that failed: its error instead of a block. */
export const isBad = (ref: RefResult): ref is FormulaError => !Array.isArray(ref) && 'error' in ref;

/** Reads a block into a value: one cell is its value, more is an array. */
export function readBox(ctx: Ctx, box: Box): Value {
  const cols = ctx.sheets[box.s];
  if (box.r1 === box.r2 && box.c1 === box.c2) return toScalar(cols[box.c1][box.r1]);
  const width = box.c2 - box.c1 + 1;
  const data = new Array<Scalar>((box.r2 - box.r1 + 1) * width);
  for (let r = box.r1; r <= box.r2; r++) {
    for (let c = box.c1; c <= box.c2; c++) data[(r - box.r1) * width + (c - box.c1)] = toScalar(cols[c][r]);
  }
  return makeArray(box.r2 - box.r1 + 1, width, data);
}

/** The cells of a block, row by row, for an aggregate. A whole single column is the column's own array. */
export function cellsOf(ctx: Ctx, box: Box): readonly Value[] {
  const cols = ctx.sheets[box.s];
  if (box.c1 === box.c2) {
    const column = cols[box.c1];
    if (box.r1 === 0 && box.r2 === column.length - 1) return column;
    return column.slice(box.r1, box.r2 + 1);
  }
  const out: Value[] = [];
  for (let r = box.r1; r <= box.r2; r++) for (let c = box.c1; c <= box.c2; c++) out.push(cols[c][r]);
  return out;
}

/** The cells two blocks share, or #NULL! when they share none. */
export function intersect(a: Box, b: Box): Box | FormulaError {
  if (a.s !== b.s) return err('NULL');
  const box = {
    s: a.s,
    r1: Math.max(a.r1, b.r1),
    c1: Math.max(a.c1, b.c1),
    r2: Math.min(a.r2, b.r2),
    c2: Math.min(a.c2, b.c2),
  };
  return box.r1 > box.r2 || box.c1 > box.c2 ? err('NULL') : box;
}
