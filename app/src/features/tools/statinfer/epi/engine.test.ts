// Epidemiology and diagnostic tests. Expected values are SciPy results from the planning pass or hand sums from
// the textbook formulas; the standard population is checked against its published total.
import { describe, expect, it } from 'vitest';
import { KitError } from '../report';
import { cohortReport, diagnosticReport, directReport, strataReport } from './engine';
import { US2000_11, US2000_19 } from './standard';
import { accuracy, compareRates, directRate, effect, mantelHaenszel, postTest, proportion, smr } from './stats';

const close = (actual: number, want: number, tol: number) => expect(Math.abs(actual - want)).toBeLessThanOrEqual(tol);

describe('measures of effect', () => {
  it('cohort: exposed 30 cases of 100, unexposed 10 of 100', () => {
    const e = effect({ a: 30, b: 70, c: 10, d: 90 });
    close(e.rr.value, 3, 1e-12);
    close(e.rr.lower, 1.5508, 1e-4);
    close(e.rr.upper, 5.8033, 1e-4);
    close(e.or.value, 3.85714, 1e-5);
    close(e.or.lower, 1.7666, 1e-4);
    close(e.or.upper, 8.4216, 1e-4);
    close(e.rd.value, 0.2, 1e-12);
    close(e.nn, 5, 1e-12);
    close(e.afExposed, 2 / 3, 1e-12);
    // PAF by hand: overall risk 0.2, unexposed 0.1, so (0.2 − 0.1)/0.2.
    close(e.paf, 0.5, 1e-12);
    expect(e.corrected).toBe(false);
  });

  it('adds 0.5 to every cell when one is 0', () => {
    const e = effect({ a: 0, b: 10, c: 5, d: 5 });
    expect(e.corrected).toBe(true);
    // The point estimates use the raw counts: R1 = 0/10, so RR = 0, OR = 0·5/(10·5) = 0, and AF_e = (0 − 1)/0.
    expect(e.rr.value).toBe(0);
    expect(e.or.value).toBe(0);
    expect(e.afExposed).toBe(Number.NEGATIVE_INFINITY);
    close(e.riskExposed, 0, 1e-12);
    close(e.rd.value, -0.5, 1e-12);
    // Only the log intervals use the corrected cells: center (0.5/11)/(5.5/11) = 1/11, SE = √(2 − 1/11 + 1/5.5 − 1/11) = √2.
    close(e.rrCenter, 1 / 11, 1e-12);
    close(e.seLogRr, Math.SQRT2, 1e-12);
    close(e.rr.lower, 0.00568626, 1e-7);
    close(e.rr.upper, 1.45341, 1e-5);
    close(e.orCenter, (0.5 * 5.5) / (10.5 * 5.5), 1e-12);
  });

  it('gives an infinite ratio when the unexposed have no cases', () => {
    const e = effect({ a: 5, b: 5, c: 0, d: 10 });
    expect(e.rr.value).toBe(Number.POSITIVE_INFINITY);
    expect(e.or.value).toBe(Number.POSITIVE_INFINITY);
    close(e.afExposed, 1, 1e-12);
  });

  it('Mantel-Haenszel odds ratio of 2 strata', () => {
    const p = mantelHaenszel([
      { a: 10, b: 20, c: 5, d: 40 },
      { a: 20, b: 10, c: 10, d: 30 },
    ]);
    close(p.orMh.value, 5.03448, 1e-5);
    expect(p.df).toBe(1);
    expect(p.breslowDay).toBeGreaterThanOrEqual(0);
  });

  it('CMH skips the continuity term when observed equals expected', () => {
    // E = 20*15/40 = 7.5 per stratum, so sum A = sum E = 15: R gives 0, p = 1.
    const p = mantelHaenszel([
      { a: 10, b: 10, c: 5, d: 15 },
      { a: 5, b: 15, c: 10, d: 10 },
    ]);
    close(p.cmh, 0, 1e-12);
    close(p.pCmh, 1, 1e-12);
  });

  it('CMH keeps a gap under 0.5 uncorrected', () => {
    // A - E = (1 - 0.8) + (10 - 10) = 0.2; V = 0.36 + 160000/62400; CMH = 0.04 / V.
    const p = mantelHaenszel([
      { a: 1, b: 1, c: 1, d: 2 },
      { a: 10, b: 10, c: 10, d: 10 },
    ]);
    close(p.cmh, 0.04 / (0.36 + 160000 / 62400), 1e-12);
  });

  it('Breslow-Day is 0 when every stratum has the same odds ratio', () => {
    const p = mantelHaenszel([
      { a: 10, b: 10, c: 10, d: 10 },
      { a: 20, b: 20, c: 20, d: 20 },
    ]);
    close(p.orMh.value, 1, 1e-12);
    close(p.breslowDay, 0, 1e-9);
  });
});

describe('diagnostic tests', () => {
  it('screening test TP 90, FN 10, FP 30, TN 170', () => {
    const a = accuracy(90, 10, 30, 170);
    close(a.sensitivity.value, 0.9, 1e-12);
    close(a.specificity.value, 0.85, 1e-12);
    close(a.ppv.value, 0.75, 1e-12);
    close(a.npv.value, 0.944444, 1e-6);
    close(a.lrPositive.value, 6, 1e-9);
    close(a.lrNegative.value, 0.117647, 1e-6);
  });

  it('the same test at a prevalence of 10%', () => {
    close(postTest(0.9, 0.85, 0.1).positive, 0.4, 1e-12);
    const r = diagnosticReport({ tp: 90, fn: 10, fp: 30, tn: 170 }, 0.1, 0.95, { positive: 'p', negative: 'n' });
    expect(r.answer.vars.ppv).toBe('0.4');
  });
});

describe('rates and standardization', () => {
  it('SMR with 20 observed and 12.5 expected', () => {
    const s = smr(20, 12.5);
    close(s.smr.value, 1.6, 1e-12);
    close(s.smr.lower, 0.97732, 1e-4);
    close(s.smr.upper, 2.4711, 1e-4);
  });

  it('direct standardization: 10/1000 and 40/2000 with weights 0.6 and 0.4', () => {
    const d = directRate(
      [
        { label: 'young', cases: 10, time: 1000 },
        { label: 'old', cases: 40, time: 2000 },
      ],
      [0.6, 0.4],
    );
    close(d.rate.value * 100_000, 1400, 1e-6);
    expect(directReport([{ label: 'a', cases: 1, time: 10 }], [1], 1000, 0.95).answer.vars.rate).toBe('100');
  });

  it('the US 2000 standard adds up to its published total, 274,633,642', () => {
    const total = (groups: readonly { population: number }[]) => groups.reduce((s, g) => s + g.population, 0);
    expect(total(US2000_11)).toBe(274_633_642);
    expect(total(US2000_19)).toBe(274_633_642);
    expect(US2000_19.length).toBe(19);
  });

  it('rate ratio with an exact interval that contains the estimate', () => {
    const r = compareRates(30, 1000, 10, 1000);
    close(r.ratio.value, 3, 1e-12);
    expect(r.ratio.lower).toBeLessThan(3);
    expect(r.ratio.upper).toBeGreaterThan(3);
    // With equal person-time, the ratio's interval is p/(1 − p) of the binomial split's exact interval.
    expect(r.ratio.lower).toBeGreaterThan(1.4);
  });

  it('a proportion with Wilson and exact intervals', () => {
    const p = proportion(0, 20);
    expect(p.value).toBe(0);
    expect(p.exact.lower).toBe(0);
    // Exact upper limit for 0 of 20 at 95%: 1 − 0.025^(1/20).
    close(p.exact.upper, 1 - 0.025 ** (1 / 20), 1e-9);
  });
});

describe('impossible epidemiology input', () => {
  const code = (run: () => unknown) => {
    try {
      run();
    } catch (error) {
      return error instanceof KitError ? error.code : 'other';
    }
    return 'none';
  };

  it('names the problem', () => {
    expect(code(() => effect({ a: 0, b: 0, c: 1, d: 1 }))).toBe('emptyGroup');
    expect(code(() => effect({ a: -1, b: 2, c: 1, d: 1 }))).toBe('negativeCount');
    expect(code(() => effect({ a: 1, b: 2, c: 1, d: 1 }, 1.5))).toBe('confidenceRange');
    expect(code(() => mantelHaenszel([{ a: 1, b: 1, c: 1, d: 1 }]))).toBe('fewStrata');
    expect(code(() => accuracy(0, 0, 3, 4))).toBe('needBothGroups');
    expect(code(() => postTest(0.9, 0.9, 2))).toBe('prevalenceRange');
    expect(code(() => compareRates(1, 0, 1, 10))).toBe('timePositive');
    expect(code(() => smr(3, 0))).toBe('expectedPositive');
    expect(code(() => proportion(5, 3))).toBe('casesAboveTotal');
    expect(code(() => directRate([{ label: 'a', cases: 1, time: 10 }], [1, 2]))).toBe('standardLength');
    expect(
      code(() =>
        strataReport(
          [
            { a: 0, b: 1, c: 0, d: 1 },
            { a: 0, b: 1, c: 0, d: 1 },
          ],
          0.95,
        ),
      ),
    ).toBe('pooledUndefined');
    expect(cohortReport({ a: 1e6, b: 1e6, c: 1e6, d: 3e6 }, 0.95).answer.vars.rr).toBe('2');
  });
});
