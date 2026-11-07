// Sums and products of the math family: SUM, PRODUCT, SUMSQ, the conditional sums, SUMPRODUCT and the sums of
// squares, SERIESSUM, PERCENTOF, and the Sheets operator names ADD, MINUS, MULTIPLY, DIVIDE.
// Written from the documented behavior.

import { err, finish, isError, isNumber, toNumber, type ArrayValue, type Scalar, type Value } from '../../values';
import { matchMask } from './criteria';
import { numbersIn, type FnSpec2 } from './types';
import { number, scalar } from './mathKit';

const VALUES = [{ repeat: [{ name: 'value', kind: 'range' as const }], min: 1 }];

function aggregate(name: string, run: (nums: number[]) => Value, example: string): FnSpec2 {
  return {
    name,
    family: 'math',
    params: VALUES,
    run: (args) => {
      const nums = numbersIn(args);
      return Array.isArray(nums) ? run(nums) : nums;
    },
    meta: { signature: `${name}(value, ...)`, example },
  };
}

const total = (nums: readonly number[]) => nums.reduce((a, b) => a + b, 0);

/** The first error among arguments, or null. */
const firstError = (args: readonly Value[]) => args.find(isError) ?? null;

const arrays = (args: readonly Value[]): ArrayValue[] => args as ArrayValue[];

/** An argument's numbers for the sums of squares: pairs where both sides are numbers count, errors win. */
function pairs(args: Value[]): [number, number][] | Value {
  const bad = firstError(args);
  if (bad !== null) return bad;
  const [x, y] = arrays(args);
  if (x.data.length !== y.data.length) return err('NA');
  const out: [number, number][] = [];
  for (let i = 0; i < x.data.length; i++) {
    const a = x.data[i];
    const b = y.data[i];
    if (isError(a)) return a;
    if (isError(b)) return b;
    if (isNumber(a) && isNumber(b)) out.push([a, b]);
  }
  return out;
}

function pairSum(name: string, term: (x: number, y: number) => number, example: string): FnSpec2 {
  return {
    name,
    family: 'math',
    params: [
      { name: 'arrayX', kind: 'array' },
      { name: 'arrayY', kind: 'array' },
    ],
    run: (args) => {
      const p = pairs(args);
      return Array.isArray(p) ? finish(total(p.map(([x, y]) => term(x, y)))) : p;
    },
    meta: { signature: `${name}(arrayX, arrayY)`, example },
  };
}

/** The item of `block` at the row and column of item `i` of `shape`, or null when it lies outside the block. */
function sameSpot(block: ArrayValue, shape: ArrayValue, i: number): Scalar {
  const r = Math.floor(i / shape.cols);
  const c = i % shape.cols;
  return r < block.rows && c < block.cols ? block.data[r * block.cols + c] : null;
}

/** Adds the numbers of `from` at the places `mask` marks. An error at a marked place is the result. */
function addMarked(from: (i: number) => Scalar, mask: readonly boolean[]): Value {
  let sum = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const v = from(i);
    if (isError(v)) return v;
    if (isNumber(v)) sum += v;
  }
  return finish(sum);
}

function sumif([range, criterion, sumRange]: Value[]): Value {
  const base = range as ArrayValue;
  const mask = matchMask(base.data, criterion as Scalar);
  const source = sumRange === undefined ? base : (sumRange as ArrayValue);
  return addMarked((i) => sameSpot(source, base, i), mask);
}

function sumifs(args: Value[]): Value {
  const sums = args[0] as ArrayValue;
  let mask: boolean[] = sums.data.map(() => true);
  for (let k = 1; k < args.length; k += 2) {
    const range = args[k] as ArrayValue;
    if (range.rows !== sums.rows || range.cols !== sums.cols) return err('VALUE');
    const here = matchMask(range.data, args[k + 1] as Scalar);
    mask = mask.map((m, i) => m && here[i]);
  }
  return addMarked((i) => sums.data[i], mask);
}

function sumproduct(args: Value[]): Value {
  const bad = firstError(args);
  if (bad !== null) return bad;
  const list = arrays(args);
  const [first] = list;
  if (list.some((a) => a.rows !== first.rows || a.cols !== first.cols)) return err('VALUE');
  let sum = 0;
  for (let i = 0; i < first.data.length; i++) {
    let product = 1;
    for (const a of list) {
      const v = a.data[i];
      if (isError(v)) return v;
      product *= isNumber(v) ? v : 0; // text and booleans count as zero
    }
    sum += product;
  }
  return finish(sum);
}

function seriessum([x, n, m, coefficients]: Value[]): Value {
  const bad = firstError([x, n, m, coefficients]);
  if (bad !== null) return bad;
  const nums = [toNumber(x), toNumber(n), toNumber(m)];
  for (const v of nums) if (typeof v !== 'number') return v;
  const [xv, nv, mv] = nums as number[];
  let sum = 0;
  const { data } = coefficients as ArrayValue;
  for (let i = 0; i < data.length; i++) {
    const a = data[i];
    if (isError(a)) return a;
    if (!isNumber(a)) return err('VALUE');
    if (a === 0) continue;
    const term = a * xv ** (nv + i * mv);
    if (Number.isNaN(term)) return err('NUM');
    sum += term;
  }
  return finish(sum);
}

function percentOf(args: Value[]): Value {
  const bad = firstError(args);
  if (bad !== null) return bad;
  const [part, whole] = args.map((a) => numbersIn((a as ArrayValue).data));
  if (!Array.isArray(part)) return part;
  if (!Array.isArray(whole)) return whole;
  const all = total(whole);
  return all === 0 ? err('DIV0') : finish(total(part) / all);
}

export const functions: readonly FnSpec2[] = [
  aggregate('SUM', (n) => finish(total(n)), '=SUM(2, 3, 4) gives 9'),
  aggregate(
    'PRODUCT',
    (n) => (n.length === 0 ? 0 : finish(n.reduce((a, b) => a * b, 1))),
    '=PRODUCT(2, 3, 4) gives 24',
  ),
  aggregate('SUMSQ', (n) => finish(total(n.map((x) => x * x))), '=SUMSQ(3, 4) gives 25'),
  {
    name: 'SUMIF',
    family: 'math',
    params: [
      { name: 'range', kind: 'array' },
      { name: 'criterion', kind: 'value' },
      { name: 'sumRange', kind: 'array', optional: true },
    ],
    run: sumif,
    meta: { signature: 'SUMIF(range, criterion, [sumRange])', example: '=SUMIF(A1:A4, ">2") gives 7 over 1, 2, 3, 4' },
  },
  {
    name: 'SUMIFS',
    family: 'math',
    params: [
      { name: 'sumRange', kind: 'array' },
      {
        repeat: [
          { name: 'criteriaRange', kind: 'array' },
          { name: 'criterion', kind: 'value' },
        ],
        min: 1,
      },
    ],
    run: sumifs,
    meta: {
      signature: 'SUMIFS(sumRange, criteriaRange, criterion, ...)',
      example: '=SUMIFS(C1:C4, A1:A4, ">1", B1:B4, "x") adds the C cells whose A and B cells both match',
    },
  },
  {
    name: 'SUMPRODUCT',
    family: 'math',
    params: [{ repeat: [{ name: 'array', kind: 'array' }], min: 1 }],
    run: sumproduct,
    meta: { signature: 'SUMPRODUCT(array, ...)', example: '=SUMPRODUCT({1,2,3}, {4,5,6}) gives 32' },
  },
  pairSum('SUMX2MY2', (x, y) => x * x - y * y, '=SUMX2MY2({3,4}, {1,2}) gives 20'),
  pairSum('SUMX2PY2', (x, y) => x * x + y * y, '=SUMX2PY2({3,4}, {1,2}) gives 30'),
  pairSum('SUMXMY2', (x, y) => (x - y) ** 2, '=SUMXMY2({3,4}, {1,2}) gives 8'),
  {
    name: 'SERIESSUM',
    family: 'math',
    params: [
      { name: 'x', kind: 'value' },
      { name: 'n', kind: 'value' },
      { name: 'm', kind: 'value' },
      { name: 'coefficients', kind: 'array' },
    ],
    handlesErrors: true,
    run: seriessum,
    meta: { signature: 'SERIESSUM(x, n, m, coefficients)', example: '=SERIESSUM(2, 0, 1, {1,1,1}) gives 7' },
  },
  {
    name: 'PERCENTOF',
    family: 'math',
    params: [
      { name: 'part', kind: 'array' },
      { name: 'whole', kind: 'array' },
    ],
    run: percentOf,
    meta: {
      signature: 'PERCENTOF(part, whole)',
      example: '=PERCENTOF(A1:A2, A1:A4) gives the share of the first two in all four',
    },
  },
  scalar('ADD', [number('a'), number('b')], ([a, b]) => finish(a + b), '=ADD(2, 3) gives 5'),
  scalar('MINUS', [number('a'), number('b')], ([a, b]) => finish(a - b), '=MINUS(5, 3) gives 2'),
  scalar('MULTIPLY', [number('a'), number('b')], ([a, b]) => finish(a * b), '=MULTIPLY(4, 3) gives 12'),
  scalar(
    'DIVIDE',
    [number('a'), number('b')],
    ([a, b]) => (b === 0 ? err('DIV0') : finish(a / b)),
    '=DIVIDE(6, 3) gives 2',
  ),
];
