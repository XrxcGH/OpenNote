import { describe, expect, it } from 'vitest';
import { fmt, tex } from './format';
import {
  brent,
  erf,
  erfc,
  expErfc,
  expint1,
  leastSquares,
  lineFit,
  maximize,
  polyAt,
  polyFit,
  quad,
  solveLinear,
} from './num';
import { CivilError } from './types';
import { fromBase, toBase } from './units';

const close = (actual: number, expected: number, rel = 1e-12) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(expected)));

describe('civil numerics', () => {
  it('gives the error function on both sides of the series and fraction switch', () => {
    close(erf(0.5), 0.5204998778130465);
    close(erf(1), 0.8427007929497149);
    close(erf(-1), -0.8427007929497149);
    expect(erfc(2.5) / 4.06952017444959e-4).toBeCloseTo(1, 12);
    expect(erfc(3) / 2.209049699858544e-5).toBeCloseTo(1, 12);
    expect(erfc(5) / 1.5374597944280349e-12).toBeCloseTo(1, 11);
    close(erfc(-1), 1.8427007929497148);
    close(expErfc(10, 3), Math.exp(10) * 2.209049699858544e-5, 1e-11);
    expect(Number.isFinite(expErfc(900, 40))).toBe(true);
  });

  it('gives the exponential integral by series and continued fraction', () => {
    close(expint1(0.01), 4.037929576538114, 1e-13);
    close(expint1(0.5), 0.5597735947761608, 1e-13);
    close(expint1(1), 0.2193839343955203, 1e-13);
    expect(expint1(5) / 0.001148295591275326).toBeCloseTo(1, 12);
    expect(expint1(10) / 4.156968929685324e-6).toBeCloseTo(1, 12);
    expect(() => expint1(0)).toThrow(CivilError);
  });

  it('integrates, finds roots, and solves linear systems', () => {
    close(quad(Math.sin, 0, Math.PI), 2, 1e-10);
    close(quad(Math.exp, 0, 1), Math.E - 1, 1e-11);
    close(
      brent((x) => x * x - 2, 0, 2),
      Math.SQRT2,
      1e-13,
    );
    expect(() => brent((x) => x * x + 1, 0, 2)).toThrow(CivilError);
    const x = solveLinear(
      [
        [2, 1, -1],
        [-3, -1, 2],
        [-2, 1, 2],
      ],
      [8, -11, -3],
    );
    [2, 3, -1].forEach((v, i) => close(x[i]!, v, 1e-12));
    expect(() =>
      solveLinear(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      ),
    ).toThrow(CivilError);
  });

  it('fits lines, polynomials, and nonlinear models', () => {
    const line = lineFit([0, 1, 2, 3], [1, 3, 5, 7]);
    close(line.slope, 2);
    close(line.intercept, 1);
    close(line.r2, 1);
    const quadFit = polyFit([0, 1, 2, 3, 4], [1, 2, 5, 10, 17], 2);
    close(polyAt(quadFit, 5), 26, 1e-10);
    const xs = [0, 0.5, 1, 1.5, 2];
    const fit = leastSquares((p) => xs.map((v) => p[0]! * Math.exp(p[1]! * v) - 3 * Math.exp(-0.7 * v)), [1, -0.1]);
    close(fit.p[0]!, 3, 1e-8);
    close(fit.p[1]!, -0.7, 1e-8);
    close(
      maximize((v) => -((v - 2) ** 2), 0, 5),
      2,
      1e-8,
    );
    expect(() => lineFit([1], [2])).toThrow(CivilError);
  });

  it('formats numbers and converts units', () => {
    expect(fmt(3.213284)).toBe('3.21328');
    expect(fmt(3.3333333e-6)).toBe('3.33333 × 10⁻⁶');
    expect(tex(1e-6)).toBe('1 \\times 10^{-6}');
    expect(fmt(0)).toBe('0');
    close(toBase('pressure', 1, 'psi'), 6.894757293168361, 1e-12);
    close(toBase('temperature', 68, '°F'), 20, 1e-12);
    close(toBase('kelvin', 20, '°C'), 293.15, 1e-12);
    close(fromBase('length', 0.3048, 'ft'), 1, 1e-12);
    close(toBase('unitWeight', 62.4, 'lbf/ft³'), 9.80226, 1e-5);
  });
});
