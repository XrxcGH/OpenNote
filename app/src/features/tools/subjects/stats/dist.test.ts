import { describe, expect, it } from 'vitest';
import { SubjectError } from '../errors';
import {
  betaCdf,
  betaQuantile,
  binomialCdf,
  binomialQuantile,
  binomialSf,
  chiSquareCdf,
  chiSquareQuantile,
  chiSquareSf,
  clopperPearson,
  exponentialQuantile,
  fCdf,
  fQuantile,
  gammaCdf,
  gammaQuantile,
  garwood,
  hypergeometricPmf,
  hypergeometricQuantile,
  hypergeometricSf,
  negativeBinomialCdf,
  negativeBinomialPmf,
  negativeBinomialQuantile,
  normalCdf,
  normalQuantile,
  poissonCdf,
  poissonQuantile,
  poissonSf,
  agrestiCoull,
  tCdf,
  tQuantile,
  wilson,
} from './dist';

describe('central continuous distributions', () => {
  it('matches the planning-pass quantiles', () => {
    expect(Math.abs(fQuantile(0.975, 4, 10) - 4.4683416)).toBeLessThan(5e-8);
    expect(Math.abs(chiSquareQuantile(0.95, 7) - 14.06714)).toBeLessThan(5e-6);
  });

  it('matches table values of the normal and t', () => {
    expect(normalQuantile(0.975)).toBeCloseTo(1.959963984540054, 13);
    expect(normalQuantile(1e-10)).toBeCloseTo(-6.361340902404056, 11);
    expect(normalQuantile(1 - 1e-10)).toBeCloseTo(6.361340889697422, 6);
    expect(tCdf(2, 5)).toBeCloseTo(0.9490302605850709, 12);
    expect(tQuantile(0.975, 10)).toBeCloseTo(2.228138851986274, 11);
    expect(tQuantile(0.5, 3)).toBe(0);
  });

  it('inverts every distribution function to 1e-12', () => {
    for (const p of [1e-6, 0.025, 0.5, 0.9, 0.999999]) {
      expect(chiSquareCdf(chiSquareQuantile(p, 3.5), 3.5)).toBeCloseTo(p, 12);
      expect(fCdf(fQuantile(p, 3, 17), 3, 17)).toBeCloseTo(p, 12);
      expect(betaCdf(betaQuantile(p, 0.7, 2.5), 0.7, 2.5)).toBeCloseTo(p, 12);
      expect(gammaCdf(gammaQuantile(p, 2.2, 3), 2.2, 3)).toBeCloseTo(p, 12);
      expect(tCdf(tQuantile(p, 4), 4)).toBeCloseTo(p, 12);
    }
  });

  it('keeps small upper tails and closed-form cases', () => {
    // χ² with 2 df is exponential with mean 2, so its tail is e^(−x/2).
    expect(chiSquareSf(60, 2) / Math.exp(-30)).toBeCloseTo(1, 10);
    expect(chiSquareCdf(3.841458820694124, 1)).toBeCloseTo(0.95, 12);
    expect(normalCdf(-1)).toBeCloseTo(0.15865525393145707, 13);
    expect(exponentialQuantile(0.5, 2)).toBeCloseTo(Math.LN2 / 2, 15);
  });

  it('refuses impossible parameters', () => {
    expect(() => tCdf(1, 0)).toThrow(SubjectError);
    expect(() => chiSquareQuantile(1.5, 2)).toThrow(SubjectError);
    expect(() => betaQuantile(0.5, -1, 2)).toThrow(SubjectError);
    expect(chiSquareQuantile(0, 4)).toBe(0);
    expect(chiSquareQuantile(1, 4)).toBe(Infinity);
  });
});

describe('discrete distributions', () => {
  it('matches exact counts for the binomial and Poisson', () => {
    expect(binomialCdf(3, 10, 0.5)).toBeCloseTo(176 / 1024, 14);
    expect(binomialSf(3, 10, 0.5)).toBeCloseTo(1 - 176 / 1024, 14);
    expect(binomialQuantile(0.5, 10, 0.5)).toBe(5);
    // 0 and 1 map to the ends of the support, though the cdf rounds to 1 near k = 29 here.
    expect(binomialQuantile(1, 50, 0.1)).toBe(50);
    expect(binomialQuantile(0, 50, 0.1)).toBe(0);
    expect(hypergeometricQuantile(1, { total: 10, successes: 3, draws: 6 })).toBe(3);
    expect(hypergeometricQuantile(0, { total: 10, successes: 7, draws: 6 })).toBe(3);
    expect(poissonCdf(2, 3)).toBeCloseTo(8.5 * Math.exp(-3), 14);
    expect(poissonSf(2, 3)).toBeCloseTo(1 - 8.5 * Math.exp(-3), 14);
    expect(poissonQuantile(0.4231, 3)).toBe(2);
    expect(poissonQuantile(0.4232, 3)).toBe(3);
  });

  it('matches the hypergeometric of the lady tasting tea and the negative binomial by hand', () => {
    const tea = { total: 8, successes: 4, draws: 4 };
    expect(hypergeometricPmf(4, tea)).toBeCloseTo(1 / 70, 14);
    expect(hypergeometricSf(2, tea)).toBeCloseTo(17 / 70, 14);
    // A tail far below 1e-16 survives because it is summed directly in log space.
    expect(
      hypergeometricSf(29, { total: 60, successes: 30, draws: 30 }) /
        hypergeometricPmf(30, { total: 60, successes: 30, draws: 30 }),
    ).toBeCloseTo(1, 12);
    expect(negativeBinomialCdf(0, 2, 0.5)).toBeCloseTo(0.25, 15);
    expect(negativeBinomialPmf(1, 2, 0.5)).toBeCloseTo(0.25, 15);
    expect(negativeBinomialQuantile(0.25, 2, 0.5)).toBe(0);
  });

  it('refuses impossible parameters', () => {
    expect(() => binomialCdf(1, 2.5, 0.5)).toThrow(SubjectError);
    expect(() => poissonCdf(1, -1)).toThrow(SubjectError);
    expect(() => hypergeometricPmf(1, { total: 5, successes: 6, draws: 2 })).toThrow(SubjectError);
  });
});

describe('intervals for proportions and counts', () => {
  it('matches the planning-pass Clopper-Pearson interval for 7 of 20', () => {
    const { lower, upper } = clopperPearson(7, 20);
    expect(Math.abs(lower - 0.153909)).toBeLessThan(1e-6);
    expect(Math.abs(upper - 0.592189)).toBeLessThan(1e-6);
    expect(clopperPearson(0, 5).lower).toBe(0);
    expect(clopperPearson(5, 5).upper).toBe(1);
  });

  it('matches closed forms at zero successes', () => {
    // Garwood's upper limit for 0 is −ln(α/2); Wilson's is (z²/n)/(1 + z²/n).
    expect(garwood(0).upper).toBeCloseTo(-Math.log(0.025), 10);
    const z2 = 1.959963984540054 ** 2;
    expect(wilson(0, 10).upper).toBeCloseTo(z2 / 10 / (1 + z2 / 10), 12);
    expect(wilson(0, 10).lower).toBe(0);
    const ac = agrestiCoull(7, 20);
    expect(ac.lower).toBeLessThan(0.35);
    expect(ac.upper).toBeGreaterThan(0.35);
    expect(() => clopperPearson(21, 20)).toThrow(SubjectError);
  });
});
