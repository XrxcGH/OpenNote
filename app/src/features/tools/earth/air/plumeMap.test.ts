// The plume map's grid against the plume formula itself: the centerline row is the ground-level concentration
// under the plume, and the map is mirror-symmetric across the wind.
import { describe, expect, it } from 'vitest';
import { contourSegments } from '../core/contour';
import { plumeGrid, plumeMapFigure } from './plumeMap';
import { plume, sigmas } from './quality';

describe('plume map', () => {
  const input = { q: 100, u: 5, stability: 'D' as const, urban: false, heightAt: () => 50, xMax: 4000, ny: 41 };

  it('holds C(x, 0, 0) on its centerline and is symmetric in y', () => {
    const grid = plumeGrid(input);
    const mid = 20;
    expect(grid.ys[mid]).toBeCloseTo(0, 12);
    const x = grid.xs[29];
    const s = sigmas('D', x);
    // Q/(π u σy σz) e^(−H²/2σz²), the ground-level centerline value written out.
    const expected = (100 / (Math.PI * 5 * s.sy * s.sz)) * Math.exp(-(50 * 50) / (2 * s.sz * s.sz));
    expect(Math.abs(grid.z[mid][29] - expected) / expected).toBeLessThan(1e-12);
    expect(grid.z[mid][29]).toBe(plume(100, 5, s.sy, s.sz, 50));
    for (let j = 0; j < 41; j++) expect(grid.z[j][10]).toBeCloseTo(grid.z[40 - j][10], 15);
  });

  it('draws five labeled level curves', () => {
    const fig = plumeMapFigure(input);
    const paths = fig.marks.filter((m) => m.kind === 'path' && m.width === 1.5);
    expect(paths).toHaveLength(5);
    expect(paths.every((m) => m.kind === 'path' && m.d.length > 0)).toBe(true);
    expect(fig.marks.some((m) => m.kind === 'text' && m.text.startsWith('90%'))).toBe(true);
  });
});

describe('contour segments', () => {
  it('traces x² + y² = 1 within the grid spacing, including a saddle grid', () => {
    const xs = Array.from({ length: 41 }, (_, i) => -2 + i / 10);
    const grid = { xs, ys: xs, z: xs.map((y) => xs.map((x) => x * x + y * y)) };
    const segs = contourSegments(grid, 1);
    expect(segs.length).toBeGreaterThan(40);
    for (const [x1, y1, x2, y2] of segs) {
      expect(Math.abs(Math.hypot(x1, y1) - 1)).toBeLessThan(0.01);
      expect(Math.abs(Math.hypot(x2, y2) - 1)).toBeLessThan(0.01);
    }
    // z = xy on one cell centered at 0 is a saddle: level 0.1 cuts off the two positive corners.
    const saddle = contourSegments(
      {
        xs: [-1, 1],
        ys: [-1, 1],
        z: [
          [1, -1],
          [-1, 1],
        ],
      },
      0.1,
    );
    expect(saddle).toHaveLength(2);
  });
});
