// A straight-line fit with errors in both variables and their correlation: York et al. (2004), "Unified equations
// for the slope, intercept, and standard errors of the best straight line", American Journal of Physics 72, 367.
import { check } from '../core/problem';

export interface Point {
  x: number;
  y: number;
  sx: number;
  sy: number;
  /** Correlation of the x and y errors, from −1 to 1. */
  r?: number;
}

export interface YorkFit {
  slope: number;
  intercept: number;
  seSlope: number;
  seIntercept: number;
  /** Mean square of weighted deviates: near 1 when the scatter matches the errors. */
  mswd: number;
  iterations: number;
}

export function york(points: readonly Point[]): YorkFit {
  const n = points.length;
  check(n >= 2, 'points', { count: 2 });
  for (const p of points) {
    check(p.sx > 0 && p.sy > 0, 'sigma');
    check(Math.abs(p.r ?? 0) < 1, 'rho');
  }
  const wx = points.map((p) => 1 / (p.sx * p.sx));
  const wy = points.map((p) => 1 / (p.sy * p.sy));
  const rho = points.map((p) => p.r ?? 0);
  const alpha = wx.map((w, i) => Math.sqrt(w * wy[i]));
  // Start from the ordinary least-squares slope.
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  const sxx = points.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  check(sxx > 0, 'sameX');
  let b = points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx;
  let w: number[] = [];
  let beta: number[] = [];
  let xbar = 0;
  let ybar = 0;
  let iterations = 0;
  for (; iterations < 200; iterations++) {
    w = points.map((_, i) => (wx[i] * wy[i]) / (wx[i] + b * b * wy[i] - 2 * b * rho[i] * alpha[i]));
    const sw = w.reduce((s, v) => s + v, 0);
    xbar = points.reduce((s, p, i) => s + w[i] * p.x, 0) / sw;
    ybar = points.reduce((s, p, i) => s + w[i] * p.y, 0) / sw;
    const u = points.map((p) => p.x - xbar);
    const v = points.map((p) => p.y - ybar);
    beta = w.map((wi, i) => wi * (u[i] / wy[i] + (b * v[i]) / wx[i] - ((b * u[i] + v[i]) * rho[i]) / alpha[i]));
    const top = w.reduce((s, wi, i) => s + wi * beta[i] * v[i], 0);
    const bottom = w.reduce((s, wi, i) => s + wi * beta[i] * u[i], 0);
    check(bottom !== 0, 'sameX');
    const next = top / bottom;
    const done = Math.abs(next - b) <= 1e-15 * Math.max(1, Math.abs(next));
    b = next;
    if (done) break;
  }
  const a = ybar - b * xbar;
  const sw = w.reduce((s, v) => s + v, 0);
  const adjusted = beta.map((bi) => xbar + bi);
  const xmean = adjusted.reduce((s, x, i) => s + w[i] * x, 0) / sw;
  const varB = 1 / adjusted.reduce((s, x, i) => s + w[i] * (x - xmean) ** 2, 0);
  const chi = points.reduce((s, p, i) => s + w[i] * (p.y - b * p.x - a) ** 2, 0);
  return {
    slope: b,
    intercept: a,
    seSlope: Math.sqrt(varB),
    seIntercept: Math.sqrt(1 / sw + xmean * xmean * varB),
    mswd: n > 2 ? chi / (n - 2) : Number.NaN,
    iterations: iterations + 1,
  };
}
