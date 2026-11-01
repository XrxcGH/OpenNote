import '../text';
import { describe, expect, it } from 'vitest';
import { AeroError } from '../common';
import { atmosphere, geopotentialOf, standard } from './engine';

const rel = (actual: number, expected: number, tol: number) =>
  expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThan(tol);

const at = (km: number, kind: 'geometric' | 'geopotential' = 'geopotential', dT = 0) =>
  atmosphere({ mode: 'altitude', altitude: km * 1000, kind, dT });

describe('standard atmosphere', () => {
  it('matches sea level', () => {
    const r = at(0);
    rel(r.T, 288.15, 1e-5);
    rel(r.p, 101325, 1e-5);
    rel(r.rho, 1.225, 1e-5);
    rel(r.a, 340.294, 1e-5);
    rel(r.mu, 1.7894e-5, 1e-4);
    expect(r.layer).toBe('troposphere');
  });

  it('matches 5 km geopotential, and an independent power-law calculation', () => {
    const r = at(5);
    rel(r.T, 255.65, 1e-5);
    rel(r.p, 54019.9, 1e-5);
    rel(r.rho, 0.73612, 1e-5);
    const R = 8314.32 / 28.9644;
    rel(r.p, 101325 * Math.pow(255.65 / 288.15, 9.80665 / (R * 0.0065)), 1e-12);
  });

  it('matches 11 km geopotential', () => {
    const r = at(11);
    rel(r.T, 216.65, 1e-5);
    rel(r.p, 22632.06, 1e-5);
    rel(r.rho, 0.363918, 1e-5);
    rel(r.a, 295.07, 1e-5);
  });

  it('matches 20 km and 32 km geopotential', () => {
    rel(at(20).p, 5474.89, 1e-5);
    const r = at(32);
    rel(r.p, 868.019, 1e-5);
    rel(r.T, 228.65, 1e-5);
  });

  it('converts geometric 10 km to geopotential', () => {
    rel(geopotentialOf(10000) / 1000, 9.98429, 1e-6);
    rel(at(10, 'geometric').H / 1000, 9.98429, 1e-6);
  });

  it('is continuous at every layer boundary', () => {
    for (const H of [11000, 20000, 32000, 47000, 51000, 71000]) {
      const below = standard(H - 1e-6);
      const above = standard(H + 1e-6);
      rel(above.p, below.p, 1e-9);
      expect(Math.abs(above.T - below.T)).toBeLessThan(1e-6);
    }
  });

  it('reaches 86 km geometric with the published kinetic temperature', () => {
    const r = at(86, 'geometric');
    // USSA 1976 Table I at 86 km: T = 186.87 K, mu = 1.2529e-5 Pa s, rho = 6.958e-6 kg/m^3. TM there is 186.946 K.
    expect(Math.abs(r.T - 186.87)).toBeLessThan(5e-3);
    rel(r.mu, 1.2529e-5, 1e-4);
    rel(r.rho, 6.958e-6, 1e-3);
    // The speed of sound is defined with TM, not T.
    rel(r.a, Math.sqrt(1.4 * (8314.32 / 28.9644) * 186.946), 1e-5);
    expect(r.layer).toBe('mesosphere2');
  });

  it('inverts pressure, density and temperature', () => {
    const p = atmosphere({ mode: 'pressure', value: 54019.9 });
    expect(Math.abs(p.H - 5000)).toBeLessThan(0.05);
    const d = atmosphere({ mode: 'density', value: 0.363918 });
    expect(Math.abs(d.H - 11000)).toBeLessThan(0.05);
    const t = atmosphere({ mode: 'temperature', value: 255.65 });
    expect(Math.abs(t.H - 5000)).toBeLessThan(1e-3);
  });

  it('applies a temperature offset at standard pressure (density altitude goes up on a hot day)', () => {
    const hot = at(0, 'geopotential', 20);
    rel(hot.T, 308.15, 1e-12);
    rel(hot.p, 101325, 1e-12);
    rel(hot.rho, 101325 / ((8314.32 / 28.9644) * 308.15), 1e-12);
    const densityAltitude = atmosphere({ mode: 'density', value: hot.rho });
    // About 120 ft per degree above standard: 20 K gives roughly 700 m.
    expect(densityAltitude.H).toBeGreaterThan(600);
    expect(densityAltitude.H).toBeLessThan(800);
    const s = standard(densityAltitude.H);
    rel(s.p / ((8314.32 / 28.9644) * s.T), hot.rho, 1e-9);
  });

  it('reports out-of-range and impossible inputs with a code', () => {
    expect(() => at(90)).toThrow(AeroError);
    expect(() => at(-6, 'geometric')).toThrow(AeroError);
    expect(() => atmosphere({ mode: 'pressure', value: 0 })).toThrow(AeroError);
    expect(() => atmosphere({ mode: 'pressure', value: -5 })).toThrow(AeroError);
    expect(() => atmosphere({ mode: 'pressure', value: 1e9 })).toThrow(AeroError);
    expect(() => atmosphere({ mode: 'temperature', value: 150 })).toThrow(AeroError);
    expect(() => at(0, 'geopotential', -300)).toThrow(AeroError);
    expect(() => atmosphere({ mode: 'altitude', altitude: Number.NaN })).toThrow(AeroError);
  });

  it('shows the layer formula in the steps', () => {
    const r = at(25);
    expect(r.steps.map((s) => s.key)).toContain('atmPressureLapse');
    expect(at(15).steps.map((s) => s.key)).toContain('atmPressureIso');
    expect(r.plot.T.length).toBeGreaterThan(100);
  });
});
