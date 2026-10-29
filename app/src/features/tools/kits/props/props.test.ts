// Air and liquid water against the check values the IAPWS releases publish, the planned values, and an independent
// evaluation of the same formulas in Python.
import { describe, expect, it } from 'vitest';
import { air, airCp } from './air';
import { liquidWater, waterConductivity, waterSaturationPressure, waterViscosity } from './water';

const relative = (actual: number, expected: number, tol: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol * Math.abs(expected));

describe('air', () => {
  it('gives the planned properties at 300 K and 101.325 kPa', () => {
    const a = air(300, 101325);
    relative(a.mu, 1.846e-5, 1e-4);
    relative(a.k, 0.026252, 1e-4);
    relative(a.rho, 1.1767, 1e-4);
    relative(a.cp, 1004.8, 2e-3);
    relative(a.Pr, (a.cp * a.mu) / a.k, 1e-15);
    relative(a.a, 347.2, 2e-3);
    expect(a.cpOutOfRange).toBe(false);
    expect(a.source).toMatch(/Standard Atmosphere 1976/);
  });

  it('interpolates cp between table points and flags it outside 250 to 1000 K', () => {
    relative(airCp(450).cp, 1020.7, 1e-3);
    expect(airCp(1200).outOfRange).toBe(true);
    expect(airCp(200).outOfRange).toBe(true);
  });

  it('refuses zero, negative, and non-finite states', () => {
    expect(() => air(0, 101325)).toThrow(/domain/);
    expect(() => air(300, -5)).toThrow(/domain/);
    expect(() => air(NaN, 1)).toThrow(/notFinite/);
  });
});

describe('liquid water', () => {
  it('reproduces the IAPWS R12-08 and R15-11 check values', () => {
    relative(waterViscosity(298.15, 998), 889.7351e-6, 1e-8);
    relative(waterViscosity(373.15, 1000), 307.883622e-6, 1e-8);
    relative(waterConductivity(298.15, 998), 0.607712868, 1e-8);
    relative(waterConductivity(298.15, 1200), 0.799038144, 1e-8);
  });

  it('reproduces the IAPWS-IF97 saturation check values', () => {
    relative(waterSaturationPressure(300), 0.353658941e4, 1e-8);
    relative(waterSaturationPressure(500), 0.263889776e7, 1e-8);
    relative(waterSaturationPressure(600), 0.123443146e8, 1e-8);
  });

  it('reproduces the IAPWS-IF97 region 1 check values', () => {
    const a = liquidWater(300, 3e6);
    relative(1 / a.rho, 0.100215168e-2, 1e-8);
    relative(a.h, 0.115331273e6, 1e-8);
    relative(a.cp, 0.417301218e4, 1e-8);
    const b = liquidWater(500, 3e6);
    relative(1 / b.rho, 0.1202418e-2, 1e-8);
    relative(b.cp, 0.465580682e4, 1e-8);
  });

  it('gives the planned viscosity at 20 and 25 °C and conductivity at 25 °C', () => {
    const w20 = liquidWater(293.15, 101325);
    const w25 = liquidWater(298.15, 101325);
    relative(w20.mu, 1.0016e-3, 3e-3);
    relative(w25.mu, 0.89e-3, 3e-3);
    relative(w25.k, 0.607, 5e-3);
    relative(w20.rho, 998.2060924679477, 1e-10);
    relative(w25.Pr, (w25.cp * w25.mu) / w25.k, 1e-15);
  });

  // NIST Chemistry WebBook saturated liquid, which uses IAPWS-95 with R12-08 and R15-11 (critical enhancement included).
  // IF97 sits within about 1e-4 of IAPWS-95 here. Before λ₂ was added, k at 300 °C came out 1.2% low (0.54603).
  it.each([
    [373.15, 101418, 958.34905, 4215.6736, 281.58201e-6, 0.67721051],
    [473.15, 1554927.9, 864.6581, 4495.8426, 134.58413e-6, 0.6600148],
    [573.15, 8587904.9, 712.13564, 5750.4003, 85.855388e-6, 0.55264602],
  ])('gives saturated liquid at %d K as published from IAPWS-95', (T, p, rho, cp, mu, k) => {
    const w = liquidWater(T);
    relative(w.p, p, 2e-4);
    relative(w.rho, rho, 5e-5);
    relative(w.cp, cp, 5e-4);
    relative(w.mu, mu, 2e-4);
    relative(w.k, k, 1e-4);
  });

  it('refuses steam, ice, and pressures past the formulation', () => {
    expect(() => liquidWater(393.15, 101325)).toThrow(/steam/);
    expect(() => liquidWater(250, 101325)).toThrow(/domain/);
    expect(() => liquidWater(300, 2e8)).toThrow(/100 MPa/);
    expect(() => liquidWater(700)).toThrow(/domain/);
  });
});
