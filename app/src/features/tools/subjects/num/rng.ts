// The seeded random number generator every subject tool uses for simulations, resampling, random assignment and
// generated drills. The same seed gives the same stream on every device. The generator is xoshiro128** (Blackman
// and Vigna, 2018). Its four 32-bit state words come from two SplitMix64 outputs of the 64-bit seed. All 32-bit
// products go through Math.imul, so no platform rounds differently.
import { SubjectError } from '../errors';

const MASK64 = (1n << 64n) - 1n;
const TWO_POW_26 = 67_108_864;
const TWO_POW_53 = 9_007_199_254_740_992;

/** The largest n for which binomial() counts exactly; above it a normal approximation is used and flagged. */
export const BINOMIAL_EXACT_MAX = 1000;
/** Below this mean poisson() multiplies uniforms (Knuth); at or above it, it uses transformed rejection (PTRS). */
export const POISSON_KNUTH_MAX = 30;
/** The largest seed a student can type: 2^64 - 1. */
export const MAX_SEED = MASK64;

/** One SplitMix64 step: returns the next state and its output, both as unsigned 64-bit BigInts. */
export function splitMix64(state: bigint): { state: bigint; value: bigint } {
  const next = (state + 0x9e3779b97f4a7c15n) & MASK64;
  let z = next;
  z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK64;
  z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK64;
  return { state: next, value: z ^ (z >> 31n) };
}

/** ln k! exactly summed up to 255, then by Stirling's series (error below 1e-15 there). */
const LOG_FACTORIALS: readonly number[] = (() => {
  const out = [0];
  for (let k = 1; k <= 255; k += 1) out.push(out[k - 1] + Math.log(k));
  return out;
})();

export function logFactorial(k: number): number {
  if (k <= 255) return LOG_FACTORIALS[k];
  const n = k + 1;
  const inv = 1 / n;
  const inv2 = inv * inv;
  const series = inv * (1 / 12 - inv2 * (1 / 360 - inv2 * (1 / 1260 - inv2 / 1680)));
  return (n - 0.5) * Math.log(n) - n + 0.5 * Math.log(2 * Math.PI) + series;
}

const rotl = (x: number, k: number): number => ((x << k) | (x >>> (32 - k))) >>> 0;

/** Reads a typed seed: a whole number from 0 to 2^64 - 1, digits only (spaces and thousands commas ignored). */
export function parseSeed(text: string): bigint | null {
  const digits = text.replace(/[\s,_]/g, '');
  if (!/^\d{1,20}$/.test(digits)) return null;
  const seed = BigInt(digits);
  return seed <= MASK64 ? seed : null;
}

/** A fresh seed from the platform's cryptographic source, kept to 9 digits so it is easy to copy into notes. */
export function newSeed(): bigint {
  const words = new Uint32Array(1);
  globalThis.crypto.getRandomValues(words);
  return BigInt(words[0] % 1_000_000_000);
}

export class Rng {
  readonly seed: bigint;
  /** True once any draw used an approximation (a binomial with n above BINOMIAL_EXACT_MAX). */
  approximated = false;
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;
  private spareNormal: number | null = null;

  constructor(seed: bigint | number) {
    const big = typeof seed === 'bigint' ? seed & MASK64 : BigInt(Math.trunc(Math.abs(seed))) & MASK64;
    this.seed = big;
    const first = splitMix64(big);
    const second = splitMix64(first.state);
    this.s0 = Number(first.value & 0xffffffffn);
    this.s1 = Number(first.value >> 32n);
    this.s2 = Number(second.value & 0xffffffffn);
    this.s3 = Number(second.value >> 32n);
    // An all-zero state would repeat zeros forever; SplitMix64 never gives two zero outputs, but guard anyway.
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  /** The next unsigned 32-bit output. */
  nextUint32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5) >>> 0, 7), 9) >>> 0;
    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform from 0 up to but not including 1, with 53 random bits from two outputs. */
  uniform(): number {
    const a = this.nextUint32() >>> 5;
    const b = this.nextUint32() >>> 6;
    return (a * TWO_POW_26 + b) / TWO_POW_53;
  }

  /** A whole number from 0 to n - 1 with every value equally likely (rejection removes the modulo bias). */
  integer(n: number): number {
    if (!Number.isInteger(n) || n < 1)
      throw new SubjectError('domain', 'integer() needs a whole number of choices, at least 1');
    if (n > 0x1_0000_0000) return Math.floor(this.uniform() * n);
    const limit = Math.floor(0x1_0000_0000 / n) * n;
    for (;;) {
      const x = this.nextUint32();
      if (x < limit) return x % n;
    }
  }

  /** Standard normal by the Marsaglia polar method; the second value of each pair is kept for the next call. */
  normal(mean = 0, sd = 1): number {
    if (this.spareNormal !== null) {
      const z = this.spareNormal;
      this.spareNormal = null;
      return mean + sd * z;
    }
    for (;;) {
      const u = 2 * this.uniform() - 1;
      const v = 2 * this.uniform() - 1;
      const s = u * u + v * v;
      if (s > 0 && s < 1) {
        const f = Math.sqrt((-2 * Math.log(s)) / s);
        this.spareNormal = v * f;
        return mean + sd * u * f;
      }
    }
  }

  /** Exponential with the given rate (mean 1 / rate). */
  exponential(rate = 1): number {
    return -Math.log(1 - this.uniform()) / rate;
  }

  /** Gamma with the given shape and scale, by Marsaglia and Tsang (2000); shapes below 1 use the U^(1/a) boost. */
  gamma(shape: number, scale = 1): number {
    if (!(shape > 0) || !(scale > 0)) throw new SubjectError('domain', 'gamma() needs a positive shape and scale');
    if (shape < 1) return this.gamma(shape + 1, scale) * Math.pow(this.uniform(), 1 / shape);
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      const x = this.normal();
      const base = 1 + c * x;
      if (base <= 0) continue;
      const v = base * base * base;
      const u = this.uniform();
      if (u < 1 - 0.0331 * x ** 4) return d * v * scale;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v * scale;
    }
  }

  /** Beta(a, b) as X / (X + Y) with X ~ Gamma(a) and Y ~ Gamma(b). */
  beta(a: number, b: number): number {
    const x = this.gamma(a);
    const y = this.gamma(b);
    return x / (x + y);
  }

  /**
   * Binomial(n, p). Up to BINOMIAL_EXACT_MAX trials it uses Devroye's second waiting-time method (sums of
   * exponential spacings) on min(p, 1 - p); above that it rounds a normal draw and sets `approximated`.
   */
  binomial(n: number, p: number): number {
    if (!Number.isInteger(n) || n < 0) throw new SubjectError('domain', 'binomial() needs a whole number of trials');
    if (!(p >= 0 && p <= 1)) throw new SubjectError('domain', 'binomial() needs a probability from 0 to 1');
    if (n === 0 || p === 0) return 0;
    if (p === 1) return n;
    if (p > 0.5) return n - this.binomial(n, 1 - p);
    if (n > BINOMIAL_EXACT_MAX) {
      this.approximated = true;
      const draw = Math.round(this.normal(n * p, Math.sqrt(n * p * (1 - p))));
      return Math.min(n, Math.max(0, draw));
    }
    const q = -Math.log(1 - p);
    let sum = 0;
    for (let x = 0; x < n; x += 1) {
      sum += this.exponential() / (n - x);
      if (sum > q) return x;
    }
    return n;
  }

  /** Poisson with the given mean: Knuth's product of uniforms below 30, Hörmann's PTRS (1993) from 30 up. */
  poisson(mean: number): number {
    if (!(mean >= 0) || !Number.isFinite(mean))
      throw new SubjectError('domain', 'poisson() needs a finite mean of 0 or more');
    if (mean === 0) return 0;
    if (mean < POISSON_KNUTH_MAX) {
      const limit = Math.exp(-mean);
      let k = 0;
      let product = this.uniform();
      while (product > limit) {
        k += 1;
        product *= this.uniform();
      }
      return k;
    }
    return this.poissonPtrs(mean);
  }

  private poissonPtrs(mean: number): number {
    const root = Math.sqrt(mean);
    const b = 0.931 + 2.53 * root;
    const a = -0.059 + 0.02483 * b;
    const invAlpha = 1.1239 + 1.1328 / (b - 3.4);
    const vr = 0.9277 - 3.6224 / (b - 2);
    const logMean = Math.log(mean);
    for (;;) {
      const u = this.uniform() - 0.5;
      const v = this.uniform();
      const us = 0.5 - Math.abs(u);
      const k = Math.floor(((2 * a) / us + b) * u + mean + 0.43);
      if (us >= 0.07 && v <= vr) return k;
      if (k < 0 || (us < 0.013 && v > us)) continue;
      const lhs = Math.log(v) + Math.log(invAlpha) - Math.log(a / (us * us) + b);
      if (lhs <= -mean + k * logMean - logFactorial(k)) return k;
    }
  }

  /** Counts for n trials over categories with the given probabilities (normalized), by sequential binomials. */
  multinomial(n: number, probs: readonly number[]): number[] {
    const total = probs.reduce((s, p) => s + p, 0);
    if (!(total > 0) || probs.some((p) => !(p >= 0)))
      throw new SubjectError('domain', 'multinomial() needs probabilities of 0 or more with a positive sum');
    const counts = probs.map(() => 0);
    let left = n;
    let mass = total;
    for (let i = 0; i < probs.length && left > 0; i += 1) {
      if (i === probs.length - 1) {
        counts[i] = left;
        break;
      }
      const share = mass > 0 ? Math.min(1, probs[i] / mass) : 0;
      counts[i] = this.binomial(left, share);
      left -= counts[i];
      mass -= probs[i];
    }
    return counts;
  }

  /** Shuffles a copy of the items (Fisher-Yates). */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = this.integer(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /** k items drawn with or without replacement. Without replacement, k may not exceed the number of items. */
  sample<T>(items: readonly T[], k: number, replace = false): T[] {
    if (!Number.isInteger(k) || k < 0) throw new SubjectError('domain', 'sample() needs a whole number of draws');
    if (replace) {
      if (items.length === 0 && k > 0) throw new SubjectError('domain', 'sample() cannot draw from an empty list');
      return Array.from({ length: k }, () => items[this.integer(items.length)]);
    }
    if (k > items.length)
      throw new SubjectError('domain', 'sample() without replacement cannot draw more items than it has');
    const pool = items.slice();
    for (let i = 0; i < k; i += 1) {
      const j = i + this.integer(pool.length - i);
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, k);
  }

  /** The index of one category, chosen with probability proportional to its weight. */
  weightedIndex(weights: readonly number[]): number {
    const cumulative: number[] = [];
    let total = 0;
    for (const w of weights) {
      if (!(w >= 0) || !Number.isFinite(w))
        throw new SubjectError('domain', 'weightedIndex() needs finite weights of 0 or more');
      total += w;
      cumulative.push(total);
    }
    if (!(total > 0)) throw new SubjectError('domain', 'weightedIndex() needs at least one positive weight');
    const target = this.uniform() * total;
    let lo = 0;
    let hi = cumulative.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] > target) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }
}
