// The fins form end to end, checked against the closed forms for a pin fin, an annular fin, and an array.
import { describe, expect, it } from 'vitest';
import { refusal, refuses, row, solver } from '../kit/testing';
import { finsSpec } from './spec';

const solve = solver(finsSpec);
const D = 0.005;
const L = 0.05;
const k = 200;
const h = 50;
const theta = 75;
const P = Math.PI * D;
const A = (Math.PI * D * D) / 4;
const m = Math.sqrt((h * P) / (k * A));
const M = Math.sqrt(h * P * k * A) * theta;

describe('fins form', () => {
  it('a pin fin with a convecting tip', () => {
    const o = solve();
    const g = h / (m * k);
    const q = (M * (Math.sinh(m * L) + g * Math.cosh(m * L))) / (Math.cosh(m * L) + g * Math.sinh(m * L));
    expect(row(o, 'm')).toBeCloseTo(m, 12);
    expect(row(o, 'heat')).toBeCloseTo(q, 10);
    expect(row(o, 'heat_adiabatic')).toBeCloseTo(M * Math.tanh(m * L), 10);
    expect(row(o, 'heat_infinite')).toBeCloseTo(M, 10);
    expect(row(o, 'efficiency')).toBeCloseTo(Math.tanh(m * L) / (m * L), 12);
    expect(row(o, 'effectiveness')).toBeCloseTo(q / (h * A * theta), 10);
  });
  it('the corrected length matches the convecting tip closely', () => {
    const o = solve({ tip: 'corrected' });
    expect(row(o, 'heat')).toBeCloseTo(M * Math.tanh(m * (L + A / P)), 10);
    expect(Math.abs(row(o, 'heat') - row(solve(), 'heat')) / row(o, 'heat')).toBeLessThan(0.01);
  });
  it('a rectangular fin uses its perimeter and area', () => {
    const o = solve({ shape: 'rectangular', size: '3 mm', width: '100 mm', length: '30 mm', tip: 'adiabatic' });
    const p = 2 * (0.1 + 0.003);
    const a = 0.1 * 0.003;
    const mm = Math.sqrt((h * p) / (k * a));
    expect(row(o, 'm')).toBeCloseTo(mm, 12);
    expect(row(o, 'heat')).toBeCloseTo(Math.sqrt(h * p * k * a) * theta * Math.tanh(mm * 0.03), 10);
  });
  it('a fixed tip temperature lies between the base and tip limits', () => {
    const o = solve({ tip: 'temperature', thetaTip: '30 K' });
    expect(row(o, 'heat')).toBeGreaterThan(row(solve({ tip: 'adiabatic' }), 'heat'));
    expect(refuses(finsSpec, { tip: 'temperature', thetaTip: '' })).toBe(true);
  });
  it('an annular fin: heat equals efficiency times h times fin area times the base excess', () => {
    const o = solve({ mode: 'annular' });
    expect(row(o, 'heat')).toBeCloseTo(row(o, 'efficiency') * 50 * row(o, 'finArea') * 75, 8);
    expect(row(o, 'efficiency')).toBeGreaterThan(0.5);
    expect(row(o, 'efficiency')).toBeLessThan(1);
    expect(row(o, 'correctedOuterRadius')).toBeCloseTo(0.0515, 12);
  });
  it('an array adds the fins to the bare base between them', () => {
    const o = solve({ mode: 'array' });
    const bare = h * (0.01 - 10 * 0.00002) * theta;
    expect(row(o, 'unfinned')).toBeCloseTo(bare, 9);
    expect(row(o, 'total')).toBeCloseTo(10 * 8 + bare, 9);
    expect(row(o, 'enhancement')).toBeCloseTo((10 * 8 + bare) / (h * 0.01 * theta), 10);
  });
  it('refuses impossible input', () => {
    expect(refuses(finsSpec, { length: '0 mm' })).toBe(true);
    expect(refuses(finsSpec, { k: '0 W/(m·K)' })).toBe(true);
    expect(refuses(finsSpec, { thetaBase: '0 K' })).toBe(true);
    expect(refuses(finsSpec, { mode: 'annular', outerRadius: '20 mm' })).toBe(true);
    expect(refuses(finsSpec, { mode: 'array', count: '0' })).toBe(true);
    expect(refuses(finsSpec, { mode: 'array', count: '2.5' })).toBe(true);
    expect(refusal(finsSpec, { shape: 'rectangular', width: '0 mm' })).toMatch(/width/i);
  });
});
