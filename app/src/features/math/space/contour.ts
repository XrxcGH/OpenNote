// Level curves of z = f(x, y) by marching squares: each cell of a sampled grid that a level crosses gives one short
// segment between the crossings on its edges. Pure numbers, so the 3D view's floor and the 2D contour plot share it.
import { niceSteps } from '../grapher/ticks';

/** Values of f on a grid: `z[j][i]` is f(xs[i], ys[j]). NaN where f is not defined. */
export interface Grid2 {
  readonly xs: readonly number[];
  readonly ys: readonly number[];
  readonly z: readonly (readonly number[])[];
}

export interface LevelCurve {
  readonly level: number;
  /** Segments as [x1, y1, x2, y2] in graph units. */
  readonly segments: readonly (readonly [number, number, number, number])[];
}

/** About `count` round levels strictly inside [min, max], such as -4, -3, ..., 4. */
export function contourLevels(min: number, max: number, count = 10): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  const { step } = niceSteps((max - min) / count);
  const levels: number[] = [];
  const first = Math.ceil(min / step);
  for (let i = first; i * step < max; i++) {
    // Counted in whole steps, so zero is exactly zero and not 5.55e-17.
    const v = Number((i * step).toPrecision(12));
    if (v > min) levels.push(v);
  }
  return levels;
}

/** Where the value crosses `level` on the edge from `a` (value `za`) to `b` (value `zb`). */
const cross = (level: number, a: number, b: number, za: number, zb: number) => a + ((level - za) / (zb - za)) * (b - a);

/** The level curves of the grid at each level. */
export function levelCurves(grid: Grid2, levels: readonly number[]): LevelCurve[] {
  const { xs, ys, z } = grid;
  return levels.map((level) => {
    const segments: [number, number, number, number][] = [];
    for (let j = 0; j + 1 < ys.length; j++) {
      for (let i = 0; i + 1 < xs.length; i++) {
        const corners = [z[j][i], z[j][i + 1], z[j + 1][i + 1], z[j + 1][i]];
        if (!corners.every(Number.isFinite)) continue;
        const [x0, x1, y0, y1] = [xs[i], xs[i + 1], ys[j], ys[j + 1]];
        const points: [number, number][] = [];
        // The edges in order: bottom, right, top, left.
        const edges: [number, number, [number, number], [number, number]][] = [
          [corners[0], corners[1], [x0, y0], [x1, y0]],
          [corners[1], corners[2], [x1, y0], [x1, y1]],
          [corners[2], corners[3], [x1, y1], [x0, y1]],
          [corners[3], corners[0], [x0, y1], [x0, y0]],
        ];
        for (const [za, zb, a, b] of edges) {
          if (za < level === zb < level) continue;
          points.push([cross(level, a[0], b[0], za, zb), cross(level, a[1], b[1], za, zb)]);
        }
        if (points.length === 2) segments.push([...points[0], ...points[1]]);
        else if (points.length === 4) {
          // A saddle cell: the center's value says which corners join.
          const center = (corners[0] + corners[1] + corners[2] + corners[3]) / 4;
          const pairs = center < level === corners[0] < level ? [0, 1, 2, 3] : [0, 3, 1, 2];
          segments.push([...points[pairs[0]], ...points[pairs[1]]]);
          segments.push([...points[pairs[2]], ...points[pairs[3]]]);
        }
      }
    }
    return { level, segments };
  });
}
