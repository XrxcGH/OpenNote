// Multivariate methods against values worked out separately. PCA uses a 10-point covariance case, k-means uses fixed
// starting centers, and the merge heights cover single, complete, and Ward linkage. Classical scaling uses a 3-4-5
// triangle. Factor analysis is checked on exact 1-factor and rotated 2-factor structures, where the answer is known.
import { describe, expect, it } from 'vitest';
import { StatError } from '../kit/types';
import { agglomerate, classicalMds, cutTree, distanceMatrix, kMeans, leafOrder, plusPlus, silhouette } from './cluster';
import { covariance, factorAnalysis, parallelAnalysis, pca, principalAxis, promax, varimax } from './engine';

const close = (got: number, want: number, tol: number) => expect(Math.abs(got - want)).toBeLessThanOrEqual(tol);
const code = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    return e instanceof StatError ? e.code : 'other';
  }
  return 'none';
};

describe('principal components', () => {
  const x = [
    [2.5, 2.4],
    [0.5, 0.7],
    [2.2, 2.9],
    [1.9, 2.2],
    [3.1, 3.0],
    [2.3, 2.7],
    [2.0, 1.6],
    [1.0, 1.1],
    [1.5, 1.6],
    [1.1, 0.9],
  ];

  it('finds the eigenvalues of the covariance matrix and the share PC1 explains', () => {
    const p = pca(x, false);
    close(p.eigenvalues[0], 1.28403, 1e-5);
    close(p.eigenvalues[1], 0.0490834, 1e-6);
    close(p.explained[0], 96.318, 1e-3);
    close(p.cumulative[1], 100, 1e-9);
  });

  it('gives correlation eigenvalues that add to the number of columns', () => {
    const p = pca(x, true);
    close(p.eigenvalues[0] + p.eigenvalues[1], 2, 1e-12);
  });
});

describe('factor analysis', () => {
  it('recovers the loadings of an exact 1-factor correlation matrix', () => {
    const lam = [0.8, 0.7, 0.6, 0.5];
    const r = lam.map((a, i) => lam.map((b, j) => (i === j ? 1 : a * b)));
    const fit = principalAxis(r, 1);
    fit.loadings.forEach((row, j) => close(Math.abs(row[0]), lam[j], 1e-4));
  });

  it('turns a rotated simple structure back with varimax', () => {
    const l0 = [
      [0.8, 0],
      [0.7, 0],
      [0, 0.8],
      [0, 0.6],
    ];
    const [c, s] = [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6)];
    const turned = l0.map(([a, b]) => [c * a - s * b, s * a + c * b]);
    const back = varimax(turned);
    back.forEach((row, j) => {
      const sorted = row.map(Math.abs).sort((p, q) => q - p);
      close(sorted[0], Math.max(...l0[j]), 1e-6);
      close(sorted[1], 0, 1e-6);
    });
    const pm = promax(back);
    pm.phi.forEach((row, a) => close(row[a], 1, 1e-9));
  });

  it('runs factor analysis on data and keeps parallel analysis reproducible', () => {
    const x = Array.from({ length: 30 }, (_, i) => {
      const f = Math.sin(i * 1.7);
      const g = Math.cos(i * 2.3);
      return [
        f + 0.3 * Math.sin(i * 5.1),
        f + 0.3 * Math.cos(i * 4.3),
        g + 0.3 * Math.sin(i * 3.7),
        g + 0.3 * Math.cos(i * 6.1),
      ];
    });
    const fa = factorAnalysis(x, 2, 'varimax');
    fa.communalities.forEach((h, j) => close(h + fa.uniqueness[j], 1, 1e-12));
    expect(parallelAnalysis(30, 4, 50, 2)).toEqual(parallelAnalysis(30, 4, 50, 2));
  });
});

describe('k-means', () => {
  const x = [
    [1, 1],
    [1.5, 2],
    [3, 4],
    [5, 7],
    [3.5, 5],
    [4.5, 5],
    [3.5, 4.5],
  ];

  it('moves the centers from (1, 1) and (5, 7)', () => {
    const fit = kMeans(x, [
      [1, 1],
      [5, 7],
    ]);
    close(fit.centers[0][0], 1.25, 1e-6);
    close(fit.centers[0][1], 1.5, 1e-6);
    close(fit.centers[1][0], 3.9, 1e-6);
    close(fit.centers[1][1], 5.1, 1e-6);
  });

  it('seeds the same way for the same seed and scores silhouettes', () => {
    expect(plusPlus(x, 2, 4)).toEqual(plusPlus(x, 2, 4));
    const s = silhouette([[0], [1], [10], [11]], [0, 0, 1, 1]);
    close(s.mean, (9.5 / 10.5 + 8.5 / 9.5) / 2, 1e-12);
  });
});

describe('hierarchical clustering', () => {
  const d = distanceMatrix([[0], [1], [3], [7], [8]], 'euclidean');

  it('merges at the single, complete, and Ward heights', () => {
    expect(agglomerate(d, 'single').map((m) => m.height)).toEqual([1, 1, 2, 4]);
    expect(agglomerate(d, 'complete').map((m) => m.height)).toEqual([1, 1, 3, 8]);
    const ward = agglomerate(d, 'ward').map((m) => m.height);
    [1, 1, 2.88675, 9.55336].forEach((h, i) => close(ward[i], h, 1e-5));
  });

  it('cuts the tree and orders the leaves', () => {
    const merges = agglomerate(d, 'single');
    expect(cutTree(merges, 5, 2)).toEqual([0, 0, 0, 1, 1]);
    expect([...leafOrder(merges, 5)].sort()).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('classical scaling', () => {
  it('finds the eigenvalues of B for a 3-4-5 triangle and reproduces its sides', () => {
    const m = classicalMds([
      [0, 3, 4],
      [3, 0, 5],
      [4, 5, 0],
    ]);
    close(m.eigenvalues[0], 12.9641, 1e-4);
    close(m.eigenvalues[1], 3.70252, 1e-5);
    close(m.eigenvalues[2], 0, 1e-9);
    const side = (i: number, j: number) => Math.hypot(m.coords[i][0] - m.coords[j][0], m.coords[i][1] - m.coords[j][1]);
    close(side(0, 1), 3, 1e-9);
    close(side(1, 2), 5, 1e-9);
  });
});

describe('impossible multivariate input', () => {
  it('says why the analysis cannot run', () => {
    expect(code(() => pca([[1, 2]], false))).toBe('tooFewRows');
    expect(
      code(() =>
        covariance(
          [
            [1, 2],
            [1, 3],
            [1, 5],
          ],
          false,
        ),
      ),
    ).toBe('constantColumn');
    expect(
      code(() =>
        principalAxis(
          [
            [1, 0.5],
            [0.5, 1],
          ],
          2,
        ),
      ),
    ).toBe('factorCount');
    expect(code(() => kMeans([[1], [2]], [[1], [2], [3]]))).toBe('clusterCount');
    expect(
      code(() =>
        classicalMds([
          [0, 1, 2],
          [1, 0, 1],
          [3, 1, 0],
        ]),
      ),
    ).toBe('badDistances');
    expect(
      code(() =>
        classicalMds([
          [0, 1],
          [1, 0],
          [2, 2],
        ]),
      ),
    ).toBe('notSquare');
    expect(
      code(() =>
        distanceMatrix(
          [
            [1, 1],
            [1, 2],
          ],
          'correlation',
        ),
      ),
    ).toBe('flatProfile');
  });
});
