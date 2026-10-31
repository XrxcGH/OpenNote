// Life tables and demography against the planning pass's independent values, plus hand checks and the documented
// errors.
import { describe, expect, it } from 'vitest';
import { LsError } from '../num/errors';
import {
  cohortComponent,
  cohortTable,
  doublingTime,
  fecundity,
  fertility,
  matrixAnalysis,
  periodTable,
  pyramidResult,
  qFromM,
  survivorsFromDeaths,
} from './engine';

describe('cohort life tables', () => {
  it('give Lx 900, 650, 350, 100 with e0 = 2 and e1 = 1.375', () => {
    const t = cohortTable([0, 1, 2, 3, 4], [1000, 800, 500, 200, 0]);
    expect(t.map((r) => r.L)).toEqual([900, 650, 350, 100]);
    expect(t[0].e).toBeCloseTo(2, 9);
    expect(t[1].e).toBeCloseTo(1.375, 9);
    expect(t[1].q).toBeCloseTo(0.375, 12);
  });

  it('build the same table from deaths', () => {
    expect(survivorsFromDeaths([200, 300, 300, 200])).toEqual([1000, 800, 500, 200, 0]);
  });

  it('refuse survivors that rise or never reach 0', () => {
    expect(() => cohortTable([0, 1, 2], [100, 120, 0])).toThrow(LsError);
    expect(() => cohortTable([0, 1, 2], [100, 50, 10])).toThrow(LsError);
  });
});

describe('period life tables', () => {
  it('turn 5M = 0.01 with 5a = 2.5 into 5q = 0.0487805', () => {
    expect(qFromM(5, 0.01, 2.5)).toBeCloseTo(0.0487805, 7);
  });

  it('close with an open interval of L = l / M', () => {
    const t = periodTable([0, 5, 10], [0.01, 0.01, 0.1], [null, null, null]);
    const last = t[t.length - 1];
    expect(last.q).toBe(1);
    expect(last.L).toBeCloseTo(last.l / 0.1, 9);
    expect(t[0].e).toBeCloseTo(t[0].T / 100000, 12);
  });

  it('needs a rate above 0 in the open interval', () => {
    expect(() => periodTable([0, 5], [0.01, 0], [null, null])).toThrow(LsError);
  });
});

describe('fecundity schedules', () => {
  it('give R0 = 2, T = 1.7 and r = 0.429102', () => {
    const f = fecundity([0, 1, 2, 3], [1, 0.8, 0.5, 0.2], [0, 1, 2, 1]);
    expect(f.R0).toBeCloseTo(2, 12);
    expect(f.T).toBeCloseTo(1.7, 12);
    expect(f.r).toBeCloseTo(0.429102, 6);
  });

  it('say when there are no births', () => {
    expect(() => fecundity([0, 1], [1, 0.5], [0, 0])).toThrow(LsError);
  });
});

describe('fertility and growth', () => {
  it('give TFR 1.96 from 5-year rates', () => {
    const f = fertility([15, 20, 25, 30, 35, 40, 45], [0.05, 0.1, 0.12, 0.08, 0.03, 0.01, 0.002], 5, 0.4878, []);
    expect(f.TFR).toBeCloseTo(1.96, 9);
    expect(f.GRR).toBeCloseTo(1.96 * 0.4878, 9);
  });

  it('give a doubling time of 34.6574 years at r = 0.02', () => {
    expect(doublingTime(0.02)).toBeCloseTo(34.6574, 4);
  });
});

describe('matrix models', () => {
  it('give λ = 0.977083 and the stable distribution 0.580984, 0.297305, 0.121711', () => {
    const m = matrixAnalysis([
      [0, 1.5, 1],
      [0.5, 0, 0],
      [0, 0.4, 0],
    ]);
    expect(m.lambda).toBeCloseTo(0.977083, 6);
    expect(m.stable[0]).toBeCloseTo(0.580984, 6);
    expect(m.stable[1]).toBeCloseTo(0.297305, 6);
    expect(m.stable[2]).toBeCloseTo(0.121711, 6);
    // Elasticities of a matrix sum to 1 (Caswell 2001, section 9.2).
    expect(m.elasticity.flat().reduce((s, v) => s + v, 0)).toBeCloseTo(1, 9);
    expect(m.reproductive[0]).toBe(1);
  });

  it('refuse a matrix that is not square', () => {
    expect(() => matrixAnalysis([[0, 1]])).toThrow(LsError);
  });
});

describe('cohort-component projection', () => {
  it('ages a population with no births or migration', () => {
    const groups = [0, 5, 10].map((start) => ({ start, population: 100, survival: 0.5, asfr: 0, migrants: 0 }));
    const series = cohortComponent(groups, 1, 1.05, 1);
    // The last group keeps half of itself and gains half of the group below.
    expect(series[1]).toEqual([0, 50, 100]);
  });
});

describe('population pyramids', () => {
  it('put males left and females right', () => {
    const r = pyramidResult(
      ['0–9', '10–19'],
      [
        [10, 20],
        [30, 40],
      ],
      true,
    );
    const males = r.plots![0].series[0].points;
    expect(males[0][0]).toBeCloseTo(-10, 12);
    expect(r.rows[1].value).toBeCloseTo((100 * 40) / 60, 12);
  });
});
