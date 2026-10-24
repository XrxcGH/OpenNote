// The life-systems numerics against values worked out independently: closed-form ODE solutions, known roots,
// tabulated distribution values, exact line fits, and a Leslie matrix eigenvalue from its characteristic polynomial.
import { describe, expect, it } from 'vitest';
import { LsError } from './errors';
import { levenberg, lineFit } from './fit';
import { dominantEigen, eigen2, invert, solveLinear } from './linalg';
import { dopri, valueAt } from './ode';
import { createRng } from './rng';
import { brent } from './roots';
import { chiSquareCdf, lnGamma, normalCdf, normalQuantile, tCdf, tQuantile } from './special';

describe('the ODE integrator', () => {
  it('follows exponential decay to 1e-7', () => {
    const solution = dopri((_, y) => [-0.5 * y[0]], [100], 0, 2, { rtol: 1e-9, atol: 1e-12 });
    expect(solution.y[solution.y.length - 1][0]).toBeCloseTo(100 * Math.exp(-1), 6);
  });

  it('keeps a harmonic oscillator on its circle', () => {
    const solution = dopri((_, [x, v]) => [v, -x], [1, 0], 0, 2 * Math.PI, { rtol: 1e-10, atol: 1e-12 });
    const end = solution.y[solution.y.length - 1];
    expect(end[0]).toBeCloseTo(1, 7);
    expect(end[1]).toBeCloseTo(0, 7);
    expect(valueAt(solution, Math.PI, 0)).toBeCloseTo(-1, 3);
  });

  it('respects the maximum step', () => {
    const solution = dopri(() => [1], [0], 0, 1, { maxStep: 0.01 });
    expect(solution.t.length).toBeGreaterThanOrEqual(101);
  });

  it('refuses an empty span', () => {
    expect(() => dopri(() => [1], [0], 1, 1)).toThrow(LsError);
  });
});

describe('root finding', () => {
  it('finds the square root of 2', () => {
    expect(brent((x) => x * x - 2, 0, 2)).toBeCloseTo(Math.SQRT2, 12);
  });

  it('says when the bracket has no sign change', () => {
    expect(() => brent((x) => x * x + 1, -1, 1)).toThrow(LsError);
  });
});

describe('special functions', () => {
  it('match tabulated values', () => {
    expect(lnGamma(5)).toBeCloseTo(Math.log(24), 12);
    expect(lnGamma(0.5)).toBeCloseTo(0.5 * Math.log(Math.PI), 12);
    expect(normalCdf(1.959963985)).toBeCloseTo(0.975, 9);
    expect(normalQuantile(0.975)).toBeCloseTo(1.959963985, 8);
    expect(1 - chiSquareCdf(12, 7)).toBeCloseTo(0.1005589, 6);
    expect(tCdf(2.228138852, 10)).toBeCloseTo(0.975, 8);
    expect(tQuantile(0.975, 10)).toBeCloseTo(2.228138852, 6);
  });
});

describe('linear algebra', () => {
  it('solves and inverts a 3 x 3 system', () => {
    const a = [
      [2, 1, 1],
      [1, 3, 2],
      [1, 0, 0],
    ];
    expect(solveLinear(a, [4, 5, 6])).toEqual([6, 15, -23].map((v) => expect.closeTo(v, 10)));
    const inv = invert(a);
    expect(inv[2][2]).toBeCloseTo(-5, 10);
  });

  it('says when a matrix is singular', () => {
    expect(() =>
      solveLinear(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      ),
    ).toThrow(LsError);
  });

  it('finds the dominant eigenpair of a Leslie matrix', () => {
    // λ³ = 0.75 λ + 0.2: the positive root, by Newton's method by hand, is 0.977083.
    const result = dominantEigen([
      [0, 1.5, 1],
      [0.5, 0, 0],
      [0, 0.4, 0],
    ]);
    expect(result.value).toBeCloseTo(0.977083, 6);
    expect(result.right[0]).toBeCloseTo(0.580984, 6);
    expect(result.left.reduce((s, v, i) => s + v * result.right[i], 0)).toBeCloseTo(1, 12);
  });

  it('gives complex eigenvalues of a rotation', () => {
    expect(eigen2(0, -1, 1, 0)).toEqual([
      { re: 0, im: 1 },
      { re: 0, im: -1 },
    ]);
  });
});

describe('fits', () => {
  it('recovers an exact line', () => {
    const fit = lineFit([1, 2, 3, 4], [3, 5, 7, 9]);
    expect(fit.slope).toBeCloseTo(2, 12);
    expect(fit.intercept).toBeCloseTo(1, 12);
    expect(fit.r2).toBeCloseTo(1, 12);
  });

  it('recovers Michaelis-Menten parameters from exact data', () => {
    const S = [0.5, 1, 2, 4, 8, 16];
    const v = S.map((s) => (10 * s) / (2 + s));
    const fit = levenberg(
      ([s], [Vmax, Km]) => (Vmax * s) / (Km + s),
      S.map((s) => [s]),
      v,
      [5, 1],
    );
    expect(fit.params[0]).toBeCloseTo(10, 6);
    expect(fit.params[1]).toBeCloseTo(2, 6);
  });

  it('needs more points than parameters', () => {
    expect(() => levenberg(([x], [a, b]) => a + b * x, [[1], [2]], [1, 2], [0, 0])).toThrow(LsError);
  });
});

describe('the seeded generator', () => {
  it('repeats for the same seed and differs for another', () => {
    const a = createRng(7);
    const b = createRng(7);
    const c = createRng(8);
    const first = [a.next(), a.next(), a.next()];
    expect([b.next(), b.next(), b.next()]).toEqual(first);
    expect(c.next()).not.toBe(first[0]);
  });

  it('draws a uniform mean near one half', () => {
    const rng = createRng(1);
    let total = 0;
    for (let i = 0; i < 20000; i += 1) total += rng.next();
    expect(total / 20000).toBeCloseTo(0.5, 2);
  });
});
