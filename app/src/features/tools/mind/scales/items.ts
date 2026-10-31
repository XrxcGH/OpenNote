// Scoring and test items. It reverses items and scores subscales by sum or mean, prorating missing answers. It
// gives the difficulty, discrimination, and point-biserial of multiple-choice items with their distractors. It
// transforms scores to z, T, stanine, and percentile rank with the standard error of measurement. It also
// scores the System Usability Scale.
import { correlation, mean, normCdf, normQuantile, sum } from '../kit/num';
import { fail } from '../kit/types';

export interface Subscale {
  readonly name: string;
  /** Item numbers from 1. */
  readonly items: readonly number[];
}

/** Reverses an answer on a scale from low to high. */
export const reverse = (x: number, low: number, high: number): number => low + high - x;

/**
 * Each respondent's score on each subscale. An item in `reversed` is reversed first. With at most `maxMissing`
 * answers missing, a sum is prorated (the mean of the answers times the number of items); with more it is NaN.
 */
export function scoreScales(
  rows: readonly (readonly number[])[],
  subscales: readonly Subscale[],
  options: { reversed: ReadonlySet<number>; low: number; high: number; method: 'sum' | 'mean'; maxMissing: number },
): number[][] {
  const k = rows[0]?.length ?? 0;
  for (const scale of subscales)
    for (const item of scale.items) if (item < 1 || item > k) fail('noItem', { item }, 'subscales');
  return rows.map((row) =>
    subscales.map((scale) => {
      const answers = scale.items
        .map((item) => row[item - 1])
        .map((x, i) => (options.reversed.has(scale.items[i]) ? reverse(x, options.low, options.high) : x))
        .filter((x) => Number.isFinite(x));
      const missing = scale.items.length - answers.length;
      if (answers.length === 0 || missing > options.maxMissing) return NaN;
      return options.method === 'mean' ? mean(answers) : mean(answers) * scale.items.length;
    }),
  );
}

export interface ItemAnalysis {
  readonly item: number;
  readonly key: string;
  /** The share who chose the key. */
  readonly p: number;
  /** The upper group's p minus the lower group's. */
  readonly d: number;
  /** The correlation of the item with the rest of the test. */
  readonly rpb: number;
  /** How many in each group chose each option. */
  readonly upper: Readonly<Record<string, number>>;
  readonly lower: Readonly<Record<string, number>>;
}

export interface TestAnalysis {
  readonly items: readonly ItemAnalysis[];
  readonly groupSize: number;
  readonly options: readonly string[];
  readonly totals: readonly number[];
}

/** Item analysis of multiple-choice answers against a key, with upper and lower groups of the given share. */
export function analyseItems(
  answers: readonly (readonly string[])[],
  key: readonly string[],
  share = 0.27,
): TestAnalysis {
  if (answers.length < 4) fail('fewRespondents', {}, 'answers');
  if (key.length === 0) fail('empty', {}, 'key');
  answers.forEach((row) => {
    if (row.length !== key.length) fail('keyLength', { got: row.length, want: key.length }, 'answers');
  });
  const scored = answers.map((row) => row.map((a, j) => (a.toUpperCase() === key[j].toUpperCase() ? 1 : 0)));
  const totals = scored.map((row) => sum(row));
  const order = totals.map((t, i) => [t, i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  const groupSize = Math.max(1, Math.round(answers.length * share));
  const upper = order.slice(0, groupSize).map(([, i]) => i);
  const lower = order.slice(-groupSize).map(([, i]) => i);
  const options = [...new Set(answers.flat().map((a) => a.toUpperCase()))].sort();
  const tally = (group: readonly number[], j: number) =>
    Object.fromEntries(options.map((o) => [o, group.filter((i) => answers[i][j].toUpperCase() === o).length]));
  const items = key.map((k, j) => {
    const item = scored.map((row) => row[j]);
    const rest = totals.map((t, i) => t - item[i]);
    const correctIn = (group: readonly number[]) => group.filter((i) => scored[i][j] === 1).length / group.length;
    return {
      item: j + 1,
      key: k.toUpperCase(),
      p: mean(item),
      d: correctIn(upper) - correctIn(lower),
      rpb: correlation(item, rest),
      upper: tally(upper, j),
      lower: tally(lower, j),
    };
  });
  return { items, groupSize, options, totals };
}

export interface Transform {
  readonly z: number;
  readonly t: number;
  readonly stanine: number;
  readonly percentile: number;
  readonly sem: number;
  readonly low: number;
  readonly high: number;
  /** The estimated true score, regressed toward the mean, and its standard error. */
  readonly trueScore: number;
  readonly see: number;
}

/** Standard scores and the band of a score with reliability rxx; `norms`, when given, sets the percentile rank. */
export function transform(
  x: number,
  m: number,
  s: number,
  rxx: number,
  level: number,
  norms: readonly number[] = [],
): Transform {
  if (!(s > 0)) fail('positive', {}, 'sd');
  if (!(rxx >= 0 && rxx <= 1)) fail('range', { low: 0, high: 1 }, 'rxx');
  if (!(level > 0 && level < 1)) fail('range', { low: 0, high: 1 }, 'level');
  const z = (x - m) / s;
  const percentile =
    norms.length > 0
      ? (100 * (norms.filter((v) => v < x).length + 0.5 * norms.filter((v) => v === x).length)) / norms.length
      : 100 * normCdf(z);
  const sem = s * Math.sqrt(1 - rxx);
  const zc = normQuantile(1 - (1 - level) / 2);
  return {
    z,
    t: 50 + 10 * z,
    stanine: Math.min(9, Math.max(1, Math.round(2 * z + 5))),
    percentile,
    sem,
    low: x - zc * sem,
    high: x + zc * sem,
    trueScore: m + rxx * (x - m),
    see: s * Math.sqrt(rxx * (1 - rxx)),
  };
}

/** The System Usability Scale score of 10 answers from 1 to 5: odd items count up, even items count down. */
export function sus(answers: readonly number[]): number {
  if (answers.length !== 10) fail('tenItems', { got: answers.length }, 'sus');
  answers.forEach((a) => {
    if (!Number.isInteger(a) || a < 1 || a > 5) fail('likert5', { value: a }, 'sus');
  });
  return 2.5 * sum(answers.map((a, i) => (i % 2 === 0 ? a - 1 : 5 - a)));
}
