// Principal components and exploratory factor analysis. PCA takes the eigenvalues and eigenvectors of the covariance
// or correlation matrix. Principal axis factoring starts each communality at its squared multiple correlation and
// refits until the communalities settle. Varimax turns the loadings by Kaiser's pairwise rotations. Promax raises
// the varimax loadings to the 4th power as a target and lets the factors correlate. Parallel analysis keeps a factor
// when its eigenvalue beats the 95th percentile from seeded random data of the same size.
import { inverse, matMul, mean, symmetricEigen, transpose, type Matrix } from '../kit/linalg';
import { makeRng } from '../kit/rng';
import { fail } from '../kit/types';

const sum = (xs: readonly number[]) => xs.reduce((s, v) => s + v, 0);

export function checkMatrix(x: Matrix, minRows: number): void {
  if (x.length < minRows) fail('tooFewRows', `${x.length}|${minRows}`);
  if ((x[0]?.length ?? 0) < 2) fail('fewColumns');
}

/** The covariance (or correlation) matrix of the columns, with n − 1 in the denominator. */
export function covariance(x: Matrix, correlation: boolean): { s: Matrix; means: number[]; sds: number[] } {
  const n = x.length;
  const p = x[0].length;
  const means = Array.from({ length: p }, (_, j) => mean(x.map((r) => r[j])));
  const s: Matrix = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (const row of x)
    for (let a = 0; a < p; a++) for (let b = a; b < p; b++) s[a][b] += (row[a] - means[a]) * (row[b] - means[b]);
  for (let a = 0; a < p; a++) for (let b = a; b < p; b++) s[b][a] = s[a][b] = s[a][b] / (n - 1);
  const sds = s.map((row, j) => Math.sqrt(row[j]));
  const flat = sds.findIndex((v) => !(v > 0));
  if (flat >= 0) fail('constantColumn', String(flat + 1));
  if (!correlation) return { s, means, sds };
  return { s: s.map((row, a) => row.map((v, b) => v / (sds[a] * sds[b]))), means, sds };
}

export interface Pca {
  readonly eigenvalues: number[];
  readonly explained: number[];
  readonly cumulative: number[];
  /** vectors[k][j]: the weight of column j in component k. */
  readonly vectors: number[][];
  /** scores[i][k]. */
  readonly scores: number[][];
  readonly correlation: boolean;
}

/** PCA. Each eigenvector's sign is set so its largest weight is positive, so results do not flip between runs. */
export function pca(x: Matrix, correlation: boolean): Pca {
  checkMatrix(x, 3);
  const { s, means, sds } = covariance(x, correlation);
  const e = symmetricEigen(s);
  const vectors = e.vectors.map((v) => {
    const big = v.reduce((m, w) => (Math.abs(w) > Math.abs(m) ? w : m), 0);
    return big < 0 ? v.map((w) => -w) : v;
  });
  const total = sum(e.values);
  const explained = e.values.map((v) => (100 * v) / total);
  let run = 0;
  const cumulative = explained.map((v) => (run += v));
  const scores = x.map((row) => {
    const z = row.map((v, j) => (v - means[j]) / (correlation ? sds[j] : 1));
    return vectors.map((v) => sum(v.map((w, j) => w * z[j])));
  });
  return { eigenvalues: e.values, explained, cumulative, vectors, scores, correlation };
}

export interface Factors {
  readonly loadings: Matrix;
  readonly communalities: number[];
  readonly uniqueness: number[];
  readonly iterations: number;
  readonly eigenvalues: number[];
  readonly phi: Matrix | null;
  readonly variance: number[];
}

/** Principal axis factoring of a correlation matrix with k factors. */
export function principalAxis(r: Matrix, k: number): { loadings: Matrix; h2: number[]; iterations: number } {
  const p = r.length;
  if (!(k >= 1 && k < p)) fail('factorCount', String(p - 1));
  const inv = inverse(r);
  let h2 = inv ? inv.map((row, j) => Math.min(0.995, Math.max(0.005, 1 - 1 / row[j]))) : r.map(() => 0.5);
  let loadings: Matrix = [];
  let iterations = 0;
  for (; iterations < 1000; iterations++) {
    const reduced = r.map((row, a) => row.map((v, b) => (a === b ? h2[a] : v)));
    const e = symmetricEigen(reduced);
    loadings = Array.from({ length: p }, (_, j) =>
      e.vectors.slice(0, k).map((v, f) => v[j] * Math.sqrt(Math.max(0, e.values[f]))),
    );
    const next = loadings.map((row) => sum(row.map((v) => v * v)));
    const change = Math.max(...next.map((v, j) => Math.abs(v - h2[j])));
    h2 = next;
    if (change < 1e-8) break;
  }
  if (h2.some((v) => v > 1 + 1e-6)) fail('heywood');
  return { loadings, h2, iterations: iterations + 1 };
}

/** Varimax with Kaiser normalization, by pairwise rotations until no angle exceeds 1e-8. */
export function varimax(loadings: Matrix): Matrix {
  const p = loadings.length;
  const k = loadings[0].length;
  const h = loadings.map((row) => Math.sqrt(sum(row.map((v) => v * v))) || 1);
  const l = loadings.map((row, j) => row.map((v) => v / h[j]));
  for (let sweep = 0; sweep < 500; sweep++) {
    let biggest = 0;
    for (let a = 0; a < k - 1; a++)
      for (let b = a + 1; b < k; b++) {
        let A = 0;
        let B = 0;
        let C = 0;
        let D = 0;
        for (let j = 0; j < p; j++) {
          const u = l[j][a] ** 2 - l[j][b] ** 2;
          const v = 2 * l[j][a] * l[j][b];
          A += u;
          B += v;
          C += u * u - v * v;
          D += 2 * u * v;
        }
        const angle = 0.25 * Math.atan2(D - (2 * A * B) / p, C - (A * A - B * B) / p);
        biggest = Math.max(biggest, Math.abs(angle));
        const [c, s] = [Math.cos(angle), Math.sin(angle)];
        for (let j = 0; j < p; j++) {
          const [x, y] = [l[j][a], l[j][b]];
          l[j][a] = c * x + s * y;
          l[j][b] = -s * x + c * y;
        }
      }
    if (biggest < 1e-8) break;
  }
  return l.map((row, j) => row.map((v) => v * h[j]));
}

/** Promax: a target from the varimax loadings to the given power, then an oblique turn toward it. */
export function promax(vari: Matrix, power = 4): { pattern: Matrix; phi: Matrix } {
  const target = vari.map((row) => row.map((v) => Math.sign(v) * Math.abs(v) ** power));
  const lt = transpose(vari);
  const ltlInv = inverse(matMul(lt, vari));
  if (!ltlInv) fail('singularDesign');
  let u = matMul(matMul(ltlInv, lt), target);
  const uu = inverse(matMul(transpose(u), u));
  if (!uu) fail('singularDesign');
  const scale = uu.map((row, j) => Math.sqrt(row[j]));
  u = u.map((row) => row.map((v, j) => v * scale[j]));
  const pattern = matMul(vari, u);
  const uInv = inverse(u);
  if (!uInv) fail('singularDesign');
  const phi = matMul(uInv, transpose(uInv));
  return { pattern, phi };
}

export type Rotation = 'none' | 'varimax' | 'promax';

export function factorAnalysis(x: Matrix, k: number, rotation: Rotation): Factors {
  checkMatrix(x, 4);
  const { s: r } = covariance(x, true);
  const fit = principalAxis(r, k);
  let loadings = fit.loadings;
  let phi: Matrix | null = null;
  if (rotation !== 'none' && k > 1) {
    loadings = varimax(loadings);
    if (rotation === 'promax') {
      const pm = promax(loadings);
      loadings = pm.pattern;
      phi = pm.phi;
    }
  }
  const flip = Array.from({ length: k }, (_, f) => (sum(loadings.map((row) => row[f])) < 0 ? -1 : 1));
  loadings = loadings.map((row) => row.map((v, f) => v * flip[f]));
  if (phi) phi = phi.map((row, a) => row.map((v, b) => v * flip[a] * flip[b]));
  return {
    loadings,
    communalities: fit.h2,
    uniqueness: fit.h2.map((h) => 1 - h),
    iterations: fit.iterations,
    eigenvalues: symmetricEigen(r).values,
    phi,
    variance: Array.from({ length: k }, (_, f) => sum(loadings.map((row) => row[f] ** 2))),
  };
}

/** The 95th percentile of each eigenvalue of the correlation matrix of seeded normal data of the same size. */
export function parallelAnalysis(n: number, p: number, sims: number, seed: number): number[] {
  const rng = makeRng(seed);
  const all: number[][] = Array.from({ length: p }, () => []);
  for (let s = 0; s < sims; s++) {
    const x = Array.from({ length: n }, () => Array.from({ length: p }, () => rng.normal()));
    symmetricEigen(covariance(x, true).s).values.forEach((v, j) => all[j].push(v));
  }
  return all.map((vals) => {
    vals.sort((a, b) => a - b);
    return vals[Math.min(vals.length - 1, Math.floor(0.95 * vals.length))];
  });
}
