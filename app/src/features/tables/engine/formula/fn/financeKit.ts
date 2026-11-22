// Helpers the financial function files share: reading arguments, and finding a rate by root finding. Owner:
// tables:fn-finance. These files load in the financial chunk, the first time a formula calls one of the functions.

import { bracketScan, brent } from '../../../../../core/num/roots';
import {
  err,
  finish,
  isArray,
  isError,
  isNumber,
  toBool,
  toNumber,
  type FormulaError,
  type Scalar,
  type Value,
} from '../../values';
import { basisOf, frequencyOf, type Basis } from './daycount';
import type { FnSpec2 } from './types';

export type Run = FnSpec2['run'];

/**
 * The numbers of a call. An argument left out takes its default from `defaults` (same position); text that is not a
 * number gives #VALUE!, and an error argument is the result.
 */
export function nums(args: readonly Value[], defaults: readonly (number | undefined)[] = []): number[] | FormulaError {
  const out: number[] = [];
  const count = Math.max(args.length, defaults.length);
  for (let i = 0; i < count; i++) {
    if (i >= args.length) {
      out.push(defaults[i] ?? 0);
      continue;
    }
    const n = toNumber(args[i]);
    if (typeof n !== 'number') return n;
    out.push(n);
  }
  return out;
}

/** A logical argument, or `fallback` when it is left out. */
export function flag(args: readonly Value[], i: number, fallback: boolean): boolean | FormulaError {
  return i < args.length ? toBool(args[i]) : fallback;
}

/** The type argument of the payment functions: 0 (end of period) unless it is not zero. */
export const due = (t: number): 0 | 1 => (t === 0 ? 0 : 1);

/** A date argument: its whole day. Negative dates are invalid. */
export function day(n: number): number | null {
  const d = Math.trunc(n);
  return d >= 0 && d <= 2_958_465 ? d : null;
}

/** The basis argument checked, or #NUM!. */
export function basisArg(n: number): Basis | FormulaError {
  return basisOf(n) ?? err('NUM');
}

/** The frequency argument checked, or #NUM!. */
export function frequencyArg(n: number): 1 | 2 | 4 | FormulaError {
  return frequencyOf(n) ?? err('NUM');
}

/** Every item of a range or array argument, in reading order. A single value counts as one item. */
export function itemsOf(value: Value): readonly Scalar[] {
  if (isArray(value)) return value.data;
  return [value as Scalar];
}

/**
 * The numbers among a range's items, skipping text, logicals, and empty cells, as the cash-flow functions read a
 * range. An error item is the result.
 */
export function flowsOf(values: readonly Value[]): number[] | FormulaError {
  const out: number[] = [];
  for (const v of values) {
    for (const item of itemsOf(v)) {
      if (isError(item)) return item;
      if (isNumber(item)) out.push(item);
    }
  }
  return out;
}

/** Every item of a range read strictly as a number: an empty cell, text, or a logical gives #VALUE!. */
export function strictNumbers(value: Value): number[] | FormulaError {
  const out: number[] = [];
  for (const item of itemsOf(value)) {
    if (isError(item)) return item;
    if (!isNumber(item)) return err('VALUE');
    out.push(item);
  }
  return out;
}

/**
 * The sum of v^-k for k = 1 to n, with v = 1 + u (u > -1): a geometric sum, so its cost does not grow with n. It is
 * (1 - v^-n) / (v - 1), worked through expm1 and log1p so that it stays exact when u is tiny. It is n when u is 0.
 */
export function discountSum(u: number, n: number): number {
  if (u === 0) return n;
  return -Math.expm1(-n * Math.log1p(u)) / u;
}

/** A result: a number, or #NUM! when it is not finite. */
export const done = (n: number): Value => finish(n === 0 ? 0 : n);

/**
 * A root of f near `guess`, for a rate above `lo`. Newton's method from the guess comes first, as the reference apps do.
 * When it fails, the rates from just above `lo` to `hi` are scanned for a change of sign, refined by Brent's method.
 * The scan also looks next to the rates where f overflows. The root nearest the guess wins. Null when there is none.
 */
export function solveRate(f: (x: number) => number, guess: number, lo = -1, hi = 10): number | null {
  const newton = newtonFrom(f, guess, lo);
  if (newton !== null) return newton;
  const from = lo + 1e-9;
  if (!(hi > from)) return null;
  let roots: number[];
  try {
    roots = [...bracketScan(f, from, hi, 2000, 1e-15), ...overflowRoots(f, from, hi, 2000)];
  } catch {
    return null;
  }
  if (roots.length === 0) return null;
  return roots.reduce((best, r) => (Math.abs(r - guess) < Math.abs(best - guess) ? r : best));
}

/**
 * Roots that sit next to the rates where f overflows. A bond's price at a deep negative yield can pass the largest
 * number between two scan points, while the price the yield must give lies just short of it. The scan skips a step
 * with an infinite end, so here the edge of the finite part is found by bisection. When f changes sign between that
 * edge and the step's finite end, Brent's method finds the root between them. A pole, where f is infinite on one side
 * and of the other sign right next to it, gives no change of sign on the finite part, so it gives no root.
 */
function overflowRoots(f: (x: number) => number, lo: number, hi: number, samples: number): number[] {
  const roots: number[] = [];
  const finite = (x: number): boolean => Number.isFinite(f(x));
  let x0 = lo;
  let f0 = f(x0);
  for (let i = 1; i <= samples; i++) {
    const x1 = lo + ((hi - lo) * i) / samples;
    const f1 = f(x1);
    const ok0 = Number.isFinite(f0);
    const ok1 = Number.isFinite(f1);
    // An infinite end, not a NaN one: f grows past the largest number there.
    if (ok0 !== ok1 && !Number.isNaN(ok0 ? f1 : f0)) {
      // Bisect for the finite point nearest the edge, keeping `inside` finite and `outside` not.
      let inside = ok0 ? x0 : x1;
      let outside = ok0 ? x1 : x0;
      for (let k = 0; k < 80; k++) {
        const mid = (inside + outside) / 2;
        if (mid === inside || mid === outside) break;
        if (finite(mid)) inside = mid;
        else outside = mid;
      }
      const far = ok0 ? x0 : x1;
      const fe = f(inside);
      const ff = ok0 ? f0 : f1;
      if (fe !== 0 && ff !== 0 && fe > 0 !== ff > 0) {
        const a = Math.min(inside, far);
        const b = Math.max(inside, far);
        const root = brent(f, a, b, 1e-15);
        if (Math.abs(root.fx) <= 1e-6 * (Math.abs(fe) + Math.abs(ff)) + 1e-12) roots.push(root.x);
      }
    }
    x0 = x1;
    f0 = f1;
  }
  return roots;
}

function newtonFrom(f: (x: number) => number, guess: number, lo: number): number | null {
  let x = guess;
  if (!(x > lo)) return null;
  for (let i = 0; i < 100; i++) {
    const fx = f(x);
    if (!Number.isFinite(fx)) return null;
    if (fx === 0) return x;
    const h = 1e-7 * Math.max(1, Math.abs(x));
    const slope = (f(x + h) - f(x - h)) / (2 * h);
    if (!Number.isFinite(slope) || slope === 0) return null;
    const next = x - fx / slope;
    if (!(next > lo) || !Number.isFinite(next)) return null;
    if (Math.abs(next - x) <= 1e-13 * Math.max(1, Math.abs(x))) return polish(f, next);
    x = next;
  }
  return null;
}

/** Tightens a Newton root with Brent's method on a small bracket, when one is found; else keeps it. */
function polish(f: (x: number) => number, x: number): number {
  const h = 1e-9 * Math.max(1, Math.abs(x));
  const a = x - h;
  const b = x + h;
  const fa = f(a);
  const fb = f(b);
  if (!(Number.isFinite(fa) && Number.isFinite(fb)) || fa > 0 === fb > 0) return x;
  try {
    return brent(f, a, b, 1e-16).x;
  } catch {
    return x;
  }
}
