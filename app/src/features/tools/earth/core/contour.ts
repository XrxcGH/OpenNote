// Level curves on a sampled grid by marching squares, for the kit's map figures. Each cell a level crosses gives a
// short segment between the crossings on its edges; a saddle cell joins its corners by the cell's center value.
// Kept here, not imported from the math feature, because the feature boundary allows only its public index.

/** Values on a grid: `z[j][i]` is the value at (xs[i], ys[j]). NaN where there is none. */
export interface Grid {
  readonly xs: readonly number[];
  readonly ys: readonly number[];
  readonly z: readonly (readonly number[])[];
}

/** Segments [x1, y1, x2, y2] in grid units where the grid crosses `level`. */
export function contourSegments(grid: Grid, level: number): [number, number, number, number][] {
  const { xs, ys, z } = grid;
  const cross = (a: number, b: number, za: number, zb: number) => a + ((level - za) / (zb - za)) * (b - a);
  const out: [number, number, number, number][] = [];
  for (let j = 0; j + 1 < ys.length; j++) {
    for (let i = 0; i + 1 < xs.length; i++) {
      const c = [z[j][i], z[j][i + 1], z[j + 1][i + 1], z[j + 1][i]];
      if (!c.every(Number.isFinite)) continue;
      const p = [
        [xs[i], ys[j]],
        [xs[i + 1], ys[j]],
        [xs[i + 1], ys[j + 1]],
        [xs[i], ys[j + 1]],
      ];
      const hits: [number, number][] = [];
      for (let e = 0; e < 4; e++) {
        const [za, zb] = [c[e], c[(e + 1) % 4]];
        if (za < level === zb < level) continue;
        const [a, b] = [p[e], p[(e + 1) % 4]];
        hits.push([cross(a[0], b[0], za, zb), cross(a[1], b[1], za, zb)]);
      }
      if (hits.length === 2) out.push([...hits[0], ...hits[1]]);
      else if (hits.length === 4) {
        // Hits run bottom, right, top, left. A center on corners 0 and 2's side cuts off corners 1 and 3, else 0 and 2.
        const center = (c[0] + c[1] + c[2] + c[3]) / 4;
        const pairs = center < level === c[0] < level ? [0, 1, 2, 3] : [0, 3, 1, 2];
        out.push([...hits[pairs[0]], ...hits[pairs[1]]], [...hits[pairs[2]], ...hits[pairs[3]]]);
      }
    }
  }
  return out;
}
