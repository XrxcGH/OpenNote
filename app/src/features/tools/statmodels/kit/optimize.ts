// Minimizing a function of a few numbers without its gradient, by the Nelder-Mead simplex: reflect the worst corner
// through the others, and expand, contract, or shrink as the function values say. The time series and spatial tools
// fit smoothing constants and variogram models with it.

export interface Minimum {
  readonly x: number[];
  readonly value: number;
  readonly iterations: number;
  readonly converged: boolean;
}

export function nelderMead(
  f: (x: readonly number[]) => number,
  start: readonly number[],
  options: { step?: readonly number[]; tol?: number; maxIter?: number } = {},
): Minimum {
  const n = start.length;
  const tol = options.tol ?? 1e-10;
  const maxIter = options.maxIter ?? 2000 * Math.max(1, n);
  const safe = (x: readonly number[]) => {
    const v = f(x);
    return Number.isFinite(v) ? v : Infinity;
  };
  let simplex: number[][] = [[...start]];
  for (let i = 0; i < n; i++) {
    const corner = [...start];
    const step = options.step?.[i] ?? (corner[i] === 0 ? 0.00025 : 0.05 * Math.abs(corner[i]));
    corner[i] += step;
    simplex.push(corner);
  }
  let values = simplex.map(safe);
  let iterations = 0;
  let converged = false;
  while (iterations < maxIter) {
    const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
    simplex = order.map((i) => simplex[i]);
    values = order.map((i) => values[i]);
    const spread = Math.abs(values[n] - values[0]);
    if (spread <= tol * (Math.abs(values[0]) + tol) && Number.isFinite(values[n])) {
      converged = true;
      break;
    }
    iterations++;
    const centroid = Array.from({ length: n }, (_, j) => simplex.slice(0, n).reduce((s, p) => s + p[j], 0) / n);
    const toward = (t: number) => centroid.map((c, j) => c + t * (simplex[n][j] - c));
    const reflected = toward(-1);
    const fr = safe(reflected);
    if (fr < values[0]) {
      const expanded = toward(-2);
      const fe = safe(expanded);
      [simplex[n], values[n]] = fe < fr ? [expanded, fe] : [reflected, fr];
    } else if (fr < values[n - 1]) {
      [simplex[n], values[n]] = [reflected, fr];
    } else {
      const contracted = fr < values[n] ? toward(-0.5) : toward(0.5);
      const fc = safe(contracted);
      if (fc < Math.min(fr, values[n])) [simplex[n], values[n]] = [contracted, fc];
      else {
        for (let i = 1; i <= n; i++) {
          simplex[i] = simplex[i].map((v, j) => simplex[0][j] + 0.5 * (v - simplex[0][j]));
          values[i] = safe(simplex[i]);
        }
      }
    }
  }
  const best = values.indexOf(Math.min(...values));
  return { x: simplex[best], value: values[best], iterations, converged };
}
