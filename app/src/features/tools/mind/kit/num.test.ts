// The shared numerics against published values: standard tables, closed forms, and exact identities.
import { describe, expect, it } from 'vitest';
import {
  betaInc,
  brent,
  erf,
  erfc,
  fQuantile,
  integrate,
  lineFit,
  logGamma,
  logNormCdf,
  minimize1d,
  nelderMead,
  normCdf,
  normQuantile,
  quantile,
  tCdf,
  tQuantile,
} from './num';
import { makeRng } from './rng';
import { numLatex, numText } from './format';
import { cells, readMatrix, readNumber } from './parse';

const close = (got: number, want: number, tol: number) => expect(Math.abs(got - want)).toBeLessThanOrEqual(tol);

describe('normal distribution', () => {
  it('matches tabled values of Phi, erf, and erfc', () => {
    close(normCdf(1), 0.8413447460685429, 1e-15);
    close(normCdf(-1.96), 0.024997895148220435, 1e-15);
    close(normCdf(-6) / 9.865876450376946e-10, 1, 1e-12);
    close(erf(0.5), 0.5204998778130465, 1e-15);
    close(erfc(3) / 2.209049699858544e-5, 1, 1e-12);
    close(logNormCdf(-10), Math.log(7.619853024160527e-24), 1e-9);
  });

  it('inverts Phi to full precision, tails included', () => {
    close(normQuantile(0.975), 1.959963984540054, 1e-14);
    close(normQuantile(0.8), 0.8416212335729143, 1e-14);
    close(normQuantile(1e-10), -6.361340902404056, 1e-12);
    expect(normQuantile(0)).toBe(-Infinity);
    expect(normQuantile(1)).toBe(Infinity);
    expect(normQuantile(1.2)).toBeNaN();
  });
});

describe('gamma, beta, t, and F', () => {
  it('gives log-gamma at whole and half numbers', () => {
    close(logGamma(5), Math.log(24), 1e-13);
    close(logGamma(0.5), Math.log(Math.sqrt(Math.PI)), 1e-13);
    close(logGamma(10.5), 13.940625219403763, 1e-12);
  });

  it('gives the incomplete beta as a binomial tail', () => {
    // I_0.4(2, 3) is the chance of at least 2 successes in 4 trials with p = 0.4.
    close(betaInc(2, 3, 0.4), 0.5248, 1e-13);
  });

  it('gives tabled t and F quantiles', () => {
    close(tQuantile(0.975, 3), 3.182446305284263, 1e-9);
    close(tQuantile(0.975, 10), 2.2281388519649385, 1e-9);
    close(tCdf(0, 7), 0.5, 1e-15);
    // F(1, n) is the square of t(n).
    close(fQuantile(0.95, 1, 10), 2.2281388519649385 ** 2, 1e-8);
    close(fQuantile(0.95, 3, 10), 3.708, 1e-3);
  });
});

describe('solvers', () => {
  it('finds roots, integrals, and minima', () => {
    close(
      brent((x) => x ** 3 - 2 * x - 5, 2, 3),
      2.0945514815423265,
      1e-12,
    );
    close(integrate(Math.sin, 0, Math.PI), 2, 1e-12);
    close(
      minimize1d((x) => (x - 2) ** 2, 0, 5),
      2,
      1e-6,
    );
    const rosen = nelderMead((p) => 100 * (p[1] - p[0] ** 2) ** 2 + (1 - p[0]) ** 2, [-1.2, 1], [0.5, 0.5]);
    close(rosen.x[0], 1, 1e-6);
    close(rosen.x[1], 1, 1e-6);
    expect(Number.isNaN(brent((x) => x * x + 1, -1, 1))).toBe(true);
  });

  it('fits a line and takes quantiles', () => {
    const fit = lineFit([1, 2, 3, 4], [3, 5, 7, 9]);
    close(fit.slope, 2, 1e-12);
    close(fit.intercept, 1, 1e-12);
    close(quantile([1, 2, 3, 4], 0.25), 1.75, 1e-12);
  });
});

describe('random source', () => {
  it('repeats a seeded run and stays in range', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const first = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(first);
    expect(first.every((x) => x >= 0 && x < 1)).toBe(true);
    const r = makeRng(7);
    const draws = Array.from({ length: 20000 }, () => r.normal());
    close(draws.reduce((s, x) => s + x, 0) / draws.length, 0, 0.03);
    const betas = Array.from({ length: 20000 }, () => r.beta(2, 5));
    close(betas.reduce((s, x) => s + x, 0) / betas.length, 2 / 7, 0.01);
  });
});

describe('reading and writing numbers', () => {
  it('reads plain numbers and tables', () => {
    expect(readNumber('−1.5e2')).toBe(-150);
    expect(readNumber('1,5')).toBeNaN();
    expect(cells('a\tb c')).toEqual(['a', 'b c']);
    expect(readMatrix('x, y\n1, 2\n3, 4', 'data')).toEqual({
      header: ['x', 'y'],
      rows: [
        [1, 2],
        [3, 4],
      ],
    });
    expect(() => readMatrix('1 2\n3', 'data')).toThrow('ragged');
  });

  it('writes 6 significant figures and powers of 10', () => {
    expect(numText(1.6832424671)).toBe('1.68324');
    expect(numText(0.5)).toBe('0.5');
    expect(numText(0.0000123456)).toBe('1.23456e-5');
    expect(numLatex(0.0000123456)).toBe('1.23456 \\times 10^{-5}');
    expect(numText(NaN)).toBe('');
  });
});
