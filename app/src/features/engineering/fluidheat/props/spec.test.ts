// The properties form end to end: values for water at 20 C and air at 300 K against published figures.
import { describe, expect, it } from 'vitest';
import { refuses, row, solver } from '../kit/testing';
import { propsSpec } from './spec';

const solve = solver(propsSpec);

describe('properties form', () => {
  it('water at 20 C: rho 998.2, mu 1.002 mPa s, k 0.598, cp 4182, Pr 7.0 (each within 3%)', () => {
    const o = solve();
    expect(row(o, 'density')).toBeCloseTo(998.2, 0);
    expect(Math.abs(row(o, 'viscosity') / 1.002e-3 - 1)).toBeLessThan(0.01);
    expect(Math.abs(row(o, 'conductivity') / 0.598 - 1)).toBeLessThan(0.01);
    expect(Math.abs(row(o, 'specificHeat') / 4182 - 1)).toBeLessThan(0.01);
    expect(Math.abs(row(o, 'prandtl') / 7.0 - 1)).toBeLessThan(0.03);
    expect(row(o, 'kinematic')).toBeCloseTo(row(o, 'viscosity') / row(o, 'density'), 15);
  });
  it('air at 300 K and 101.325 kPa: rho 1.177, nu 15.7e-6 m2/s, k 26.3e-3, Pr 0.707', () => {
    const o = solve({ fluid: 'air', temperature: '300 K' });
    expect(row(o, 'density')).toBeCloseTo(1.1768, 3);
    expect(Math.abs(row(o, 'kinematic') / 15.7e-6 - 1)).toBeLessThan(0.01);
    expect(row(o, 'conductivity')).toBeCloseTo(26.3e-3, 6);
    expect(row(o, 'expansion')).toBeCloseTo(1 / 300, 12);
  });
  it('works in US units too, and refuses a temperature outside the table', () => {
    expect(row(solve({ temperature: '68 °F' }, 'us'), 'density')).toBeCloseTo(998.2, 0);
    expect(refuses(propsSpec, { fluid: 'air', temperature: '900 K' })).toBe(true);
    expect(refuses(propsSpec, { temperature: '120 °C' })).toBe(true);
  });
});
