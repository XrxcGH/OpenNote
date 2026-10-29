// Contingency tables. Expected values come from SciPy (chi2_contingency, fisher_exact, binomtest) worked in the
// planning pass, from hand sums, or from the definitions of the skill scores; none come from this code.
import { describe, expect, it } from 'vitest';
import { KitError } from '../report';
import { associationReport, cochranReport, forecastReport, pairedReport } from './engine';
import {
  chiSquare,
  cochranQ,
  fisher2x2,
  fisherMonteCarlo,
  gTest,
  linearTrend,
  mcNemar,
  measures,
  skillScores,
} from './stats';

const close = (actual: number, want: number, tol: number) => expect(Math.abs(actual - want)).toBeLessThanOrEqual(tol);

const t23 = [
  [10, 20, 30],
  [20, 20, 10],
];

describe('contingency tables', () => {
  it('chi-square of [[10, 20, 30], [20, 20, 10]] with Cramér’s V', () => {
    const c = chiSquare(t23);
    close(c.chi2, 12.5278, 1e-4);
    expect(c.df).toBe(2);
    close(c.p, 0.0019038, 1e-6);
    close(measures(t23, c.chi2).cramerV, 0.33747, 1e-5);
  });

  it('G test of the same table', () => {
    const g = gTest(t23);
    close(g.chi2, 12.9526, 1e-4);
    close(g.p, 0.0015395, 1e-6);
  });

  it('Yates-corrected chi-square of [[12, 5], [7, 15]]', () => {
    const c = chiSquare(
      [
        [12, 5],
        [7, 15],
      ],
      true,
    );
    close(c.chi2, 4.32212, 1e-5);
    close(c.p, 0.03762, 1e-5);
  });

  it('Fisher’s exact test on the tea-tasting table [[3, 1], [1, 3]]', () => {
    const f = fisher2x2([
      [3, 1],
      [1, 3],
    ]);
    // By hand: (1 + 16 + 16 + 1)/70 = 34/70.
    close(f.p, 34 / 70, 1e-9);
    close(f.p, 0.485714, 1e-6);
    expect(f.terms.map((t) => t.a)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('paired and forecast tables', () => {
  it('McNemar with b = 10 and c = 3', () => {
    const m = mcNemar([
      [5, 10],
      [3, 7],
    ]);
    close(m.corrected, 2.76923, 1e-5);
    close(m.pCorrected, 0.096092, 1e-5);
    // By hand: 2 × (1 + 13 + 78 + 286)/2^13.
    close(m.pExact, (2 * 378) / 8192, 1e-9);
    close(m.pExact, 0.0922852, 1e-6);
  });

  it('forecast skill from hits 50, false alarms 20, misses 10, correct negatives 920', () => {
    const s = skillScores(50, 20, 10, 920);
    close(s.pod, 0.83333, 1e-5);
    close(s.far, 0.28571, 1e-5);
    close(s.csi, 0.625, 1e-9);
    close(s.hss, 0.75329, 1e-5);
    close(s.pss, 0.81206, 1e-5);
  });

  it('Cochran’s Q of 3 conditions by hand', () => {
    // Columns 4, 2, 1 (T = 7), rows 3, 2, 1, 1: Q = 2(3·21 − 49)/(21 − 15) = 28/6.
    const q = cochranQ([
      [1, 1, 1],
      [1, 1, 0],
      [1, 0, 0],
      [1, 0, 0],
    ]);
    close(q.q, 28 / 6, 1e-12);
    expect(q.df).toBe(2);
  });
});

describe('measures, trend, and simulation', () => {
  it('measures and trend of a 2 × 2 table by hand', () => {
    const t = [
      [12, 5],
      [7, 15],
    ];
    const m = measures(t, chiSquare(t).chi2);
    // φ = (12·15 − 5·7)/√(17·22·19·20).
    close(m.phi, 145 / Math.sqrt(17 * 22 * 19 * 20), 1e-12);
    // γ = (180 − 35)/(180 + 35) for a 2 × 2 table (Yule's Q).
    close(m.gamma, 145 / 215, 1e-12);
    // M² = (N − 1) φ² for a 2 × 2 table.
    close(linearTrend(t).m2, 38 * m.phi ** 2, 1e-9);
  });

  it('Monte Carlo Fisher test is reproducible and agrees with the exact 2 × 2 p', () => {
    const t = [
      [3, 1],
      [1, 3],
    ];
    const a = fisherMonteCarlo(t, 42n, 20_000);
    const b = fisherMonteCarlo(t, 42n, 20_000);
    expect(a.p).toBe(b.p);
    close(a.p, 34 / 70, 4 * a.se + 1e-3);
  });

  it('reports carry the answer, the tables, and the steps', () => {
    const r = associationReport({ table: t23, rows: ['A', 'B'], cols: ['x', 'y', 'z'], seed: 1n, draws: 2000 });
    expect(r.answer.vars.df).toBe('2');
    expect(r.tables.map((t) => t.title)).toEqual(['observedExpected', 'tests', 'measures', 'residuals']);
    expect(r.steps.length).toBeGreaterThan(4);
    expect(
      pairedReport({
        table: [
          [5, 10],
          [3, 7],
        ],
        rows: [],
        cols: [],
      }).answer.key,
    ).toBe('mcnemar');
    expect(
      cochranReport(
        [
          [1, 0],
          [1, 1],
          [0, 0],
          [1, 0],
        ],
        ['a', 'b'],
      ).answer.key,
    ).toBe('cochran');
    expect(
      forecastReport([
        [50, 20],
        [10, 920],
      ]).answer.vars.hss,
    ).toBe('0.7533');
  });
});

describe('impossible tables', () => {
  it('says what is wrong with impossible tables', () => {
    const code = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        return error instanceof KitError ? error.code : 'other';
      }
      return 'none';
    };
    expect(code(() => chiSquare([[1, 2]]))).toBe('tableSize');
    expect(
      code(() =>
        chiSquare([
          [1, -2],
          [3, 4],
        ]),
      ),
    ).toBe('negativeCount');
    expect(
      code(() =>
        chiSquare([
          [1, 2.5],
          [3, 4],
        ]),
      ),
    ).toBe('wholeCount');
    expect(
      code(() =>
        chiSquare([
          [0, 0],
          [3, 4],
        ]),
      ),
    ).toBe('emptyLine');
    expect(
      code(() =>
        mcNemar([
          [5, 0],
          [0, 7],
        ]),
      ),
    ).toBe('noDiscordant');
    expect(
      code(() =>
        cochranQ([
          [1, 2],
          [0, 1],
        ]),
      ),
    ).toBe('binaryOnly');
    expect(
      code(() =>
        cochranQ([
          [1, 1],
          [0, 0],
        ]),
      ),
    ).toBe('cochranConstant');
    expect(code(() => skillScores(0, 3, 0, 4))).toBe('forecastObserved');
    expect(code(() => fisher2x2(t23))).toBe('needs2x2');
    expect(
      code(() =>
        fisherMonteCarlo(
          [
            [1e6, 1],
            [1, 1e6],
          ],
          1n,
          10_000,
        ),
      ),
    ).toBe('tooMuchWork');
    // A huge table still gives finite statistics.
    expect(
      Number.isFinite(
        chiSquare([
          [1e7, 2e7],
          [3e7, 1e7],
        ]).chi2,
      ),
    ).toBe(true);
  });
});
