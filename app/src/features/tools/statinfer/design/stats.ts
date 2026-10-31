// Study design: seeded random assignment (simple, permuted blocks, stratified), Latin squares and counterbalancing,
// factorial layouts, sampling from a frame, survey estimates with standard errors, and margins of error.
import { Rng } from '../../subjects/num/rng';
import { normalQuantile } from '../../subjects/stats/dist';
import { check } from '../report';

/** Each participant gets a condition independently and at random. */
export function simpleAssignment(conditions: readonly string[], n: number, seed: bigint): string[] {
  checkConditions(conditions);
  checkCount(n);
  const rng = new Rng(seed);
  return Array.from({ length: n }, () => conditions[rng.integer(conditions.length)]);
}

function checkConditions(conditions: readonly string[]): void {
  check(conditions.length >= 2, 'twoConditions');
  check(new Set(conditions).size === conditions.length, 'repeatedCondition');
}

function checkCount(n: number): void {
  check(Number.isInteger(n) && n >= 1 && n <= 100_000, 'participants');
}

/**
 * Permuted blocks: each block holds every condition equally often, in a shuffled order. With several block sizes
 * (each a multiple of the number of conditions), each block's size is picked at random, which hides the next one.
 */
export function blockAssignment(
  conditions: readonly string[],
  n: number,
  sizes: readonly number[],
  seed: bigint,
): { list: string[]; blocks: number[] } {
  checkConditions(conditions);
  checkCount(n);
  check(sizes.length >= 1, 'blockSizes');
  for (const size of sizes)
    check(Number.isInteger(size) && size > 0 && size % conditions.length === 0, 'blockMultiple', {
      k: `${conditions.length}`,
    });
  const rng = new Rng(seed);
  const list: string[] = [];
  const blocks: number[] = [];
  while (list.length < n) {
    const size = sizes[rng.integer(sizes.length)];
    const block = Array.from({ length: size }, (_, i) => conditions[i % conditions.length]);
    list.push(...rng.shuffle(block));
    blocks.push(size);
  }
  return { list: list.slice(0, n), blocks };
}

/** Permuted blocks run separately inside each stratum. */
export function stratifiedAssignment(
  conditions: readonly string[],
  strata: readonly { name: string; n: number }[],
  sizes: readonly number[],
  seed: bigint,
) {
  check(strata.length >= 1, 'empty');
  const rng = new Rng(seed);
  return strata.map((s) => ({
    name: s.name,
    list: blockAssignment(conditions, s.n, sizes, BigInt(rng.integer(2 ** 31))).list,
  }));
}

/** The cyclic Latin square: row i is the conditions shifted by i. */
export function cyclicSquare(n: number): number[][] {
  checkSquare(n);
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (__, j) => (i + j) % n));
}

function checkSquare(n: number): void {
  check(Number.isInteger(n) && n >= 2 && n <= 26, 'squareSize');
}

/** A random Latin square: the cyclic one with its rows, columns, and symbols shuffled. */
export function randomSquare(n: number, seed: bigint): number[][] {
  const base = cyclicSquare(n);
  const rng = new Rng(seed);
  const rows = rng.shuffle(base.map((_, i) => i));
  const cols = rng.shuffle(base.map((_, i) => i));
  const symbols = rng.shuffle(base.map((_, i) => i));
  return rows.map((r) => cols.map((c) => symbols[base[r][c]]));
}

/**
 * Williams' design, balanced for first-order carryover: first row 0, 1, n − 1, 2, n − 2, …, and each later row adds
 * 1 modulo n. An odd n needs the mirror image as a 2nd square.
 */
export function williams(n: number): number[][] {
  checkSquare(n);
  const first: number[] = [0];
  for (let k = 1; first.length < n; k += 1) {
    first.push(k);
    if (first.length < n) first.push(n - k);
  }
  const square = Array.from({ length: n }, (_, i) => first.map((v) => (v + i) % n));
  return n % 2 === 0 ? square : [...square, ...square.map((row) => [...row].reverse())];
}

/** Every order of the conditions, for full counterbalancing (at most 8 conditions, 40 320 orders). */
export function allOrders(n: number): number[][] {
  check(Number.isInteger(n) && n >= 2 && n <= 8, 'ordersSize');
  const out: number[][] = [];
  const walk = (prefix: number[], rest: number[]) => {
    if (rest.length === 0) out.push(prefix);
    rest.forEach((v, i) => walk([...prefix, v], [...rest.slice(0, i), ...rest.slice(i + 1)]));
  };
  walk(
    [],
    Array.from({ length: n }, (_, i) => i),
  );
  return out;
}

/** Every combination of the factors' levels, in order with the last factor changing fastest. */
export function factorial(factors: readonly { name: string; levels: readonly string[] }[]): string[][] {
  check(factors.length >= 1, 'empty');
  for (const f of factors) check(f.levels.length >= 1, 'factorLevels', { name: f.name });
  const total = factors.reduce((p, f) => p * f.levels.length, 1);
  check(total <= 10_000, 'tooManyCells');
  let rows: string[][] = [[]];
  for (const f of factors) rows = rows.flatMap((row) => f.levels.map((level) => [...row, level]));
  return rows;
}

/** Neyman allocation, n_h = n N_h S_h / Σ N_h S_h, or proportional allocation when no spreads are given. */
export function allocate(n: number, sizes: readonly number[], spreads: readonly number[] | null): number[] {
  check(n > 0 && Number.isFinite(n), 'sampleCount');
  check(sizes.length >= 1, 'empty');
  check(
    sizes.every((v) => Number.isFinite(v) && v > 0),
    'stratumSize',
  );
  if (spreads) {
    check(spreads.length === sizes.length, 'spreadsLength');
    check(spreads.every((v) => Number.isFinite(v) && v >= 0) && spreads.some((v) => v > 0), 'spreadsPositive');
  }
  const weights = sizes.map((N, h) => N * (spreads ? spreads[h] : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => (n * w) / total);
}

export type SampleMethod = 'simple' | 'systematic' | 'stratified' | 'cluster' | 'pps';

export interface FrameRow {
  readonly id: string;
  readonly group: string;
  readonly size: number;
}

/** Draws a sample from a frame: simple random, systematic, stratified (proportional), whole clusters, or PPS. */
export function drawSample(frame: readonly FrameRow[], method: SampleMethod, n: number, seed: bigint): FrameRow[] {
  check(frame.length >= 1, 'empty');
  check(Number.isInteger(n) && n >= 1, 'sampleCount');
  const rng = new Rng(seed);
  if (method === 'simple') {
    check(n <= frame.length, 'sampleTooLarge');
    return rng.sample(frame, n);
  }
  if (method === 'systematic') {
    check(n <= frame.length, 'sampleTooLarge');
    const step = frame.length / n;
    const start = rng.uniform() * step;
    return Array.from({ length: n }, (_, i) => frame[Math.floor(start + i * step)]);
  }
  const groups = [...new Set(frame.map((r) => r.group))];
  if (method === 'stratified') {
    const sizes = groups.map((g) => frame.filter((r) => r.group === g).length);
    const shares = allocate(n, sizes, null);
    // Round the shares so they add to n, largest remainders first.
    const counts = shares.map(Math.floor);
    const order = shares
      .map((_, i) => i)
      .sort((a, b) => shares[b] - Math.floor(shares[b]) - (shares[a] - Math.floor(shares[a])));
    for (let i = 0; counts.reduce((a, b) => a + b, 0) < n; i += 1) counts[order[i % order.length]] += 1;
    return groups.flatMap((g, h) =>
      rng.sample(
        frame.filter((r) => r.group === g),
        Math.min(counts[h], sizes[h]),
      ),
    );
  }
  if (method === 'cluster') {
    check(n <= groups.length, 'clustersTooMany');
    const chosen = new Set(rng.sample(groups, n));
    return frame.filter((r) => chosen.has(r.group));
  }
  // Systematic PPS: lay the sizes end to end and take every (total/n)th point from a random start.
  check(
    frame.every((r) => Number.isFinite(r.size) && r.size > 0),
    'sizePositive',
  );
  const total = frame.reduce((a, r) => a + r.size, 0);
  const step = total / n;
  const start = rng.uniform() * step;
  const picks: FrameRow[] = [];
  let cumulative = 0;
  let next = start;
  for (const row of frame) {
    cumulative += row.size;
    while (next < cumulative && picks.length < n) {
      picks.push(row);
      next += step;
    }
  }
  return picks;
}

export interface StratumData {
  readonly name: string;
  /** The stratum's size in the population. */
  readonly N: number;
  readonly values: readonly number[];
}

export interface StratifiedEstimate {
  readonly mean: number;
  readonly se: number;
  readonly total: number;
  readonly seTotal: number;
  readonly parts: readonly {
    name: string;
    W: number;
    mean: number;
    s2: number;
    n: number;
    f: number;
    contribution: number;
  }[];
}

/** The stratified mean Σ W_h ȳ_h with var = Σ W_h² (1 − f_h) s_h²/n_h, and the population total. */
export function stratifiedEstimate(strata: readonly StratumData[]): StratifiedEstimate {
  check(strata.length >= 1, 'empty');
  for (const s of strata) {
    check(s.values.length >= 2, 'stratumTwo', { name: s.name });
    check(Number.isFinite(s.N) && s.N >= s.values.length, 'stratumN', { name: s.name });
  }
  const N = strata.reduce((a, s) => a + s.N, 0);
  const parts = strata.map((s) => {
    const n = s.values.length;
    const mean = s.values.reduce((a, b) => a + b, 0) / n;
    const s2 = s.values.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1);
    const W = s.N / N;
    const f = n / s.N;
    return { name: s.name, W, mean, s2, n, f, contribution: (W * W * (1 - f) * s2) / n };
  });
  const mean = parts.reduce((a, p) => a + p.W * p.mean, 0);
  const se = Math.sqrt(parts.reduce((a, p) => a + p.contribution, 0));
  return { mean, se, total: N * mean, seTotal: N * se, parts };
}

/** The design effect of clusters of size m with intraclass correlation ICC, and the effective sample size. */
export function designEffect(m: number, icc: number, n: number): { deff: number; effective: number } {
  check(Number.isFinite(m) && m >= 1, 'clusterSize');
  check(icc >= -1 && icc <= 1, 'iccRange');
  check(n > 0, 'sampleCount');
  const deff = 1 + (m - 1) * icc;
  check(deff > 0, 'iccRange');
  return { deff, effective: n / deff };
}

/** The margin of error of a proportion, z √(p(1 − p)/n), times √((N − n)/(N − 1)) for a finite population. */
export function marginOfError(
  p: number,
  n: number,
  confidence: number,
  N: number | null,
): { plain: number; finite: number | null } {
  check(p >= 0 && p <= 1, 'probabilityRange', { name: 'p' });
  check(n >= 1 && Number.isFinite(n), 'sampleCount');
  check(confidence > 0 && confidence < 1, 'confidenceRange');
  const z = normalQuantile(1 - (1 - confidence) / 2);
  const plain = z * Math.sqrt((p * (1 - p)) / n);
  if (N === null) return { plain, finite: null };
  check(N >= n, 'populationSmall');
  return { plain, finite: plain * Math.sqrt((N - n) / (N - 1)) };
}

/** The sample size for a margin e: n₀ = z² p(1 − p)/e² (or z² σ²/e² for a mean), then n₀/(1 + (n₀ − 1)/N). */
export function sampleSizeFor(
  kind: 'proportion' | 'mean',
  value: number,
  margin: number,
  confidence: number,
  N: number | null,
) {
  check(margin > 0, 'marginPositive');
  check(confidence > 0 && confidence < 1, 'confidenceRange');
  if (kind === 'proportion') check(value >= 0 && value <= 1, 'probabilityRange', { name: 'p' });
  else check(value > 0, 'sdPositive');
  const z = normalQuantile(1 - (1 - confidence) / 2);
  const n0 =
    kind === 'proportion'
      ? (z * z * value * (1 - value)) / (margin * margin)
      : (z * z * value * value) / (margin * margin);
  const n = N === null ? n0 : n0 / (1 + (n0 - 1) / N);
  return { n0, n, rounded: Math.ceil(n - 1e-9) };
}
