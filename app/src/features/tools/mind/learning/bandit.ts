// Multi-armed bandits: epsilon-greedy (with optimistic starts), softmax, UCB1, and Thompson sampling, run over
// seeded repetitions, with the mean regret and the share of optimal pulls at each step. Rewards are Bernoulli
// (an arm's mean is its chance of paying 1) or Gaussian with a given SD (0 makes them fixed).
import type { Rng } from '../kit/rng';
import { fail } from '../kit/types';

export type Strategy = 'greedy' | 'softmax' | 'ucb' | 'thompson';
export type Payout = 'bernoulli' | 'gaussian';

export interface BanditSetup {
  readonly means: readonly number[];
  readonly payout: Payout;
  readonly sd: number;
  readonly strategy: Strategy;
  /** Epsilon for greedy, temperature for softmax, c for UCB. */
  readonly param: number;
  /** The starting estimate of every arm, for greedy and softmax. */
  readonly start: number;
  /** A constant learning rate, or 'average' for sample means. */
  readonly rate: number | 'average';
}

export interface BanditRun {
  readonly choices: readonly number[];
  readonly rewards: readonly number[];
}

/** One run of `steps` pulls. Ties go to the lowest-numbered arm. */
export function runBandit(setup: BanditSetup, steps: number, rng: Rng): BanditRun {
  const k = setup.means.length;
  if (k < 2) fail('fewArms', {}, 'means');
  if (setup.payout === 'bernoulli' && setup.means.some((m) => !(m >= 0 && m <= 1))) fail('bernoulliMeans', {}, 'means');
  const Q = Array.from({ length: k }, () => setup.start);
  const n = Array.from({ length: k }, () => 0);
  const wins = Array.from({ length: k }, () => 0);
  const sums = Array.from({ length: k }, () => 0);
  const choices: number[] = [];
  const rewards: number[] = [];
  const argmax = (xs: readonly number[]) => xs.reduce((best, x, i) => (x > xs[best] ? i : best), 0);
  for (let t = 0; t < steps; t += 1) {
    let a: number;
    if (setup.strategy === 'greedy') a = rng.next() < setup.param ? rng.int(k) : argmax(Q);
    else if (setup.strategy === 'softmax') {
      const top = Math.max(...Q);
      const w = Q.map((q) => Math.exp((q - top) / setup.param));
      const total = w.reduce((s, x) => s + x, 0);
      let u = rng.next() * total;
      a = k - 1;
      for (let i = 0; i < k; i += 1) {
        u -= w[i];
        if (u < 0) {
          a = i;
          break;
        }
      }
    } else if (setup.strategy === 'ucb') {
      const untried = n.indexOf(0);
      a = untried >= 0 ? untried : argmax(n.map((m, i) => sums[i] / m + setup.param * Math.sqrt(Math.log(t) / m)));
    } else if (setup.payout === 'bernoulli') a = argmax(n.map((m, i) => rng.beta(1 + wins[i], 1 + m - wins[i])));
    else {
      // Gaussian Thompson sampling with a flat prior and the known SD (1 when the SD is 0).
      const s = setup.sd > 0 ? setup.sd : 1;
      a = argmax(n.map((m, i) => (m === 0 ? Infinity : sums[i] / m + (s / Math.sqrt(m)) * rng.normal())));
    }
    const r =
      setup.payout === 'bernoulli'
        ? rng.next() < setup.means[a]
          ? 1
          : 0
        : setup.means[a] + (setup.sd > 0 ? setup.sd * rng.normal() : 0);
    n[a] += 1;
    sums[a] += r;
    if (r === 1) wins[a] += 1;
    const step = setup.rate === 'average' ? 1 / n[a] : setup.rate;
    Q[a] += step * (r - Q[a]);
    choices.push(a);
    rewards.push(r);
  }
  return { choices, rewards };
}

export interface BanditSummary {
  /** Mean cumulative regret after each step, over the runs. */
  readonly regret: readonly number[];
  /** Share of runs that pulled the best arm at each step. */
  readonly optimal: readonly number[];
  readonly meanReward: number;
}

/** Many seeded runs; regret uses the arms' true means, so it does not depend on the reward noise. */
export function banditRuns(setup: BanditSetup, steps: number, runs: number, rng: Rng): BanditSummary {
  const best = Math.max(...setup.means);
  const bestArm = setup.means.indexOf(best);
  const regret = Array.from({ length: steps }, () => 0);
  const optimal = Array.from({ length: steps }, () => 0);
  let reward = 0;
  for (let r = 0; r < runs; r += 1) {
    const run = runBandit(setup, steps, rng);
    let total = 0;
    run.choices.forEach((a, t) => {
      total += best - setup.means[a];
      regret[t] += total / runs;
      if (a === bestArm) optimal[t] += 1 / runs;
    });
    reward += run.rewards.reduce((s, x) => s + x, 0) / (runs * steps);
  }
  return { regret, optimal, meanReward: reward };
}
