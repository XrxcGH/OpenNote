// What the curve engines share: row checks, replicate weights, a log-spaced grid, the median, and the F tail.
import { LsError, positive } from '../num/errors';
import { betaInc } from '../num/special';

export type Point = [number, number];
export type Rows = readonly (readonly number[])[];

export const logSpace = (low: number, high: number, n = 120): number[] =>
  Array.from({ length: n + 1 }, (_, i) => low * (high / low) ** (i / n));
export const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Rows with at least `columns` numbers; an optional extra column is a standard deviation used as a weight. */
export function columns(rows: Rows, count: number, min: number): number[][] {
  if (rows.some((r) => r.length < count)) throw new LsError('curves.e.columns', { n: count });
  if (rows.length < min) throw new LsError('errors.points', { min });
  return rows.map((r) => [...r]);
}

/** Weights 1/SD² when every row has a positive SD in column `col`, otherwise none. */
export function weightsFrom(rows: readonly number[][], col: number): number[] | undefined {
  if (!rows.every((r) => r.length > col)) return undefined;
  return rows.map((r) => 1 / positive(r[col], 'SD') ** 2);
}

/** The probability of an F statistic this large or larger on d1 and d2 degrees of freedom. */
export function fSurvival(f: number, d1: number, d2: number): number {
  if (!(f > 0)) return 1;
  return 1 - betaInc((d1 * f) / (d1 * f + d2), d1 / 2, d2 / 2);
}
