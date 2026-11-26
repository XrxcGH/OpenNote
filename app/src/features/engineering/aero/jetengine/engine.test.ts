import '../text';
import { describe, expect, it } from 'vitest';
import { AeroError } from '../common';
import { IDEAL, cycle, ramRecovery, sweep } from './engine';
import type { CycleInput, Losses } from './engine';

const rel = (a: number, b: number, tol: number) => expect(Math.abs(a - b) / Math.abs(b)).toBeLessThan(tol);
const code = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    if (error instanceof AeroError) return error.code;
    throw error;
  }
  return 'none';
};

const jet: CycleInput = {
  type: 'turbojet',
  ideal: true,
  M0: 0.85,
  T0: 216.7,
  P0: 22632,
  gammaC: 1.4,
  cpC: 1004,
  gammaT: 1.4,
  cpT: 1004,
  hPR: 42.8e6,
  Tt4: 1600,
  piC: 20,
  piF: 1,
  alpha: 0,
  losses: IDEAL,
};

/** The ideal cycle in closed form, written apart from the engine: the textbook's ideal turbojet and turbofan. */
function idealClosedForm(M0: number, T0: number, Tt4: number, piC: number, piF: number, alpha: number) {
  const g = 1.4;
  const cp = 1004;
  const h = 42.8e6;
  const R = ((g - 1) / g) * cp;
  const a0 = Math.sqrt(g * R * T0);
  const tr = 1 + ((g - 1) / 2) * M0 * M0;
  const tl = Tt4 / T0;
  const tc = piC ** ((g - 1) / g);
  const tf = piF ** ((g - 1) / g);
  const v9 = Math.sqrt((2 / (g - 1)) * (tl - tr * (tc - 1 + alpha * (tf - 1)) - tl / (tr * tc)));
  const v19 = alpha > 0 ? Math.sqrt((2 / (g - 1)) * (tr * tf - 1)) : 0;
  const F = (a0 / (1 + alpha)) * (v9 - M0 + alpha * (v19 - M0));
  const f = (cp * T0 * (tl - tr * tc)) / h;
  return { F, f, S: f / ((1 + alpha) * F), etaTh: 1 - 1 / (tr * tc) };
}

describe('ideal cycles', () => {
  it('matches the ideal turbojet case', () => {
    const r = cycle(jet);
    rel(r.specificThrust, 909.41, 1e-4);
    rel(r.f, 0.02384, 1e-4);
    rel(r.S * 1e6, 26.215, 1e-4);
    rel(r.etaTh, 0.62875, 1e-4);
    rel(r.etaP, 0.35545, 1e-4);
    const c = idealClosedForm(0.85, 216.7, 1600, 20, 1, 0);
    rel(r.specificThrust, c.F, 1e-12);
    rel(r.etaTh, c.etaTh, 1e-12);
    // The overall efficiency is thrust power over fuel power.
    rel(r.etaO, (r.specificThrust * r.V0) / (r.f * 42.8e6), 1e-12);
  });

  it('matches the ideal ramjet case', () => {
    const r = cycle({ ...jet, type: 'ramjet', M0: 3, Tt4: 2000 });
    rel(r.specificThrust, 721.76, 1e-4);
    rel(r.f, 0.032683, 1e-4);
    rel(r.S * 1e6, 45.282, 1e-4);
    rel(r.etaTh, 0.64286, 1e-4);
    // Independent: an ideal ramjet's thermal efficiency is 1 - 1/tau_r, and it has no compressor or turbine.
    rel(r.etaTh, 1 - 1 / (1 + 0.2 * 9), 1e-12);
    expect(r.stations.map((s) => s.id)).toEqual(['0', '2', '4', '9']);
  });

  it('matches the ideal turbofan case, per unit of total air', () => {
    const r = cycle({ ...jet, type: 'turbofan', M0: 0.8, piC: 24, piF: 1.6, alpha: 5 });
    rel(r.specificThrust, 225.51, 1e-4);
    rel(r.f, 0.023316, 1e-4);
    rel(r.S * 1e6, 17.232, 1e-4);
    const c = idealClosedForm(0.8, 216.7, 1600, 24, 1.6, 5);
    rel(r.specificThrust, c.F, 1e-12);
    rel(r.S, c.S, 1e-12);
    expect(r.FR).toBeGreaterThan(0);
    expect(r.stations.map((s) => s.id)).toEqual(['0', '2', '13', '3', '4', '5', '9', '19']);
  });

  it('adds an ideal afterburner', () => {
    const r = cycle({ ...jet, M0: 2, piC: 10, Tt7: 2200 });
    // Independent (Python, closed form): V9/a0 = sqrt(2/(g-1) tau_lambdaAB (1 - 1/(tau_r tau_c tau_t))).
    rel(r.specificThrust, 1075.3412, 1e-6);
    rel(r.fO, 0.042457471, 1e-6);
    rel(r.S * 1e6, 39.482789, 1e-6);
    expect(r.stations.at(-2)?.id).toBe('7');
  });

  it('keeps the total pressure in an ideal engine from the turbine to the exit', () => {
    const r = cycle(jet);
    const pt = Object.fromEntries(r.stations.map((s) => [s.id, s.Pt]));
    rel(pt['9']!, pt['5']!, 1e-12);
    rel(pt['3']! / pt['2']!, 20, 1e-12);
    // The exit expands to ambient: Pt9/P0 gives back M9 through the isentropic relation.
    const M9 = Math.sqrt(5 * ((pt['9']! / 22632) ** (0.4 / 1.4) - 1));
    rel(r.M9, M9, 1e-12);
  });
});

describe('non-ideal turbojet', () => {
  const losses: Losses = {
    ...IDEAL,
    piDmax: 0.95,
    piB: 0.94,
    piN: 0.96,
    ec: 0.9,
    et: 0.9,
    etaB: 0.98,
    etaM: 0.99,
    p0p9: 0.5,
  };
  const real: CycleInput = {
    ...jet,
    ideal: false,
    M0: 2,
    gammaT: 1.3,
    cpT: 1239,
    Tt4: 1800,
    piC: 10,
    losses,
  };

  it('matches the textbook non-ideal example at Mach 2', () => {
    const r = cycle(real);
    // Independent: the closed-form equations, computed apart in Python (scratch jet2.py).
    rel(r.ratios.tauC, 2.0771139, 1e-6);
    rel(r.ratios.etaC, 0.8640662, 1e-6);
    rel(r.f, 0.035674253, 1e-6);
    rel(r.ratios.tauT, 0.81553049, 1e-6);
    rel(r.ratios.piT, 0.37462865, 1e-6);
    rel(r.ratios.etaT, 0.90988422, 1e-6);
    rel(r.M9, 2.2528658, 1e-6);
    rel(r.V9, 1253.9204, 1e-6);
    rel(r.specificThrust, 807.05953, 1e-6);
    rel(r.S * 1e6, 44.202753, 1e-6);
    rel(r.etaTh, 0.41925994, 1e-6);
    rel(r.etaP, 0.74384056, 1e-6);
  });

  it('uses the military ram recovery above Mach 1', () => {
    expect(ramRecovery(0.9)).toBe(1);
    rel(ramRecovery(2), 0.925, 1e-12);
    rel(ramRecovery(6), 800 / (6 ** 4 + 935), 1e-12);
  });

  it('turns into the ideal cycle when every figure is 1', () => {
    const a = cycle({ ...real, losses: IDEAL, gammaT: 1.4, cpT: 1004, M0: 0.85, Tt4: 1600, piC: 20 });
    const b = cycle(jet);
    // Only the fuel's mass differs: the non-ideal cycle carries it through, the ideal one neglects it.
    rel(a.f, b.f / (1 - 1600 / 216.7 / (42.8e6 / (1004 * 216.7))), 1e-9);
    // The fuel's mass adds about 4% of thrust; the closed form with every figure 1 (scratch jet3.py) agrees.
    rel(a.specificThrust, 945.32319, 1e-6);
    rel(a.S * 1e6, 26.202399, 1e-6);
    rel(a.etaTh, 0.62875437, 1e-6);
    rel(a.etaP, 0.35561444, 1e-6);
    expect(a.specificThrust / b.specificThrust).toBeGreaterThan(1);
  });
});

describe('edge cases', () => {
  it('gives a static turbojet zero propulsive efficiency and finite thrust', () => {
    const r = cycle({ ...jet, M0: 0 });
    expect(r.etaP).toBe(0);
    expect(r.specificThrust).toBeGreaterThan(0);
  });

  it('refuses impossible inputs with a reason', () => {
    expect(code(() => cycle({ ...jet, type: 'ramjet', M0: 0 }))).toBe('ramjetStatic');
    expect(code(() => cycle({ ...jet, M0: -1 }))).toBe('notNegative');
    expect(code(() => cycle({ ...jet, piC: 0.5 }))).toBe('ratioBelowOne');
    expect(code(() => cycle({ ...jet, Tt4: 500 }))).toBe('burnerCold');
    expect(code(() => cycle({ ...jet, T0: 0 }))).toBe('notPositive');
    expect(code(() => cycle({ ...jet, Tt4: Number.NaN }))).toBe('notNumber');
    expect(code(() => cycle({ ...jet, type: 'turbofan', piF: 3, alpha: 20, piC: 10 }))).toBe('turbineWork');
    expect(code(() => cycle({ ...jet, Tt7: 1000 }))).toBe('afterburnerCold');
    expect(code(() => cycle({ ...jet, ideal: false, hPR: 1e6 }))).toBe('fuelTooHot');
    expect(code(() => cycle({ ...jet, ideal: false, losses: { ...IDEAL, ec: 1.2 } }))).toBe('efficiencyRange');
    expect(code(() => cycle({ ...jet, gammaC: 1 }))).not.toBe('none');
  });

  it('handles a huge pressure ratio by refusing it once the burner has no room', () => {
    expect(code(() => cycle({ ...jet, piC: 1e6 }))).toBe('burnerCold');
  });

  it('sweeps over pressure ratio, skipping designs that cannot run', () => {
    const points = sweep(jet, (r) => r.specificThrust);
    expect(points.length).toBeGreaterThan(40);
    expect(points.every((p) => Number.isFinite(p.y))).toBe(true);
    const ram = sweep({ ...jet, type: 'ramjet', M0: 3, Tt4: 2000 }, (r) => r.S);
    expect(ram.length).toBeGreaterThan(40);
  });
});
