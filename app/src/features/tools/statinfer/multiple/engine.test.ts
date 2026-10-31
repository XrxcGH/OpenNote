// Multiple testing and meta-analysis. Expected values are SciPy and NumPy results from the planning pass, hand
// sums, or (for REML) a brute-force search of the restricted likelihood written out here.
import { describe, expect, it } from 'vitest';
import { adjust } from '../num/adjust';
import { KitError } from '../report';
import { adjustReport, combineReport, criticalTable, manhattanReport, metaReport, volcanoReport } from './engine';
import { combine, egger, hedgesG, hommel, logRatio, metaAnalysis } from './stats';

const close = (actual: number, want: number, tol: number) => expect(Math.abs(actual - want)).toBeLessThanOrEqual(tol);
const studies = [0.1, 0.6, 0.3, 0.9].map((y, i) => ({ label: `S${i + 1}`, y, v: [0.02, 0.03, 0.04, 0.05][i] }));

describe('adjusting and combining p-values', () => {
  it('Holm and BH on 0.01, 0.04, 0.03, 0.005', () => {
    const p = [0.01, 0.04, 0.03, 0.005];
    adjust(p, 'holm').forEach((v, i) => close(v, [0.03, 0.06, 0.06, 0.02][i], 1e-9));
    adjust(p, 'bh').forEach((v, i) => close(v, [0.02, 0.04, 0.04, 0.02][i], 1e-9));
  });

  it('Hommel equals Hochberg for 2 tests and is never above it', () => {
    expect(hommel([0.02, 0.04])).toEqual(adjust([0.02, 0.04], 'hochberg'));
    const p = [0.01, 0.04, 0.03, 0.005, 0.2, 0.011];
    const h = hommel(p);
    const hochberg = adjust(p, 'hochberg');
    h.forEach((v, i) => expect(v).toBeLessThanOrEqual(hochberg[i] + 1e-12));
    h.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(p[i]));
  });

  it('Fisher and Stouffer combining 0.08, 0.12, 0.04', () => {
    const c = combine([0.08, 0.12, 0.04]);
    close(c.fisher, 15.7297, 1e-4);
    expect(c.fisherDf).toBe(6);
    close(c.fisherP, 0.01528, 1e-5);
    close(c.stouffer, 2.5004, 1e-4);
    close(c.stoufferP, 0.0062034, 1e-6);
  });
});

describe('meta-analysis', () => {
  it('DerSimonian-Laird on 4 studies', () => {
    const m = metaAnalysis(studies, 'dl');
    close(m.fixed.estimate, 0.393506, 1e-5);
    close(m.q, 11.078, 1e-3);
    close(m.tau2, 0.087606, 1e-5);
    close(m.random.estimate, 0.453573, 1e-5);
    close(m.random.se, 0.17434, 1e-5);
    close(m.i2, 0.7292, 1e-4);
  });

  it('REML matches a brute-force maximum of the restricted likelihood', () => {
    const restricted = (t: number) => {
      const w = studies.map((s) => 1 / (s.v + t));
      const sw = w.reduce((a, b) => a + b, 0);
      const mu = studies.reduce((a, s, i) => a + w[i] * s.y, 0) / sw;
      return -0.5 * (studies.reduce((a, s, i) => a + Math.log(s.v + t) + w[i] * (s.y - mu) ** 2, 0) + Math.log(sw));
    };
    let best = 0;
    for (let t = 0; t <= 1; t += 1e-6) if (restricted(t) > restricted(best)) best = t;
    close(metaAnalysis(studies, 'reml').tau2, best, 2e-6);
  });

  it('Egger, effect sizes, and their edge cases by hand', () => {
    // A symmetric funnel: the same estimate everywhere gives an intercept of 0.
    close(egger(studies.map((s) => ({ ...s, y: 0.4 }))).intercept, 0, 1e-12);
    // log OR of [[10, 20], [5, 40]] = ln 4; variance 1/10 + 1/20 + 1/5 + 1/40.
    const lo = logRatio('or', 10, 20, 5, 40);
    close(lo.y, Math.log(4), 1e-12);
    close(lo.v, 0.375, 1e-12);
    // Hedges' g with equal SDs of 1 and n of 10: d = 1, J = 1 − 3/71.
    close(hedgesG(1, 1, 10, 0, 1, 10).y, 1 - 3 / 71, 1e-12);
  });
});

describe('plots and printed tables', () => {
  it('a printed t table: df 10, two-sided 0.05', () => {
    const r = criticalTable('t', 0.05, 1);
    expect(r.answer.vars.t).toBe('2.22814');
    const row10 = r.tables[0].rows[9];
    close(row10[3] as number, 2.22814, 1e-5);
  });

  it('reports carry answers, tables, and plots', () => {
    const a = adjustReport(
      [0.01, 0.04, 0.03, 0.005].map((p, i) => ({ label: `t${i}`, p })),
      'holm',
      0.05,
    );
    expect(a.answer.vars.count).toBe('2');
    expect(combineReport([0.08, 0.12, 0.04]).answer.vars.df).toBe('6');
    expect(metaReport(studies, 'dl', 'plain', 0.95).plots?.length).toBe(2);
    const v = volcanoReport(
      [
        { label: 'a', fold: 3, p: 1e-6 },
        { label: 'b', fold: -0.1, p: 0.6 },
      ],
      0.05,
      1,
    );
    expect(v.answer.vars.count).toBe('1');
    expect(
      manhattanReport(
        [
          { chromosome: '1', position: 100, p: 1e-9 },
          { chromosome: '2', position: 50, p: 0.3 },
        ],
        5e-8,
      ).answer.vars.count,
    ).toBe('1');
    expect(criticalTable('f', 0.05, 1).tables[0].rows.length).toBe(18);
    expect(criticalTable('chi2', 0.05, 3).answer.vars.x).toBe('7.81473');
    expect(criticalTable('normal', 0.05, 1).answer.vars.z).toBe('1.95996');
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
    expect(code(() => adjustReport([{ label: 'a', p: 1.2 }], 'holm', 0.05))).toBe('pRange');
    expect(code(() => adjustReport([], 'holm', 0.05))).toBe('empty');
    expect(code(() => combine([0, 0.5]))).toBe('pOpen');
    expect(code(() => metaAnalysis([studies[0]]))).toBe('fewStudies');
    expect(code(() => metaAnalysis([studies[0], { label: 'x', y: 1, v: 0 }]))).toBe('variancePositive');
    expect(code(() => egger(studies.slice(0, 2)))).toBe('eggerFew');
    expect(code(() => hedgesG(1, 0, 10, 0, 1, 10))).toBe('summaryRange');
    // Huge p-value lists still adjust.
    expect(adjust(new Array(10_000).fill(0.5), 'bh').every((v) => v === 0.5)).toBe(true);
  });
});
