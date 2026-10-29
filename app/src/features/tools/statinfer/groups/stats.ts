// The ANOVA family's numbers: one-way and Welch ANOVA, Levene and Brown-Forsythe tests, Shapiro-Wilk, post-hoc
// comparisons (Tukey-Kramer, Games-Howell, pairwise t with an adjustment, planned contrasts), two-way ANOVA with
// Type II and III sums of squares, repeated measures with sphericity corrections, a mixed design, and effect sizes.
import { brent } from '../../kits/num/roots';
import { qrDecompose, qrSolve } from '../../kits/num/matrix/qr';
import {
  chiSquareSf,
  fSf,
  noncentralTCdf,
  normalQuantile,
  normalSf,
  studentizedRangeCdf,
  tQuantile,
  tSf,
} from '../../subjects/stats/dist';
import { adjust, type Adjustment } from '../num/adjust';
import { check } from '../report';

const sum = (v: readonly number[]) => v.reduce((a, b) => a + b, 0);
const mean = (v: readonly number[]) => sum(v) / v.length;
const variance = (v: readonly number[]) => {
  const m = mean(v);
  return sum(v.map((x) => (x - m) ** 2)) / (v.length - 1);
};
const median = (v: readonly number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const h = Math.floor(s.length / 2);
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
};

export function checkGroups(groups: readonly (readonly number[])[], min = 2): void {
  check(groups.length >= 2, 'twoGroups');
  for (const g of groups) {
    check(g.length >= min, 'groupSize', { min: `${min}` });
    check(g.every(Number.isFinite), 'notNumber', { text: '—' });
  }
}

export interface OneWay {
  readonly k: number;
  readonly n: number;
  readonly means: readonly number[];
  readonly sds: readonly number[];
  readonly sizes: readonly number[];
  readonly grand: number;
  readonly ssb: number;
  readonly ssw: number;
  readonly sst: number;
  readonly dfb: number;
  readonly dfw: number;
  readonly msb: number;
  readonly msw: number;
  readonly f: number;
  readonly p: number;
  readonly eta2: number;
  readonly omega2: number;
  readonly cohenF: number;
}

export function oneWay(groups: readonly (readonly number[])[]): OneWay {
  checkGroups(groups, 1);
  const sizes = groups.map((g) => g.length);
  const n = sum(sizes);
  const k = groups.length;
  check(n > k, 'tooFew', { min: `${k + 1}` });
  const means = groups.map(mean);
  const grand = sum(groups.map(sum)) / n;
  const ssb = sum(means.map((m, i) => sizes[i] * (m - grand) ** 2));
  const ssw = sum(groups.map((g, i) => sum(g.map((x) => (x - means[i]) ** 2))));
  const sst = ssb + ssw;
  check(sst > 0, 'constant');
  const dfb = k - 1;
  const dfw = n - k;
  const msb = ssb / dfb;
  const msw = ssw / dfw;
  const f = msw > 0 ? msb / msw : Number.POSITIVE_INFINITY;
  const eta2 = ssb / sst;
  return {
    k,
    n,
    means,
    sds: groups.map((g) => (g.length > 1 ? Math.sqrt(variance(g)) : Number.NaN)),
    sizes,
    grand,
    ssb,
    ssw,
    sst,
    dfb,
    dfw,
    msb,
    msw,
    f,
    p: fSf(f, dfb, dfw),
    eta2,
    omega2: (ssb - dfb * msw) / (sst + msw),
    cohenF: Math.sqrt(eta2 / (1 - eta2)),
  };
}

/** Welch's ANOVA for unequal variances. */
export function welch(groups: readonly (readonly number[])[]): { f: number; df1: number; df2: number; p: number } {
  checkGroups(groups, 2);
  const k = groups.length;
  const w = groups.map((g) => g.length / variance(g));
  check(w.every(Number.isFinite), 'zeroVariance');
  const W = sum(w);
  const means = groups.map(mean);
  const mw = sum(w.map((wi, i) => wi * means[i])) / W;
  const lambda = sum(w.map((wi, i) => (1 - wi / W) ** 2 / (groups[i].length - 1)));
  const top = sum(w.map((wi, i) => wi * (means[i] - mw) ** 2)) / (k - 1);
  const f = top / (1 + ((2 * (k - 2)) / (k * k - 1)) * lambda);
  const df2 = (k * k - 1) / (3 * lambda);
  return { f, df1: k - 1, df2, p: fSf(f, k - 1, df2) };
}

/** Levene's test (center 'mean') or Brown and Forsythe's (center 'median'): one-way ANOVA on |x − center|. */
export function levene(groups: readonly (readonly number[])[], center: 'mean' | 'median') {
  checkGroups(groups, 2);
  const z = groups.map((g) => {
    const c = center === 'mean' ? mean(g) : median(g);
    return g.map((x) => Math.abs(x - c));
  });
  const flat = z.flat();
  if (flat.every((v) => v === flat[0])) return { f: 0, df1: groups.length - 1, df2: flat.length - groups.length, p: 1 };
  const a = oneWay(z);
  return { f: a.f, df1: a.dfb, df2: a.dfw, p: a.p };
}

/** The Shapiro-Wilk W and its p-value by Royston's (1995) approximation, for 3 to 5000 values. */
export function shapiroWilk(values: readonly number[]): { w: number; p: number } {
  const n = values.length;
  check(n >= 3 && n <= 5000, 'shapiroSize');
  const x = [...values].sort((a, b) => a - b);
  const range = x[n - 1] - x[0];
  check(range > 0, 'constant');
  const m = Array.from({ length: n }, (_, i) => normalQuantile((i + 1 - 0.375) / (n + 0.25)));
  const mm = sum(m.map((v) => v * v));
  const a = new Array<number>(n).fill(0);
  if (n === 3) {
    a[0] = -Math.SQRT1_2;
    a[2] = Math.SQRT1_2;
  } else {
    const u = 1 / Math.sqrt(n);
    const cn = m[n - 1] / Math.sqrt(mm);
    const aN = cn + 0.221157 * u - 0.147981 * u ** 2 - 2.07119 * u ** 3 + 4.434685 * u ** 4 - 2.706056 * u ** 5;
    if (n > 5) {
      const cn1 = m[n - 2] / Math.sqrt(mm);
      const aN1 = cn1 + 0.042981 * u - 0.293762 * u ** 2 - 1.752461 * u ** 3 + 5.682633 * u ** 4 - 3.582633 * u ** 5;
      const phi = (mm - 2 * m[n - 1] ** 2 - 2 * m[n - 2] ** 2) / (1 - 2 * aN ** 2 - 2 * aN1 ** 2);
      for (let i = 2; i < n - 2; i += 1) a[i] = m[i] / Math.sqrt(phi);
      a[n - 1] = aN;
      a[n - 2] = aN1;
      a[0] = -aN;
      a[1] = -aN1;
    } else {
      const phi = (mm - 2 * m[n - 1] ** 2) / (1 - 2 * aN ** 2);
      for (let i = 1; i < n - 1; i += 1) a[i] = m[i] / Math.sqrt(phi);
      a[n - 1] = aN;
      a[0] = -aN;
    }
  }
  const mx = mean(x);
  const w = sum(a.map((ai, i) => ai * x[i])) ** 2 / sum(x.map((v) => (v - mx) ** 2));
  if (n === 3) {
    const p = (6 / Math.PI) * (Math.asin(Math.sqrt(Math.min(1, w))) - Math.asin(Math.sqrt(0.75)));
    return { w, p: Math.max(0, Math.min(1, p)) };
  }
  let z: number;
  if (n <= 11) {
    const gamma = -2.273 + 0.459 * n;
    const mu = 0.544 - 0.39978 * n + 0.025054 * n ** 2 - 0.0006714 * n ** 3;
    const sigma = Math.exp(1.3822 - 0.77857 * n + 0.062767 * n ** 2 - 0.0020322 * n ** 3);
    z = (-Math.log(gamma - Math.log(1 - w)) - mu) / sigma;
  } else {
    const ln = Math.log(n);
    const mu = -1.5861 - 0.31082 * ln - 0.083751 * ln ** 2 + 0.0038915 * ln ** 3;
    const sigma = Math.exp(-0.4803 - 0.082676 * ln + 0.0030302 * ln ** 2);
    z = (Math.log(1 - w) - mu) / sigma;
  }
  return { w, p: normalSf(z) };
}

export interface Comparison {
  readonly a: number;
  readonly b: number;
  readonly diff: number;
  readonly se: number;
  readonly statistic: number;
  readonly df: number;
  readonly p: number;
  readonly lower: number;
  readonly upper: number;
}

export type PostHoc = 'tukey' | 'gamesHowell' | 'bonferroni' | 'holm';

const quantiles = new Map<string, number>();

/** The studentized range quantile to 7 digits, remembered, since each cdf value takes a double integral. */
export function rangeQuantile(p: number, k: number, df: number): number {
  const key = `${p}|${k}|${df}`;
  const known = quantiles.get(key);
  if (known !== undefined) return known;
  const q = brent((x) => studentizedRangeCdf(x, k, df) - p, 0.01, 60, 1e-7).x;
  if (quantiles.size > 200) quantiles.clear();
  quantiles.set(key, q);
  return q;
}

/** Pairwise comparisons of group means, with simultaneous (Tukey, Games-Howell) or adjusted (t) p-values. */
export function postHoc(groups: readonly (readonly number[])[], method: PostHoc, confidence = 0.95): Comparison[] {
  const a = oneWay(groups);
  const out: Comparison[] = [];
  const vars = groups.map((g) => (g.length > 1 ? variance(g) : Number.NaN));
  for (let i = 0; i < a.k; i += 1) {
    for (let j = i + 1; j < a.k; j += 1) {
      const diff = a.means[j] - a.means[i];
      if (method === 'tukey' || method === 'gamesHowell') {
        let se: number;
        let df: number;
        if (method === 'tukey') {
          se = Math.sqrt((a.msw / 2) * (1 / a.sizes[i] + 1 / a.sizes[j]));
          df = a.dfw;
        } else {
          check(groups[i].length > 1 && groups[j].length > 1, 'groupSize', { min: '2' });
          const vi = vars[i] / a.sizes[i];
          const vj = vars[j] / a.sizes[j];
          se = Math.sqrt((vi + vj) / 2);
          df = (vi + vj) ** 2 / (vi ** 2 / (a.sizes[i] - 1) + vj ** 2 / (a.sizes[j] - 1));
        }
        const q = Math.abs(diff) / se;
        // Games-Howell's df differs for each pair, so only Tukey's shared critical value gives intervals.
        const crit = method === 'tukey' ? rangeQuantile(confidence, a.k, df) : Number.NaN;
        const p = Math.min(1, Math.max(0, 1 - studentizedRangeCdf(q, a.k, df)));
        out.push({ a: i, b: j, diff, se, statistic: q, df, p, lower: diff - crit * se, upper: diff + crit * se });
      } else {
        const se = Math.sqrt(a.msw * (1 / a.sizes[i] + 1 / a.sizes[j]));
        const t = diff / se;
        out.push({
          a: i,
          b: j,
          diff,
          se,
          statistic: t,
          df: a.dfw,
          p: Math.min(1, 2 * tSf(Math.abs(t), a.dfw)),
          lower: Number.NaN,
          upper: Number.NaN,
        });
      }
    }
  }
  if (method === 'bonferroni' || method === 'holm') {
    const adjusted = adjust(
      out.map((c) => c.p),
      method as Adjustment,
    );
    const m = out.length;
    const tc = tQuantile(1 - (1 - confidence) / (2 * m), a.dfw);
    return out.map((c, i) => ({ ...c, p: adjusted[i], lower: c.diff - tc * c.se, upper: c.diff + tc * c.se }));
  }
  return out;
}

/** A planned contrast Σ cᵢ mᵢ with weights adding to 0, tested against the pooled within-group variance. */
export function contrast(groups: readonly (readonly number[])[], weights: readonly number[]) {
  const a = oneWay(groups);
  check(weights.length === a.k, 'contrastLength', { k: `${a.k}` });
  check(Math.abs(sum(weights)) < 1e-9, 'contrastSum');
  check(
    weights.some((w) => w !== 0),
    'contrastZero',
  );
  const estimate = sum(weights.map((c, i) => c * a.means[i]));
  const se = Math.sqrt(a.msw * sum(weights.map((c, i) => (c * c) / a.sizes[i])));
  const t = estimate / se;
  return { estimate, se, t, df: a.dfw, p: Math.min(1, 2 * tSf(Math.abs(t), a.dfw)) };
}

/** The residual sum of squares of y on the columns of x, by QR. */
function rss(x: readonly (readonly number[])[], y: readonly number[]): number {
  const f = qrDecompose(x);
  check(f.fullRank, 'emptyCell');
  const beta = qrSolve(
    f,
    y.map((v) => [v]),
  ).map((r) => r[0]);
  return sum(y.map((v, i) => (v - sum(x[i].map((xij, j) => xij * beta[j]))) ** 2));
}

export interface TwoWayRow {
  readonly ss: number;
  readonly df: number;
  readonly f: number;
  readonly p: number;
  readonly partialEta2: number;
}

export interface TwoWay {
  readonly a: TwoWayRow;
  readonly b: TwoWayRow;
  readonly ab: TwoWayRow;
  readonly error: { ss: number; df: number; ms: number };
  readonly balanced: boolean;
  readonly levelsA: readonly string[];
  readonly levelsB: readonly string[];
  readonly cellMeans: readonly (readonly number[])[];
}

/** Two-way factorial ANOVA by model comparison with effect coding; Type II or III sums of squares. */
export function twoWay(data: readonly { a: string; b: string; y: number }[], type: 2 | 3): TwoWay {
  check(data.length >= 4, 'tooFew', { min: '4' });
  check(
    data.every((d) => Number.isFinite(d.y)),
    'notNumber',
    { text: '—' },
  );
  const levelsA = [...new Set(data.map((d) => d.a))];
  const levelsB = [...new Set(data.map((d) => d.b))];
  check(levelsA.length >= 2 && levelsB.length >= 2, 'twoLevels');
  const code = (levels: readonly string[], value: string) =>
    levels.slice(0, -1).map((l) => (value === l ? 1 : value === levels[levels.length - 1] ? -1 : 0));
  const ca = data.map((d) => code(levelsA, d.a));
  const cb = data.map((d) => code(levelsB, d.b));
  const cab = data.map((_, i) => ca[i].flatMap((u) => cb[i].map((v) => u * v)));
  const y = data.map((d) => d.y);
  const design = (parts: readonly ('a' | 'b' | 'ab')[]) =>
    data.map((_, i) => [
      1,
      ...(parts.includes('a') ? ca[i] : []),
      ...(parts.includes('b') ? cb[i] : []),
      ...(parts.includes('ab') ? cab[i] : []),
    ]);
  const counts = levelsA.map((la) => levelsB.map((lb) => data.filter((d) => d.a === la && d.b === lb).length));
  check(
    counts.flat().every((c) => c > 0),
    'emptyCell',
  );
  const balanced = counts.flat().every((c) => c === counts[0][0]);
  const full = rss(design(['a', 'b', 'ab']), y);
  const dfA = levelsA.length - 1;
  const dfB = levelsB.length - 1;
  const dfAB = dfA * dfB;
  const dfE = data.length - levelsA.length * levelsB.length;
  check(dfE > 0, 'noReplicates');
  const ms = full / dfE;
  let ssA: number;
  let ssB: number;
  if (type === 3) {
    ssA = rss(design(['b', 'ab']), y) - full;
    ssB = rss(design(['a', 'ab']), y) - full;
  } else {
    const additive = rss(design(['a', 'b']), y);
    ssA = rss(design(['b']), y) - additive;
    ssB = rss(design(['a']), y) - additive;
  }
  const ssAB = rss(design(['a', 'b']), y) - full;
  const row = (ss: number, df: number): TwoWayRow => {
    const f = ss / df / ms;
    return { ss, df, f, p: fSf(f, df, dfE), partialEta2: ss / (ss + full) };
  };
  return {
    a: row(ssA, dfA),
    b: row(ssB, dfB),
    ab: row(ssAB, dfAB),
    error: { ss: full, df: dfE, ms },
    balanced,
    levelsA,
    levelsB,
    cellMeans: levelsA.map((la) =>
      levelsB.map((lb) => mean(data.filter((d) => d.a === la && d.b === lb).map((d) => d.y))),
    ),
  };
}

function determinant(m: number[][]): number {
  const a = m.map((r) => [...r]);
  const n = a.length;
  let det = 1;
  for (let c = 0; c < n; c += 1) {
    let pivot = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(a[r][c]) > Math.abs(a[pivot][c])) pivot = r;
    if (a[pivot][c] === 0) return 0;
    if (pivot !== c) {
      [a[pivot], a[c]] = [a[c], a[pivot]];
      det = -det;
    }
    det *= a[c][c];
    for (let r = c + 1; r < n; r += 1) {
      const f = a[r][c] / a[c][c];
      for (let j = c; j < n; j += 1) a[r][j] -= f * a[c][j];
    }
  }
  return det;
}

export interface Repeated {
  readonly ssConditions: number;
  readonly ssSubjects: number;
  readonly ssError: number;
  readonly df1: number;
  readonly df2: number;
  readonly f: number;
  readonly p: number;
  readonly gg: number;
  readonly hf: number;
  readonly pGg: number;
  readonly pHf: number;
  readonly mauchlyW: number;
  readonly mauchlyChi2: number;
  readonly mauchlyDf: number;
  readonly mauchlyP: number;
  readonly partialEta2: number;
  readonly means: readonly number[];
}

/** One-way repeated measures (rows are subjects, columns conditions) with Mauchly's test and the ε corrections. */
export function repeated(rows: readonly (readonly number[])[]): Repeated {
  const n = rows.length;
  check(n >= 3, 'tooFew', { min: '3' });
  const k = rows[0].length;
  check(k >= 2, 'twoGroups');
  check(
    rows.every((r) => r.length === k && r.every(Number.isFinite)),
    'ragged',
  );
  const grand = sum(rows.flat()) / (n * k);
  const colMeans = Array.from({ length: k }, (_, j) => mean(rows.map((r) => r[j])));
  const rowMeans = rows.map(mean);
  const ssConditions = n * sum(colMeans.map((m) => (m - grand) ** 2));
  const ssSubjects = k * sum(rowMeans.map((m) => (m - grand) ** 2));
  const ssTotal = sum(rows.flat().map((v) => (v - grand) ** 2));
  const ssError = ssTotal - ssConditions - ssSubjects;
  check(ssError > 0, 'noError');
  const df1 = k - 1;
  const df2 = (n - 1) * (k - 1);
  const f = ssConditions / df1 / (ssError / df2);
  // The covariance of the conditions, double-centered.
  const cov = Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (__, j) => sum(rows.map((r) => (r[i] - colMeans[i]) * (r[j] - colMeans[j]))) / (n - 1)),
  );
  const rowAvg = cov.map(mean);
  const all = mean(rowAvg);
  const centered = cov.map((r, i) => r.map((v, j) => v - rowAvg[i] - rowAvg[j] + all));
  const trace = sum(centered.map((r, i) => r[i]));
  const trace2 = sum(centered.flat().map((v) => v * v));
  const gg = Math.min(1, (trace * trace) / (df1 * trace2));
  const hf = Math.min(1, (n * df1 * gg - 2) / (df1 * (n - 1 - df1 * gg)));
  // Mauchly's W on orthonormal (Helmert) contrasts.
  const contrasts = Array.from({ length: k - 1 }, (_, i) => {
    const row = new Array<number>(k).fill(0);
    for (let j = 0; j <= i; j += 1) row[j] = 1;
    row[i + 1] = -(i + 1);
    const norm = Math.sqrt(sum(row.map((v) => v * v)));
    return row.map((v) => v / norm);
  });
  const s = contrasts.map((ci) =>
    contrasts.map((cj) => sum(ci.map((a, x) => sum(cj.map((b, y) => a * cov[x][y] * b))))),
  );
  const p = k - 1;
  const trS = sum(s.map((r, i) => r[i]));
  const mauchlyW = p === 1 ? 1 : determinant(s) / (trS / p) ** p;
  const factor = n - 1 - (2 * p * p + p + 2) / (6 * p);
  const mauchlyChi2 = p === 1 ? 0 : -factor * Math.log(Math.max(mauchlyW, 1e-300));
  const mauchlyDf = (p * (p + 1)) / 2 - 1;
  return {
    ssConditions,
    ssSubjects,
    ssError,
    df1,
    df2,
    f,
    p: fSf(f, df1, df2),
    gg,
    hf,
    pGg: fSf(f, df1 * gg, df2 * gg),
    pHf: fSf(f, df1 * hf, df2 * hf),
    mauchlyW,
    mauchlyChi2,
    mauchlyDf,
    mauchlyP: mauchlyDf > 0 ? chiSquareSf(mauchlyChi2, mauchlyDf) : 1,
    partialEta2: ssConditions / (ssConditions + ssError),
    means: colMeans,
  };
}

export interface Mixed {
  readonly rows: readonly {
    source: 'between' | 'subjects' | 'within' | 'interaction' | 'error';
    ss: number;
    df: number;
    f: number;
    p: number;
  }[];
}

/** A mixed design: one between-subjects factor (groups of equal size) and one within-subjects factor (columns). */
export function mixed(groups: readonly (readonly (readonly number[])[])[]): Mixed {
  check(groups.length >= 2, 'twoGroups');
  const n = groups[0].length;
  check(n >= 2, 'groupSize', { min: '2' });
  check(
    groups.every((g) => g.length === n),
    'mixedBalanced',
  );
  const k = groups[0][0].length;
  check(k >= 2, 'twoGroups');
  check(
    groups.every((g) => g.every((r) => r.length === k && r.every(Number.isFinite))),
    'ragged',
  );
  const g = groups.length;
  const all = groups.flat(2);
  const grand = mean(all);
  const groupMeans = groups.map((rows) => mean(rows.flat()));
  const colMeans = Array.from({ length: k }, (_, j) => mean(groups.flatMap((rows) => rows.map((r) => r[j]))));
  const cell = groups.map((rows) => Array.from({ length: k }, (_, j) => mean(rows.map((r) => r[j]))));
  const ssBetween = n * k * sum(groupMeans.map((m) => (m - grand) ** 2));
  const ssSubjects = k * sum(groups.flatMap((rows, gi) => rows.map((r) => (mean(r) - groupMeans[gi]) ** 2)));
  const ssWithin = g * n * sum(colMeans.map((m) => (m - grand) ** 2));
  const ssInteraction =
    n * sum(cell.flatMap((row, gi) => row.map((m, j) => (m - groupMeans[gi] - colMeans[j] + grand) ** 2)));
  const ssWithinTotal = sum(groups.flatMap((rows) => rows.flatMap((r) => r.map((v) => (v - mean(r)) ** 2))));
  const ssError = ssWithinTotal - ssWithin - ssInteraction;
  const dfB = g - 1;
  const dfS = g * (n - 1);
  const dfW = k - 1;
  const dfI = dfB * dfW;
  const dfE = dfS * dfW;
  check(ssSubjects > 0 && ssError > 0, 'noError');
  const fB = ssBetween / dfB / (ssSubjects / dfS);
  const fW = ssWithin / dfW / (ssError / dfE);
  const fI = ssInteraction / dfI / (ssError / dfE);
  return {
    rows: [
      { source: 'between', ss: ssBetween, df: dfB, f: fB, p: fSf(fB, dfB, dfS) },
      { source: 'subjects', ss: ssSubjects, df: dfS, f: Number.NaN, p: Number.NaN },
      { source: 'within', ss: ssWithin, df: dfW, f: fW, p: fSf(fW, dfW, dfE) },
      { source: 'interaction', ss: ssInteraction, df: dfI, f: fI, p: fSf(fI, dfI, dfE) },
      { source: 'error', ss: ssError, df: dfE, f: Number.NaN, p: Number.NaN },
    ],
  };
}

export interface TwoGroupEffect {
  readonly d: number;
  readonly g: number;
  readonly glass: number;
  readonly lower: number;
  readonly upper: number;
  readonly t: number;
  readonly df: number;
}

/**
 * Cohen's d (pooled SD), Hedges' g (d times 1 − 3/(4 df − 1)), and Glass's Δ (group 2's SD), with the exact
 * interval for d from the noncentral t: the noncentrality values that put the observed t at each tail.
 */
export function twoGroupEffect(x: readonly number[], y: readonly number[], confidence = 0.95): TwoGroupEffect {
  checkGroups([x, y], 2);
  check(confidence > 0 && confidence < 1, 'confidenceRange');
  const n1 = x.length;
  const n2 = y.length;
  const df = n1 + n2 - 2;
  const sp = Math.sqrt(((n1 - 1) * variance(x) + (n2 - 1) * variance(y)) / df);
  check(sp > 0, 'zeroVariance');
  const d = (mean(x) - mean(y)) / sp;
  const scale = Math.sqrt((n1 * n2) / (n1 + n2));
  const t = d * scale;
  const alpha = 1 - confidence;
  const solve = (target: number) => {
    const f = (ncp: number) => noncentralTCdf(t, df, ncp) - target;
    const span = Math.abs(t) + 10;
    return brent(f, t - span, t + span, 1e-10).x;
  };
  return {
    d,
    g: d * (1 - 3 / (4 * df - 1)),
    glass: (mean(x) - mean(y)) / Math.sqrt(variance(y)),
    lower: solve(1 - alpha / 2) / scale,
    upper: solve(alpha / 2) / scale,
    t,
    df,
  };
}
