import '../text';
import { describe, expect, it } from 'vitest';
import { CalcError } from '../numeric';
import { AIR_TABLE, WATER_TABLE, air, water, waterDensity } from './engine';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('the property tables', () => {
  it('every row agrees with its own Prandtl number: Pr = cp mu / k to 1%', () => {
    for (const [t, mu, k, cp, pr] of [...WATER_TABLE, ...AIR_TABLE])
      expect(rel((cp * mu) / k, pr), `${t} K`).toBeLessThan(0.01);
  });
  it('water density follows the Kell formula: 998.2071 at 20 C, 999.972 at 4 C, 958.35 at 100 C', () => {
    expect(rel(waterDensity(20), 998.2071)).toBeLessThan(1e-5);
    expect(rel(waterDensity(4), 999.972)).toBeLessThan(1e-5);
    expect(rel(waterDensity(100), 958.35)).toBeLessThan(2e-4);
  });
  it('water at 20 C: viscosity 1.002 mPa s, conductivity 0.598, cp 4.18, beta 2.07e-4, Pr 7.0', () => {
    const w = water(293.15);
    expect(rel(w.viscosity, 1.002e-3)).toBeLessThan(0.01);
    expect(rel(w.conductivity, 0.598)).toBeLessThan(0.01);
    expect(rel(w.specificHeat, 4182)).toBeLessThan(0.01);
    expect(rel(w.expansion, 2.07e-4)).toBeLessThan(0.02);
    expect(rel(w.prandtl, 7.0)).toBeLessThan(0.03);
  });
  it('water is at its densest near 4 C, where beta is about zero', () => {
    expect(Math.abs(water(277.15).expansion)).toBeLessThan(2e-5);
  });
  it('a table row reads back exactly', () => {
    const w = water(320);
    expect(w.viscosity).toBeCloseTo(577e-6, 12);
    expect(w.conductivity).toBeCloseTo(0.64, 12);
  });
  it('air is an ideal gas: rho = p / (287.05 T), 1.1768 at 300 K and 1 atm, beta = 1/T', () => {
    const a = air(300);
    expect(rel(a.density, 101325 / (287.05 * 300))).toBeLessThan(1e-12);
    expect(rel(a.density, 1.1768)).toBeLessThan(1e-3);
    expect(a.expansion).toBeCloseTo(1 / 300, 14);
    expect(rel(air(300, 202650).density, 2 * a.density)).toBeLessThan(1e-12);
  });
  it('air viscosity matches the Sutherland law within 1.5% across the table', () => {
    for (const t of [250, 300, 350, 400, 450, 500, 600]) {
      const sutherland = 1.716e-5 * (t / 273.15) ** 1.5 * ((273.15 + 110.4) / (t + 110.4));
      expect(rel(air(t).viscosity, sutherland), `${t} K`).toBeLessThan(0.015);
    }
  });
  it('air Prandtl number is about 0.71 at 300 K and 0.69 at 400 K', () => {
    expect(rel(air(300).prandtl, 0.707)).toBeLessThan(0.01);
    expect(rel(air(400).prandtl, 0.69)).toBeLessThan(0.01);
  });
  it('refuses a temperature outside the table', () => {
    expect(() => water(380)).toThrow(CalcError);
    expect(() => water(260)).toThrow(/covers/);
    expect(() => air(900)).toThrow(CalcError);
    expect(() => air(300, 0)).toThrow(CalcError);
  });
});
