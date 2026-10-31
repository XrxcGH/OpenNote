// The numbers of the multiple-testing and meta-analysis tool: Hommel's adjustment (the others are in num/adjust),
// Fisher's and Stouffer's combined tests, and fixed- and random-effects meta-analysis (DerSimonian-Laird and REML).
// Egger's test and the effect sizes from summary data are here too.
import { chiSquareSf, normalQuantile, normalSf, tQuantile, tSf } from '../../subjects/stats/dist';
import { check } from '../report';

export function checkP(p: readonly number[]): void {
  check(p.length >= 1, 'empty');
  for (const v of p) check(Number.isFinite(v) && v >= 0 && v <= 1, 'pRange', { text: String(v) });
}

/** Hommel's adjustment, as in R's p.adjust: for each m from n − 1 down to 2, the Simes bound over every subset size. */
export function hommel(p: readonly number[]): number[] {
  const n = p.length;
  if (n < 2) return [...p];
  const order = p.map((_, i) => i).sort((a, b) => p[a] - p[b] || a - b);
  const s = order.map((i) => p[i]);
  const initial = Math.min(...s.map((v, i) => (n * v) / (i + 1)));
  const pa = new Array<number>(n).fill(initial);
  const q = new Array<number>(n).fill(initial);
  for (let m = n - 1; m >= 2; m -= 1) {
    let q1 = Number.POSITIVE_INFINITY;
    for (let j = n - m + 1; j < n; j += 1) q1 = Math.min(q1, (m * s[j]) / (j - (n - m) + 1));
    for (let i = 0; i <= n - m; i += 1) q[i] = Math.min(m * s[i], q1);
    for (let i = n - m + 1; i < n; i += 1) q[i] = q[n - m];
    for (let i = 0; i < n; i += 1) pa[i] = Math.max(pa[i], q[i]);
  }
  const out = new Array<number>(n);
  order.forEach((index, rank) => (out[index] = Math.min(1, Math.max(pa[rank], s[rank]))));
  return out;
}

export interface Combined {
  readonly fisher: number;
  readonly fisherDf: number;
  readonly fisherP: number;
  readonly stouffer: number;
  readonly stoufferP: number;
}

/** Fisher's X² = −2 Σ ln p on 2k df, and Stouffer's Z = Σ wᵢ zᵢ / √(Σ wᵢ²) with zᵢ = Φ⁻¹(1 − pᵢ) (one-sided p). */
export function combine(p: readonly number[], weights?: readonly number[]): Combined {
  checkP(p);
  check(
    p.every((v) => v > 0 && v < 1),
    'pOpen',
  );
  const w = weights && weights.length ? weights : p.map(() => 1);
  check(w.length === p.length, 'weightsLength');
  check(w.every((v) => Number.isFinite(v) && v >= 0) && w.some((v) => v > 0), 'negativeWeight');
  const fisher = -2 * p.reduce((s, v) => s + Math.log(v), 0);
  const z = p.map((v) => normalQuantile(1 - v));
  const stouffer = z.reduce((s, v, i) => s + w[i] * v, 0) / Math.sqrt(w.reduce((s, v) => s + v * v, 0));
  return {
    fisher,
    fisherDf: 2 * p.length,
    fisherP: chiSquareSf(fisher, 2 * p.length),
    stouffer,
    stoufferP: normalSf(stouffer),
  };
}

export interface Study {
  readonly label: string;
  readonly y: number;
  /** The sampling variance of y. */
  readonly v: number;
}

export interface Pooled {
  readonly estimate: number;
  readonly se: number;
  readonly lower: number;
  readonly upper: number;
  readonly z: number;
  readonly p: number;
  readonly weights: readonly number[];
}

export interface Meta {
  readonly fixed: Pooled;
  readonly random: Pooled;
  readonly q: number;
  readonly df: number;
  readonly pQ: number;
  readonly i2: number;
  readonly tau2: number;
  readonly method: 'dl' | 'reml';
  readonly converged: boolean;
  readonly prediction: { lower: number; upper: number } | null;
}

function pool(studies: readonly Study[], tau2: number, zc: number): Pooled {
  const weights = studies.map((s) => 1 / (s.v + tau2));
  const total = weights.reduce((a, b) => a + b, 0);
  const estimate = studies.reduce((s, st, i) => s + weights[i] * st.y, 0) / total;
  const se = Math.sqrt(1 / total);
  const z = estimate / se;
  return {
    estimate,
    se,
    lower: estimate - zc * se,
    upper: estimate + zc * se,
    z,
    p: Math.min(1, 2 * normalSf(Math.abs(z))),
    weights: weights.map((w) => w / total),
  };
}

/** REML τ² by the fixed-point form of Fisher scoring, started at the DerSimonian-Laird value and kept at 0 or more. */
function remlTau2(studies: readonly Study[], start: number): { tau2: number; converged: boolean } {
  let tau2 = start;
  for (let iteration = 0; iteration < 500; iteration += 1) {
    const w = studies.map((s) => 1 / (s.v + tau2));
    const total = w.reduce((a, b) => a + b, 0);
    const mu = studies.reduce((s, st, i) => s + w[i] * st.y, 0) / total;
    const w2 = w.reduce((s, v) => s + v * v, 0);
    const top = studies.reduce((s, st, i) => s + w[i] * w[i] * ((st.y - mu) ** 2 - st.v), 0);
    const next = Math.max(0, top / w2 + 1 / total);
    if (Math.abs(next - tau2) < 1e-12 * (1 + tau2)) return { tau2: next, converged: true };
    tau2 = next;
  }
  return { tau2, converged: false };
}

/** Fixed-effect (inverse variance) and random-effects meta-analysis with Q, I², τ², and the prediction interval. */
export function metaAnalysis(studies: readonly Study[], method: 'dl' | 'reml' = 'dl', confidence = 0.95): Meta {
  check(studies.length >= 2, 'fewStudies');
  check(confidence > 0 && confidence < 1, 'confidenceRange');
  for (const s of studies) {
    check(Number.isFinite(s.y), 'notNumber', { text: s.label });
    check(Number.isFinite(s.v) && s.v > 0, 'variancePositive', { text: s.label });
  }
  const zc = normalQuantile(1 - (1 - confidence) / 2);
  const fixed = pool(studies, 0, zc);
  const w = studies.map((s) => 1 / s.v);
  const sw = w.reduce((a, b) => a + b, 0);
  const sw2 = w.reduce((a, b) => a + b * b, 0);
  const q = studies.reduce((s, st, i) => s + w[i] * (st.y - fixed.estimate) ** 2, 0);
  const df = studies.length - 1;
  const dl = Math.max(0, (q - df) / (sw - sw2 / sw));
  const reml = method === 'reml' ? remlTau2(studies, dl) : { tau2: dl, converged: true };
  const random = pool(studies, reml.tau2, zc);
  const k = studies.length;
  const t = k >= 3 ? tQuantile(1 - (1 - confidence) / 2, k - 2) : Number.NaN;
  const half = t * Math.sqrt(reml.tau2 + random.se ** 2);
  return {
    fixed,
    random,
    q,
    df,
    pQ: chiSquareSf(q, df),
    i2: q > df ? (q - df) / q : 0,
    tau2: reml.tau2,
    method,
    converged: reml.converged,
    prediction: k >= 3 ? { lower: random.estimate - half, upper: random.estimate + half } : null,
  };
}

/** Egger's test: regress y/se on 1/se; the intercept measures funnel asymmetry, tested with k − 2 df. */
export function egger(studies: readonly Study[]): { intercept: number; se: number; t: number; df: number; p: number } {
  check(studies.length >= 3, 'eggerFew');
  const x = studies.map((s) => 1 / Math.sqrt(s.v));
  const y = studies.map((s) => s.y / Math.sqrt(s.v));
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  const sxx = x.reduce((s, v) => s + (v - mx) ** 2, 0);
  check(sxx > 0, 'eggerSame');
  const slope = x.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0) / sxx;
  const intercept = my - slope * mx;
  const residual = y.reduce((s, v, i) => s + (v - intercept - slope * x[i]) ** 2, 0) / (n - 2);
  const se = Math.sqrt(residual * (1 / n + (mx * mx) / sxx));
  const t = intercept / se;
  return { intercept, se, t, df: n - 2, p: Math.min(1, 2 * tSf(Math.abs(t), n - 2)) };
}

/** Hedges' g (bias-corrected standardized mean difference) and its variance, from two groups' summaries. */
export function hedgesG(
  m1: number,
  sd1: number,
  n1: number,
  m2: number,
  sd2: number,
  n2: number,
): { y: number; v: number } {
  check(n1 >= 2 && n2 >= 2 && sd1 > 0 && sd2 > 0, 'summaryRange');
  const pooled = Math.sqrt(((n1 - 1) * sd1 * sd1 + (n2 - 1) * sd2 * sd2) / (n1 + n2 - 2));
  const d = (m1 - m2) / pooled;
  const j = 1 - 3 / (4 * (n1 + n2 - 2) - 1);
  const v = (n1 + n2) / (n1 * n2) + (d * d) / (2 * (n1 + n2));
  return { y: j * d, v: j * j * v };
}

/** The raw mean difference and its variance. */
export function meanDifference(
  m1: number,
  sd1: number,
  n1: number,
  m2: number,
  sd2: number,
  n2: number,
): { y: number; v: number } {
  check(n1 >= 2 && n2 >= 2 && sd1 > 0 && sd2 > 0, 'summaryRange');
  return { y: m1 - m2, v: (sd1 * sd1) / n1 + (sd2 * sd2) / n2 };
}

/** The log odds or risk ratio of a 2 × 2 table, adding 0.5 to each cell when one is 0. */
export function logRatio(kind: 'or' | 'rr', a0: number, b0: number, c0: number, d0: number): { y: number; v: number } {
  for (const v of [a0, b0, c0, d0]) check(Number.isFinite(v) && v >= 0, 'negativeCount', { text: String(v) });
  const h = [a0, b0, c0, d0].some((v) => v === 0) ? 0.5 : 0;
  const [a, b, c, d] = [a0 + h, b0 + h, c0 + h, d0 + h];
  if (kind === 'or') return { y: Math.log((a * d) / (b * c)), v: 1 / a + 1 / b + 1 / c + 1 / d };
  return { y: Math.log(a / (a + b) / (c / (c + d))), v: 1 / a - 1 / (a + b) + 1 / c - 1 / (c + d) };
}

/** Fisher's z of a correlation, with variance 1/(n − 3). */
export function fisherZ(r: number, n: number): { y: number; v: number } {
  check(r > -1 && r < 1 && n >= 4, 'correlationOpen');
  return { y: Math.atanh(r), v: 1 / (n - 3) };
}
