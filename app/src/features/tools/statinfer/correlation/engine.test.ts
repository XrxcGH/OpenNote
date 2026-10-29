// Correlation. Expected values are SciPy results from the planning pass (pearsonr, spearmanr, kendalltau) or
// hand sums; the adjustments are checked against hand-worked p-values.
import { describe, expect, it } from 'vitest';
import { adjust } from '../num/adjust';
import { KitError } from '../report';
import { compareReport, matrixReport, pairReport, partialReport } from './engine';
import { compareDependent, compareIndependent, kendall, partial, pearson, spearman } from './stats';

const close = (actual: number, want: number, tol: number) => expect(Math.abs(actual - want)).toBeLessThanOrEqual(tol);

describe('correlation coefficients', () => {
  it('Pearson on 6 pairs with its t test and Fisher-z interval', () => {
    const p = pearson([43, 21, 25, 42, 57, 59], [99, 65, 79, 75, 87, 81]);
    close(p.r, 0.529809, 1e-6);
    close(p.p, 0.27964, 1e-5);
    close(p.lower, -0.49428, 1e-5);
    close(p.upper, 0.93804, 1e-5);
  });

  it('Spearman with a tie', () => {
    const s = spearman([1, 2, 3, 4, 5, 6, 7, 8], [2, 1, 4, 3, 6, 5, 8, 8]);
    close(s.rho, 0.922172, 1e-6);
    expect(s.exact).toBe(false);
  });

  it('Spearman without ties is exact for small n', () => {
    // Perfect agreement of 5: only 1 order of 120 has D = 0, so the two-sided p is 2/120.
    const s = spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50]);
    expect(s.exact).toBe(true);
    close(s.p, 2 / 120, 1e-12);
  });

  it('Kendall tau-b with ties', () => {
    close(kendall([1, 2, 2, 3, 4, 5], [1, 3, 2, 2, 5, 4]).tau, 0.642857, 1e-6);
  });

  it('Kendall without ties is exact', () => {
    // 4 items in order: 1 order of 24 has no inversions, so two-sided p = 2/24.
    const k = kendall([1, 2, 3, 4], [1, 2, 3, 4]);
    expect(k.exact).toBe(true);
    close(k.p, 2 / 24, 1e-12);
  });

  it('partial correlation from r_xy 0.5, r_xz 0.3, r_yz 0.4', () => {
    close(partial(0.5, 0.3, 0.4, null).partial, 0.434634, 1e-6);
  });
});

describe('comparing correlations', () => {
  it('r1 0.5 (n 50) against r2 0.3 (n 60)', () => {
    const c = compareIndependent(0.5, 50, 0.3, 60);
    close(c.z, 1.217, 1e-3);
    close(c.p, 0.2236, 1e-4);
  });

  it('dependent correlations: equal ones give z = 0, and the sign follows r12 − r13', () => {
    expect(compareDependent(0.4, 0.4, 0.5, 100).z).toBe(0);
    expect(compareDependent(0.6, 0.3, 0.5, 100).z).toBeGreaterThan(0);
    // A closer link between the 2nd and 3rd variables makes the same gap more convincing.
    expect(compareDependent(0.6, 0.3, 0.8, 100).z).toBeGreaterThan(compareDependent(0.6, 0.3, 0.2, 100).z);
  });
});

describe('adjusting p-values', () => {
  const p = [0.01, 0.04, 0.03, 0.005];
  it('Holm, Hochberg, BH, and BY by hand', () => {
    // Sorted 0.005, 0.01, 0.03, 0.04. Holm: 4·0.005, 3·0.01, max(2·0.03, …), max(1·0.04, …).
    expect(adjust(p, 'holm').map((v) => +v.toFixed(10))).toEqual([0.03, 0.06, 0.06, 0.02]);
    expect(adjust(p, 'bonferroni').map((v) => +v.toFixed(10))).toEqual([0.04, 0.16, 0.12, 0.02]);
    // BH: 0.04·4/4, 0.03·4/3, 0.01·4/2, 0.005·4/1, then the running minimum from the top.
    expect(adjust(p, 'bh').map((v) => +v.toFixed(10))).toEqual([0.02, 0.04, 0.04, 0.02]);
    expect(adjust(p, 'hochberg').map((v) => +v.toFixed(10))).toEqual([0.03, 0.04, 0.04, 0.02]);
    const c = 1 + 1 / 2 + 1 / 3 + 1 / 4;
    close(adjust(p, 'by')[0], 0.02 * c, 1e-12);
  });
});

describe('correlation reports', () => {
  it('carry answers, tables, and plots', () => {
    const r = pairReport(
      { name: 'x', values: [1, 2, 3, 4, 5] },
      { name: 'y', values: [2, 1, 4, 3, 5] },
      'two-sided',
      0.95,
    );
    expect(r.answer.vars.r).toBe('0.8');
    expect(r.plots?.length).toBe(1);
    const m = matrixReport(
      [
        { name: 'a', values: [1, 2, 3, 4] },
        { name: 'b', values: [2, 4, 5, 9] },
        { name: 'c', values: [4, 3, 2, 2] },
      ],
      'holm',
    );
    expect(m.answer.vars.count).toBe('3');
    expect(partialReport(0.5, 0.3, 0.4, 50).tables[0].rows.length).toBe(2);
    expect(compareReport({ kind: 'independent', r1: 0.5, n1: 50, r2: 0.3, n2: 60 }).answer.vars.z).toBe('1.217');
  });

  it('say what is wrong with impossible input', () => {
    const code = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        return error instanceof KitError ? error.code : 'other';
      }
      return 'none';
    };
    expect(code(() => pearson([1, 2], [1, 2]))).toBe('tooFew');
    expect(code(() => pearson([1, 2, 3], [1, 2]))).toBe('pairLength');
    expect(code(() => pearson([1, 1, 1], [1, 2, 3]))).toBe('constant');
    expect(code(() => partial(1.2, 0.3, 0.4, null))).toBe('correlationRange');
    expect(code(() => partial(0.9, 0.9, -0.9, null))).toBe('notPositive');
    expect(code(() => compareIndependent(1, 50, 0.3, 60))).toBe('correlationOpen');
    expect(code(() => matrixReport([{ name: 'a', values: [1, 2, 3] }], 'holm'))).toBe('twoColumns');
    // Huge values still give r = 1 for a line.
    close(pearson([1e150, 2e150, 3e150], [1, 2, 3]).r, 1, 1e-12);
  });
});
