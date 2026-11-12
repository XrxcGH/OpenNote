// Conditional counts and averages, and the counts of blank and distinct cells. Owner: tables:fn-stats. Criteria read
// as criteria.ts documents. Ranges tested together must have the same shape, or the result is #VALUE!.

import { asArray } from '../../arrays';
import { err, finish, isError, isNumber, toScalar, type ArrayValue, type Scalar, type Value } from '../../values';
import { parseCriterion } from './criteria';
import type { FnSpec2, Param } from './types';
import { largest, listOf, mean, smallest } from './statsKit';

const S = 'stats' as const;
const range = (name: string): Param => ({ name, kind: 'range' });
const criterion: Param = { name: 'criterion', kind: 'value' };
const PAIRS = { repeat: [range('criteriaRange'), criterion], min: 1 };

/** Which items meet every criterion of the (range, criterion) pairs; #VALUE! when a range's shape differs. */
function passing(pairs: readonly Value[], shape: ArrayValue | null): boolean[] | Scalar {
  let mask: boolean[] | null = null;
  let want = shape;
  for (let i = 0; i + 1 < pairs.length; i += 2) {
    if (isError(pairs[i])) return pairs[i] as Scalar;
    const tested = asArray(pairs[i]);
    want ??= tested;
    if (tested.rows !== want.rows || tested.cols !== want.cols) return err('VALUE');
    const test = parseCriterion(toScalar(pairs[i + 1]));
    const hits = tested.data.map((v) => test(v));
    mask = mask === null ? hits : mask.map((m, k) => m && hits[k]);
  }
  return mask ?? [];
}

/** The numbers of `target` where the mask is true. */
function picked(target: ArrayValue, mask: boolean[]): number[] | Scalar {
  const out: number[] = [];
  for (let k = 0; k < mask.length; k++) {
    if (!mask[k]) continue;
    const v = target.data[k];
    if (isError(v)) return v;
    if (isNumber(v)) out.push(v);
  }
  return out;
}

/** AVERAGEIFS, MAXIFS, MINIFS: a measure of the target cells whose rows pass every test. */
function ifs(name: string, measure: (nums: number[]) => Value, example: string): FnSpec2 {
  const target = name === 'AVERAGEIFS' ? 'averageRange' : name === 'MAXIFS' ? 'maxRange' : 'minRange';
  return {
    name,
    family: S,
    params: [range(target), PAIRS],
    run: ([first, ...pairs]) => {
      if (isError(first)) return first;
      const values = asArray(first);
      const mask = passing(pairs, values);
      if (!Array.isArray(mask)) return mask;
      const nums = picked(values, mask);
      return Array.isArray(nums) ? measure(nums) : nums;
    },
    meta: { signature: `${name}(${target}, criteriaRange, criterion, ...)`, example },
  };
}

/** The items of the average range that line up with the tested range, by row and column from the top left. */
function alignTo(values: ArrayValue, shape: ArrayValue): ArrayValue {
  if (values.rows === shape.rows && values.cols === shape.cols) return values;
  const data: Scalar[] = [];
  for (let r = 0; r < shape.rows; r++) {
    for (let c = 0; c < shape.cols; c++)
      data.push(r < values.rows && c < values.cols ? values.data[r * values.cols + c] : null);
  }
  return { kind: 'array', rows: shape.rows, cols: shape.cols, data };
}

const average = (nums: number[]): Value => (nums.length ? finish(mean(nums)) : err('DIV0'));

export const functions: readonly FnSpec2[] = [
  {
    name: 'COUNTIF',
    family: S,
    params: [range('range'), criterion],
    run: (args) => {
      const mask = passing(args, null);
      return Array.isArray(mask) ? mask.filter(Boolean).length : mask;
    },
    meta: { signature: 'COUNTIF(range, criterion)', example: '=COUNTIF({1, 5, 9}, ">4") gives 2' },
  },
  {
    name: 'COUNTIFS',
    family: S,
    params: [PAIRS],
    run: (args) => {
      const mask = passing(args, null);
      return Array.isArray(mask) ? mask.filter(Boolean).length : mask;
    },
    meta: {
      signature: 'COUNTIFS(criteriaRange, criterion, ...)',
      example: '=COUNTIFS({1, 5, 9}, ">1", {1, 5, 9}, "<9") gives 1',
    },
  },
  {
    name: 'AVERAGEIF',
    family: S,
    params: [range('range'), criterion, { ...range('averageRange'), optional: true }],
    run: ([tested, test, target]) => {
      if (isError(tested)) return tested;
      if (target !== undefined && isError(target)) return target;
      const shape = asArray(tested);
      const mask = passing([tested, test], null);
      if (!Array.isArray(mask)) return mask;
      const nums = picked(target === undefined ? shape : alignTo(asArray(target), shape), mask);
      return Array.isArray(nums) ? average(nums) : nums;
    },
    meta: {
      signature: 'AVERAGEIF(range, criterion, [averageRange])',
      example: '=AVERAGEIF({1, 5, 9}, ">4") gives 7',
    },
  },
  ifs('AVERAGEIFS', average, '=AVERAGEIFS({10, 20, 30}, {1, 2, 3}, ">1") gives 25'),
  ifs('MAXIFS', (n) => (n.length ? largest(n) : 0), '=MAXIFS({10, 20, 30}, {1, 2, 3}, "<3") gives 20'),
  ifs('MINIFS', (n) => (n.length ? smallest(n) : 0), '=MINIFS({10, 20, 30}, {1, 2, 3}, ">1") gives 20'),
  listOf(
    S,
    'COUNTBLANK',
    (args) => args.filter((v) => v === null || v === '').length,
    '=COUNTBLANK(A1:A3) gives the empty cells',
    true,
  ),
  listOf(
    S,
    'COUNTUNIQUE',
    (args) => {
      const seen = new Set<string>();
      for (const v of args) {
        if (v === null || v === '') continue;
        const s = toScalar(v);
        seen.add(isError(s) ? `e${s.error}` : `${typeof s}:${String(s)}`);
      }
      return seen.size;
    },
    '=COUNTUNIQUE(1, 2, 2, "a") gives 3',
    true,
  ),
];
