// Series and convergence: which tests apply to a series, what each one says, the verdict, and the sum when it can
// be found. Limits are estimated by Richardson extrapolation of the terms at large n, and the answer says so: a
// limit is shown to a few digits, never as a proof. A power series gets its radius from the ratio of coefficients
// and its endpoints are fed back through the same tests.
import { readFunction } from '../expr';
import { limitOf, positive, tidy, type Positive, type Term } from './positive';
import { close, closedForm, fmt, toFraction } from '../numeric';
import { KitError, step, type KitStep } from '../types';

export type Verdict = 'absolute' | 'conditional' | 'diverges' | 'unknown';

export interface SeriesResult {
  verdict: Verdict;
  steps: KitStep[];
  /** The sum, when the tests found one. */
  sum: number | null;
  sumLatex: string | null;
  /** Partial sums for a plot. */
  partial: [number, number][];
}

function alternates(a: Term, start: number): boolean {
  let last = 0;
  for (let n = start; n < start + 12; n++) {
    const value = a(n);
    if (!Number.isFinite(value) || value === 0) return false;
    const sign = Math.sign(value);
    if (last !== 0 && sign === last) return false;
    last = sign;
  }
  return true;
}

/** Richardson extrapolation of partial sums that miss by about N^-q, q+1, q+2, ... */
function extrapolate(sums: (n: number) => number, q: number, from = 256): number {
  let row = [sums(from), sums(from * 2), sums(from * 4), sums(from * 8)];
  let level = 0;
  while (row.length > 1) {
    const f = 2 ** (q + level);
    const previous = row;
    row = previous.slice(1).map((v, i) => (f * v - previous[i]) / (f - 1));
    level++;
  }
  return row[0];
}

function sumOf(a: Term, start: number, info: Positive, alternating: boolean): number | null {
  const partial = (n: number) => {
    let total = 0;
    for (let k = start; k < start + n; k++) total += a(k);
    return total;
  };
  if (info.fast) {
    let total = 0;
    for (let k = start; k < start + 20000; k++) {
      const term = a(k);
      total += term;
      if (k > start + 5 && Math.abs(term) < 1e-18 * Math.max(1, Math.abs(total))) break;
    }
    return Number.isFinite(total) ? total : null;
  }
  if (alternating) {
    const averaged = (n: number) => (partial(n) + partial(n + 1)) / 2;
    // The error of the averaged sums is known only for a plain power law.
    return Number.isFinite(info.decay) ? extrapolate(averaged, info.decay! + 1, 128) : null;
  }
  if (!Number.isFinite(info.power)) return null;
  return extrapolate(partial, info.power);
}

/** The tests for the series of `term` (a function of n) from n = start. */
export function analyzeSeries(termText: string, start = 1): SeriesResult {
  if (!Number.isInteger(start) || Math.abs(start) > 1e6) throw new KitError('badStart');
  const fn = readFunction(termText, ['n']);
  const a: Term = (n) => fn([n]);
  if (![start, start + 1, start + 2].every((n) => Number.isFinite(a(n)))) throw new KitError('undefinedTerm', termText);
  const steps: KitStep[] = [
    step('series', `\\sum_{n=${start}}^{\\infty} ${termText}`, { term: termText, start: String(start) }),
  ];
  const partial: [number, number][] = [];
  let total = 0;
  for (let k = start; k < start + 40; k++) {
    total += a(k);
    partial.push([k, total]);
  }
  const abs: Term = (n) => Math.abs(a(n));
  const alt = alternates(a, start);
  const inner = positive(abs, start, termText);
  const finish = (verdict: Verdict, sum: number | null): SeriesResult => ({
    verdict,
    steps,
    sum,
    sumLatex: sum === null ? null : closedForm(sum),
    partial,
  });
  if (alt) steps.push(step('alternating'));
  steps.push(...inner.steps);
  if (inner.verdict === 'converges') {
    steps.push(step('absConv'));
    const sum = sumOf(a, start, inner, alt);
    if (sum !== null) steps.push(step('sum', undefined, { sum: fmt(sum, 10) }));
    return finish('absolute', sum);
  }
  if (alt) {
    // Alternating series test on b_n = |a_n|.
    let decreasing = true;
    for (let n = start; n < start + 400; n++) if (abs(n + 1) > abs(n) * (1 + 1e-12)) decreasing = false;
    // Falling toward 0: b(1e6) < b(1e3) < b(start + 10), the far terms still shrinking, and no clear nonzero limit.
    const [near, mid, far, farther] = [start + 10, 1e3, 1e6, 1e9].map(abs);
    const vanishes = !inner.nonzero && far < mid && mid < near && farther < far;
    if (decreasing && vanishes) {
      steps.push(step('altTest'));
      steps.push(step('altBound', undefined, { n: '10', bound: fmt(abs(start + 10), 6) }));
      if (inner.verdict === 'diverges') steps.push(step('absDiv'));
      else steps.push(step('absUnknown'));
      const sum = sumOf(a, start, inner, true);
      if (sum !== null) steps.push(step('sum', undefined, { sum: fmt(sum, 10) }));
      return finish(inner.verdict === 'diverges' ? 'conditional' : 'unknown', sum);
    }
    steps.push(step('altFail'));
    return finish(inner.verdict === 'diverges' && !vanishes ? 'diverges' : 'unknown', null);
  }
  return finish(inner.verdict === 'diverges' ? 'diverges' : 'unknown', null);
}

export interface PowerResult {
  /** Infinity when the series converges everywhere, 0 when it converges only at the center. */
  radius: number;
  interval: string;
  intervalLatex: string;
  ends: { x: number; verdict: Verdict }[];
  steps: KitStep[];
}

/** The term as a function of n and x about a center: it must be c_n (x - center)^n. */
export function analyzePowerSeries(termText: string, centerText = '0', start = 0): PowerResult {
  const fn = readFunction(termText, ['n', 'x']);
  const center = readFunction(centerText, [])([]);
  if (!Number.isFinite(center)) throw new KitError('unreadable', centerText);
  const coefficient: Term = (n) => fn([n, center + 1]);
  for (const n of [start + 2, start + 5, start + 9]) {
    const c = coefficient(n);
    const at = fn([n, center + 2]);
    if (!Number.isFinite(c) || !close(at, c * 2 ** n, 1e-9)) throw new KitError('notPowerSeries', termText);
  }
  const steps: KitStep[] = [step('psSeries', `\\sum_{n=${start}}^{\\infty} ${termText}`, { center: fmt(center, 8) })];
  const quotient = limitOf((n) => Math.abs(coefficient(n + 1) / coefficient(n)));
  if (!Number.isFinite(quotient) && quotient !== Infinity) throw new KitError('noRadius', termText);
  const radius = quotient === Infinity ? 0 : quotient < 1e-5 ? Infinity : 1 / quotient;
  const shown = Number.isFinite(radius) ? tidy(radius) : radius === 0 ? '0' : '∞';
  steps.push(
    step('psRatio', `R=\\frac{1}{\\lim|c_{n+1}/c_n|}=${radius === Infinity ? '\\infty' : fmt(radius, 8)}`, {
      radius: shown,
    }),
  );
  if (radius === Infinity) {
    steps.push(step('psEverywhere'));
    return { radius, interval: '(−∞, ∞)', intervalLatex: '(-\\infty,\\infty)', ends: [], steps };
  }
  if (radius === 0) {
    steps.push(step('psCenterOnly', undefined, { center: fmt(center, 8) }));
    return { radius, interval: `{${fmt(center, 8)}}`, intervalLatex: `\\{${fmt(center, 8)}\\}`, ends: [], steps };
  }
  const clean = toFraction(radius, 24, 1e-5);
  const R = clean ? clean[0] / clean[1] : radius;
  steps.push(step('psInside', undefined, { center: fmt(center, 8), radius: fmt(R, 8) }));
  const ends: PowerResult['ends'] = [];
  for (const x of [center - R, center + R]) {
    const at = analyzeSeries(termText.replace(/\bx\b/g, `(${x})`), start);
    ends.push({ x, verdict: at.verdict });
    const key =
      at.verdict === 'absolute'
        ? 'psEndAbs'
        : at.verdict === 'conditional'
          ? 'psEndCond'
          : at.verdict === 'diverges'
            ? 'psEndDiv'
            : 'psEndUnknown';
    steps.push(step(key, undefined, { x: fmt(x, 8) }));
  }
  const inside = (v: Verdict) => v === 'absolute' || v === 'conditional';
  const lo = inside(ends[0].verdict);
  const hi = inside(ends[1].verdict);
  const interval = `${lo ? '[' : '('}${fmt(center - R, 8)}, ${fmt(center + R, 8)}${hi ? ']' : ')'}`;
  const intervalLatex = interval.replace(/−/g, '-').replace(', ', ',');
  steps.push(step('psInterval', `x\\in ${intervalLatex}`, { interval }));
  return { radius: R, interval, intervalLatex, ends, steps };
}
