// Mid-ranks with tie groups, and the tie-correction sums every rank test uses: Mann-Whitney, Wilcoxon, Kruskal-Wallis,
// Friedman, Spearman, and Kendall. Tied values share the mean of the ranks they would have taken, counting from 1.
import { ensure } from '../errors';

export interface Ranking {
  /** The mid-rank of each value, in input order. */
  ranks: number[];
  /** The size of each group of tied values with two or more members, in increasing order of value. */
  ties: number[];
}

/** Ranks the values (smallest gets 1); ties get the mean of their positions. Values must be finite. */
export function midRanks(values: readonly number[]): Ranking {
  ensure(
    values.every((v) => Number.isFinite(v)),
    'notFinite',
    'rank',
  );
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v || a.i - b.i);
  const ranks = new Array<number>(values.length);
  const ties: number[] = [];
  let start = 0;
  while (start < order.length) {
    let end = start + 1;
    while (end < order.length && order[end].v === order[start].v) end += 1;
    const rank = (start + 1 + end) / 2;
    for (let k = start; k < end; k += 1) ranks[order[k].i] = rank;
    if (end - start > 1) ties.push(end - start);
    start = end;
  }
  return { ranks, ties };
}

/** Σ (t³ − t) over tie groups: the correction in the Mann-Whitney, Kruskal-Wallis, Friedman, and Spearman variances. */
export const cubicTieSum = (ties: readonly number[]): number => ties.reduce((s, t) => s + t * t * t - t, 0);

/** Σ t(t − 1)/2 over tie groups: the tied pairs Kendall's tau-b removes from each variable. */
export const tiedPairs = (ties: readonly number[]): number => ties.reduce((s, t) => s + (t * (t - 1)) / 2, 0);

/** The three tie sums in the variance of S, the score of Kendall's tau: Σ t(t−1)(2t+5), Σ t(t−1)(t−2), and Σ t(t−1). */
export function kendallTieTerms(ties: readonly number[]): { v0: number; v1: number; v2: number } {
  let v0 = 0;
  let v1 = 0;
  let v2 = 0;
  for (const t of ties) {
    v0 += t * (t - 1) * (2 * t + 5);
    v1 += t * (t - 1) * (t - 2);
    v2 += t * (t - 1);
  }
  return { v0, v1, v2 };
}

/** Ranks several groups together, as the Mann-Whitney and Kruskal-Wallis tests do, and splits the ranks back. */
export function rankGroups(groups: readonly (readonly number[])[]): { ranks: number[][]; ties: number[] } {
  const all = groups.flat();
  const { ranks, ties } = midRanks(all);
  const out: number[][] = [];
  let at = 0;
  for (const g of groups) {
    out.push(ranks.slice(at, at + g.length));
    at += g.length;
  }
  return { ranks: out, ties };
}
