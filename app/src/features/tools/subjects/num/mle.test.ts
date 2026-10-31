import { describe, expect, it } from 'vitest';
import { SubjectError } from '../errors';
import { maximizeLikelihood, nelderMead, profileInterval } from './mle';

// Chi-square(1) 0.95 quantile, 1.959963984540054², from the normal quantile.
const CHI1_95 = 1.959963984540054 ** 2;

describe('maximum likelihood', () => {
  it('finds the normal mean and the divide-by-n standard deviation', () => {
    const xs = [4.2, 5.1, 3.9, 6.3, 5.5, 4.8, 5.0, 6.1];
    const n = xs.length;
    const mean = xs.reduce((s, x) => s + x, 0) / n;
    const sd = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / n);
    const ll = ([m, s]: readonly number[]) =>
      s <= 0 ? -Infinity : xs.reduce((acc, x) => acc - Math.log(s) - 0.5 * ((x - m) / s) ** 2, 0);
    const fit = maximizeLikelihood(ll, [0, 1]);
    expect(fit.params[0]).toBeCloseTo(mean, 6);
    expect(fit.params[1]).toBeCloseTo(sd, 6);
    // Observed information at the maximum: se(mean) = sd/√n, se(sd) = sd/√(2n).
    expect(fit.se[0]).toBeCloseTo(sd / Math.sqrt(n), 5);
    expect(fit.se[1]).toBeCloseTo(sd / Math.sqrt(2 * n), 5);
  });

  it('gives the exponential rate, its error and a profile interval found by bisection on the closed form', () => {
    // n = 10 waiting times summing to 20: rate 0.5, se = rate/√n.
    const n = 10;
    const total = 20;
    const ll = ([rate]: readonly number[]) => (rate <= 0 ? -Infinity : n * Math.log(rate) - rate * total);
    const fit = maximizeLikelihood(ll, [2]);
    expect(fit.params[0]).toBeCloseTo(0.5, 7);
    expect(fit.se[0]).toBeCloseTo(0.5 / Math.sqrt(n), 5);
    const target = (rate: number) => 2 * (ll([0.5]) - ll([rate])) - CHI1_95;
    const bisect = (a: number, b: number) => {
      for (let i = 0; i < 200; i += 1) {
        const m = (a + b) / 2;
        if (Math.sign(target(m)) === Math.sign(target(a))) a = m;
        else b = m;
      }
      return (a + b) / 2;
    };
    const interval = profileInterval(ll, fit, 0);
    expect(interval.lower).toBeCloseTo(bisect(1e-9, 0.5), 7);
    expect(interval.upper).toBeCloseTo(bisect(0.5, 5), 7);
    expect(interval.lower).toBeGreaterThan(0);
  });

  it('profiles the normal mean over the standard deviation: the interval is mean ± sd·√(e^(χ²/n) − 1)', () => {
    // With σ refitted, 2·(ℓmax − ℓp(μ)) = n·ln(1 + (μ − x̄)²/σ̂²), so the bounds are closed form.
    const xs = [1, 2, 3, 4, 5, 6];
    const n = xs.length;
    const mean = 3.5;
    const sd = Math.sqrt(17.5 / n);
    const ll = ([m, s]: readonly number[]) =>
      s <= 0 ? -Infinity : xs.reduce((acc, x) => acc - Math.log(s) - 0.5 * ((x - m) / s) ** 2, 0);
    const fit = maximizeLikelihood(ll, [1, 1]);
    const half = sd * Math.sqrt(Math.exp(CHI1_95 / n) - 1);
    const interval = profileInterval(ll, fit, 0);
    expect(interval.lower).toBeCloseTo(mean - half, 5);
    expect(interval.upper).toBeCloseTo(mean + half, 5);
  });

  it('minimizes the Rosenbrock valley with Nelder-Mead alone', () => {
    const rosen = ([x, y]: readonly number[]) => (1 - x) ** 2 + 100 * (y - x * x) ** 2;
    const [x, y] = nelderMead(rosen, [-1.2, 1], 2000);
    expect(x).toBeCloseTo(1, 3);
    expect(y).toBeCloseTo(1, 3);
  });

  it('refuses an empty, invalid or flat likelihood', () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return e instanceof SubjectError ? e.code : 'other';
      }
      return 'none';
    };
    expect(code(() => maximizeLikelihood(() => 0, []))).toBe('empty');
    expect(code(() => maximizeLikelihood(([s]) => (s > 0 ? -s : -Infinity), [-1]))).toBe('domain');
    expect(code(() => maximizeLikelihood(([a, b]) => -((a + b - 1) ** 2), [0, 0]))).toBe('singular');
    expect(code(() => maximizeLikelihood(() => 0, [Number.NaN]))).toBe('notFinite');
  });
});
