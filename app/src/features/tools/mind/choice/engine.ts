// Decision and choice models. The drift-diffusion part gives choice probability and mean decision time in closed
// form, also with a biased start. It gives the first-passage time density by the Navarro and Fuss (2009) series and
// runs a seeded Euler-Maruyama simulation. EZ-diffusion (Wagenmakers, van der Maas, and Grasman 2007) works from
// accuracy and the mean and variance of correct response times. The prospect-theory part (Tversky and Kahneman
// 1992) gives the value function, probability weights, and a gamble's value and certainty equivalent.
import { logit, quantile } from '../kit/num';
import type { Rng } from '../kit/rng';
import { fail } from '../kit/types';

export interface Diffusion {
  /** Drift rate v, evidence units per second. */
  readonly v: number;
  /** Boundary separation a: the lower boundary is at 0 and the upper at a. */
  readonly a: number;
  /** Starting point as a share of a: 0.5 is unbiased. */
  readonly w: number;
  /** Within-trial noise s, 0.1 by convention. */
  readonly s: number;
}

export function checkDiffusion(d: Diffusion): Diffusion {
  if (!(d.a > 0) || !Number.isFinite(d.a)) fail('positive', {}, 'a');
  if (!(d.s > 0) || !Number.isFinite(d.s)) fail('positive', {}, 's');
  if (!(d.w > 0 && d.w < 1)) fail('range', { low: 0, high: 1 }, 'w');
  if (!Number.isFinite(d.v)) fail('number', {}, 'v');
  return d;
}

/** Probability of reaching the upper (correct) boundary, and the mean decision time over both boundaries. */
export function diffusionChoice(d: Diffusion): { pUpper: number; meanDt: number } {
  const { v, a, w, s } = d;
  const z = w * a;
  if (Math.abs(v) < 1e-12) return { pUpper: w, meanDt: (z * (a - z)) / (s * s) };
  const k = (-2 * v) / (s * s);
  // P(upper) = (1 - e^{-2vz/s^2}) / (1 - e^{-2va/s^2}), written with expm1 for small drifts.
  const pUpper = Math.expm1(k * z) / Math.expm1(k * a);
  return { pUpper, meanDt: (a * pUpper - z) / v };
}

/**
 * The first-passage time density at the lower boundary for unit noise, drift v, separation a, and start w (a
 * share of a), at decision time t > 0. It uses the small-time series for t/a^2 below 1, the large-time one above.
 */
function lowerDensity(t: number, v: number, a: number, w: number): number {
  if (!(t > 0)) return 0;
  const u = t / (a * a);
  const front = Math.exp(-v * a * w - (v * v * t) / 2) / (a * a);
  let series = 0;
  if (u < 1) {
    for (let k = -12; k <= 12; k += 1) {
      const x = w + 2 * k;
      series += x * Math.exp((-x * x) / (2 * u));
    }
    series /= Math.sqrt(2 * Math.PI * u * u * u);
  } else {
    for (let k = 1; k <= 60; k += 1)
      series += k * Math.exp((-k * k * Math.PI * Math.PI * u) / 2) * Math.sin(k * Math.PI * w);
    series *= Math.PI;
  }
  return front * series;
}

/** The density of decision times that end at each boundary, per second, for the model's noise s. */
export function passageDensity(t: number, d: Diffusion, boundary: 'upper' | 'lower'): number {
  const v = d.v / d.s;
  const a = d.a / d.s;
  return boundary === 'lower' ? lowerDensity(t, v, a, d.w) : lowerDensity(t, -v, a, 1 - d.w);
}

export interface Simulation {
  readonly trials: number;
  readonly upper: readonly number[];
  readonly lower: readonly number[];
  /** Trials that reached neither boundary in the time allowed. */
  readonly unfinished: number;
}

/** Simulates the walk with steps of dt seconds, until a boundary or maxT; times include the non-decision time. */
export function simulate(d: Diffusion, ter: number, n: number, dt: number, rng: Rng, maxT = 10): Simulation {
  const upper: number[] = [];
  const lower: number[] = [];
  let unfinished = 0;
  const step = d.s * Math.sqrt(dt);
  const limit = Math.ceil(maxT / dt);
  for (let i = 0; i < n; i += 1) {
    let x = d.w * d.a;
    let k = 0;
    while (x > 0 && x < d.a && k < limit) {
      x += d.v * dt + step * rng.normal();
      k += 1;
    }
    if (x >= d.a) upper.push(ter + k * dt);
    else if (x <= 0) lower.push(ter + k * dt);
    else unfinished += 1;
  }
  return { trials: n, upper, lower, unfinished };
}

/** The response-time quantiles the diffusion literature reports. */
export const QUANTILES = [0.1, 0.3, 0.5, 0.7, 0.9] as const;
export const rtQuantiles = (times: readonly number[]): number[] =>
  times.length === 0 ? QUANTILES.map(() => NaN) : QUANTILES.map((p) => quantile(times, p));

/** What EZ-diffusion predicts for a model: accuracy, and the mean and variance of correct response times. */
export function ezForward(v: number, a: number, ter: number, s: number): { pc: number; vrt: number; mrt: number } {
  if (!(v > 0)) fail('positive', {}, 'v');
  const y = (-v * a) / (s * s);
  const ey = Math.exp(y);
  const pc = 1 / (1 + ey);
  const mdt = (a / (2 * v)) * ((1 - ey) / (1 + ey));
  const vrt = ((a * s * s) / (2 * v * v * v)) * ((2 * y * ey - Math.exp(2 * y) + 1) / ((ey + 1) * (ey + 1)));
  return { pc, vrt, mrt: ter + mdt };
}

export interface Ez {
  readonly L: number;
  readonly x: number;
  readonly v: number;
  readonly a: number;
  readonly mdt: number;
  readonly ter: number;
}

/** Drift, boundary separation, and non-decision time from accuracy, RT variance (s^2), and mean RT (s). */
export function ez(pc: number, vrt: number, mrt: number, s: number): Ez {
  if (!(pc > 0 && pc < 1)) fail('ezEdge', {}, 'pc');
  if (Math.abs(pc - 0.5) < 1e-12) fail('ezChance', {}, 'pc');
  if (!(vrt > 0)) fail('positive', {}, 'vrt');
  if (!(mrt > 0)) fail('positive', {}, 'mrt');
  const L = logit(pc);
  const x = (L * (L * pc * pc - L * pc + pc - 0.5)) / vrt;
  const v = Math.sign(pc - 0.5) * s * Math.pow(x, 0.25);
  const a = (s * s * L) / v;
  const y = (-v * a) / (s * s);
  const mdt = (a / (2 * v)) * ((1 - Math.exp(y)) / (1 + Math.exp(y)));
  const ter = mrt - mdt;
  if (ter < 0) fail('ezTer', {}, 'mrt');
  return { L, x, v, a, mdt, ter };
}

export interface ValueShape {
  readonly alpha: number;
  readonly beta: number;
  readonly lambda: number;
}

/** The prospect-theory value of an outcome relative to the reference point. */
export const value = (x: number, f: ValueShape): number =>
  x >= 0 ? Math.pow(x, f.alpha) : -f.lambda * Math.pow(-x, f.beta);

/** The outcome whose value is v: the certainty equivalent of a gamble worth v. */
export const inverseValue = (v: number, f: ValueShape): number =>
  v >= 0 ? Math.pow(v, 1 / f.alpha) : -Math.pow(-v / f.lambda, 1 / f.beta);

export type Weighting = 'tk' | 'prelec' | 'none';

/** A decision weight for a probability: Tversky-Kahneman (1992) with gamma, or Prelec (1998) with gamma and delta. */
export function weight(p: number, kind: Weighting, gamma: number, delta = 1): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  if (kind === 'none') return p;
  if (kind === 'prelec') return Math.exp(-delta * Math.pow(-Math.log(p), gamma));
  const pg = Math.pow(p, gamma);
  return pg / Math.pow(pg + Math.pow(1 - p, gamma), 1 / gamma);
}

export interface Outcome {
  readonly x: number;
  readonly p: number;
}

export interface GambleValue {
  readonly outcomes: readonly (Outcome & { readonly weight: number; readonly value: number })[];
  readonly expected: number;
  readonly worth: number;
  readonly certainty: number;
}

/**
 * A gamble's value under cumulative prospect theory: gains and losses are ranked from the most extreme, and each
 * outcome's decision weight is w(chance of an outcome at least that extreme) minus w(chance of a more extreme one).
 */
export function gamble(
  outcomes: readonly Outcome[],
  shape: ValueShape,
  kind: Weighting,
  gammaGain: number,
  gammaLoss: number,
  delta = 1,
): GambleValue {
  if (outcomes.length === 0) fail('empty', {}, 'gamble');
  const total = outcomes.reduce((s, o) => s + o.p, 0);
  if (outcomes.some((o) => !(o.p >= 0)) || Math.abs(total - 1) > 1e-6) fail('probabilities', { total }, 'gamble');
  const decide = (side: Outcome[], gammaSide: number) => {
    // From the most extreme outcome inward.
    side.sort((p, q) => Math.abs(q.x) - Math.abs(p.x));
    let before = 0;
    return side.map((o) => {
      const after = before + o.p;
      const w = weight(after, kind, gammaSide, delta) - weight(before, kind, gammaSide, delta);
      before = after;
      return { ...o, weight: w, value: value(o.x, shape) };
    });
  };
  const gains = decide(
    outcomes.filter((o) => o.x > 0),
    gammaGain,
  );
  const losses = decide(
    outcomes.filter((o) => o.x < 0),
    gammaLoss,
  );
  const zero = outcomes.filter((o) => o.x === 0).map((o) => ({ ...o, weight: 0, value: 0 }));
  const all = [...gains, ...zero, ...losses].sort((p, q) => q.x - p.x);
  const worth = all.reduce((s, o) => s + o.weight * o.value, 0);
  return {
    outcomes: all,
    expected: outcomes.reduce((s, o) => s + o.x * o.p, 0),
    worth,
    certainty: inverseValue(worth, shape),
  };
}
