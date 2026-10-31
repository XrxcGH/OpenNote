import { describe, expect, it } from 'vitest';
import { CivilError } from '../core/types';
import {
  fenske,
  flash,
  gammas,
  gilliland,
  kremser,
  linearBalances,
  mccabeThiele,
  minLiquid,
  mix,
  reactionHeat,
  recycleLoop,
  separate,
  underwood,
  vlePoint,
  xEq,
  yEq,
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

describe('material balances', () => {
  it('mixes the plan ethanol streams', () => {
    const m = mix([
      [100, 0.2],
      [50, 0.5],
    ]);
    within(m.F, 150, 1e-12);
    within(m.x, 0.3, 1e-12);
  });

  it('splits a feed by fractions to the top', () => {
    const s = separate([
      [60, 0.9],
      [40, 0.2],
    ]);
    within(s.T, 62, 1e-12);
    within(s.xTop[0]!, 54 / 62, 1e-12);
  });

  it('gives the plan recycle loop', () => {
    const r = recycleLoop(100, 0, 0.25, 1, 0);
    within(r.overall, 1, 1e-12);
    within(r.RA, 400, 1e-9);
    within(r.recycle.A, 300, 1e-9);
  });

  it('balances an inert with a purge and refuses one with no purge', () => {
    const r = recycleLoop(100, 2, 0.25, 1, 0.1);
    within(r.purge.I, 2, 1e-12);
    within(r.RA, 100 / (1 - 0.9 * 0.75), 1e-9);
    expect(key(() => recycleLoop(100, 2, 0.25, 1, 0))).toBe('process.errors.inertBuild');
  });

  it('solves typed linear balances and counts degrees of freedom', () => {
    const b = linearBalances('F1 + F2 = F3; 0.2*F1 + 0.5*F2 = 0.3*F3; F1 = 100');
    expect(b.dof).toBe(0);
    expect(b.names).toEqual(['F1', 'F2', 'F3']);
    within(b.x![1]!, 50, 1e-9);
    within(b.x![2]!, 150, 1e-9);
    expect(linearBalances('F1 + F2 = F3; F1 = 100').dof).toBe(1);
  });

  it('refuses nonlinear and contradictory balances', () => {
    expect(key(() => linearBalances('F1*F2 = 3; F1 = 1'))).toBe('process.errors.nonlinear');
    expect(key(() => linearBalances('F1 = 1; F1 = 2'))).toBe('process.errors.inconsistent');
    expect(key(() => linearBalances('F1 + = 2'))).toBe('process.errors.equation');
    expect(key(() => linearBalances(' ; '))).toBe('process.errors.noEquations');
  });

  it('gives the heat of a reaction through 25 °C by hand', () => {
    // CO + ½O₂ → CO₂, 1 mol CO with 0.5 mol O₂ at 25 °C in, products at 25 °C out: Q = ΔH°r.
    const e = reactionHeat(
      [
        { nIn: 1, nu: -1, dHf: -110.52, cp: 30 },
        { nIn: 0.5, nu: -0.5, dHf: 0, cp: 30 },
        { nIn: 0, nu: 1, dHf: -393.51, cp: 40 },
      ],
      1,
      298.15,
      398.15,
    );
    within(e.dHr, -282.99, 1e-9);
    within(e.Q, -282.99 + (1 * 40 * 100) / 1000, 1e-9);
  });
});

describe('vapor-liquid equilibrium', () => {
  // Constant vapor pressures through A = log₁₀ P and B = 0 reproduce the plan's 1.8 and 0.8 bar.
  const a = { A: Math.log10(1.8), B: 0, C: 0 };
  const b = { A: Math.log10(0.8), B: 0, C: 0 };

  it('gives the plan bubble pressure and vapor', () => {
    const r = vlePoint('bubble', 'T', 350, 0.4, a, b, { kind: 'ideal' });
    within(r.P, 1.2, 1e-12);
    within(r.y1, 0.6, 1e-12);
  });

  it('returns to the liquid from the dew point', () => {
    const r = vlePoint('dew', 'T', 350, 0.6, a, b, { kind: 'ideal' });
    within(r.x1, 0.4, 1e-10);
    within(r.P, 1.2, 1e-10);
  });

  it('finds a bubble temperature that reproduces the pressure', () => {
    // Benzene and toluene, NIST-form constants (bar, K) from the NIST Chemistry WebBook.
    const benzene = { A: 4.01814, B: 1203.835, C: -53.226 };
    const toluene = { A: 4.07827, B: 1343.943, C: -53.773 };
    const r = vlePoint('bubble', 'P', 1.01325, 0.5, benzene, toluene, { kind: 'ideal' });
    const back = vlePoint('bubble', 'T', r.T, 0.5, benzene, toluene, { kind: 'ideal' });
    within(back.P, 1.01325, 1e-9);
    expect(r.T).toBeGreaterThan(353);
    expect(r.T).toBeLessThan(384);
  });

  it('gives the activity models their limits', () => {
    within(Math.log(gammas({ kind: 'margules', A12: 1.2, A21: 0.8 }, 0)[0]), 1.2, 1e-12);
    within(Math.log(gammas({ kind: 'vanLaar', A12: 1.2, A21: 0.8 }, 1)[1]), 0.8, 1e-12);
    within(Math.log(gammas({ kind: 'wilson', L12: 0.5, L21: 0.7 }, 0)[0]), -Math.log(0.5) + 1 - 0.7, 1e-12);
  });

  it('gives the plan flash', () => {
    const f = flash([0.5, 0.5], [2, 0.5]);
    within(f.V, 0.5, 1e-9);
    within(f.x[0]!, 1 / 3, 1e-6);
    within(f.y[0]!, 2 / 3, 1e-6);
    expect(flash([0.5, 0.5], [0.9, 0.5]).state).toBe('liquid');
    expect(key(() => flash([0.5, 0.4], [2, 0.5]))).toBe('process.errors.sumZ');
  });
});

describe('distillation and absorption', () => {
  it('gives the plan Fenske and Underwood values', () => {
    within(fenske(2.25, 0.95, 0.05), 7.26188, 1e-5);
    within(underwood(2.25, 0.95, 0.5, 1).Rmin, 1.34, 1e-9);
  });

  it('agrees with the pinch at the feed for a saturated liquid', () => {
    const alpha = 3;
    const yF = yEq(alpha, 0.4);
    const pinch = (0.9 - yF) / (yF - 0.4);
    within(underwood(alpha, 0.9, 0.4, 1).Rmin, pinch, 1e-9);
    within(xEq(alpha, yF), 0.4, 1e-12);
  });

  it('steps more stages than Fenske and fewer as reflux rises', () => {
    const lo = mccabeThiele(2.25, 0.95, 0.05, 0.5, 1, 1.5 * 1.34);
    const hi = mccabeThiele(2.25, 0.95, 0.05, 0.5, 1, 5 * 1.34);
    expect(lo.N).toBeGreaterThan(fenske(2.25, 0.95, 0.05));
    expect(hi.N).toBeLessThanOrEqual(lo.N);
    expect(lo.feedStage).toBeGreaterThan(1);
    expect(lo.feedStage).toBeLessThan(lo.N);
    expect(key(() => mccabeThiele(2.25, 0.95, 0.05, 0.5, 1, 1.2))).toBe('process.errors.reflux');
  });

  it('gives the Gilliland estimate at its ends', () => {
    within(gilliland(7, 1.34, 1e9).N, 7, 1e-3);
    expect(key(() => gilliland(7, 1.34, 1))).toBe('process.errors.reflux');
  });

  it('gives the plan Kremser stages and the least liquid', () => {
    within(kremser('absorb', 1.5, 0.05, 0.005, 0, 1), 3.41902, 1e-5);
    within(kremser('absorb', 1, 0.05, 0.005, 0, 1), 9, 1e-12);
    within(minLiquid(0.05, 0.005, 0, 2), (0.045 * 2) / 0.05, 1e-12);
    expect(key(() => kremser('absorb', 0.5, 0.05, 0.001, 0, 1))).toBe('process.errors.kremserLimit');
  });
});
