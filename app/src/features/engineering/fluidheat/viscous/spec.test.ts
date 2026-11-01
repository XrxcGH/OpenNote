// The viscous and biological flow form end to end, checked against closed forms.
import '../text';
import { describe, expect, it } from 'vitest';
import { refuses, row, solver } from '../kit/testing';
import { viscousSpec } from './spec';

const solve = solver(viscousSpec);
const R = 0.002;
const L = 0.5;
const dp = 500;
const mu = 3.5e-3;

describe('viscous flow form', () => {
  it('Hagen-Poiseuille flow in a pipe', () => {
    const o = solve();
    const q = (Math.PI * R ** 4 * dp) / (8 * mu * L);
    expect(row(o, 'flow')).toBeCloseTo(q, 14);
    expect(row(o, 'meanSpeed')).toBeCloseTo(q / (Math.PI * R * R), 12);
    expect(row(o, 'maxSpeed')).toBeCloseTo(2 * row(o, 'meanSpeed'), 12);
    expect(row(o, 'wallShear')).toBeCloseTo((dp * R) / (2 * L), 12);
  });
  it('plates without a pressure gradient give q = U h / 2 and equal wall shear', () => {
    const o = solve({ mode: 'couette', viscosity: '100 mPa·s' });
    expect(row(o, 'flowPerWidth')).toBeCloseTo((0.5 * 0.002) / 2, 14);
    expect(row(o, 'lowerWallShear')).toBeCloseTo((0.1 * 0.5) / 0.002, 9);
    expect(row(o, 'upperWallShear')).toBeCloseTo(row(o, 'lowerWallShear'), 12);
  });
  it('an annulus matches the closed form and approaches a pipe as the core shrinks', () => {
    const a = 1e-3;
    const b = 3e-3;
    const o = solve({ mode: 'annulus' });
    const q = ((Math.PI * dp) / (8 * mu * L)) * (b ** 4 - a ** 4 - (b * b - a * a) ** 2 / Math.log(b / a));
    expect(row(o, 'flow')).toBeCloseTo(q, 14);
    // With a hair-thin core the flow tends to the pipe flow times (1 - 1 / ln(b / a)).
    const thin = solve({ mode: 'annulus', inner: '0.000001 m', outer: '2 mm' });
    expect(row(thin, 'flow') / row(solve(), 'flow')).toBeCloseTo(1 - 1 / Math.log(2e-3 / 1e-6), 3);
  });
  it('a power-law fluid with n = 1 is Newtonian, and the Bingham fluid with no yield stress is too', () => {
    const newtonian = solve({ mode: 'powerLaw', k: '0.0035', n: '1' });
    expect(row(newtonian, 'flow')).toBeCloseTo(row(solve(), 'flow'), 12);
    const bingham = solve({ mode: 'bingham', yieldStress: '0 Pa' });
    expect(row(bingham, 'flow')).toBeCloseTo(row(solve(), 'flow'), 10);
  });
  it('a yield-stress fluid stops when the wall shear stays below the yield stress', () => {
    const stopped = solve({ mode: 'bingham', yieldStress: '5 Pa' });
    expect(row(stopped, 'flow')).toBe(0);
    expect(stopped.rows.find((r) => r.id === 'flowing')?.word).toBe('no');
    const moving = solve({ mode: 'casson', yieldStress: '0.005 Pa' });
    expect(row(moving, 'flow')).toBeGreaterThan(0);
    expect(row(moving, 'flow')).toBeLessThan(row(solve(), 'flow'));
  });
  it('the Womersley number and the quasi-steady limit', () => {
    const o = solve({ mode: 'womersley', radius: '12 mm', amplitude: '100 Pa/m' });
    expect(row(o, 'alpha')).toBeCloseTo(0.012 * Math.sqrt((2 * Math.PI * 1.2) / 3.3e-6), 9);
    expect(row(o, 'quasiSteady')).toBeCloseTo((100 * 0.012 ** 2) / (4 * 1060 * 3.3e-6), 9);
    const slow = solve({ mode: 'womersley', radius: '0.5 mm', frequency: '0.1 Hz', amplitude: '100 Pa/m' });
    expect(row(slow, 'centerlineAmplitude') / row(slow, 'quasiSteady')).toBeCloseTo(1, 1);
  });
  it('Murray’s law gives the daughter radius', () => {
    const o = solve({ mode: 'murray', radius: '3 mm', children: '2' });
    expect(row(o, 'childRadius')).toBeCloseTo(0.003 * 2 ** (-1 / 3), 14);
    const uneven = solve({ mode: 'murray', radius: '3 mm', firstChild: '2 mm' });
    expect(row(uneven, 'secondChild') ** 3 + 0.002 ** 3).toBeCloseTo(0.003 ** 3, 18);
  });
  it('refuses impossible input', () => {
    expect(refuses(viscousSpec, { radius: '0 mm' })).toBe(true);
    expect(refuses(viscousSpec, { dp: '-5 Pa' })).toBe(true);
    expect(refuses(viscousSpec, { mode: 'annulus', inner: '4 mm' })).toBe(true);
    expect(refuses(viscousSpec, { mode: 'murray', children: '1' })).toBe(true);
    expect(refuses(viscousSpec, { mode: 'murray', firstChild: '5 mm' })).toBe(true);
    expect(refuses(viscousSpec, { mode: 'womersley', frequency: '1e6 Hz' })).toBe(true);
    expect(refuses(viscousSpec, { dp: '5 kg' })).toBe(true);
  });
});
