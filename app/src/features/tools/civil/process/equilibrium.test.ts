import { describe, expect, it } from 'vitest';
import { CivilError } from '../core/types';
import { mccabeStages, mccabeThiele, reactionHeat, yEq } from './engine';
import { minReflux, tableEquilibrium } from './equilibrium';
import { meanGasCp } from './gasCp';

const within = (actual: number, expected: number, tol: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);

describe('tabulated equilibrium for McCabe-Thiele', () => {
  it('matches constant volatility when the table is drawn from it', () => {
    // alpha 2.25, saturated liquid feed at 0.5: y* = 1.125 / 1.625 = 0.69231, R/(R + 1) = 0.25769 / 0.45, R_min = 1.340.
    const rows = Array.from({ length: 999 }, (_, i) => [(i + 1) / 1000, yEq(2.25, (i + 1) / 1000)]);
    const eq = tableEquilibrium(rows);
    const Rmin = minReflux(eq, 0.95, 0.5, 1);
    within(Rmin, 1.34, 0.001);
    const fromTable = mccabeStages(eq, Rmin, 0.95, 0.05, 0.5, 1, 1.5 * Rmin);
    expect(fromTable.N).toBe(mccabeThiele(2.25, 0.95, 0.05, 0.5, 1, 1.5 * Rmin).N);
  });

  it('finds the feed pinch on benzene-toluene data and a tangent pinch on a sagging curve', () => {
    const bt = tableEquilibrium([
      [0.1, 0.21],
      [0.2, 0.37],
      [0.3, 0.51],
      [0.4, 0.62],
      [0.5, 0.71],
      [0.6, 0.79],
      [0.7, 0.86],
      [0.8, 0.91],
      [0.9, 0.96],
    ]);
    // (0.95 − 0.71) / (0.95 − 0.5) = 0.5333, so R_min = 0.5333 / 0.4667 = 1.143.
    within(minReflux(bt, 0.95, 0.5, 1), 1.1429, 0.0005);
    // The line to (0.8, 0.85) is steeper, 0.10 / 0.15 = 0.6667, than to the feed point: R_min = 2.
    const sag = tableEquilibrium([
      [0.5, 0.75],
      [0.8, 0.85],
      [0.9, 0.93],
    ]);
    within(minReflux(sag, 0.95, 0.5, 1), 2, 1e-3);
    expect(() =>
      tableEquilibrium([
        [0.5, 0.7],
        [0.4, 0.8],
      ]),
    ).toThrow(CivilError);
  });
});

describe('gas table heat capacities', () => {
  it('gives mean molar cp near the NIST values', () => {
    // NIST: N2 29.12 J/(mol K) at 298 K and 29.25 at 400 K; CO2 37.1 and 41.3.
    within(meanGasCp(2, 398.15), 29.18, 0.05);
    within(meanGasCp(8, 398.15), 39.3, 0.3);
    expect(() => meanGasCp(2, 1200)).toThrow(CivilError);
    expect(() => meanGasCp(99, 300)).toThrow(CivilError);
  });

  it('uses the outlet cp for the outlet stream', () => {
    // 1 mol of inert heated from 25 °C to 125 °C at 30 J/(mol K) needs 3 kJ.
    const e = reactionHeat([{ nIn: 1, nu: 0, dHf: 0, cp: 20, cpOut: 30 }], 0, 298.15, 398.15);
    within(e.Q, 3, 1e-9);
  });
});
