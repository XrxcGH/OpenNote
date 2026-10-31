// Resampling and simulation. Exact permutation p-values are counted by hand; the bootstrap standard error is
// checked against the plug-in value σ̂/√n; seeds are checked to reproduce their results.
import { describe, expect, it } from 'vitest';
import { KitError } from '../report';
import { bootstrapReport, labReport, permutationReport, simulationReport } from './engine';
import { bootstrap, permutationTest, samplingLab, simulate } from './stats';

const close = (actual: number, want: number, tol: number) => expect(Math.abs(actual - want)).toBeLessThanOrEqual(tol);

describe('permutation tests', () => {
  it('exact two-sample test of 1, 2, 3 against 4, 5, 6', () => {
    const r = permutationTest('twoSample', [1, 2, 3], [4, 5, 6], 'two-sided', 1000, 1n);
    expect(r.exact).toBe(true);
    expect(r.total).toBe(20);
    close(r.p, 2 / 20, 1e-12);
  });

  it('exact sign-flip test on differences 1, 2, 3, 4', () => {
    const r = permutationTest('paired', [1, 2, 3, 4], [], 'two-sided', 1000, 1n);
    expect(r.total).toBe(16);
    close(r.p, 2 / 16, 1e-12);
  });

  it('exact correlation test of 4 perfectly ordered pairs', () => {
    // Of 24 orders, only the identity and the reversal reach |r| = 1.
    const r = permutationTest('correlation', [1, 2, 3, 4], [2, 4, 6, 8], 'two-sided', 1000, 1n);
    close(r.p, 2 / 24, 1e-12);
  });

  it('Monte Carlo when the arrangements are many, reproducible from the seed', () => {
    const x = Array.from({ length: 15 }, (_, i) => i);
    const y = Array.from({ length: 15 }, (_, i) => i + 3);
    const a = permutationTest('twoSample', x, y, 'two-sided', 2000, 7n);
    const b = permutationTest('twoSample', x, y, 'two-sided', 2000, 7n);
    expect(a.exact).toBe(false);
    expect(a.p).toBe(b.p);
    expect(a.se).toBeGreaterThan(0);
  });
});

describe('the bootstrap', () => {
  const data = [2, 4, 4, 4, 5, 5, 7, 9];

  it('bootstrap SE of the mean is within 2% of the plug-in σ̂/√n = 0.707107', () => {
    const b = bootstrap('mean', data, [], 20_000, 12345n);
    expect(Math.abs(b.se - 0.707107) / 0.707107).toBeLessThan(0.02);
  });

  it('a constant sample gives the interval (3, 3) and SE 0', () => {
    const b = bootstrap('mean', [3, 3, 3, 3], [], 1000, 1n);
    expect(b.percentile).toEqual([3, 3]);
    expect(b.se).toBe(0);
    expect(b.bca).toEqual([3, 3]);
  });

  it('the same seed gives the same resamples, interval, and p', () => {
    const a = bootstrap('median', data, [], 2000, 99n);
    const b = bootstrap('median', data, [], 2000, 99n);
    expect(a.replicates).toEqual(b.replicates);
    expect(a.bca).toEqual(b.bca);
    const c = bootstrap('median', data, [], 2000, 100n);
    expect(c.replicates).not.toEqual(a.replicates);
  });

  it('two-sample and paired statistics', () => {
    const d = bootstrap('diffMeans', [5, 6, 7, 8], [1, 2, 3, 4], 2000, 3n);
    expect(d.observed).toBe(4);
    const r = bootstrap('correlation', [1, 2, 3, 4, 5], [2, 4, 5, 4, 5], 2000, 3n);
    expect(r.percentile[0]).toBeLessThanOrEqual(r.percentile[1]);
  });
});

describe('labs and simulations', () => {
  it('sample means of a uniform population center on 0.5 with SD near √(1/12)/√n', () => {
    const lab = samplingLab('uniform', 0, [], 25, 4000, 5n);
    close(lab.meanOfMeans, 0.5, 0.005);
    close(lab.sdOfMeans, Math.sqrt(1 / 12) / 5, 0.004);
    close(lab.coverage, 0.95, 0.015);
  });

  it('simulations run from their seeds', () => {
    const coin = simulate('coin', 10_000, 0.5, 1, [1, 1], 11n);
    close(coin.final, 0.5, 0.03);
    expect(simulate('dice', 600, 0, 2, [1, 1], 11n).counts.reduce((a, b) => a + b, 0)).toBe(600);
    expect(simulate('urn', 10, 0, 1, [5, 5], 11n).final).toBe(5);
    expect(simulate('brownian', 100, 0, 1, [1, 1], 11n).path.length).toBe(101);
  });

  it('reports print their seeds', () => {
    expect(bootstrapReport('mean', [1, 2, 3, 4], [], 500, 42n, 0.95).answer.vars.seed).toBe('42');
    expect(permutationReport('twoSample', [1, 2, 3], [4, 5, 6], 'two-sided', 500, 42n).answer.vars.p).toBe('= 0.1');
    expect(labReport('normal', 0, [], 10, 100, 42n).plots?.length).toBe(1);
    expect(simulationReport('walk', 100, 0.5, 1, [1, 1], 42n).answer.key).toBe('sim_walk');
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
    expect(code(() => bootstrap('mean', [1], [], 1000, 1n))).toBe('tooFew');
    expect(code(() => bootstrap('diffMeans', [1, 2], [], 1000, 1n))).toBe('secondSample');
    expect(code(() => bootstrap('mean', [1, 2], [], 10, 1n))).toBe('resamplesRange');
    expect(code(() => bootstrap('mean', new Array(100_000).fill(1), [], 1000, 1n))).toBe('tooMuchWork');
    expect(code(() => permutationTest('correlation', [1, 2, 3], [1, 2], 'two-sided', 1000, 1n))).toBe('pairLength');
    expect(code(() => samplingLab('bernoulli', 2, [], 10, 100, 1n))).toBe('probabilityRange');
    expect(code(() => simulate('urn', 20, 0, 1, [5, 5], 1n))).toBe('urnDraws');
  });
});
