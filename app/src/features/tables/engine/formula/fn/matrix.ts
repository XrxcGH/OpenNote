// Matrix functions and the array builders. Owner: tables:fn-arrays. Also the helpers the other array files share:
// the size cap, reading a count, and the shape of an array. Behavior follows each function's documented rules (ADR
// 0058, ADR 0059); the linear algebra reuses the LU decomposition in core/num.
//
// Every array a function builds is capped at MAX_ELEMENTS items. A larger request gives #NUM! with the reason
// 'tooMany'. The check comes before anything is allocated, so a typo such as SEQUENCE(2000000) cannot stall the page.

import { identity, luDecompose, luDeterminant, luSolve, type Matrix } from '../../../../../core/num/matrix';
import { makeArray } from '../../arrays';
import {
  err,
  errBecause,
  isArray,
  toBool,
  toNumber,
  type ArrayValue,
  type FormulaError,
  type Scalar,
  type Value,
} from '../../values';
import type { FnSpec2, Param } from './types';

/** The most items an array result may hold (DESIGN.md section 3.8). */
export const MAX_ELEMENTS = 1_000_000;

/** The largest square matrix MINVERSE and MDETERM take: their work grows with the cube of the order. */
export const MAX_ORDER = 500;

/** Whether a result is an error rather than what was asked for. */
export function failed<T>(value: T | FormulaError): value is FormulaError {
  return typeof value === 'object' && value !== null && 'error' in value;
}

/** The error for an array past the cap. */
export function tooMany(): FormulaError {
  return errBecause('NUM', 'tooMany');
}

/** Whether an array of rows by cols fits under the cap. */
export function fits(rows: number, cols: number): boolean {
  return rows * cols <= MAX_ELEMENTS;
}

/** A row-major array, or the cap's error when it would be too large. `item` is called once per cell. */
export function build(rows: number, cols: number, item: (r: number, c: number) => Scalar): ArrayValue | FormulaError {
  if (!fits(rows, cols)) return tooMany();
  const data = new Array<Scalar>(rows * cols);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) data[r * cols + c] = item(r, c);
  return makeArray(rows, cols, data);
}

/**
 * An argument as an array, or the error it holds. A single value is a one-by-one array. With `items`, an error is
 * a one-by-one array too, as VSTACK and its kin keep an error as one of their items.
 */
export function arrayArg(value: Value | undefined, items = false): ArrayValue | FormulaError {
  if (value === undefined) return err('VALUE');
  if (failed(value) && !items) return value;
  return isArray(value) ? value : makeArray(1, 1, [value as Scalar]);
}

/** The item at row r and column c. */
export function at(a: ArrayValue, r: number, c: number): Scalar {
  return a.data[r * a.cols + c];
}

/** A whole number from an argument, truncated toward zero; `fallback` when it was left out or empty. */
export function intArg(value: Value | undefined, fallback: number): number | FormulaError {
  if (value === undefined || value === null) return fallback;
  const n = toNumber(value);
  return typeof n === 'number' ? Math.trunc(n) : n;
}

/** A true or false argument; `fallback` when it was left out or empty. */
export function boolArg(value: Value | undefined, fallback: boolean): boolean | FormulaError {
  if (value === undefined || value === null) return fallback;
  return toBool(value);
}

/** An array of numbers as rows, or #VALUE! when any item is not a number (empty and text included). */
function numericRows(value: Value | undefined): Matrix | FormulaError {
  const a = arrayArg(value);
  if (failed(a)) return a;
  const out: Matrix = [];
  for (let r = 0; r < a.rows; r++) {
    const row = new Array<number>(a.cols);
    for (let c = 0; c < a.cols; c++) {
      const v = at(a, r, c);
      if (failed(v)) return v;
      if (typeof v !== 'number') return err('VALUE');
      row[c] = v;
    }
    out.push(row);
  }
  return out;
}

function fromRows(m: Matrix): Value {
  for (const row of m) for (const v of row) if (!Number.isFinite(v)) return err('NUM');
  return makeArray(m.length, m[0]?.length ?? 0, m.flat());
}

/** A square matrix no larger than MAX_ORDER, or the error to give. */
function squareRows(value: Value | undefined): Matrix | FormulaError {
  const m = numericRows(value);
  if (failed(m)) return m;
  if (m.length !== m[0].length) return err('VALUE');
  return m.length > MAX_ORDER ? tooMany() : m;
}

function mmult([a, b]: Value[]): Value {
  const left = numericRows(a);
  if (failed(left)) return left;
  const right = numericRows(b);
  if (failed(right)) return right;
  const inner = right.length;
  if (left[0].length !== inner) return err('VALUE');
  const cols = right[0].length;
  if (!fits(left.length, cols) || left.length * cols * inner > 100 * MAX_ELEMENTS) return tooMany();
  const out: Matrix = left.map((row) => {
    const sums = new Array<number>(cols).fill(0);
    for (let k = 0; k < inner; k++) for (let c = 0; c < cols; c++) sums[c] += row[k] * right[k][c];
    return sums;
  });
  return fromRows(out);
}

function minverse([a]: Value[]): Value {
  const m = squareRows(a);
  if (failed(m)) return m;
  const lu = luDecompose(m);
  if (lu.singular) return err('NUM');
  return fromRows(luSolve(lu, identity(m.length)));
}

function mdeterm([a]: Value[]): Value {
  const m = squareRows(a);
  if (failed(m)) return m;
  const d = luDeterminant(luDecompose(m));
  // Adding 0 turns -0 into 0.
  return Number.isFinite(d) ? d + 0 : err('NUM');
}

function munit([n]: Value[]): Value {
  const size = intArg(n, 1);
  if (typeof size !== 'number') return size;
  if (size < 1) return err('VALUE');
  return build(size, size, (r, c) => (r === c ? 1 : 0));
}

function transpose([a]: Value[]): Value {
  const src = arrayArg(a);
  if (failed(src)) return src;
  return build(src.cols, src.rows, (r, c) => at(src, c, r));
}

/** Rows and columns of a builder: zero gives #CALC! (an empty array), a negative count #VALUE!. */
function sizeOf(rows: Value | undefined, cols: Value | undefined): [number, number] | FormulaError {
  const r = intArg(rows, 1);
  if (typeof r !== 'number') return r;
  const c = intArg(cols, 1);
  if (typeof c !== 'number') return c;
  if (r < 0 || c < 0) return err('VALUE');
  if (r === 0 || c === 0) return err('CALC');
  return fits(r, c) ? [r, c] : tooMany();
}

function sequence([rows, cols, start, step]: Value[]): Value {
  const size = sizeOf(rows, cols);
  if (failed(size)) return size;
  const first = start === undefined || start === null ? 1 : toNumber(start);
  if (typeof first !== 'number') return first;
  const by = step === undefined || step === null ? 1 : toNumber(step);
  if (typeof by !== 'number') return by;
  return build(size[0], size[1], (r, c) => first + (r * size[1] + c) * by);
}

function randarray([rows, cols, min, max, whole]: Value[]): Value {
  const size = sizeOf(rows, cols);
  if (failed(size)) return size;
  const low = min === undefined || min === null ? 0 : toNumber(min);
  if (typeof low !== 'number') return low;
  const high = max === undefined || max === null ? 1 : toNumber(max);
  if (typeof high !== 'number') return high;
  const integer = boolArg(whole, false);
  if (typeof integer !== 'boolean') return integer;
  if (low > high) return err('VALUE');
  if (integer && (!Number.isInteger(low) || !Number.isInteger(high))) return err('VALUE');
  const draw = integer
    ? () => low + Math.floor(Math.random() * (high - low + 1))
    : () => low + Math.random() * (high - low);
  return build(size[0], size[1], draw);
}

const num = (name: string, optional = false): Param => ({ name, kind: 'number', ...(optional ? { optional } : {}) });
const arr = (name: string): Param => ({ name, kind: 'array' });

function spec(name: string, params: Param[], run: FnSpec2['run'], signature: string, example: string): FnSpec2 {
  return { name, family: 'arrays', params, run, meta: { signature, example } };
}

export const functions: readonly FnSpec2[] = [
  spec('MMULT', [arr('array1'), arr('array2')], mmult, 'MMULT(array1, array2)', '=MMULT({1,2}, {3;4}) gives 11'),
  spec('MINVERSE', [arr('array')], minverse, 'MINVERSE(array)', '=MINVERSE({2,0;0,4}) gives {0.5,0;0,0.25}'),
  spec('MDETERM', [arr('array')], mdeterm, 'MDETERM(array)', '=MDETERM({2,1;1,3}) gives 5'),
  spec('MUNIT', [num('dimension')], munit, 'MUNIT(dimension)', '=MUNIT(2) gives {1,0;0,1}'),
  spec('TRANSPOSE', [arr('array')], transpose, 'TRANSPOSE(array)', '=TRANSPOSE({1,2,3}) gives {1;2;3}'),
  spec(
    'SEQUENCE',
    [num('rows'), num('columns', true), num('start', true), num('step', true)],
    sequence,
    'SEQUENCE(rows, [columns], [start], [step])',
    '=SEQUENCE(1, 4, 0, 5) gives {0,5,10,15}',
  ),
  {
    ...spec(
      'RANDARRAY',
      [
        num('rows', true),
        num('columns', true),
        num('min', true),
        num('max', true),
        { name: 'integer', kind: 'bool', optional: true },
      ],
      randarray,
      'RANDARRAY([rows], [columns], [min], [max], [integer])',
      '=RANDARRAY(2, 1, 1, 6, TRUE) gives two whole numbers from 1 to 6',
    ),
    volatile: true,
  },
];
