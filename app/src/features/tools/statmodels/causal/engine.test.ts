// Causal estimators against values worked out separately. The cases are the within slope of a 3 x 3 panel and
// two-stage least squares with its first-stage F. Then come a 2 x 2 difference-in-differences, a discontinuity
// with exact lines on each side, weights from known scores, and back-door sets of small diagrams found by hand.
import { describe, expect, it } from 'vitest';
import { leastSquares } from '../kit/linalg';
import { StatError } from '../kit/types';
import { adjustmentSets, dSeparated, isBackdoorSet, layers, parseDag } from './dag';
import { didFromMeans, differenceInDifferences, ipw, panel, propensity, regressionDiscontinuity, tsls } from './engine';

const close = (got: number, want: number, tol: number) => expect(Math.abs(got - want)).toBeLessThanOrEqual(tol);
const code = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    return e instanceof StatError ? e.code : 'other';
  }
  return 'none';
};

const px = [1, 2, 3, 2, 3, 4, 5, 6, 7];
const py = [3, 5, 7, 10, 12, 14.5, 20, 22, 24.5];
const entity = ['a', 'a', 'a', 'b', 'b', 'b', 'c', 'c', 'c'];
const period = [1, 2, 3, 1, 2, 3, 1, 2, 3];

describe('fixed effects', () => {
  it('finds the within slope of a 3 x 3 panel', () => {
    const fit = panel(
      py,
      px.map((v) => [v]),
      ['x'],
      entity,
      period,
      'entity',
      false,
      0.95,
    );
    close(fit.coefs[0].coef, 2.16667, 1e-5);
    close(fit.coefs[0].coef, 13 / 6, 1e-9);
    expect(fit.df).toBe(9 - 1 - 3);
  });

  it('matches least squares with entity and period dummies for two-way effects', () => {
    const x1 = [1, 2.5, 3, 2, 3.5, 4.2, 5, 6.1, 7.4];
    const x2 = [0.5, 1.7, 1.1, 2.2, 2.9, 4.1, 5.3, 5.8, 7.4];
    const fit = panel(
      py,
      x1.map((v, i) => [v, x2[i]]),
      ['x', 'x2'],
      entity,
      period,
      'twoway',
      false,
      0.95,
    );
    const dummies = py.map((_, i) => [
      x1[i],
      x2[i],
      1,
      entity[i] === 'b' ? 1 : 0,
      entity[i] === 'c' ? 1 : 0,
      period[i] === 2 ? 1 : 0,
      period[i] === 3 ? 1 : 0,
    ]);
    const lsdv = leastSquares(dummies, py);
    close(fit.coefs[0].coef, lsdv.coef[0], 1e-8);
    close(fit.coefs[1].coef, lsdv.coef[1], 1e-8);
    expect(fit.df).toBe(9 - 2 - 3 - 2);
  });

  it('equals the within slope for first differences over 2 periods', () => {
    const y2 = [3, 5, 10, 13, 20, 21];
    const x2 = [1, 2, 2, 4, 5, 6];
    const e2 = ['a', 'a', 'b', 'b', 'c', 'c'];
    const t2 = [1, 2, 1, 2, 1, 2];
    const fd = panel(
      y2,
      x2.map((v) => [v]),
      ['x'],
      e2,
      t2,
      'firstdiff',
      false,
      0.95,
    );
    const fe = panel(
      y2,
      x2.map((v) => [v]),
      ['x'],
      e2,
      t2,
      'entity',
      false,
      0.95,
    );
    close(fd.coefs[0].coef, fe.coefs[0].coef, 1e-12);
    close(fd.coefs[0].coef, (2 + 6 + 1) / (1 + 4 + 1), 1e-12);
  });
});

describe('two-stage least squares', () => {
  it('finds the slope, intercept, and first-stage F', () => {
    const z = [1, 2, 3, 4, 5, 6, 7, 8];
    const x = [2.1, 2.9, 4.2, 4.8, 6.1, 7.2, 7.9, 9.1];
    const y = [5.0, 6.1, 9.2, 9.9, 12.8, 15.1, 16.0, 18.9];
    const fit = tsls(
      y,
      x.map((v) => [v]),
      z.map(() => [1]),
      z.map((v) => [v]),
      ['(Intercept)', 'x'],
      0.95,
    );
    close(fit.coefs[1].coef, 1.98577, 1e-5);
    close(fit.coefs[0].coef, 0.628826, 1e-5);
    close(fit.firstStage[0].f, 1604.17, 1e-2);
    expect(fit.hausman.df1).toBe(1);
  });
});

describe('difference-in-differences', () => {
  it('works out the 2 x 2 table', () => {
    expect(didFromMeans(12, 18, 11, 14).did).toBe(3);
  });

  it('gives the same effect as the interaction in the regression form', () => {
    const y = [11, 13, 12, 12, 17, 19, 10, 12, 13, 15, 14, 14];
    const treated = [1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0];
    const post = [0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 1, 1];
    const fit = differenceInDifferences(y, treated, post, { treated: 'treated', post: 'post' }, null, 0.95);
    close(fit.means.did, 16 - 12 - (43 / 3 - 35 / 3), 1e-12);
    close(fit.coefs[3].coef, fit.means.did, 1e-10);
  });
});

describe('regression discontinuity', () => {
  it('takes the gap between the local lines at the cutoff', () => {
    const x = [-0.9, -0.5, -0.1, 0.1, 0.5, 0.9, -3, 3];
    const y = [1.1, 1.5, 1.9, 3.1, 3.5, 3.9, 40, -40];
    const rd = regressionDiscontinuity(x, y, 0, 1, 'uniform', 0.95);
    close(rd.left.intercept, 2, 1e-9);
    close(rd.right.intercept, 3, 1e-9);
    close(rd.effect, 1, 1e-9);
    expect(rd.left.n).toBe(3);
    const tri = regressionDiscontinuity(x, y, 0, 1, 'triangular', 0.95);
    close(tri.effect, 1, 1e-9);
  });
});

describe('propensity scores', () => {
  it('weights known scores of one half into a difference in means', () => {
    const w = ipw([3, 5, 1, 2], [1, 1, 0, 0], [0.5, 0.5, 0.5, 0.5]);
    close(w.ate, 2.5, 1e-12);
    close(w.att, 2.5, 1e-12);
  });

  it('reweights controls by e / (1 − e) for the ATT', () => {
    const w = ipw([4, 2, 6], [1, 0, 0], [0.5, 0.2, 0.8]);
    close(w.att, 4 - (2 * 0.25 + 6 * 4) / (0.25 + 4), 1e-12);
  });

  it('estimates scores, matches, and balances', () => {
    const age = [22, 25, 31, 35, 41, 46, 52, 58, 24, 29, 33, 38, 44, 49, 55, 61];
    const t = [0, 0, 0, 1, 0, 1, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1];
    const y = age.map((a, i) => 10 + 0.2 * a + 3 * t[i] + (i % 3) * 0.5);
    const r = propensity(
      y,
      t,
      age.map((a) => [a]),
      ['age'],
      1,
    );
    r.score.forEach((s) => expect(s > 0 && s < 1).toBe(true));
    expect(r.matched + r.dropped).toBe(8);
    expect(Math.abs(r.balance[0].weighted)).toBeLessThan(Math.abs(r.balance[0].raw));
  });
});

describe('causal diagrams', () => {
  const dag = parseDag('Z -> X, Z -> Y, X -> Y, X -> M -> Y, Y -> C');

  it('finds {Z} as the only minimal back-door set and flags the mediator and the descendant', () => {
    const a = adjustmentSets(dag, 'X', 'Y');
    expect(a.minimal).toEqual([['Z']]);
    expect(a.mediators).toEqual(['M']);
    expect(a.treatmentDescendants).toEqual(expect.arrayContaining(['M', 'C']));
    expect(isBackdoorSet(dag, 'X', 'Y', ['Z', 'M'])).toBe(false);
    expect(isBackdoorSet(dag, 'X', 'Y', ['Z', 'C'])).toBe(false);
    expect(isBackdoorSet(dag, 'X', 'Y', [])).toBe(false);
    expect(a.confounders).toEqual(['Z']);
  });

  it('opens a collider only when it or a descendant is conditioned on', () => {
    const v = parseDag('A -> C\nB -> C\nC -> D');
    expect(dSeparated(v, 'A', 'B', [])).toBe(true);
    expect(dSeparated(v, 'A', 'B', ['C'])).toBe(false);
    expect(dSeparated(v, 'A', 'B', ['D'])).toBe(false);
    const chain = parseDag('A -> B -> C');
    expect(dSeparated(chain, 'A', 'C', ['B'])).toBe(true);
    expect(dSeparated(chain, 'A', 'C', [])).toBe(false);
    expect(layers(chain)).toEqual([['A'], ['B'], ['C']]);
  });

  it('needs no adjustment when nothing confounds', () => {
    expect(adjustmentSets(parseDag('X -> Y, W -> Y'), 'X', 'Y').minimal).toEqual([[]]);
  });
});

describe('impossible causal input', () => {
  it('says why an estimate cannot be made', () => {
    expect(
      code(() =>
        panel(
          py,
          px.map((v) => [v]),
          ['x'],
          py.map(() => 'one'),
          null,
          'entity',
          false,
          0.95,
        ),
      ),
    ).toBe('oneEntity');
    expect(
      code(() =>
        panel(
          py,
          px.map((v) => [v]),
          ['x'],
          entity,
          null,
          'twoway',
          false,
          0.95,
        ),
      ),
    ).toBe('needTime');
    expect(
      code(() =>
        tsls(
          [1, 2, 3, 4],
          [
            [1, 2],
            [2, 1],
            [3, 3],
            [4, 5],
          ],
          [[1], [1], [1], [1]],
          [[1], [2], [3], [4]],
          ['a', 'b', 'c'],
          0.95,
        ),
      ),
    ).toBe('fewInstruments');
    expect(
      code(() =>
        differenceInDifferences(
          [1, 2, 3, 4, 5],
          [1, 2, 0, 0, 1],
          [0, 1, 0, 1, 1],
          { treated: 't', post: 'p' },
          null,
          0.95,
        ),
      ),
    ).toBe('notBinary');
    expect(
      code(() =>
        differenceInDifferences(
          [1, 2, 3, 4, 5],
          [1, 1, 1, 1, 1],
          [0, 1, 0, 1, 1],
          { treated: 't', post: 'p' },
          null,
          0.95,
        ),
      ),
    ).toBe('emptyCell');
    expect(code(() => regressionDiscontinuity([-1, 1, 2], [1, 2, 3], 0, 0, 'uniform', 0.95))).toBe('bandwidthPositive');
    expect(code(() => regressionDiscontinuity([-0.5, 0.5, 0.6], [1, 2, 3], 0, 1, 'uniform', 0.95))).toBe(
      'fewNearCutoff',
    );
    expect(code(() => parseDag('A -> B, B -> A'))).toBe('dagCycle');
    expect(code(() => parseDag('A B'))).toBe('dagArrow');
    expect(code(() => parseDag('  '))).toBe('dagEmpty');
    expect(code(() => adjustmentSets(dag(), 'X', 'Q'))).toBe('dagNode');
  });
});

function dag() {
  return parseDag('X -> Y');
}
