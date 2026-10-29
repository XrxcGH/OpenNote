// Maximum likelihood for the subject tools. A Nelder-Mead search finds the neighborhood of the maximum. BFGS, with
// central-difference gradients and a backtracking line search, polishes it. The observed information (a numeric
// Hessian of the negative log-likelihood) gives standard errors. A profile likelihood gives an interval for one
// parameter. A log-likelihood may return -Infinity or NaN outside its domain (a negative scale, say); every search
// here treats that as a very poor point and steps back. Pure: no DOM.
import { brent } from '../../kits/num/roots';
import { cholesky, choleskySolve, identity } from '../../kits/num/matrix';
import type { Matrix } from '../../kits/num/matrix';
import { chiSquareQuantile } from '../stats/dist';
import { SubjectError, ensure } from '../errors';

export type LogLikelihood = (p: readonly number[]) => number;

/** The negative log-likelihood, with every invalid value turned into +Infinity. */
const negative =
  (ll: LogLikelihood) =>
  (p: readonly number[]): number => {
    const v = -ll(p);
    return Number.isNaN(v) ? Infinity : v;
  };

/** Nelder-Mead minimization (standard coefficients 1, 2, 1/2, 1/2) from `start`; a few hundred steps at most. */
export function nelderMead(
  f: (p: readonly number[]) => number,
  start: readonly number[],
  maxIterations = 400,
): number[] {
  const k = start.length;
  const simplex = [start.slice()];
  for (let j = 0; j < k; j += 1) {
    const v = start.slice();
    v[j] += v[j] === 0 ? 0.25 : 0.1 * Math.abs(v[j]);
    simplex.push(v);
  }
  let values = simplex.map(f);
  for (let it = 0; it < maxIterations; it += 1) {
    const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
    const pts = order.map((i) => simplex[i]);
    const vals = order.map((i) => values[i]);
    simplex.splice(0, simplex.length, ...pts);
    values = vals;
    const spread = Math.abs(values[k] - values[0]);
    if (Number.isFinite(spread) && spread <= 1e-12 * (Math.abs(values[0]) + 1e-12)) break;
    const centroid = new Array<number>(k).fill(0);
    for (let i = 0; i < k; i += 1) for (let j = 0; j < k; j += 1) centroid[j] += simplex[i][j] / k;
    const toward = (t: number) => centroid.map((c, j) => c + t * (simplex[k][j] - c));
    const reflected = toward(-1);
    const fr = f(reflected);
    if (fr < values[0]) {
      const expanded = toward(-2);
      const fe = f(expanded);
      [simplex[k], values[k]] = fe < fr ? [expanded, fe] : [reflected, fr];
    } else if (fr < values[k - 1]) {
      [simplex[k], values[k]] = [reflected, fr];
    } else {
      const contracted = fr < values[k] ? toward(-0.5) : toward(0.5);
      const fc = f(contracted);
      if (fc < Math.min(fr, values[k])) [simplex[k], values[k]] = [contracted, fc];
      else
        for (let i = 1; i <= k; i += 1) {
          simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]));
          values[i] = f(simplex[i]);
        }
    }
  }
  let best = 0;
  values.forEach((v, i) => (v < values[best] ? (best = i) : undefined));
  return simplex[best];
}

const stepFor = (v: number, scale: number): number => scale * Math.max(Math.abs(v), 1e-2);

export function numericGradient(f: (p: readonly number[]) => number, p: readonly number[]): number[] {
  return p.map((pj, j) => {
    const h = stepFor(pj, 1e-6);
    const up = [...p];
    const down = [...p];
    up[j] = pj + h;
    down[j] = pj - h;
    return (f(up) - f(down)) / (2 * h);
  });
}

/** The Hessian of `f` at `p` by central differences of function values. */
export function numericHessian(f: (p: readonly number[]) => number, p: readonly number[]): Matrix {
  const k = p.length;
  const h = p.map((v) => stepFor(v, 1e-4));
  const at = (du: number, u: number, dv: number, v: number) => {
    const q = [...p];
    q[u] += du * h[u];
    q[v] += dv * h[v];
    return f(q);
  };
  const f0 = f(p);
  const out = Array.from({ length: k }, () => new Array<number>(k).fill(0));
  for (let u = 0; u < k; u += 1) {
    out[u][u] = (at(1, u, 0, u) - 2 * f0 + at(-1, u, 0, u)) / (h[u] * h[u]);
    for (let v = 0; v < u; v += 1) {
      const d = (at(1, u, 1, v) - at(1, u, -1, v) - at(-1, u, 1, v) + at(-1, u, -1, v)) / (4 * h[u] * h[v]);
      out[u][v] = d;
      out[v][u] = d;
    }
  }
  return out;
}

/** BFGS minimization with an Armijo backtracking line search. */
export function bfgs(f: (p: readonly number[]) => number, start: readonly number[], maxIterations = 200): number[] {
  const k = start.length;
  let x = start.slice();
  let fx = f(x);
  let g = numericGradient(f, x);
  let hInv = identity(k);
  for (let it = 0; it < maxIterations; it += 1) {
    if (Math.max(...g.map(Math.abs)) <= 1e-9 * Math.max(1, Math.abs(fx))) break;
    let d = hInv.map((row) => -row.reduce((s, v, j) => s + v * g[j], 0));
    let slope = d.reduce((s, v, j) => s + v * g[j], 0);
    if (!(slope < 0)) {
      hInv = identity(k);
      d = g.map((v) => -v);
      slope = -g.reduce((s, v) => s + v * v, 0);
    }
    let t = 1;
    let next = x.map((v, j) => v + t * d[j]);
    let fn = f(next);
    while (!(fn <= fx + 1e-4 * t * slope) && t > 1e-12) {
      t /= 2;
      next = x.map((v, j) => v + t * d[j]);
      fn = f(next);
    }
    if (!(fn <= fx)) break;
    const gn = numericGradient(f, next);
    const s = next.map((v, j) => v - x[j]);
    const y = gn.map((v, j) => v - g[j]);
    const sy = s.reduce((acc, v, j) => acc + v * y[j], 0);
    const moved = Math.hypot(...s) <= 1e-14 * (Math.hypot(...x) + 1e-14);
    x = next;
    fx = fn;
    g = gn;
    if (moved) break;
    if (sy > 1e-300) {
      const hy = hInv.map((row) => row.reduce((acc, v, j) => acc + v * y[j], 0));
      const yhy = y.reduce((acc, v, j) => acc + v * hy[j], 0);
      hInv = hInv.map((row, u) =>
        row.map((v, c) => v + ((sy + yhy) * s[u] * s[c]) / (sy * sy) - (hy[u] * s[c] + s[u] * hy[c]) / sy),
      );
    }
  }
  return x;
}

export interface MleFit {
  params: number[];
  logLik: number;
  /** The inverse of the observed information. */
  covariance: Matrix;
  se: number[];
}

/** Maximizes `logLik` from `start`. Throws a SubjectError when the start is invalid or the maximum is flat. */
export function maximizeLikelihood(logLik: LogLikelihood, start: readonly number[]): MleFit {
  ensure(start.length > 0, 'empty');
  ensure(start.every(Number.isFinite), 'notFinite', 'start');
  const f = negative(logLik);
  ensure(Number.isFinite(f(start)), 'domain', 'start');
  const params = bfgs(f, nelderMead(f, start));
  const info = numericHessian(f, params);
  const fac = cholesky(info);
  const lost = fac.l.some((row, j) => row[j] * row[j] <= 1e-12 * Math.abs(info[j][j]));
  if (!fac.spd || lost) throw new SubjectError('singular', 'information');
  const covariance = choleskySolve(fac, identity(params.length));
  return { params, logLik: -f(params), covariance, se: covariance.map((row, j) => Math.sqrt(row[j])) };
}

export interface ProfileInterval {
  lower: number;
  upper: number;
  /** The likelihood-ratio cutoff, the chi-square quantile on one degree of freedom halved. */
  drop: number;
}

/**
 * The profile-likelihood interval for parameter `index`: the values where twice the drop in the maximized
 * log-likelihood, with the other parameters refitted, reaches the chi-square(1) quantile for `level`.
 */
export function profileInterval(logLik: LogLikelihood, fit: MleFit, index: number, level = 0.95): ProfileInterval {
  ensure(index >= 0 && index < fit.params.length, 'domain', 'index');
  ensure(level > 0 && level < 1, 'domain', 'level');
  const drop = chiSquareQuantile(level, 1) / 2;
  const others = fit.params.filter((_, j) => j !== index);
  const withValue = (v: number, rest: readonly number[]) => {
    const p = [...rest];
    p.splice(index, 0, v);
    return p;
  };
  const profile = (v: number): number => {
    if (others.length === 0) return logLik([v]);
    const f = negative((rest) => logLik(withValue(v, rest)));
    if (!Number.isFinite(f(others))) return -Infinity;
    return -f(bfgs(f, others));
  };
  const g = (v: number) => {
    const value = profile(v);
    return Number.isFinite(value) ? fit.logLik - value - drop : Infinity;
  };
  const center = fit.params[index];
  const side = (sign: 1 | -1): number => {
    let step = Number.isFinite(fit.se[index]) && fit.se[index] > 0 ? fit.se[index] : Math.max(Math.abs(center), 1);
    let inner = center;
    for (let i = 0; i < 60; i += 1) {
      const outer = center + sign * step;
      const value = g(outer);
      if (value >= 0) {
        const tol = 1e-12 * Math.max(1, Math.abs(center));
        if (Number.isFinite(value)) return brent(g, inner, outer, tol, 200).x;
        // The outer point is outside the domain, which still brackets the crossing: bisect, counting it as above.
        let [a, b] = [inner, outer];
        while (Math.abs(b - a) > tol) {
          const m = (a + b) / 2;
          if (g(m) >= 0) b = m;
          else a = m;
        }
        return (a + b) / 2;
      }
      inner = outer;
      step *= 2;
    }
    throw new SubjectError('noBracket', 'profile');
  };
  return { lower: side(-1), upper: side(1), drop };
}
