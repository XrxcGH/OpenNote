import { describe, expect, it } from 'vitest';
import { CivilError } from '../core/types';
import {
  R_GAS,
  activatedSludge,
  activationEnergy,
  adiabaticRise,
  arrhenius,
  batchGrowth,
  chemostat,
  fedBatch,
  levenspiel,
  outlet,
  oxygenTransfer,
  parallelReactions,
  powerLaw,
  recycleFirstOrder,
  rtd,
  segregationX,
  seriesReactions,
  spaceTime,
  steadyStates,
  tanksInSeries,
  typedRate,
} from './engine';

const within = (actual: number, expected: number, tol: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
const key = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof CivilError) return error.key;
    throw error;
  }
  throw new Error('expected a CivilError');
};

describe('ideal reactors', () => {
  const first = powerLaw(0.5, 1);

  it('gives the plan conversions for a first-order reaction', () => {
    within(1 - outlet('cstr', first, 1, 4), 0.666667, 1e-6);
    within(1 - outlet('pfr', first, 1, 4), 0.864665, 1e-6);
    const tanks = tanksInSeries(first, 1, 4, 2);
    within(1 - tanks[1]!, 0.75, 1e-9);
  });

  it('matches the closed forms for second order', () => {
    const r = powerLaw(0.2, 2);
    const C0 = 2;
    const tau = 3;
    within(outlet('pfr', r, C0, tau), C0 / (1 + 0.2 * tau * C0), 1e-9);
    within(outlet('cstr', r, C0, tau), (-1 + Math.sqrt(1 + 4 * 0.2 * tau * C0)) / (2 * 0.2 * tau), 1e-12);
    within(spaceTime('pfr', r, C0, 0.6), 0.6 / (0.2 * C0 * 0.4), 1e-9);
    within(spaceTime('cstr', r, C0, 0.6), (C0 * 0.6) / (0.2 * (C0 * 0.4) ** 2), 1e-12);
  });

  it('reads a typed rate law the same as the power law', () => {
    within(outlet('pfr', typedRate('0.5*C'), 1, 4), Math.exp(-2), 1e-9);
    const lh = typedRate('2*C/(1 + 0.5*C)');
    within(lh(2), 2, 1e-12);
  });

  it('runs a zero-order CSTR dry instead of going negative', () => {
    expect(outlet('cstr', powerLaw(1, 0), 1, 5)).toBe(0);
    expect(outlet('pfr', powerLaw(1, 0), 1, 5)).toBe(0);
  });

  it('runs a recycle reactor between a PFR and a CSTR', () => {
    within(recycleFirstOrder(0.5, 4, 0), 1 - Math.exp(-2), 1e-12);
    within(recycleFirstOrder(0.5, 4, 1e7), 2 / 3, 1e-6);
  });

  it('sizes reactors from Levenspiel data', () => {
    const l = levenspiel(
      [
        [0, 2],
        [0.4, 2],
        [0.8, 2],
      ],
      10,
    );
    within(l.Vcstr, 4, 1e-12);
    within(l.Vpfr, 4, 1e-12);
  });

  it('refuses impossible reactor inputs', () => {
    expect(key(() => powerLaw(1, 5))).toBe('reactors.errors.order');
    expect(key(() => typedRate('C +'))).toBe('reactors.errors.formula');
    expect(key(() => spaceTime('pfr', first, 1, 1))).toBe('reactors.errors.conversion');
    expect(key(() => outlet('cstr', first, 0, 1))).toBe('errors.positive');
    expect(key(() => tanksInSeries(first, 1, 1, 0))).toBe('reactors.errors.tanks');
  });
});

describe('multiple reactions', () => {
  it('finds the best time and yield for reactions in series', () => {
    const pfr = seriesReactions(1, 2, 1, Math.log(2), 'pfr');
    within(pfr.tOpt, Math.log(2), 1e-12);
    within(pfr.B, 0.25, 1e-12);
    const cstr = seriesReactions(1, 2, 1, 1 / Math.sqrt(2), 'cstr');
    within(cstr.tOpt, 1 / Math.sqrt(2), 1e-12);
    within(cstr.B, 1 / (1 + Math.sqrt(2)) ** 2, 1e-12);
  });

  it('gives a fixed split for parallel reactions of the same order', () => {
    const p = parallelReactions(3, 1, 1, 1, 1, 0.8, 'pfr');
    within(p.B, 0.8 * 0.75, 1e-9);
    within(p.selectivity, 3, 1e-9);
    within(parallelReactions(3, 1, 1, 1, 1, 0.8, 'cstr').B, 0.6, 1e-12);
  });
});

describe('temperature', () => {
  it('gives the plan adiabatic rise', () => {
    expect(adiabaticRise(-50, 2, 4, 0.8)).toBe(20);
  });

  it('round-trips the Arrhenius law', () => {
    const k2 = arrhenius(1, 300, 80000, 320);
    within(k2, Math.exp((80000 / R_GAS) * (1 / 300 - 1 / 320)), 1e-12);
    within(activationEnergy(1, 300, k2, 320), 80000, 1e-6);
    expect(key(() => activationEnergy(1, 300, 2, 300))).toBe('reactors.errors.sameT');
  });

  it('finds three steady states with the middle one unstable', () => {
    const s = steadyStates({
      T0: 298,
      tau: 1,
      kRef: 1,
      Tref: 350,
      E: 100000,
      dH: -200,
      CA0: 1,
      rhoCp: 1,
      kappa: 0,
      Ta: 298,
    });
    expect(s.states.map((x) => x.stable)).toEqual([true, false, true]);
    for (const state of s.states) within(s.G(state.T), s.Rm(state.T), 1e-6);
  });
});

describe('residence-time distributions', () => {
  const triangle = [
    [0, 0],
    [5, 0.2],
    [10, 0],
  ];

  it('gives the plan mean and variance of a triangle', () => {
    const r = rtd(triangle);
    within(r.tm, 5, 1e-12);
    within(r.variance, 25 / 6, 1e-9);
    within(r.F[r.F.length - 1]!, 1, 1e-12);
    within(r.N, 6, 1e-9);
    const s2 = r.variance / 25;
    within(2 * r.Dnum - 2 * r.Dnum ** 2 * (1 - Math.exp(-1 / r.Dnum)), s2, 1e-10);
  });

  it('gives the segregation conversion by a fine sum', () => {
    const k = 0.3;
    let sum = 0;
    const N = 200000;
    for (let i = 0; i < N; i++) {
      const t = ((i + 0.5) * 10) / N;
      const E = t <= 5 ? 0.04 * t : 0.04 * (10 - t);
      sum += Math.exp(-k * t) * E * (10 / N);
    }
    within(segregationX(triangle, k), 1 - sum, 1e-9);
  });

  it('refuses tracer data that goes back in time or below zero', () => {
    expect(
      key(() =>
        rtd([
          [0, 0],
          [5, 1],
          [4, 0],
        ]),
      ),
    ).toBe('reactors.errors.rising');
    expect(
      key(() =>
        rtd([
          [0, 0],
          [5, -1],
          [6, 0],
        ]),
      ),
    ).toBe('reactors.errors.tracer');
  });
});

describe('growth and activated sludge', () => {
  it('gives the plan chemostat and its washout', () => {
    const c = chemostat(0.5, 0.2, 0.25, 10, 0.5);
    within(c.S, 0.2, 1e-12);
    within(c.X, 4.9, 1e-12);
    within(c.Dcrit, 0.490196, 1e-6);
    expect(chemostat(0.5, 0.2, 0.495, 10, 0.5).washout).toBe(true);
  });

  it('keeps biomass and substrate in step in a batch', () => {
    const b = batchGrowth(0.5, 0.2, 0.1, 10, 0.5, 20);
    within(b.X + 0.5 * b.S, 0.1 + 0.5 * 10, 1e-6);
    expect(b.t99).not.toBeNull();
  });

  it('gives oxygen demand and the fed-batch balance by hand', () => {
    const o = oxygenTransfer(0.2, 5, 7.5, 2);
    within(o.OUR, 1, 1e-12);
    within(o.kLa, 1 / 5.5, 1e-12);
    const f = fedBatch(1, 2, 0.1, 100, 0.5, 10);
    within(f.V, 2, 1e-12);
    within(f.X, (2 + 0.5 * 100 * 0.1 * 10) / 2, 1e-12);
  });

  it('gives the plan activated sludge', () => {
    const base = { Y: 0.6, kd: 0.06, k: 5, Ks: 60, srt: 10, hrt: 0.25, S0: 200, Q: 1000 };
    within(activatedSludge({ ...base, S: null }).S, 3.38028, 1e-5);
    within(activatedSludge({ ...base, S: 10 }).X, 2850, 1e-9);
    expect(key(() => activatedSludge({ ...base, srt: 0.2, S: null }))).toBe('reactors.errors.washoutSrt');
  });
});
