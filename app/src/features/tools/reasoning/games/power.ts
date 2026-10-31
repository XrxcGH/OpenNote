// Voting power in a weighted voting game [q; w1, ..., wn]. The Shapley-Shubik index is the share of orderings in
// which a player is pivotal; the Banzhaf index is the share of swings. Both are counted exactly by dynamic
// programming over coalition weight and size, so 30 players are as quick as 3.
import { frac } from '../core/frac';
import type { Frac } from '../core/frac';
import { fail } from '../core/util';

export interface Power {
  shapley: Frac[];
  banzhaf: Frac[];
  swings: bigint[];
  vetoes: number[];
  dummies: number[];
  dictator: number | null;
}

function factorial(n: number): bigint {
  let f = 1n;
  for (let i = 2n; i <= BigInt(n); i += 1n) f *= i;
  return f;
}

/** ways[k][w]: the coalitions of the other players with k members and total weight w. */
function coalitionCounts(weights: readonly number[], skip: number, total: number): bigint[][] {
  const n = weights.length;
  const ways = Array.from({ length: n }, () => Array<bigint>(total + 1).fill(0n));
  ways[0][0] = 1n;
  weights.forEach((w, i) => {
    if (i === skip) return;
    for (let k = n - 2; k >= 0; k -= 1)
      for (let s = total - w; s >= 0; s -= 1) if (ways[k][s]) ways[k + 1][s + w] += ways[k][s];
  });
  return ways;
}

export function weightedPower(quota: number, weights: readonly number[]): Power {
  const n = weights.length;
  if (n < 1 || n > 40) fail('playersRange');
  if (weights.some((w) => !Number.isInteger(w) || w < 0)) fail('weightsWhole');
  const total = weights.reduce((s, w) => s + w, 0);
  if (!Number.isInteger(quota) || quota <= total / 2 || quota > total) fail('quotaRange', { half: total / 2, total });
  if (total > 100000) fail('weightsLarge');
  const nFact = factorial(n);
  const swings: bigint[] = [];
  const pivotal: bigint[] = [];
  for (let i = 0; i < n; i += 1) {
    const ways = coalitionCounts(weights, i, total);
    let sw = 0n;
    let piv = 0n;
    for (let k = 0; k < n; k += 1)
      for (let s = Math.max(0, quota - weights[i]); s < quota && s <= total; s += 1) {
        const c = ways[k][s];
        if (!c) continue;
        sw += c;
        piv += c * factorial(k) * factorial(n - k - 1);
      }
    swings.push(sw);
    pivotal.push(piv);
  }
  const allSwings = swings.reduce((s, x) => s + x, 0n);
  const vetoes = weights.flatMap((w, i) => (total - w < quota ? [i] : []));
  const dictator = weights.findIndex((w) => w >= quota);
  return {
    shapley: pivotal.map((p) => frac(p, nFact)),
    banzhaf: swings.map((s) => (allSwings ? frac(s, allSwings) : frac(0))),
    swings,
    vetoes,
    dummies: swings.flatMap((s, i) => (s === 0n ? [i] : [])),
    dictator: dictator >= 0 ? dictator : null,
  };
}
