// The tests for a series of positive terms b_n = |a_n|. They are the n-th term test, the geometric series, the ratio
// and root tests, comparison with sin and cos removed, the p-series, and Bertrand's rule for logarithms. Limits come
// from the terms at large n and from Richardson extrapolation. A limit near 1 is never trusted, because a term near
// 1/n still has a ratio of 0.9999 at n = 10^4.
import { readFunction } from '../expr';
import { close, fmt, sequenceLimit, toFraction } from '../numeric';
import { step, type KitStep } from '../types';

export type Term = (n: number) => number;

/** A limit of u(n), trying smaller starting points when large n overflows. */
export function limitOf(u: (n: number) => number): number {
  for (const from of [64, 32, 16, 8]) {
    const value = sequenceLimit(u, from);
    if (Number.isFinite(value)) {
      // A sequence that is still growing fast has no finite limit.
      const big = Math.abs(u(from * 8));
      if (big > 10 && big > 1.5 * Math.abs(u(from * 4))) return Infinity;
      return value;
    }
    if (Math.abs(u(from * 8)) === Infinity) return Infinity;
  }
  return NaN;
}

export const tidy = (value: number): string => {
  const fraction = toFraction(value, 24, 1e-5);
  if (fraction && fraction[1] > 1) return `${fraction[0]}/${fraction[1]} (about ${fmt(value, 5)})`;
  return fmt(Math.abs(value) < 1e-5 ? 0 : value, 6);
};

export interface Positive {
  verdict: 'converges' | 'diverges' | 'unknown';
  steps: KitStep[];
  /** Decay rate q for summing: the partial sums miss by about N^-q. NaN for fast decay. */
  power: number;
  fast: boolean;
  /** The exponent p of a power-law decay 1/n^p, when there is one. */
  decay?: number;
  /** The terms clearly do not tend to 0. */
  nonzero: boolean;
}

/** The largest of ten neighbors, which keeps a term that wobbles (sin n) from fooling a size comparison. */
const envelope = (b: Term, n: number): number => {
  let top = 0;
  for (let j = 0; j < 10; j++) top = Math.max(top, b(n + j));
  return top;
};

/** True when the terms clearly do not tend to 0: a limit away from 0 that the far terms do not shrink toward. */
function clearlyNonzero(b: Term, start: number): boolean {
  const limit = limitOf(b);
  if (limit === Infinity) return true;
  if (!Number.isFinite(limit)) return false;
  let top = 0;
  for (let n = start; n < start + 60; n++) {
    const v = b(n);
    if (Number.isFinite(v)) top = Math.max(top, v);
  }
  if (Math.abs(limit) <= 1e-3 * top) return false;
  const [e3, e6, e9] = [1e3, 1e6, 1e9].map((n) => envelope(b, n));
  return !(e6 < 0.9 * e3 && e9 < 0.9 * e6);
}

/** The first of a few large n at which a quantity is finite at eight neighbors, with those values. */
function windowAt(of: (n: number) => number, sizes = [1e4, 1e3, 100]): number[] | null {
  for (const n0 of sizes) {
    const values = Array.from({ length: 8 }, (_, j) => of(n0 + j));
    if (values.every(Number.isFinite)) return values;
  }
  return null;
}

/** The |a_n| bound when sin and cos only scale the term: |a_n| <= bound(n), or null when they do something else. */
function trigBound(termText: string, start: number): Term | null {
  if (!/\b(sin|cos)\s*\(/.test(termText)) return null;
  let text = termText;
  for (let i = 0; i < 6; i++) {
    const next = text.replace(/\b(sin|cos)\s*\((?:[^()]|\([^()]*\))*\)/, 's');
    if (next === text) break;
    text = next;
  }
  if (/\b(sin|cos)\b/.test(text)) return null;
  let g: (v: number[]) => number;
  try {
    g = readFunction(text, ['n', 's']);
  } catch {
    return null;
  }
  // The term must be s^k times something free of s (k = 1, 2, 3), so |s| <= 1 only shrinks it.
  const ok = [1, 2, 3].some((k) =>
    [start, start + 3, start + 11].every((n) => {
      const one = g([n, 1]);
      return Number.isFinite(one) && close(Math.abs(g([n, 0.5])), Math.abs(one) * 0.5 ** k, 1e-9);
    }),
  );
  return ok ? (n) => Math.abs(g([n, 1])) : null;
}

/** Fit b_n ~ C n^-p (ln n)^-q at n = 2^k; null when the fit is not exact. */
function logPowerFit(b: Term): { p: number; q: number } | null {
  const pts = [16, 24, 32, 20, 28, 36].map((k) => {
    const L = k * Math.LN2;
    return [1, L, Math.log(L), Math.log(b(2 ** k))];
  });
  if (!pts.every((r) => r.every(Number.isFinite))) return null;
  // Solve [1, L, ln L] . (c, -p, -q) = ln b by Cramer's rule on the first three points.
  const m = pts.slice(0, 3).map((r) => r.slice(0, 3));
  const det3 = (x: number[][]) =>
    x[0][0] * (x[1][1] * x[2][2] - x[1][2] * x[2][1]) -
    x[0][1] * (x[1][0] * x[2][2] - x[1][2] * x[2][0]) +
    x[0][2] * (x[1][0] * x[2][1] - x[1][1] * x[2][0]);
  const d = det3(m);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-9) return null;
  const solve = (col: number) => det3(m.map((r, i) => r.map((v, j) => (j === col ? pts[i][3] : v)))) / d;
  const [c, mp, mq] = [solve(0), solve(1), solve(2)];
  const worst = Math.max(...pts.slice(3).map((r) => Math.abs(c + mp * r[1] + mq * r[2] - r[3])));
  return worst < 1e-6 ? { p: -mp, q: -mq } : null;
}

const result = (
  steps: KitStep[],
  verdict: Positive['verdict'],
  power = NaN,
  fast = false,
  nonzero = false,
): Positive => ({ verdict, steps, power, fast, nonzero });

/** A geometric series: the ratio of neighbors is the same everywhere. */
function geometric(b: Term, start: number, steps: KitStep[]): Positive | null {
  const r0 = b(start + 1) / b(start);
  if (!Number.isFinite(r0) || ![3, 7, 12].every((k) => close(b(start + 1 + k) / b(start + k), r0, 1e-9))) return null;
  steps.push(step('geometric', undefined, { ratio: fmt(r0, 8) }));
  if (r0 < 1) {
    steps.push(step('geometricConv', undefined, { abs: fmt(r0, 8) }));
    return result(steps, 'converges', NaN, true);
  }
  steps.push(step('geometricDiv', undefined, { abs: fmt(r0, 8) }));
  return result(steps, 'diverges', NaN, false, true);
}

/**
 * The ratio test counts only when the ratios settle: a wobbling term (sin n) has no limit, and a limit within 1e-3
 * of 1 (1/(n ln n) is still 0.9999 at n = 10^4) is a limit of 1. Where the ratio test has nothing to say the root
 * test is tried, and there too only a root clearly away from 1 counts, since the n-th root of a term near 1/n is
 * still 0.999 at n = 10^4.
 */
function ratioOrRoot(b: Term, steps: KitStep[]): Positive | null {
  const ratioAt = (n: number) => b(n + 1) / b(n);
  const window = windowAt(ratioAt);
  const settled = window !== null && Math.max(...window) - Math.min(...window) <= 0.02 * Math.max(...window);
  const ratio = settled ? limitOf(ratioAt) : NaN;
  if (settled && Number.isFinite(ratio)) {
    const near = window![0];
    const shown = Math.abs(ratio - near) < 1e-2 ? ratio : near;
    steps.push(step('ratio', undefined, { limit: tidy(shown) }));
    if (ratio < 1 - 1e-3 && near < 1 - 1e-3) {
      steps.push(step('ratioConv'));
      return result(steps, 'converges', NaN, true);
    }
    if (ratio > 1 + 1e-3 && near > 1 + 1e-3) {
      steps.push(step('ratioDiv'));
      return result(steps, 'diverges', NaN, false, true);
    }
    steps.push(step('ratioNone'));
    return null;
  }
  const rootWindow = windowAt((n) => Math.exp(Math.log(b(n)) / n));
  if (!rootWindow) return null;
  const near = Math.max(...rootWindow);
  steps.push(step('root', undefined, { limit: tidy(near) }));
  if (near < 1 - 3e-2) {
    steps.push(step('rootConv'));
    return result(steps, 'converges', NaN, true);
  }
  if (near > 1 + 3e-2) {
    steps.push(step('rootDiv'));
    return result(steps, 'diverges', NaN, false, true);
  }
  steps.push(step('rootNone'));
  return null;
}

/** A power law: b_n behaves like C / n^p with p a multiple of 1/4. Then the p-series settles it. */
function powerLaw(b: Term, steps: KitStep[]): Positive | null {
  let p = NaN;
  for (let k = 16; k >= 5 && !Number.isFinite(p); k--) p = -Math.log(b(2 ** (k + 1)) / b(2 ** k)) / Math.LN2;
  const nearest = Math.round(p * 4) / 4;
  if (!Number.isFinite(p) || Math.abs(p - nearest) >= 2e-3) return null;
  const c = limitOf((n) => b(n) * n ** nearest);
  if (!(Number.isFinite(c) && c > 0)) return null;
  const exact = close(b(7) * 7 ** nearest, 1, 1e-12) && close(b(31) * 31 ** nearest, 1, 1e-12);
  if (exact) steps.push(step('pseries', `a_n=\frac{1}{n^{${fmt(nearest)}}}`, { p: fmt(nearest) }));
  else steps.push(step('compare', undefined, { p: fmt(nearest), limit: tidy(c) }));
  if (nearest > 1) {
    steps.push(step('pseriesConv', undefined, { p: fmt(nearest) }));
    return { ...result(steps, 'converges', nearest - 1), decay: nearest };
  }
  steps.push(step('pseriesDiv', undefined, { p: fmt(nearest) }));
  return { ...result(steps, 'diverges'), decay: nearest };
}

/** A power times a power of the logarithm: Bertrand's rule, or a p-series whose p is not a multiple of 1/4. */
function logLaw(b: Term, steps: KitStep[]): Positive | null {
  const fit = logPowerFit(b);
  if (!fit) return null;
  const pn = Math.round(fit.p * 4) / 4;
  const qn = Math.round(fit.q * 4) / 4;
  if (Math.abs(fit.q) < 2e-3 && Math.abs(fit.p - 1) > 5e-3) {
    const conv = fit.p > 1;
    steps.push(step(conv ? 'pseriesConv' : 'pseriesDiv', undefined, { p: fmt(Math.round(fit.p * 1000) / 1000) }));
    return result(steps, conv ? 'converges' : 'diverges');
  }
  if (Math.abs(fit.q - qn) < 5e-3 && Math.abs(fit.p - pn) < 5e-3) {
    const conv = pn > 1 || (pn === 1 && qn > 1);
    steps.push(step(conv ? 'bertrandConv' : 'bertrandDiv', undefined, { p: fmt(pn), q: fmt(qn) }));
    return result(steps, conv ? 'converges' : 'diverges');
  }
  return null;
}

/** The tests for a series of terms b_n = |a_n|. */
export function positive(b: Term, start: number, termText: string): Positive {
  const steps: KitStep[] = [];
  const nonzero = clearlyNonzero(b, start);
  if (!nonzero) steps.push(step('nthZero'));
  const early = geometric(b, start, steps) ?? ratioOrRoot(b, steps);
  if (early) return early;
  if (nonzero) {
    const limit = limitOf(b);
    steps.push(step('nthDiverge', undefined, { limit: Number.isFinite(limit) ? fmt(Math.max(0, limit), 6) : '∞' }));
    return result(steps, 'diverges', NaN, false, true);
  }
  // Sine and cosine only scale the term and are at most 1: compare with what is left.
  const bound = trigBound(termText, start);
  if (bound) {
    const inner = positive(bound, start, '');
    if (inner.verdict === 'converges') {
      steps.push(step('compareTrig'), ...inner.steps);
      return result(steps, 'converges');
    }
  }
  const late = powerLaw(b, steps) ?? logLaw(b, steps);
  if (late) return late;
  steps.push(step('noTest', undefined, { term: termText }));
  return result(steps, 'unknown');
}
