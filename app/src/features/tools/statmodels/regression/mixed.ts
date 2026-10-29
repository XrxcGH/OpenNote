// A linear mixed model with one random intercept, y = Xβ + u_g + e, fitted by REML. For a variance ratio
// λ = σ²_u / σ²_e, each group's covariance is I + λJ, whose inverse and determinant have closed forms, so β and σ²_e
// follow by generalized least squares. The restricted log likelihood is then maximized over λ by golden-section
// search on a log scale, with λ = 0 checked at the boundary.
import { tQuantile, tTwoSided } from '../kit/dist';
import { inverse, zeros, type Matrix } from '../kit/linalg';
import { fail } from '../kit/types';

export interface MixedFit {
  readonly coef: readonly number[];
  readonly se: readonly number[];
  readonly t: readonly number[];
  readonly p: readonly number[];
  readonly low: readonly number[];
  readonly high: readonly number[];
  readonly sigma2: number;
  readonly tau2: number;
  readonly icc: number;
  readonly reml: number;
  readonly groups: number;
  /** The variance ratio σ²_u / σ²_e at the estimate. */
  readonly lambda: number;
}

interface Gls {
  readonly coef: number[];
  readonly cov: Matrix;
  readonly sigma2: number;
  readonly reml: number;
}

function gls(x: Matrix, y: readonly number[], groups: readonly number[][], lambda: number): Gls | null {
  const p = x[0].length;
  const n = y.length;
  const xvx = zeros(p, p);
  const xvy = new Array<number>(p).fill(0);
  let logDet = 0;
  // V_g^-1 = I − c J with c = λ / (1 + λ n_g), applied to each group's rows.
  const apply = (rows: number[], c: number, accumulate: (u: number[], ui: number, i: number) => void) => {
    const sumX = new Array<number>(p).fill(0);
    let sumY = 0;
    for (const i of rows) {
      for (let a = 0; a < p; a += 1) sumX[a] += x[i][a];
      sumY += y[i];
    }
    for (const i of rows) accumulate(x[i].map((v, a) => v - c * sumX[a]), y[i] - c * sumY, i);
  };
  for (const rows of groups) {
    const c = lambda / (1 + lambda * rows.length);
    logDet += Math.log(1 + lambda * rows.length);
    apply(rows, c, (u, uy, i) => {
      for (let a = 0; a < p; a += 1) {
        xvy[a] += x[i][a] * uy;
        for (let b = 0; b < p; b += 1) xvx[a][b] += x[i][a] * u[b];
      }
    });
  }
  const inv = inverse(xvx);
  if (!inv) return null;
  const coef = inv.map((row) => row.reduce((s, v, b) => s + v * xvy[b], 0));
  let quad = 0;
  for (const rows of groups) {
    const c = lambda / (1 + lambda * rows.length);
    const r = rows.map((i) => y[i] - x[i].reduce((s, v, a) => s + v * coef[a], 0));
    const sum = r.reduce((s, v) => s + v, 0);
    quad += r.reduce((s, v) => s + v * v, 0) - c * sum * sum;
  }
  const sigma2 = quad / (n - p);
  const detX = Math.log(Math.abs(determinant(xvx)));
  const reml = -0.5 * ((n - p) * Math.log(sigma2) + logDet + detX + (n - p));
  return { coef, cov: inv.map((row) => row.map((v) => v * sigma2)), sigma2, reml };
}

function determinant(a: Matrix): number {
  const m = a.map((row) => [...row]);
  let det = 1;
  for (let c = 0; c < m.length; c += 1) {
    let pivot = c;
    for (let r = c + 1; r < m.length; r += 1) if (Math.abs(m[r][c]) > Math.abs(m[pivot][c])) pivot = r;
    if (m[pivot][c] === 0) return 0;
    if (pivot !== c) {
      [m[c], m[pivot]] = [m[pivot], m[c]];
      det = -det;
    }
    det *= m[c][c];
    for (let r = c + 1; r < m.length; r += 1) {
      const f = m[r][c] / m[c][c];
      for (let k = c; k < m.length; k += 1) m[r][k] -= f * m[c][k];
    }
  }
  return det;
}

export function fitMixed(x: Matrix, y: readonly number[], group: readonly string[], level = 0.95): MixedFit {
  const names = [...new Set(group)];
  if (names.length < 2) fail('mixedGroups');
  const groups = names.map((g) => group.map((h, i) => (h === g ? i : -1)).filter((i) => i >= 0));
  const n = y.length;
  const p = x[0].length;
  if (n <= p + 1) fail('tooFewRows', `${n}|${p + 1}`);
  const at = (logLambda: number) => gls(x, y, groups, Math.exp(logLambda))?.reml ?? -Infinity;
  let lo = -20;
  let hi = 12;
  const g = (Math.sqrt(5) - 1) / 2;
  let c = hi - g * (hi - lo);
  let d = lo + g * (hi - lo);
  for (let i = 0; i < 200 && hi - lo > 1e-10; i += 1) {
    if (at(c) > at(d)) hi = d;
    else lo = c;
    c = hi - g * (hi - lo);
    d = lo + g * (hi - lo);
  }
  const best = gls(x, y, groups, Math.exp((lo + hi) / 2));
  const zero = gls(x, y, groups, 0);
  const fit = zero && (!best || zero.reml >= best.reml) ? { ...zero, lambda: 0 } : best ? { ...best, lambda: Math.exp((lo + hi) / 2) } : null;
  if (!fit) fail('singularDesign');
  const se = fit.coef.map((_, a) => Math.sqrt(fit.cov[a][a]));
  const tCrit = tQuantile(1 - (1 - level) / 2, n - p);
  const t = fit.coef.map((b, a) => b / se[a]);
  const tau2 = fit.lambda * fit.sigma2;
  return {
    coef: fit.coef,
    se,
    t,
    p: t.map((v) => tTwoSided(v, n - p)),
    low: fit.coef.map((b, a) => b - tCrit * se[a]),
    high: fit.coef.map((b, a) => b + tCrit * se[a]),
    sigma2: fit.sigma2,
    tau2,
    icc: tau2 / (tau2 + fit.sigma2),
    reml: fit.reml,
    groups: names.length,
    lambda: fit.lambda,
  };
}
