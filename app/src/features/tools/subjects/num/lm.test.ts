import { describe, expect, it } from 'vitest';
import { SubjectError } from '../errors';
import { levenbergMarquardt, lmBands } from './lm';
import type { Model } from './lm';

const michaelis: Model<number> = (s, [vmax, km]) => (vmax * s) / (km + s);
const S = [0.5, 1, 2, 4, 8, 16];
const exactV = S.map((s) => (10 * s) / (2 + s));

describe('Levenberg-Marquardt', () => {
  it('recovers Vmax 10 and Km 2 from exact Michaelis-Menten data, starting at (5, 1)', () => {
    const fit = levenbergMarquardt(michaelis, S, exactV, [5, 1]);
    expect(fit.converged).toBe(true);
    expect(fit.params[0]).toBeCloseTo(10, 6);
    expect(fit.params[1]).toBeCloseTo(2, 6);
    expect(fit.ssr).toBeLessThan(1e-12);
  });

  it('matches the planning pass on the same data with small residuals added', () => {
    // Planning pass (SciPy curve_fit): Vmax 9.95048 +/- 0.1251, Km 1.9724 +/- 0.07965.
    const noise = [0.1, -0.1, 0.05, -0.05, 0.1, -0.1];
    const fit = levenbergMarquardt(
      michaelis,
      S,
      exactV.map((v, i) => v + noise[i]),
      [5, 1],
    );
    expect(Math.abs(fit.params[0] - 9.95048)).toBeLessThan(1e-4);
    expect(Math.abs(fit.params[1] - 1.9724)).toBeLessThan(1e-4);
    expect(Math.abs(fit.se[0] - 0.1251)).toBeLessThan(1e-4);
    expect(Math.abs(fit.se[1] - 0.07965)).toBeLessThan(1e-4);
    expect(fit.dof).toBe(4);
  });

  it('gives a straight line the textbook estimates, errors and bands', () => {
    // By hand: y = 2.2 + 0.6x, SSR 2.4, s² = 0.8, se(b) = √(0.8/10); at x = 3 the mean band is t·√(0.8/5) and the
    // prediction band t·√(0.8 + 0.16), with t(0.975, 3) = 3.182446305.
    const line: Model<number> = (x, [a, b]) => a + b * x;
    const xs = [1, 2, 3, 4, 5];
    const fit = levenbergMarquardt(line, xs, [2, 4, 5, 4, 5], [0, 0]);
    expect(fit.params[0]).toBeCloseTo(2.2, 8);
    expect(fit.params[1]).toBeCloseTo(0.6, 8);
    expect(fit.ssr).toBeCloseTo(2.4, 8);
    expect(fit.se[1]).toBeCloseTo(Math.sqrt(0.08), 7);
    const [band] = lmBands(line, fit, [3]);
    expect(band.fit).toBeCloseTo(4, 8);
    expect(band.confidence).toBeCloseTo(3.182446305 * 0.4, 6);
    expect(band.prediction).toBeCloseTo(3.182446305 * Math.sqrt(0.96), 6);
    expect(fit.residuals.reduce((s, r) => s + r, 0)).toBeCloseTo(0, 8);
  });

  it('keeps a parameter inside its bounds', () => {
    const fit = levenbergMarquardt(michaelis, S, exactV, [5, 3], { lower: [0, 2.5] });
    expect(fit.params[1]).toBeCloseTo(2.5, 10);
    expect(fit.params[0]).toBeGreaterThan(0);
  });

  it('weights the points: a weight of zero ignores an outlier', () => {
    const line: Model<number> = (x, [a, b]) => a + b * x;
    const fit = levenbergMarquardt(line, [0, 1, 2, 3], [1, 3, 5, 100], [0, 0], { weights: [1, 1, 1, 0] });
    expect(fit.params[0]).toBeCloseTo(1, 8);
    expect(fit.params[1]).toBeCloseTo(2, 8);
  });

  it('works with huge and negative values', () => {
    const line: Model<number> = (x, [a, b]) => a + b * x;
    const xs = [-3, -2, -1, 0, 1];
    const fit = levenbergMarquardt(
      line,
      xs,
      xs.map((x) => -4e9 + 3e9 * x),
      [1, 1],
    );
    expect(fit.params[0] / -4e9).toBeCloseTo(1, 8);
    expect(fit.params[1] / 3e9).toBeCloseTo(1, 8);
  });

  it('refuses empty, mismatched, too short, non-finite and unidentifiable input in words a tool can show', () => {
    const line: Model<number> = (x, [a, b]) => a + b * x;
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return e instanceof SubjectError ? e.code : 'other';
      }
      return 'none';
    };
    expect(code(() => levenbergMarquardt(line, [], [], [0, 0]))).toBe('empty');
    expect(code(() => levenbergMarquardt(line, [1, 2], [1], [0, 0]))).toBe('shape');
    expect(code(() => levenbergMarquardt(line, [1], [1], [0, 0]))).toBe('tooFew');
    expect(code(() => levenbergMarquardt(line, [1, 2], [1, Number.NaN], [0, 0]))).toBe('notFinite');
    expect(code(() => levenbergMarquardt(line, [1, 2], [1, 2], [0, 0], { weights: [1, -1] }))).toBe('domain');
    // a and b only appear as a sum, so no data can tell them apart.
    const sum: Model<number> = (x, [a, b]) => (a + b) * x;
    expect(code(() => levenbergMarquardt(sum, [1, 2, 3], [2, 4, 6], [0, 0]))).toBe('singular');
  });
});
