// The radiation form end to end.
import '../text';
import { describe, expect, it } from 'vitest';
import { refuses, row, solver } from '../kit/testing';
import { radiationSpec } from './spec';

const solve = solver(radiationSpec);
const SIGMA = 5.670374419e-8;
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('radiation form', () => {
  it('a 5800 K blackbody: peak 0.49962 um, Eb 6.4169e7 W/m2, 36.766 percent between 0.4 and 0.7 um', () => {
    const o = solve();
    expect(rel(row(o, 'peak') * 1e6, 0.49962)).toBeLessThan(1e-4);
    expect(rel(row(o, 'emissive'), 6.4169e7)).toBeLessThan(1e-4);
    expect(rel(row(o, 'fraction'), 0.36766)).toBeLessThan(1e-4);
    expect(row(o, 'emissive')).toBeCloseTo(SIGMA * 5800 ** 4, 0);
    expect(o.picture?.type).toBe('plot');
  });
  it('a bare wavelength is in micrometers and a single wavelength gives the spectral power', () => {
    const o = solve({ lambda1: '2', lambda2: '' });
    const x = 0.014387769 / (2e-6 * 5800);
    const planck = (2 * Math.PI * 6.62607015e-34 * 299792458 ** 2) / (2e-6 ** 5 * Math.expm1(x));
    expect(rel(row(o, 'spectral'), planck)).toBeLessThan(1e-6);
  });
  it('view factors: coaxial disks, rectangles, and concentric bodies', () => {
    expect(Math.abs(row(solve({ mode: 'view' }), 'f12') - 0.17157)).toBeLessThan(1e-5);
    expect(Math.abs(row(solve({ mode: 'view', shape: 'parallel' }), 'f12') - 0.19982)).toBeLessThan(1e-4);
    expect(Math.abs(row(solve({ mode: 'view', shape: 'perpendicular' }), 'f12') - 0.20004)).toBeLessThan(1e-4);
    expect(row(solve({ mode: 'view', shape: 'cylinders' }), 'f21')).toBeCloseTo(1 / 3, 14);
    expect(row(solve({ mode: 'view', shape: 'spheres' }), 'f21')).toBeCloseTo(1 / 9, 14);
    const unequal = solve({ mode: 'view', dr1: '1 m', dr2: '0.2 m', dh: '5 m' });
    expect(row(unequal, 'f12') * Math.PI * 1).toBeCloseTo(row(unequal, 'f21') * Math.PI * 0.04, 12);
  });
  it('large parallel plates: 10269 W/m2', () => {
    const o = solve({ mode: 'two' });
    expect(rel(row(o, 'q12'), 10269)).toBeLessThan(1e-4);
    expect(row(o, 'rSurface1')).toBeCloseTo(0.25, 12);
  });
  it('shields with equal emissivities divide the flux by N + 1, and list their temperatures', () => {
    const base = { mode: 'shields', t1: '800 K', t2: '400 K', e1: '0.7', e2: '0.7', eShield: '0.7' };
    const none = solve({ ...base, count: '0' });
    const two = solve({ ...base, count: '2' });
    expect(row(two, 'fluxShield')).toBeCloseTo(row(none, 'fluxShield') / 3, 8);
    expect(two.tables![0].rows).toHaveLength(2);
    expect(none.tables).toEqual([]);
    expect(row(solve({ ...base, count: '2', eShield: '0.05' }), 'fluxShield')).toBeLessThan(row(two, 'fluxShield') / 4);
  });
  it('surfaces can be given by temperature, by heat in watts, or as insulated', () => {
    const o = solve({
      mode: 'enclosure',
      surfaces: '1 m^2, 1, 1000 K\n1 m^2, 1, 500 K\n1 m^2, 0.7, insulated',
    });
    const rows = o.tables![0].rows;
    const t3 = rows[2][2] as { v: number };
    expect(t3.v).toBeCloseTo(((1000 ** 4 + 500 ** 4) / 2) ** 0.25, 6);
    const byHeat = solve({
      mode: 'enclosure',
      surfaces: '1 m^2, 1, 1000 K\n1 m^2, 1, 500 K\n1 m^2, 0.7, 0 W',
    });
    expect((byHeat.tables![0].rows[2][2] as { v: number }).v).toBeCloseTo(t3.v, 9);
    expect(refuses(radiationSpec, { mode: 'enclosure', surfaces: '1 m^2, 1, 5 parsecs\n1 m^2, 1, 300 K' })).toBe(true);
  });
  it('a gray enclosure conserves energy and lets a black surface radiate its own Eb', () => {
    const o = solve({ mode: 'enclosure' });
    expect(Math.abs(row(o, 'sum'))).toBeLessThan(1e-6);
    const table = o.tables![0].rows;
    expect((table[0][3] as { v: number }).v).toBeCloseTo(SIGMA * 1000 ** 4, 3);
    expect((table[0][1] as { v: number }).v).toBeGreaterThan(0);
    expect((table[2][1] as { v: number }).v).toBeLessThan(0);
  });
  it('refuses impossible input', () => {
    expect(refuses(radiationSpec, { temperature: '0 K' })).toBe(true);
    expect(refuses(radiationSpec, { lambda1: '0.7 µm', lambda2: '0.4 µm' })).toBe(true);
    expect(refuses(radiationSpec, { mode: 'view', dr1: '0 m' })).toBe(true);
    expect(refuses(radiationSpec, { mode: 'view', shape: 'cylinders', cri: '0.5 m' })).toBe(true);
    expect(refuses(radiationSpec, { mode: 'two', e1: '0' })).toBe(true);
    expect(refuses(radiationSpec, { mode: 'two', f12: '1.5' })).toBe(true);
    expect(refuses(radiationSpec, { mode: 'shields', count: '1.5' })).toBe(true);
    expect(refuses(radiationSpec, { mode: 'enclosure', matrix: '0, 0.5\n0.5, 0' })).toBe(true);
    expect(refuses(radiationSpec, { mode: 'enclosure', matrix: '0, 0.2, 0.2\n0.5, 0, 0.5\n0.5, 0.5, 0' })).toBe(true);
    expect(refuses(radiationSpec, { mode: 'enclosure', surfaces: '1 m^2, 1' })).toBe(true);
  });
});
