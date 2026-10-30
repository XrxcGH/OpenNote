// Gaussian mixtures by EM against values worked out separately: 1 E- and M-step on 0, 1, 3 from means 0 and 3 (unit
// variances, equal weights) by the normal density formula; 1 component, whose answer is the sample mean and the
// maximum-likelihood covariance in closed form; and 2 groups far apart, where each component is one group.
import { describe, expect, it } from 'vitest';
import { StatError } from '../kit/types';
import { expectation, gaussianMixture, maximization, mixtureParams } from './mixture';

const close = (got: number, want: number, tol: number) => expect(Math.abs(got - want)).toBeLessThanOrEqual(tol);
const code = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    return e instanceof StatError ? e.code : 'other';
  }
  return 'none';
};

describe('Gaussian mixture by EM', () => {
  const x = [[0], [1], [3]];
  const start = { weights: [0.5, 0.5], means: [[0], [3]], covs: [[[1]], [[1]]] };

  it('works 1 E-step and 1 M-step as by hand', () => {
    const e = expectation(x, start);
    // Row 1: 0.5 φ(1) against 0.5 φ(−2), so 1 / (1 + e^−1.5) = 0.817574476.
    [0.989013057, 0.817574476, 0.010986943].forEach((r, i) => close(e.resp[i][0], r, 1e-9));
    close(e.logLik, -5.112748374, 1e-9);
    const m = maximization(x, e.resp);
    close(m.weights[0], 0.605858159, 1e-9);
    close(m.means[0][0], 0.467950731, 1e-9);
    close(m.covs[0][0][0], 0.28524187, 1e-9);
    close(m.weights[0] + m.weights[1], 1, 1e-12);
  });

  it('gives the sample mean and covariance with 1 component', () => {
    const y = [
      [1, 2],
      [2, 1],
      [3, 5],
      [4, 4],
    ];
    const g = gaussianMixture(y, 1, 1);
    expect(g.means[0]).toEqual([2.5, 3]);
    close(g.covs[0][0][0], 1.25, 1e-12);
    close(g.covs[0][0][1], 1.25, 1e-12);
    close(g.covs[0][1][1], 2.5, 1e-12);
    // −n/2 (d ln 2π + ln |S| + d) with |S| = 1.5625.
    close(g.logLik, -12.244082471, 1e-9);
    expect(g.params).toBe(5);
    close(g.bic, -2 * g.logLik + 5 * Math.log(4), 1e-12);
  });

  it('finds 2 groups far apart', () => {
    const g = gaussianMixture([[-1.1], [-1], [-0.9], [0.9], [1], [1.1]], 2, 3);
    const order = g.means[0][0] < g.means[1][0] ? [0, 1] : [1, 0];
    close(g.means[order[0]][0], -1, 1e-9);
    close(g.means[order[1]][0], 1, 1e-9);
    // Each group's variance divides by its 3 rows: (0.01 + 0 + 0.01) / 3.
    order.forEach((c) => close(g.covs[c][0][0], 0.02 / 3, 1e-9));
    order.forEach((c) => close(g.weights[c], 0.5, 1e-9));
    expect(g.cluster.slice(0, 3).every((c) => c === order[0])).toBe(true);
  });

  it('never lets the log-likelihood fall', () => {
    const y = [[0.2], [1.1], [1.9], [3.2], [4.1], [4.4], [6.0], [6.3], [7.7], [9.1]];
    const g = gaussianMixture(y, 3, 1);
    g.history.slice(1).forEach((v, i) => expect(v).toBeGreaterThanOrEqual(g.history[i] - 1e-9));
    g.resp.forEach((r) =>
      close(
        r.reduce((s, v) => s + v, 0),
        1,
        1e-12,
      ),
    );
  });

  it('counts free parameters', () => {
    // 2 components in 2 dimensions: 1 weight, 4 means, 6 covariance entries.
    expect(mixtureParams(2, 2)).toBe(11);
  });

  it('says why it cannot fit some inputs', () => {
    expect(code(() => gaussianMixture([], 1, 1))).toBe('noData');
    expect(code(() => gaussianMixture([[1], [2]], 2, 1))).toBe('clusterCount');
    expect(code(() => gaussianMixture([[1], [2]], 0, 1))).toBe('clusterCount');
    // 3 identical rows: a component shrinks onto them and its variance goes to 0.
    expect(code(() => gaussianMixture([[0], [0], [0], [5]], 2, 1))).toBe('mixtureCollapse');
  });

  it('copes with huge and negative values', () => {
    const g = gaussianMixture([[-3e9], [-2.9e9], [-3.1e9], [4e9], [4.1e9], [3.9e9]], 2, 2);
    expect(Number.isFinite(g.logLik)).toBe(true);
    close(Math.min(g.means[0][0], g.means[1][0]), -3e9, 1);
  });
});
