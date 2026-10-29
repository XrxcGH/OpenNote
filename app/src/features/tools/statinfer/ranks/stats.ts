// The rank-based tests: Mann-Whitney, Wilcoxon signed-rank, the sign test, Kruskal-Wallis with Dunn's tests,
// Friedman with Conover's and Nemenyi's tests, the Hodges-Lehmann shift, and the two-sample Kolmogorov-Smirnov test.
// Exact p-values come from the exact null tables when nothing is tied and the samples are small.
import { cubicTieSum, midRanks, rankGroups } from '../../subjects/stats/rank';
import {
  binomialCdf,
  chiSquareSf,
  exactP,
  mannWhitneyDistribution,
  MAX_EXACT_GROUP,
  normalQuantile,
  normalRangeCdf,
  normalSf,
  signedRankDistribution,
  tSf,
} from '../../subjects/stats/dist';
import type { Alternative } from '../../subjects/stats/dist';
import { adjust, type Adjustment } from '../num/adjust';
import { check } from '../report';

/** Rounds away floating-point dust, so differences such as 1.3 − 1.29 tie when they should. */
const clean = (v: number): number => Number(v.toPrecision(12));

const zP = (z: number, alternative: Alternative): number =>
  alternative === 'greater'
    ? normalSf(z)
    : alternative === 'less'
      ? normalSf(-z)
      : Math.min(1, 2 * normalSf(Math.abs(z)));

function checkSample(values: readonly number[], min: number): void {
  check(values.length >= min, 'tooFew', { min: `${min}` });
  check(values.every(Number.isFinite), 'notNumber', { text: '—' });
}

export interface MannWhitney {
  readonly u1: number;
  readonly u2: number;
  readonly r1: number;
  readonly r2: number;
  readonly z: number;
  readonly p: number;
  readonly exact: boolean;
  readonly rankBiserial: number;
}

/**
 * Mann-Whitney U for sample 1 against sample 2. U₁ counts the pairs with sample 1 above (ties count ½). The exact
 * p is used with no ties and both samples small; otherwise the normal form with tie and continuity corrections.
 * 'greater' means sample 1 tends to be larger.
 */
export function mannWhitney(
  x: readonly number[],
  y: readonly number[],
  alternative: Alternative = 'two-sided',
): MannWhitney {
  checkSample(x, 1);
  checkSample(y, 1);
  const m = x.length;
  const n = y.length;
  const { ranks, ties } = rankGroups([x, y]);
  const r1 = ranks[0].reduce((a, b) => a + b, 0);
  const r2 = ranks[1].reduce((a, b) => a + b, 0);
  const u1 = r1 - (m * (m + 1)) / 2;
  const u2 = m * n - u1;
  const rankBiserial = (u1 - u2) / (m * n);
  if (ties.length === 0 && m <= MAX_EXACT_GROUP && n <= MAX_EXACT_GROUP) {
    return {
      u1,
      u2,
      r1,
      r2,
      z: Number.NaN,
      p: exactP(mannWhitneyDistribution(m, n), u1, alternative),
      exact: true,
      rankBiserial,
    };
  }
  const N = m + n;
  const variance = ((m * n) / 12) * (N + 1 - cubicTieSum(ties) / (N * (N - 1)));
  check(variance > 0, 'allTied');
  const d = u1 - (m * n) / 2;
  const corrected =
    alternative === 'two-sided'
      ? Math.sign(d) * Math.max(0, Math.abs(d) - 0.5)
      : alternative === 'greater'
        ? d - 0.5
        : d + 0.5;
  const z = corrected / Math.sqrt(variance);
  return { u1, u2, r1, r2, z, p: zP(z, alternative), exact: false, rankBiserial };
}

export interface SignedRank {
  readonly n: number;
  readonly zeros: number;
  readonly wPlus: number;
  readonly wMinus: number;
  readonly z: number;
  readonly p: number;
  readonly exact: boolean;
  readonly rankBiserial: number;
  /** The differences in input order with their signed ranks (0 for a dropped zero). */
  readonly rows: readonly { d: number; rank: number }[];
}

/**
 * The Wilcoxon signed-rank test on differences. Zeros are dropped before ranking ('wilcox') or ranked and then
 * dropped ('pratt'). The exact p is used with no zeros or ties and n ≤ 60; otherwise the normal form.
 */
export function signedRank(
  diffs: readonly number[],
  zeros: 'wilcox' | 'pratt' = 'wilcox',
  alternative: Alternative = 'two-sided',
): SignedRank {
  checkSample(diffs, 1);
  const d = diffs.map(clean);
  const zeroCount = d.filter((v) => v === 0).length;
  const ranked = zeros === 'pratt' ? d : d.filter((v) => v !== 0);
  check(
    ranked.some((v) => v !== 0),
    'allZero',
  );
  const { ranks, ties } = midRanks(ranked.map(Math.abs));
  let wPlus = 0;
  let wMinus = 0;
  ranked.forEach((v, i) => {
    if (v > 0) wPlus += ranks[i];
    else if (v < 0) wMinus += ranks[i];
  });
  const signed = new Map<number, number>();
  ranked.forEach((v, i) => signed.set(v, v === 0 ? 0 : Math.sign(v) * ranks[i]));
  const rows = d.map((v) => ({ d: v, rank: signed.get(v) ?? 0 }));
  const n = ranked.length;
  const nonzero = ranked.filter((v) => v !== 0).length;
  const rankBiserial = (wPlus - wMinus) / (wPlus + wMinus);
  if (zeroCount === 0 && ties.length === 0 && n <= MAX_EXACT_GROUP) {
    return {
      n,
      zeros: zeroCount,
      wPlus,
      wMinus,
      z: Number.NaN,
      p: exactP(signedRankDistribution(n), wPlus, alternative),
      exact: true,
      rankBiserial,
      rows,
    };
  }
  // Pratt's method keeps the zeros' ranks in the null mean and variance.
  const zeroRanks = zeros === 'pratt' ? ranks.filter((_, i) => ranked[i] === 0) : [];
  const zeroSum = zeroRanks.reduce((a, b) => a + b, 0);
  const zeroSquares = zeroRanks.reduce((a, b) => a + b * b, 0);
  const mean = (n * (n + 1)) / 4 - zeroSum / 2;
  const variance = (n * (n + 1) * (2 * n + 1)) / 24 - zeroSquares / 4 - cubicTieSum(ties) / 48;
  check(variance > 0 && nonzero > 0, 'allTied');
  const dd = wPlus - mean;
  const corrected =
    alternative === 'two-sided'
      ? Math.sign(dd) * Math.max(0, Math.abs(dd) - 0.5)
      : alternative === 'greater'
        ? dd - 0.5
        : dd + 0.5;
  const z = corrected / Math.sqrt(variance);
  return { n, zeros: zeroCount, wPlus, wMinus, z, p: zP(z, alternative), exact: false, rankBiserial, rows };
}

/** The exact sign test: of n non-zero differences, `plus` are positive. */
export function signTest(plus: number, n: number, alternative: Alternative = 'two-sided'): number {
  check(Number.isInteger(plus) && Number.isInteger(n) && n >= 1 && plus >= 0 && plus <= n, 'signCounts');
  const lower = binomialCdf(plus, n, 0.5);
  const upper = 1 - binomialCdf(plus - 1, n, 0.5);
  if (alternative === 'greater') return upper;
  if (alternative === 'less') return lower;
  return Math.min(1, 2 * Math.min(lower, upper));
}

export interface PairwiseRow {
  readonly a: number;
  readonly b: number;
  readonly statistic: number;
  readonly p: number;
  readonly adjusted: number;
}

export interface KruskalWallis {
  readonly h: number;
  readonly df: number;
  readonly p: number;
  readonly sums: readonly number[];
  readonly sizes: readonly number[];
  readonly correction: number;
  readonly epsilon2: number;
  readonly dunn: readonly PairwiseRow[];
}

/** Kruskal-Wallis H with the tie correction, and Dunn's pairwise z tests with an adjustment. */
export function kruskalWallis(groups: readonly (readonly number[])[], method: Adjustment = 'holm'): KruskalWallis {
  check(groups.length >= 2, 'twoGroups');
  for (const g of groups) checkSample(g, 1);
  const { ranks, ties } = rankGroups(groups);
  const sizes = groups.map((g) => g.length);
  const N = sizes.reduce((a, b) => a + b, 0);
  check(N > groups.length, 'tooFew', { min: `${groups.length + 1}` });
  const sums = ranks.map((r) => r.reduce((a, b) => a + b, 0));
  const correction = 1 - cubicTieSum(ties) / (N ** 3 - N);
  check(correction > 0, 'allTied');
  const raw = (12 / (N * (N + 1))) * sums.reduce((s, r, i) => s + (r * r) / sizes[i], 0) - 3 * (N + 1);
  const h = raw / correction;
  const df = groups.length - 1;
  const spread = (N * (N + 1)) / 12 - cubicTieSum(ties) / (12 * (N - 1));
  const pairs: { a: number; b: number; statistic: number; p: number }[] = [];
  for (let a = 0; a < groups.length; a += 1) {
    for (let b = a + 1; b < groups.length; b += 1) {
      const z = (sums[a] / sizes[a] - sums[b] / sizes[b]) / Math.sqrt(spread * (1 / sizes[a] + 1 / sizes[b]));
      pairs.push({ a, b, statistic: z, p: zP(z, 'two-sided') });
    }
  }
  const adjusted = adjust(
    pairs.map((pair) => pair.p),
    method,
  );
  return {
    h,
    df,
    p: chiSquareSf(h, df),
    sums,
    sizes,
    correction,
    epsilon2: h / ((N * N - 1) / (N + 1)),
    dunn: pairs.map((pair, i) => ({ ...pair, adjusted: adjusted[i] })),
  };
}

export interface Friedman {
  readonly chi2: number;
  readonly df: number;
  readonly p: number;
  readonly sums: readonly number[];
  readonly blocks: number;
  readonly correction: number;
  readonly kendallW: number;
  readonly conover: readonly PairwiseRow[];
  readonly nemenyi: readonly PairwiseRow[];
}

/** Friedman's test on blocks (rows) by treatments (columns), with Conover's t tests and Nemenyi's range tests. */
export function friedman(blocks: readonly (readonly number[])[], method: Adjustment = 'holm'): Friedman {
  check(blocks.length >= 2, 'tooFew', { min: '2' });
  const k = blocks[0].length;
  check(k >= 2, 'twoGroups');
  check(
    blocks.every((b) => b.length === k),
    'ragged',
  );
  for (const b of blocks) checkSample(b, k);
  const n = blocks.length;
  const ranked = blocks.map((b) => midRanks(b.map(clean)));
  const sums = Array.from({ length: k }, (_, j) => ranked.reduce((s, r) => s + r.ranks[j], 0));
  const tieSum = ranked.reduce((s, r) => s + cubicTieSum(r.ties), 0);
  const correction = 1 - tieSum / (n * k * (k * k - 1));
  check(correction > 0, 'allTied');
  const raw = (12 / (n * k * (k + 1))) * sums.reduce((s, r) => s + r * r, 0) - 3 * n * (k + 1);
  const chi2 = raw / correction;
  const df = k - 1;
  const a1 = ranked.reduce((s, r) => s + r.ranks.reduce((t, v) => t + v * v, 0), 0);
  const sumSq = sums.reduce((s, r) => s + r * r, 0);
  const conoverDf = (n - 1) * (k - 1);
  const conoverScale = Math.sqrt((2 * (n * a1 - sumSq)) / conoverDf);
  const nemenyiScale = Math.sqrt((k * (k + 1)) / (6 * n));
  const conover: { a: number; b: number; statistic: number; p: number }[] = [];
  const nemenyi: PairwiseRow[] = [];
  for (let a = 0; a < k; a += 1) {
    for (let b = a + 1; b < k; b += 1) {
      const t = (sums[a] - sums[b]) / conoverScale;
      conover.push({ a, b, statistic: t, p: Math.min(1, 2 * tSf(Math.abs(t), conoverDf)) });
      const q = (Math.abs(sums[a] - sums[b]) / n / nemenyiScale) * Math.SQRT2;
      const p = Math.min(1, Math.max(0, 1 - normalRangeCdf(q, k)));
      nemenyi.push({ a, b, statistic: q, p, adjusted: p });
    }
  }
  const adjusted = adjust(
    conover.map((c) => c.p),
    method,
  );
  return {
    chi2,
    df,
    p: chiSquareSf(chi2, df),
    sums,
    blocks: n,
    correction,
    kendallW: chi2 / (n * (k - 1)),
    conover: conover.map((c, i) => ({ ...c, adjusted: adjusted[i] })),
    nemenyi,
  };
}

export interface HodgesLehmann {
  readonly shift: number;
  readonly lower: number;
  readonly upper: number;
  readonly exact: boolean;
}

/** The Hodges-Lehmann shift, the median of every difference x − y, with its distribution-free interval. */
export function hodgesLehmann(x: readonly number[], y: readonly number[], confidence = 0.95): HodgesLehmann {
  checkSample(x, 1);
  checkSample(y, 1);
  check(confidence > 0 && confidence < 1, 'confidenceRange');
  check(x.length * y.length <= 250_000, 'tooManyPairs');
  const d = x.flatMap((a) => y.map((b) => a - b)).sort((a, b) => a - b);
  const mn = d.length;
  const mid = mn % 2 === 1 ? d[(mn - 1) / 2] : (d[mn / 2 - 1] + d[mn / 2]) / 2;
  const alpha = 1 - confidence;
  let c: number;
  const exact = x.length <= MAX_EXACT_GROUP && y.length <= MAX_EXACT_GROUP;
  if (exact) {
    // c is the number of differences cut from each end: the largest c with P(U ≤ c − 1) ≤ α/2.
    const dist = mannWhitneyDistribution(x.length, y.length);
    let cumulative = 0;
    c = 0;
    while (c < dist.length && cumulative + dist[c] <= alpha / 2 + 1e-12) {
      cumulative += dist[c];
      c += 1;
    }
  } else {
    const N = x.length + y.length;
    c = Math.floor(mn / 2 - normalQuantile(1 - alpha / 2) * Math.sqrt((mn * (N + 1)) / 12));
  }
  if (c < 1) return { shift: mid, lower: Number.NEGATIVE_INFINITY, upper: Number.POSITIVE_INFINITY, exact };
  return { shift: mid, lower: d[c - 1], upper: d[mn - c], exact };
}

export interface KolmogorovSmirnov {
  readonly d: number;
  readonly p: number;
  readonly exact: boolean;
}

/** Kolmogorov's limiting distribution, P(K > λ) = 2 Σ (−1)^(k−1) e^(−2k²λ²). */
function kolmogorovSf(lambda: number): number {
  if (lambda < 0.2) return 1;
  let sum = 0;
  for (let k = 1; k <= 100; k += 1) {
    const term = 2 * (-1) ** (k - 1) * Math.exp(-2 * k * k * lambda * lambda);
    sum += term;
    if (Math.abs(term) < 1e-16) break;
  }
  return Math.max(0, Math.min(1, sum));
}

/** The two-sample Kolmogorov-Smirnov test of D = max |F₁ − F₂|; exact by counting paths when small and untied. */
export function kolmogorovSmirnov(x: readonly number[], y: readonly number[]): KolmogorovSmirnov {
  checkSample(x, 1);
  checkSample(y, 1);
  const m = x.length;
  const n = y.length;
  const xs = [...x].sort((a, b) => a - b);
  const ys = [...y].sort((a, b) => a - b);
  const all = [...new Set([...xs, ...ys])].sort((a, b) => a - b);
  let i = 0;
  let j = 0;
  let d = 0;
  for (const v of all) {
    while (i < m && xs[i] <= v) i += 1;
    while (j < n && ys[j] <= v) j += 1;
    d = Math.max(d, Math.abs(i / m - j / n));
  }
  const tied = all.length < m + n;
  if (!tied && m * n <= 10_000) {
    // Count the orderings whose path from (0, 0) to (m, n) stays strictly inside |i/m − j/n| < D.
    const row = new Float64Array(n + 1);
    const inside = (a: number, b: number) => Math.abs(a / m - b / n) < d - 1e-12;
    for (let b = 0; b <= n; b += 1) row[b] = inside(0, b) && (b === 0 || row[b - 1] > 0) ? 1 : 0;
    for (let a = 1; a <= m; a += 1) {
      row[0] = inside(a, 0) ? row[0] : 0;
      for (let b = 1; b <= n; b += 1) row[b] = inside(a, b) ? row[b] + row[b - 1] : 0;
    }
    // Divide by C(m + n, m) on the log scale.
    let logTotal = 0;
    for (let k = 1; k <= m; k += 1) logTotal += Math.log(n + k) - Math.log(k);
    return { d, p: Math.max(0, Math.min(1, 1 - row[n] / Math.exp(logTotal))), exact: true };
  }
  const ne = (m * n) / (m + n);
  const lambda = (Math.sqrt(ne) + 0.12 + 0.11 / Math.sqrt(ne)) * d;
  return { d, p: kolmogorovSf(lambda), exact: false };
}
