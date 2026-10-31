// Closed forms of game theory: the discount factor that sustains cooperation under grim trigger, the Nash bargaining
// split of a surplus, Rubinstein's alternating-offers shares, and auctions with values uniform on [0, V], with a
// seeded simulation that checks revenue equivalence.
import { fail, seeded } from '../core/util';

/** Grim trigger sustains (C, C) when delta >= (T - R) / (T - P), for temptation T > reward R > punishment P. */
export function grimThreshold(T: number, R: number, P: number): number {
  if (!(T > R && R > P)) fail('grimOrder');
  return (T - R) / (T - P);
}

/** The (weighted) Nash bargaining split of a surplus S over the disagreement payoffs d1 and d2. */
export function nashBargaining(S: number, d1: number, d2: number, power = 0.5): [number, number] {
  if (power < 0 || power > 1) fail('powerShare');
  const gain = S - d1 - d2;
  if (gain < 0) fail('noGain');
  return [d1 + power * gain, d2 + (1 - power) * gain];
}

/** Rubinstein: the first proposer gets (1 - d2) / (1 - d1 d2) of the pie. */
export function rubinstein(d1: number, d2: number): [number, number] {
  if (!(d1 >= 0 && d1 < 1 && d2 >= 0 && d2 < 1)) fail('discountRange');
  const x = (1 - d2) / (1 - d1 * d2);
  return [x, 1 - x];
}

export interface Auction {
  /** The equilibrium first-price bid is this fraction of one's value: (n - 1) / n. */
  bidShare: number;
  /** Expected revenue of both formats: (n - 1) / (n + 1) of V. */
  revenue: number;
  simFirst: number;
  simSecond: number;
}

export function auction(n: number, V: number, rounds: number, seed: number): Auction {
  if (!Number.isInteger(n) || n < 2 || n > 1000) fail('biddersRange');
  if (!(V > 0)) fail('valuePositive');
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 200000) fail('roundsRange');
  const rand = seeded(seed);
  let first = 0;
  let second = 0;
  for (let r = 0; r < rounds; r += 1) {
    let top = 0;
    let next = 0;
    for (let i = 0; i < n; i += 1) {
      const v = rand() * V;
      if (v > top) [top, next] = [v, top];
      else if (v > next) next = v;
    }
    first += ((n - 1) / n) * top;
    second += next;
  }
  return {
    bidShare: (n - 1) / n,
    revenue: ((n - 1) / (n + 1)) * V,
    simFirst: first / rounds,
    simSecond: second / rounds,
  };
}
