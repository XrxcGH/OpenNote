// Bayesian updating. Expected values are SciPy results from the planning pass, the published JZS value for t 2.5
// with n 20, and hand calculations of the conjugate updates.
import { describe, expect, it } from 'vitest';
import { KitError } from '../report';
import { betaReport, gridReport, jzsReport, metropolisReport, tableReport } from './engine';
import {
  bayesTable,
  betaBinomial,
  dirichlet,
  gammaPoisson,
  gridPosterior,
  hdi,
  jzs,
  metropolis,
  normalInverseGamma,
  normalKnown,
} from './stats';
import { normalQuantile } from '../../subjects/stats/dist';

const close = (actual: number, want: number, tol: number) => expect(Math.abs(actual - want)).toBeLessThanOrEqual(tol);

describe('conjugate updates', () => {
  it('beta(1, 1) with 7 successes in 10', () => {
    const u = betaBinomial(1, 1, 7, 3);
    expect([u.a, u.b]).toEqual([8, 4]);
    close(u.summary.mean, 0.666667, 1e-6);
    close(u.summary.lower, 0.39026, 1e-5);
    close(u.summary.upper, 0.89074, 1e-5);
    // The mode by hand: (8 − 1)/(12 − 2).
    close(u.summary.mode, 0.7, 1e-12);
  });

  it('Savage-Dickey BF10 for θ0 = 0.5 after 7 of 10', () => {
    close(betaBinomial(1, 1, 7, 3, 0.95, 0.5).bf10 ?? 0, 0.77576, 1e-5);
  });

  it('normal prior N(0, 1) with mean 2 from n 4 and σ 2', () => {
    const u = normalKnown(0, 1, 2, 4, 2);
    close(u.mean, 1, 1e-12);
    close(u.variance, 0.5, 1e-12);
  });

  it('gamma(2, rate 1) with counts summing to 10 over 5 intervals', () => {
    const u = gammaPoisson(2, 1, 10, 5);
    expect([u.shape, u.rate]).toEqual([12, 6]);
    close(u.summary.mean, 2, 1e-12);
    close(
      u.predictive.reduce((a, b) => a + b, 0),
      1,
      1e-4,
    );
  });

  it('normal-inverse-gamma by hand', () => {
    // κ₀ 1, μ₀ 0, α₀ 1, β₀ 1; n 4, x̄ 2, s² 1: κ 5, μ 1.6, α 3, β = 1 + 1.5 + 1·4·4/10 = 4.1.
    const u = normalInverseGamma(0, 1, 1, 1, 4, 2, 1);
    close(u.mu, 1.6, 1e-12);
    close(u.beta, 4.1, 1e-12);
    close(u.varianceSummary.mean, 4.1 / 2, 1e-12);
  });

  it('Dirichlet shares add to 1', () => {
    const parts = dirichlet([1, 1, 1], [5, 3, 2]);
    close(
      parts.reduce((s, p) => s + p.summary.mean, 0),
      1,
      1e-12,
    );
    close(parts[0].summary.mean, 6 / 13, 1e-12);
  });

  it('the HDI of a symmetric distribution is its equal-tailed interval', () => {
    const [lo, hi] = hdi((p) => normalQuantile(p), 0.95);
    close(lo, -1.959964, 1e-5);
    close(hi, 1.959964, 1e-5);
  });
});

describe('Bayes factors, grids, chains, and tables', () => {
  it('JZS Bayes factor, one-sample t 2.5, n 20, r 0.707', () => {
    close(jzs(2.5, 20, null, 0.707), 2.7023, 1e-3);
  });

  it('a grid posterior of θ^7 (1 − θ)^3 matches Beta(8, 4)', () => {
    const g = gridPosterior('1', 'theta^7*(1-theta)^3', 0, 1, 20_000);
    close(g.mean, 8 / 12, 1e-6);
  });

  it('Metropolis on a standard normal is reproducible and near mean 0, SD 1', () => {
    const a = metropolis('-theta^2/2', ['theta'], [0], [2.4], 40_000, 1000, 9n);
    const b = metropolis('-theta^2/2', ['theta'], [0], [2.4], 40_000, 1000, 9n);
    expect(a.means).toEqual(b.means);
    close(a.means[0], 0, 0.06);
    close(a.sds[0], 1, 0.06);
    expect(a.acceptance).toBeGreaterThan(0.2);
  });

  it('a diagnostic Bayes table: prior 0.01, sensitivity 0.95, specificity 0.90, positive', () => {
    const t = bayesTable([
      { prior: 0.01, likelihood: 0.95 },
      { prior: 0.99, likelihood: 0.1 },
    ]);
    close(t.posteriors[0], 0.087558, 1e-6);
  });

  it('reports carry answers', () => {
    expect(betaReport(1, 1, 7, 3, 0.95, 0.5, ['a', 'b']).answer.vars.a).toBe('8');
    expect(jzsReport(2.5, 20, null, 0.707).answer.key).toBe('jzs');
    expect(gridReport('1', 'theta', 0, 1, 100, 0.95, ['a', 'b']).plots?.length).toBe(1);
    expect(metropolisReport('-theta^2/2', ['theta'], [0], [1], 500, 100, 1n).answer.vars.seed).toBe('1');
    expect(
      tableReport([
        { label: 'H1', prior: 1, likelihood: 1 },
        { label: 'H2', prior: 1, likelihood: 3 },
      ]).answer.vars.best,
    ).toBe('H2');
  });

  it('says what is wrong with impossible input', () => {
    const code = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        return error instanceof KitError ? error.code : 'other';
      }
      return 'none';
    };
    expect(code(() => betaBinomial(0, 1, 1, 1))).toBe('priorPositive');
    expect(code(() => betaBinomial(1, 1, 1.5, 1))).toBe('countsWhole');
    expect(code(() => betaBinomial(1, 1, 1, 1, 0.95, 1))).toBe('pointNull');
    expect(code(() => normalKnown(0, -1, 0, 1, 1))).toBe('sdPositive');
    expect(code(() => gridPosterior('1', 'theta +', 0, 1, 100))).toBe('expression');
    expect(code(() => gridPosterior('1', '0', 0, 1, 100))).toBe('gridZero');
    expect(code(() => gridPosterior('1', 'theta - 2', 0, 1, 100))).toBe('gridNegative');
    expect(code(() => metropolis('log(theta)', ['theta'], [-1], [1], 1000, 10, 1n))).toBe('startOutside');
    expect(
      code(() =>
        bayesTable([
          { prior: 1, likelihood: 0 },
          { prior: 1, likelihood: 0 },
        ]),
      ),
    ).toBe('evidenceZero');
    // A huge t still gives a finite, very large Bayes factor.
    expect(jzs(12, 50, null)).toBeGreaterThan(1e6);
  });
});
