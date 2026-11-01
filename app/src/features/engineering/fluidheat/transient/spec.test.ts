// The transient conduction form end to end, checked against closed forms, then by round trip.
import '../text';
import { describe, expect, it } from 'vitest';
import { refuses, row, solver } from '../kit/testing';
import { transientSpec } from './spec';

const solve = solver(transientSpec);

/** erf by the Abramowitz and Stegun series, accurate to 1.5e-7. */
function erf(x: number): number {
  const t = 1 / (1 + 0.3275911 * x);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return 1 - poly * Math.exp(-x * x);
}

describe('mass diffusion mode', () => {
  it('semi-infinite solid with a held surface: C = Cs + (Ci - Cs) erf(x / 2 sqrt(D t)) = 55.6187 kg/m3 (SciPy)', () => {
    const o = solve({
      mode: 'semi',
      quantity: 'diffusion',
      surface: 'temperature',
      dab: '1.6e-11 m^2/s',
      cInitial: '15.6 kg/m^3',
      cSurface: '78 kg/m^3',
      depth: '0.5 mm',
      time: '36000 s',
    });
    expect(row(o, 'concentration')).toBeCloseTo(55.61865913746451, 5);
    expect(row(o, 'eta')).toBeCloseTo(0.3294039229342062, 6);
    const step = o.steps.find((x) => x.key === 'fhTransSemiCS');
    expect(step?.vars?.T).toEqual({ v: row(o, 'concentration'), k: 'density' });
    expect(step?.math).not.toMatch(/T_|\\alpha/);
    expect(o.rows.some((r) => r.id === 'temperature')).toBe(false);
  });
  it('lumped solid: tau = Lc / hm, Bi_m = hm Lc / D, and C = Cinf + (Ci - Cinf) exp(-t / tau)', () => {
    const o = solve({
      quantity: 'diffusion',
      dab: '1e-9 m^2/s',
      hm: '1e-6 m/s',
      cInitial: '10 kg/m^3',
      cFluid: '2 kg/m^3',
      time: '100 s',
    });
    const lc = 0.005 / 3;
    const tau = lc / 1e-6;
    expect(row(o, 'tau')).toBeCloseTo(tau, 9);
    expect(row(o, 'biotMass')).toBeCloseTo((1e-6 * lc) / 1e-9, 9);
    expect(row(o, 'concentration')).toBeCloseTo(2 + 8 * Math.exp(-100 / tau), 9);
  });
  it('plane wall: Bi_m = hm L / D = 2 and Fo_m = D t / L^2 = 0.25', () => {
    const o = solve({
      mode: 'solid',
      shape: 'wall',
      size: '2 mm',
      quantity: 'diffusion',
      dab: '1e-9 m^2/s',
      hm: '1e-6 m/s',
      cInitial: '10 kg/m^3',
      cFluid: '0 kg/m^3',
      position: '0',
      time: '1000 s',
    });
    expect(row(o, 'biotMass')).toBeCloseTo(2, 9);
    expect(row(o, 'fourierMass')).toBeCloseTo(0.25, 9);
    expect(row(o, 'centerConcentration')).toBeLessThan(10);
  });
  it('heat mode is unchanged and still has no concentration rows', () => {
    expect(solve().rows.some((r) => r.id === 'concentration')).toBe(false);
  });
});

describe('transient conduction form', () => {
  it('lumped sphere: tau = rho cp (R/3) / h and T = Tinf + (Ti - Tinf) exp(-t / tau)', () => {
    const o = solve();
    const tau = (8933 * 385 * (0.005 / 3)) / 100;
    expect(row(o, 'tau')).toBeCloseTo(tau, 9);
    expect(row(o, 'biot')).toBeCloseTo((100 * (0.005 / 3)) / 400, 12);
    expect(row(o, 'temperature')).toBeCloseTo(298.15 + 75 * Math.exp(-100 / tau), 9);
  });
  it('lumped time to a target temperature, and the temperature there', () => {
    const o = solve({ target: '50 °C' });
    const tau = (8933 * 385 * (0.005 / 3)) / 100;
    expect(row(o, 'timeToTarget')).toBeCloseTo(-tau * Math.log(25 / 75), 8);
  });
  it('warns when the Biot number is too large for the lumped model', () => {
    const o = solve({ h: '50000 W/(m²·K)', k: '1 W/(m·K)' });
    expect(o.notes).toContain('fhTransWarnBiot');
    expect(o.rows.find((r) => r.id === 'valid')?.word).toBe('invalid');
  });
});

describe('transient conduction form, solids', () => {
  it('a plane wall at late times follows the one-term solution', () => {
    const o = solve({
      mode: 'solid',
      shape: 'wall',
      size: '25 mm',
      alpha: '1.2e-5 m^2/s',
      k: '45 W/(m·K)',
      h: '500 W/(m²·K)',
      tInitial: '300 °C',
      tFluid: '30 °C',
      time: '60 s',
    });
    const bi = (500 * 0.025) / 45;
    const fo = (1.2e-5 * 60) / 0.025 ** 2;
    let lo = 1e-9;
    let hi = Math.PI / 2 - 1e-9;
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2;
      if (mid * Math.tan(mid) < bi) lo = mid;
      else hi = mid;
    }
    const z = lo;
    const c1 = (4 * Math.sin(z)) / (2 * z + Math.sin(2 * z));
    const center = c1 * Math.exp(-z * z * fo);
    expect(row(o, 'biot')).toBeCloseTo(bi, 12);
    expect(row(o, 'fourier')).toBeCloseTo(fo, 12);
    expect(Math.abs(row(o, 'center') - (303.15 + 270 * center))).toBeLessThan(0.05);
    expect(row(o, 'surface')).toBeLessThan(row(o, 'center'));
  });
  it('the time found for a target gives the target back', () => {
    const base = {
      mode: 'solid',
      shape: 'cylinder',
      size: '20 mm',
      alpha: '1e-5 m^2/s',
      k: '40 W/(m·K)',
      h: '200 W/(m²·K)',
      tInitial: '500 °C',
      tFluid: '20 °C',
    };
    const found = solve({ ...base, target: '200 °C', time: '' });
    const t = row(found, 'timeToTarget');
    const back = solve({ ...base, time: `${t} s`, target: '' });
    expect(row(back, 'temperature')).toBeCloseTo(473.15, 5);
  });
  it('the semi-infinite solid with a fixed surface temperature', () => {
    const o = solve({
      mode: 'semi',
      alpha: '5e-7 m^2/s',
      k: '1.5 W/(m·K)',
      tInitial: '10 °C',
      depth: '0.5 m',
      time: '86400 s',
      tSurface: '30 °C',
    });
    const eta = 0.5 / (2 * Math.sqrt(5e-7 * 86400));
    expect(row(o, 'eta')).toBeCloseTo(eta, 12);
    expect(Math.abs(row(o, 'temperature') - (303.15 + (283.15 - 303.15) * erf(eta)))).toBeLessThan(1e-5);
  });
  it('constant surface flux warms the surface by 2 q sqrt(alpha t / pi) / k', () => {
    const o = solve({
      mode: 'semi',
      surface: 'flux',
      alpha: '5e-7 m^2/s',
      k: '1.5 W/(m·K)',
      tInitial: '10 °C',
      depth: '0 m',
      time: '3600 s',
      flux: '1000 W/m²',
    });
    expect(row(o, 'temperature')).toBeCloseTo(283.15 + (2 * 1000 * Math.sqrt((5e-7 * 3600) / Math.PI)) / 1.5, 6);
  });
  it('refuses impossible input', () => {
    expect(refuses(transientSpec, { time: '', target: '' })).toBe(true);
    expect(refuses(transientSpec, { tInitial: '25 °C' })).toBe(true);
    expect(refuses(transientSpec, { target: '10 °C' })).toBe(true);
    expect(refuses(transientSpec, { size: '0 mm' })).toBe(true);
    expect(refuses(transientSpec, { mode: 'solid', position: '1.5' })).toBe(true);
    expect(refuses(transientSpec, { mode: 'solid', time: '-5 s' })).toBe(true);
    expect(refuses(transientSpec, { mode: 'semi', depth: '-1 m' })).toBe(true);
    expect(refuses(transientSpec, { mode: 'semi', time: '' })).toBe(true);
  });
});
