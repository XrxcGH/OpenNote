import { describe, expect, it } from 'vitest';
import { initialValues, runTool } from '../spec';
import { cx } from '../shared';
import { changeBase, correction, fromPhasors, fromPowerFactor, perUnitBase, threePhase } from './engine';
import { spec } from './tool';

const close = (a: number, b: number, rel: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.abs(b));

describe('power factor correction', () => {
  it('10 kW at 0.8 lagging, 240 V, 60 Hz, corrected to 0.95', () => {
    const r = correction(10000, 0.8, 0.95, 240, 60);
    close(r.q1, 7500, 1e-9);
    close(r.qc, 4213.16, 1e-4);
    close(r.c, 194.02e-6, 1e-4);
    // Independent calculation: the capacitor current is V ω C, and Qc = V * that current.
    close(240 * (240 * 2 * Math.PI * 60 * r.c), r.qc, 1e-12);
    close(r.i1, 10000 / 0.8 / 240, 1e-12);
    expect(r.i2).toBeLessThan(r.i1);
  });
  it('refuses a target below the present power factor, and a power factor outside 0 to 1', () => {
    expect(() => correction(10000, 0.9, 0.8, 240, 60)).toThrow();
    expect(() => correction(10000, 1.2, 0.95, 240, 60)).toThrow();
    expect(() => correction(10000, 0, 0.95, 240, 60)).toThrow();
    expect(() => correction(0, 0.8, 0.95, 240, 60)).toThrow();
  });
  it('needs nothing when the power factor is already the target', () => {
    expect(correction(5000, 0.9, 0.9, 120, 50).qc).toBeCloseTo(0, 9);
  });
});

describe('single-phase power', () => {
  it('signs reactive power by lagging or leading', () => {
    expect(fromPowerFactor(1000, 0.6, 'lagging').q).toBeCloseTo(1333.3333, 3);
    expect(fromPowerFactor(1000, 0.6, 'leading').q).toBeCloseTo(-1333.3333, 3);
  });
  it('agrees with S = V I* from phasors', () => {
    const load = fromPhasors(cx(120, 0), cx(3, -4));
    expect(load.p).toBeCloseTo(360, 9);
    expect(load.q).toBeCloseTo(480, 9);
    expect(load.s).toBeCloseTo(600, 9);
    expect(load.pf).toBeCloseTo(0.6, 9);
  });
});

describe('balanced three-phase loads', () => {
  it('wye, 480 V line, 10 Ω at 30° per phase', () => {
    const r = threePhase(480, 10, 30, 'wye');
    close(r.vPhase, 277.13, 1e-4);
    close(r.iLine, 27.713, 1e-4);
    close(r.s.re, 19953, 1e-4);
    // sqrt(3) V_L I_L cos(theta) is the independent form.
    close(Math.sqrt(3) * 480 * r.iLine * Math.cos(Math.PI / 6), r.s.re, 1e-12);
  });
  it('the same load in delta draws 3 times the power', () => {
    const wye = threePhase(480, 10, 30, 'wye');
    const delta = threePhase(480, 10, 30, 'delta');
    close(delta.s.re, 3 * wye.s.re, 1e-12);
    close(delta.iLine, Math.sqrt(3) * delta.iPhase, 1e-12);
  });
  it('refuses a zero impedance or voltage', () => {
    expect(() => threePhase(480, 0, 30, 'wye')).toThrow();
    expect(() => threePhase(-1, 10, 30, 'wye')).toThrow();
  });
});

describe('per unit', () => {
  it('100 MVA, 138 kV: 50 Ω is 0.26255 pu', () => {
    const r = perUnitBase(100e6, 138e3, 50);
    close(r.zBase, 190.44, 1e-5);
    close(r.zPu, 0.26255, 1e-5);
    close(r.iBase, 100e6 / (Math.sqrt(3) * 138e3), 1e-12);
  });
  it('changing base and going through ohms agree', () => {
    const next = changeBase(0.1, 100e6, 138e3, 500e6, 132e3);
    const ohms = 0.1 * (138e3 ** 2 / 100e6);
    close(next, ohms / (132e3 ** 2 / 500e6), 1e-12);
  });
  it('refuses a zero base', () => {
    expect(() => perUnitBase(0, 138e3, 1)).toThrow();
    expect(() => changeBase(0.1, 1, 0, 1, 1)).toThrow();
  });
});

describe('the AC power form', () => {
  it('opens on the worked correction example and says what is wrong with an input', () => {
    const values = initialValues(spec);
    const result = runTool(spec, values);
    expect(result.ok && result.answer).toContain('4.2132 kvar');
    const bad = runTool(spec, { ...values, pf2: '0.5' });
    expect(bad.ok).toBe(false);
    for (const mode of ['power', 'threephase', 'perunit', 'rebase']) {
      expect(runTool(spec, { ...values, mode }).ok).toBe(true);
    }
    const huge = runTool(spec, { ...values, p: '1e15' });
    expect(huge.ok).toBe(true);
  });
});
