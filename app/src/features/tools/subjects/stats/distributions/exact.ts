// Exact null distributions of the rank statistics, for small samples without ties. Mann-Whitney U counts
// arrangements by the recursion N(u; m, n) = N(u − n; m − 1, n) + N(u; m, n − 1). The Wilcoxon signed-rank sum
// counts subsets of 1..n by their sum. Kendall's tau counts permutations by inversions (the Mahonian numbers).
// Spearman's rho enumerates every permutation for n up to 9. Each returns probabilities indexed by the statistic.
import { ensure } from '../../errors';

/** The largest group size for the exact Mann-Whitney and Wilcoxon tables; beyond it tools use the normal form. */
export const MAX_EXACT_GROUP = 60;
/** The largest n for the exact Kendall table. */
export const MAX_EXACT_KENDALL = 60;
/** The largest n for Spearman's enumeration (9! = 362 880 orders). */
export const MAX_EXACT_SPEARMAN = 9;

export type Alternative = 'two-sided' | 'less' | 'greater';

const cache = new Map<string, Float64Array>();

function cached(key: string, build: () => Float64Array): Float64Array {
  const hit = cache.get(key);
  if (hit) return hit;
  const made = build();
  cache.set(key, made);
  return made;
}

/** Turns counts into probabilities. */
function normalize(counts: Float64Array): Float64Array {
  const total = counts.reduce((s, c) => s + c, 0);
  return counts.map((c) => c / total);
}

/** P(U = u) for u = 0..mn, where U counts the pairs with the first sample's value above the second's. */
export function mannWhitneyDistribution(m: number, n: number): Float64Array {
  ensure(Number.isInteger(m) && Number.isInteger(n) && m >= 1 && n >= 1, 'domain', 'sizes');
  ensure(m <= MAX_EXACT_GROUP && n <= MAX_EXACT_GROUP, 'tooLarge', String(MAX_EXACT_GROUP));
  return cached(`mw:${m}:${n}`, () => {
    // layer[j] holds the counts for (i, j) with i the current first-sample size.
    let layer: Float64Array[] = Array.from({ length: n + 1 }, () => Float64Array.of(1));
    for (let i = 1; i <= m; i += 1) {
      const next: Float64Array[] = [Float64Array.of(1)];
      for (let j = 1; j <= n; j += 1) {
        const row = new Float64Array(i * j + 1);
        const left = next[j - 1];
        for (let u = 0; u < left.length; u += 1) row[u] += left[u];
        const up = layer[j];
        for (let u = 0; u < up.length; u += 1) row[u + j] += up[u];
        next.push(row);
      }
      layer = next;
    }
    return normalize(layer[n]);
  });
}

/** P(W⁺ = w) for w = 0..n(n+1)/2: the sum of the ranks with a positive sign, under the null. */
export function signedRankDistribution(n: number): Float64Array {
  ensure(Number.isInteger(n) && n >= 1, 'domain', 'n');
  ensure(n <= MAX_EXACT_GROUP, 'tooLarge', String(MAX_EXACT_GROUP));
  return cached(`sr:${n}`, () => {
    const counts = new Float64Array((n * (n + 1)) / 2 + 1);
    counts[0] = 1;
    for (let r = 1; r <= n; r += 1) for (let w = (r * (r + 1)) / 2; w >= r; w -= 1) counts[w] += counts[w - r];
    return normalize(counts);
  });
}

/**
 * P(I = i) for the number of inversions i = 0..n(n−1)/2 of a random order of n items. The table runs against tau:
 * tau = 1 − 4I / (n(n−1)), so few inversions mean tau > 0. Take one-sided p-values from kendallExactP, not exactP.
 */
export function kendallDistribution(n: number): Float64Array {
  ensure(Number.isInteger(n) && n >= 2, 'domain', 'n');
  ensure(n <= MAX_EXACT_KENDALL, 'tooLarge', String(MAX_EXACT_KENDALL));
  return cached(`kt:${n}`, () => {
    let counts = Float64Array.of(1);
    for (let k = 2; k <= n; k += 1) {
      const next = new Float64Array(counts.length + k - 1);
      for (let i = 0; i < counts.length; i += 1) for (let j = 0; j < k; j += 1) next[i + j] += counts[i];
      counts = next;
    }
    return normalize(counts);
  });
}

/**
 * P(D = d) for D = Σ (rank difference)², d = 0..n(n²−1)/3, by enumerating every order (Heap's algorithm). The table
 * runs against rho: rho = 1 − 6D / (n(n²−1)), so a small D means rho > 0. Take one-sided p-values from
 * spearmanExactP, not exactP.
 */
export function spearmanDistribution(n: number): Float64Array {
  ensure(Number.isInteger(n) && n >= 2, 'domain', 'n');
  ensure(n <= MAX_EXACT_SPEARMAN, 'tooLarge', String(MAX_EXACT_SPEARMAN));
  return cached(`sp:${n}`, () => {
    const counts = new Float64Array((n * (n * n - 1)) / 3 + 1);
    const order = Array.from({ length: n }, (_, i) => i);
    const c = new Array<number>(n).fill(0);
    const tally = () => (counts[order.reduce((s, v, i) => s + (v - i) * (v - i), 0)] += 1);
    tally();
    for (let i = 1; i < n;) {
      if (c[i] < i) {
        const j = i % 2 === 0 ? 0 : c[i];
        [order[j], order[i]] = [order[i], order[j]];
        tally();
        c[i] += 1;
        i = 1;
      } else {
        c[i] = 0;
        i += 1;
      }
    }
    return normalize(counts);
  });
}

/** P(S ≤ s) and P(S ≥ s) from a distribution over 0..max, with a small allowance for rounding of s. */
export function tails(dist: Float64Array, s: number): { lower: number; upper: number } {
  let lower = 0;
  let upper = 0;
  for (let v = 0; v < dist.length; v += 1) {
    if (v <= s + 1e-9) lower += dist[v];
    if (v >= s - 1e-9) upper += dist[v];
  }
  return { lower: Math.min(1, lower), upper: Math.min(1, upper) };
}

/**
 * The p-value of a statistic s under a distribution. Two-sided doubles the smaller tail (capped at 1), the usual
 * rule for these symmetric distributions; 'less' and 'greater' are the lower and upper tails.
 */
export function exactP(dist: Float64Array, s: number, alternative: Alternative): number {
  const { lower, upper } = tails(dist, s);
  if (alternative === 'less') return lower;
  if (alternative === 'greater') return upper;
  return Math.min(1, 2 * Math.min(lower, upper));
}

/** The statistic runs against the association, so 'greater' (a positive association) is its lower tail. */
const AGAINST: Record<Alternative, Alternative> = { 'two-sided': 'two-sided', less: 'greater', greater: 'less' };

/**
 * The exact p-value of Kendall's tau from the number of inversions (discordant pairs) among n untied pairs:
 * 'greater' tests tau > 0, the lower tail of the inversions, and 'less' tests tau < 0.
 */
export function kendallExactP(n: number, inversions: number, alternative: Alternative): number {
  return exactP(kendallDistribution(n), inversions, AGAINST[alternative]);
}

/**
 * The exact p-value of Spearman's rho from D = Σ (rank difference)² among n untied pairs: 'greater' tests rho > 0,
 * the lower tail of D, and 'less' tests rho < 0.
 */
export function spearmanExactP(n: number, d: number, alternative: Alternative): number {
  return exactP(spearmanDistribution(n), d, AGAINST[alternative]);
}
