// Sorting and binary search, instrumented: each algorithm counts its comparisons and its moves (swaps of 2 different
// places, shifts, or writes, whichever the method makes) and logs the array after each pass, partition, or merge.
import { step } from '../core/step';
import type { Step } from '../core/step';
import { fail } from '../core/util';

export const SORTS = [
  'insertion',
  'bubble',
  'selection',
  'merge',
  'lomuto',
  'hoare',
  'heap',
  'counting',
  'radix',
] as const;
export type SortId = (typeof SORTS)[number];

export interface SortRun {
  result: number[];
  comparisons: number;
  moves: number;
  moveKind: 'swaps' | 'shifts' | 'writes';
  log: Step[];
}

export const MAX_SORT = 2000;
const show = (a: readonly number[]) => a.join(' ');

interface Ctx {
  a: number[];
  log: Step[];
  comparisons: number;
  moves: number;
  less(x: number, y: number): boolean;
  swap(i: number, j: number): void;
}

function insertion(c: Ctx): SortRun['moveKind'] {
  const { a } = c;
  for (let i = 1; i < a.length; i += 1) {
    const key = a[i];
    let j = i - 1;
    while (j >= 0 && c.less(key, a[j])) {
      a[j + 1] = a[j];
      c.moves += 1;
      j -= 1;
    }
    a[j + 1] = key;
    c.log.push(step('insert', { key, at: j + 1, array: show(a) }));
  }
  return 'shifts';
}

function bubble(c: Ctx): SortRun['moveKind'] {
  const { a } = c;
  for (let pass = 1; pass < a.length; pass += 1) {
    let swapped = false;
    for (let j = 0; j < a.length - pass; j += 1)
      if (c.less(a[j + 1], a[j])) {
        c.swap(j, j + 1);
        swapped = true;
      }
    c.log.push(step('pass', { pass, array: show(a) }));
    if (!swapped) {
      c.log.push(step('noSwaps'));
      break;
    }
  }
  return 'swaps';
}

function selection(c: Ctx): SortRun['moveKind'] {
  const { a } = c;
  for (let i = 0; i < a.length - 1; i += 1) {
    let min = i;
    for (let j = i + 1; j < a.length; j += 1) if (c.less(a[j], a[min])) min = j;
    c.swap(i, min);
    c.log.push(step('select', { value: a[i], at: i, array: show(a) }));
  }
  return 'swaps';
}

function merge(c: Ctx): SortRun['moveKind'] {
  const { a } = c;
  const join = (lo: number, mid: number, hi: number) => {
    const left = a.slice(lo, mid + 1);
    const right = a.slice(mid + 1, hi + 1);
    let i = 0;
    let j = 0;
    for (let k = lo; k <= hi; k += 1) {
      if (j >= right.length || (i < left.length && !c.less(right[j], left[i]))) a[k] = left[i++];
      else a[k] = right[j++];
      c.moves += 1;
    }
    c.log.push(step('merge', { lo, hi, array: show(a) }));
  };
  const rec = (lo: number, hi: number) => {
    if (lo >= hi) return;
    const mid = Math.floor((lo + hi) / 2);
    rec(lo, mid);
    rec(mid + 1, hi);
    join(lo, mid, hi);
  };
  rec(0, a.length - 1);
  return 'writes';
}

function lomutoPart(c: Ctx, lo: number, hi: number): number {
  const { a } = c;
  const pivot = a[hi];
  let i = lo - 1;
  for (let j = lo; j < hi; j += 1)
    if (!c.less(pivot, a[j])) {
      i += 1;
      c.swap(i, j);
    }
  c.swap(i + 1, hi);
  c.log.push(step('partition', { pivot, array: show(a) }));
  return i + 1;
}

function hoarePart(c: Ctx, lo: number, hi: number): number {
  const { a } = c;
  const pivot = a[lo];
  let i = lo - 1;
  let j = hi + 1;
  for (;;) {
    do i += 1;
    while (c.less(a[i], pivot));
    do j -= 1;
    while (c.less(pivot, a[j]));
    if (i >= j) {
      c.log.push(step('partition', { pivot, array: show(a) }));
      return j;
    }
    c.swap(i, j);
  }
}

const quick =
  (hoare: boolean) =>
  (c: Ctx): SortRun['moveKind'] => {
    const rec = (lo: number, hi: number) => {
      if (lo >= hi) return;
      if (hoare) {
        const p = hoarePart(c, lo, hi);
        rec(lo, p);
        rec(p + 1, hi);
      } else {
        const p = lomutoPart(c, lo, hi);
        rec(lo, p - 1);
        rec(p + 1, hi);
      }
    };
    rec(0, c.a.length - 1);
    return 'swaps';
  };

function heap(c: Ctx): SortRun['moveKind'] {
  const { a } = c;
  const sift = (i: number, size: number) => {
    for (;;) {
      const l = 2 * i + 1;
      let big = i;
      if (l < size && c.less(a[big], a[l])) big = l;
      if (l + 1 < size && c.less(a[big], a[l + 1])) big = l + 1;
      if (big === i) return;
      c.swap(i, big);
      i = big;
    }
  };
  for (let i = Math.floor(a.length / 2) - 1; i >= 0; i -= 1) sift(i, a.length);
  c.log.push(step('heapBuilt', { array: show(a) }));
  for (let end = a.length - 1; end > 0; end -= 1) {
    c.swap(0, end);
    sift(0, end);
    c.log.push(step('heapMove', { value: a[end], array: show(a) }));
  }
  return 'swaps';
}

function counting(c: Ctx): SortRun['moveKind'] {
  const { a } = c;
  if (a.some((x) => !Number.isInteger(x))) fail('wholeOnly');
  const lo = Math.min(...a, 0);
  const hi = Math.max(...a, 0);
  if (hi - lo > 100_000) fail('countingRange', { max: 100_000 });
  const count = new Array<number>(hi - lo + 1).fill(0);
  for (const x of a) count[x - lo] += 1;
  const listed = count.map((n, i) => (n ? `${i + lo}×${n}` : '')).filter(Boolean);
  c.log.push(step('counts', { counts: listed.join(', ') }));
  let k = 0;
  count.forEach((n, i) => {
    for (let t = 0; t < n; t += 1) {
      a[k++] = i + lo;
      c.moves += 1;
    }
  });
  return 'writes';
}

function radix(c: Ctx): SortRun['moveKind'] {
  const { a } = c;
  if (a.some((x) => !Number.isInteger(x))) fail('wholeOnly');
  if (a.some((x) => x < 0)) fail('radixNegative');
  const max = Math.max(...a, 0);
  for (let exp = 1; Math.floor(max / exp) > 0; exp *= 10) {
    const buckets: number[][] = Array.from({ length: 10 }, () => []);
    for (const x of a) buckets[Math.floor(x / exp) % 10].push(x);
    buckets.flat().forEach((x, i) => {
      a[i] = x;
      c.moves += 1;
    });
    c.log.push(step('digit', { place: exp, array: show(a) }));
  }
  return 'writes';
}

const RUNNERS: Record<SortId, (c: Ctx) => SortRun['moveKind']> = {
  insertion,
  bubble,
  selection,
  merge,
  lomuto: quick(false),
  hoare: quick(true),
  heap,
  counting,
  radix,
};

export function sort(id: SortId, input: readonly number[]): SortRun {
  if (input.length > MAX_SORT) fail('arrayLong', { max: MAX_SORT });
  const c: Ctx = {
    a: [...input],
    log: [],
    comparisons: 0,
    moves: 0,
    less(x, y) {
      c.comparisons += 1;
      return x < y;
    },
    swap(i, j) {
      if (i === j) return;
      [c.a[i], c.a[j]] = [c.a[j], c.a[i]];
      c.moves += 1;
    },
  };
  const moveKind = RUNNERS[id](c);
  return { result: c.a, comparisons: c.comparisons, moves: c.moves, moveKind, log: c.log };
}

export interface SearchRun {
  index: number;
  comparisons: number;
  log: Step[];
}

/** Binary search on a sorted array; the log has the range and the middle each round. */
export function binarySearch(a: readonly number[], target: number): SearchRun {
  for (let i = 1; i < a.length; i += 1) if (a[i] < a[i - 1]) fail('notSorted');
  let lo = 0;
  let hi = a.length - 1;
  let comparisons = 0;
  const log: Step[] = [];
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    comparisons += 1;
    log.push(step('probe', { lo, hi, mid, value: a[mid] }));
    if (a[mid] === target) return { index: mid, comparisons, log };
    if (a[mid] < target) lo = mid + 1;
    else hi = mid - 1;
  }
  log.push(step('empty'));
  return { index: -1, comparisons, log };
}
