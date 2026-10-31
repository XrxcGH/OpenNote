// Power and sample size. Expected values are SciPy results from the planning pass (nct, ncf, ncx2, the normal
// formulas) and G*Power's published examples, or hand calculations of the closed forms.
import { describe, expect, it } from 'vitest';
import { KitError } from '../report';
import { convertReport, powerReport } from './engine';
import { closedForm, convertEffect, powerAt, solveAlpha, solveEffect, solveN, type Settings } from './stats';

const close = (actual: number, want: number, tol: number) => expect(Math.abs(actual - want)).toBeLessThanOrEqual(tol);
const base: Settings = {
  test: 'tTwo',
  tails: 2,
  ratio: 1,
  groups: 3,
  df: 1,
  predictors: 1,
  rho: 0.5,
  epsilon: 1,
  margin: 0.5,
  p0: 0.5,
  continuity: false,
  eventRate: 0.5,
};
const as = (patch: Partial<Settings>): Settings => ({ ...base, ...patch });

describe('t tests', () => {
  it('two-sample t, d 0.5, α 0.05 two-sided, power 0.80: 64 per group', () => {
    const r = solveN(base, 0.5, 0.05, 0.8);
    expect(r.solution.n).toBe(64);
    close(r.solution.power, 0.80146, 1e-4);
  });

  it('power of a two-sample t with 20 per group and d 0.5', () => {
    close(powerAt(base, 20, 0.5, 0.05).power, 0.33794, 1e-4);
  });

  it('the detectable effect and alpha invert the power', () => {
    close(solveEffect(base, 64, 0.05, powerAt(base, 64, 0.5, 0.05).power).es, 0.5, 1e-6);
    close(solveAlpha(base, 64, 0.5, powerAt(base, 64, 0.5, 0.01).power).alpha, 0.01, 1e-6);
  });

  it('TOST power rises with n and stays below 1', () => {
    const s = as({ test: 'tost', margin: 0.5 });
    expect(powerAt(s, 100, 0, 0.05).power).toBeGreaterThan(powerAt(s, 30, 0, 0.05).power);
    expect(powerAt(s, 100, 0, 0.05).power).toBeLessThan(1);
  });
});

describe('F, chi-square, correlation, proportions, and survival', () => {
  it('one-way ANOVA, k 3, f 0.25, power 0.80: 53 per group, 159 in all', () => {
    const r = solveN(as({ test: 'anova', groups: 3 }), 0.25, 0.05, 0.8);
    expect(r.solution.n).toBe(53);
    close(r.solution.power, 0.80489, 1e-4);
  });

  it('chi-square, w 0.3, df 1, power 0.80: N 88', () => {
    const r = solveN(as({ test: 'chi2', df: 1 }), 0.3, 0.05, 0.8);
    expect(r.solution.n).toBe(88);
    close(r.solution.power, 0.80353, 1e-4);
  });

  it('correlation ρ 0.3 by the Fisher-z method: 85 (84.9278)', () => {
    const s = as({ test: 'correlation' });
    close(closedForm(s, 0.3, 0.05, 0.8) ?? 0, 84.9278, 1e-4);
    expect(solveN(s, 0.3, 0.05, 0.8).solution.n).toBe(85);
  });

  it('Schoenfeld events for HR 0.7, 1:1; two proportions 0.50 against 0.65', () => {
    const surv = as({ test: 'survival', ratio: 1 });
    close(closedForm(surv, 0.7, 0.05, 0.8) ?? 0, 246.787, 1e-3);
    expect(solveN(surv, 0.7, 0.05, 0.8).solution.n).toBe(247);
    const props = as({ test: 'proportions', p0: 0.5 });
    close(closedForm(props, 0.65, 0.05, 0.8) ?? 0, 169.311, 1e-3);
    expect(solveN(props, 0.65, 0.05, 0.8).solution.n).toBe(170);
  });

  it('exact binomial power by hand for n 10, p0 0.5 against p 0.9, one-sided', () => {
    // The 5% test rejects at 9 or more (P = 11/1024); power = P(X ≥ 9 | 0.9) = 0.9^10 + 10·0.9^9·0.1.
    const s = as({ test: 'proportion', tails: 1, p0: 0.5 });
    close(powerAt(s, 10, 0.9, 0.05).power, 0.9 ** 10 + 10 * 0.9 ** 9 * 0.1, 1e-12);
  });

  it('regression R² change and repeated measures give powers between alpha and 1', () => {
    const reg = powerAt(as({ test: 'regression', groups: 2, predictors: 5 }), 100, Math.sqrt(0.1), 0.05).power;
    expect(reg).toBeGreaterThan(0.05);
    expect(reg).toBeLessThan(1);
    const rm = powerAt(as({ test: 'rmAnova', groups: 3, rho: 0.5, epsilon: 1 }), 20, 0.25, 0.05).power;
    expect(rm).toBeGreaterThan(0.05);
  });
});

describe('converters, reports, and impossible input', () => {
  it('converts d to r, f, and OR', () => {
    const c = convertEffect('d', 0.5);
    close(c.r, 0.5 / Math.sqrt(4.25), 1e-12);
    close(c.f, 0.25, 1e-12);
    close(convertEffect('r', c.r).d, 0.5, 1e-12);
    close(convertEffect('or', c.or).d, 0.5, 1e-12);
  });

  it('reports carry the solved size and a curve', () => {
    const r = powerReport({
      settings: base,
      unknown: 'n',
      es: 0.5,
      alpha: 0.05,
      power: 0.8,
      n: 0,
      cluster: { m: 20, icc: 0.05 },
    });
    expect(r.answer.vars.n).toBe('64');
    expect(r.plots?.length).toBe(1);
    expect(convertReport('d', 0.5).answer.vars.f).toBe('0.25');
  });

  it('says what is wrong', () => {
    const code = (run: () => unknown) => {
      try {
        run();
      } catch (error) {
        return error instanceof KitError ? error.code : 'other';
      }
      return 'none';
    };
    expect(code(() => solveN(base, 0, 0.05, 0.8))).toBe('effectZero');
    expect(code(() => solveN(base, 0.5, 1.5, 0.8))).toBe('alphaRange');
    expect(code(() => solveN(base, 0.5, 0.05, 1))).toBe('powerRange');
    expect(code(() => solveN(as({ test: 'correlation' }), 1.2, 0.05, 0.8))).toBe('rhoRange');
    expect(code(() => solveN(as({ test: 'anova', groups: 1 }), 0.25, 0.05, 0.8))).toBe('groupsTwo');
    expect(code(() => solveN(as({ test: 'tost', margin: 0.2 }), 0.3, 0.05, 0.8))).toBe('marginRange');
    expect(code(() => solveN(base, 1e-6, 0.05, 0.99))).toBe('nTooLarge');
    // A huge effect needs the smallest size.
    expect(solveN(base, 20, 0.05, 0.8).solution.n).toBe(2);
  });
});
