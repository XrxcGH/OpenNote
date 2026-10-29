// The JAMA port against values computed independently with NumPy and SciPy (LAPACK), and against the definitions:
// A v = λ v, U S Vᵀ = A, and the equations the solvers solve.
import { describe, expect, it } from 'vitest';
import { cabs, cmul, csub, cx } from '../complex';
import type { Complex } from '../complex';
import { NumError } from '../errors';
import {
  cholesky,
  choleskySolve,
  cond,
  det,
  dlyap,
  eig,
  eigGeneralizedSymmetric,
  eigSymmetric,
  expm,
  inverse,
  kron,
  lyap,
  multiply,
  nullSpace,
  pinv,
  qrDecompose,
  qrQ,
  qrR,
  rank,
  solve,
  svd,
  sylvester,
  transpose,
} from './index';
import type { MatrixLike } from './index';

const near = (actual: MatrixLike, expected: MatrixLike, tol: number) => {
  expect(actual.length).toBe(expected.length);
  actual.forEach((row, i) => row.forEach((x, j) => expect(Math.abs(x - expected[i][j])).toBeLessThanOrEqual(tol)));
};

const sortedValues = (values: Complex[]) => [...values].sort((a, b) => a.re - b.re || a.im - b.im);

/** ‖A v - λ v‖ for each eigenpair. */
function residuals(a: MatrixLike, values: Complex[], vectors: Complex[][]): number[] {
  return values.map((lambda, k) => {
    const v = vectors[k];
    return Math.max(
      ...a.map((row, i) => {
        const av = row.reduce((sum, x, j) => cx(sum.re + x * v[j].re, sum.im + x * v[j].im), cx(0));
        return cabs(csub(av, cmul(lambda, v[i])));
      }),
    );
  });
}

describe('eigenvalues', () => {
  it('finds -1 and -2 for [[0, 1], [-2, -3]]', () => {
    const { values, real } = eig([
      [0, 1],
      [-2, -3],
    ]);
    expect(real).toBe(true);
    const re = values.map((z) => z.re).sort((a, b) => a - b);
    expect(Math.abs(re[0] + 2)).toBeLessThan(1e-12);
    expect(Math.abs(re[1] + 1)).toBeLessThan(1e-12);
    values.forEach((z) => expect(z.im).toBe(0));
  });

  it('finds the complex pair ±i for a rotation', () => {
    const a = [
      [0, 1],
      [-1, 0],
    ];
    const { values, vectors, real } = eig(a);
    expect(real).toBe(false);
    expect(cabs(csub(values[0], cx(0, 1)))).toBeLessThan(1e-12);
    expect(cabs(csub(values[1], cx(0, -1)))).toBeLessThan(1e-12);
    for (const r of residuals(a, values, vectors)) expect(r).toBeLessThan(1e-12);
  });

  it('finds the roots -1, -2, -3 from the companion matrix of s³ + 6s² + 11s + 6', () => {
    const { values } = eig([
      [-6, -11, -6],
      [1, 0, 0],
      [0, 1, 0],
    ]);
    sortedValues(values).forEach((z, i) => {
      expect(Math.abs(z.re - [-3, -2, -1][i])).toBeLessThan(1e-10);
      expect(Math.abs(z.im)).toBeLessThan(1e-10);
    });
  });
});

describe('eigenvalues against LAPACK', () => {
  it('matches LAPACK on a 5 by 5 matrix with two complex pairs, and A v = λ v holds', () => {
    const a = [
      [1, 2, 0, 0, 3],
      [-1, 1, 0, 1, 0],
      [0, 0, 2, -3, 1],
      [1, 0, 1, 1, 0],
      [0, 2, 0, 1, -1],
    ];
    const expected = [
      cx(2.054748035085839, 1.264387299350961),
      cx(2.054748035085839, -1.264387299350961),
      cx(0.7292811209688079, 2.3204673308232873),
      cx(0.7292811209688079, -2.3204673308232873),
      cx(-1.5680583121092952),
    ];
    const { values, vectors } = eig(a);
    values.forEach((z, i) => expect(cabs(csub(z, expected[i]))).toBeLessThan(1e-12));
    for (const r of residuals(a, values, vectors)) expect(r).toBeLessThan(1e-12);
  });

  it('matches LAPACK on a real 4 by 4 matrix', () => {
    const a = [
      [4, -2, 1, 3],
      [1, 0, 2, -1],
      [0, 3, -1, 2],
      [2, 1, 1, 0],
    ];
    const expected = [5.24647579110634, 1.7676748071710477, -1.6242469847453496, -2.389903613532042];
    const { values, vectors } = eig(a);
    values.forEach((z, i) => expect(Math.abs(z.re - expected[i])).toBeLessThan(1e-12));
    for (const r of residuals(a, values, vectors)) expect(r).toBeLessThan(1e-12);
  });

  it('handles a defective matrix (one eigenvalue of multiplicity 3)', () => {
    const { values } = eig([
      [2, 1, 0],
      [0, 2, 1],
      [0, 0, 2],
    ]);
    values.forEach((z) => expect(cabs(csub(z, cx(2)))).toBeLessThan(1e-5));
  });
});

describe('symmetric eigenvalues', () => {
  it('gives the symmetric eigenvalues 2 - √2, 2, 2 + √2 with orthonormal vectors', () => {
    const a = [
      [2, -1, 0],
      [-1, 2, -1],
      [0, -1, 2],
    ];
    const { values, vectors } = eigSymmetric(a);
    [2 - Math.SQRT2, 2, 2 + Math.SQRT2].forEach((x, i) => expect(Math.abs(values[i] - x)).toBeLessThan(1e-14));
    near(
      multiply(transpose(vectors), vectors),
      [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
      1e-14,
    );
  });

  it('solves K x = λ M x with mass-normalized modes (SciPy eigh)', () => {
    const k = [
      [2000, -1000],
      [-1000, 1000],
    ];
    const m = [
      [2, 0],
      [0, 1],
    ];
    const { values, vectors } = eigGeneralizedSymmetric(k, m);
    expect(values[0]).toBeCloseTo(292.89321881345234, 9);
    expect(values[1]).toBeCloseTo(1707.1067811865473, 9);
    near(
      multiply(multiply(transpose(vectors), m), vectors),
      [
        [1, 0],
        [0, 1],
      ],
      1e-12,
    );
    expect(() =>
      eigGeneralizedSymmetric(k, [
        [1, 0],
        [0, -1],
      ]),
    ).toThrow(NumError);
  });
});

describe('eigenvalue input checks', () => {
  it('refuses a matrix that is not square', () => {
    expect(() => eig([[1, 2, 3]])).toThrow(/notSquare/);
  });
});

describe('singular values', () => {
  it('gives √45 and √5 for [[3, 0], [4, 5]]', () => {
    const { u, s, v } = svd([
      [3, 0],
      [4, 5],
    ]);
    expect(Math.abs(s[0] - Math.sqrt(45))).toBeLessThan(1e-10);
    expect(Math.abs(s[1] - Math.sqrt(5))).toBeLessThan(1e-10);
    const us = u.map((row) => row.map((x, j) => x * s[j]));
    near(
      multiply(us, transpose(v)),
      [
        [3, 0],
        [4, 5],
      ],
      1e-13,
    );
  });

  it('matches NumPy on a tall matrix and on its wide transpose', () => {
    const tall = [
      [1, 2],
      [3, 4],
      [5, 6],
    ];
    for (const a of [tall, transpose(tall)]) {
      const { s } = svd(a);
      expect(Math.abs(s[0] - 9.525518091565107)).toBeLessThan(1e-12);
      expect(Math.abs(s[1] - 0.514300580658644)).toBeLessThan(1e-12);
    }
  });
});

describe('rank and the pseudo-inverse', () => {
  it('gives rank, null space, pseudo-inverse, and condition number', () => {
    expect(
      rank([
        [1, 2],
        [2, 4],
      ]),
    ).toBe(1);
    const basis = nullSpace([
      [1, 2, 3],
      [2, 4, 6],
    ]);
    expect(basis[0]).toHaveLength(2);
    for (let j = 0; j < 2; j += 1)
      expect(Math.abs(basis[0][j] + 2 * basis[1][j] + 3 * basis[2][j])).toBeLessThan(1e-13);
    near(
      pinv([
        [1, 2],
        [2, 4],
        [3, 6],
      ]),
      [
        [0.014285714285714, 0.028571428571429, 0.042857142857143],
        [0.028571428571429, 0.057142857142857, 0.085714285714286],
      ],
      1e-14,
    );
    expect(
      cond([
        [1, 0],
        [0, 1e-3],
      ]),
    ).toBeCloseTo(1000, 9);
    expect(
      cond([
        [1, 1],
        [1, 1],
      ]),
    ).toBe(Infinity);
    expect(
      nullSpace([
        [1, 0],
        [0, 1],
      ])[0],
    ).toHaveLength(0);
  });
});

describe('systems and factorizations', () => {
  it('solves a square system, a least-squares system, and finds the determinant', () => {
    near(
      solve(
        [
          [2, 1],
          [1, 3],
        ],
        [[3], [5]],
      ),
      [[0.8], [1.4]],
      1e-15,
    );
    near(
      solve(
        [
          [1, 1],
          [1, 2],
          [1, 3],
        ],
        [[1], [2], [2]],
      ),
      [[2 / 3], [0.5]],
      1e-14,
    );
    expect(
      det([
        [2, 1, 1],
        [1, 3, 2],
        [1, 0, 0],
      ]),
    ).toBeCloseTo(-1, 14);
    near(
      multiply(
        inverse([
          [4, 7],
          [2, 6],
        ]),
        [
          [4, 7],
          [2, 6],
        ],
      ),
      [
        [1, 0],
        [0, 1],
      ],
      1e-14,
    );
  });
});

describe('singular systems', () => {
  it('says a singular system is singular, with zero, huge, and non-finite input handled', () => {
    expect(() =>
      solve(
        [
          [1, 2],
          [2, 4],
        ],
        [[1], [2]],
      ),
    ).toThrow(/singular/);
    expect(() =>
      inverse([
        [0, 0],
        [0, 0],
      ]),
    ).toThrow(/singular/);
    expect(
      det([
        [0, 0],
        [0, 0],
      ]),
    ).toBe(0);
    expect(
      det([
        [1e200, 0],
        [0, 1e100],
      ]),
    ).toBe(1e300);
    expect(() =>
      det([
        [NaN, 1],
        [1, 1],
      ]),
    ).toThrow(/notFinite/);
    expect(() => det([])).toThrow(/empty/);
    expect(() => solve([[1, 2, 3]], [[1]])).toThrow(/shape/);
  });
});

describe('QR and Cholesky', () => {
  it('factors by QR and Cholesky', () => {
    const a = [
      [12, -51, 4],
      [6, 167, -68],
      [-4, 24, -41],
    ];
    const f = qrDecompose(a);
    near(multiply(qrQ(f), qrR(f)), a, 1e-12);
    const spd = [
      [4, 2],
      [2, 3],
    ];
    const c = cholesky(spd);
    expect(c.spd).toBe(true);
    near(choleskySolve(c, [[2], [1]]), [[0.5], [0]], 1e-15);
    expect(
      cholesky([
        [1, 2],
        [2, 1],
      ]).spd,
    ).toBe(false);
  });
});

describe('matrix functions and equations', () => {
  it('gives expm([[0, π/2], [-π/2, 0]]) = [[0, 1], [-1, 0]]', () => {
    near(
      expm([
        [0, Math.PI / 2],
        [-Math.PI / 2, 0],
      ]),
      [
        [0, 1],
        [-1, 0],
      ],
      1e-12,
    );
  });

  it('matches SciPy expm, including a matrix that needs scaling and squaring', () => {
    near(
      expm([
        [1, 2],
        [-3, 0.5],
      ]),
      [
        [-1.471741809901802, 1.125881411395667],
        [-1.6888221170935, -1.753212162750718],
      ],
      1e-12,
    );
    near(
      expm([
        [-49, 24],
        [-64, 31],
      ]),
      [
        [-0.735758758144755, 0.5518190996581],
        [-1.471517599088265, 1.103638240715576],
      ],
      1e-10,
    );
    near(expm([[0]]), [[1]], 0);
  });
});

describe('Lyapunov and Sylvester equations', () => {
  it('solves Lyapunov and Sylvester equations (SciPy)', () => {
    const a = [
      [0, 1],
      [-2, -3],
    ];
    const x = lyap(a, [
      [1, 0],
      [0, 1],
    ]);
    near(
      x,
      [
        [1, -0.5],
        [-0.5, 0.5],
      ],
      1e-13,
    );
    near(
      dlyap(
        [
          [0.5, 0.1],
          [0, 0.3],
        ],
        [
          [1, 0],
          [0, 1],
        ],
      ),
      [
        [1.353156647274294, 0.038784744667098],
        [0.038784744667098, 1.098901098901099],
      ],
      1e-13,
    );
    near(
      sylvester(
        [
          [1, 2],
          [0, 3],
        ],
        [
          [4, 0],
          [1, 5],
        ],
        [
          [1, 0],
          [0, 1],
        ],
      ),
      [
        [0.21547619047619, -0.041666666666667],
        [-0.017857142857143, 0.125],
      ],
      1e-13,
    );
    const big = Array.from({ length: 13 }, (_, i) => Array.from({ length: 13 }, (_, j) => (i === j ? -1 : 0)));
    expect(() => lyap(big, big)).toThrow(/tooLarge/);
  });
});

describe('Kronecker products', () => {
  it('forms the Kronecker product', () => {
    expect(
      kron(
        [[1, 2]],
        [
          [0, 1],
          [1, 0],
        ],
      ),
    ).toEqual([
      [0, 1, 0, 2],
      [1, 0, 2, 0],
    ]);
  });
});
