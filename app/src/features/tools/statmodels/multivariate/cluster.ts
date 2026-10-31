// Clustering and scaling. K-means moves each center to the mean of its points (Lloyd's iterations), starting from
// k-means++ seeds drawn with a seeded generator. The silhouette compares each point's distance to its own cluster
// with the nearest other one. Agglomerative clustering joins the closest pair and updates distances by the
// Lance-Williams formula; Ward's method works on squared distances and reports their square roots, as ward.D2 does.
// Classical multidimensional scaling takes the eigenvectors of B = −½ J D² J.
import { symmetricEigen, type Matrix } from '../kit/linalg';
import { makeRng } from '../kit/rng';
import { fail } from '../kit/types';

const sum = (xs: readonly number[]) => xs.reduce((s, v) => s + v, 0);
const sq = (a: readonly number[], b: readonly number[]) => sum(a.map((v, j) => (v - b[j]) ** 2));

export type Metric = 'euclidean' | 'manhattan' | 'correlation';

export function distance(a: readonly number[], b: readonly number[], metric: Metric): number {
  if (metric === 'manhattan') return sum(a.map((v, j) => Math.abs(v - b[j])));
  if (metric === 'correlation') {
    const ma = sum(a) / a.length;
    const mb = sum(b) / b.length;
    const num = sum(a.map((v, j) => (v - ma) * (b[j] - mb)));
    const den = Math.sqrt(sum(a.map((v) => (v - ma) ** 2)) * sum(b.map((v) => (v - mb) ** 2)));
    if (!(den > 0)) fail('flatProfile');
    return 1 - num / den;
  }
  return Math.sqrt(sq(a, b));
}

export const distanceMatrix = (x: Matrix, metric: Metric): Matrix => x.map((a) => x.map((b) => distance(a, b, metric)));

export interface KMeans {
  readonly centers: Matrix;
  readonly cluster: number[];
  readonly withinSs: number[];
  readonly totalWithin: number;
  readonly betweenSs: number;
  readonly iterations: number;
  readonly sizes: number[];
}

/** k-means++: the first center at random, each next one with chance proportional to its squared distance. */
export function plusPlus(x: Matrix, k: number, seed: number): Matrix {
  const rng = makeRng(seed);
  const centers = [x[rng.int(x.length)]];
  while (centers.length < k) {
    const d = x.map((row) => Math.min(...centers.map((c) => sq(row, c))));
    const total = sum(d);
    let pick = rng.next() * total;
    let at = 0;
    while (at < x.length - 1 && pick >= d[at]) pick -= d[at++];
    centers.push(x[at]);
  }
  return centers.map((c) => [...c]);
}

/** Lloyd's iterations from the given centers until no point changes cluster. */
export function kMeans(x: Matrix, start: Matrix): KMeans {
  const k = start.length;
  if (!(k >= 1 && k <= x.length)) fail('clusterCount', String(x.length));
  let centers = start.map((c) => [...c]);
  let cluster = new Array<number>(x.length).fill(-1);
  let iterations = 0;
  for (; iterations < 500; iterations++) {
    const next = x.map((row) => {
      let best = 0;
      for (let c = 1; c < k; c++) if (sq(row, centers[c]) < sq(row, centers[best])) best = c;
      return best;
    });
    const same = next.every((c, i) => c === cluster[i]);
    cluster = next;
    centers = centers.map((old, c) => {
      const members = x.filter((_, i) => cluster[i] === c);
      return members.length ? old.map((_, j) => sum(members.map((m) => m[j])) / members.length) : old;
    });
    if (same) break;
  }
  const grand = x[0].map((_, j) => sum(x.map((r) => r[j])) / x.length);
  const withinSs = centers.map((c, k2) => sum(x.filter((_, i) => cluster[i] === k2).map((r) => sq(r, c))));
  const totalWithin = sum(withinSs);
  return {
    centers,
    cluster,
    withinSs,
    totalWithin,
    betweenSs: sum(x.map((r) => sq(r, grand))) - totalWithin,
    iterations: iterations + 1,
    sizes: centers.map((_, c) => cluster.filter((v) => v === c).length),
  };
}

/** The best of several seeded k-means++ starts, by total within-cluster sum of squares. */
export function kMeansBest(x: Matrix, k: number, seed: number, starts: number): KMeans {
  let best: KMeans | null = null;
  for (let s = 0; s < starts; s++) {
    const fit = kMeans(x, plusPlus(x, k, seed + s));
    if (!best || fit.totalWithin < best.totalWithin - 1e-12) best = fit;
  }
  return best as KMeans;
}

/** The mean silhouette width, and each point's: (b − a) / max(a, b). */
export function silhouette(
  x: Matrix,
  cluster: readonly number[],
  metric: Metric = 'euclidean',
): { mean: number; each: number[] } {
  const d = distanceMatrix(x, metric);
  const k = Math.max(...cluster) + 1;
  const each = x.map((_, i) => {
    const own = cluster[i];
    const avg = (c: number) => {
      const others = x.map((__, j) => j).filter((j) => cluster[j] === c && j !== i);
      return others.length ? sum(others.map((j) => d[i][j])) / others.length : NaN;
    };
    const a = avg(own);
    if (Number.isNaN(a)) return 0;
    const b = Math.min(
      ...Array.from({ length: k }, (_, c) => (c === own ? Infinity : avg(c))).filter((v) => !Number.isNaN(v)),
    );
    return Number.isFinite(b) ? (b - a) / Math.max(a, b) : 0;
  });
  return { mean: sum(each) / each.length, each };
}

export type Linkage = 'single' | 'complete' | 'average' | 'ward';

export interface Merge {
  /** The 2 clusters joined: a point index (0 to n − 1) or n + the step that made a cluster. */
  readonly a: number;
  readonly b: number;
  readonly height: number;
  readonly size: number;
}

/** Agglomerative clustering by the Lance-Williams update. */
export function agglomerate(d: Matrix, linkage: Linkage): Merge[] {
  const n = d.length;
  if (n < 2) fail('tooFewRows', `${n}|2`);
  const ward = linkage === 'ward';
  const dist: Matrix = d.map((row) => row.map((v) => (ward ? v * v : v)));
  const active = new Set(Array.from({ length: n }, (_, i) => i));
  const id = Array.from({ length: n }, (_, i) => i);
  const size = new Array<number>(n).fill(1);
  const merges: Merge[] = [];
  for (let step = 0; step < n - 1; step++) {
    let bi = -1;
    let bj = -1;
    let best = Infinity;
    for (const i of active)
      for (const j of active) if (i < j && dist[i][j] < best - 1e-12) [best, bi, bj] = [dist[i][j], i, j];
    const [ni, nj] = [size[bi], size[bj]];
    for (const k of active) {
      if (k === bi || k === bj) continue;
      const nk = size[k];
      const [dki, dkj] = [dist[k][bi], dist[k][bj]];
      let v: number;
      if (linkage === 'single') v = Math.min(dki, dkj);
      else if (linkage === 'complete') v = Math.max(dki, dkj);
      else if (linkage === 'average') v = (ni * dki + nj * dkj) / (ni + nj);
      else v = ((ni + nk) * dki + (nj + nk) * dkj - nk * best) / (ni + nj + nk);
      dist[k][bi] = dist[bi][k] = v;
    }
    merges.push({ a: id[bi], b: id[bj], height: ward ? Math.sqrt(best) : best, size: ni + nj });
    active.delete(bj);
    size[bi] = ni + nj;
    id[bi] = n + step;
  }
  return merges;
}

/** Cluster labels (0 to k − 1) from cutting the tree into k groups. */
export function cutTree(merges: readonly Merge[], n: number, k: number): number[] {
  if (!(k >= 1 && k <= n)) fail('clusterCount', String(n));
  const parent = Array.from({ length: 2 * n - 1 }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  merges.slice(0, n - k).forEach((m, s) => {
    parent[find(m.a)] = n + s;
    parent[find(m.b)] = n + s;
  });
  const roots = new Map<number, number>();
  return Array.from({ length: n }, (_, i) => {
    const r = find(i);
    if (!roots.has(r)) roots.set(r, roots.size);
    return roots.get(r) as number;
  });
}

/** The leaves in the order a dendrogram draws them. */
export function leafOrder(merges: readonly Merge[], n: number): number[] {
  const walk = (node: number): number[] =>
    node < n ? [node] : [...walk(merges[node - n].a), ...walk(merges[node - n].b)];
  return merges.length ? walk(n + merges.length - 1) : [0];
}

export interface Mds {
  readonly eigenvalues: number[];
  readonly coords: Matrix;
  readonly fit: number;
}

/** Classical (Torgerson) scaling into 2 dimensions. */
export function classicalMds(d: Matrix): Mds {
  const n = d.length;
  if (n < 3) fail('tooFewRows', `${n}|3`);
  if (d.some((row) => row.length !== n)) fail('notSquare');
  d.forEach((row, i) =>
    row.forEach((v, j) => {
      if (!(v >= 0) || Math.abs(v - d[j][i]) > 1e-9 * (1 + Math.abs(v)) || (i === j && v !== 0)) fail('badDistances');
    }),
  );
  const d2 = d.map((row) => row.map((v) => v * v));
  const rowMean = d2.map((row) => sum(row) / n);
  const all = sum(rowMean) / n;
  const b = d2.map((row, i) => row.map((v, j) => -0.5 * (v - rowMean[i] - rowMean[j] + all)));
  const e = symmetricEigen(b);
  const coords = Array.from({ length: n }, (_, i) =>
    [0, 1].map((k) => e.vectors[k][i] * Math.sqrt(Math.max(0, e.values[k]))),
  );
  const positive = sum(e.values.filter((v) => v > 0));
  return {
    eigenvalues: e.values,
    coords,
    fit: positive > 0 ? (Math.max(0, e.values[0]) + Math.max(0, e.values[1])) / positive : NaN,
  };
}
