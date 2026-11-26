// Dynamic array functions. Owner: tables:fn-arrays. FILTER, SORT, SORTBY, UNIQUE, and Sheets' SORTN pick and order
// rows; TAKE, DROP, VSTACK, HSTACK, TOCOL, TOROW, WRAPROWS, WRAPCOLS, EXPAND, CHOOSEROWS, CHOOSECOLS, TRIMRANGE, and
// Sheets' FLATTEN reshape. Behavior follows each function's documented rules. An empty result is #CALC!, as in
// Excel. This file also gathers the matrix functions (matrix.ts) and the LAMBDA helpers (lambda.ts), so the
// registry imports one list for the lane.

import { makeArray } from '../../arrays';
import { err, isArray, toBool, type ArrayValue, type FormulaError, type Scalar, type Value } from '../../values';
import { functions as lambdaFunctions } from './lambda';
import { arrayArg, failed, at, boolArg, build, fits, functions as matrixFunctions, intArg, tooMany } from './matrix';
import type { FnSpec2, Param } from './types';

// Ordering.

/** The rank of a kind when sorting: numbers, then text, then booleans, then errors. */
function kindRank(v: Scalar): number {
  if (typeof v === 'number') return 0;
  if (typeof v === 'string') return 1;
  return typeof v === 'boolean' ? 2 : 3;
}

/** Compares two items. Empty sorts last in both directions, as the Sort command does. */
function compareItems(a: Scalar, b: Scalar, order: number): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  const ka = kindRank(a);
  const kb = kindRank(b);
  if (ka !== kb) return (ka - kb) * order;
  if (typeof a === 'number') return (a - (b as number)) * order;
  if (typeof a === 'string') {
    const [x, y] = [a.toLowerCase(), (b as string).toLowerCase()];
    return (x < y ? -1 : x > y ? 1 : 0) * order;
  }
  if (typeof a === 'boolean') return (Number(a) - Number(b as boolean)) * order;
  return 0;
}

interface SortKey {
  /** The item each row (or column) sorts by. */
  readonly items: readonly Scalar[];
  readonly order: number;
}

/** The order of indexes 0 to n-1 by the keys, stable for ties. */
function orderBy(n: number, keys: readonly SortKey[]): number[] {
  const index = Array.from({ length: n }, (_, i) => i);
  return index.sort((i, j) => {
    for (const key of keys) {
      const c = compareItems(key.items[i], key.items[j], key.order);
      if (c !== 0) return c;
    }
    return i - j;
  });
}

/** 1 or -1 from a sort order argument; empty is ascending. Other numbers give #VALUE!. */
function orderArg(value: Value | undefined): number | FormulaError {
  const n = intArg(value, 1);
  if (typeof n !== 'number') return n;
  return n === 1 || n === -1 ? n : err('VALUE');
}

/** The rows (or, by column, the columns) of `a` in the order of `index`. */
function pick(a: ArrayValue, index: readonly number[], byCol: boolean): ArrayValue {
  if (byCol)
    return makeArray(
      a.rows,
      index.length,
      Array.from({ length: a.rows * index.length }, (_, k) =>
        at(a, Math.floor(k / index.length), index[k % index.length]),
      ),
    );
  return makeArray(
    index.length,
    a.cols,
    index.flatMap((r) => a.data.slice(r * a.cols, (r + 1) * a.cols)),
  );
}

/** The items of line `i` along the other direction: column `i` of every row, or row `i` of every column. */
function line(a: ArrayValue, i: number, byCol: boolean): Scalar[] {
  return byCol ? a.data.slice(i * a.cols, (i + 1) * a.cols) : Array.from({ length: a.rows }, (_, r) => at(a, r, i));
}

// SORT, SORTBY, SORTN.

function sort([array, index, order, byColumn]: Value[]): Value {
  const a = arrayArg(array);
  if (failed(a)) return a;
  const byCol = boolArg(byColumn, false);
  if (typeof byCol !== 'boolean') return byCol;
  const indexes = index === undefined || index === null ? makeArray(1, 1, [1]) : arrayArg(index);
  if (failed(indexes)) return indexes;
  const orders = order === undefined || order === null ? makeArray(1, 1, [1]) : arrayArg(order);
  if (failed(orders)) return orders;
  const width = byCol ? a.rows : a.cols;
  const keys: SortKey[] = [];
  for (let k = 0; k < indexes.data.length; k++) {
    const i = intArg(indexes.data[k], 1);
    if (typeof i !== 'number') return i;
    if (i < 1 || i > width) return err('VALUE');
    const o = orderArg(orders.data[orders.data.length === 1 ? 0 : k] ?? null);
    if (typeof o !== 'number') return o;
    keys.push({ items: line(a, i - 1, byCol), order: o });
  }
  return pick(a, orderBy(byCol ? a.cols : a.rows, keys), byCol);
}

/** A by-array's items: a single column as tall as `a` sorts rows, a single row as wide as `a` sorts columns. */
function byItems(a: ArrayValue, by: Value): { items: Scalar[]; byCol: boolean } | FormulaError {
  const b = arrayArg(by);
  if (failed(b)) return b;
  if (b.cols === 1 && b.rows === a.rows) return { items: [...b.data], byCol: false };
  if (b.rows === 1 && b.cols === a.cols) return { items: [...b.data], byCol: true };
  return err('VALUE');
}

function sortBy(args: Value[]): Value {
  const a = arrayArg(args[0]);
  if (failed(a)) return a;
  const keys: SortKey[] = [];
  let byCol: boolean | undefined;
  for (let k = 1; k < args.length; k += 2) {
    const by = byItems(a, args[k]);
    if (failed(by)) return by;
    if (byCol !== undefined && byCol !== by.byCol) return err('VALUE');
    byCol = by.byCol;
    const o = orderArg(args[k + 1]);
    if (typeof o !== 'number') return o;
    keys.push({ items: by.items, order: o });
  }
  return pick(a, orderBy(byCol === true ? a.cols : a.rows, keys), byCol === true);
}

/** A key for comparing whole lines: equal lines have equal keys, text without regard to case. */
function lineKey(items: readonly Scalar[]): string {
  return JSON.stringify(
    items.map((v) => (typeof v === 'string' ? `s${v.toLowerCase()}` : failed(v) ? `e${v.error}` : v)),
  );
}

/** Sheets' SORTN: the first n rows after sorting, with four ways to treat ties. */
function sortN(args: Value[]): Value {
  const a = arrayArg(args[0]);
  if (failed(a)) return a;
  const n = intArg(args[1], 1);
  if (typeof n !== 'number') return n;
  const mode = intArg(args[2], 0);
  if (typeof mode !== 'number') return mode;
  if (n < 0 || mode < 0 || mode > 3) return err('VALUE');
  const keys: SortKey[] = [];
  for (let k = 3; k < args.length; k += 2) {
    const col = intArg(args[k], 1);
    if (typeof col !== 'number') return col;
    if (col < 1 || col > a.cols) return err('VALUE');
    const asc = boolArg(args[k + 1], true);
    if (typeof asc !== 'boolean') return asc;
    keys.push({ items: line(a, col - 1, false), order: asc ? 1 : -1 });
  }
  // With no sort columns, every column sorts ascending, left to right.
  if (keys.length === 0) for (let c = 0; c < a.cols; c++) keys.push({ items: line(a, c, false), order: 1 });
  const sorted = orderBy(a.rows, keys);
  const tie = (r: number) => lineKey(keys.map((key) => key.items[r]));
  const whole = (r: number) => lineKey(line(a, r, true));
  const out = takeRows(sorted, n, mode, tie, whole);
  return out.length === 0 ? err('CALC') : pick(a, out, false);
}

/** The rows SORTN keeps from the sorted order. Ties compare the sort columns; duplicates compare whole rows. */
function takeRows(
  sorted: number[],
  n: number,
  mode: number,
  tie: (r: number) => string,
  whole: (r: number) => string,
): number[] {
  if (mode === 0) return sorted.slice(0, n);
  if (mode === 1) {
    const last = n > 0 && n <= sorted.length ? tie(sorted[n - 1]) : null;
    return sorted.filter((r, i) => i < n || (last !== null && tie(r) === last));
  }
  // Mode 2 keeps the first n distinct rows; mode 3 keeps every copy of the first n distinct rows.
  const group = new Map<string, number>();
  const out: number[] = [];
  for (const r of sorted) {
    const key = whole(r);
    const fresh = !group.has(key);
    if (fresh) group.set(key, group.size);
    if ((group.get(key) ?? n) < n && (mode === 3 || fresh)) out.push(r);
  }
  return out;
}

// FILTER and UNIQUE.

function filter([array, include, ifEmpty]: Value[]): Value {
  const a = arrayArg(array);
  if (failed(a)) return a;
  const inc = arrayArg(include);
  if (failed(inc)) return inc;
  let byCol: boolean;
  if (inc.cols === 1 && inc.rows === a.rows) byCol = false;
  else if (inc.rows === 1 && inc.cols === a.cols) byCol = true;
  else return err('VALUE');
  const keep = rowsWhere(inc.data, (v) => toBool(v));
  if (failed(keep)) return keep;
  if (keep.length > 0) return pick(a, keep, byCol);
  if (ifEmpty === undefined) return err('CALC');
  return isArray(ifEmpty) && ifEmpty.rows === 1 && ifEmpty.cols === 1 ? ifEmpty.data[0] : ifEmpty;
}

function unique([array, byColumn, exactlyOnce]: Value[]): Value {
  const a = arrayArg(array);
  if (failed(a)) return a;
  const byCol = boolArg(byColumn, false);
  if (typeof byCol !== 'boolean') return byCol;
  const once = boolArg(exactlyOnce, false);
  if (typeof once !== 'boolean') return once;
  const count = byCol ? a.cols : a.rows;
  const keys = Array.from({ length: count }, (_, i) => lineKey(line(a, i, !byCol)));
  const seen = new Map<string, number>();
  for (const key of keys) seen.set(key, (seen.get(key) ?? 0) + 1);
  const first = new Set<string>();
  const out: number[] = [];
  keys.forEach((key, i) => {
    if (first.has(key)) return;
    first.add(key);
    if (!once || seen.get(key) === 1) out.push(i);
  });
  return out.length === 0 ? err('CALC') : pick(a, out, byCol);
}

/** ARRAYFORMULA from Sheets: every formula is an array formula here, so it gives its argument. */
function arrayFormula([value]: Value[]): Value {
  return value ?? err('VALUE');
}

// Reshaping.

/** The indexes whose item passes `test`, or the first error an item or the test gives. */
function rowsWhere(items: readonly Scalar[], test: (v: Scalar) => boolean | FormulaError): number[] | FormulaError {
  const out: number[] = [];
  for (let i = 0; i < items.length; i++) {
    const ok = test(items[i]);
    if (typeof ok !== 'boolean') return ok;
    if (ok) out.push(i);
  }
  return out;
}

/** A count that may be left out: null when it was. */
function countArg(value: Value | undefined): number | null | FormulaError {
  return value === undefined || value === null ? null : intArg(value, 0);
}

/** The indexes TAKE keeps (or DROP keeps, with `drop`) from n lines: a negative count works from the end. */
function span(n: number, count: number | null, drop: boolean): number[] {
  const all = Array.from({ length: n }, (_, i) => i);
  if (count === null) return all;
  const k = Math.min(Math.abs(count), n);
  if (drop) return count >= 0 ? all.slice(k) : all.slice(0, n - k);
  return count >= 0 ? all.slice(0, k) : all.slice(n - k);
}

function takeOrDrop([array, rows, cols]: Value[], drop: boolean): Value {
  const a = arrayArg(array);
  if (failed(a)) return a;
  const r = countArg(rows);
  if (failed(r)) return r;
  const c = countArg(cols);
  if (failed(c)) return c;
  const keepRows = span(a.rows, r, drop);
  const keepCols = span(a.cols, c, drop);
  if (keepRows.length === 0 || keepCols.length === 0) return err('CALC');
  return pick(pick(a, keepRows, false), keepCols, true);
}

/** The value a pad argument stands for: #N/A when it was left out. */
function padArg(value: Value | undefined): Scalar {
  if (value === undefined) return err('NA');
  const a = arrayArg(value);
  return failed(a) ? a : (a.data[0] ?? null);
}

function stack(args: Value[], vertical: boolean): Value {
  const parts: ArrayValue[] = [];
  for (const v of args) {
    const a = arrayArg(v, true);
    if (failed(a)) return a;
    parts.push(a);
  }
  const along = parts.reduce((sum, a) => sum + (vertical ? a.rows : a.cols), 0);
  const across = Math.max(...parts.map((a) => (vertical ? a.cols : a.rows)));
  if (!fits(along, across)) return tooMany();
  const owner: [ArrayValue, number][] = [];
  for (const a of parts) for (let i = 0; i < (vertical ? a.rows : a.cols); i++) owner.push([a, i]);
  const item = (i: number, j: number): Scalar => {
    const [a, k] = owner[i];
    if (j >= (vertical ? a.cols : a.rows)) return err('NA');
    return vertical ? at(a, k, j) : at(a, j, k);
  };
  return vertical ? build(along, across, item) : build(across, along, (r, c) => item(c, r));
}

/** TOCOL and TOROW: every item in one line, skipping empty cells (1), errors (2), or both (3). */
function toLine([array, ignore, byColumn]: Value[], column: boolean): Value {
  const a = arrayArg(array);
  if (failed(a)) return a;
  const skip = intArg(ignore, 0);
  if (typeof skip !== 'number') return skip;
  if (skip < 0 || skip > 3) return err('VALUE');
  const byCol = boolArg(byColumn, false);
  if (typeof byCol !== 'boolean') return byCol;
  // The output is allocated once and filled by index, reading the data directly: a million items stay well under
  // the recalc budget.
  const total = a.rows * a.cols;
  const items = new Array<Scalar>(total);
  const skipEmpty = (skip & 1) !== 0;
  const skipErrors = (skip & 2) !== 0;
  let n = 0;
  for (let k = 0; k < total; k++) {
    // Row by row reads the data in order; by column, item k is row k % rows of column k / rows.
    const v = byCol ? a.data[(k % a.rows) * a.cols + Math.floor(k / a.rows)] : a.data[k];
    if ((skipEmpty && v === null) || (skipErrors && v !== null && typeof v === 'object')) continue;
    items[n++] = v;
  }
  if (n === 0) return err('CALC');
  items.length = n;
  return column ? makeArray(items.length, 1, items) : makeArray(1, items.length, items);
}

/** WRAPROWS and WRAPCOLS: a single row or column cut into lines of `count`, the last one padded. */
function wrap([vector, count, pad]: Value[], rows: boolean): Value {
  const a = arrayArg(vector);
  if (failed(a)) return a;
  if (a.rows !== 1 && a.cols !== 1) return err('VALUE');
  const n = intArg(count, 0);
  if (typeof n !== 'number') return n;
  if (n < 1) return err('NUM');
  const lines = Math.ceil(a.data.length / n);
  const filler = padArg(pad);
  const item = (i: number, j: number): Scalar => (i * n + j < a.data.length ? a.data[i * n + j] : filler);
  return rows ? build(lines, n, item) : build(n, lines, (r, c) => item(c, r));
}

function expand([array, rows, cols, pad]: Value[]): Value {
  const a = arrayArg(array);
  if (failed(a)) return a;
  const r = intArg(rows, a.rows);
  if (typeof r !== 'number') return r;
  const c = intArg(cols, a.cols);
  if (typeof c !== 'number') return c;
  if (r < a.rows || c < a.cols) return err('VALUE');
  const filler = padArg(pad);
  return build(r, c, (i, j) => (i < a.rows && j < a.cols ? at(a, i, j) : filler));
}

/** CHOOSEROWS and CHOOSECOLS: lines by number, negative from the end. Zero or past the end is #VALUE!. */
function choose(args: Value[], byCol: boolean): Value {
  const a = arrayArg(args[0]);
  if (failed(a)) return a;
  const n = byCol ? a.cols : a.rows;
  const index: number[] = [];
  for (const v of args.slice(1)) {
    const list = arrayArg(v);
    if (failed(list)) return list;
    for (const item of list.data) {
      const k = intArg(item, 0);
      if (typeof k !== 'number') return k;
      if (k === 0 || Math.abs(k) > n) return err('VALUE');
      index.push(k > 0 ? k - 1 : n + k);
    }
  }
  if (!fits(byCol ? a.rows : index.length, byCol ? index.length : a.cols)) return tooMany();
  return pick(a, index, byCol);
}

/** TRIMRANGE: drops empty rows and columns from the edges: leading (1), trailing (2), or both (3, the default). */
function trimRange([range, rowMode, colMode]: Value[]): Value {
  const a = arrayArg(range);
  if (failed(a)) return a;
  const rm = intArg(rowMode, 3);
  if (typeof rm !== 'number') return rm;
  const cm = intArg(colMode, 3);
  if (typeof cm !== 'number') return cm;
  if (rm < 0 || rm > 3 || cm < 0 || cm > 3) return err('VALUE');
  const rowsUsed = Array.from({ length: a.rows }, (_, r) => line(a, r, true).some((v) => v !== null));
  const colsUsed = Array.from({ length: a.cols }, (_, c) => line(a, c, false).some((v) => v !== null));
  const keepRows = edges(rowsUsed, rm);
  const keepCols = edges(colsUsed, cm);
  if (keepRows.length === 0 || keepCols.length === 0) return err('CALC');
  return pick(pick(a, keepRows, false), keepCols, true);
}

/** The indexes left after trimming unused lines at the start (mode bit 1) and the end (mode bit 2). */
function edges(used: readonly boolean[], mode: number): number[] {
  let first = 0;
  let last = used.length - 1;
  if ((mode & 1) !== 0) while (first <= last && !used[first]) first++;
  if ((mode & 2) !== 0) while (last >= first && !used[last]) last--;
  return Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => first + i);
}

/** Sheets' FLATTEN: every item of every argument, row by row, in one column. */
function flatten(args: Value[]): Value {
  const items: Scalar[] = [];
  for (const v of args) {
    const a = arrayArg(v, true);
    if (failed(a)) return a;
    if (!fits(items.length + a.data.length, 1)) return tooMany();
    for (const v2 of a.data) items.push(v2);
  }
  return makeArray(items.length, 1, items);
}

const arr = (name: string, optional = false): Param => ({ name, kind: 'array', ...(optional ? { optional } : {}) });
const val = (name: string): Param => ({ name, kind: 'value', optional: true });

function spec(
  name: string,
  params: FnSpec2['params'],
  run: FnSpec2['run'],
  signature: string,
  example: string,
): FnSpec2 {
  return { name, family: 'arrays', params, run, meta: { signature, example } };
}

const pad = arr('pad_with', true);
const many = (name: string): FnSpec2['params'] => [{ repeat: [arr(name)], min: 1 }];
const count = (name: string): Param => ({ name, kind: 'value' });

const shapeFunctions: readonly FnSpec2[] = [
  spec(
    'TAKE',
    [arr('array'), count('rows'), val('columns')],
    (args) => takeOrDrop(args, false),
    'TAKE(array, rows, [columns])',
    '=TAKE({1;2;3}, -2) gives {2;3}',
  ),
  spec(
    'DROP',
    [arr('array'), count('rows'), val('columns')],
    (args) => takeOrDrop(args, true),
    'DROP(array, rows, [columns])',
    '=DROP({1;2;3}, 1) gives {2;3}',
  ),
  spec('VSTACK', many('array'), (args) => stack(args, true), 'VSTACK(array, ...)', '=VSTACK(1, {2;3}) gives {1;2;3}'),
  spec('HSTACK', many('array'), (args) => stack(args, false), 'HSTACK(array, ...)', '=HSTACK(1, {2,3}) gives {1,2,3}'),
  spec(
    'TOCOL',
    [arr('array'), val('ignore'), val('scan_by_column')],
    (args) => toLine(args, true),
    'TOCOL(array, [ignore], [scan_by_column])',
    '=TOCOL({1,2;3,4}, 0, TRUE) gives {1;3;2;4}',
  ),
  spec(
    'TOROW',
    [arr('array'), val('ignore'), val('scan_by_column')],
    (args) => toLine(args, false),
    'TOROW(array, [ignore], [scan_by_column])',
    '=TOROW({1;2}) gives {1,2}',
  ),
  spec(
    'WRAPROWS',
    [arr('vector'), count('wrap_count'), pad],
    (args) => wrap(args, true),
    'WRAPROWS(vector, wrap_count, [pad_with])',
    '=WRAPROWS({1,2,3,4}, 2) gives {1,2;3,4}',
  ),
  spec(
    'WRAPCOLS',
    [arr('vector'), count('wrap_count'), pad],
    (args) => wrap(args, false),
    'WRAPCOLS(vector, wrap_count, [pad_with])',
    '=WRAPCOLS({1,2,3,4}, 2) gives {1,3;2,4}',
  ),
  spec(
    'EXPAND',
    [arr('array'), count('rows'), val('columns'), pad],
    expand,
    'EXPAND(array, rows, [columns], [pad_with])',
    '=EXPAND({1,2}, 2, 2, 0) gives {1,2;0,0}',
  ),
  spec(
    'CHOOSEROWS',
    [arr('array'), ...many('row_num')],
    (args) => choose(args, false),
    'CHOOSEROWS(array, row_num, ...)',
    '=CHOOSEROWS({1;2;3}, -1, 1) gives {3;1}',
  ),
  spec(
    'CHOOSECOLS',
    [arr('array'), ...many('col_num')],
    (args) => choose(args, true),
    'CHOOSECOLS(array, col_num, ...)',
    '=CHOOSECOLS({1,2,3}, 3) gives 3',
  ),
  spec(
    'TRIMRANGE',
    [arr('range'), val('trim_rows'), val('trim_cols')],
    trimRange,
    'TRIMRANGE(range, [trim_rows], [trim_cols])',
    '=TRIMRANGE(A1:C9) gives the part of A1:C9 that holds values',
  ),
  spec('FLATTEN', many('range'), flatten, 'FLATTEN(range, ...)', '=FLATTEN({1,2;3,4}) gives {1;2;3;4}'),
];

const own: readonly FnSpec2[] = [
  spec(
    'FILTER',
    [arr('array'), arr('include'), arr('if_empty', true)],
    filter,
    'FILTER(array, include, [if_empty])',
    '=FILTER({1;2;3}, {1;2;3}>1) gives {2;3}',
  ),
  spec(
    'SORT',
    [arr('array'), arr('sort_index', true), arr('sort_order', true), val('by_col')],
    sort,
    'SORT(array, [sort_index], [sort_order], [by_col])',
    '=SORT({3;1;2}, 1, -1) gives {3;2;1}',
  ),
  spec(
    'SORTBY',
    [arr('array'), arr('by_array'), val('sort_order'), { repeat: [arr('by_array'), val('sort_order')] }],
    sortBy,
    'SORTBY(array, by_array, [sort_order], ...)',
    '=SORTBY({"b";"a"}, {2;1}) gives {"a";"b"}',
  ),
  spec(
    'UNIQUE',
    [arr('array'), val('by_col'), val('exactly_once')],
    unique,
    'UNIQUE(array, [by_col], [exactly_once])',
    '=UNIQUE({"a";"b";"A"}) gives {"a";"b"}',
  ),
  spec(
    'SORTN',
    [arr('range'), val('n'), val('display_ties_mode'), { repeat: [val('sort_column'), val('is_ascending')] }],
    sortN,
    'SORTN(range, [n], [display_ties_mode], [sort_column, is_ascending], ...)',
    '=SORTN({3;1;2}, 2) gives {1;2}',
  ),
  spec(
    'ARRAYFORMULA',
    [arr('array_formula')],
    arrayFormula,
    'ARRAYFORMULA(array_formula)',
    '=ARRAYFORMULA({1,2}*2) gives {2,4}',
  ),
];

/** Every function of the lane: the dynamic array functions, the reshaping ones, the matrix ones, and the helpers. */
export const functions: readonly FnSpec2[] = [...own, ...shapeFunctions, ...matrixFunctions, ...lambdaFunctions];
