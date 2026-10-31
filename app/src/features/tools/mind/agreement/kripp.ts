// Krippendorff's alpha for nominal, ordinal, interval, and ratio data, with missing values allowed. Values are
// paired within each unit into a coincidence matrix; alpha compares the disagreement observed there with the
// disagreement expected from the pooled values. A seeded bootstrap over units gives a percentile interval.
import { quantile } from '../kit/num';
import { makeRng } from '../kit/rng';
import { fail } from '../kit/types';

export type Level = 'nominal' | 'ordinal' | 'interval' | 'ratio';

export interface Alpha {
  readonly alpha: number;
  /** Observed and expected disagreement. */
  readonly dObserved: number;
  readonly dExpected: number;
  /** Pairable values: those in units with at least 2 values. */
  readonly pairable: number;
  readonly units: number;
  readonly values: readonly string[];
  readonly coincidence: readonly (readonly number[])[];
}

/** The squared difference between 2 values at a level of measurement, given the values' totals for ordinal data. */
function difference(
  level: Level,
  values: readonly string[],
  totals: readonly number[],
): (c: number, k: number) => number {
  if (level === 'nominal') return (c, k) => (c === k ? 0 : 1);
  const x = values.map(Number);
  if (level === 'interval') return (c, k) => (x[c] - x[k]) ** 2;
  if (level === 'ratio') return (c, k) => (x[c] + x[k] === 0 ? 0 : ((x[c] - x[k]) / (x[c] + x[k])) ** 2);
  return (c, k) => {
    const [lo, hi] = c < k ? [c, k] : [k, c];
    let between = 0;
    for (let g = lo; g <= hi; g += 1) between += totals[g];
    return (between - (totals[lo] + totals[hi]) / 2) ** 2;
  };
}

/**
 * Alpha from units, each the list of values the coders gave it (empty strings are missing). Numbers are needed
 * for ordinal, interval, and ratio data; ordinal values are ranked in numeric order.
 */
export function krippendorff(units: readonly (readonly string[])[], level: Level): Alpha {
  const filled = units.map((unit) => unit.filter((v) => v.trim() !== ''));
  const paired = filled.filter((unit) => unit.length >= 2);
  if (paired.length === 0) fail('noPairs', {}, 'data');
  const seen = [...new Set(paired.flat())];
  if (level !== 'nominal' && seen.some((v) => !Number.isFinite(Number(v)))) fail('numbersNeeded', {}, 'data');
  if (level === 'ratio' && seen.some((v) => Number(v) < 0)) fail('notNegative', {}, 'data');
  const values = level === 'nominal' ? seen : [...seen].sort((a, b) => Number(a) - Number(b));
  const index = new Map(values.map((v, i) => [v, i]));
  const o = values.map(() => values.map(() => 0));
  for (const unit of paired) {
    const m = unit.length;
    for (let i = 0; i < m; i += 1)
      for (let j = 0; j < m; j += 1) if (i !== j) o[index.get(unit[i])!][index.get(unit[j])!] += 1 / (m - 1);
  }
  const totals = o.map((row) => row.reduce((s, v) => s + v, 0));
  const n = totals.reduce((s, v) => s + v, 0);
  const delta = difference(level, values, totals);
  let observed = 0;
  let expected = 0;
  for (let c = 0; c < values.length; c += 1)
    for (let k = 0; k < values.length; k += 1) {
      observed += o[c][k] * delta(c, k);
      expected += totals[c] * totals[k] * delta(c, k);
    }
  const dObserved = observed / n;
  const dExpected = expected / (n * (n - 1));
  if (dExpected === 0) fail('noVariation', {}, 'data');
  return {
    alpha: 1 - dObserved / dExpected,
    dObserved,
    dExpected,
    pairable: n,
    units: paired.length,
    values,
    coincidence: o,
  };
}

/** A percentile interval for alpha from resampling the units with replacement, with a visible seed. */
export function alphaInterval(
  units: readonly (readonly string[])[],
  level: Level,
  draws: number,
  seed: number,
): { low: number; high: number; used: number } {
  const rng = makeRng(seed);
  const found: number[] = [];
  for (let b = 0; b < draws; b += 1) {
    const sample = units.map(() => units[rng.int(units.length)]);
    try {
      const value = krippendorff(sample, level).alpha;
      if (Number.isFinite(value)) found.push(value);
    } catch {
      // A resample with no pairs or no variation has no alpha; it is left out.
    }
  }
  if (found.length === 0) return { low: NaN, high: NaN, used: 0 };
  return { low: quantile(found, 0.025), high: quantile(found, 0.975), used: found.length };
}
