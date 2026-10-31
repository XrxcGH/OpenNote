// Decisions under uncertainty from a payoff table, with one row per alternative and one column per state of nature.
// It gives the criteria without probabilities (maximin, maximax, minimax regret, equal likelihood), the expected
// monetary value, and the expected value of perfect information. With a table of how likely each signal is in each
// state, it adds Bayesian revision and the expected value of sample information. A risk tolerance R turns payoffs
// into exponential utility u(x) = 1 - exp(-x / R), and each alternative's certainty equivalent follows.
import { fail } from '../core/util';

export interface Sample {
  /** P(signal), one per signal. */
  pSignal: number[];
  /** P(state | signal), one row per signal. */
  posterior: number[][];
  /** The best alternative after each signal, and its expected payoff. */
  bestBy: number[];
  valueBy: number[];
  /** Expected value with sample information, and the gain over deciding without it. */
  evwsi: number;
  evsi: number;
  /** EVSI as a share of EVPI. */
  efficiency: number;
}

export interface DecisionResult {
  maximin: number[];
  maximax: number[];
  regret: number[][];
  maxRegret: number[];
  laplace: number[];
  emv: number[];
  best: number;
  /** Expected value with perfect information, and EVPI = EVwPI - max EMV. */
  evwpi: number;
  evpi: number;
  certainty: number[] | null;
  sample: Sample | null;
}

const EPS = 1e-9;
const argmax = (xs: readonly number[]) => xs.reduce((b, x, i) => (x > xs[b] + EPS ? i : b), 0);
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

export function decide(
  payoffs: number[][],
  probs: number[],
  likelihood: number[][] | null,
  tolerance: number | null,
): DecisionResult {
  const states = payoffs[0]?.length ?? 0;
  if (payoffs.length === 0 || states === 0) fail('dcEmpty');
  if (probs.length !== states) fail('dcProbCount', { states, count: probs.length });
  if (probs.some((p) => p < 0)) fail('dcProbNegative');
  if (Math.abs(sum(probs) - 1) > 1e-6) fail('dcProbSum', { sum: Number(sum(probs).toFixed(6)) });
  const maximin = payoffs.map((r) => Math.min(...r));
  const maximax = payoffs.map((r) => Math.max(...r));
  const top = Array.from({ length: states }, (_, j) => Math.max(...payoffs.map((r) => r[j])));
  const regret = payoffs.map((r) => r.map((x, j) => top[j] - x));
  const maxRegret = regret.map((r) => Math.max(...r));
  const laplace = payoffs.map((r) => sum(r) / states);
  const emv = payoffs.map((r) => sum(r.map((x, j) => x * probs[j])));
  const best = argmax(emv);
  const evwpi = sum(top.map((t, j) => t * probs[j]));
  const evpi = evwpi - emv[best];
  let certainty: number[] | null = null;
  if (tolerance !== null) {
    if (!(tolerance > 0)) fail('dcTolerance');
    certainty = payoffs.map((r) => -tolerance * Math.log(sum(r.map((x, j) => probs[j] * Math.exp(-x / tolerance)))));
  }
  let sample: Sample | null = null;
  if (likelihood) {
    if (likelihood.some((r) => r.length !== states)) fail('dcLikelihoodWidth', { states });
    if (likelihood.flat().some((p) => p < 0 || p > 1)) fail('dcLikelihoodRange');
    for (let j = 0; j < states; j += 1) {
      const total = sum(likelihood.map((r) => r[j]));
      if (Math.abs(total - 1) > 1e-6) fail('dcLikelihoodSum', { state: j + 1, sum: Number(total.toFixed(6)) });
    }
    const pSignal = likelihood.map((r) => sum(r.map((l, j) => l * probs[j])));
    const posterior = likelihood.map((r, k) => r.map((l, j) => (pSignal[k] > 0 ? (l * probs[j]) / pSignal[k] : 0)));
    const values = posterior.map((post) => payoffs.map((r) => sum(r.map((x, j) => x * post[j]))));
    const bestBy = values.map(argmax);
    const valueBy = values.map((v, k) => v[bestBy[k]]);
    const evwsi = sum(valueBy.map((v, k) => v * pSignal[k]));
    const evsi = evwsi - emv[best];
    sample = { pSignal, posterior, bestBy, valueBy, evwsi, evsi, efficiency: evpi > EPS ? evsi / evpi : 1 };
  }
  return { maximin, maximax, regret, maxRegret, laplace, emv, best, evwpi, evpi, certainty, sample };
}

export { argmax };

export interface Sensitivity {
  /** Each alternative's EMV when P(first state) is 0 and when it is 1. */
  ends: [number, number][];
  /** The best alternative on each stretch of P(first state), in order. */
  stretches: { best: number; from: number; to: number }[];
}

/**
 * EMV against the probability p of the first state, with the other states sharing 1 - p in their given proportions
 * (equally when they were all given 0). Each EMV is a straight line in p, so the best changes only where 2 cross.
 */
export function sensitivity(payoffs: number[][], probs: number[]): Sensitivity | null {
  const states = payoffs[0]?.length ?? 0;
  if (states < 2) return null;
  const restTotal = probs.slice(1).reduce((s, x) => s + x, 0);
  const share = probs.slice(1).map((x) => (restTotal > 0 ? x / restTotal : 1 / (states - 1)));
  const ends = payoffs.map((r): [number, number] => [r.slice(1).reduce((s, x, j) => s + share[j] * x, 0), r[0]]);
  const at = (i: number, p: number) => ends[i][0] + p * (ends[i][1] - ends[i][0]);
  const bestAt = (p: number) => ends.reduce((b, _, i) => (at(i, p) > at(b, p) + 1e-9 ? i : b), 0);
  const cuts = new Set<number>([0, 1]);
  for (let i = 0; i < ends.length; i += 1)
    for (let j = i + 1; j < ends.length; j += 1) {
      const slope = ends[i][1] - ends[i][0] - (ends[j][1] - ends[j][0]);
      if (Math.abs(slope) < 1e-12) continue;
      const p = (ends[j][0] - ends[i][0]) / slope;
      if (p > 1e-9 && p < 1 - 1e-9) cuts.add(p);
    }
  const points = [...cuts].sort((a, b) => a - b);
  const stretches: Sensitivity['stretches'] = [];
  for (let k = 0; k + 1 < points.length; k += 1) {
    const best = bestAt((points[k] + points[k + 1]) / 2);
    const last = stretches[stretches.length - 1];
    if (last && last.best === best) last.to = points[k + 1];
    else stretches.push({ best, from: points[k], to: points[k + 1] });
  }
  return { ends, stretches };
}
