// The shared statistics kit: reading pasted tables, design matrices with coded levels and interactions, least
// squares, the symmetric eigen solver, the distributions (against SciPy), and the seeded generator.
import { describe, expect, it } from 'vitest';
import { cellNumber, completeRows, parseTable } from './data';
import { buildDesign, mainTerms } from './design';
import {
  chiSquareQuantile,
  chiSquareUpper,
  fQuantile,
  fUpper,
  lnGamma,
  normalQuantile,
  normalTwoSided,
  tCdf,
  tQuantile,
  tTwoSided,
} from './dist';
import { linearLatex, numberText } from './format';
import { inverse, leastSquares, matMul, symmetricEigen } from './linalg';
import { makeRng } from './rng';
import { StatError } from './types';

const close = (got: number, want: number, rel = 1e-9) =>
  expect(Math.abs(got - want)).toBeLessThanOrEqual(rel * Math.max(1, Math.abs(want)));

describe('pasted tables', () => {
  it('reads tabs, commas with quotes, and spaces, with a header line', () => {
    expect(parseTable('a\tb\n1\t2').names).toEqual(['a', 'b']);
    const csv = parseTable('name,"score, total"\n"Smith, J",4\n');
    expect(csv.names).toEqual(['name', 'score, total']);
    expect(csv.cells[0]).toEqual(['Smith, J', '4']);
    expect(parseTable('1 2\n3 4').names).toEqual(['c1', 'c2']);
  });

  it('treats NA, dots and empty cells as missing, and reads a Unicode minus', () => {
    expect(Number.isNaN(cellNumber('NA'))).toBe(true);
    expect(cellNumber('−2.5')).toBe(-2.5);
    expect(cellNumber('12%')).toBeCloseTo(0.12, 12);
    expect(cellNumber('abc')).toBeNull();
    const t = parseTable('x,y\n1,2\n.,3\n4,');
    expect(completeRows(t, ['x', 'y'])).toEqual([0]);
  });

  it('says which row has the wrong number of cells', () => {
    try {
      parseTable('a,b\n1,2\n3');
      expect.unreachable();
    } catch (error) {
      expect((error as StatError).code).toBe('ragged');
      expect((error as StatError).detail).toBe('3|2');
    }
  });
});

describe('design matrices', () => {
  const t = parseTable('y,x,g\n1,1,a\n2,2,b\n3,3,c\n4,4,a');

  it('codes a column of words against its first level, or with effect coding', () => {
    const ref = buildDesign(t, mainTerms(['g']));
    expect(ref.columns).toEqual(['(Intercept)', 'g[b]', 'g[c]']);
    expect(ref.x[0]).toEqual([1, 0, 0]);
    const eff = buildDesign(t, mainTerms(['g']), { coding: 'effect' });
    expect(eff.x[0]).toEqual([1, -1, -1]);
  });

  it('builds interactions, powers and centered columns', () => {
    const d = buildDesign(t, [{ factors: [{ name: 'x' }, { name: 'g' }] }, { factors: [{ name: 'x', power: 2 }] }], {
      center: true,
    });
    expect(d.columns).toEqual(['(Intercept)', 'x:g[b]', 'x:g[c]', 'x^2']);
    expect(d.x.map((r) => r[3])).toEqual([2.25, 0.25, 0.25, 2.25]);
  });

  it('refuses a log of a value that is not positive', () => {
    expect(() => buildDesign(parseTable('x\n0\n1'), [{ factors: [{ name: 'x', log: true }] }])).toThrow(StatError);
  });
});

describe('linear algebra', () => {
  it('solves least squares and flags a collinear column by name', () => {
    const x = [1, 2, 3, 4].map((v) => [1, v]);
    const fit = leastSquares(x, [3, 5, 7, 9]);
    close(fit.coef[0], 1);
    close(fit.coef[1], 2);
    expect(() =>
      leastSquares(
        [1, 2, 3, 4].map((v) => [1, v, 2 * v]),
        [1, 2, 3, 5],
        ['a', 'b', 'c'],
      ),
    ).toThrow(StatError);
  });

  it('inverts a matrix and finds symmetric eigenvalues (NumPy eigh)', () => {
    const a = [
      [4, 1, 2],
      [1, 3, 0.5],
      [2, 0.5, 5],
    ];
    const product = matMul(a, inverse(a)!);
    product.forEach((row, i) => row.forEach((v, j) => close(v, i === j ? 1 : 0, 1e-12)));
    const eig = symmetricEigen(a);
    [6.83125443, 3.07222395, 2.09652162].forEach((v, i) => close(eig.values[i], v, 1e-8));
    expect(
      inverse([
        [1, 2],
        [2, 4],
      ]),
    ).toBeNull();
  });
});

describe('distributions (SciPy 1.18)', () => {
  it('matches t, chi-square, F and normal values', () => {
    close(tCdf(2.1, 7), 0.9630644018935387, 1e-11);
    close(tTwoSided(2.1, 7), 0.07387119621292265, 1e-11);
    close(tQuantile(0.975, 10), 2.2281388519862744, 1e-10);
    close(chiSquareUpper(13.4009, 6), 0.037093408750256, 1e-11);
    close(chiSquareUpper(80, 3) / 3.0692774861724164e-17, 1, 1e-8);
    close(chiSquareQuantile(0.95, 1), 3.841458820694124, 1e-10);
    close(chiSquareQuantile(0.99, 4), 13.276704135987622, 1e-10);
    close(fUpper(3.5, 2, 17), 0.05333597974228042, 1e-11);
    close(fQuantile(0.95, 3, 20), 3.098391212140781, 1e-10);
    close(normalTwoSided(8) / 1.244192114854348e-15, 1, 1e-8);
    close(normalQuantile(0.999), 3.090232306167813, 1e-12);
    close(lnGamma(10.5), 13.940625219403763, 1e-13);
  });
});

describe('formatting and the seeded generator', () => {
  it('writes numbers for people and the fitted equation', () => {
    expect(numberText(0.00067682)).toBe('6.7682×10⁻⁴');
    expect(numberText(-2.446635)).toBe('−2.4466');
    expect(linearLatex([-2.4466, 0.5437], ['(Intercept)', 'hours'])).toBe('-2.4466 + 0.5437\\,\\text{hours}');
  });

  it('gives the same draws for the same seed', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    const draws = Array.from({ length: 5 }, () => a.next());
    expect(Array.from({ length: 5 }, () => b.next())).toEqual(draws);
    expect(draws.every((v) => v >= 0 && v < 1)).toBe(true);
    const normals = makeRng(7);
    const sample = Array.from({ length: 4000 }, () => normals.normal());
    const m = sample.reduce((s, v) => s + v, 0) / sample.length;
    expect(Math.abs(m)).toBeLessThan(0.06);
  });
});
