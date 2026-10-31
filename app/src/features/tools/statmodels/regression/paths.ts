// Moderation and mediation. Moderation fits y on x, the moderator m, and x·m, then probes the slope of x at chosen
// values of m and finds the Johnson-Neyman values where that slope turns significant. Mediation fits the a path (m
// on x) and the b and c' paths (y on x and m). It tests the indirect effect a·b with the Sobel z and a seeded
// percentile bootstrap.
import { normalTwoSided, tTwoSided } from '../kit/dist';
import { makeRng, resample } from '../kit/rng';
import type { Matrix } from '../kit/linalg';
import { fail } from '../kit/types';
import { fitOls, type OlsFit } from './ols';

export interface SimpleSlope {
  readonly at: number;
  readonly slope: number;
  readonly se: number;
  readonly t: number;
  readonly p: number;
  readonly low: number;
  readonly high: number;
}

export interface Moderation {
  readonly fit: OlsFit;
  readonly slopes: readonly SimpleSlope[];
  /** The values of the moderator where the slope of x is just significant, in order; empty when there are none. */
  readonly jn: readonly number[];
  /** Whether the slope is significant between the Johnson-Neyman values (true) or outside them (false). */
  readonly jnInside: boolean;
}

/** Columns: intercept, x, m, x·m, then covariates. */
export function moderation(
  y: readonly number[],
  x: readonly number[],
  m: readonly number[],
  covariates: readonly (readonly number[])[],
  covNames: readonly string[],
  probe: readonly number[],
  level: number,
): Moderation {
  const design: Matrix = y.map((_, i) => [1, x[i], m[i], x[i] * m[i], ...covariates.map((c) => c[i])]);
  const fit = fitOls(design, y, ['(Intercept)', 'x', 'm', 'x:m', ...covNames], { level });
  const [b1, b3] = [fit.coef[1], fit.coef[3]];
  const v = fit.cov;
  const slopes = probe.map((at) => {
    const slope = b1 + b3 * at;
    const se = Math.sqrt(v[1][1] + 2 * at * v[1][3] + at * at * v[3][3]);
    const t = slope / se;
    return { at, slope, se, t, p: tTwoSided(t, fit.df), low: slope - fit.tCrit * se, high: slope + fit.tCrit * se };
  });
  const t2 = fit.tCrit ** 2;
  const qa = b3 * b3 - t2 * v[3][3];
  const qb = 2 * (b1 * b3 - t2 * v[1][3]);
  const qc = b1 * b1 - t2 * v[1][1];
  const disc = qb * qb - 4 * qa * qc;
  const jn =
    disc < 0 || qa === 0
      ? []
      : [(-qb - Math.sqrt(disc)) / (2 * qa), (-qb + Math.sqrt(disc)) / (2 * qa)].sort((a, b) => a - b);
  return { fit, slopes, jn, jnInside: qa < 0 };
}

export interface Mediation {
  readonly a: number;
  readonly sa: number;
  readonly b: number;
  readonly sb: number;
  readonly c: number;
  readonly cPrime: number;
  readonly indirect: number;
  readonly sobelSe: number;
  readonly sobelZ: number;
  readonly sobelP: number;
  readonly bootLow: number;
  readonly bootHigh: number;
  readonly resamples: number;
  readonly paths: { readonly a: OlsFit; readonly b: OlsFit; readonly c: OlsFit };
}

/** The Sobel test of a·b from the two paths and their standard errors. */
export function sobel(a: number, sa: number, b: number, sb: number) {
  const se = Math.sqrt(b * b * sa * sa + a * a * sb * sb);
  const z = (a * b) / se;
  return { indirect: a * b, se, z, p: normalTwoSided(z) };
}

const quantileSorted = (s: readonly number[], q: number) => {
  const h = (s.length - 1) * q;
  const lo = Math.floor(h);
  return s[lo] + (h - lo) * ((s[lo + 1] ?? s[lo]) - s[lo]);
};

function pathFits(
  rows: readonly number[],
  data: { x: readonly number[]; m: readonly number[]; y: readonly number[]; cov: readonly (readonly number[])[] },
) {
  const covAt = (i: number) => data.cov.map((c) => c[i]);
  const names = data.cov.map((_, k) => `cov${k + 1}`);
  const aFit = fitOls(
    rows.map((i) => [1, data.x[i], ...covAt(i)]),
    rows.map((i) => data.m[i]),
    ['(Intercept)', 'x', ...names],
  );
  const bFit = fitOls(
    rows.map((i) => [1, data.x[i], data.m[i], ...covAt(i)]),
    rows.map((i) => data.y[i]),
    ['(Intercept)', 'x', 'm', ...names],
  );
  return { aFit, bFit };
}

export function mediation(
  x: readonly number[],
  m: readonly number[],
  y: readonly number[],
  cov: readonly (readonly number[])[],
  resamples: number,
  seed: number,
  level: number,
): Mediation {
  const n = y.length;
  if (n < 5) fail('tooFewRows', `${n}|4`);
  const all = y.map((_, i) => i);
  const { aFit, bFit } = pathFits(all, { x, m, y, cov });
  const cFit = fitOls(
    all.map((i) => [1, x[i], ...cov.map((c) => c[i])]),
    y,
    ['(Intercept)', 'x', ...cov.map((_, k) => `cov${k + 1}`)],
  );
  const s = sobel(aFit.coef[1], aFit.se[1], bFit.coef[2], bFit.se[2]);
  const rng = makeRng(seed);
  const draws: number[] = [];
  for (let r = 0; r < resamples; r += 1) {
    try {
      const { aFit: a, bFit: b } = pathFits(resample(n, rng), { x, m, y, cov });
      draws.push(a.coef[1] * b.coef[2]);
    } catch {
      // A resample with a constant column has no fit; it is left out, as bootstrap software does.
    }
  }
  draws.sort((p, q) => p - q);
  const alpha = (1 - level) / 2;
  return {
    a: aFit.coef[1],
    sa: aFit.se[1],
    b: bFit.coef[2],
    sb: bFit.se[2],
    c: cFit.coef[1],
    cPrime: bFit.coef[1],
    indirect: s.indirect,
    sobelSe: s.se,
    sobelZ: s.z,
    sobelP: s.p,
    bootLow: draws.length > 0 ? quantileSorted(draws, alpha) : NaN,
    bootHigh: draws.length > 0 ? quantileSorted(draws, 1 - alpha) : NaN,
    resamples: draws.length,
    paths: { a: aFit, b: bFit, c: cFit },
  };
}
