// Signal detection: sensitivity and bias from yes-no counts or rates, d' from proportion correct in m-alternative
// forced choice, and the ROC and z-ROC of a rating experiment with the unequal-variance measures d_a and Az.
import { brent, integrate, lineFit, normCdf, normPdf, normQuantile } from '../kit/num';
import { fail, notNegative, within, whole } from '../kit/types';

export type Correction = 'none' | 'loglinear' | 'half';

export interface Rates {
  readonly H: number;
  readonly F: number;
  readonly nSignal: number;
  readonly nNoise: number;
}

/** A rate from a count, with the chosen correction for rates of 0 or 1. */
export function rate(count: number, n: number, correction: Correction): number {
  if (correction === 'loglinear') return (count + 0.5) / (n + 1);
  const raw = count / n;
  if (correction === 'half') {
    if (raw === 0) return 1 / (2 * n);
    if (raw === 1) return 1 - 1 / (2 * n);
  }
  return raw;
}

/** The hit and false-alarm rates from the four counts. */
export function ratesFromCounts(hits: number, misses: number, fas: number, crs: number, correction: Correction): Rates {
  notNegative(hits, 'hits');
  notNegative(misses, 'misses');
  notNegative(fas, 'fas');
  notNegative(crs, 'crs');
  const nSignal = hits + misses;
  const nNoise = fas + crs;
  if (nSignal === 0) fail('noTrials', {}, 'hits');
  if (nNoise === 0) fail('noTrials', {}, 'fas');
  return { H: rate(hits, nSignal, correction), F: rate(fas, nNoise, correction), nSignal, nNoise };
}

export interface YesNo {
  readonly zH: number;
  readonly zF: number;
  readonly dPrime: number;
  readonly c: number;
  readonly lnBeta: number;
  readonly beta: number;
  /** The nonparametric sensitivity A' and bias B'' (Grier). */
  readonly aPrime: number;
  readonly bDouble: number;
}

/** A' for a hit rate H and false-alarm rate F, mirrored when H is below F. */
export function aPrime(H: number, F: number): number {
  if (H === F) return 0.5;
  if (H > F) return 0.5 + ((H - F) * (1 + H - F)) / (4 * H * (1 - F));
  return 0.5 - ((F - H) * (1 + F - H)) / (4 * F * (1 - H));
}

/** Grier's B''. It is not defined when both rates are 0 or 1. */
export function bDoublePrime(H: number, F: number): number {
  const h = H * (1 - H);
  const f = F * (1 - F);
  if (h + f === 0) return NaN;
  return H >= F ? (h - f) / (h + f) : (f - h) / (f + h);
}

/** d', c, beta, and the nonparametric measures from the two rates. */
export function yesNo(H: number, F: number): YesNo {
  within(H, 0, 1, 'hitRate');
  within(F, 0, 1, 'faRate');
  if (H === 0 || H === 1) fail('extremeRate', { rate: H }, 'hitRate');
  if (F === 0 || F === 1) fail('extremeRate', { rate: F }, 'faRate');
  const zH = normQuantile(H);
  const zF = normQuantile(F);
  const dPrime = zH - zF;
  const c = -(zH + zF) / 2;
  const lnBeta = dPrime * c;
  return { zH, zF, dPrime, c, lnBeta, beta: Math.exp(lnBeta), aPrime: aPrime(H, F), bDouble: bDoublePrime(H, F) };
}

/** Proportion correct in m-alternative forced choice for sensitivity d: the integral of phi(x - d) Phi(x)^(m-1). */
export function pcMafc(d: number, m: number): number {
  if (m === 2) return normCdf(d / Math.SQRT2);
  return integrate((x) => normPdf(x - d) * normCdf(x) ** (m - 1), d - 12, d + 12, 1e-14);
}

/** d' from proportion correct in m-alternative forced choice. */
export function dPrimeMafc(pc: number, m: number): number {
  whole(m, 2, 'm');
  within(pc, 0, 1, 'pc');
  if (pc === 1) fail('perfect', {}, 'pc');
  if (pc === 0) fail('extremeRate', { rate: 0 }, 'pc');
  if (m === 2) return Math.SQRT2 * normQuantile(pc);
  const d = brent((x) => pcMafc(x, m) - pc, -10, 15, 1e-12);
  if (Number.isNaN(d)) fail('noSolution', {}, 'pc');
  return d;
}

export interface RocPoint {
  readonly H: number;
  readonly F: number;
  readonly zH: number;
  readonly zF: number;
}

export interface Rating {
  readonly nSignal: number;
  readonly nNoise: number;
  readonly points: readonly RocPoint[];
  /** z(H) = intercept + slope z(F), by least squares; slope 1 when there is only one point. */
  readonly slope: number;
  readonly intercept: number;
  readonly r2: number;
  readonly dA: number;
  readonly Az: number;
  /** The area under the points joined by straight lines, from (0, 0) to (1, 1), before any correction. */
  readonly area: number;
}

/**
 * The ROC of a rating experiment. Categories run from surest "signal" to surest "noise"; each boundary between
 * them gives a cumulative hit and false-alarm pair. Pairs whose z values are infinite are left out of the fit.
 */
export function ratingRoc(signal: readonly number[], noise: readonly number[], correction: Correction): Rating {
  if (signal.length !== noise.length) fail('sameLength', {}, 'noise');
  if (signal.length < 2) fail('fewCategories', {}, 'signal');
  signal.forEach((v) => notNegative(v, 'signal'));
  noise.forEach((v) => notNegative(v, 'noise'));
  const nSignal = signal.reduce((s, v) => s + v, 0);
  const nNoise = noise.reduce((s, v) => s + v, 0);
  if (nSignal === 0) fail('noTrials', {}, 'signal');
  if (nNoise === 0) fail('noTrials', {}, 'noise');
  const raw: [number, number][] = [];
  const points: RocPoint[] = [];
  let s = 0;
  let n = 0;
  for (let k = 0; k < signal.length - 1; k += 1) {
    s += signal[k];
    n += noise[k];
    raw.push([n / nNoise, s / nSignal]);
    const H = rate(s, nSignal, correction);
    const F = rate(n, nNoise, correction);
    points.push({ H, F, zH: normQuantile(H), zF: normQuantile(F) });
  }
  const finite = points.filter((p) => Number.isFinite(p.zH) && Number.isFinite(p.zF));
  if (finite.length === 0) fail('extremeRate', { rate: points[0].H }, 'signal');
  const distinct = new Set(finite.map((p) => p.zF)).size;
  const fit =
    distinct >= 2
      ? lineFit(
          finite.map((p) => p.zF),
          finite.map((p) => p.zH),
        )
      : { slope: 1, intercept: finite[0].zH - finite[0].zF, r2: NaN };
  const dA = fit.intercept * Math.sqrt(2 / (1 + fit.slope * fit.slope));
  const curve = [[0, 0], ...raw.sort((a, b) => a[0] - b[0]), [1, 1]];
  let area = 0;
  for (let i = 1; i < curve.length; i += 1)
    area += ((curve[i][0] - curve[i - 1][0]) * (curve[i][1] + curve[i - 1][1])) / 2;
  return {
    nSignal,
    nNoise,
    points,
    slope: fit.slope,
    intercept: fit.intercept,
    r2: fit.r2,
    dA,
    Az: normCdf(dA / Math.SQRT2),
    area,
  };
}
