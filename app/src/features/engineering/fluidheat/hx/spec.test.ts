// The heat exchanger form end to end, checked against energy balances and the effectiveness-NTU relations.
import { describe, expect, it } from 'vitest';
import { refusal, refuses, row, solver } from '../kit/testing';
import { hxSpec } from './spec';

const solve = solver(hxSpec);
const ch = 0.5 * 4180;
const cc = 1.0 * 4180;

describe('heat exchanger form', () => {
  it('rating a counterflow exchanger: energy balance and the counterflow effectiveness', () => {
    const o = solve();
    const ntu = 2000 / ch;
    const cr = ch / cc;
    const e = Math.exp(-ntu * (1 - cr));
    const eps = (1 - e) / (1 - cr * e);
    expect(row(o, 'ntu')).toBeCloseTo(ntu, 12);
    expect(row(o, 'effectiveness')).toBeCloseTo(eps, 12);
    expect(row(o, 'heat')).toBeCloseTo(eps * ch * 120, 6);
    expect(ch * (423.15 - row(o, 'thOut'))).toBeCloseTo(row(o, 'heat'), 6);
    expect(cc * (row(o, 'tcOut') - 303.15)).toBeCloseTo(row(o, 'heat'), 6);
    expect(row(o, 'heat')).toBeCloseTo(2000 * row(o, 'correction') * row(o, 'lmtd'), 4);
  });
  it('parallel flow and a shell with two passes give the smaller effectiveness', () => {
    const counter = row(solve(), 'effectiveness');
    const parallel = row(solve({ type: 'parallel' }), 'effectiveness');
    const shell = row(solve({ type: 'shell' }), 'effectiveness');
    expect(parallel).toBeLessThan(shell);
    expect(shell).toBeLessThan(counter);
    expect(parallel).toBeCloseTo((1 - Math.exp(-(2000 / ch) * 1.5)) / 1.5, 12);
  });
  it('sizing from an outlet temperature returns the UA, and rating that UA returns the outlet', () => {
    const o = solve({ mode: 'size', u: '500 W/(m²·K)' });
    expect(row(o, 'heat')).toBeCloseTo(ch * 60, 6);
    expect(row(o, 'area')).toBeCloseTo(row(o, 'ua') / 500, 12);
    const back = solve({ ua: `${row(o, 'ua')} W/K` });
    expect(row(back, 'thOut')).toBeCloseTo(363.15, 5);
  });
  it('a duty works as well as an outlet; a condenser has Cr = 0 and eps = 1 - exp(-NTU)', () => {
    const duty = solve({ mode: 'size', thOut: '', duty: '125400 W' });
    expect(row(duty, 'ua')).toBeCloseTo(row(solve({ mode: 'size' }), 'ua'), 6);
    const cond = solve({ mode: 'size', hotPhase: 'change', thOut: '', tcOut: '60 °C', thIn: '120 °C', tcIn: '20 °C' });
    expect(row(cond, 'cr')).toBe(0);
    expect(row(cond, 'effectiveness')).toBeCloseTo(1 - Math.exp(-row(cond, 'ntu')), 12);
    expect(row(cond, 'thOut')).toBeCloseTo(393.15, 9);
  });
  it('the log-mean method from four temperatures', () => {
    const o = solve({ mode: 'lmtd', lmtdType: 'counter' });
    expect(row(o, 'lmtd')).toBeCloseTo(69.521, 3);
    expect(row(o, 'ua')).toBeCloseTo(100000 / row(o, 'lmtd'), 6);
    const shell = solve({ mode: 'lmtd', lmtdType: 'shell', u: '500 W/(m²·K)' });
    expect(row(shell, 'correction')).toBeCloseTo(0.91048, 4);
    expect(row(shell, 'p')).toBeCloseTo(1 / 3, 4);
    expect(row(shell, 'r')).toBeCloseTo(1.5, 12);
    expect(row(shell, 'area')).toBeCloseTo(row(shell, 'ua') / 500, 12);
  });
  it('draws the temperature profiles for counter and parallel flow only', () => {
    expect(solve().picture).toBeTruthy();
    expect(solve({ type: 'shell' }).picture).toBeUndefined();
  });
  it('refuses impossible input', () => {
    expect(refuses(hxSpec, { thIn: '20 °C' })).toBe(true);
    expect(refuses(hxSpec, { mh: '0 kg/s' })).toBe(true);
    expect(refuses(hxSpec, { ua: '', area: '', u: '' })).toBe(true);
    expect(refusal(hxSpec, { ua: '', area: '', u: '' })).toMatch(/UA/);
    expect(refuses(hxSpec, { mode: 'size', thOut: '', duty: '' })).toBe(true);
    expect(refuses(hxSpec, { mode: 'size', duty: '5 MW', thOut: '' })).toBe(true);
    expect(refuses(hxSpec, { mode: 'size', type: 'parallel', thOut: '', duty: '230 kW' })).toBe(true);
    expect(refuses(hxSpec, { mode: 'lmtd', thOutL: '160 °C' })).toBe(true);
    expect(refuses(hxSpec, { mode: 'lmtd', lmtdType: 'shell', tcOutL: '145 °C', thOutL: '40 °C' })).toBe(true);
  });
});
