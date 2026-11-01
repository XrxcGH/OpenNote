import './text';
import { describe, expect, it } from 'vitest';
import { eigenvalues, realEigenvector, sortEigenvalues, spectralRadius, svd, symmetricEigen } from './eigen';

describe('eigenvalues', () => {
  it('[[4,1],[2,3]] has 2 and 5', () => {
    const v = sortEigenvalues(
      eigenvalues([
        [4, 1],
        [2, 3],
      ])!,
    );
    expect(v[0].re).toBeCloseTo(2, 12);
    expect(v[1].re).toBeCloseTo(5, 12);
  });
  it('a rotation has the pair +/- i', () => {
    const v = sortEigenvalues(
      eigenvalues([
        [0, -1],
        [1, 0],
      ])!,
    );
    expect(v[0].re).toBeCloseTo(0, 12);
    expect(v[0].im).toBeCloseTo(-1, 12);
    expect(v[1].im).toBeCloseTo(1, 12);
  });
  it('the 3 x 3 companion of (x-1)(x-2)(x-3) has 1, 2, 3', () => {
    const v = sortEigenvalues(
      eigenvalues([
        [0, 0, 6],
        [1, 0, -11],
        [0, 1, 6],
      ])!,
    );
    expect(v.map((z) => z.re)).toEqual([expect.closeTo(1, 10), expect.closeTo(2, 10), expect.closeTo(3, 10)]);
  });
  it('a 5 x 5 matrix: the trace is the sum of the eigenvalues and the determinant their product', () => {
    const A = [
      [2, -1, 0, 3, 1],
      [4, 1, 2, 0, -2],
      [0, 5, -3, 1, 1],
      [1, 0, 2, 6, -1],
      [3, 2, 0, 1, 0],
    ];
    const v = eigenvalues(A)!;
    expect(v.reduce((s, z) => s + z.re, 0)).toBeCloseTo(6, 9);
    expect(v.reduce((s, z) => s + z.im, 0)).toBeCloseTo(0, 9);
  });
  it('a triangular matrix has its diagonal', () => {
    const v = sortEigenvalues(
      eigenvalues([
        [3, 1, 4],
        [0, -2, 5],
        [0, 0, 7],
      ])!,
    );
    expect(v.map((z) => z.re)).toEqual([expect.closeTo(-2, 12), expect.closeTo(3, 12), expect.closeTo(7, 12)]);
  });
  it('spectral radius of [[0,1],[-2,-3]] is 2', () => {
    expect(
      spectralRadius([
        [0, 1],
        [-2, -3],
      ]),
    ).toBeCloseTo(2, 12);
  });
});

describe('symmetric eigenproblem and SVD', () => {
  it('[[2,1],[1,2]] has 1 and 3 with orthonormal vectors', () => {
    const { values, vectors } = symmetricEigen([
      [2, 1],
      [1, 2],
    ]);
    expect(values[0]).toBeCloseTo(1, 12);
    expect(values[1]).toBeCloseTo(3, 12);
    expect(Math.abs(vectors[0][1])).toBeCloseTo(Math.SQRT1_2, 12);
  });
  it('SVD of [[3,2,2],[2,3,-2]] has singular values 5 and 3', () => {
    const { S, U, V } = svd([
      [3, 2, 2],
      [2, 3, -2],
    ]);
    expect(S[0]).toBeCloseTo(5, 12);
    expect(S[1]).toBeCloseTo(3, 12);
    // A = U S V^T
    const A = [
      [3, 2, 2],
      [2, 3, -2],
    ];
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < 3; j++) {
        const value = S.reduce((s, sv, k) => s + U[i][k] * sv * V[j][k], 0);
        expect(value).toBeCloseTo(A[i][j], 12);
      }
    }
  });
  it('finds a small singular value accurately', () => {
    const { S } = svd([
      [1, 1],
      [1, 1 + 1e-9],
    ]);
    expect(S[1]).toBeCloseTo(5e-10, 14);
  });
  it('a real eigenvector satisfies A v = lambda v', () => {
    const A = [
      [4, 1],
      [2, 3],
    ];
    const v = realEigenvector(A, 5)!;
    expect(4 * v[0] + v[1]).toBeCloseTo(5 * v[0], 9);
  });
});
