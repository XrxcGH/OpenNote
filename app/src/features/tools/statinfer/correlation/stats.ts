// The correlation tool's numbers: Pearson's r with its t test and Fisher-z interval, Spearman's rho, Kendall's
// tau-b, partial and semipartial correlations, and tests that compare two correlations.
import { kendallTieTerms, midRanks } from '../../subjects/stats/rank';
import {
  exactP,
  kendallDistribution,
  MAX_EXACT_KENDALL,
  MAX_EXACT_SPEARMAN,
  normalQuantile,
  normalSf,
  spearmanDistribution,
  tCdf,
  tSf,
} from '../../subjects/stats/dist';
import type { Alternative } from '../../subjects/stats/dist';
import { check } from '../report';

export interface Sums {
  readonly n: number;
  readonly mx: number;
  readonly my: number;
  readonly sxx: number;
  readonly syy: number;
  readonly sxy: number;
}

export function sums(x: readonly number[], y: readonly number[]): Sums {
  check(x.length === y.length, 'pairLength');
  check(x.length >= 3, 'tooFew', { min: '3' });
  check([...x, ...y].every(Number.isFinite), 'notNumber', { text: '—' });
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (let i = 0; i < n; i += 1) {
    sxx += (x[i] - mx) ** 2;
    syy += (y[i] - my) ** 2;
    sxy += (x[i] - mx) * (y[i] - my);
  }
  check(sxx > 0 && syy > 0, 'constant');
  return { n, mx, my, sxx, syy, sxy };
}

/** The p-value of a t statistic with df degrees of freedom. */
export function tP(t: number, df: number, alternative: Alternative): number {
  if (alternative === 'greater') return tSf(t, df);
  if (alternative === 'less') return tCdf(t, df);
  return Math.min(1, 2 * tSf(Math.abs(t), df));
}

export function zP(z: number, alternative: Alternative): number {
  if (alternative === 'greater') return normalSf(z);
  if (alternative === 'less') return normalSf(-z);
  return Math.min(1, 2 * normalSf(Math.abs(z)));
}

export interface Pearson {
  readonly s: Sums;
  readonly r: number;
  readonly t: number;
  readonly df: number;
  readonly p: number;
  readonly lower: number;
  readonly upper: number;
  readonly slope: number;
  readonly intercept: number;
}

/** Pearson's r = Sxy/√(Sxx Syy), its t test with n − 2 df, and the Fisher-z interval tanh(atanh r ± z/√(n − 3)). */
export function pearson(
  x: readonly number[],
  y: readonly number[],
  alternative: Alternative = 'two-sided',
  confidence = 0.95,
): Pearson {
  check(confidence > 0 && confidence < 1, 'confidenceRange');
  const s = sums(x, y);
  const r = Math.max(-1, Math.min(1, s.sxy / Math.sqrt(s.sxx * s.syy)));
  const df = s.n - 2;
  const t = Math.abs(r) === 1 ? Math.sign(r) * Number.POSITIVE_INFINITY : r * Math.sqrt(df / (1 - r * r));
  const half = s.n > 3 ? normalQuantile(1 - (1 - confidence) / 2) / Math.sqrt(s.n - 3) : Number.NaN;
  const z = Math.atanh(r);
  const slope = s.sxy / s.sxx;
  return {
    s,
    r,
    t,
    df,
    p: tP(t, df, alternative),
    lower: Math.tanh(z - half),
    upper: Math.tanh(z + half),
    slope,
    intercept: s.my - slope * s.mx,
  };
}

export interface Spearman {
  readonly rho: number;
  readonly p: number;
  readonly exact: boolean;
  readonly d2: number;
  readonly ties: boolean;
}

/** Spearman's rho, the Pearson r of the mid-ranks; exact p from every order when n ≤ 9 and nothing is tied. */
export function spearman(x: readonly number[], y: readonly number[], alternative: Alternative = 'two-sided'): Spearman {
  sums(x, y);
  const rx = midRanks(x);
  const ry = midRanks(y);
  const rho = pearson(rx.ranks, ry.ranks).r;
  const n = x.length;
  const d2 = rx.ranks.reduce((s, r, i) => s + (r - ry.ranks[i]) ** 2, 0);
  const ties = rx.ties.length > 0 || ry.ties.length > 0;
  if (!ties && n <= MAX_EXACT_SPEARMAN) {
    // A large D goes with a small rho, so the tails swap.
    const flipped = alternative === 'greater' ? 'less' : alternative === 'less' ? 'greater' : alternative;
    return { rho, p: exactP(spearmanDistribution(n), Math.round(d2), flipped), exact: true, d2, ties };
  }
  const t =
    Math.abs(rho) === 1 ? Math.sign(rho) * Number.POSITIVE_INFINITY : rho * Math.sqrt((n - 2) / (1 - rho * rho));
  return { rho, p: tP(t, n - 2, alternative), exact: false, d2, ties };
}

export interface Kendall {
  readonly tau: number;
  readonly concordant: number;
  readonly discordant: number;
  readonly z: number;
  readonly p: number;
  readonly exact: boolean;
}

/** Kendall's tau-b = (C − D)/√((n₀ − n₁)(n₀ − n₂)); exact p from the inversion count when nothing is tied. */
export function kendall(x: readonly number[], y: readonly number[], alternative: Alternative = 'two-sided'): Kendall {
  sums(x, y);
  const n = x.length;
  let concordant = 0;
  let discordant = 0;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      const s = Math.sign(x[i] - x[j]) * Math.sign(y[i] - y[j]);
      if (s > 0) concordant += 1;
      else if (s < 0) discordant += 1;
    }
  }
  const tx = midRanks(x).ties;
  const ty = midRanks(y).ties;
  const n0 = (n * (n - 1)) / 2;
  const n1 = tx.reduce((s, t) => s + (t * (t - 1)) / 2, 0);
  const n2 = ty.reduce((s, t) => s + (t * (t - 1)) / 2, 0);
  const tau = (concordant - discordant) / Math.sqrt((n0 - n1) * (n0 - n2));
  const S = concordant - discordant;
  if (tx.length === 0 && ty.length === 0 && n <= MAX_EXACT_KENDALL) {
    // With no ties, the number of discordant pairs is the number of inversions.
    const flipped = alternative === 'greater' ? 'less' : alternative === 'less' ? 'greater' : alternative;
    return {
      tau,
      concordant,
      discordant,
      z: Number.NaN,
      p: exactP(kendallDistribution(n), discordant, flipped),
      exact: true,
    };
  }
  const a = kendallTieTerms(tx);
  const b = kendallTieTerms(ty);
  const variance =
    (n * (n - 1) * (2 * n + 5) - a.v0 - b.v0) / 18 +
    (a.v1 * b.v1) / (9 * n * (n - 1) * (n - 2)) +
    (a.v2 * b.v2) / (2 * n * (n - 1));
  const z = S / Math.sqrt(variance);
  return { tau, concordant, discordant, z, p: zP(z, alternative), exact: false };
}

export interface Partial {
  readonly partial: number;
  readonly semipartial: number;
  readonly t: number;
  readonly df: number;
  readonly p: number;
}

/**
 * The correlation of x and y with z held fixed, r = (r_xy − r_xz r_yz)/√((1 − r_xz²)(1 − r_yz²)), and the
 * semipartial (z taken out of y only), with the t test on n − 3 df when n is known.
 */
export function partial(rxy: number, rxz: number, ryz: number, n: number | null): Partial {
  for (const r of [rxy, rxz, ryz]) check(Number.isFinite(r) && r >= -1 && r <= 1, 'correlationRange');
  check(Math.abs(rxz) < 1 && Math.abs(ryz) < 1, 'controlPerfect');
  const det = 1 - rxy * rxy - rxz * rxz - ryz * ryz + 2 * rxy * rxz * ryz;
  check(det >= -1e-12, 'notPositive');
  const value = (rxy - rxz * ryz) / Math.sqrt((1 - rxz * rxz) * (1 - ryz * ryz));
  const semipartial = (rxy - rxz * ryz) / Math.sqrt(1 - ryz * ryz);
  if (n === null) return { partial: value, semipartial, t: Number.NaN, df: Number.NaN, p: Number.NaN };
  check(Number.isInteger(n) && n >= 4, 'tooFew', { min: '4' });
  const df = n - 3;
  const t = value * Math.sqrt(df / (1 - value * value));
  return { partial: value, semipartial, t, df, p: tP(t, df, 'two-sided') };
}

export interface Comparison {
  readonly z: number;
  readonly p: number;
}

/** Two correlations from independent samples: z = (atanh r₁ − atanh r₂)/√(1/(n₁ − 3) + 1/(n₂ − 3)). */
export function compareIndependent(r1: number, n1: number, r2: number, n2: number): Comparison {
  for (const r of [r1, r2]) check(Number.isFinite(r) && r > -1 && r < 1, 'correlationOpen');
  for (const n of [n1, n2]) check(Number.isInteger(n) && n >= 4, 'tooFew', { min: '4' });
  const z = (Math.atanh(r1) - Math.atanh(r2)) / Math.sqrt(1 / (n1 - 3) + 1 / (n2 - 3));
  return { z, p: zP(z, 'two-sided') };
}

/**
 * Two dependent correlations that share a variable, r₁₂ and r₁₃, in one sample of n, by Steiger's (1980) Z with
 * the pooled r̄ in the covariance of the two z-transforms.
 */
export function compareDependent(r12: number, r13: number, r23: number, n: number): Comparison {
  for (const r of [r12, r13, r23]) check(Number.isFinite(r) && r > -1 && r < 1, 'correlationOpen');
  check(Number.isInteger(n) && n >= 4, 'tooFew', { min: '4' });
  const det = 1 - r12 * r12 - r13 * r13 - r23 * r23 + 2 * r12 * r13 * r23;
  check(det >= -1e-12, 'notPositive');
  const rbar = (r12 + r13) / 2;
  const psi = r23 * (1 - 2 * rbar * rbar) - 0.5 * rbar * rbar * (1 - 2 * rbar * rbar - r23 * r23);
  const sbar = psi / (1 - rbar * rbar) ** 2;
  const z = ((Math.atanh(r12) - Math.atanh(r13)) * Math.sqrt(n - 3)) / Math.sqrt(2 - 2 * sbar);
  return { z, p: zP(z, 'two-sided') };
}
