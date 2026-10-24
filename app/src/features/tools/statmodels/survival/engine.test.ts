// Survival analysis against values worked out independently (NumPy and SciPy from first principles): the
// Kaplan-Meier curve with Greenwood errors, the log-rank and Peto-Peto tests, the Cox model with Breslow and Efron
// ties, the life table, the Nelson-Aalen estimate, and the median.
import { describe, expect, it } from 'vitest';
import { StatError } from '../kit/types';
import { fitCox } from './cox';
import { firstAtOrBelow, kaplanMeier, lifeTable, logRank } from './engine';

const close = (got: number, want: number, tol: number) => expect(Math.abs(got - want)).toBeLessThanOrEqual(tol);

const events = [6, 6, 6, 7, 10, 13, 16, 22, 23];
const censored = [6, 9, 10, 11, 17, 19, 20, 25, 32, 32, 34, 35];
const time = [...events, ...censored];
const status = [...events.map(() => 1), ...censored.map(() => 0)];

const at = (rows: readonly { time: number; survival: number }[], t: number) =>
  rows.filter((r) => r.time <= t).at(-1)?.survival ?? 1;

describe('Kaplan-Meier', () => {
  const km = kaplanMeier(time, status);

  it('steps down at each event time, with the Greenwood error', () => {
    close(at(km.rows, 6), 0.857143, 1e-5);
    close(at(km.rows, 10), 0.752941, 1e-5);
    close(at(km.rows, 23), 0.448179, 1e-5);
    close(km.rows.find((r) => r.time === 23)!.se, 0.13459, 1e-5);
  });

  it('gives the median as the first time the curve is at or below 0.5', () => {
    expect(km.median).toBe(23);
    expect(
      firstAtOrBelow(
        [
          { time: 10, value: 0.6 },
          { time: 14, value: 0.45 },
        ],
        0.5,
      ),
    ).toBe(14);
  });

  it('adds up the Nelson-Aalen cumulative hazard', () => {
    close(km.rows.find((r) => r.time === 23)!.hazard, 0.7521135727018079, 1e-12);
  });

  it('keeps the log-log interval inside 0 to 1 and around the estimate', () => {
    for (const r of km.rows.filter((one) => one.survival < 1)) {
      expect(r.low).toBeGreaterThan(0);
      expect(r.low).toBeLessThan(r.survival);
      expect(r.high).toBeGreaterThan(r.survival);
      expect(r.high).toBeLessThan(1);
    }
  });

  it('refuses negative times and event codes other than 0 and 1', () => {
    expect(() => kaplanMeier([-1, 2], [1, 1])).toThrow(StatError);
    expect(() => kaplanMeier([1, 2], [1, 2])).toThrow(StatError);
  });
});

describe('comparing groups', () => {
  const t = [5, 8, 12, 15, 20, 10, 14, 18, 25, 30];
  const e = [1, 1, 0, 1, 1, 1, 0, 1, 1, 0];
  const g = ['A', 'A', 'A', 'A', 'A', 'B', 'B', 'B', 'B', 'B'];

  it('runs the log-rank test', () => {
    const test = logRank(t, e, g);
    expect(test.observed[0]).toBe(4);
    close(test.expected[0], 2.30278, 1e-5);
    close(test.chi2, 2.08584, 1e-5);
    close(test.p, 0.14867, 1e-5);
  });

  it('runs the Peto-Peto test with the pooled curve as weights', () => {
    close(logRank(t, e, g, { peto: true }).chi2, 1.9465424227562524, 1e-10);
  });

  it('sums a stratified test over strata, and needs 2 groups', () => {
    const one = logRank(t, e, g, { strata: g.map(() => 'all') });
    close(one.chi2, 2.08584, 1e-5);
    expect(() =>
      logRank(
        t,
        e,
        g.map(() => 'A'),
      ),
    ).toThrow(StatError);
  });

  it('fits the Cox model with Breslow ties', () => {
    const cox = fitCox(
      t,
      e,
      g.map((v) => [v === 'B' ? 1 : 0]),
      ['B'],
      'breslow',
    );
    close(cox.coef[0], -1.20078, 1e-4);
    close(cox.se[0], 0.87803, 1e-4);
    close(Math.exp(cox.coef[0]), 0.30096, 1e-4);
    close(cox.lr, 2.0169217242801203, 1e-8);
  });

  it('tells Breslow from Efron when event times are tied', () => {
    const tt = [1, 1, 2, 2, 3, 3, 4, 5];
    const ee = [1, 1, 1, 0, 1, 1, 1, 0];
    const x = [1, 1, 0, 1, 1, 0, 0, 0].map((v) => [v]);
    close(fitCox(tt, ee, x, ['x'], 'breslow').coef[0], 1.009717674089143, 1e-7);
    const efron = fitCox(tt, ee, x, ['x'], 'efron');
    close(efron.coef[0], 1.1725489471324708, 1e-7);
    close(efron.se[0], 0.9484805078258302, 1e-7);
  });
});

describe('the life table', () => {
  it('counts the withdrawn as at risk for half the interval', () => {
    const rows = lifeTable(time, status, 10);
    expect(rows.map((r) => [r.entering, r.events, r.withdrawn])).toEqual([
      [21, 4, 2],
      [15, 3, 4],
      [8, 2, 2],
      [4, 0, 4],
    ]);
    close(rows[1].survival, 0.6153846153846154, 1e-12);
    close(rows[2].se, 0.13384581477051927, 1e-12);
    close(rows[1].hazard, 0.02608695652173913, 1e-12);
  });
});
