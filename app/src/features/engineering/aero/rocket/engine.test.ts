import { describe, expect, it } from 'vitest';
import { AeroError } from '../common';
import { deltaV, rocket, type RocketInput } from './engine';

const rel = (a: number, b: number, tol: number) => expect(Math.abs(a - b) / Math.abs(b)).toBeLessThan(tol);
const base: RocketInput = {
  Tc: 3500,
  molarMass: 22,
  gamma: 1.2,
  pc: 7e6,
  mode: 'areaRatio',
  areaRatio: 40,
  pa: 0,
  throat: 0.01,
};

describe('ideal rocket', () => {
  it('matches the vacuum case with area ratio 40', () => {
    const r = rocket(base);
    rel(r.cStar, 1773.4, 1e-4);
    rel(r.exitMach, 4.2394, 1e-4);
    rel(r.pe, 14610, 1e-3);
    rel(r.CF, 1.8843, 1e-4);
    rel(r.Isp, 340.75, 1e-4);
    // Independent: thrust = mdot ue + pe Ae in vacuum, the same as CF pc At.
    rel(r.thrust, r.massFlow * r.exitVelocity + r.pe * 40 * 0.01, 1e-12);
  });

  it('matches optimum expansion to sea level', () => {
    const r = rocket({ ...base, mode: 'optimum', pa: 101325 });
    rel(r.CF, 1.5986, 1e-4);
    rel(r.areaRatio, 8.973, 1e-4);
    rel(r.Isp, 289.09, 1e-4);
    expect(r.CFpressure).toBeCloseTo(0, 12);
    // Independent: at optimum expansion Isp = ue / g0.
    rel(r.Isp, r.exitVelocity / 9.80665, 1e-12);
  });

  it('matches the rocket equation', () => {
    rel(deltaV(300, 3), 3232.1, 1e-5);
    rel(deltaV(300, 3), 300 * 9.80665 * Math.log(3), 1e-15);
    expect(rocket({ ...base, massRatio: 3 }).deltaV).toBeGreaterThan(3500);
  });

  it('finds the area ratio from an exit pressure, and back', () => {
    const fromPe = rocket({ ...base, mode: 'exitPressure', pe: 14610.5 });
    rel(fromPe.areaRatio, 40, 1e-4);
  });

  it('flags separation risk in a heavily overexpanded nozzle at sea level', () => {
    const r = rocket({ ...base, pa: 101325 });
    expect(r.separationRisk).toBe(true);
    expect(r.CFpressure).toBeLessThan(0);
    expect(r.plot[r.plot.length - 1]!.y).toBeGreaterThan(r.plot[0]!.y);
  });

  it('rejects impossible inputs', () => {
    expect(() => rocket({ ...base, Tc: 0 })).toThrow(AeroError);
    expect(() => rocket({ ...base, molarMass: -2 })).toThrow(AeroError);
    expect(() => rocket({ ...base, areaRatio: 0.5 })).toThrow(AeroError);
    expect(() => rocket({ ...base, gamma: 1 })).toThrow(AeroError);
    expect(() => rocket({ ...base, mode: 'optimum', pa: 0 })).toThrow(AeroError);
    expect(() => rocket({ ...base, mode: 'exitPressure', pe: 6e6 })).toThrow(AeroError);
    expect(() => deltaV(300, 0.5)).toThrow(AeroError);
  });
});
