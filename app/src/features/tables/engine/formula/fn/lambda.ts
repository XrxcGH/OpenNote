// The LAMBDA helpers: MAP, REDUCE, SCAN, BYROW, BYCOL, and MAKEARRAY. Owner: tables:fn-arrays. Each calls a
// function value made by LAMBDA (formula/special.ts) once per item, row, column, or cell, as documented for Excel.
// A function value that is missing or takes the wrong number of arguments gives #VALUE!. Where each call must give
// one value (MAP, SCAN, BYROW, BYCOL, MAKEARRAY), a call that gives a larger array gives #CALC!, since arrays do
// not nest. REDUCE alone may carry an array from call to call and return it.

import { itemAt, makeArray } from '../../arrays';
import {
  err,
  isArray,
  isLambda,
  type ArrayValue,
  type FormulaError,
  type LambdaValue,
  type Scalar,
  type Value,
} from '../../values';
import { arrayArg, failed, at, build, fits, intArg, tooMany } from './matrix';
import type { FnSpec2 } from './types';

/** The function value an argument holds, or the error to give. */
function lambdaArg(value: Value | undefined): LambdaValue | FormulaError {
  if (value !== undefined && isLambda(value)) return value;
  return value !== undefined && failed(value) ? value : err('VALUE');
}

/** One call's result as a single value: a one-by-one array is its item, a larger one #CALC!. */
function one(value: Value): Scalar {
  if (isArray(value)) return value.rows === 1 && value.cols === 1 ? value.data[0] : err('CALC');
  return isLambda(value) ? err('CALC') : (value as Scalar);
}

/** A slice of an array: row `r` (a 1 by n array) or column `c` (an n by 1 array). */
function rowOf(a: ArrayValue, r: number): ArrayValue {
  return makeArray(1, a.cols, a.data.slice(r * a.cols, (r + 1) * a.cols));
}
function colOf(a: ArrayValue, c: number): ArrayValue {
  return makeArray(
    a.rows,
    1,
    Array.from({ length: a.rows }, (_, r) => at(a, r, c)),
  );
}

/** A value an accumulator starts from: a one-by-one array stands for its item. */
function start(value: Value | undefined): Value {
  if (value === undefined) return null;
  return isArray(value) && value.rows === 1 && value.cols === 1 ? value.data[0] : value;
}

function map(args: Value[]): Value {
  const fn = lambdaArg(args[args.length - 1]);
  if (failed(fn)) return fn;
  const arrays: ArrayValue[] = [];
  for (const v of args.slice(0, -1)) {
    const a = arrayArg(v);
    if (failed(a)) return a;
    arrays.push(a);
  }
  const rows = Math.max(...arrays.map((a) => a.rows));
  const cols = Math.max(...arrays.map((a) => a.cols));
  return build(rows, cols, (r, c) => one(fn.call(arrays.map((a) => itemAt(a, r, c)))));
}

function reduce([init, array, f]: Value[]): Value {
  const fn = lambdaArg(f);
  if (failed(fn)) return fn;
  const a = arrayArg(array);
  if (failed(a)) return a;
  let acc = start(init);
  for (const item of a.data) {
    acc = fn.call([acc, item]);
    if (failed(acc)) return acc;
  }
  return acc;
}

function scan([init, array, f]: Value[]): Value {
  const fn = lambdaArg(f);
  if (failed(fn)) return fn;
  const a = arrayArg(array);
  if (failed(a)) return a;
  let acc: Value = start(init);
  const data = a.data.map((item) => {
    acc = one(fn.call([acc, item]));
    return acc;
  });
  return makeArray(a.rows, a.cols, data);
}

function byRow([array, f]: Value[]): Value {
  const fn = lambdaArg(f);
  if (failed(fn)) return fn;
  const a = arrayArg(array);
  if (failed(a)) return a;
  return makeArray(
    a.rows,
    1,
    Array.from({ length: a.rows }, (_, r) => one(fn.call([rowOf(a, r)]))),
  );
}

function byCol([array, f]: Value[]): Value {
  const fn = lambdaArg(f);
  if (failed(fn)) return fn;
  const a = arrayArg(array);
  if (failed(a)) return a;
  return makeArray(
    1,
    a.cols,
    Array.from({ length: a.cols }, (_, c) => one(fn.call([colOf(a, c)]))),
  );
}

function makeArrayFn([rows, cols, f]: Value[]): Value {
  const r = intArg(rows, 1);
  if (typeof r !== 'number') return r;
  const c = intArg(cols, 1);
  if (typeof c !== 'number') return c;
  if (r < 1 || c < 1) return err('VALUE');
  if (!fits(r, c)) return tooMany();
  const fn = lambdaArg(f);
  if (failed(fn)) return fn;
  return build(r, c, (i, j) => one(fn.call([i + 1, j + 1])));
}

const lambda = { name: 'lambda', kind: 'lambda' } as const;
const array = { name: 'array', kind: 'array' } as const;
const initial = { name: 'initial_value', kind: 'array' } as const;

function spec(
  name: string,
  params: FnSpec2['params'],
  run: FnSpec2['run'],
  signature: string,
  example: string,
): FnSpec2 {
  return { name, family: 'logical', params, run, meta: { signature, example } };
}

export const functions: readonly FnSpec2[] = [
  spec(
    'MAP',
    [{ repeat: [array], min: 1 }, lambda],
    map,
    'MAP(array, ..., lambda)',
    '=MAP({1,2,3}, LAMBDA(x, x^2)) gives {1,4,9}',
  ),
  spec(
    'REDUCE',
    [initial, array, lambda],
    reduce,
    'REDUCE([initial_value], array, lambda)',
    '=REDUCE(1, {2,3,4}, LAMBDA(a, b, a*b)) gives 24',
  ),
  spec(
    'SCAN',
    [initial, array, lambda],
    scan,
    'SCAN([initial_value], array, lambda)',
    '=SCAN(1, {2,3,4}, LAMBDA(a, b, a*b)) gives {2,6,24}',
  ),
  spec('BYROW', [array, lambda], byRow, 'BYROW(array, lambda)', '=BYROW({1,5;2,4}, LAMBDA(r, MAX(r))) gives {5;4}'),
  spec('BYCOL', [array, lambda], byCol, 'BYCOL(array, lambda)', '=BYCOL({1,5;2,4}, LAMBDA(c, MIN(c))) gives {1,4}'),
  spec(
    'MAKEARRAY',
    [{ name: 'rows', kind: 'number' }, { name: 'columns', kind: 'number' }, lambda],
    makeArrayFn,
    'MAKEARRAY(rows, columns, lambda)',
    '=MAKEARRAY(2, 3, LAMBDA(r, c, r+c)) gives {2,3,4;3,4,5}',
  ),
];
