// Descriptive statistics: the lane's validation cases (expected values computed independently in the planning
// pass) and the edge cases each documented problem covers.
import { describe, expect, it } from 'vitest';
import { parseNumbers } from '../num/data';
import { KitError } from '../report';
import { grubbs, moments, percentileRank, summaryReport, trimmedMeans } from './engine';
import { categoryReport, classify, groupedStats, parseCategories, parseClasses } from './freq';
import { stemAndLeaf } from './stem';

const close = (actual: number, expected: number, tol: number) => expect(Math.abs(actual - expected)).toBeLessThan(tol);
const code = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof KitError ? error.code : String(error);
  }
  return 'none';
};

describe('descriptive statistics', () => {
  it('mean, s, G1, and G2 of 2, 4, 4, 4, 5, 5, 7, 9', () => {
    const m = moments([2, 4, 4, 4, 5, 5, 7, 9]);
    close(m.mean, 5, 1e-12);
    close(m.sd, 2.13809, 1e-5);
    close(m.g1, 0.818488, 1e-6);
    close(m.g2, 0.940625, 1e-6);
    close(m.ses, 0.7521014330903549, 1e-9);
    close(m.sek, 1.4808804789742462, 1e-9);
  });

  it('Grubbs test at alpha 0.05 flags 12.5', () => {
    const g = grubbs([9.8, 10.1, 10.0, 9.9, 10.2, 10.0, 12.5], 0.05);
    close(g.g, 2.24691, 1e-5);
    close(g.critical, 2.01997, 1e-5);
    expect(g.suspect).toBe(12.5);
    expect(g.outlier).toBe(true);
  });

  it('10% trimmed and winsorized means of 1 to 9 and 100', () => {
    const t = trimmedMeans([1, 2, 3, 4, 5, 6, 7, 8, 9, 100], 0.1);
    close(t.trimmed, 5.5, 1e-9);
    close(t.winsorized, 5.5, 1e-9);
    expect(t.cut).toBe(1);
  });

  it('grouped median of classes 0-10: 5, 10-20: 8, 20-30: 12, 30-40: 5', () => {
    const { stats } = groupedStats(parseClasses('0-10: 5\n10-20: 8\n20-30: 12\n30-40: 5'));
    close(stats.median, 21.6667, 1e-4);
    close(stats.mean, (5 * 5 + 15 * 8 + 25 * 12 + 35 * 5) / 30, 1e-12);
    expect(stats.modalClass.lo).toBe(20);
  });

  it('stem-and-leaf of 12, 15, 21, 22, 22, 37 with tens as stems', () => {
    const stems = stemAndLeaf([12, 15, 21, 22, 22, 37], { leafUnit: 1 });
    expect(stems.lines.join('; ')).toBe('1 | 2 5; 2 | 1 2 2; 3 | 7');
    expect(stemAndLeaf([12, 15, 21, 22, 22, 37]).leafUnit).toBe(1);
  });

  it('split, signed, and back-to-back stems', () => {
    expect(stemAndLeaf([12, 17, 21], { leafUnit: 1, split: true }).lines).toEqual(['1 | 2', '1 | 7', '2 | 1']);
    expect(stemAndLeaf([-12, -3, 4], { leafUnit: 1 }).lines).toEqual(['-1 | 2', '-0 | 3', ' 0 | 4']);
    expect(stemAndLeaf([12, 21], { leafUnit: 1, other: [15, 13] }).lines).toEqual(['5 3 | 1 | 2', '    | 2 | 1']);
  });

  it('percentile ranks count half of the ties', () => {
    expect(percentileRank([2, 4, 4, 4, 5, 5, 7, 9], 4)).toBe(31.25);
  });

  it('classes of equal width and category counts', () => {
    expect(classify([1, 2, 9, 10], 5).map((c) => c.count)).toEqual([2, 1, 1]);
    const report = categoryReport(parseCategories('a, b, a, c, a'));
    expect(report.answer.vars.mode).toBe('a');
    expect(report.tables[0].rows[0]).toEqual(['a', 3, 0.6, 3, 0.6]);
  });

  it('summary report reads the sample and carries the unit', () => {
    const report = summaryReport({ values: parseNumbers('2 4 4 4 5 5 7 9'), unit: 'cm', trim: 0.1, alpha: 0.05 });
    expect(report.answer.vars).toMatchObject({ mean: '5', n: '8', unit: ' cm' });
    expect(report.tables[0].rows.find((r) => JSON.stringify(r[0]) === '{"key":"variance"}')?.[2]).toBe('cm²');
  });

  it('says what is wrong with impossible input', () => {
    expect(code(() => parseNumbers('1, two, 3'))).toBe('notNumber');
    expect(code(() => summaryReport({ values: [3], unit: '', trim: 0, alpha: 0.05 }))).toBe('tooFew');
    expect(code(() => grubbs([1, 1, 1, 1], 0.05))).toBe('constant');
    expect(code(() => grubbs([1, 2, 3], 1.5))).toBe('alphaRange');
    expect(code(() => trimmedMeans([1, 2, 3], 0.5))).toBe('trimRange');
    expect(code(() => parseClasses('0-10 five'))).toBe('classLine');
    expect(code(() => parseClasses('10-0: 3'))).toBe('classOrder');
    expect(code(() => groupedStats(parseClasses('0-10: 0')))).toBe('noCounts');
    expect(code(() => classify([1, 2], 0))).toBe('widthPositive');
    expect(code(() => stemAndLeaf([]))).toBe('empty');
  });
});
