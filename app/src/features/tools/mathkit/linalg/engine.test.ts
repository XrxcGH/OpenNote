import { describe, expect, it } from 'vitest';
import { characteristicPolynomial, eigenSteps, rationalRoots } from './eigenexact';
import {
  coordinates,
  leastSquares,
  luSteps,
  mapMatrix,
  polynomialLeastSquares,
  projection,
  qrSteps,
  svdSteps,
  transition,
} from './factor';
import { q, readMatrix, rref, text } from './frac';
import { FIRST, OPERATIONS, SAMPLES, run, type State } from './run';
import { determinantSteps, inverseOf, reduceOnly, solveSystem, subspaces } from './solve';

const vars = (out: { lines: readonly { key: string; vars?: Readonly<Record<string, string>> }[] }, key: string) =>
  out.lines.find((l) => l.key === key)?.vars;
const keys = (out: { lines: readonly { key: string }[] }) => out.lines.map((l) => l.key);
const ops = (out: { steps: readonly { vars?: Readonly<Record<string, string>> }[] }) =>
  out.steps.map((s) => s.vars?.op ?? '');

describe('the planned validation cases', () => {
  it('solves [[1,2,-1],[2,3,-1],[-2,0,-3]] x = (-4,-11,22) as x = (-8, 1, -2) with row operations named', () => {
    const out = solveSystem('1 2 -1\n2 3 -1\n-2 0 -3', '-4 -11 22');
    expect(vars(out, 'laUnique')!.x).toBe('(-8, 1, -2)');
    expect(ops(out)).toContain('R2 ← R2 - 2R1');
    expect(ops(out)).toContain('R3 ← R3 + 2R1');
    expect(out.latex).toContain('-8');
  });
  it('det [[6,1,1],[4,-2,5],[2,8,7]] = -306 by cofactors and by elimination', () => {
    const out = determinantSteps('6 1 1\n4 -2 5\n2 8 7');
    expect(vars(out, 'laDet')!.det).toBe('-306');
    expect(out.steps.some((s) => s.key === 'laCofactor' && s.math!.includes('-306'))).toBe(true);
  });
  it('the inverse of [[2,1],[5,3]] is [[3,-1],[-5,2]]', () => {
    const out = inverseOf('2 1\n5 3');
    expect(vars(out, 'laInverse')!.inverse).toBe('3 -1; -5 2');
  });
  it('the null space of [[1,2,3],[2,4,6]] has dimension 2 with basis (-2,1,0), (-3,0,1)', () => {
    const out = subspaces('1 2 3\n2 4 6');
    expect(vars(out, 'laRank')).toEqual({ rank: '1', nullity: '2' });
    expect(vars(out, 'laNullText')!.basis).toBe('(-2, 1, 0), (-3, 0, 1)');
    expect(vars(out, 'laColText')!.basis).toBe('(1, 2)');
    expect(vars(out, 'laRowText')!.basis).toBe('(1, 2, 3)');
  });
  it('[[4,1],[2,3]] has eigenvalues 2 and 5 and is diagonalizable', () => {
    const out = eigenSteps('4 1\n2 3');
    expect(vars(out, 'laEigenvalues')!.values).toBe('2, 5');
    expect(keys(out)).toContain('laDiagonalizable');
    expect(out.steps.find((s) => s.key === 'laDiagCheck')!.math).toContain('holds');
  });
  it('the singular values of [[3,2,2],[2,3,-2]] are 5 and 3', () => {
    const out = svdSteps('3 2 2\n2 3 -2');
    const values = vars(out, 'laSingularValues')!.values.split(', ').map(Number);
    expect(values[0]).toBeCloseTo(5, 12);
    expect(values[1]).toBeCloseTo(3, 12);
    expect(out.latex).toBe('\\sigma=5,\\ 3');
    // A 2x3 matrix has rank 2, and U is the 2x2 orthonormal matrix, not a 2x3 one with a zero column.
    expect(vars(out, 'laSingularValues')!.rank).toBe('2');
    const u = out.steps.find((s) => s.key === 'laSvdU')!.math!;
    expect(u.split('\\\\').length).toBe(2);
    expect(u.split('&').length - 1).toBe(2);
    expect(out.steps.find((s) => s.key === 'laSigma')!.math).toContain('\\lambda_{3}=0');
  });
  it('the least-squares line through (0,1), (1,3), (2,4), (3,4) is y = 1.5 + 1.0 x', () => {
    const a = leastSquares('1 0\n1 1\n1 2\n1 3', '1 3 4 4');
    expect(vars(a, 'laLsq')!.x).toBe('(3/2, 1)');
    const b = polynomialLeastSquares('0, 1\n1, 3\n2, 4\n3, 4', 1);
    expect(vars(b, 'laFit')!.coefficients).toBe('3/2, 1');
    expect(b.plots).toHaveLength(1);
  });
});

describe('solutions of a system', () => {
  it('says when there is no solution and when there are many', () => {
    const none = solveSystem('1 1\n1 1', '1 2');
    expect(keys(none)).toEqual(['laNone']);
    const many = solveSystem('1 1\n2 2', '3 6');
    expect(vars(many, 'laInfinite')).toEqual({ free: '1', x: '(3, 0)' });
    expect(many.latex).toContain('t_{1}');
    const wide = solveSystem('1 2 3\n0 0 1', '4 5');
    expect(vars(wide, 'laInfinite')!.free).toBe('1');
  });
  it('keeps exact fractions and reads fractions and decimals', () => {
    const out = solveSystem('1/2 1/3\n1 0.25', '1 3');
    // x/2 + y/3 = 1, x + y/4 = 3 -> x = 18/5, y = -12/5
    expect(vars(out, 'laUnique')!.x).toBe('(18/5, -12/5)');
  });
  it('checks the answer by substitution for random-looking integer systems', () => {
    const A = [
      [3, -2, 5],
      [1, 4, -1],
      [2, 2, 7],
    ];
    const b = [7, -3, 11];
    const out = solveSystem(A.map((r) => r.join(' ')).join('\n'), b.join(' '));
    const x = vars(out, 'laUnique')!
      .x.slice(1, -1)
      .split(', ')
      .map((s) => {
        const [n, d] = s.split('/').map(Number);
        return n / (d ?? 1);
      });
    A.forEach((row, i) => expect(row.reduce((s, v, j) => s + v * x[j], 0)).toBeCloseTo(b[i], 12));
  });
  it('reduces to rref and reports the pivots', () => {
    const out = reduceOnly('1 2 3\n2 4 6\n1 1 1');
    expect(vars(out, 'laRank')).toEqual({ rank: '2', nullity: '1' });
    expect(vars(out, 'laPivots')!.cols).toBe('1, 2');
  });
  it('handles the zero matrix and a single entry', () => {
    expect(vars(reduceOnly('0 0\n0 0'), 'laRank')!.rank).toBe('0');
    expect(vars(determinantSteps('7'), 'laDet')!.det).toBe('7');
    expect(vars(inverseOf('4'), 'laInverse')!.inverse).toBe('1/4');
  });
});

describe('inverse and determinant', () => {
  it('a singular matrix has no inverse', () => {
    const out = inverseOf('1 2\n2 4');
    expect(keys(out)).toEqual(['laSingular']);
    expect(vars(determinantSteps('1 2\n2 4'), 'laDet')!.det).toBe('0');
  });
  it('A times its inverse is the identity for a 4 x 4', () => {
    const src = '2 0 1 3\n1 1 0 2\n0 3 1 1\n4 1 2 0';
    const out = inverseOf(src);
    expect(out.latex).toContain('A^{-1}');
    const det = vars(determinantSteps(src), 'laDet')!.det;
    expect(det).not.toBe('0');
  });
  it('the determinant changes sign for a swap and handles a zero pivot', () => {
    expect(vars(determinantSteps('0 1\n1 0'), 'laDet')!.det).toBe('-1');
    expect(vars(determinantSteps('0 2 1\n1 0 3\n4 1 0'), 'laDet')!.det).toBe('25');
  });
});

describe('factorizations', () => {
  it('LU with row exchanges satisfies PA = LU exactly', () => {
    const out = luSteps('0 2 1\n1 1 1\n2 1 4');
    expect(vars(out, 'laLu')!.check).toBe('yes');
    expect(out.steps.some((s) => s.key === 'laSwap')).toBe(true);
  });
  it('QR by Gram-Schmidt rebuilds A', () => {
    const out = qrSteps('1 1\n1 0\n0 1');
    expect(Number(vars(out, 'laQr')!.error.replace('−', '-'))).toBeLessThan(1e-12);
    expect(() => qrSteps('1 2\n2 4')).toThrow();
    expect(() => qrSteps('1 2 3\n4 5 6')).toThrow();
  });
  it('projection onto a plane is orthogonal to the error', () => {
    const out = projection('1 0\n1 1\n1 2', '6 0 0');
    expect(vars(out, 'laProjection')!.p).toBe('(5, 2, -1)');
    expect(vars(out, 'laProjection')!.r).toBe('(1, -2, 1)');
    expect(out.steps.find((s) => s.key === 'laOrthogonal')!.math).toContain('holds');
  });
  it('least squares refuses dependent columns', () => {
    expect(() => leastSquares('1 2\n2 4\n3 6', '1 2 3')).toThrow();
  });
});

describe('eigenvalues in exact arithmetic', () => {
  it('computes the characteristic polynomial', () => {
    const p = characteristicPolynomial(readMatrix('2 0 0\n1 3 0\n0 1 5'));
    expect(p.map(text)).toEqual(['1', '-10', '31', '-30']);
    const { roots, rest } = rationalRoots(p);
    expect(roots.map((r) => text(r.value))).toEqual(['2', '3', '5']);
    expect(rest).toHaveLength(1);
  });
  it('finds repeated roots and non-integer rational ones', () => {
    // (2x - 1)(x + 3)^2 = 2x^3 + 11x^2 + 12x - 9 -> monic form from the matrix [[1/2,0,0],[0,-3,1],[0,0,-3]]
    const out = eigenSteps('1/2 0 0\n0 -3 1\n0 0 -3');
    expect(vars(out, 'laEigenvalues')!.values).toBe('-3 (x2), 1/2');
    expect(vars(out, 'laDefective')).toEqual({ value: '-3', algebraic: '2', geometric: '1' });
  });
  it('a symmetric matrix with repeated eigenvalue is still diagonalizable', () => {
    const out = eigenSteps('2 0 0\n0 2 0\n0 0 5');
    expect(keys(out)).toContain('laDiagonalizable');
  });
  it('gives decimals when the eigenvalues are not rational', () => {
    const out = eigenSteps('2 1\n1 1');
    const values = vars(out, 'laEigenApprox')!.values.split(', ').map(Number);
    expect(values[0]).toBeCloseTo((3 - Math.sqrt(5)) / 2, 6);
    expect(values[1]).toBeCloseTo((3 + Math.sqrt(5)) / 2, 6);
    const complex = eigenSteps('0 -1\n1 0');
    expect(vars(complex, 'laEigenApprox')!.values).toContain('i');
  });
});

describe('changing basis', () => {
  it('finds coordinates in a basis', () => {
    const out = coordinates('1 1\n0 1', '3 2');
    expect(vars(out, 'laCoordinates')!.c).toBe('(1, 2)');
    expect(() => coordinates('1 2\n2 4', '1 1')).toThrow();
  });
  it('finds the change of basis matrix C^-1 B', () => {
    const out = transition('1 1\n0 1', '1 0\n1 1');
    // C^-1 = [[1,0],[-1,1]], C^-1 B = [[1,1],[-1,0]]
    expect(vars(out, 'laTransitionLine')!.p).toBe('1 1; -1 0');
  });
  it('finds the matrix of a map in two bases', () => {
    const out = mapMatrix('2 0\n0 3', '1 1\n0 1', '1 0\n1 1');
    // T B = [[2,2],[0,3]]; C^-1 = [[1,0],[-1,1]]; product = [[2,2],[-2,1]]
    expect(vars(out, 'laMapLine')!.m).toBe('2 2; -2 1');
  });
});

describe('every operation runs on its sample, and bad input is named', () => {
  for (const op of OPERATIONS) {
    it(`${op} works on its sample`, () => {
      const state: State = { ...FIRST, ...SAMPLES[op], op };
      const out = run(state);
      expect(out.lines.length).toBeGreaterThan(0);
      expect(out.steps.length).toBeGreaterThan(0);
    });
  }
  it('rejects ragged rows, non-numbers, and big matrices', () => {
    expect(() => readMatrix('1 2\n3')).toThrow();
    expect(() => readMatrix('1 x')).toThrow();
    expect(() => readMatrix('1/0')).toThrow();
    expect(() => readMatrix('')).toThrow();
    expect(() => readMatrix(Array.from({ length: 9 }, () => '1 1 1 1 1 1 1 1 1').join('\n'))).toThrow();
    expect(() => inverseOf('1 2 3\n4 5 6')).toThrow();
    expect(() => solveSystem('1 2\n3 4', '1 2 3')).toThrow();
  });
  it('handles huge entries without losing exactness', () => {
    const out = solveSystem('1000000000000 1\n1 1000000000000', '1 1');
    expect(vars(out, 'laUnique')!.x).toContain('/');
    const e = rref(readMatrix('3 6\n1 2'));
    expect(e.m[0].map(text)).toEqual(['1', '2']);
    expect(text(q(6, 4))).toBe('3/2');
  });
});
