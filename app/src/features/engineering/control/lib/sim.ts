// Time responses of linear systems ẋ = Ax + Bu, y = Cx + Du on a uniform grid. The input is held constant over
// each step (or sampled at the step's midpoint), and each step uses the exact matrix exponential, so a step input
// gives the exact response at the grid points.

import { leverrier, zohPair, type Mat, type ReadonlyMat } from './linalg';
import { rootsOf, type Complex } from './tf';

export interface Simulation {
  readonly t: readonly number[];
  /** y[k] is the output vector at t[k]. */
  readonly y: readonly (readonly number[])[];
  readonly x: readonly (readonly number[])[];
}

/** Simulates from x0 with u(t) (one value per input) sampled at the midpoint of each step. */
export function simulate(
  sys: { readonly a: ReadonlyMat; readonly b: ReadonlyMat; readonly c: ReadonlyMat; readonly d: ReadonlyMat },
  u: (t: number) => readonly number[],
  tEnd: number,
  steps: number,
  x0?: readonly number[],
  midpoint = false,
): Simulation {
  const n = sys.a.length;
  const m = sys.b[0]?.length ?? sys.d[0]?.length ?? 1;
  const h = tEnd / steps;
  const { phi, gamma } = n ? zohPair(sys.a, sys.b, h) : { phi: [] as Mat, gamma: [] as Mat };
  let x = x0 ? [...x0] : new Array<number>(n).fill(0);
  const ts: number[] = [];
  const ys: number[][] = [];
  const xs: number[][] = [];
  const out = (xx: readonly number[], uu: readonly number[]) =>
    sys.c.map(
      (row, i) =>
        row.reduce((s, cij, j) => s + cij * xx[j], 0) +
        (sys.d[i] ?? []).reduce((s, dij, j) => s + dij * (uu[j] ?? 0), 0),
    );
  for (let k = 0; k <= steps; k += 1) {
    const t = k * h;
    ts.push(t);
    xs.push(x);
    ys.push(out(x, u(t)));
    if (k === steps) break;
    const uk = u(midpoint ? t + h / 2 : t);
    const next = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i += 1) {
      let s = 0;
      for (let j = 0; j < n; j += 1) s += phi[i][j] * x[j];
      for (let j = 0; j < m; j += 1) s += gamma[i][j] * (uk[j] ?? 0);
      next[i] = s;
    }
    x = next;
  }
  return { t: ts, y: ys, x: xs };
}

/** Eigenvalues from the characteristic polynomial (adequate for the small systems these tools take). */
export function eigenvalues(a: ReadonlyMat): Complex[] {
  if (!a.length) return [];
  const { coeffs } = leverrier(a);
  return rootsOf([...coeffs].reverse());
}
