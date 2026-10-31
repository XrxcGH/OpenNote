// Rank-based tests. Expected values are SciPy results from the planning pass (wilcoxon, mannwhitneyu, kruskal,
// friedmanchisquare) or hand counts of the exact null distributions.
import { describe, expect, it } from 'vitest';
import { KitError } from '../report';
import { blocksReport, groupsReport, pairedReport, twoSampleReport } from './engine';
import { friedman, hodgesLehmann, kolmogorovSmirnov, kruskalWallis, mannWhitney, signedRank, signTest } from './stats';

const close = (actual: number, want: number, tol: number) => expect(Math.abs(actual - want)).toBeLessThanOrEqual(tol);

describe('two samples and pairs', () => {
  it('exact Wilcoxon signed-rank on 9 pairs', () => {
    const x = [1.83, 0.5, 1.62, 2.48, 1.68, 1.88, 1.55, 3.06, 1.3];
    const y = [0.878, 0.647, 0.598, 2.05, 1.06, 1.29, 1.06, 3.14, 1.29];
    const w = signedRank(x.map((v, i) => v - y[i]));
    expect(Math.min(w.wPlus, w.wMinus)).toBe(5);
    expect(w.exact).toBe(true);
    // By hand: 10 of the 512 sign patterns have W⁻ ≤ 5, doubled.
    close(w.p, 20 / 512, 1e-12);
  });

  it('exact signed-rank after dropping zeros', () => {
    const w = signedRank([1.5, 0, 2, -1, 0, 3, 2.5, -0.5]);
    expect(w.n).toBe(6);
    expect(w.wMinus).toBe(3);
    expect(w.exact).toBe(true);
    // By hand: 5 of the 64 sign patterns on ranks 1..6 have W⁻ ≤ 3, doubled (SciPy gives 0.15625).
    close(w.p, 10 / 64, 1e-12);
    expect(signedRank([1.5, 0, 2, -1, 0, 3, 2.5, -0.5], 'pratt').exact).toBe(false);
  });

  it('Mann-Whitney with ties by the normal form with continuity', () => {
    const a = [3.1, 2.2, 4.5, 2.2, 5.0, 3.8, 4.1, 2.9, 3.3, 4.7, 3.6, 2.8];
    const b = [5.6, 4.8, 6.0, 4.8, 5.9, 6.4, 5.1, 4.4, 5.5, 6.2];
    const u = mannWhitney(a, b);
    expect(u.u1).toBe(5);
    expect(u.exact).toBe(false);
    close(u.p, 0.00032358, 1e-5);
  });

  it('exact Mann-Whitney without ties', () => {
    // 3 against 3, completely separated: 1 arrangement of C(6, 3) = 20 at each end.
    const u = mannWhitney([1, 2, 3], [4, 5, 6]);
    expect(u.u1).toBe(0);
    close(u.p, 2 / 20, 1e-12);
    close(u.rankBiserial, -1, 1e-12);
  });

  it('Hodges-Lehmann shift of 7, 9, 11, 12 against 3, 5, 6, 8, 10', () => {
    expect(hodgesLehmann([7, 9, 11, 12], [3, 5, 6, 8, 10]).shift).toBe(3.5);
  });

  it('sign test with 2 positive of 10', () => {
    close(signTest(2, 10), 0.109375, 1e-12);
  });

  it('Kolmogorov-Smirnov: separated samples give D = 1 and the exact p', () => {
    const k = kolmogorovSmirnov([1, 2, 3], [4, 5, 6]);
    expect(k.d).toBe(1);
    expect(k.exact).toBe(true);
    close(k.p, 2 / 20, 1e-12);
  });
});

describe('several groups and blocks', () => {
  it('Kruskal-Wallis on 3 groups', () => {
    const kw = kruskalWallis([
      [2.9, 3.0, 2.5, 2.6, 3.2],
      [3.8, 2.7, 4.0, 2.4],
      [2.8, 3.4, 3.7, 2.2, 2.0],
    ]);
    close(kw.h, 0.771429, 1e-6);
    close(kw.p, 0.67996, 1e-5);
    expect(kw.dunn.length).toBe(3);
  });

  it('Friedman on 5 blocks of 3 treatments with ties', () => {
    const treatments = [
      [8, 9, 7, 8, 10],
      [7, 7, 6, 8, 8],
      [5, 6, 6, 5, 7],
    ];
    const blocks = treatments[0].map((_, b) => treatments.map((t) => t[b]));
    const f = friedman(blocks);
    close(f.chi2, 9, 1e-9);
    close(f.p, 0.011109, 1e-6);
    // Rank sums by hand: 14.5, 10, 5.5.
    expect(f.sums).toEqual([14.5, 10, 5.5]);
    expect(f.nemenyi.every((r) => r.p >= 0 && r.p <= 1)).toBe(true);
  });

  it('reports carry answers and tables', () => {
    const g = (label: string, values: number[]) => ({ label, values });
    expect(twoSampleReport(g('a', [1, 2, 3]), g('b', [4, 5, 6]), 'two-sided', 0.95).answer.vars.u).toBe('0');
    expect(pairedReport([1, 2, -3, 4], 'wilcox', 'two-sided').tables.length).toBe(2);
    expect(groupsReport([g('a', [1, 2]), g('b', [3, 4]), g('c', [5, 6])], 'holm').answer.vars.df).toBe('2');
    expect(
      blocksReport(
        [
          [1, 2, 3],
          [1, 3, 2],
        ],
        ['x', 'y', 'z'],
        'holm',
      ).answer.key,
    ).toBe('friedman');
  });

  it('says what is wrong with impossible input', () => {
    const code = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        return error instanceof KitError ? error.code : 'other';
      }
      return 'none';
    };
    expect(code(() => mannWhitney([], [1]))).toBe('tooFew');
    expect(code(() => signedRank([0, 0]))).toBe('allZero');
    expect(code(() => mannWhitney([1, 1, 1, 1], Array(61).fill(1)))).toBe('allTied');
    expect(code(() => kruskalWallis([[1, 2]]))).toBe('twoGroups');
    expect(code(() => friedman([[1, 2], [1]]))).toBe('ragged');
    expect(code(() => signTest(5, 3))).toBe('signCounts');
    expect(code(() => hodgesLehmann([1], [2], 2))).toBe('confidenceRange');
    // Huge values rank like small ones.
    expect(mannWhitney([1e300, 2e300], [3e300, 4e300]).u1).toBe(0);
  });
});
