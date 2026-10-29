// Linear regression against values worked out independently, with NumPy and SciPy from first principles. The
// cases cover the fit, classical, robust and clustered errors, Cook's distance, VIF, and intervals for a new case.
// They also cover the F tests, the diagnostics, moderation, the Sobel test, the random intercept, and formulas.
import { describe, expect, it } from 'vitest';
import { parseTable } from '../kit/data';
import { buildDesign, designRow } from '../kit/design';
import { StatError } from '../kit/types';
import { anova } from './fitview';
import { parseFormula } from './formula';
import { fitMixed } from './mixed';
import { diagnostics, fitOls, nestedF, predictAt } from './ols';
import { mediation, moderation, sobel } from './paths';

const close = (got: number, want: number, tol: number) => expect(Math.abs(got - want)).toBeLessThanOrEqual(tol);

const x1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const x2 = [2, 1, 4, 3, 6, 5, 8, 7, 10, 9];
const y = [3.1, 3.9, 6.8, 7.2, 10.1, 10.8, 13.9, 14.2, 17.1, 17.8];
const X = x1.map((v, i) => [1, v, x2[i]]);
const names = ['(Intercept)', 'x1', 'x2'];

describe('least squares with 2 predictors', () => {
  const fit = fitOls(X, y, names);

  it('fits the coefficients, standard errors and R²', () => {
    [0.87875, 1.16375, 0.58375].forEach((b, j) => close(fit.coef[j], b, 1e-5));
    [0.085689, 0.039796, 0.039796].forEach((s, j) => close(fit.se[j], s, 1e-5));
    close(fit.r2, 0.999562, 1e-5);
    close(fit.adjR2, 0.999436, 1e-5);
    close(fit.f, 7981.351162790696, 1e-6);
    close(fit.aic, -8.949724579991194, 1e-9);
    close(fit.bic, -7.739384208015011, 1e-9);
  });

  it('gives HC3, HC0, HC2 and cluster-robust standard errors', () => {
    const hc3 = fitOls(X, y, names, { robust: 'hc3' }).se;
    [0.11014, 0.045192, 0.050496].forEach((s, j) => close(hc3[j], s, 1e-5));
    const hc0 = fitOls(X, y, names, { robust: 'hc0' }).se;
    [0.06903883, 0.03135657, 0.03504617].forEach((s, j) => close(hc0[j], s, 1e-8));
    const hc2 = fitOls(X, y, names, { robust: 'hc2' }).se;
    [0.08702143, 0.03752194, 0.04193522].forEach((s, j) => close(hc2[j], s, 1e-8));
    const cluster = ['a', 'a', 'b', 'b', 'c', 'c', 'd', 'd', 'e', 'e'];
    const cr1 = fitOls(X, y, names, { robust: 'cluster', cluster }).se;
    [0.01809156, 0.05322066, 0.05679955].forEach((s, j) => close(cr1[j], s, 1e-8));
  });

  it("finds the largest Cook's distance, the VIF, and the other diagnostics", () => {
    const d = diagnostics(X, fit);
    const largest = d.cook.reduce((best, c, i) => (c > d.cook[best] ? i : best), 0);
    expect(largest + 1).toBe(7);
    close(d.cook[largest], 0.40541, 1e-5);
    close(d.vif[1], 8.50781, 1e-5);
    close(d.vif[2], 8.50781, 1e-5);
    close(d.durbinWatson, 2.0734883720929504, 1e-10);
    close(d.breuschPagan, 2.449465355913898, 1e-9);
  });

  it('tests a nested model and splits the sums of squares in order', () => {
    const reduced = fitOls(
      X.map((r) => r.slice(0, 2)),
      y,
      names.slice(0, 2),
    );
    const test = nestedF(fit, reduced);
    close(test.f, 215.16885130373478, 1e-7);
    close(test.p, 1.635976632550474e-6, 1e-12);
    const table = parseTable(['x1,x2,y', ...y.map((v, i) => `${x1[i]},${x2[i]},${v}`)].join('\n'));
    const design = buildDesign(table, parseFormula('y ~ x1 + x2', table.names).terms);
    const rows = anova(design, y, fit);
    close(Number(rows[0][2]), 241.83712121212125, 1e-9);
    close(Number(rows[1][2]), 3.304378787878785, 1e-9);
  });
});

describe('intervals for a new case', () => {
  it('gives the confidence and prediction half-widths', () => {
    const xs = [1, 2, 3, 4, 5];
    const fit = fitOls(
      xs.map((v) => [1, v]),
      [2.2, 2.8, 4.5, 3.7, 5.5],
      ['(Intercept)', 'x'],
    );
    const p = predictAt(fit, [1, 6]);
    close(p.value, 5.99, 1e-9);
    close(p.high - p.value, 2.2031, 1e-4);
    close(p.predHigh - p.value, 3.044, 1e-3);
  });
});

describe('moderation and mediation', () => {
  it('runs the Sobel test', () => {
    const s = sobel(0.5, 0.1, 0.4, 0.12);
    close(s.indirect, 0.2, 1e-12);
    close(s.z, 2.7735, 1e-4);
  });

  it('finds the Johnson-Neyman values of the moderator', () => {
    const m = [1, 2, 3, 4, 5, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1, 2, 3, 4, 5, 1];
    const x = [2, 3, 5, 2, 6, 6, 1, 4, 3, 5, 4, 3, 6, 1, 1, 2, 6, 5, 5, 3];
    const w = [5.1, 5.0, 4.2, 6.3, 4.9, 3.1, 6.0, 5.6, 6.8, 2.9, 3.9, 5.2, 4.8, 7.7, 4.8, 5.1, 3.6, 5.1, 6.0, 3.9];
    const r = moderation(w, x, m, [], [], [3], 0.95);
    close(r.fit.coef[3], 0.01788739, 1e-7);
    close(r.jn[0], -11.40914538, 1e-6);
    close(r.jn[1], 10.20494226, 1e-6);
    expect(r.jnInside).toBe(true);
  });

  it('gives the same bootstrap interval for the same seed', () => {
    const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const m = [2.1, 2.8, 3.0, 3.9, 4.1, 4.8, 5.2, 5.9, 6.1, 7.0];
    const out = [52, 55, 61, 60, 66, 70, 69, 75, 78, 80];
    const a = mediation(x, m, out, [], 300, 7, 0.95);
    const b = mediation(x, m, out, [], 300, 7, 0.95);
    expect([a.bootLow, a.bootHigh]).toEqual([b.bootLow, b.bootHigh]);
    expect(a.bootLow).toBeLessThan(a.bootHigh);
    close(a.c, a.cPrime + a.a * a.b, 1e-9);
  });
});

describe('the random-intercept model', () => {
  it('matches the ANOVA estimators for balanced groups', () => {
    const yy = [10, 12, 11, 13, 15, 14, 16, 17, 9, 8, 10, 11, 13, 15, 14, 12];
    const g = yy.map((_, i) => 'abcd'[Math.floor(i / 4)]);
    const fit = fitMixed(
      yy.map(() => [1]),
      yy,
      g,
    );
    close(fit.sigma2, 1.6666666666666667, 1e-6);
    close(fit.tau2, 6.25, 1e-5);
    close(fit.icc, 0.7894736842105263, 1e-6);
    close(fit.se[0], 1.2909944487358056, 1e-6);
  });
});

describe('model formulas', () => {
  const cols = ['y', 'x', 'z', 'g', 'my col'];

  it('expands stars, powers, logs and backticks, and drops the intercept', () => {
    const f = parseFormula('y ~ x*g + x^2 + log(z) + `my col` - 1', cols);
    expect(f.intercept).toBe(false);
    const labels = f.terms.map((t) =>
      t.factors.map((x) => x.name + (x.power ? `^${x.power}` : '') + (x.log ? '(log)' : '')).join(':'),
    );
    expect(labels).toEqual(['x', 'g', 'x:g', 'x^2', 'z(log)', 'my col']);
  });

  it('names what it could not read', () => {
    expect(() => parseFormula('y ~ w', cols)).toThrow(StatError);
    expect(() => parseFormula('y x', cols)).toThrow(StatError);
    expect(() => parseFormula('y ~ y', cols)).toThrow(StatError);
    expect(() => parseFormula('y ~ x^1.5', cols)).toThrow(StatError);
  });
});

describe('impossible regression input', () => {
  const code = (f: () => unknown): string => {
    try {
      f();
    } catch (e) {
      return e instanceof StatError ? e.code : 'other';
    }
    return 'none';
  };

  it('says why a model cannot be fitted or compared', () => {
    const fit = fitOls(X, y, names);
    expect(code(() => nestedF(fit, fit))).toBe('notNested');
    expect(
      code(() =>
        fitMixed(
          y.map(() => [1]),
          y,
          y.map(() => 'one'),
        ),
      ),
    ).toBe('mixedGroups');
    expect(code(() => fitOls(X, y, names, { robust: 'cluster', cluster: y.map(() => 'one') }))).toBe('oneCluster');
    expect(
      code(() =>
        fitOls(
          X.map((r) => [...r, r[1] * 2]),
          y,
          [...names, 'twice'],
        ),
      ),
    ).toBe('collinear');
    expect(code(() => fitOls(X.slice(0, 3), y.slice(0, 3), names))).toBe('tooFewRows');
  });

  it('says what is wrong with a new case', () => {
    const table = parseTable(['g,x,y', 'a,1,2', 'b,2,3', 'a,3,5', 'b,4,4', 'a,5,7'].join('\n'));
    const formula = parseFormula('y ~ x + g', table.names);
    const design = buildDesign(table, formula.terms);
    const opts = { coding: 'reference', center: false, intercept: true } as const;
    expect(code(() => designRow(table, design, formula.terms, new Map([['x', '2']]), opts))).toBe('caseMissing');
    expect(
      code(() =>
        designRow(
          table,
          design,
          formula.terms,
          new Map([
            ['x', '2'],
            ['g', 'c'],
          ]),
          opts,
        ),
      ),
    ).toBe('caseLevel');
    expect(
      designRow(
        table,
        design,
        formula.terms,
        new Map([
          ['x', '2'],
          ['g', 'b'],
        ]),
        opts,
      ),
    ).toEqual([1, 2, 1]);
  });
});
