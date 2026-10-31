// The psychophysics engine against the planned cases. Expected values are closed forms worked in the comments.
import { describe, expect, it } from 'vitest';
import { makeRng } from '../kit/rng';
import { MindError } from '../kit/types';
import {
  bootstrap,
  convergence,
  fechnerSteps,
  fitPsi,
  michelson,
  psi,
  reversalsOf,
  rmsContrast,
  sigmoid,
  sigmoidInverse,
  simulateStaircase,
  sizeForAngle,
  snellen,
  staircaseThreshold,
  stevens,
  threshold,
  visualAngle,
  weber,
  weberContrast,
  weightedUp,
} from './engine';

const code = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof MindError ? error.code : 'other';
  }
  return 'none';
};

const logistic = (x: number) => 1 / (1 + Math.exp(-(x - 5)));

describe('psychometric fits', () => {
  it('recovers alpha 5 and beta 1 from expected logistic counts', () => {
    const points = [2, 3, 4, 5, 6, 7, 8].map((x) => ({ x, n: 100, k: 100 * logistic(x) }));
    const fit = fitPsi(points, 'logistic', 0, 0);
    expect(fit.alpha).toBeCloseTo(5, 4);
    expect(fit.beta).toBeCloseTo(1, 4);
    // Expected counts are the saturated model, so the deviance is 0.
    expect(fit.deviance).toBeCloseTo(0, 6);
  });

  it('recovers a 2AFC Weibull with a guess rate of 0.5', () => {
    const truth = { shape: 'weibull' as const, alpha: 3, beta: 2.5, gamma: 0.5, lambda: 0 };
    const points = [1, 2, 3, 4, 5, 6].map((x) => ({ x, n: 200, k: 200 * psi(x, truth) }));
    const fit = fitPsi(points, 'weibull', 0.5, 0);
    expect(fit.alpha).toBeCloseTo(3, 3);
    expect(fit.beta).toBeCloseTo(2.5, 3);
    // The 75% point of 0.5 + 0.5 F is where F = 0.5: alpha (ln 2)^(1/beta).
    expect(threshold(fit, 0.75)).toBeCloseTo(3 * Math.pow(Math.LN2, 1 / 2.5), 3);
  });

  it('fits a free lapse rate within its bounds', () => {
    const truth = { shape: 'gaussian' as const, alpha: 0, beta: 1, gamma: 0, lambda: 0.04 };
    const points = [-3, -2, -1, 0, 1, 2, 3, 4].map((x) => ({ x, n: 500, k: 500 * psi(x, truth) }));
    const fit = fitPsi(points, 'gaussian', 0, 'free');
    expect(fit.lambda).toBeCloseTo(0.04, 3);
    expect(fit.alpha).toBeCloseTo(0, 3);
  });

  it('inverts each function', () => {
    for (const shape of ['logistic', 'gaussian', 'weibull'] as const)
      expect(sigmoid(sigmoidInverse(0.3, shape, 2, 1.5), shape, 2, 1.5)).toBeCloseTo(0.3, 12);
    expect(threshold({ shape: 'logistic', alpha: 0, beta: 1, gamma: 0.5, lambda: 0 }, 0.4)).toBeNaN();
  });

  it('bootstraps with a seed: the same seed gives the same interval, around the fit', () => {
    const points = [2, 3, 4, 5, 6, 7, 8].map((x) => ({ x, n: 40, k: Math.round(40 * logistic(x)) }));
    const fit = fitPsi(points, 'logistic', 0, 0);
    const a = bootstrap(points, fit, 0, 0.5, 40, makeRng(2));
    const b = bootstrap(points, fit, 0, 0.5, 40, makeRng(2));
    expect(a).toEqual(b);
    expect(a.threshold.low).toBeLessThan(fit.alpha);
    expect(a.threshold.high).toBeGreaterThan(fit.alpha);
  });

  it('stops on impossible counts and too few levels', () => {
    expect(
      code(() =>
        fitPsi(
          [
            { x: 1, n: 10, k: 11 },
            { x: 2, n: 10, k: 5 },
          ],
          'logistic',
          0,
          0,
        ),
      ),
    ).toBe('correctTrials');
    expect(code(() => fitPsi([{ x: 1, n: 10, k: 1 }], 'logistic', 0, 0))).toBe('fewLevels');
    expect(
      code(() =>
        fitPsi(
          [
            { x: 0, n: 10, k: 1 },
            { x: 1, n: 10, k: 5 },
          ],
          'weibull',
          0,
          0,
        ),
      ),
    ).toBe('weibullLevel');
    expect(
      code(() =>
        fitPsi(
          [
            { x: 1, n: 0, k: 0 },
            { x: 2, n: 10, k: 5 },
          ],
          'logistic',
          0,
          0,
        ),
      ),
    ).toBe('trialsPositive');
  });
});

describe('staircases', () => {
  it('converges on 0.707107 for 1-up-2-down and 0.793701 for 1-up-3-down', () => {
    expect(convergence(2)).toBeCloseTo(Math.SQRT1_2, 12);
    expect(convergence(2)).toBeCloseTo(0.707107, 6);
    expect(convergence(3)).toBeCloseTo(Math.cbrt(0.5), 12);
    expect(convergence(3)).toBeCloseTo(0.793701, 6);
    // A weighted 1-up-1-down rule for 75% takes steps up 3 times the steps down.
    expect(weightedUp(0.75)).toBeCloseTo(3, 12);
  });

  it('finds the reversals of a typed track and averages the last ones', () => {
    // Down, down, up, up, down: turns at index 2 (bottom) and 4 (top).
    const levels = [10, 8, 6, 8, 10, 8];
    expect(reversalsOf(levels)).toEqual([2, 4]);
    expect(staircaseThreshold({ levels, reversals: reversalsOf(levels) }, 2).value).toBe(8);
    expect(code(() => staircaseThreshold({ levels: [1, 2, 3], reversals: [] }, 4))).toBe('noReversals');
  });

  it('simulates a track that settles near the observer’s 70.7% point', () => {
    const observer = { shape: 'logistic' as const, alpha: 5, beta: 1, gamma: 0, lambda: 0 };
    const track = simulateStaircase(
      { start: 10, stepDown: 0.25, stepUp: 0.25, down: 2, trials: 3000, floor: -100 },
      observer,
      makeRng(4),
    );
    const t = staircaseThreshold(track, 200).value;
    // F(x) = 0.7071 at x = 5 + ln(0.7071/0.2929) = 5.881.
    expect(Math.abs(t - (5 + Math.log(Math.SQRT1_2 / (1 - Math.SQRT1_2))))).toBeLessThan(0.3);
  });
});

describe('laws', () => {
  it('fits Stevens’ law exactly: exponent 0.67, k 2', () => {
    const r = stevens([1, 2, 4, 8].map((s) => [s, 2 * Math.pow(s, 0.67)]));
    expect(r.n).toBeCloseTo(0.67, 9);
    expect(r.k).toBeCloseTo(2, 9);
  });

  it('gives Weber fractions and Fechner steps', () => {
    const r = weber([
      [100, 2],
      [200, 4],
    ]);
    expect(r.each).toEqual([0.02, 0.02]);
    expect(r.k).toBeCloseTo(0.02, 12);
    // Each step multiplies by 1.02, so 1.02^n = 2 at n = ln 2 / ln 1.02.
    expect(fechnerSteps(100, 200, 0.02)).toBeCloseTo(Math.LN2 / Math.log(1.02), 12);
    expect(code(() => weber([[0, 1]]))).toBe('weberRow');
    expect(
      code(() =>
        stevens([
          [1, 2],
          [-1, 3],
        ]),
      ),
    ).toBe('stevensRow');
  });
});

describe('vision', () => {
  it('gives 0.999901 degrees for 1 cm at 57.3 cm, and back', () => {
    expect(visualAngle(1, 57.3)).toBeCloseTo(2 * Math.atan(1 / 114.6) * (180 / Math.PI), 12);
    expect(visualAngle(1, 57.3)).toBeCloseTo(0.999901, 6);
    expect(sizeForAngle(visualAngle(1, 57.3), 57.3)).toBeCloseTo(1, 12);
  });

  it('gives Michelson contrast 0.6 for 80 and 20, and logMAR 0.30103 for 20/40', () => {
    expect(michelson(80, 20)).toBeCloseTo(0.6, 12);
    expect(snellen(20, 40).logMar).toBeCloseTo(Math.log10(2), 12);
    expect(snellen(20, 40).logMar).toBeCloseTo(0.30103, 5);
    expect(snellen(6, 6).logMar).toBe(0);
    expect(snellen(20, 40).decimal).toBe(0.5);
    expect(weberContrast(60, 40)).toBe(0.5);
    // Luminances 20 and 80: mean 50, population SD 30.
    expect(rmsContrast([20, 80])).toBeCloseTo(0.6, 12);
  });
});
