// The reference functions: INDEX, OFFSET, INDIRECT, CHOOSE, ROW, ROWS, COLUMN, COLUMNS, ADDRESS, AREAS, FORMULATEXT,
// and HYPERLINK. Written from Microsoft's documented behavior. INDEX, OFFSET, and INDIRECT return references, so a
// formula can read through them and A1:INDEX(...) works; what they read is known only when they run.

import { err, isArray, isError, isRef, toBool, toScalar, toText, type RefValue, type Value } from '../../values';
import { asArray, collapse, makeArray } from '../../arrays';
import type { Caller, Env, FnSpec2 } from './types';
import { columnOf, rowOf, unwrap, wholeArg } from './lookupKit';

/** The most rows and columns a sheet reference may name, as Excel's grid has. */
export const MAX_ROWS = 1_048_576;
export const MAX_COLS = 16_384;

/** A column's letters: 1 is A, 27 is AA. */
export function columnLetters(col: number): string {
  let out = '';
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return out;
}

/** A column number from its letters, or 0 for letters past the grid. */
function columnNumber(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64;
  return n > MAX_COLS ? 0 : n;
}

/** A table name as a reference writes it: quoted when it is not a plain word or looks like a cell. */
function qualify(name: string): string {
  const word = /^[\p{L}_][\p{L}\p{N}_.]*$/u.test(name);
  const cellLike = /^[A-Za-z]{1,3}\d+$/.test(name) || /^R\d*C\d*$/i.test(name);
  return word && !cellLike ? name : `'${name.replace(/'/g, "''")}'`;
}

/** ADDRESS's text. `abs` 1 to 4 picks which parts are absolute; R1C1 writes relative parts in brackets. */
export function addressText(row: number, col: number, abs: number, a1: boolean, sheet?: string): string {
  const absRow = abs === 1 || abs === 2;
  const absCol = abs === 1 || abs === 3;
  const cell = a1
    ? `${absCol ? '$' : ''}${columnLetters(col)}${absRow ? '$' : ''}${row}`
    : `R${absRow ? row : `[${row}]`}C${absCol ? col : `[${col}]`}`;
  return sheet === undefined || sheet === '' ? cell : `${qualify(sheet)}!${cell}`;
}

const A1_CELL = /^\$?([A-Za-z]{1,3})\$?(\d{1,7})$/;
const R1C1_CELL = /^R(\[-?\d{1,7}\]|\d{1,7})?C(\[-?\d{1,5}\]|\d{1,5})?$/i;

/** One R1C1 part: a number is absolute, [n] is relative to the caller, and nothing is the caller's own. */
function r1c1Part(part: string | undefined, here: number): number {
  if (part === undefined) return here;
  if (part.startsWith('[')) return here + Number(part.slice(1, -1));
  return Number(part) - 1;
}

/** One cell of INDIRECT's text as zero-based [row, col], or null. */
function cellAt(text: string, a1: boolean, caller: Caller | undefined): [number, number] | null {
  if (a1) {
    const m = A1_CELL.exec(text);
    if (!m) return null;
    const col = columnNumber(m[1]);
    const row = Number(m[2]);
    return col < 1 || row < 1 || row > MAX_ROWS ? null : [row - 1, col - 1];
  }
  const m = R1C1_CELL.exec(text);
  if (!m) return null;
  const row = r1c1Part(m[1], caller?.row ?? 0);
  const col = r1c1Part(m[2], caller?.col ?? 0);
  return row < 0 || col < 0 || row >= MAX_ROWS || col >= MAX_COLS ? null : [row, col];
}

/** INDIRECT's text as a reference: a cell or a range, in A1 or R1C1 style, after an optional Table! or 'Table'!. */
export function parseRefText(text: string, a1: boolean, caller?: Caller): RefValue | null {
  const m = /^(?:'((?:[^']|'')+)'!|([^!'\s]+)!)?([^!]+)$/.exec(text.trim());
  if (!m) return null;
  const table = m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2];
  const parts = m[3].split(':');
  if (parts.length > 2) return null;
  const a = cellAt(parts[0], a1, caller);
  const b = parts.length === 2 ? cellAt(parts[1], a1, caller) : a;
  if (a === null || b === null) return null;
  const ref: RefValue = {
    kind: 'ref',
    r1: Math.min(a[0], b[0]),
    c1: Math.min(a[1], b[1]),
    r2: Math.max(a[0], b[0]),
    c2: Math.max(a[1], b[1]),
  };
  return table === undefined ? ref : { ...ref, table };
}

const height = (r: RefValue): number => r.r2 - r.r1 + 1;
const width = (r: RefValue): number => r.c2 - r.c1 + 1;

/** INDEX on a reference: a cell, a whole row or column (0), or the block itself. */
function indexRef(ref: RefValue, row: number, col: number): Value {
  const { areas: _, ...one } = ref;
  if (row > height(ref) || col > width(ref)) return err('REF');
  return {
    ...one,
    r1: row === 0 ? ref.r1 : ref.r1 + row - 1,
    r2: row === 0 ? ref.r2 : ref.r1 + row - 1,
    c1: col === 0 ? ref.c1 : ref.c1 + col - 1,
    c2: col === 0 ? ref.c2 : ref.c1 + col - 1,
  };
}

function indexArray(a: ReturnType<typeof asArray>, row: number, col: number): Value {
  if (row > a.rows || col > a.cols) return err('REF');
  if (row === 0 && col === 0) return collapse(a);
  if (row === 0) return collapse(columnOf(a, col - 1));
  if (col === 0) return collapse(rowOf(a, row - 1));
  return a.data[(row - 1) * a.cols + col - 1];
}

function index(args: Value[]): Value {
  const [source, rowArg, colArg, areaArg] = args;
  if (isError(source)) return source;
  let row = wholeArg(rowArg, 0);
  let col = wholeArg(colArg, 0);
  const area = wholeArg(areaArg, 1);
  if (typeof row !== 'number') return row;
  if (typeof col !== 'number') return col;
  if (typeof area !== 'number') return area;
  if (row < 0 || col < 0 || area < 1) return err('VALUE');
  let block: RefValue | ReturnType<typeof asArray>;
  if (isRef(source)) {
    const areas = source.areas ?? [source];
    if (area > areas.length) return err('REF');
    block = areas[area - 1];
  } else {
    if (area > 1) return err('REF');
    block = asArray(source);
  }
  const rows = isRef(block) ? height(block) : block.rows;
  const cols = isRef(block) ? width(block) : block.cols;
  // A single row takes one number as its column, as INDEX({1,2,3},2) gives 2.
  const colGiven = colArg !== undefined && colArg !== null;
  if (!colGiven && rows === 1 && cols > 1) [row, col] = [1, row];
  return isRef(block) ? indexRef(block, row, col) : indexArray(block, row, col);
}

function offset(args: Value[]): Value {
  const [ref, rowsArg, colsArg, hArg, wArg] = args;
  if (isError(ref)) return ref;
  if (!isRef(ref) || ref.areas !== undefined) return err('VALUE');
  const nums = [wholeArg(rowsArg, 0), wholeArg(colsArg, 0), wholeArg(hArg, height(ref)), wholeArg(wArg, width(ref))];
  for (const n of nums) if (typeof n !== 'number') return n;
  const [dr, dc, h, w] = nums as number[];
  if (h < 1 || w < 1) return err('REF');
  const r1 = ref.r1 + dr;
  const c1 = ref.c1 + dc;
  if (r1 < 0 || c1 < 0) return err('REF');
  return { ...ref, r1, c1, r2: r1 + h - 1, c2: c1 + w - 1 };
}

function indirect(args: Value[], env: Env): Value {
  const text = toText(args[0]);
  if (typeof text !== 'string') return text;
  const a1 = args[1] === undefined ? true : toBool(args[1]);
  if (typeof a1 !== 'boolean') return a1;
  return parseRefText(text, a1, env.caller) ?? err('REF');
}

/** ROW or COLUMN: the caller's own without an argument, and one number per row or column of a reference. */
function position(args: Value[], env: Env, rows: boolean): Value {
  const ref = args[0];
  if (ref === undefined) return ((rows ? env.caller?.row : env.caller?.col) ?? 0) + 1;
  if (isError(ref)) return ref;
  if (!isRef(ref) || ref.areas !== undefined) return err('VALUE');
  const [from, to] = rows ? [ref.r1, ref.r2] : [ref.c1, ref.c2];
  if (from === to) return from + 1;
  const data = Array.from({ length: to - from + 1 }, (_, i) => from + i + 1);
  return rows ? makeArray(data.length, 1, data) : makeArray(1, data.length, data);
}

/** ROWS or COLUMNS of a reference or an array. A single value is one. */
function size(args: Value[], rows: boolean): Value {
  const v = args[0];
  if (isError(v)) return v;
  if (isRef(v)) return v.areas !== undefined ? err('REF') : rows ? height(v) : width(v);
  if (isArray(v)) return rows ? v.rows : v.cols;
  return 1;
}

function choose(args: Value[]): Value {
  const n = wholeArg(args[0], 0);
  if (typeof n !== 'number') return n;
  if (n < 1 || n >= args.length) return err('VALUE');
  return unwrap(args[n]);
}

function formulaText(args: Value[], env: Env): Value {
  const ref = args[0];
  if (isError(ref)) return ref;
  if (!isRef(ref)) return err('VALUE');
  const text = env.caller?.formulaAt(ref) ?? null;
  if (text === null) return err('NA');
  return text.startsWith('=') ? text : `=${text}`;
}

function hyperlink(args: Value[]): Value {
  const [link, label] = args;
  return label !== undefined ? toScalar(label) : toText(link);
}

function address(args: Value[]): Value {
  const [rowArg, colArg, absArg, a1Arg, sheetArg] = args;
  const row = wholeArg(rowArg, 0);
  const col = wholeArg(colArg, 0);
  const abs = wholeArg(absArg, 1);
  if (typeof row !== 'number') return row;
  if (typeof col !== 'number') return col;
  if (typeof abs !== 'number') return abs;
  const a1 = a1Arg === undefined || a1Arg === null ? true : toBool(a1Arg);
  if (typeof a1 !== 'boolean') return a1;
  const sheet = sheetArg === undefined || sheetArg === null ? undefined : toText(sheetArg);
  if (sheet !== undefined && typeof sheet !== 'string') return sheet;
  if (row < 1 || col < 1 || row > MAX_ROWS || col > MAX_COLS || abs < 1 || abs > 4) return err('VALUE');
  return addressText(row, col, abs, a1, sheet);
}

const num = (name: string, optional = false) => ({ name, kind: 'number' as const, ...(optional ? { optional } : {}) });

export const refFunctions: readonly FnSpec2[] = [
  {
    name: 'INDEX',
    family: 'lookup',
    returnsRef: true,
    params: [{ name: 'array', kind: 'range' }, num('row_num', true), num('column_num', true), num('area_num', true)],
    run: index,
    meta: { signature: 'INDEX(array, [row_num], [column_num], [area_num])', example: '=INDEX({1,2;3,4},2,2) gives 4' },
  },
  {
    name: 'OFFSET',
    family: 'lookup',
    returnsRef: true,
    volatile: true,
    params: [{ name: 'reference', kind: 'range' }, num('rows'), num('cols'), num('height', true), num('width', true)],
    run: offset,
    meta: {
      signature: 'OFFSET(reference, rows, cols, [height], [width])',
      example: '=OFFSET(A1,1,0) gives the value in A2',
    },
  },
  {
    name: 'INDIRECT',
    family: 'lookup',
    returnsRef: true,
    volatile: true,
    wantsCaller: true,
    params: [
      { name: 'ref_text', kind: 'text' },
      { name: 'a1', kind: 'bool', optional: true },
    ],
    run: indirect,
    meta: { signature: 'INDIRECT(ref_text, [a1])', example: '=INDIRECT("B"&2) gives the value in B2' },
  },
  {
    name: 'CHOOSE',
    family: 'lookup',
    params: [num('index_num'), { repeat: [{ name: 'value', kind: 'array' }], min: 1 }],
    run: choose,
    meta: {
      signature: 'CHOOSE(index_num, value1, [value2], ...)',
      example: '=CHOOSE(3,"red","green","blue") gives blue',
    },
  },
  {
    name: 'ROW',
    family: 'lookup',
    wantsCaller: true,
    params: [{ name: 'reference', kind: 'ref', optional: true }],
    run: (args, env) => position(args, env, true),
    meta: { signature: 'ROW([reference])', example: '=ROW(C5) gives 5' },
  },
  {
    name: 'COLUMN',
    family: 'lookup',
    wantsCaller: true,
    params: [{ name: 'reference', kind: 'ref', optional: true }],
    run: (args, env) => position(args, env, false),
    meta: { signature: 'COLUMN([reference])', example: '=COLUMN(C5) gives 3' },
  },
  {
    name: 'ROWS',
    family: 'lookup',
    params: [{ name: 'array', kind: 'ref' }],
    run: (args) => size(args, true),
    meta: { signature: 'ROWS(array)', example: '=ROWS({1,2;3,4;5,6}) gives 3' },
  },
  {
    name: 'COLUMNS',
    family: 'lookup',
    params: [{ name: 'array', kind: 'ref' }],
    run: (args) => size(args, false),
    meta: { signature: 'COLUMNS(array)', example: '=COLUMNS({1,2;3,4;5,6}) gives 2' },
  },
  {
    name: 'ADDRESS',
    family: 'lookup',
    params: [
      num('row_num'),
      num('column_num'),
      num('abs_num', true),
      { name: 'a1', kind: 'bool', optional: true },
      { name: 'sheet_text', kind: 'text', optional: true },
    ],
    run: address,
    meta: {
      signature: 'ADDRESS(row_num, column_num, [abs_num], [a1], [sheet_text])',
      example: '=ADDRESS(4,2) gives $B$4',
    },
  },
  {
    name: 'AREAS',
    family: 'lookup',
    params: [{ name: 'reference', kind: 'ref' }],
    run: ([ref]) => (isError(ref) ? ref : isRef(ref) ? (ref.areas?.length ?? 1) : err('VALUE')),
    meta: { signature: 'AREAS(reference)', example: '=AREAS((A1:B2,D4)) gives 2' },
  },
  {
    name: 'FORMULATEXT',
    family: 'lookup',
    wantsCaller: true,
    params: [{ name: 'reference', kind: 'ref' }],
    run: formulaText,
    meta: { signature: 'FORMULATEXT(reference)', example: '=FORMULATEXT(A1) gives the formula in A1 as text' },
  },
  {
    name: 'HYPERLINK',
    family: 'lookup',
    params: [
      { name: 'link_location', kind: 'text' },
      { name: 'friendly_name', kind: 'value', optional: true },
    ],
    run: hyperlink,
    meta: {
      signature: 'HYPERLINK(link_location, [friendly_name])',
      example: '=HYPERLINK("https://example.com","Site") gives Site',
    },
  },
];
