// Spatial statistics from coordinates alone. Point patterns: the mean center, the standard distance, the Clark-Evans
// nearest-neighbor ratio R = mean d_nn / (0.5 / sqrt(n / A)), the quadrat variance-to-mean ratio, and Ripley's K and
// L with border correction and seeded envelopes under complete spatial randomness. Autocorrelation: spatial weights,
// global Moran's I = (n / S0) z'Wz / z'z and Geary's C, with normal and permutation inference, and local Moran.
// Interpolation: the empirical semivariogram, a spherical, exponential, or Gaussian model, ordinary kriging by the
// augmented system, and inverse-distance weighting.
import { normalTwoSided } from '../kit/dist';
import { solve, type Matrix } from '../kit/linalg';
import { nelderMead } from '../kit/optimize';
import { makeRng, shuffled } from '../kit/rng';
import { fail } from '../kit/types';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A rectangle the points lie in: [xmin, xmax, ymin, ymax]. */
export type Window = readonly [number, number, number, number];

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const sum = (xs: readonly number[]) => xs.reduce((s, v) => s + v, 0);

export function boundingBox(points: readonly Point[]): Window {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
}

export const windowArea = (w: Window) => (w[1] - w[0]) * (w[3] - w[2]);

/** The distance from each point to its nearest other point, and which point that is. */
export function nearestNeighbors(points: readonly Point[]): { d: number[]; j: number[] } {
  if (points.length < 2) fail('tooFewPoints', '2');
  const d: number[] = [];
  const j: number[] = [];
  points.forEach((p, i) => {
    let best = Infinity;
    let at = -1;
    points.forEach((q, k) => {
      if (k === i) return;
      const e = dist(p, q);
      if (e < best) [best, at] = [e, k];
    });
    d.push(best);
    j.push(at);
  });
  return { d, j };
}

export interface Centrography {
  readonly n: number;
  readonly meanX: number;
  readonly meanY: number;
  readonly standardDistance: number;
  readonly area: number;
  readonly meanNn: number;
  readonly expectedNn: number;
  readonly r: number;
  readonly se: number;
  readonly z: number;
  readonly p: number;
}

/** The mean center, standard distance, and the Clark-Evans test of the nearest-neighbor distances. */
export function centrography(points: readonly Point[], area: number): Centrography {
  const n = points.length;
  if (n < 2) fail('tooFewPoints', '2');
  if (!(area > 0)) fail('areaPositive');
  const meanX = sum(points.map((p) => p.x)) / n;
  const meanY = sum(points.map((p) => p.y)) / n;
  const standardDistance = Math.sqrt(sum(points.map((p) => (p.x - meanX) ** 2 + (p.y - meanY) ** 2)) / n);
  const meanNn = sum(nearestNeighbors(points).d) / n;
  const density = n / area;
  const expectedNn = 0.5 / Math.sqrt(density);
  const se = 0.26136 / Math.sqrt(n * density);
  const z = (meanNn - expectedNn) / se;
  return {
    n,
    meanX,
    meanY,
    standardDistance,
    area,
    meanNn,
    expectedNn,
    r: meanNn / expectedNn,
    se,
    z,
    p: normalTwoSided(z),
  };
}

export interface Quadrats {
  readonly counts: number[];
  readonly mean: number;
  readonly variance: number;
  readonly vmr: number;
  readonly chi2: number;
  readonly df: number;
}

/** Counts in a grid of cols x rows equal cells over the window, and their variance-to-mean ratio. */
export function quadrats(points: readonly Point[], w: Window, cols: number, rows: number): Quadrats {
  const k = cols * rows;
  if (k < 2) fail('tooFewQuadrats');
  const counts = new Array<number>(k).fill(0);
  const cw = (w[1] - w[0]) / cols;
  const ch = (w[3] - w[2]) / rows;
  for (const p of points) {
    const c = Math.min(cols - 1, Math.max(0, Math.floor((p.x - w[0]) / cw)));
    const r = Math.min(rows - 1, Math.max(0, Math.floor((p.y - w[2]) / ch)));
    counts[r * cols + c]++;
  }
  const mean = sum(counts) / k;
  const variance = sum(counts.map((c) => (c - mean) ** 2)) / (k - 1);
  const vmr = mean > 0 ? variance / mean : NaN;
  return { counts, mean, variance, vmr, chi2: (k - 1) * vmr, df: k - 1 };
}

/**
 * Ripley's K at each distance by the border method: only points at least r from the window's edge are centers,
 * K(r) = (A / n) * mean over those centers of the count of other points within r. L(r) = sqrt(K / pi).
 */
export function ripleyK(points: readonly Point[], w: Window, radii: readonly number[]): number[] {
  const n = points.length;
  const area = windowArea(w);
  const edge = (p: Point) => Math.min(p.x - w[0], w[1] - p.x, p.y - w[2], w[3] - p.y);
  return radii.map((r) => {
    const centers = points.map((_, i) => i).filter((i) => edge(points[i]) >= r);
    if (centers.length === 0) return NaN;
    let count = 0;
    for (const i of centers) for (let j = 0; j < n; j++) if (j !== i && dist(points[i], points[j]) <= r) count++;
    return (area / n) * (count / centers.length);
  });
}

export interface Ripley {
  readonly radii: number[];
  readonly l: number[];
  readonly low: number[];
  readonly high: number[];
}

/** L(r) − r for the data, and its pointwise smallest and largest over seeded patterns of complete randomness. */
export function ripley(points: readonly Point[], w: Window, sims: number, seed: number): Ripley {
  const n = points.length;
  if (n < 3) fail('tooFewPoints', '3');
  const maxR = 0.25 * Math.min(w[1] - w[0], w[3] - w[2]);
  if (!(maxR > 0)) fail('areaPositive');
  const radii = Array.from({ length: 20 }, (_, i) => (maxR * (i + 1)) / 20);
  const centered = (k: number[]) => k.map((v, i) => Math.sqrt(v / Math.PI) - radii[i]);
  const l = centered(ripleyK(points, w, radii));
  const rng = makeRng(seed);
  const low = radii.map(() => Infinity);
  const high = radii.map(() => -Infinity);
  for (let s = 0; s < sims; s++) {
    const fake = Array.from({ length: n }, () => ({
      x: w[0] + rng.next() * (w[1] - w[0]),
      y: w[2] + rng.next() * (w[3] - w[2]),
    }));
    centered(ripleyK(fake, w, radii)).forEach((v, i) => {
      if (!Number.isFinite(v)) return;
      low[i] = Math.min(low[i], v);
      high[i] = Math.max(high[i], v);
    });
  }
  return { radii, l, low, high };
}

export type WeightKind = 'rook' | 'queen' | 'band' | 'knn' | 'inverse' | 'adjacency';

/** The spacing of a regular grid: the smallest positive gap between coordinates along either axis. */
function gridSpacing(points: readonly Point[]): number {
  let best = Infinity;
  for (const key of ['x', 'y'] as const) {
    const values = [...new Set(points.map((p) => p[key]))].sort((a, b) => a - b);
    for (let i = 1; i < values.length; i++) best = Math.min(best, values[i] - values[i - 1]);
  }
  if (!Number.isFinite(best)) fail('gridSpacing');
  return best;
}

/** Reads "1: 2 4" lines, 1-based, into neighbor lists; each link is made both ways. */
export function parseAdjacency(text: string, n: number): number[][] {
  const lists: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .forEach((line, at) => {
      if (line === '') return;
      const m = /^(\d+)\s*[:-]\s*([\d\s,]*)$/.exec(line);
      if (!m) fail('adjacencyLine', String(at + 1));
      const i = Number(m[1]) - 1;
      const others = m[2]
        .split(/[\s,]+/)
        .filter((s) => s !== '')
        .map((s) => Number(s) - 1);
      for (const j of [i, ...others]) if (!(j >= 0 && j < n)) fail('adjacencyIndex', `${j + 1}|${n}`);
      for (const j of others) {
        if (j === i) continue;
        lists[i].add(j);
        lists[j].add(i);
      }
    });
  return lists.map((s) => [...s].sort((a, b) => a - b));
}

export interface WeightOptions {
  readonly kind: WeightKind;
  readonly band?: number;
  readonly k?: number;
  readonly power?: number;
  readonly adjacency?: string;
  readonly standardize: boolean;
}

/** The spatial weights matrix W, with zeros on the diagonal, row-standardized when asked. */
export function spatialWeights(points: readonly Point[], o: WeightOptions): Matrix {
  const n = points.length;
  const w: Matrix = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const d = points.map((p) => points.map((q) => dist(p, q)));
  if (o.kind === 'rook' || o.kind === 'queen') {
    const h = gridSpacing(points);
    const near = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, h);
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dx = Math.abs(points[i].x - points[j].x);
        const dy = Math.abs(points[i].y - points[j].y);
        const rook = (near(dx, h) && near(dy, 0)) || (near(dy, h) && near(dx, 0));
        if (rook || (o.kind === 'queen' && near(dx, h) && near(dy, h))) w[i][j] = 1;
      }
  } else if (o.kind === 'band') {
    const band = Number(o.band);
    if (!(band > 0)) fail('bandPositive');
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j && d[i][j] <= band) w[i][j] = 1;
  } else if (o.kind === 'knn') {
    const k = Math.floor(Number(o.k));
    if (!(k >= 1 && k < n)) fail('knnRange', String(n - 1));
    for (let i = 0; i < n; i++) {
      const order = d[i]
        .map((_, j) => j)
        .filter((j) => j !== i)
        .sort((a, b) => d[i][a] - d[i][b]);
      for (const j of order.slice(0, k)) w[i][j] = 1;
    }
  } else if (o.kind === 'inverse') {
    const power = o.power ?? 1;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        if (d[i][j] === 0) fail('samePoint', `${i + 1}|${j + 1}`);
        w[i][j] = 1 / d[i][j] ** power;
      }
  } else {
    parseAdjacency(o.adjacency ?? '', n).forEach((list, i) => list.forEach((j) => (w[i][j] = 1)));
  }
  const lonely = w.findIndex((row) => sum(row) === 0);
  if (lonely >= 0) fail('noNeighbors', String(lonely + 1));
  if (o.standardize) return w.map((row) => row.map((v) => v / sum(row)));
  return w;
}

function weightSums(w: Matrix): { s0: number; s1: number; s2: number } {
  const n = w.length;
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    let row = 0;
    let col = 0;
    for (let j = 0; j < n; j++) {
      s0 += w[i][j];
      s1 += (w[i][j] + w[j][i]) ** 2;
      row += w[i][j];
      col += w[j][i];
    }
    s2 += (row + col) ** 2;
  }
  return { s0, s1: s1 / 2, s2 };
}

const moranOf = (w: Matrix, z: readonly number[], s0: number): number => {
  let num = 0;
  for (let i = 0; i < z.length; i++) for (let j = 0; j < z.length; j++) num += w[i][j] * z[i] * z[j];
  return (z.length / s0) * (num / sum(z.map((v) => v * v)));
};

const gearyOf = (w: Matrix, x: readonly number[], s0: number): number => {
  const n = x.length;
  const m = sum(x) / n;
  let num = 0;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) num += w[i][j] * (x[i] - x[j]) ** 2;
  return ((n - 1) * num) / (2 * s0 * sum(x.map((v) => (v - m) ** 2)));
};

export interface GlobalTest {
  readonly value: number;
  readonly expected: number;
  readonly variance: number;
  readonly z: number;
  readonly p: number;
  /** The share of permutations at least as far from the expected value, counting the data once. */
  readonly permP: number;
}

export interface LocalMoran {
  readonly i: number;
  readonly z: number;
  readonly lag: number;
  readonly p: number;
  readonly quadrant: 'hh' | 'hl' | 'lh' | 'll';
}

export interface Autocorrelation {
  readonly n: number;
  readonly s0: number;
  readonly moran: GlobalTest;
  readonly geary: GlobalTest;
  readonly local: readonly LocalMoran[];
}

/** Global Moran's I and Geary's C with the normality variances and seeded permutation tests, and local Moran. */
export function autocorrelation(x: readonly number[], w: Matrix, permutations: number, seed: number): Autocorrelation {
  const n = x.length;
  if (n < 3) fail('tooFewPoints', '3');
  const m = sum(x) / n;
  const z = x.map((v) => v - m);
  const m2 = sum(z.map((v) => v * v)) / n;
  if (!(m2 > 1e-300)) fail('constantValues');
  const { s0, s1, s2 } = weightSums(w);
  const eI = -1 / (n - 1);
  const vI = (n * n * s1 - n * s2 + 3 * s0 * s0) / ((n * n - 1) * s0 * s0) - eI * eI;
  const vC = ((2 * s1 + s2) * (n - 1) - 4 * s0 * s0) / (2 * (n + 1) * s0 * s0);
  const I = moranOf(w, z, s0);
  const C = gearyOf(w, x, s0);
  const rng = makeRng(seed);
  let farI = 1;
  let farC = 1;
  for (let s = 0; s < permutations; s++) {
    const mixed = shuffled(x, rng);
    if (
      Math.abs(
        moranOf(
          w,
          mixed.map((v) => v - m),
          s0,
        ) - eI,
      ) >=
      Math.abs(I - eI) - 1e-12
    )
      farI++;
    if (Math.abs(gearyOf(w, mixed, s0) - 1) >= Math.abs(C - 1) - 1e-12) farC++;
  }
  const test = (value: number, expected: number, variance: number, far: number): GlobalTest => {
    const zz = (value - expected) / Math.sqrt(variance);
    return { value, expected, variance, z: zz, p: normalTwoSided(zz), permP: far / (permutations + 1) };
  };
  const local = z.map((zi, i): LocalMoran => {
    const lag = sum(w[i].map((wij, j) => wij * z[j]));
    const ii = (zi / m2) * lag;
    let far = 1;
    const others = z.filter((_, j) => j !== i);
    for (let s = 0; s < permutations; s++) {
      const mix = shuffled(others, rng);
      let lagS = 0;
      let at = 0;
      for (let j = 0; j < n; j++) if (j !== i) lagS += w[i][j] * mix[at++];
      if (Math.abs((zi / m2) * lagS) >= Math.abs(ii) - 1e-12) far++;
    }
    const quadrant = zi >= 0 ? (lag >= 0 ? 'hh' : 'hl') : lag >= 0 ? 'lh' : 'll';
    return { i: ii, z: zi, lag, p: far / (permutations + 1), quadrant };
  });
  return { n, s0, moran: test(I, eI, vI, farI), geary: test(C, 1, vC, farC), local };
}

export type VariogramModel = 'spherical' | 'exponential' | 'gaussian';

export interface VariogramParams {
  readonly nugget: number;
  readonly sill: number;
  readonly range: number;
}

/** gamma(h) of a model with a nugget, a partial sill, and a range (the practical range for exponential, Gaussian). */
export function variogram(model: VariogramModel, p: VariogramParams, h: number): number {
  if (h === 0) return 0;
  const r = h / p.range;
  let shape: number;
  if (model === 'spherical') shape = r >= 1 ? 1 : 1.5 * r - 0.5 * r ** 3;
  else if (model === 'exponential') shape = 1 - Math.exp(-3 * r);
  else shape = 1 - Math.exp(-3 * r * r);
  return p.nugget + p.sill * shape;
}

export interface Lag {
  readonly h: number;
  readonly gamma: number;
  readonly pairs: number;
}

/** gamma(h) = 1 / (2 N(h)) * sum (z_i − z_j)^2 over the pairs in each distance bin of the given width. */
export function empiricalVariogram(points: readonly Point[], z: readonly number[], width: number, bins: number): Lag[] {
  if (!(width > 0)) fail('widthPositive');
  const sums = new Array<number>(bins).fill(0);
  const counts = new Array<number>(bins).fill(0);
  const hs = new Array<number>(bins).fill(0);
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++) {
      const h = dist(points[i], points[j]);
      const b = Math.floor(h / width);
      if (b >= bins) continue;
      sums[b] += (z[i] - z[j]) ** 2;
      counts[b]++;
      hs[b] += h;
    }
  const lags = counts
    .map((c, b) => ({ h: c > 0 ? hs[b] / c : NaN, gamma: c > 0 ? sums[b] / (2 * c) : NaN, pairs: c }))
    .filter((l) => l.pairs > 0);
  if (lags.length < 2) fail('fewLags');
  return lags;
}

export interface FittedVariogram extends VariogramParams {
  /** The range sits on its bound: no sill is reached within the data's extent (an unbounded variogram, likely a trend). */
  readonly noSill: boolean;
}

/**
 * The model's nugget, partial sill, and range by least squares on the bins, weighted by N(h) / gamma(h)^2. Each
 * parameter is bounded by a smooth map b * v^2 / (1 + v^2). The nugget's bound is the largest bin semivariance, the
 * partial sill's is 3 times it, and the range's is 2 times the largest lag distance. So a trending field cannot run
 * off to an unbounded linear variogram with a huge sill and range.
 */
export function fitVariogram(model: VariogramModel, lags: readonly Lag[]): FittedVariogram {
  const maxG = Math.max(...lags.map((l) => l.gamma));
  const maxH = Math.max(...lags.map((l) => l.h));
  const bounds = [maxG, 3 * maxG, 2 * maxH];
  const squash = (v: number, b: number) => (b * v * v) / (1 + v * v);
  const open = (x: number, b: number) => Math.sqrt(x / (b - x));
  const unpack = (v: readonly number[]): VariogramParams => ({
    nugget: squash(v[0], bounds[0]),
    sill: squash(v[1], bounds[1]),
    range: squash(v[2], bounds[2]) + 1e-12,
  });
  const loss = (v: readonly number[]) => {
    const p = unpack(v);
    return sum(
      lags.map((l) => {
        const g = variogram(model, p, l.h);
        return (l.pairs * (l.gamma - g) ** 2) / Math.max(g, 1e-12) ** 2;
      }),
    );
  };
  const best = nelderMead(loss, [
    open(0.1 * maxG, bounds[0]),
    open(0.9 * maxG, bounds[1]),
    open(0.6 * maxH, bounds[2]),
  ]);
  const p = unpack(best.x);
  return { ...p, noSill: p.range >= 0.98 * bounds[2] };
}

export interface Kriged {
  readonly value: number;
  readonly variance: number;
  readonly weights: number[];
  readonly lagrange: number;
}

/** Ordinary kriging: solve [Γ 1; 1' 0][λ; μ] = [γ0; 1]; the estimate is λ'z and the variance λ'γ0 + μ. */
export function krige(
  points: readonly Point[],
  z: readonly number[],
  at: Point,
  model: VariogramModel,
  p: VariogramParams,
): Kriged {
  const n = points.length;
  if (n < 2) fail('tooFewPoints', '2');
  const gamma = (i: number, j: number) => variogram(model, p, dist(points[i], points[j]));
  const a: Matrix = Array.from({ length: n + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === n && j === n ? 0 : i === n || j === n ? 1 : gamma(i, j))),
  );
  const g0 = points.map((q) => variogram(model, p, dist(q, at)));
  const sol = solve(a, [...g0, 1]);
  if (!sol || sol.some((v) => !Number.isFinite(v))) fail('krigingSingular');
  const weights = sol.slice(0, n);
  const lagrange = sol[n];
  const value = sum(weights.map((l, i) => l * z[i]));
  const variance = sum(weights.map((l, i) => l * g0[i])) + lagrange;
  return { value, variance: Math.max(0, variance), weights, lagrange };
}

/** Inverse-distance weighting with weights 1 / d^power; at a data point it returns that point's value. */
export function idw(points: readonly Point[], z: readonly number[], at: Point, power: number): number {
  let num = 0;
  let den = 0;
  for (let i = 0; i < points.length; i++) {
    const d = dist(points[i], at);
    if (d === 0) return z[i];
    const w = 1 / d ** power;
    num += w * z[i];
    den += w;
  }
  return num / den;
}
