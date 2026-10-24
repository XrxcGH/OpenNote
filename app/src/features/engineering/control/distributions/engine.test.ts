import { describe, expect, it } from 'vitest';

import { ControlError } from '../lib/errors';
import { integrate } from '../lib/num';
import { makeDist, plotData, probability, quantileOf, type DistId } from './engine';
import {
  ciMean,
  ciProportion,
  ciVariance,
  goodnessOfFit,
  powerZ,
  summarize,
  testMean,
  testPaired,
  testProportion,
  testTwoMeans,
  testVariance,
} from './inference';

const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (e) {
    if (e instanceof ControlError) return e.code;
    throw e;
  }
  return 'none';
};
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('validation cases', () => {
  it('Poisson λ = 3: P(X ≤ 2) = 0.42319', () => {
    const r = probability(makeDist('poisson', [3]), { kind: 'le', a: 2 });
    expect(Math.abs(r.p - 0.42319)).toBeLessThan(1e-5);
    expect(r.p).toBeCloseTo(8.5 * Math.exp(-3), 14);
  });

  it('Binomial n = 10, p = 0.3: P(X = 2) = 0.23347', () => {
    const r = probability(makeDist('binomial', [10, 0.3]), { kind: 'eq', a: 2 });
    expect(Math.abs(r.p - 0.23347)).toBeLessThan(1e-5);
    expect(r.p).toBeCloseTo(45 * 0.09 * 0.7 ** 8, 14);
  });

  it('t interval n = 10, mean 5, s = 1, 95%: t = 2.26216, half-width 0.71536', () => {
    const r = ciMean({ n: 10, mean: 5, sd: 1, conf: 0.95 });
    expect(Math.abs(r.critical - 2.26216)).toBeLessThan(1e-5);
    expect(Math.abs(r.halfWidth - 0.71536)).toBeLessThan(1e-5);
    expect(r.lower).toBeCloseTo(5 - r.halfWidth, 14);
  });

  it('variance interval n = 10, s² = 1, 95%: (0.47312, 3.33285)', () => {
    const r = ciVariance(1, 10, 0.95);
    expect(Math.abs(r.lower - 0.47312)).toBeLessThan(1e-5);
    expect(Math.abs(r.upper - 3.33285)).toBeLessThan(1e-5);
  });

  it('Welch test 10, 2, 15 vs 12, 3, 12: t = −1.98354, df = 18.387, p = 0.06244', () => {
    const r = testTwoMeans({
      a: { mean: 10, sd: 2, n: 15 },
      b: { mean: 12, sd: 3, n: 12 },
      delta0: 0,
      alt: 'two',
      alpha: 0.05,
      pooled: false,
    });
    expect(Math.abs(r.statistic - -1.98354)).toBeLessThan(1e-4);
    expect(Math.abs((r.df ?? 0) - 18.387)).toBeLessThan(1e-3);
    expect(Math.abs(r.p - 0.06244)).toBeLessThan(1e-4);
    expect(r.reject).toBe(false);
  });
});

describe('distributions against closed forms', () => {
  it('normal: P(−1.96 ≤ Z ≤ 1.96) = 0.9500042', () => {
    const r = probability(makeDist('normal', [0, 1]), { kind: 'between', a: -1.959963984540054, b: 1.959963984540054 });
    expect(r.p).toBeCloseTo(0.95, 12);
  });

  it('exponential, chi-square (2 df) and Erlang cdfs', () => {
    expect(makeDist('exponential', [2]).cdf(0.7)).toBeCloseTo(1 - Math.exp(-1.4), 14);
    expect(makeDist('chi2', [2]).cdf(3)).toBeCloseTo(1 - Math.exp(-1.5), 13);
    const x = 2.5;
    const erlang = 1 - Math.exp(-x) * (1 + x + (x * x) / 2);
    expect(makeDist('gamma', [3, 1]).cdf(x)).toBeCloseTo(erlang, 13);
    expect(makeDist('gamma', [3, 2]).cdf(2 * x)).toBeCloseTo(erlang, 13);
  });

  it('F(1, ν) at t² equals the two-sided t probability', () => {
    const t = 1.7;
    const tDist = makeDist('t', [7]);
    expect(makeDist('f', [1, 7]).cdf(t * t)).toBeCloseTo(2 * tDist.cdf(t) - 1, 12);
  });

  it('beta and uniform', () => {
    expect(makeDist('beta', [2, 1]).cdf(0.3)).toBeCloseTo(0.09, 13);
    expect(makeDist('uniform', [2, 6]).cdf(3)).toBeCloseTo(0.25, 15);
    expect(code(() => makeDist('uniform', [6, 2]))).toBe('uniformOrder');
  });

  it('Weibull mean and lognormal mean', () => {
    expect(makeDist('weibull', [2, 1000]).mean).toBeCloseTo(1000 * (Math.sqrt(Math.PI) / 2), 9);
    expect(makeDist('lognormal', [1, 0.5]).mean).toBeCloseTo(Math.exp(1.125), 12);
  });

  it('every density integrates to one and matches its cdf', () => {
    const cases: [DistId, number[], number, number][] = [
      ['normal', [3, 2], -20, 1],
      ['lognormal', [0, 0.6], 0, 2],
      ['gamma', [2.5, 1.5], 0, 3],
      ['weibull', [1.7, 4], 0, 5],
      ['beta', [2.5, 3.5], 0, 0.4],
      ['t', [4.5], -60, 0.8],
      ['chi2', [5], 0, 4],
      ['f', [5, 12], 0, 1.3],
    ];
    for (const [id, params, from, x] of cases) {
      const d = makeDist(id, params);
      expect(
        rel(
          integrate(d.pdf, Number.isFinite(d.lo) ? d.lo : from, x, 1e-12),
          d.cdf(x) - (Number.isFinite(d.lo) ? 0 : d.cdf(from)),
        ),
      ).toBeLessThan(1e-7);
    }
  });

  it('discrete distributions sum to one and have the right means', () => {
    const cases: [DistId, number[], number][] = [
      ['binomial', [12, 0.35], 4.2],
      ['poisson', [4.5], 4.5],
      ['geometric', [0.25], 4],
      ['hypergeometric', [50, 10, 5], 1],
    ];
    for (const [id, params, mean] of cases) {
      const d = makeDist(id, params);
      let total = 0;
      let m = 0;
      for (let k = 0; k < 400; k += 1) {
        total += d.pdf(k);
        m += k * d.pdf(k);
      }
      expect(total).toBeCloseTo(1, 10);
      expect(m).toBeCloseTo(mean, 8);
      expect(d.mean).toBeCloseTo(mean, 12);
      expect(d.cdf(6)).toBeCloseTo(
        [0, 1, 2, 3, 4, 5, 6].reduce((s, k) => s + d.pdf(k), 0),
        12,
      );
    }
  });
});

describe('quantiles, regions, and limits', () => {
  it('quantiles invert the cdf', () => {
    expect(quantileOf(makeDist('normal', [0, 1]), 0.975).x).toBeCloseTo(1.959963984540054, 10);
    expect(makeDist('chi2', [9]).quantile(0.975)).toBeCloseTo(19.02276780221, 8);
    expect(makeDist('t', [9]).quantile(0.975)).toBeCloseTo(2.262157162799, 9);
    expect(makeDist('f', [3, 10]).cdf(makeDist('f', [3, 10]).quantile(0.9))).toBeCloseTo(0.9, 12);
    expect(makeDist('gamma', [0.5, 2]).cdf(makeDist('gamma', [0.5, 2]).quantile(0.3))).toBeCloseTo(0.3, 12);
    expect(makeDist('beta', [0.5, 0.5]).cdf(makeDist('beta', [0.5, 0.5]).quantile(0.8))).toBeCloseTo(0.8, 12);
    const b = makeDist('binomial', [10, 0.3]);
    const k = b.quantile(0.5);
    expect(b.cdf(k)).toBeGreaterThanOrEqual(0.5);
    expect(b.cdf(k - 1)).toBeLessThan(0.5);
  });

  it('strict and inclusive regions differ for discrete distributions', () => {
    const d = makeDist('poisson', [3]);
    const le = probability(d, { kind: 'le', a: 2 }).p;
    const lt = probability(d, { kind: 'lt', a: 2 }).p;
    expect(le - lt).toBeCloseTo(d.pdf(2), 14);
    expect(probability(d, { kind: 'ge', a: 3 }).p).toBeCloseTo(1 - le, 14);
    expect(probability(d, { kind: 'outside', a: 1, b: 4 }).p).toBeCloseTo(d.cdf(0) + 1 - d.cdf(4), 14);
  });

  it('plot data shades the region', () => {
    const p = plotData(makeDist('normal', [0, 1]), (x) => x > 1);
    expect(p.xs.length).toBe(241);
    expect(p.inside.some(Boolean)).toBe(true);
    const bars = probability(makeDist('binomial', [10, 0.3]), { kind: 'le', a: 2 }).plot;
    expect(bars.xs[0]).toBe(0);
    expect(bars.inside.slice(0, 3)).toEqual([true, true, true]);
    expect(bars.inside[3]).toBe(false);
  });

  it('rejects impossible parameters and regions', () => {
    expect(code(() => makeDist('binomial', [10, 1.5]))).toBe('paramMax');
    expect(code(() => makeDist('binomial', [2.5, 0.5]))).toBe('paramWhole');
    expect(code(() => makeDist('normal', [0, 0]))).toBe('paramPositive');
    expect(code(() => makeDist('normal', [0, -1]))).toBe('paramPositive');
    expect(code(() => makeDist('poisson', [Number.NaN]))).toBe('paramNumber');
    expect(code(() => makeDist('hypergeometric', [10, 12, 3]))).toBe('hyperSuccesses');
    expect(code(() => probability(makeDist('normal', [0, 1]), { kind: 'eq', a: 1 }))).toBe('pointContinuous');
    expect(code(() => probability(makeDist('normal', [0, 1]), { kind: 'between', a: 2, b: 1 }))).toBe('regionOrder');
    expect(code(() => quantileOf(makeDist('normal', [0, 1]), 1))).toBe('probabilityOpen');
  });

  it('stays finite for huge parameters', () => {
    expect(makeDist('poisson', [1e5]).cdf(1e5)).toBeCloseTo(
      0.5 + (0.5 / Math.sqrt(2 * Math.PI * 1e5)) * (2 / 3) * 2,
      2,
    );
    expect(makeDist('binomial', [100000, 0.5]).cdf(50000)).toBeGreaterThan(0.5);
    expect(Number.isFinite(makeDist('normal', [1e12, 1e9]).quantile(0.3))).toBe(true);
  });
});

describe('inference', () => {
  it('summarizes raw data', () => {
    const s = summarize([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(s.mean).toBe(5);
    expect(s.sd).toBeCloseTo(Math.sqrt(32 / 7), 14);
    expect(code(() => summarize([1]))).toBe('needTwo');
  });

  it('z interval with known σ', () => {
    const r = ciMean({ n: 25, mean: 10, sd: 2, conf: 0.95, knownSigma: true });
    expect(r.halfWidth).toBeCloseTo((1.959963984540054 * 2) / 5, 10);
  });

  it('proportion interval: Wald and Wilson', () => {
    const r = ciProportion(40, 100, 0.95);
    const z = 1.959963984540054;
    expect(r.halfWidth).toBeCloseTo(z * Math.sqrt(0.24 / 100), 10);
    const centre = (0.4 + (z * z) / 200) / (1 + (z * z) / 100);
    expect((r.wilson[0] + r.wilson[1]) / 2).toBeCloseTo(centre, 12);
    expect(code(() => ciProportion(120, 100, 0.95))).toBe('successesRange');
  });

  it('one-sample t test agrees with the interval', () => {
    const r = testMean({ n: 10, mean: 5, sd: 1, mu0: 4.2, alt: 'two', alpha: 0.05 });
    // 4.2 lies outside 5 ± 0.71536, so the test rejects.
    expect(r.reject).toBe(true);
    expect(r.statistic).toBeCloseTo(0.8 / (1 / Math.sqrt(10)), 12);
    const one = testMean({ n: 10, mean: 5, sd: 1, mu0: 4.2, alt: 'greater', alpha: 0.05 });
    expect(one.p).toBeCloseTo(r.p / 2, 12);
  });

  it('pooled t test by hand', () => {
    const r = testTwoMeans({
      a: { mean: 10, sd: 2, n: 15 },
      b: { mean: 12, sd: 3, n: 12 },
      delta0: 0,
      alt: 'two',
      alpha: 0.05,
      pooled: true,
    });
    const sp2 = (14 * 4 + 11 * 9) / 25;
    expect(r.df).toBe(25);
    expect(r.statistic).toBeCloseTo(-2 / Math.sqrt(sp2 * (1 / 15 + 1 / 12)), 12);
  });

  it('paired test equals a one-sample test on differences', () => {
    const a = [12, 15, 11, 14, 13];
    const b = [10, 14, 11, 12, 12];
    const r = testPaired(a, b, 0, 'two', 0.05);
    const d = summarize([2, 1, 0, 2, 1]);
    expect(r.statistic).toBeCloseTo(d.mean / (d.sd / Math.sqrt(5)), 12);
    expect(code(() => testPaired([1, 2], [1], 0, 'two', 0.05))).toBe('pairedLength');
  });

  it('proportion test: 60 of 100 against 0.5 gives z = 2', () => {
    const r = testProportion(60, 100, 0.5, 'two', 0.05);
    expect(r.statistic).toBeCloseTo(2, 12);
    expect(r.p).toBeCloseTo(0.04550026389635842, 10);
    expect(r.reject).toBe(true);
  });

  it('variance test', () => {
    const r = testVariance(2, 11, 1, 'greater', 0.05);
    expect(r.statistic).toBe(20);
    expect(r.p).toBeCloseTo(1 - makeDist('chi2', [10]).cdf(20), 14);
  });

  it('goodness of fit for a die', () => {
    const r = goodnessOfFit([5, 8, 9, 8, 10, 20], [1, 1, 1, 1, 1, 1], 0.05);
    expect(r.statistic).toBeCloseTo((25 + 4 + 1 + 4 + 0 + 100) / 10, 12);
    expect(r.df).toBe(5);
    expect(r.p).toBeCloseTo(1 - makeDist('chi2', [5]).cdf(13.4), 14);
    expect(code(() => goodnessOfFit([1, 2], [1, 2, 3], 0.05))).toBe('gofLength');
    expect(code(() => goodnessOfFit([1, 2], [1, 1], 0.05, 1))).toBe('gofDf');
  });

  it('power of a one-sided z test', () => {
    const r = powerZ({ mu0: 0, mu1: 0.5, sigma: 1, n: 25, alpha: 0.05, alt: 'greater' });
    expect(r.power).toBeCloseTo(0.8037649, 6);
    expect(code(() => powerZ({ mu0: 0, mu1: 0.5, sigma: 0, n: 25, alpha: 0.05, alt: 'greater' }))).toBe('sdPositive');
  });

  it('rejects impossible settings', () => {
    expect(code(() => ciMean({ n: 10, mean: 5, sd: 1, conf: 1.2 }))).toBe('confidenceRange');
    expect(code(() => ciMean({ n: 1, mean: 5, sd: 1, conf: 0.95 }))).toBe('needTwo');
    expect(code(() => ciVariance(-1, 10, 0.95))).toBe('variancePositive');
    expect(code(() => testMean({ n: 10, mean: 5, sd: 1, mu0: 4, alt: 'two', alpha: 0 }))).toBe('alphaRange');
  });
});
