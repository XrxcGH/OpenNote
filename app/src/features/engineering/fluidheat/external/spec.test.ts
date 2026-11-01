// The external flow form end to end, checked against closed forms.
import '../text';
import { describe, expect, it } from 'vitest';
import { refuses, row, solver } from '../kit/testing';
import { externalSpec } from './spec';

const solve = solver(externalSpec);

describe('external flow form', () => {
  it('a slow laminar plate follows the Blasius results', () => {
    const o = solve({ speed: '1 m/s', plateLength: '0.5 m', nu: '15 mm^2/s', plateWidth: '2 m' });
    const re = (1 * 0.5) / 15e-6;
    expect(row(o, 'reL')).toBeCloseTo(re, 6);
    expect(row(o, 'cfAverage')).toBeCloseTo(1.328 / Math.sqrt(re), 12);
    expect(row(o, 'delta')).toBeCloseTo((5 * 0.5) / Math.sqrt(re), 12);
    expect(row(o, 'drag')).toBeCloseTo((1.328 / Math.sqrt(re)) * 0.5 * 1.2 * 1 * 0.5 * 2, 10);
    expect(o.rows.find((r) => r.id === 'regime')?.word).toBe('laminar');
  });
  it('a tripped plate is turbulent from the start', () => {
    const o = solve({ speed: '10 m/s', plateLength: '1 m', tripped: 'yes' });
    expect(o.rows.find((r) => r.id === 'regime')?.word).toBe('turbulent');
    expect(row(o, 'cfAverage')).toBeCloseTo(0.074 * (10 / 15e-6) ** -0.2, 12);
  });
  it('sphere terminal speed balances weight, buoyancy and drag', () => {
    const o = solve({ mode: 'sphere' });
    const d = 0.005;
    const v = row(o, 'velocity');
    const net = ((7800 - 998) * 9.80665 * Math.PI * d ** 3) / 6;
    const drag = row(o, 'cd') * 0.5 * 998 * v * v * ((Math.PI * d ** 2) / 4);
    expect(drag).toBeCloseTo(net, 8);
    expect(row(o, 'cd')).toBe(0.44);
    const small = solve({ mode: 'sphere', diameter: '0.5 mm' });
    const re = row(small, 're');
    expect(re).toBeLessThan(800);
    expect(row(small, 'cd')).toBeCloseTo((24 / re) * (1 + 0.15 * re ** 0.687), 12);
    expect(re).toBeCloseTo((998 * row(small, 'velocity') * 0.0005) / 1e-3, 8);
  });
  it('Stokes terminal speed matches the closed form, and a light sphere rises', () => {
    const o = solve({
      mode: 'sphere',
      model: 'stokes',
      diameter: '0.1 mm',
      sphereDensity: '2500 kg/m^3',
      viscosity: '1 mPa·s',
    });
    expect(row(o, 'velocity')).toBeCloseTo(((2500 - 998) * 9.80665 * 1e-8) / (18 * 1e-3), 10);
    const bubble = solve({ mode: 'sphere', sphereDensity: '500 kg/m^3', diameter: '1 mm' });
    expect(bubble.rows.find((r) => r.id === 'direction')?.word).toBe('rises');
  });
  it('body drag and power', () => {
    const o = solve({ mode: 'body', speed: '30 m/s' });
    expect(row(o, 'drag')).toBeCloseTo(0.3 * 0.5 * 1.2 * 30 ** 2 * 2.2, 9);
    expect(row(o, 'power')).toBeCloseTo(row(o, 'drag') * 30, 9);
  });
  it('refuses impossible input', () => {
    expect(refuses(externalSpec, { plateLength: '0 m' })).toBe(true);
    expect(refuses(externalSpec, { speed: '-3 m/s' })).toBe(true);
    expect(refuses(externalSpec, { mode: 'sphere', sphereDensity: '998 kg/m^3' })).toBe(true);
    expect(refuses(externalSpec, { mode: 'body', cd: '0' })).toBe(true);
    expect(refuses(externalSpec, { mode: 'sphere', diameter: '5 s' })).toBe(true);
  });
});
