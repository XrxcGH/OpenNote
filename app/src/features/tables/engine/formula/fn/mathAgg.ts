// SUBTOTAL and AGGREGATE. A reference reaches them with the state of each row (ArrayValue.rowState): shown, hidden
// by hand, or filtered out. SUBTOTAL 1 to 11 skips filtered rows and keeps rows hidden by hand; 101 to 111 skip both.
// AGGREGATE option 0 to 7 picks what to ignore: hidden rows (which covers filtered ones), error values, both, or
// neither. SUBTOTAL skips nested SUBTOTAL and AGGREGATE cells, and so do AGGREGATE options 0 to 3. Written from the documented behavior.

import { err, finish, isError, isNumber, toNumber, type ArrayValue, type Scalar, type Value } from '../../values';
import type { FnSpec2 } from './types';
import { number } from './mathKit';

/** The values of the reference arguments that `keep` accepts, given a cell's row state and whether it is a nested subtotal. */
function itemsOf(blocks: readonly ArrayValue[], keep: (state: number, nested: boolean) => boolean): Scalar[] {
  const out: Scalar[] = [];
  for (const block of blocks) {
    const { data, cols, rowState, nested } = block;
    for (let i = 0; i < data.length; i++) {
      const state = rowState === undefined ? 0 : (rowState[Math.floor(i / cols)] ?? 0);
      if (keep(state, nested !== undefined && nested[i] === true)) out.push(data[i]);
    }
  }
  return out;
}

const sum = (n: readonly number[]) => n.reduce((a, b) => a + b, 0);

function variance(n: readonly number[], sample: boolean): Value {
  const d = sample ? n.length - 1 : n.length;
  if (d < 1) return err('DIV0');
  const mean = sum(n) / n.length;
  return finish(sum(n.map((x) => (x - mean) ** 2)) / d);
}

function spread(n: readonly number[], sample: boolean): Value {
  const v = variance(n, sample);
  return isNumber(v) ? Math.sqrt(v) : v;
}

function median(n: readonly number[]): Value {
  if (n.length === 0) return err('NUM');
  const s = [...n].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : finish((s[mid - 1] + s[mid]) / 2);
}

function mode(n: readonly number[]): Value {
  const counts = new Map<number, number>();
  for (const x of n) counts.set(x, (counts.get(x) ?? 0) + 1);
  let best: number | null = null;
  let most = 1;
  for (const x of n) {
    const c = counts.get(x) ?? 0;
    if (c > most) {
      most = c;
      best = x;
    }
  }
  return best ?? err('NA');
}

/** The k-th percentile by the inclusive (rank k(n-1)) or exclusive (rank k(n+1)-1) rule. */
function percentile(n: readonly number[], k: number, exclusive: boolean): Value {
  if (n.length === 0 || k < 0 || k > 1) return err('NUM');
  const s = [...n].sort((a, b) => a - b);
  const rank = exclusive ? k * (s.length + 1) - 1 : k * (s.length - 1);
  if (rank < 0 || rank > s.length - 1) return err('NUM');
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return finish(s[low] + (s[high] - s[low]) * (rank - low));
}

/** LARGE and SMALL: the k-th value counting from the top or the bottom. */
function nth(n: readonly number[], k: number, largest: boolean): Value {
  const at = Math.ceil(k);
  if (n.length === 0 || at < 1 || at > n.length) return err('NUM');
  const s = [...n].sort((a, b) => (largest ? b - a : a - b));
  return s[at - 1];
}

/** Functions 1 to 13 of both lists, which take only references. */
function combine(code: number, items: readonly Scalar[]): Value {
  const nums = items.filter(isNumber);
  switch (code) {
    case 1:
      return nums.length ? finish(sum(nums) / nums.length) : err('DIV0');
    case 2:
      return nums.length;
    case 3:
      return items.filter((v) => v !== null).length;
    case 4:
      return nums.length ? nums.reduce((a, b) => (b > a ? b : a)) : 0;
    case 5:
      return nums.length ? nums.reduce((a, b) => (b < a ? b : a)) : 0;
    case 6:
      return nums.length ? finish(nums.reduce((a, b) => a * b, 1)) : 0;
    case 7:
      return spread(nums, true);
    case 8:
      return spread(nums, false);
    case 9:
      return finish(sum(nums));
    case 10:
      return variance(nums, true);
    case 11:
      return variance(nums, false);
    case 12:
      return median(nums);
    default:
      return mode(nums);
  }
}

/** The first error among the items, or null. COUNT never sees one and COUNTA counts it, so neither is stopped. */
function stopper(code: number, items: readonly Scalar[]): Value | null {
  if (code === 2 || code === 3) return null;
  const bad = items.find(isError);
  return bad === undefined ? null : (bad as Value);
}

function codeOf(value: Value, low: number, high: number): number | Value {
  const n = toNumber(value);
  if (typeof n !== 'number') return n;
  const k = Math.trunc(n);
  return k < low || k > high ? err('VALUE') : k;
}

function subtotal(args: Value[]): Value {
  const num = codeOf(args[0], 1, 111);
  if (typeof num !== 'number') return num;
  const base = num % 100;
  if (base < 1 || base > 11 || (num > 11 && num < 101)) return err('VALUE');
  const hideManual = num > 100;
  const kept = itemsOf(
    args.slice(1) as ArrayValue[],
    (state, nested) => !nested && (state === 0 || (state === 1 && !hideManual)),
  );
  return stopper(base, kept) ?? combine(base, kept);
}

function aggregate(args: Value[]): Value {
  const num = codeOf(args[0], 1, 19);
  if (typeof num !== 'number') return num;
  const option = codeOf(args[1], 0, 7);
  if (typeof option !== 'number') return option;
  const hideRows = option === 1 || option === 3 || option === 5 || option === 7;
  const hideErrors = option === 2 || option === 3 || option === 6 || option === 7;
  const refs = args.slice(2) as ArrayValue[];
  let k = 0;
  if (num > 13) {
    // The array forms take one array and the k that picks the value.
    if (refs.length !== 2) return err('VALUE');
    const kk = toNumber(refs[1].data[0] ?? null);
    if (typeof kk !== 'number') return kk;
    k = kk;
    refs.pop();
  }
  // Options 0 to 3 also skip the results of nested SUBTOTAL and AGGREGATE cells.
  const hideNested = option <= 3;
  const kept = itemsOf(refs, (state, nested) => !(hideRows && state !== 0) && !(hideNested && nested)).filter(
    (v) => !(hideErrors && isError(v)),
  );
  if (num <= 13) return stopper(num, kept) ?? combine(num, kept);
  const bad = stopper(num, kept);
  if (bad !== null) return bad;
  const nums = kept.filter(isNumber);
  switch (num) {
    case 14:
      return nth(nums, k, true);
    case 15:
      return nth(nums, k, false);
    case 16:
      return percentile(nums, k, false);
    case 18:
      return percentile(nums, k, true);
    default: {
      const q = Math.trunc(k);
      const exclusive = num === 19;
      return q < (exclusive ? 1 : 0) || q > (exclusive ? 3 : 4) ? err('NUM') : percentile(nums, q / 4, exclusive);
    }
  }
}

const REFS = { name: 'ref', kind: 'range', rowState: true } as const;

export const functions: readonly FnSpec2[] = [
  {
    name: 'SUBTOTAL',
    family: 'math',
    params: [number('function'), { repeat: [REFS], min: 1 }],
    run: subtotal,
    meta: {
      signature: 'SUBTOTAL(function, ref, ...)',
      example: '=SUBTOTAL(109, A1:A9) adds the shown cells and skips hidden and filtered rows',
    },
  },
  {
    name: 'AGGREGATE',
    family: 'math',
    params: [number('function'), number('options'), { repeat: [REFS], min: 1 }],
    run: aggregate,
    meta: {
      signature: 'AGGREGATE(function, options, ref, ...)',
      example: '=AGGREGATE(14, 6, A1:A9, 1) gives the largest number and ignores errors',
    },
  },
];
