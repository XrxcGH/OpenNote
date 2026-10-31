// Spatial statistics against values worked out by hand or separately. Moran's I and Geary's C use a 3 x 3 grid
// with rook weights. Other cases check the Clark-Evans ratio, inverse-distance weighting, and Ripley's K. The
// rest check quadrat counts, kriging where the answer is known, and the minimizer the variogram fit uses.
import { describe, expect, it } from 'vitest';
import { nelderMead } from '../kit/optimize';
import { firstTexts, runTool } from '../kit/read';
import { StatError } from '../kit/types';
import {
  autocorrelation,
  centrography,
  empiricalVariogram,
  fitVariogram,
  idw,
  krige,
  parseAdjacency,
  quadrats,
  ripley,
  ripleyK,
  spatialWeights,
  variogram,
  type Point,
} from './engine';
import { spatialSpec } from './spec';

const close = (got: number, want: number, tol: number) => expect(Math.abs(got - want)).toBeLessThanOrEqual(tol);

const code = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    return e instanceof StatError ? e.code : 'other';
  }
  return 'none';
};

const grid: Point[] = [];
for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) grid.push({ x: c, y: r });
const gridValues = [1, 2, 3, 2, 3, 4, 3, 4, 5];

describe('global autocorrelation', () => {
  const w = spatialWeights(grid, { kind: 'rook', standardize: false });

  it("finds Moran's I and Geary's C on a 3 x 3 grid with rook weights", () => {
    expect(w.flat().reduce((a, b) => a + b, 0)).toBe(24);
    const a = autocorrelation(gridValues, w, 99, 1);
    close(a.moran.value, 0.5, 1e-6);
    close(a.moran.expected, -0.125, 1e-12);
    close(a.geary.value, 1 / 3, 1e-6);
    expect(a.moran.z).toBeGreaterThan(0);
    expect(a.moran.permP).toBeGreaterThan(0);
    expect(a.moran.permP).toBeLessThanOrEqual(1);
  });

  it('gives the same permutation p-values for the same seed', () => {
    const a = autocorrelation(gridValues, w, 199, 7);
    const b = autocorrelation(gridValues, w, 199, 7);
    expect(a.moran.permP).toBe(b.moran.permP);
    expect(a.local.map((l) => l.p)).toEqual(b.local.map((l) => l.p));
  });

  it('labels the local clusters by quadrant', () => {
    const a = autocorrelation(gridValues, w, 99, 1);
    expect(a.local[0].quadrant).toBe('ll');
    expect(a.local[8].quadrant).toBe('hh');
  });

  it('builds queen, band, nearest-neighbor, and typed weights', () => {
    const queen = spatialWeights(grid, { kind: 'queen', standardize: false });
    expect(queen[4].reduce((a, b) => a + b, 0)).toBe(8);
    const band = spatialWeights(grid, { kind: 'band', band: 1, standardize: false });
    expect(band).toEqual(w);
    const knn = spatialWeights(grid, { kind: 'knn', k: 2, standardize: true });
    knn.forEach((row) =>
      close(
        row.reduce((a, b) => a + b, 0),
        1,
        1e-12,
      ),
    );
    expect(parseAdjacency('1: 2\n2: 3', 3)).toEqual([[1], [0, 2], [1]]);
  });
});

describe('point patterns', () => {
  const points: Point[] = [
    { x: 1, y: 1 },
    { x: 2, y: 2 },
    { x: 3, y: 1 },
    { x: 4, y: 3 },
    { x: 2, y: 4 },
  ];

  it('finds the Clark-Evans ratio in a 16 square-unit area', () => {
    const c = centrography(points, 16);
    close(c.meanNn, 1.69574, 1e-5);
    close(c.r, 1.8959, 1e-4);
    close(c.meanX, 2.4, 1e-12);
    close(c.meanY, 2.2, 1e-12);
  });

  it("counts Ripley's K by the border method", () => {
    const three: Point[] = [
      { x: 5, y: 5 },
      { x: 5, y: 6 },
      { x: 6, y: 5 },
    ];
    close(ripleyK(three, [0, 10, 0, 10], [1.5])[0], 200 / 3, 1e-9);
    close(ripleyK(three, [0, 10, 0, 10], [0.5])[0], 0, 1e-12);
    const a = ripley(points, [0, 4, 0, 4], 19, 3);
    const b = ripley(points, [0, 4, 0, 4], 19, 3);
    expect(a.low).toEqual(b.low);
    expect(a.radii).toHaveLength(20);
  });

  it('counts quadrats and their variance-to-mean ratio', () => {
    const q = quadrats(
      [
        { x: 0.5, y: 0.5 },
        { x: 0.6, y: 0.4 },
        { x: 1.5, y: 0.5 },
        { x: 0.5, y: 1.5 },
      ],
      [0, 2, 0, 2],
      2,
      2,
    );
    expect(q.counts).toEqual([2, 1, 1, 0]);
    close(q.vmr, 2 / 3, 1e-12);
    close(q.chi2, 2, 1e-12);
  });
});

describe('interpolation', () => {
  it('weights by inverse distance', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ];
    close(idw(pts, [1, 3], { x: 0.5, y: 0 }, 2), 2, 1e-12);
    expect(idw(pts, [1, 3], { x: 1, y: 0 }, 2)).toBe(3);
  });

  it('krigs to the data at a data point and to the mean halfway between 2 points', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 0, y: 3 },
    ];
    const p = { nugget: 0, sill: 4, range: 5 };
    const at = krige(pts, [1, 5, 2], { x: 2, y: 0 }, 'spherical', p);
    close(at.value, 5, 1e-9);
    close(at.variance, 0, 1e-9);
    const mid = krige(pts.slice(0, 2), [1, 5], { x: 1, y: 0 }, 'exponential', p);
    close(mid.value, 3, 1e-12);
    mid.weights.forEach((wt) => close(wt, 0.5, 1e-12));
  });

  it('bins the semivariogram and fits a model close to it', () => {
    const pts: Point[] = [];
    const z: number[] = [];
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 6; j++) {
        pts.push({ x: i, y: j });
        z.push(Math.sin(i / 2) + Math.cos(j / 3));
      }
    const lags = empiricalVariogram(pts, z, 1, 5);
    close(lags[0].h, (60 * 1 + 50 * Math.SQRT2) / 110, 1e-9);
    expect(lags[0].pairs).toBe(110);
    const fit = fitVariogram('gaussian', lags);
    expect(fit.range).toBeGreaterThan(0);
    close(variogram('spherical', { nugget: 1, sill: 2, range: 3 }, 6), 3, 1e-12);
  });

  it('bounds the range of a trending field and flags that no sill is reached', () => {
    // z = (x + y)^2 on a 6 x 6 grid: the semivariance keeps growing with distance, so no sill exists.
    const pts: Point[] = [];
    const z: number[] = [];
    for (let i = 0; i < 6; i++)
      for (let j = 0; j < 6; j++) {
        pts.push({ x: i, y: j });
        z.push((i + j) ** 2);
      }
    const lags = empiricalVariogram(pts, z, 1, 6);
    const maxH = Math.max(...lags.map((l) => l.h));
    const maxG = Math.max(...lags.map((l) => l.gamma));
    const fit = fitVariogram('spherical', lags);
    expect(fit.range).toBeLessThanOrEqual(2 * maxH);
    expect(fit.sill).toBeLessThanOrEqual(3 * maxG);
    expect(fit.noSill).toBe(true);
  });

  it('fits a stationary field inside the bounds without the no-sill flag', () => {
    // A spherical field sampled exactly: gamma(h) = 1 + 4 * sph(h / 3), so the fit recovers it.
    const truth = { nugget: 1, sill: 4, range: 3 };
    const lags = [0.5, 1, 1.5, 2, 2.5, 3.5, 4.5].map((h) => ({ h, pairs: 50, gamma: variogram('spherical', truth, h) }));
    const fit = fitVariogram('spherical', lags);
    close(fit.nugget, 1, 1e-3);
    close(fit.sill, 4, 1e-3);
    close(fit.range, 3, 1e-3);
    expect(fit.noSill).toBe(false);
  });

  it('keeps the wells example inside the data and says its variogram has no sill', () => {
    const wells = spatialSpec.examples!.find((e) => e.id === 'wells')!;
    const run = runTool(spatialSpec, { ...firstTexts(spatialSpec), ...wells.values } as Record<string, string>);
    if (!run.ok) throw new Error('the wells example failed');
    const lagTable = run.outcome.tables!.find((t) => t.id === 'lags')!;
    const maxH = Math.max(...lagTable.rows.map((r) => Number(r[0])));
    const range = Number(run.outcome.rows.find((r) => r.id === 'range')!.value);
    expect(range).toBeLessThanOrEqual(2 * maxH);
    expect(run.outcome.steps.map((s) => s.key)).toContain('spatial.noSill');
  });

  it('minimizes the Rosenbrock function', () => {
    const m = nelderMead((v) => 100 * (v[1] - v[0] ** 2) ** 2 + (1 - v[0]) ** 2, [-1.2, 1], { tol: 1e-14 });
    close(m.x[0], 1, 1e-4);
    close(m.x[1], 1, 1e-4);
  });
});

describe('impossible spatial input', () => {
  it('says why the statistics cannot be worked out', () => {
    expect(code(() => centrography([{ x: 0, y: 0 }], 1))).toBe('tooFewPoints');
    expect(code(() => centrography(grid, 0))).toBe('areaPositive');
    expect(code(() => centrography(grid, -4))).toBe('areaPositive');
    const w = spatialWeights(grid, { kind: 'rook', standardize: true });
    expect(code(() => autocorrelation(new Array<number>(9).fill(2), w, 9, 1))).toBe('constantValues');
    expect(code(() => spatialWeights(grid, { kind: 'band', band: 0.5, standardize: false }))).toBe('noNeighbors');
    expect(code(() => spatialWeights(grid, { kind: 'knn', k: 9, standardize: false }))).toBe('knnRange');
    expect(code(() => parseAdjacency('one two', 3))).toBe('adjacencyLine');
    expect(code(() => parseAdjacency('1: 7', 3))).toBe('adjacencyIndex');
    const twice = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    ];
    expect(code(() => spatialWeights(twice, { kind: 'inverse', standardize: false }))).toBe('samePoint');
    expect(code(() => krige(twice, [1, 2], { x: 1, y: 1 }, 'spherical', { nugget: 0, sill: 1, range: 1 }))).toBe(
      'krigingSingular',
    );
  });
});
