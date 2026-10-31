// Agreement on categories: the cross-tabulation of 2 coders, percent agreement, Cohen's kappa with its standard
// error, Scott's pi, the prevalence- and bias-adjusted kappa, weighted kappa for ordered categories, and Fleiss'
// kappa for many raters. Other tools in this lane (observation and qualitative coding) use these too.
import { normCdf } from '../kit/num';
import { fail, notNegative } from '../kit/types';

export type Weights = 'none' | 'linear' | 'quadratic';

export interface CrossTab {
  readonly categories: readonly string[];
  /** Rows are coder 1's categories, columns coder 2's. */
  readonly counts: readonly (readonly number[])[];
}

const numeric = (values: readonly string[]) => values.every((v) => v.trim() !== '' && Number.isFinite(Number(v)));

/**
 * The cross-tabulation of 2 coders' codes for the same units. Categories follow `order` when it is given, else
 * numeric order when every code is a number, else the order they first appear in.
 */
export function crossTab(first: readonly string[], second: readonly string[], order: readonly string[] = []): CrossTab {
  if (first.length !== second.length) fail('sameLength', {}, 'codes');
  if (first.length === 0) fail('empty', {}, 'codes');
  const seen = [...new Set([...first, ...second])];
  const rest = seen.filter((code) => !order.includes(code));
  if (order.length > 0 && rest.length > 0) fail('notInOrder', { code: rest[0] }, 'order');
  const categories =
    order.length > 0 ? [...order] : numeric(seen) ? [...seen].sort((a, b) => Number(a) - Number(b)) : seen;
  const counts = categories.map(() => categories.map(() => 0));
  first.forEach((code, i) => {
    counts[categories.indexOf(code)][categories.indexOf(second[i])] += 1;
  });
  return { categories, counts };
}

/** Agreement weights: 1 on the diagonal, falling to 0 for the farthest categories. */
export function weight(i: number, j: number, k: number, weights: Weights): number {
  if (weights === 'none' || k < 2) return i === j ? 1 : 0;
  const d = Math.abs(i - j) / (k - 1);
  return weights === 'linear' ? 1 - d : 1 - d * d;
}

export interface Kappa {
  readonly n: number;
  readonly po: number;
  readonly pe: number;
  readonly kappa: number;
  /** The large-sample standard error (Fleiss, Cohen, and Everitt 1969), for the interval. */
  readonly se: number;
  readonly low: number;
  readonly high: number;
  /** The standard error when kappa is 0, for the z test. */
  readonly se0: number;
  readonly z: number;
  readonly p: number;
  readonly scottPi: number;
  readonly pabak: number;
  readonly rows: readonly number[];
  readonly cols: readonly number[];
}

function checkSquare(counts: readonly (readonly number[])[]): number {
  const k = counts.length;
  if (k < 2) fail('fewCategories', {}, 'matrix');
  counts.forEach((row) => {
    if (row.length !== k) fail('square', {}, 'matrix');
    row.forEach((v) => notNegative(v, 'matrix'));
  });
  const n = counts.flat().reduce((s, v) => s + v, 0);
  if (n === 0) fail('noTrials', {}, 'matrix');
  return n;
}

/** Cohen's kappa and its companions from a square table of counts. */
export function cohen(counts: readonly (readonly number[])[]): Kappa {
  const n = checkSquare(counts);
  const k = counts.length;
  const p = counts.map((row) => row.map((v) => v / n));
  const rows = p.map((row) => row.reduce((s, v) => s + v, 0));
  const cols = p[0].map((_, j) => p.reduce((s, row) => s + row[j], 0));
  const po = p.reduce((s, row, i) => s + row[i], 0);
  const pe = rows.reduce((s, r, i) => s + r * cols[i], 0);
  const kappa = pe === 1 ? NaN : (po - pe) / (1 - pe);
  let diag = 0;
  let off = 0;
  for (let i = 0; i < k; i += 1)
    for (let j = 0; j < k; j += 1) {
      if (i === j) diag += p[i][i] * (1 - (rows[i] + cols[i]) * (1 - kappa)) ** 2;
      else off += p[i][j] * (cols[i] + rows[j]) ** 2;
    }
  const variance = (diag + (1 - kappa) ** 2 * off - (kappa - pe * (1 - kappa)) ** 2) / (n * (1 - pe) ** 2);
  const se = Math.sqrt(Math.max(0, variance));
  const spread = rows.reduce((s, r, i) => s + r * cols[i] * (r + cols[i]), 0);
  const se0 = Math.sqrt(Math.max(0, pe + pe * pe - spread)) / ((1 - pe) * Math.sqrt(n));
  const z = kappa / se0;
  const pooled = rows.reduce((s, r, i) => s + ((r + cols[i]) / 2) ** 2, 0);
  return {
    n,
    po,
    pe,
    kappa,
    se,
    // Kappa lies in [-1, 1], so the normal interval is truncated at those bounds.
    low: Math.max(-1, kappa - 1.959963984540054 * se),
    high: Math.min(1, kappa + 1.959963984540054 * se),
    se0,
    z,
    p: 2 * (1 - normCdf(Math.abs(z))),
    scottPi: (po - pooled) / (1 - pooled),
    pabak: (k * po - 1) / (k - 1),
    rows,
    cols,
  };
}

export interface Weighted {
  readonly pow: number;
  readonly pew: number;
  readonly kappa: number;
}

/** Weighted kappa for ordered categories, with linear or quadratic agreement weights. */
export function weightedKappa(counts: readonly (readonly number[])[], weights: Weights): Weighted {
  const n = checkSquare(counts);
  const k = counts.length;
  const p = counts.map((row) => row.map((v) => v / n));
  const rows = p.map((row) => row.reduce((s, v) => s + v, 0));
  const cols = p[0].map((_, j) => p.reduce((s, row) => s + row[j], 0));
  let pow = 0;
  let pew = 0;
  for (let i = 0; i < k; i += 1)
    for (let j = 0; j < k; j += 1) {
      pow += weight(i, j, k, weights) * p[i][j];
      pew += weight(i, j, k, weights) * rows[i] * cols[j];
    }
  return { pow, pew, kappa: (pow - pew) / (1 - pew) };
}

export interface Fleiss {
  readonly subjects: number;
  readonly raters: number;
  readonly pBar: number;
  readonly peBar: number;
  readonly kappa: number;
  readonly se0: number;
  readonly z: number;
  readonly p: number;
  /** Each category's share of all ratings and its own kappa. */
  readonly shares: readonly number[];
  readonly perCategory: readonly number[];
  /** Each subject's agreement P_i. */
  readonly perSubject: readonly number[];
}

/** Fleiss' kappa from a subjects-by-categories table of how many raters chose each category. */
export function fleiss(counts: readonly (readonly number[])[]): Fleiss {
  if (counts.length < 2) fail('fewSubjects', {}, 'counts');
  const k = counts[0].length;
  if (k < 2) fail('fewCategories', {}, 'counts');
  counts.forEach((row) => row.forEach((v) => notNegative(v, 'counts')));
  const n = counts[0].reduce((s, v) => s + v, 0);
  if (counts.some((row) => row.reduce((s, v) => s + v, 0) !== n)) fail('sameRaters', {}, 'counts');
  if (n < 2) fail('fewRaters', {}, 'counts');
  const N = counts.length;
  const perSubject = counts.map((row) => (row.reduce((s, v) => s + v * v, 0) - n) / (n * (n - 1)));
  const shares = counts[0].map((_, j) => counts.reduce((s, row) => s + row[j], 0) / (N * n));
  const pBar = perSubject.reduce((s, v) => s + v, 0) / N;
  const peBar = shares.reduce((s, v) => s + v * v, 0);
  const kappa = (pBar - peBar) / (1 - peBar);
  const perCategory = shares.map((pj, j) => {
    const spread = counts.reduce((s, row) => s + row[j] * (n - row[j]), 0);
    return 1 - spread / (N * n * (n - 1) * pj * (1 - pj));
  });
  const pq = shares.reduce((s, pj) => s + pj * (1 - pj), 0);
  const tilt = shares.reduce((s, pj) => s + pj * (1 - pj) * (1 - 2 * pj), 0);
  const se0 = (Math.SQRT2 / (pq * Math.sqrt(N * n * (n - 1)))) * Math.sqrt(Math.max(0, pq * pq - tilt));
  const z = kappa / se0;
  return {
    subjects: N,
    raters: n,
    pBar,
    peBar,
    kappa,
    se0,
    z,
    p: 2 * (1 - normCdf(Math.abs(z))),
    shares,
    perCategory,
    perSubject,
  };
}

/** The Landis and Koch (1977) words for a kappa, a convention rather than a test. */
export function landisKoch(kappa: number): string {
  if (Number.isNaN(kappa)) return 'none';
  if (kappa < 0) return 'poor';
  if (kappa <= 0.2) return 'slight';
  if (kappa <= 0.4) return 'fair';
  if (kappa <= 0.6) return 'moderate';
  if (kappa <= 0.8) return 'substantial';
  return 'almostPerfect';
}

/** Kappa for one code that each of 2 coders applied or did not apply to each unit. */
export function presenceKappa(first: readonly boolean[], second: readonly boolean[]): { agree: number; kappa: number } {
  const yes = (v: boolean) => (v ? 'yes' : 'no');
  const table = crossTab(first.map(yes), second.map(yes), ['yes', 'no']);
  const n = first.length;
  const agree = (table.counts[0][0] + table.counts[1][1]) / n;
  const rows = table.counts.map((row) => (row[0] + row[1]) / n);
  const cols = [0, 1].map((j) => (table.counts[0][j] + table.counts[1][j]) / n);
  const pe = rows[0] * cols[0] + rows[1] * cols[1];
  return { agree, kappa: pe === 1 ? NaN : (agree - pe) / (1 - pe) };
}
