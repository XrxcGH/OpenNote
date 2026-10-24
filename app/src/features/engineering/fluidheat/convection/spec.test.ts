// The convection form end to end, checked against the published correlations written out again.
import { describe, expect, it } from 'vitest';
import { refuses, row, solver } from '../kit/testing';
import { convectionSpec } from './spec';

const solve = solver(convectionSpec);
const nu = 15.9e-6;
const pr = 0.71;
const k = 0.026;

describe('convection form', () => {
  it('the first problem is a laminar plate: Nu = 0.664 Re^0.5 Pr^(1/3), about 332 at Re 3.1e5', () => {
    const o = solve();
    const re = (5 * 1) / nu;
    const nuL = 0.664 * Math.sqrt(re) * pr ** (1 / 3);
    expect(row(o, 'reynolds')).toBeCloseTo(re, 6);
    expect(row(o, 'nusselt')).toBeCloseTo(nuL, 8);
    expect(row(o, 'nusselt')).toBeGreaterThan(331);
    expect(row(o, 'nusselt')).toBeLessThan(333);
    expect(row(o, 'h')).toBeCloseTo((nuL * k) / 1, 10);
  });
  it('a plate laminar then turbulent: Nu = (0.037 Re^0.8 - 871) Pr^(1/3), refused below Re 5e5', () => {
    const o = solve({ corrExt: 'plateMixed', velocity: '20 m/s' });
    const re = 20 / nu;
    expect(row(o, 'nusselt')).toBeCloseTo((0.037 * re ** 0.8 - 871) * pr ** (1 / 3), 8);
    expect(refuses(convectionSpec, { corrExt: 'plateMixed', velocity: '5 m/s' })).toBeTruthy();
    expect(refuses(convectionSpec, { corrExt: 'plateTurbulent', velocity: '5 m/s' })).toBeTruthy();
  });
  it('the evaporation example gives a Sherwood number from the mixed form at Re 1.26e6', () => {
    const o = solve({ transfer: 'mass', corrExt: 'plateMixed', velocity: '20 m/s', dab: '0.25 cm^2/s', sc: '0.63' });
    expect(row(o, 'sherwood')).toBeCloseTo((0.037 * (20 / nu) ** 0.8 - 871) * 0.63 ** (1 / 3), 6);
  });
  it('natural mass transfer is driven by delta rho / rho: Ra = g (drho/rho) L^3 / (nu D)', () => {
    const o = solve({
      transfer: 'mass',
      group: 'natural',
      corrNat: 'verticalPlateFull',
      length: '0.2 m',
      drho: '0.02',
      dab: '0.25 cm^2/s',
      nu: '15.9 mm^2/s',
      sc: '0.63',
    });
    const d = 15.9e-6 / 0.63;
    expect(row(o, 'rayleigh') / ((9.80665 * 0.02 * 0.2 ** 3) / (15.9e-6 * d))).toBeCloseTo(1, 10);
  });
  it('a laminar plate and a Gnielinski tube', () => {
    const lam = solve({ corrExt: 'plateLaminar', velocity: '1 m/s' });
    const re = 1 / nu;
    expect(row(lam, 'nusselt')).toBeCloseTo(0.664 * Math.sqrt(re) * pr ** (1 / 3), 10);
    const tube = solve({
      group: 'internal',
      corrInt: 'gnielinski',
      length: '25 mm',
      velocity: '1.5 m/s',
      k: '0.6 W/(m·K)',
      nu: '1.0 mm^2/s',
      pr: '7',
    });
    const re2 = (1.5 * 0.025) / 1e-6;
    const f = (0.79 * Math.log(re2) - 1.64) ** -2;
    const nuD = ((f / 8) * (re2 - 1000) * 7) / (1 + 12.7 * Math.sqrt(f / 8) * (7 ** (2 / 3) - 1));
    expect(row(tube, 'nusselt')).toBeCloseTo(nuD, 8);
    expect(row(tube, 'friction')).toBeCloseTo(f, 12);
  });
  it('natural convection on a vertical plate (Churchill-Chu) with 1/T film for the expansion coefficient', () => {
    const o = solve({
      group: 'natural',
      corrNat: 'verticalPlateFull',
      length: '0.5 m',
      tSurface: '60 °C',
      tFluid: '20 °C',
      k: '0.027 W/(m·K)',
      nu: '17 mm^2/s',
    });
    const beta = 1 / 313.15;
    const alpha = 17e-6 / pr;
    const ra = (9.80665 * beta * 40 * 0.5 ** 3) / (17e-6 * alpha);
    const nuL = (0.825 + (0.387 * ra ** (1 / 6)) / (1 + (0.492 / pr) ** (9 / 16)) ** (8 / 27)) ** 2;
    expect(row(o, 'rayleigh')).toBeCloseTo(ra, 0);
    expect(row(o, 'nusselt')).toBeCloseTo(nuL, 4);
    expect(
      row(
        solve({
          group: 'natural',
          corrNat: 'verticalPlateFull',
          length: '0.5 m',
          tSurface: '20 °C',
          tFluid: '60 °C',
          k: '0.027 W/(m·K)',
          nu: '17 mm^2/s',
        }),
        'rayleigh',
      ),
    ).toBeCloseTo(ra, 0);
  });
  it('mass transfer uses the Schmidt number and the diffusivity', () => {
    const o = solve({ transfer: 'mass' });
    const heat = solve({ pr: '0.63' });
    expect(row(o, 'sherwood')).toBeCloseTo(row(heat, 'nusselt'), 10);
    expect(row(o, 'hm')).toBeCloseTo(row(o, 'sherwood') * 2.5e-5, 12);
  });
  it('a tube with a fixed wall temperature obeys the energy balance', () => {
    const o = solve({ mode: 'tube' });
    const h = row(o, 'h');
    const tOut = 363.15 - (363.15 - 293.15) * Math.exp((-h * Math.PI * 0.025 * 3) / (0.1 * 4180));
    expect(row(o, 'tOut')).toBeCloseTo(tOut, 6);
    expect(row(o, 'heat')).toBeCloseTo(0.1 * 4180 * (tOut - 293.15), 3);
  });
  it('a tube with a fixed heat flux', () => {
    const o = solve({ mode: 'tube', wall: 'flux', wallFlux: '5000 W/m²' });
    expect(row(o, 'heat')).toBeCloseTo(5000 * Math.PI * 0.025 * 3, 6);
    expect(row(o, 'tOut')).toBeCloseTo(293.15 + row(o, 'heat') / (0.1 * 4180), 6);
  });
  it('warns outside a correlation’s range', () => {
    expect(solve({ corrExt: 'plateLaminar', velocity: '50 m/s' }).notes).toContain('fhConvWarnTurbulent');
    expect(solve({ group: 'internal', corrInt: 'dittusBoelter', velocity: '0.01 m/s' }).notes).toContain(
      'fhConvWarnRange',
    );
  });
  it('refuses impossible input', () => {
    expect(refuses(convectionSpec, { velocity: '0 m/s' })).toBe(true);
    expect(refuses(convectionSpec, { length: '0 m' })).toBe(true);
    expect(refuses(convectionSpec, { group: 'natural', tSurface: '20 °C', tFluid: '20 °C' })).toBe(true);
    expect(refuses(convectionSpec, { group: 'internal', corrInt: 'tubeEntry' })).toBe(true);
    expect(refuses(convectionSpec, { pr: '-1' })).toBe(true);
    expect(refuses(convectionSpec, { mode: 'tube', massFlow: '0 kg/s' })).toBe(true);
    expect(refuses(convectionSpec, { mode: 'tube', cp: '0 kJ/(kg·K)' })).toBe(true);
    expect(refuses(convectionSpec, { k: '0.026 kg' })).toBe(true);
  });
});
