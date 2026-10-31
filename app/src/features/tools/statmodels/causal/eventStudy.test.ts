// Event-study coefficients against values worked out separately: by hand from the group means of a balanced
// 4 x 4 panel, and by least squares with a dummy column for every entity and period (the LSDV form), which must
// give the same coefficients and classical standard errors as the within transformation.
import { describe, expect, it } from 'vitest';
import { leastSquares } from '../kit/linalg';
import { StatError } from '../kit/types';
import { eventStudy } from './eventStudy';

const close = (got: number, want: number, tol: number) => expect(Math.abs(got - want)).toBeLessThanOrEqual(tol);
const code = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    return e instanceof StatError ? e.code : 'other';
  }
  return 'none';
};

// A and B are treated from period 3; C and D never are.
const ent = ['A', 'A', 'A', 'A', 'B', 'B', 'B', 'B', 'C', 'C', 'C', 'C', 'D', 'D', 'D', 'D'];
const per = [1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4];
const tr = [1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0];
const ys = [10, 11, 15, 16, 12, 14, 17, 19, 9, 10, 11, 12, 11, 12, 12, 14];

/** Least squares with an intercept, entity and period dummies (first of each left out) and the event dummies. */
function lsdv(y: number[], e: string[], t: number[], d: number[], shown: number[]) {
  const es = [...new Set(e)].slice(1);
  const ts = [...new Set(t)].sort((a, b) => a - b).slice(1);
  const x = y.map((_, i) => [
    1,
    ...es.map((g) => (e[i] === g ? 1 : 0)),
    ...ts.map((p) => (t[i] === p ? 1 : 0)),
    ...shown.map((p) => (t[i] === p ? d[i] : 0)),
  ]);
  const ls = leastSquares(x, y);
  const k = x[0].length;
  const s2 = ls.rss / (y.length - k);
  const at = k - shown.length;
  return shown.map((_, j) => ({ coef: ls.coef[at + j], se: Math.sqrt(s2 * ls.xtxInv[at + j][at + j]) }));
}

describe('event study', () => {
  it('equals each gap minus the reference gap in a balanced panel', () => {
    // Treated means 11, 12.5, 16, 17.5; control means 10, 11, 11.5, 13; gaps 1, 1.5, 4.5, 4.5.
    const fit = eventStudy(ys, ent, per, tr, 3, true, 0.95);
    expect(fit.reference).toBe(2);
    expect(fit.balanced).toBe(true);
    expect(fit.coefs.map((c) => c.k)).toEqual([-2, 0, 1]);
    close(fit.coefs[0].coef, -0.5, 1e-9);
    close(fit.coefs[1].coef, 3, 1e-9);
    close(fit.coefs[2].coef, 3, 1e-9);
    expect(fit.gaps.map((g) => g.gap)).toEqual([1, 1.5, 4.5, 4.5]);
    expect(fit.df).toBe(16 - 3 - (4 + 3));
  });

  it('matches the dummy-variable regression, classical errors included', () => {
    const fit = eventStudy(ys, ent, per, tr, 3, false, 0.95);
    const want = lsdv(ys, ent, per, tr, [1, 3, 4]);
    fit.coefs.forEach((c, j) => {
      close(c.coef, want[j].coef, 1e-8);
      close(c.se, want[j].se, 1e-8);
    });
  });

  it('matches the dummy-variable regression on an unbalanced panel', () => {
    const drop = 6; // B in period 3
    const keep = (v: readonly (number | string)[]) => v.filter((_, i) => i !== drop);
    const [y, e, t, d] = [keep(ys) as number[], keep(ent) as string[], keep(per) as number[], keep(tr) as number[]];
    const fit = eventStudy(y, e, t, d, 3, false, 0.95);
    expect(fit.balanced).toBe(false);
    const want = lsdv(y, e, t, d, [1, 3, 4]);
    fit.coefs.forEach((c, j) => close(c.coef, want[j].coef, 1e-8));
  });

  it('gives 0 everywhere when the outcome is entity plus period effects only', () => {
    const y = ent.map((e, i) => 'ABCD'.indexOf(e) * 5 + per[i] ** 2);
    const fit = eventStudy(y, ent, per, tr, 3, true, 0.95);
    fit.coefs.forEach((c) => close(c.coef, 0, 1e-9));
  });

  it('handles a huge outcome scale', () => {
    const fit = eventStudy(
      ys.map((v) => v * 1e9),
      ent,
      per,
      tr,
      3,
      true,
      0.95,
    );
    close(fit.coefs[1].coef / 1e9, 3, 1e-6);
  });

  it('stops with a clear reason on impossible input', () => {
    expect(code(() => eventStudy(ys, ent, per, tr, 1, true, 0.95))).toBe('adoptionPeriod');
    expect(code(() => eventStudy(ys, ent, per, tr, 7, true, 0.95))).toBe('adoptionPeriod');
    const moved = tr.map((v, i) => (i === 0 ? 0 : v));
    expect(code(() => eventStudy(ys, ent, per, moved, 3, true, 0.95))).toBe('treatedVaries');
    expect(
      code(() =>
        eventStudy(
          ys,
          ent,
          per,
          tr.map(() => 1),
          3,
          true,
          0.95,
        ),
      ),
    ).toBe('eventGroups');
    expect(
      code(() =>
        eventStudy(
          ys,
          ent,
          per,
          tr.map((v) => v * 2),
          3,
          true,
          0.95,
        ),
      ),
    ).toBe('notBinary');
    const twice = per.map((p, i) => (i === 1 ? 1 : p));
    expect(code(() => eventStudy(ys, ent, twice, tr, 3, true, 0.95))).toBe('repeatedPeriod');
    const noControl = ys.filter((_, i) => !(tr[i] === 0 && per[i] === 4));
    const pick = (v: readonly (number | string)[]) => v.filter((_, i) => !(tr[i] === 0 && per[i] === 4));
    expect(
      code(() =>
        eventStudy(noControl, pick(ent) as string[], pick(per) as number[], pick(tr) as number[], 3, true, 0.95),
      ),
    ).toBe('eventCell');
    expect(code(() => eventStudy([], [], [], [], 3, true, 0.95))).toBe('eventGroups');
  });
});
