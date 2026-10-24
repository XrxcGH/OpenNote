import { describe, expect, it } from 'vitest';
import { SubjectError } from '../errors';
import { BINOMIAL_EXACT_MAX, Rng, logFactorial, newSeed, parseSeed, splitMix64 } from './rng';

const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
const variance = (xs: readonly number[]) => {
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
};
const draws = (n: number, draw: () => number) => Array.from({ length: n }, draw);

describe('seeded generator', () => {
  it('matches the reference stream for seed 42', () => {
    const rng = new Rng(42n);
    expect([rng.nextUint32(), rng.nextUint32(), rng.nextUint32(), rng.nextUint32()]).toEqual([
      1776835114, 4165204688, 17111135, 2317295270,
    ]);
    // The reference value is printed to 15 significant digits; the exact double is built from the two words.
    const u = new Rng(42).uniform();
    expect(u).toBe(((1776835114 >>> 5) * 2 ** 26 + (4165204688 >>> 6)) / 2 ** 53);
    expect(Math.abs(u - 0.413701668156589)).toBeLessThan(1e-15);
  });

  it('gives SplitMix64 its published first output for seed 0', () => {
    expect(splitMix64(0n).value).toBe(0xe220a8397b1dcdafn);
  });

  it('sums log factorials and switches to Stirling smoothly', () => {
    expect(logFactorial(0)).toBe(0);
    expect(logFactorial(10)).toBeCloseTo(Math.log(3628800), 12);
    // ln 300! by direct summation, the independent check for the Stirling branch.
    let direct = 0;
    for (let k = 2; k <= 300; k += 1) direct += Math.log(k);
    expect(logFactorial(300)).toBeCloseTo(direct, 9);
  });

  it('reproduces the same stream from the same seed and differs for another seed', () => {
    const a = new Rng(2024n);
    const b = new Rng(2024n);
    const c = new Rng(2025n);
    const sa = draws(50, () => a.normal());
    expect(draws(50, () => b.normal())).toEqual(sa);
    expect(draws(50, () => c.normal())).not.toEqual(sa);
  });

  it('reads typed seeds and rejects impossible ones', () => {
    expect(parseSeed(' 1,234 ')).toBe(1234n);
    expect(parseSeed('18446744073709551615')).toBe(18446744073709551615n);
    expect(parseSeed('18446744073709551616')).toBeNull();
    expect(parseSeed('-3')).toBeNull();
    expect(parseSeed('')).toBeNull();
    expect(parseSeed('12a')).toBeNull();
    const fresh = newSeed();
    expect(fresh >= 0n && fresh < 1_000_000_000n).toBe(true);
  });
});

describe('seeded draws', () => {
  it('keeps uniforms in [0, 1) and integers unbiased across their range', () => {
    const rng = new Rng(7n);
    const us = draws(20000, () => rng.uniform());
    expect(Math.min(...us)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...us)).toBeLessThan(1);
    expect(mean(us)).toBeCloseTo(0.5, 2);
    const counts = [0, 0, 0, 0, 0, 0];
    for (let i = 0; i < 60000; i += 1) counts[rng.integer(6)] += 1;
    // Chi-square with 5 degrees of freedom; 20.5 is beyond the 0.999 quantile.
    const chi = counts.reduce((s, c) => s + (c - 10000) ** 2 / 10000, 0);
    expect(chi).toBeLessThan(20.5);
    expect(() => rng.integer(0)).toThrow(SubjectError);
  });

  it('draws continuous distributions with the right moments', () => {
    const rng = new Rng(99n);
    const n = 40000;
    const z = draws(n, () => rng.normal(10, 2));
    expect(mean(z)).toBeCloseTo(10, 1);
    expect(Math.sqrt(variance(z))).toBeCloseTo(2, 1);
    expect(mean(draws(n, () => rng.exponential(4)))).toBeCloseTo(0.25, 2);
    const g = draws(n, () => rng.gamma(3, 2));
    expect(mean(g) / 6).toBeCloseTo(1, 1);
    expect(variance(g) / 12).toBeCloseTo(1, 1);
    expect(mean(draws(n, () => rng.gamma(0.4)))).toBeCloseTo(0.4, 1);
    expect(mean(draws(n, () => rng.beta(2, 5)))).toBeCloseTo(2 / 7, 2);
    expect(() => rng.gamma(0)).toThrow(SubjectError);
  });
});

describe('seeded counts and choices', () => {
  it('draws binomial and Poisson counts with the right moments in every regime', () => {
    const rng = new Rng(5n);
    const n = 20000;
    const small = draws(n, () => rng.binomial(20, 0.3));
    expect(mean(small)).toBeCloseTo(6, 1);
    expect(variance(small)).toBeCloseTo(4.2, 0);
    expect(mean(draws(n, () => rng.binomial(10, 0.9)))).toBeCloseTo(9, 1);
    expect(rng.binomial(10, 0)).toBe(0);
    expect(rng.binomial(10, 1)).toBe(10);
    expect(rng.approximated).toBe(false);
    const big = draws(2000, () => rng.binomial(BINOMIAL_EXACT_MAX + 1000, 0.5));
    expect(mean(big) / 1000).toBeCloseTo(1, 2);
    expect(rng.approximated).toBe(true);
    const knuth = draws(n, () => rng.poisson(4));
    expect(mean(knuth)).toBeCloseTo(4, 1);
    expect(variance(knuth)).toBeCloseTo(4, 0);
    const ptrs = draws(n, () => rng.poisson(100));
    expect(mean(ptrs) / 100).toBeCloseTo(1, 2);
    expect(variance(ptrs) / 100).toBeCloseTo(1, 1);
    expect(() => rng.poisson(-1)).toThrow(SubjectError);
    expect(() => rng.binomial(2.5, 0.5)).toThrow(SubjectError);
  });

  it('shuffles, samples and chooses by weight', () => {
    const rng = new Rng(11n);
    const items = [1, 2, 3, 4, 5, 6, 7, 8];
    const shuffled = rng.shuffle(items);
    expect([...shuffled].sort((a, b) => a - b)).toEqual(items);
    const picked = rng.sample(items, 5);
    expect(new Set(picked).size).toBe(5);
    expect(rng.sample(items, 20, true)).toHaveLength(20);
    expect(() => rng.sample(items, 9)).toThrow(SubjectError);
    const tally = [0, 0, 0];
    for (let i = 0; i < 30000; i += 1) tally[rng.weightedIndex([1, 2, 7])] += 1;
    expect(tally[0] / 30000).toBeCloseTo(0.1, 1);
    expect(tally[2] / 30000).toBeCloseTo(0.7, 1);
    expect(rng.weightedIndex([0, 0, 5])).toBe(2);
    expect(() => rng.weightedIndex([0, 0])).toThrow(SubjectError);
    const counts = rng.multinomial(1000, [0.2, 0.3, 0.5]);
    expect(counts.reduce((s, c) => s + c, 0)).toBe(1000);
    expect(() => rng.multinomial(10, [0, 0])).toThrow(SubjectError);
  });
});
