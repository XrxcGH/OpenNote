// Population dynamics against the planning pass's independent values, plus closed forms and the documented errors.
import { describe, expect, it } from 'vitest';
import { LsError } from '../num/errors';
import {
  classify,
  competition,
  growthSeries,
  harvest,
  levinsResult,
  logistic,
  lyapunov,
  predatorPreyEquilibrium,
  predatorPreyResult,
  twoCycle,
} from './engine';

describe('single-species growth', () => {
  it('gives the logistic N(10) = 599.86 for K 1000, N0 10, r 0.5', () => {
    expect(logistic(10, 0.5, 1000, 10)).toBeCloseTo(599.86, 2);
    expect(logistic(10, 0.5, 1000, 10)).toBeCloseTo(1000 / (1 + 99 * Math.exp(-5)), 9);
  });

  it('steps discrete models once per time unit', () => {
    const s = growthSeries({ model: 'geometric', N0: 10, r: 2, K: NaN, A: NaN, t: 3 });
    expect(s.map((p) => p[1])).toEqual([10, 20, 40, 80]);
  });

  it('lets an Allee population below A die out', () => {
    const s = growthSeries({ model: 'allee', N0: 40, r: 0.5, K: 1000, A: 50, t: 40 });
    expect(s[s.length - 1][1]).toBeLessThan(40);
  });

  it('refuses an Allee threshold above K', () => {
    expect(() => growthSeries({ model: 'allee', N0: 40, r: 0.5, K: 100, A: 150, t: 4 })).toThrow(LsError);
  });
});

describe('the logistic map', () => {
  it('has the 2-cycle 0.799455, 0.513045 at r = 3.2', () => {
    const [a, b] = twoCycle(3.2);
    expect(a).toBeCloseTo(0.799455, 6);
    expect(b).toBeCloseTo(0.513045, 6);
    expect(3.2 * a * (1 - a)).toBeCloseTo(b, 12);
  });

  it('has a Lyapunov exponent near ln 2 at r = 4', () => {
    expect(Math.abs(lyapunov(4) - Math.LN2)).toBeLessThan(1e-3);
  });

  it('has no 2-cycle at r = 3 or below', () => {
    expect(() => twoCycle(2.9)).toThrow(LsError);
  });
});

describe('harvesting', () => {
  it('gives MSY 125 at N = 500 for r 0.5 and K 1000', () => {
    const h = harvest(0.5, 1000, 'quota', 125);
    expect(h.msy).toBe(125);
    expect(h.equilibria[0].N).toBeCloseTo(500, 9);
  });

  it('collapses with a quota above MSY', () => {
    expect(harvest(0.5, 1000, 'quota', 130).equilibria).toEqual([]);
  });
});

describe('predator-prey', () => {
  it('gives the Lotka-Volterra equilibrium N* = 10, P* = 10 as a center', () => {
    const p = { r: 1, a: 0.1, b: 0.5, m: 0.5, K: Infinity, h: 0, N0: 20, P0: 5, t: 30 };
    const eq = predatorPreyEquilibrium(p);
    expect(eq.N).toBeCloseTo(10, 12);
    expect(eq.P).toBeCloseTo(10, 12);
    expect(eq.kind).toBe('center');
  });

  it('keeps the conserved quantity along a Lotka-Volterra orbit', () => {
    const r = predatorPreyResult({ r: 1, a: 0.1, b: 0.5, m: 0.5, K: Infinity, h: 0, N0: 20, P0: 5, t: 30 });
    const step = r.steps.find((s) => s.key === 'population.s.conserved')!;
    expect(step.vars!.v1 as number).toBeCloseTo(step.vars!.v0 as number, 5);
  });

  it('refuses a predator that cannot grow', () => {
    expect(() => predatorPreyEquilibrium({ r: 1, a: 0.1, b: 0.5, m: 0.5, K: 100, h: 1, N0: 1, P0: 1, t: 1 })).toThrow(
      LsError,
    );
  });
});

describe('competition and metapopulations', () => {
  it('gives N1* = N2* = 66.667 for α = 0.5 and K = 100', () => {
    const c = competition({ r1: 1, r2: 1, K1: 100, K2: 100, a12: 0.5, a21: 0.5, N1: 1, N2: 1, t: 1 });
    expect(c.coexist!.N1).toBeCloseTo(66.667, 3);
    expect(c.coexist!.N2).toBeCloseTo(66.667, 3);
    expect(c.outcome).toBe('coexist');
  });

  it('gives the Levins equilibrium p* = 0.6 for e 0.2 and c 0.5', () => {
    expect(levinsResult(0.5, 0.2, 0.1, 10).rows[0].value).toBeCloseTo(0.6, 12);
  });
});

describe('equilibrium classes', () => {
  it('names a saddle and a stable spiral', () => {
    expect(classify([1, 0, 0, -1]).kind).toBe('saddle');
    expect(classify([-0.1, -1, 1, -0.1]).kind).toBe('stableSpiral');
  });
});
