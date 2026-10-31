// Kriging over a grid against values worked out separately. Midway between 2 points, symmetry gives weights of
// 1/2 each, so the estimate is the mean of the 2 values and the variance is 2 γ(d/2) − γ(d)/2 (from the kriging
// equations with γ(0) = 0). With no nugget, kriging is exact at the data points with 0 variance. Each node also
// matches kriging that place alone, and inverse-distance values match their formula.
import { describe, expect, it } from 'vitest';
import { SCREEN } from '../kit/picture';
import { StatError } from '../kit/types';
import { contourMap, levelSegments, mapLevels } from './contourMap';
import { krige, variogram, type VariogramParams } from './engine';
import { nodes, surfaceGrid } from './grid';

const close = (got: number, want: number, tol: number) => expect(Math.abs(got - want)).toBeLessThanOrEqual(tol);
const code = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    return e instanceof StatError ? e.code : 'other';
  }
  return 'none';
};

const params: VariogramParams = { nugget: 0, sill: 4, range: 10 };

describe('kriging on a grid', () => {
  it('gives the mean and the closed-form variance midway between 2 points', () => {
    // Points at x = 0 and x = 4 on y = 0; a 3 x 3 grid over [0, 4] x [-2, 2] has its center node at (2, 0).
    const pts = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ];
    const g = surfaceGrid(pts, [10, 20], 'spherical', params, [0, 4, -2, 2], 3, 2);
    close(g.kriged[1][1], 15, 1e-9);
    // Spherical γ(h) = 4 (1.5 h/10 − 0.5 (h/10)^3): γ(2) = 1.184, γ(4) = 2.272; 2(1.184) − 2.272/2 = 1.232.
    close(g.sd[1][1] ** 2, 1.232, 1e-9);
    close(g.idw[1][1], 15, 1e-12);
  });

  it('is exact at the data with no nugget', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 2 },
      { x: 2, y: 2 },
    ];
    const z = [1, 3, 2, 7];
    const g = surfaceGrid(pts, z, 'exponential', params, [0, 2, 0, 2], 2, 2);
    expect(g.kriged.flat().map((v) => Number(v.toFixed(9)))).toEqual([1, 3, 2, 7]);
    g.sd.flat().forEach((s) => close(s, 0, 1e-6));
  });

  it('matches kriging each place alone, and the sd grows away from the data', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 3, y: 1 },
      { x: 1, y: 4 },
      { x: 5, y: 5 },
      { x: 4, y: 2 },
    ];
    const z = [12, 14, 13, 18, 15];
    const p = { nugget: 0.2, sill: 3, range: 6 };
    const g = surfaceGrid(pts, z, 'gaussian', p, [0, 5, 0, 5], 6, 2);
    for (const [j, y] of g.ys.entries())
      for (const [i, x] of g.xs.entries()) {
        const one = krige(pts, z, { x, y }, 'gaussian', p);
        close(g.kriged[j][i], one.value, 1e-8);
        close(g.sd[j][i], Math.sqrt(one.variance), 1e-8);
      }
    const far = surfaceGrid(pts, z, 'gaussian', p, [20, 21, 20, 21], 2, 2);
    expect(far.sd[0][0]).toBeGreaterThan(g.sd[0][0]);
    // Far away the estimate tends to the generalized least squares mean, inside the data's range.
    expect(far.kriged[0][0]).toBeGreaterThan(12);
    expect(far.kriged[0][0]).toBeLessThan(18);
    close(variogram('gaussian', p, 0), 0, 0);
  });

  it('spaces the nodes evenly with both ends included', () => {
    expect(nodes(-1, 1, 5)).toEqual([-1, -0.5, 0, 0.5, 1]);
  });

  it('stops with a clear reason on impossible input', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(code(() => surfaceGrid(pts.slice(0, 1), [1], 'spherical', params, [0, 1, 0, 1], 5, 2))).toBe('tooFewPoints');
    expect(code(() => surfaceGrid(pts, [1, 2], 'spherical', params, [0, 1, 0, 1], 1, 2))).toBe('gridSize');
    expect(code(() => surfaceGrid(pts, [1, 2], 'spherical', params, [0, 1, 0, 1], 500, 2))).toBe('gridSize');
    expect(code(() => surfaceGrid(pts, [1, 2], 'spherical', params, [0, 0, 0, 1], 5, 2))).toBe('flatWindow');
    const twin = [pts[0], pts[0]];
    expect(code(() => surfaceGrid(twin, [1, 2], 'spherical', params, [0, 1, 0, 1], 5, 2))).toBe('krigingSingular');
  });
});

describe('contour map', () => {
  // z = x + y on [0, 2] x [0, 2] with 3 nodes a side.
  const xs = [0, 1, 2];
  const plane = { xs, ys: xs, z: xs.map((y) => xs.map((x) => x + y)) };

  it('puts every segment of a plane on its level line', () => {
    const segs = levelSegments(plane, 1.5);
    expect(segs.length).toBeGreaterThan(0);
    for (const [x1, y1, x2, y2] of segs) {
      close(x1 + y1, 1.5, 1e-12);
      close(x2 + y2, 1.5, 1e-12);
    }
  });

  it('picks round levels strictly inside the range, and none for a flat surface', () => {
    expect(mapLevels(plane.z)).toEqual([1, 2, 3]);
    expect(mapLevels([[5, 5]])).toEqual([]);
    expect(mapLevels([])).toEqual([]);
  });

  it('splits a saddle cell into 2 segments', () => {
    const saddle = {
      xs: [0, 1],
      ys: [0, 1],
      z: [
        [1, 0],
        [0, 1],
      ],
    };
    expect(levelSegments(saddle, 0.5)).toHaveLength(2);
  });

  it('draws the lines, their labels, and the data points', () => {
    const draw = contourMap(plane, [{ x: 1, y: 1 }], { x: 'x', y: 'y' });
    const out = draw({ palette: SCREEN, say: (k) => k, prefix: 'kitStatModels.spatial' });
    expect(out.startsWith('<svg')).toBe(true);
    expect(out.match(/<path d="M/g)?.length).toBeGreaterThanOrEqual(3);
    expect(out).toContain('kitStatModels.spatial.plot.x');
  });
});
