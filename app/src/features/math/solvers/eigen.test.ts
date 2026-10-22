import { describe, expect, it } from 'vitest';
import { eigen } from './eigen';

describe('eigenvalues and eigenvectors', () => {
  it('finds a symmetric 2×2 pair with its eigenvectors', () => {
    const result = eigen([
      [2, 1],
      [1, 2],
    ]);
    expect(result.pairs.map((p) => p.value.re)).toEqual([expect.closeTo(3, 12), expect.closeTo(1, 12)]);
    const [v3, v1] = result.pairs.map((p) => p.vectors[0]);
    expect(v3[0]).toBeCloseTo(v3[1], 12);
    expect(v1[0]).toBeCloseTo(-v1[1], 12);
    expect(result.diagonalizable).toBe(true);
    expect(result.plot.after.length).toBe(result.plot.before.length);
    expect(result.plot.eigenLines).toHaveLength(2);
  });

  it('finds the complex pair of a rotation', () => {
    const result = eigen([
      [0, -1],
      [1, 0],
    ]);
    for (const pair of result.pairs) {
      expect(pair.value.re).toBeCloseTo(0, 12);
      expect(Math.abs(pair.value.im)).toBeCloseTo(1, 12);
    }
    expect(result.pairs[0].complexVector).toMatch(/i/);
  });

  it('says a shear is not diagonalizable', () => {
    const result = eigen([
      [1, 1],
      [0, 1],
    ]);
    expect(result.pairs).toHaveLength(1);
    expect(result.pairs[0].algebraic).toBe(2);
    expect(result.pairs[0].vectors).toHaveLength(1);
    expect(result.diagonalizable).toBe(false);
  });

  it('finds the eigenvalues of a 3×3 matrix', () => {
    const result = eigen([
      [2, 0, 0],
      [0, 3, 4],
      [0, 4, 9],
    ]);
    expect(result.pairs.map((p) => p.value.re)).toEqual([
      expect.closeTo(11, 10),
      expect.closeTo(2, 10),
      expect.closeTo(1, 10),
    ]);
    expect(result.characteristic).toEqual([1, -14, 35, -22].map((x) => expect.closeTo(x, 10)));
    const v11 = result.pairs[0].vectors[0];
    expect(v11[0]).toBeCloseTo(0, 10);
    expect(v11[2] / v11[1]).toBeCloseTo(2, 10);
    expect(result.plot.before).toHaveLength(12);
  });

  it('finds a repeated eigenvalue with a two-dimensional eigenspace', () => {
    const result = eigen([
      [2, 0, 0],
      [0, 2, 0],
      [0, 0, 5],
    ]);
    const two = result.pairs.find((p) => Math.abs(p.value.re - 2) < 1e-6)!;
    expect(two.algebraic).toBe(2);
    expect(two.vectors).toHaveLength(2);
    expect(result.diagonalizable).toBe(true);
  });

  it('finds a complex pair in 3×3', () => {
    const result = eigen([
      [1, 0, 0],
      [0, 0, -2],
      [0, 2, 0],
    ]);
    const complex = result.pairs.filter((p) => p.value.im !== 0);
    expect(complex).toHaveLength(2);
    expect(Math.abs(complex[0].value.im)).toBeCloseTo(2, 10);
  });
});
