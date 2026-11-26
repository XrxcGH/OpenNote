import '../text';
import { describe, expect, it } from 'vitest';
import { AeroError, goldenMax } from '../common';
import { climbGlide, kOf, polar, rangeEndurance, stability, turn, type Polar } from './engine';

const rel = (a: number, b: number, tol: number) => expect(Math.abs(a - b) / Math.abs(b)).toBeLessThan(tol);
const base: Polar = { W: 50e3, S: 20, CD0: 0.025, k: 0.045, rho: 1.225 };

describe('drag polar', () => {
  it('matches the sea-level case', () => {
    const r = polar(base);
    rel(r.LDmax, 14.907, 1e-4);
    rel(r.CLminD, 0.74536, 1e-4);
    rel(r.VminD, 74.0, 1e-4);
    rel(r.VminP, 56.23, 1e-4);
  });

  it('agrees with a numerical minimum of drag and power (independent)', () => {
    const r = polar(base);
    const D = (V: number) => {
      const q = 0.5 * 1.225 * V * V;
      const CL = 50e3 / (q * 20);
      return q * 20 * (0.025 + 0.045 * CL * CL);
    };
    rel(
      goldenMax((V) => -D(V), 20, 200),
      r.VminD,
      1e-6,
    );
    rel(
      goldenMax((V) => -D(V) * V, 20, 200),
      r.VminP,
      1e-6,
    );
    rel(D(r.VminD), r.Dmin, 1e-12);
  });

  it('builds k from e and AR', () => {
    rel(kOf(0.8, 8), 1 / (Math.PI * 6.4), 1e-15);
    expect(() => kOf(1.2, 8)).toThrow(AeroError);
  });
});

describe('range and endurance', () => {
  it('matches the jet at constant altitude', () => {
    const r = rangeEndurance({ ...base, rho: 0.4135, engine: 'jet', ct: 0.6 / 3600, fuelFraction: 0.2 });
    rel(r.CLrange, 0.43033, 1e-4);
    rel(r.CDrange, 0.033333, 1e-4);
    rel(r.range / 1000, 2741.6, 1e-3);
    // Independent: integrate dR = -V/(ct D) dW with CL held constant.
    let R = 0;
    const n = 20000;
    for (let i = 0; i < n; i += 1) {
      const W = 50e3 - (10e3 * (i + 0.5)) / n;
      const V = Math.sqrt((2 * W) / (0.4135 * 20 * r.CLrange));
      R += (V / ((0.6 / 3600) * W * (r.CDrange / r.CLrange))) * (10e3 / n);
    }
    rel(r.range, R, 1e-6);
  });

  it('gives the propeller Breguet range', () => {
    const cp = (0.3 / 1000 / 3600) * 9.80665; // 0.3 kg/(kW h) as weight per energy, 1/m
    const r = rangeEndurance({ ...base, engine: 'prop', cp, etaP: 0.8, fuelFraction: 0.2 });
    rel(r.range, (0.8 / cp) * 14.907 * Math.log(1 / 0.8), 1e-4);
    expect(r.endurance).toBeGreaterThan(0);
  });

  it('rejects impossible fuel and efficiency', () => {
    expect(() => rangeEndurance({ ...base, engine: 'jet', ct: 1e-4, fuelFraction: 1 })).toThrow(AeroError);
    expect(() => rangeEndurance({ ...base, engine: 'jet', ct: 1e-4, fuelFraction: 0 })).toThrow(AeroError);
    expect(() => rangeEndurance({ ...base, engine: 'prop', cp: 1e-6, etaP: 1.5, fuelFraction: 0.2 })).toThrow(
      AeroError,
    );
    expect(() => rangeEndurance({ ...base, engine: 'jet', fuelFraction: 0.2 })).toThrow(AeroError);
  });
});

describe('climb, glide and turn', () => {
  it('matches a numerical maximum of excess power for a jet', () => {
    const T = 8000;
    const r = climbGlide({ ...base, engine: 'jet', thrust: T });
    const roc = (V: number) => {
      const q = 0.5 * 1.225 * V * V;
      const CL = 50e3 / (q * 20);
      return ((T - q * 20 * (0.025 + 0.045 * CL * CL)) * V) / 50e3;
    };
    const V = goldenMax(roc, 30, 400);
    rel(r.speedForMaxClimb, V, 1e-6);
    rel(r.maxClimbRate, roc(V), 1e-9);
  });

  it('gives the glide angle and range from L/D', () => {
    const r = climbGlide({ ...base, engine: 'prop', power: 300e3, height: 1000 });
    rel(Math.tan(r.glideAngle), 1 / 14.907, 1e-4);
    rel(r.glideRange ?? 0, 14907, 1e-4);
    expect(() => climbGlide({ ...base, engine: 'prop', power: 10 })).toThrow(AeroError);
    expect(() => climbGlide({ ...base, engine: 'jet', thrust: 1000 })).toThrow(AeroError);
  });

  it('turns at 60 degrees of bank with n = 2', () => {
    const r = turn({ V: 100, bank: 60 });
    rel(r.n, 2, 1e-12);
    rel(r.radius, 10000 / (9.80665 * Math.sqrt(3)), 1e-12);
    expect(() => turn({ V: 100, bank: 90 })).toThrow(AeroError);
    expect(() => turn({ V: 0, bank: 30 })).toThrow(AeroError);
  });
});

describe('static stability', () => {
  it('matches the neutral point and static margin', () => {
    const r = stability({ hac: 0.25, VH: 0.6, slopeRatio: 0.8, downwash: 0.4, hcg: 0.3 });
    expect(Math.abs(r.hn - 0.538)).toBeLessThan(1e-9);
    expect(Math.abs(r.margin - 0.238)).toBeLessThan(1e-9);
    expect(r.stable).toBe(true);
  });

  it('flags a center of gravity behind the neutral point', () => {
    const r = stability({ hac: 0.25, VH: 0.6, slopeRatio: 0.8, downwash: 0.4, hcg: 0.6, a: 5 });
    expect(r.stable).toBe(false);
    expect(r.CmAlpha).toBeGreaterThan(0);
    expect(() => stability({ hac: 0.25, VH: 0.6, slopeRatio: 0.8, downwash: 1.2, hcg: 0.3 })).toThrow(AeroError);
  });
});

describe('polar inputs', () => {
  it('rejects zero, negative and missing values', () => {
    expect(() => polar({ ...base, W: 0 })).toThrow(AeroError);
    expect(() => polar({ ...base, S: -1 })).toThrow(AeroError);
    expect(() => polar({ ...base, rho: Number.NaN })).toThrow(AeroError);
  });
});
