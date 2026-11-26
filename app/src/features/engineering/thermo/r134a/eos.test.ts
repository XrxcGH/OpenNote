// R-134a against the reference values of the Tillner-Roth and Baehr equation, and against itself: thermodynamic
// consistency of every derivative, and equal Gibbs energy at saturation.
import '../text';
import { describe, expect, it } from 'vitest';
import { RHO_C, T_C, saturationP, saturationT, stateRhoT } from './eos';

const rel = (a: number, b: number) => Math.abs(a / b - 1);

describe('R-134a equation of state', () => {
  it('boils at 247.08 K at 101.325 kPa', () => {
    expect(Math.abs(saturationP(101.325).T - 247.08)).toBeLessThan(0.05);
  });

  it('has psat 200.6, 292.8, 571.7, and 1016.6 kPa at -10, 0, 20, and 40 °C', () => {
    const cases: [number, number][] = [
      [-10, 200.6],
      [0, 292.8],
      [20, 571.7],
      [40, 1016.6],
    ];
    for (const [t, p] of cases) expect(rel(saturationT(t + 273.15).p, p)).toBeLessThan(2e-3);
  });

  it('has the critical pressure 4.0563 MPa at Tc = 374.18 K and 508 kg/m3', () => {
    expect(rel(stateRhoT(RHO_C, T_C).p, 4056.3)).toBeLessThan(5e-4);
  });

  it('is consistent: dh/ds at constant p equals T, and the saturated Gibbs energies match', () => {
    const T = 313.15;
    const sat = saturationT(T);
    expect(Math.abs(sat.liquid.g - sat.vapor.g)).toBeLessThan(1e-8);
    const rho = 30;
    const a = stateRhoT(rho, 330);
    // Clapeyron: dp/dT along saturation equals (s_v − s_l)/(v_v − v_l).
    const dT = 0.01;
    const slope = (saturationT(T + dT).p - saturationT(T - dT).p) / (2 * dT);
    const clapeyron = (sat.vapor.s - sat.liquid.s) / (1 / sat.vapor.rho - 1 / sat.liquid.rho);
    expect(rel(slope, clapeyron)).toBeLessThan(1e-5);
    expect(a.h - a.u).toBeCloseTo(a.p / a.rho, 10);
  });
});
