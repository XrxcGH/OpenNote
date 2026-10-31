// Forecasting models. Exponential smoothing updates a level (and a trend and a season for Holt and Holt-Winters):
// l_t = α y_t + (1 − α) l_{t−1} for simple smoothing. Parameters left blank are chosen by least squares on the
// one-step errors, with the Nelder-Mead minimizer. AR(p) is fitted by Yule-Walker or least squares, and ARIMA(p, d, q)
// by conditional sum of squares. Forecast intervals use the ψ weights of the fitted model.
import { normalQuantile } from '../kit/dist';
import { inverse, leastSquares, matMul, mean, solve, transpose, type Matrix } from '../kit/linalg';
import { nelderMead } from '../kit/optimize';
import { fail } from '../kit/types';
import { acf, difference } from './engine';

const sum = (xs: readonly number[]) => xs.reduce((s, v) => s + v, 0);
const logistic = (v: number) => 1 / (1 + Math.exp(-v));
const logit = (p: number) => Math.log(p / (1 - p));

export type SmoothingMethod = 'ses' | 'holt' | 'hwadd' | 'hwmult';

export interface SmoothingParams {
  readonly alpha: number;
  readonly beta: number;
  readonly gamma: number;
}

export interface Smoothed {
  readonly params: SmoothingParams;
  /** The one-step forecast made for each time, from the values before it. */
  readonly fitted: number[];
  readonly level: number[];
  readonly trend: number[];
  readonly sse: number;
  readonly sigma: number;
  readonly forecast: number[];
  readonly low: number[];
  readonly high: number[];
  readonly estimated: readonly ('alpha' | 'beta' | 'gamma')[];
}

/** Runs the recursions with fixed parameters, from the textbook starting values. */
export function smoothRun(y: readonly number[], method: SmoothingMethod, p: SmoothingParams, period: number) {
  const n = y.length;
  const seasonal = method === 'hwadd' || method === 'hwmult';
  const mult = method === 'hwmult';
  let l: number;
  let b = 0;
  let s: number[] = [];
  let start = 1;
  if (seasonal) {
    if (n < 2 * period) fail('shortSeries', String(2 * period));
    if (mult && y.some((v) => v <= 0)) fail('logPositive', 'the series');
    const first = mean(y.slice(0, period));
    const second = mean(y.slice(period, 2 * period));
    l = first;
    b = (second - first) / period;
    s = y.slice(0, period).map((v) => (mult ? v / first : v - first));
    start = period;
  } else {
    l = y[0];
    if (method === 'holt') b = y[1] - y[0];
  }
  const fitted = new Array<number>(n).fill(NaN);
  const level = new Array<number>(n).fill(NaN);
  const trend = new Array<number>(n).fill(NaN);
  level[start - 1] = l;
  trend[start - 1] = b;
  let sse = 0;
  for (let t = start; t < n; t++) {
    const season = seasonal ? s[t % period] : mult ? 1 : 0;
    const f = mult ? (l + b) * season : l + b + (seasonal ? season : 0);
    fitted[t] = f;
    sse += (y[t] - f) ** 2;
    const lPrev = l;
    const target = seasonal ? (mult ? y[t] / season : y[t] - season) : y[t];
    l = p.alpha * target + (1 - p.alpha) * (lPrev + b);
    if (method !== 'ses') b = p.beta * (l - lPrev) + (1 - p.beta) * b;
    if (seasonal)
      s[t % period] = mult
        ? p.gamma * (y[t] / l) + (1 - p.gamma) * season
        : p.gamma * (y[t] - l) + (1 - p.gamma) * season;
    level[t] = l;
    trend[t] = b;
  }
  const ahead = (h: number) => {
    const season = seasonal ? s[(n + h - 1) % period] : 0;
    return mult ? (l + h * b) * season : l + h * b + season;
  };
  return { fitted, level, trend, sse, count: n - start, ahead };
}

/** Exponential smoothing with the given parameters, or the least-squares ones where a parameter is NaN. */
export function smooth(
  y: readonly number[],
  method: SmoothingMethod,
  given: SmoothingParams,
  period: number,
  horizon: number,
  level: number,
): Smoothed {
  if (y.length < 3) fail('shortSeries', '3');
  const names = (['alpha', 'beta', 'gamma'] as const).filter(
    (k) =>
      (k === 'alpha' || (k === 'beta' && method !== 'ses') || (k === 'gamma' && method.startsWith('hw'))) &&
      Number.isNaN(given[k]),
  );
  for (const k of ['alpha', 'beta', 'gamma'] as const) {
    const v = given[k];
    if (!Number.isNaN(v) && !(v > 0 && v < 1)) fail('smoothingRange');
  }
  const build = (v: readonly number[]): SmoothingParams => {
    const out = { alpha: given.alpha, beta: given.beta, gamma: given.gamma };
    names.forEach((k, i) => (out[k] = logistic(v[i])));
    return out;
  };
  let params = build([]);
  if (names.length) {
    const best = nelderMead(
      (v) => smoothRun(y, method, build(v), period).sse,
      names.map(() => logit(0.3)),
      { tol: 1e-12 },
    );
    params = build(best.x);
  }
  const run = smoothRun(y, method, params, period);
  const sigma = Math.sqrt(run.sse / Math.max(1, run.count - names.length));
  const z = normalQuantile(1 - (1 - level) / 2);
  const forecast: number[] = [];
  const low: number[] = [];
  const high: number[] = [];
  for (let h = 1; h <= horizon; h++) {
    const f = run.ahead(h);
    let c = 1;
    for (let j = 1; j < h; j++) {
      const seasonalBump = method === 'hwadd' && j % period === 0 ? params.gamma : 0;
      const step = params.alpha * (1 + (method === 'ses' ? 0 : j * params.beta)) + seasonalBump;
      c += step * step;
    }
    const half = method === 'hwmult' ? NaN : z * sigma * Math.sqrt(c);
    forecast.push(f);
    low.push(f - half);
    high.push(f + half);
  }
  return {
    params,
    fitted: run.fitted,
    level: run.level,
    trend: run.trend,
    sse: run.sse,
    sigma,
    forecast,
    low,
    high,
    estimated: names,
  };
}

export interface ArimaFit {
  readonly p: number;
  readonly d: number;
  readonly q: number;
  readonly mean: number;
  readonly phi: number[];
  readonly theta: number[];
  readonly se: number[];
  readonly sigma2: number;
  readonly css: number;
  readonly residuals: number[];
  readonly fitted: number[];
  readonly method: 'yw' | 'ols' | 'css';
  readonly n: number;
}

/** Yule-Walker: solve the Toeplitz system R φ = r, with σ² = c0 (1 − φ'r). */
export function yuleWalker(w: readonly number[], p: number): { phi: number[]; sigma2: number } {
  const r = acf(w, p);
  const R: Matrix = Array.from({ length: p }, (_, i) =>
    Array.from({ length: p }, (_, j) => (i === j ? 1 : r[Math.abs(i - j) - 1])),
  );
  const phi = solve(R, r);
  if (!phi) fail('singularDesign');
  const m = mean(w);
  const c0 = sum(w.map((v) => (v - m) ** 2)) / w.length;
  return { phi, sigma2: c0 * (1 - sum(phi.map((f, i) => f * r[i]))) };
}

/** One-step errors e_t = w_t − μ − sum φ_i (w_{t−i} − μ) − sum θ_j e_{t−j}, starting with e = 0 for t < p. */
export function cssResiduals(
  w: readonly number[],
  mu: number,
  phi: readonly number[],
  theta: readonly number[],
): number[] {
  const p = phi.length;
  const e = new Array<number>(w.length).fill(0);
  for (let t = p; t < w.length; t++) {
    let f = mu;
    for (let i = 0; i < p; i++) f += phi[i] * (w[t - i - 1] - mu);
    for (let j = 0; j < theta.length; j++) if (t - j - 1 >= 0) f += theta[j] * e[t - j - 1];
    e[t] = w[t] - f;
  }
  return e;
}

/**
 * ARIMA(p, d, q): difference d times, then fit by conditional sum of squares (or Yule-Walker or OLS for AR). With
 * d = 0 the model has a mean. With d = 1 it has one only when drift is asked for: the differences' mean is then a
 * drift that the forecasts add each step. Without it, as in R's arima, the forecasts level off.
 */
export function fitArima(
  y: readonly number[],
  p: number,
  d: number,
  q: number,
  method: 'yw' | 'ols' | 'css',
  drift = false,
): ArimaFit {
  const w = difference(y, 1, d);
  if (w.length < p + q + 5) fail('shortSeries', String(p + q + d + 5));
  const withMean = d === 0 || (drift && d === 1);
  const m0 = withMean ? mean(w) : 0;
  if ((method === 'yw' || method === 'ols') && q > 0) fail('arOnly');
  if (method === 'yw' && p > 0) {
    const yw = yuleWalker(w, p);
    const e = cssResiduals(w, m0, yw.phi, []);
    return finish(w, { p, d, q, mu: m0, phi: yw.phi, theta: [], method, sigma2: yw.sigma2, e, withMean });
  }
  if (method === 'ols' && p > 0) {
    const rows = w
      .slice(p)
      .map((_, t) => [...(withMean ? [1] : []), ...Array.from({ length: p }, (_, i) => w[t + p - i - 1])]);
    const ls = leastSquares(rows, w.slice(p));
    const c = withMean ? ls.coef[0] : 0;
    const phi = ls.coef.slice(withMean ? 1 : 0);
    const mu = withMean ? c / (1 - sum(phi)) : 0;
    const e = cssResiduals(w, mu, phi, []);
    return finish(w, {
      p,
      d,
      q,
      mu,
      phi,
      theta: [],
      method,
      sigma2: ls.rss / (rows.length - ls.coef.length),
      e,
      withMean,
    });
  }
  const start = [...(withMean ? [m0] : []), ...(p > 0 ? yuleWalkerSafe(w, p) : []), ...new Array<number>(q).fill(0)];
  const unpack = (v: readonly number[]) => ({
    mu: withMean ? v[0] : 0,
    phi: v.slice(withMean ? 1 : 0, (withMean ? 1 : 0) + p),
    theta: v.slice((withMean ? 1 : 0) + p),
  });
  const cost = (v: readonly number[]) => {
    const u = unpack(v);
    if (u.theta.some((t) => Math.abs(t) >= 1) || u.phi.some((f) => Math.abs(f) >= 1.5)) return Infinity;
    return sum(cssResiduals(w, u.mu, u.phi, u.theta).map((x) => x * x));
  };
  let best = start.length
    ? nelderMead(cost, start, { tol: 1e-14, step: start.map((s) => (s === 0 ? 0.1 : 0.1 * Math.abs(s) + 0.05)) }).x
    : [];
  if (best.length) best = nelderMead(cost, best, { tol: 1e-14 }).x;
  const u = unpack(best);
  const e = cssResiduals(w, u.mu, u.phi, u.theta);
  const used = w.length - p;
  return finish(w, {
    p,
    d,
    q,
    mu: u.mu,
    phi: u.phi,
    theta: u.theta,
    method: 'css',
    sigma2: sum(e.map((x) => x * x)) / (used - start.length),
    e,
    withMean,
  });
}

function yuleWalkerSafe(w: readonly number[], p: number): number[] {
  try {
    return yuleWalker(w, p).phi;
  } catch {
    return new Array<number>(p).fill(0);
  }
}

interface Parts {
  p: number;
  d: number;
  q: number;
  mu: number;
  phi: number[];
  theta: number[];
  method: 'yw' | 'ols' | 'css';
  sigma2: number;
  e: number[];
  withMean: boolean;
}

/** Standard errors from the Jacobian of the residuals: cov = σ² (J'J)^-1. */
function finish(w: readonly number[], a: Parts): ArimaFit {
  const pack = [...(a.withMean ? [a.mu] : []), ...a.phi, ...a.theta];
  const resid = (v: readonly number[]) => {
    const mu = a.withMean ? v[0] : 0;
    const off = a.withMean ? 1 : 0;
    return cssResiduals(w, mu, v.slice(off, off + a.p), v.slice(off + a.p)).slice(a.p);
  };
  const base = resid(pack);
  const J: Matrix = base.map(() => []);
  pack.forEach((v, k) => {
    const h = 1e-6 * Math.max(1, Math.abs(v));
    const up = [...pack];
    up[k] += h;
    const r = resid(up);
    r.forEach((x, t) => J[t].push(-(x - base[t]) / h));
  });
  const inv = pack.length ? inverse(matMul(transpose(J), J)) : [];
  const se = pack.map((_, k) => (inv ? Math.sqrt(Math.max(0, a.sigma2 * inv[k][k])) : NaN));
  const fitted = w.map((v, t) => (t < a.p ? NaN : v - a.e[t]));
  return {
    p: a.p,
    d: a.d,
    q: a.q,
    mean: a.mu,
    phi: a.phi,
    theta: a.theta,
    se,
    sigma2: a.sigma2,
    css: sum(a.e.slice(a.p).map((x) => x * x)),
    residuals: a.e.slice(a.p),
    fitted,
    method: a.method,
    n: w.length,
  };
}

/** ψ weights of φ(B)(1 − B)^d x = θ(B) e, for the forecast variance σ² sum ψ_j^2. */
export function psiWeights(phi: readonly number[], theta: readonly number[], d: number, count: number): number[] {
  let ar = [1, ...phi.map((f) => -f)];
  for (let k = 0; k < d; k++) ar = ar.map((c, i) => c - (i > 0 ? ar[i - 1] : 0)).concat([-ar[ar.length - 1]]);
  const psi = [1];
  for (let j = 1; j < count; j++) {
    let v = j <= theta.length ? theta[j - 1] : 0;
    for (let i = 1; i < ar.length && i <= j; i++) v -= ar[i] * psi[j - i];
    psi.push(v);
  }
  return psi;
}

/** Forecasts of the original series h steps past its end, with intervals. */
export function arimaForecast(y: readonly number[], fit: ArimaFit, horizon: number, level: number) {
  const w = difference(y, 1, fit.d);
  const e = [...new Array<number>(fit.p).fill(0), ...fit.residuals];
  const wf = [...w];
  for (let h = 0; h < horizon; h++) {
    const t = wf.length;
    let f = fit.mean;
    for (let i = 0; i < fit.p; i++) f += fit.phi[i] * (wf[t - i - 1] - fit.mean);
    for (let j = 0; j < fit.q; j++) if (t - j - 1 < e.length) f += fit.theta[j] * e[t - j - 1];
    wf.push(f);
  }
  let levels = wf.slice(w.length);
  for (let k = fit.d; k > 0; k--) {
    const base = difference(y, 1, k - 1);
    let last = base[base.length - 1];
    levels = levels.map((v) => (last += v));
  }
  const psi = psiWeights(fit.phi, fit.theta, fit.d, horizon);
  const z = normalQuantile(1 - (1 - level) / 2);
  let acc = 0;
  const half = levels.map((_, h) => {
    acc += psi[h] ** 2;
    return z * Math.sqrt(fit.sigma2 * acc);
  });
  return { forecast: levels, low: levels.map((v, h) => v - half[h]), high: levels.map((v, h) => v + half[h]) };
}

export interface Accuracy {
  readonly mae: number;
  readonly rmse: number;
  readonly mape: number;
  readonly mase: number;
}

/** Errors of forecasts on a hold-out, with MASE scaled by the in-sample naive (or seasonal naive) error. */
export function accuracy(
  train: readonly number[],
  test: readonly number[],
  forecast: readonly number[],
  period: number,
): Accuracy {
  const e = test.map((v, i) => v - forecast[i]);
  const m = period > 1 && train.length > period ? period : 1;
  const scale = mean(train.slice(m).map((v, i) => Math.abs(v - train[i])));
  return {
    mae: mean(e.map(Math.abs)),
    rmse: Math.sqrt(mean(e.map((v) => v * v))),
    mape: test.some((v) => v === 0) ? NaN : 100 * mean(e.map((v, i) => Math.abs(v / test[i]))),
    mase: scale > 0 ? mean(e.map(Math.abs)) / scale : NaN,
  };
}
