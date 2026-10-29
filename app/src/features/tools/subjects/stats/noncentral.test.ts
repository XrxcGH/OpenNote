import { describe, expect, it } from 'vitest';
import { SubjectError } from '../errors';
import {
  chiSquareCdf,
  exactP,
  fSf,
  kendallDistribution,
  mannWhitneyDistribution,
  noncentralChiSquareCdf,
  noncentralChiSquareQuantile,
  noncentralChiSquareSf,
  noncentralFCdf,
  noncentralFSf,
  noncentralTCdf,
  normalRangeCdf,
  signedRankDistribution,
  spearmanDistribution,
  studentizedRangeCdf,
  studentizedRangeQuantile,
  tCdf,
} from './dist';
import { midRanks } from './rank';

describe('noncentral distributions', () => {
  it('matches the planning-pass values', () => {
    expect(Math.abs(noncentralTCdf(2, 10, 1) - 0.80761156)).toBeLessThan(1e-7);
    expect(Math.abs(noncentralFSf(3, 2, 27, 5) - 0.51261955)).toBeLessThan(1e-7);
    expect(Math.abs(noncentralChiSquareCdf(5, 3, 2) - 0.59340518)).toBeLessThan(1e-7);
  });

  it('reduces to the central distributions at zero noncentrality', () => {
    expect(noncentralTCdf(1.3, 7, 0)).toBeCloseTo(tCdf(1.3, 7), 11);
    expect(noncentralTCdf(-1.3, 7, 0)).toBeCloseTo(tCdf(-1.3, 7), 11);
    expect(noncentralChiSquareCdf(4, 3, 0)).toBeCloseTo(chiSquareCdf(4, 3), 12);
    expect(noncentralFSf(2, 3, 9, 0)).toBeCloseTo(fSf(2, 3, 9), 12);
  });

  it('keeps cdf and sf complementary and inverts the chi-square', () => {
    expect(noncentralChiSquareCdf(30, 4, 12) + noncentralChiSquareSf(30, 4, 12)).toBeCloseTo(1, 10);
    expect(noncentralFCdf(1.7, 4, 20, 8) + noncentralFSf(1.7, 4, 20, 8)).toBeCloseTo(1, 10);
    expect(noncentralChiSquareCdf(noncentralChiSquareQuantile(0.8, 5, 3), 5, 3)).toBeCloseTo(0.8, 10);
  });

  it('refuses a noncentrality the series cannot reach', () => {
    expect(() => noncentralTCdf(1, 5, 40)).toThrow(SubjectError);
    expect(() => noncentralChiSquareCdf(1, 2, -1)).toThrow(SubjectError);
  });
});

describe('studentized range', () => {
  it('matches the planning-pass quantile and cdf', () => {
    expect(Math.abs(studentizedRangeQuantile(0.95, 3, 12) - 3.772929)).toBeLessThan(1e-5);
    expect(Math.abs(studentizedRangeCdf(3.5, 4, 20) - 0.9050415)).toBeLessThan(1e-5);
  });

  it('agrees with the t distribution for two means', () => {
    // The range of two means over s is |T|·√2, so P(Q ≤ q) = 2 F_t(q/√2) − 1.
    expect(studentizedRangeCdf(3, 2, 10)).toBeCloseTo(2 * tCdf(3 / Math.SQRT2, 10) - 1, 8);
    // With infinite df it is the range of normals; for two that is |Z1 − Z2| ≤ w, i.e. 2Φ(w/√2) − 1 = erf(w/2),
    // and erf(1) = 0.8427007929497149 (Abramowitz and Stegun, table 7.1).
    expect(normalRangeCdf(2, 2)).toBeCloseTo(0.8427007929497149, 8);
    expect(() => studentizedRangeCdf(1, 1, 5)).toThrow(SubjectError);
  });
});

describe('exact rank distributions', () => {
  it('gives the planning-pass Mann-Whitney p-value', () => {
    const x = [1.1, 2.3, 3.0, 4.2];
    const y = [2.0, 5.1, 6.3, 7.4, 8.0];
    const u1 = x.reduce((s, a) => s + y.filter((b) => a > b).length, 0);
    const u = Math.min(u1, x.length * y.length - u1);
    expect(u).toBe(3);
    expect(exactP(mannWhitneyDistribution(4, 5), u, 'two-sided')).toBeCloseTo(0.111111111, 9);
  });

  it('gives the planning-pass Wilcoxon signed-rank p-value', () => {
    const a = [1.83, 0.5, 1.62, 2.48, 1.68, 1.88, 1.55, 3.06, 1.3];
    const b = [0.878, 0.647, 0.598, 2.05, 1.06, 1.29, 1.06, 3.14, 1.29];
    const d = a.map((v, i) => v - b[i]);
    const { ranks } = midRanks(d.map(Math.abs));
    const negative = ranks.filter((_, i) => d[i] < 0).reduce((s, r) => s + r, 0);
    const w = Math.min(negative, (9 * 10) / 2 - negative);
    expect(w).toBe(5);
    expect(exactP(signedRankDistribution(9), w, 'two-sided')).toBeCloseTo(0.0390625, 9);
  });

  it('gives the planning-pass Kendall p-value', () => {
    const y = [2, 1, 4, 3, 6, 5];
    let inversions = 0;
    for (let i = 0; i < 6; i += 1) for (let j = i + 1; j < 6; j += 1) if (y[i] > y[j]) inversions += 1;
    expect(1 - (4 * inversions) / 30).toBeCloseTo(0.6, 12);
    expect(exactP(kendallDistribution(6), inversions, 'two-sided')).toBeCloseTo(0.136111111, 9);
  });

  it('enumerates Spearman orders and refuses sizes past the exact limit', () => {
    const dist = spearmanDistribution(4);
    expect(dist[0]).toBeCloseTo(1 / 24, 15);
    expect(dist[2]).toBeCloseTo(3 / 24, 15);
    expect(dist[20]).toBeCloseTo(1 / 24, 15);
    expect(dist.reduce((s, p) => s + p, 0)).toBeCloseTo(1, 14);
    expect(() => spearmanDistribution(10)).toThrow(SubjectError);
    expect(() => mannWhitneyDistribution(61, 2)).toThrow(SubjectError);
  });
});
