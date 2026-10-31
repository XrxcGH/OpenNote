// The ANOVA family. Expected values are SciPy results from the planning pass (f_oneway, tukey_hsd, levene,
// shapiro), and NumPy least-squares and matrix results worked independently of this code (two-way Type II and III,
// Mauchly's W, the mixed design, Games-Howell with SciPy's studentized range).
import { describe, expect, it } from 'vitest';
import { KitError } from '../report';
import { apaP, effectReport, mixedReport, oneWayReport, repeatedReport, twoWayReport } from './engine';
import {
  contrast,
  levene,
  mixed,
  oneWay,
  postHoc,
  repeated,
  shapiroWilk,
  twoGroupEffect,
  twoWay,
  welch,
} from './stats';

const close = (actual: number, want: number, tol: number) => expect(Math.abs(actual - want)).toBeLessThanOrEqual(tol);
const A = [4, 5, 6, 5, 4];
const B = [7, 8, 6, 7, 9];
const C = [5, 6, 5, 7, 6];
const W = [
  [10, 12, 11, 13, 12],
  [20, 25, 15, 30, 22],
  [14, 16, 15, 13, 17],
];

describe('one-way ANOVA and its follow-ups', () => {
  it('one-way on 3 groups of 5', () => {
    const a = oneWay([A, B, C]);
    close(a.f, 9.55556, 1e-5);
    expect([a.dfb, a.dfw]).toEqual([2, 12]);
    close(a.p, 0.003293, 1e-6);
    close(a.eta2, 0.61429, 1e-5);
    close(a.omega2, 0.53287, 1e-5);
  });

  it('Tukey HSD p-values', () => {
    const t = postHoc([A, B, C], 'tukey');
    close(t[0].p, 0.0025853, 1e-4);
    close(t[1].p, 0.25729, 1e-4);
    close(t[2].p, 0.050105, 1e-4);
  });

  it('Welch ANOVA', () => {
    const w = welch(W);
    close(w.f, 13.538, 1e-3);
    close(w.df2, 7.00967, 1e-4);
    close(w.p, 0.003914, 1e-5);
  });

  it('Games-Howell, Levene, Brown-Forsythe, and Shapiro-Wilk', () => {
    const g = postHoc(W, 'gamesHowell');
    [0.024802, 0.013303, 0.083998].forEach((want, i) => close(g[i].p, want, 1e-4));
    close(levene(W, 'mean').f, 4.04304, 1e-5);
    close(levene(W, 'mean').p, 0.045469, 1e-5);
    close(levene(W, 'median').f, 3.53488, 1e-5);
    const residuals = [A, B, C].flatMap((g) => g.map((x) => x - g.reduce((s, v) => s + v, 0) / g.length));
    close(shapiroWilk(residuals).w, 0.937605, 1e-4);
    close(shapiroWilk(residuals).p, 0.353207, 2e-3);
    close(shapiroWilk([2.9, 3.0, 2.5, 2.6, 3.2, 3.8, 2.7, 4.0, 2.4]).w, 0.89557, 1e-4);
    close(shapiroWilk(Array.from({ length: 20 }, (_, i) => (i + 1) ** 1.5)).p, 0.22596, 3e-3);
  });

  it('a planned contrast of B against the mean of A and C', () => {
    const c = contrast([A, B, C], [-0.5, 1, -0.5]);
    close(c.estimate, 2.1, 1e-12);
    close(c.t, 4.04145, 1e-5);
    close(c.p, 0.0016352, 1e-6);
  });
});

describe('factorial designs', () => {
  const cells = (a: string, b: string, ys: number[]) => ys.map((y) => ({ a, b, y }));

  it('two-way 2 × 2 with 3 per cell', () => {
    const t = twoWay(
      [
        ...cells('a1', 'b1', [3, 4, 5]),
        ...cells('a1', 'b2', [6, 7, 8]),
        ...cells('a2', 'b1', [4, 5, 6]),
        ...cells('a2', 'b2', [10, 11, 12]),
      ],
      3,
    );
    close(t.a.f, 18.75, 1e-9);
    close(t.b.f, 60.75, 1e-9);
    close(t.ab.f, 6.75, 1e-9);
    expect(t.error.df).toBe(8);
    expect(t.balanced).toBe(true);
  });

  it('unbalanced two-way: Type II and Type III sums of squares', () => {
    const data = [
      ...cells('a1', 'b1', [3, 4, 5]),
      ...cells('a1', 'b2', [6]),
      ...cells('a2', 'b1', [4, 6]),
      ...cells('a2', 'b2', [10, 11, 12, 14]),
    ];
    const three = twoWay(data, 3);
    close(three.a.ss, 21.87, 1e-9);
    close(three.b.ss, 36.75, 1e-9);
    close(three.ab.ss, 10.83, 1e-9);
    close(three.error.ss, 12.75, 1e-9);
    const two = twoWay(data, 2);
    close(two.a.ss, 16.82, 1e-9);
    close(two.b.ss, 52.92, 1e-9);
  });
});

describe('repeated and mixed designs', () => {
  it('repeated measures on 5 subjects by 3 conditions', () => {
    const r = repeated([
      [8, 7, 5],
      [9, 7, 6],
      [7, 6, 6],
      [8, 8, 5],
      [10, 8, 7],
    ]);
    close(r.f, 18.1429, 1e-4);
    close(r.p, 0.0010649, 1e-6);
    close(r.gg, 0.86344, 1e-5);
    close(r.mauchlyW, 0.841837, 1e-6);
    close(r.mauchlyP, 0.772399, 1e-5);
    expect(r.hf).toBe(1);
  });

  it('a mixed design of 2 groups by 3 conditions', () => {
    const m = mixed([
      [
        [3, 4, 6],
        [2, 4, 5],
        [4, 5, 7],
      ],
      [
        [5, 5, 6],
        [6, 7, 7],
        [4, 6, 6],
      ],
    ]);
    close(m.rows[0].f, 4.114286, 1e-5);
    close(m.rows[2].f, 36.285714, 1e-5);
    close(m.rows[3].f, 6, 1e-9);
  });

  it('Cohen’s d, Hedges’ g, and the exact interval', () => {
    const e = twoGroupEffect([5.1, 4.9, 6.2, 5.8, 6.0, 5.5, 5.3, 6.1], [4.2, 4.8, 4.1, 5.0, 4.6, 4.3, 4.9, 4.4]);
    close(e.d, 2.57105, 1e-4);
    close(e.g, 2.43081, 1e-4);
    close(e.lower, 1.1874, 1e-4);
    close(e.upper, 3.9073, 1e-4);
  });
});

describe('ANOVA reports and impossible input', () => {
  it('reports carry APA sentences', () => {
    const g = (label: string, values: number[]) => ({ label, values });
    const r = oneWayReport([g('A', A), g('B', B), g('C', C)], 'tukey', [-0.5, 1, -0.5], 0.95);
    expect(r.answer.vars.p).toBe('= .003');
    expect(apaP(0.0004)).toBe('< .001');
    expect(
      twoWayReport(
        [
          { a: 'x', b: 'u', y: 1 },
          { a: 'x', b: 'u', y: 2 },
          { a: 'x', b: 'v', y: 3 },
          { a: 'x', b: 'v', y: 5 },
          { a: 'y', b: 'u', y: 2 },
          { a: 'y', b: 'u', y: 3 },
          { a: 'y', b: 'v', y: 7 },
          { a: 'y', b: 'v', y: 8 },
        ],
        3,
      ).answer.key,
    ).toBe('twoway');
    expect(
      repeatedReport(
        [
          [1, 2],
          [2, 4],
          [3, 5],
        ],
        ['pre', 'post'],
      ).tables.length,
    ).toBe(2);
    expect(
      mixedReport([
        [
          [1, 2],
          [2, 4],
        ],
        [
          [3, 3],
          [4, 6],
        ],
      ]).answer.key,
    ).toBe('mixed');
    expect(effectReport(g('x', [1, 2, 3]), g('y', [2, 3, 5]), 0.95).answer.key).toBe('effect');
  });
});

describe('impossible ANOVA input', () => {
  it('says what is wrong', () => {
    const code = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        return error instanceof KitError ? error.code : 'other';
      }
      return 'none';
    };
    expect(code(() => oneWay([A]))).toBe('twoGroups');
    expect(code(() => oneWay([[1], [2]]))).toBe('tooFew');
    expect(
      code(() =>
        oneWay([
          [3, 3],
          [3, 3],
        ]),
      ),
    ).toBe('constant');
    expect(
      code(() =>
        welch([
          [1, 1],
          [2, 3],
        ]),
      ),
    ).toBe('zeroVariance');
    expect(code(() => contrast([A, B, C], [1, 1, 1]))).toBe('contrastSum');
    expect(
      code(() =>
        twoWay(
          [
            { a: 'x', b: 'u', y: 1 },
            { a: 'x', b: 'v', y: 2 },
            { a: 'y', b: 'u', y: 3 },
            { a: 'y', b: 'u', y: 4 },
          ],
          3,
        ),
      ),
    ).toBe('emptyCell');
    expect(
      code(() =>
        mixed([
          [
            [1, 2],
            [2, 3],
          ],
          [[1, 2]],
        ]),
      ),
    ).toBe('mixedBalanced');
    expect(code(() => shapiroWilk([1, 2]))).toBe('shapiroSize');
    // Huge values still give a finite F.
    expect(
      Number.isFinite(
        oneWay([
          [1e8, 1e8 + 1],
          [1e8 + 5, 1e8 + 6],
        ]).f,
      ),
    ).toBe(true);
  });
});
