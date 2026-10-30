// The conduction form end to end, checked against hand-built thermal circuits.
import { describe, expect, it } from 'vitest';
import { refuses, row, solver } from '../kit/testing';
import { conductionSpec } from './spec';

const solve = solver(conductionSpec);
const SIGMA = 5.670374419e-8;

describe('conduction form', () => {
  it('a brick and insulation wall: q = dT / (1/hA + sum L/kA + 1/hA)', () => {
    const o = solve();
    const r = 1 / (10 * 10) + 0.2 / (0.72 * 10) + 0.05 / (0.04 * 10) + 1 / (25 * 10);
    expect(row(o, 'resistance')).toBeCloseTo(r, 12);
    expect(row(o, 'heat')).toBeCloseTo(30 / r, 9);
    expect(o.tables![0].rows).toHaveLength(4);
  });
  it('contact resistance between layers adds in series', () => {
    const o = solve({ layers: '200 mm, 0.72 W/(m·K), 0.002\n50 mm, 0.04 W/(m·K), 0' });
    expect(row(o, 'resistance')).toBeCloseTo(row(solve(), 'resistance') + 0.002 / 10, 12);
  });
  it('a tube with insulation uses the logarithmic resistance', () => {
    const o = solve({
      geometry: 'cylinder',
      cylinderLength: '10 m',
      innerRadius: '25 mm',
      layers: '30 mm, 0.05 W/(m·K), 0',
      tInner: '120 °C',
      tOuter: '20 °C',
      hInner: '',
      hOuter: '10 W/(m²·K)',
    });
    const r = Math.log(30 / 25) / (2 * Math.PI * 0.05 * 10) + 1 / (10 * 2 * Math.PI * 0.03 * 10);
    // The layer size is the outer radius: 30 mm.
    expect(row(o, 'resistance')).toBeCloseTo(r, 10);
    expect(row(o, 'heat')).toBeCloseTo(100 / r, 7);
  });
  it('a sphere uses (1/r1 - 1/r2) / (4 pi k)', () => {
    const o = solve({
      geometry: 'sphere',
      innerRadius: '50 mm',
      layers: '100 mm, 0.5 W/(m·K), 0',
      hInner: '',
      hOuter: '',
      tInner: '100 °C',
      tOuter: '20 °C',
    });
    const r = (1 / 0.05 - 1 / 0.1) / (4 * Math.PI * 0.5);
    expect(row(o, 'heat')).toBeCloseTo(80 / r, 8);
  });
  it('critical radius is k/h for a cylinder and 2k/h for a sphere', () => {
    expect(row(solve({ mode: 'critical', geometryShell: 'cylinder' }), 'radius')).toBeCloseTo(0.004, 14);
    expect(row(solve({ mode: 'critical', geometryShell: 'sphere' }), 'radius')).toBeCloseTo(0.008, 14);
  });
  it('a heated wire: T max = Ts + q r0^2 / 4k with Ts = Tf + q r0 / 2h', () => {
    const o = solve({
      mode: 'generation',
      geometry: 'cylinder',
      size: '2.5 mm',
      k: '15 W/(m·K)',
      qGen: '1e8 W/m^3',
      hGen: '5000 W/(m²·K)',
      tFluidGen: '25 °C',
      tSurfaceGen: '',
    });
    const ts = 298.15 + (1e8 * 0.0025) / (2 * 5000);
    expect(row(o, 'tSurface')).toBeCloseTo(ts, 9);
    expect(row(o, 'tMax')).toBeCloseTo(ts + (1e8 * 0.0025 ** 2) / (4 * 15), 9);
  });
  it('the linearized radiation coefficient', () => {
    const o = solve({ mode: 'radiation' });
    expect(row(o, 'hr')).toBeCloseTo(0.8 * SIGMA * (400 + 300) * (400 ** 2 + 300 ** 2), 12);
    expect(row(o, 'flux')).toBeCloseTo(row(o, 'hr') * 100, 9);
    const same = solve({ mode: 'radiation', tSurface: '300 K' });
    expect(row(same, 'flux')).toBe(0);
  });
  it('refuses impossible input', () => {
    expect(refuses(conductionSpec, { layers: '0 mm, 1 W/(m·K), 0' })).toBe(true);
    expect(refuses(conductionSpec, { layers: '' })).toBe(true);
    expect(refuses(conductionSpec, { layers: '10 mm, 1 W/(m·K)' })).toBe(true);
    expect(refuses(conductionSpec, { geometry: 'cylinder', innerRadius: '50 mm', layers: '30 mm, 1 W/(m·K), 0' })).toBe(
      true,
    );
    expect(refuses(conductionSpec, { area: '0 m^2' })).toBe(true);
    expect(refuses(conductionSpec, { mode: 'critical', h: '0' })).toBe(true);
    expect(refuses(conductionSpec, { mode: 'radiation', emissivity: '1.5' })).toBe(true);
    expect(refuses(conductionSpec, { mode: 'radiation', tSurface: '-5 K' })).toBe(true);
    expect(refuses(conductionSpec, { mode: 'generation', hGen: '', tSurfaceGen: '' })).toBe(true);
    expect(refuses(conductionSpec, { tInner: '5 kg' })).toBe(true);
  });
});
