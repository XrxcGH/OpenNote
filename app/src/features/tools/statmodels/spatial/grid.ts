// Ordinary kriging and inverse-distance weighting over a whole grid, for contour maps. The kriging matrix
// [Γ 1; 1' 0] is the same for every place, so it is inverted once and each grid node needs only a product:
// [λ; μ] = A^-1 [γ0; 1], the estimate λ'z and the variance λ'γ0 + μ, as at a single place.
import { inverse, matVec } from '../kit/linalg';
import { fail } from '../kit/types';
import { idw, variogram, type Point, type VariogramModel, type VariogramParams, type Window } from './engine';

export interface SurfaceGrid {
  /** Node coordinates along x and along y. */
  readonly xs: readonly number[];
  readonly ys: readonly number[];
  /** `kriged[j][i]` is the estimate at (xs[i], ys[j]); `sd` its kriging standard deviation. */
  readonly kriged: readonly (readonly number[])[];
  readonly sd: readonly (readonly number[])[];
  readonly idw: readonly (readonly number[])[];
}

const MIN_SIZE = 2;
const MAX_SIZE = 81;

/** `size` evenly spaced values from lo to hi, both ends included. */
export function nodes(lo: number, hi: number, size: number): number[] {
  return Array.from({ length: size }, (_, i) => (size === 1 ? lo : lo + ((hi - lo) * i) / (size - 1)));
}

/** Kriged values, their standard deviations, and inverse-distance values on a `size` x `size` grid over `box`. */
export function surfaceGrid(
  points: readonly Point[],
  z: readonly number[],
  model: VariogramModel,
  params: VariogramParams,
  box: Window,
  size: number,
  power: number,
): SurfaceGrid {
  const n = points.length;
  if (n < 2) fail('tooFewPoints', '2');
  if (!Number.isInteger(size) || size < MIN_SIZE || size > MAX_SIZE) fail('gridSize', `${MIN_SIZE}|${MAX_SIZE}`);
  if (!(box[1] > box[0]) || !(box[3] > box[2])) fail('flatWindow');
  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const a = Array.from({ length: n + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) =>
      i === n && j === n ? 0 : i === n || j === n ? 1 : variogram(model, params, dist(points[i], points[j])),
    ),
  );
  const inv = inverse(a);
  if (!inv || inv.some((row) => row.some((v) => !Number.isFinite(v)))) fail('krigingSingular');
  const xs = nodes(box[0], box[1], size);
  const ys = nodes(box[2], box[3], size);
  const kriged: number[][] = [];
  const sd: number[][] = [];
  const near: number[][] = [];
  for (const y of ys) {
    const kRow: number[] = [];
    const sRow: number[] = [];
    const iRow: number[] = [];
    for (const x of xs) {
      const at = { x, y };
      const g0 = points.map((q) => variogram(model, params, dist(q, at)));
      const sol = matVec(inv, [...g0, 1]);
      let value = 0;
      let variance = sol[n];
      for (let i = 0; i < n; i++) {
        value += sol[i] * z[i];
        variance += sol[i] * g0[i];
      }
      kRow.push(value);
      sRow.push(Math.sqrt(Math.max(0, variance)));
      iRow.push(idw(points, z, at, power));
    }
    kriged.push(kRow);
    sd.push(sRow);
    near.push(iRow);
  }
  return { xs, ys, kriged, sd, idw: near };
}
