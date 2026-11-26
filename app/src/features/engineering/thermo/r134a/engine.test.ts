// The R-134a tool as a student uses it: the IIR reference values, the thermodynamic consistency check of the
// validation plan, each pair of known properties, the ASHRAE reference, and problems in words.
import '../text';
import { describe, expect, it } from 'vitest';
import { ThermoError, type ThermoResult } from '../common/types';
import { solveRefrigerant, type RefrigerantInput } from './engine';
import { fromPH, fromPS, fromPX, fromTP, fromTX } from './refrigerant';
import { spec } from './spec';

const rel = (a: number, b: number) => Math.abs(a / b - 1);
const value = (result: ThermoResult, key: string): number => result.rows.find((row) => row.key === key)!.value;
const code = (input: RefrigerantInput): string => {
  try {
    solveRefrigerant(input);
  } catch (error) {
    return error instanceof ThermoError ? error.code : 'other';
  }
  return 'none';
};

describe('the R-134a tool', () => {
  it('saturated at 0 °C with the IIR reference: hf = 200.00, hg = 398.6 kJ/kg, sf = 1.0000', () => {
    const f = fromTX(273.15, 0);
    const g = fromTX(273.15, 1);
    expect(Math.abs(f.h - 200)).toBeLessThan(0.2);
    expect(Math.abs(g.h - 398.6)).toBeLessThan(0.2);
    expect(Math.abs(f.s - 1)).toBeLessThan(1e-4);
  });

  it('is consistent at 40 °C and 0.8 MPa: h - u = p v, and dh/ds at constant p is T', () => {
    const state = fromTP(313.15, 800);
    expect(state.phase).toBe('vapor');
    expect(rel(state.h - state.u, state.p * state.v)).toBeLessThan(1e-6);
    const up = fromTP(313.15 + 0.01, 800);
    const down = fromTP(313.15 - 0.01, 800);
    expect(rel((up.h - down.h) / (up.s - down.s), 313.15)).toBeLessThan(1e-6);
  });

  it('every pair of the same state agrees, in both phases and as a mixture', () => {
    for (const [T, p] of [
      [313.15, 800],
      [263.15, 1500],
      [400, 6000],
    ]) {
      const state = fromTP(T, p);
      expect(fromPH(p, state.h).T).toBeCloseTo(T, 5);
      expect(fromPS(p, state.s).T).toBeCloseTo(T, 5);
    }
    const mixed = fromPX(140, 0.25);
    expect(fromPH(140, mixed.h).x).toBeCloseTo(0.25, 8);
    expect(fromTX(mixed.T, 0.25).h).toBeCloseTo(mixed.h, 6);
  });

  it('the ASHRAE reference puts h and s at 0 for liquid at -40 °C and keeps differences', () => {
    const f = fromTX(233.15, 0, 'ashrae');
    expect(Math.abs(f.h)).toBeLessThan(1e-9);
    expect(Math.abs(f.s)).toBeLessThan(1e-12);
    const a = fromTP(313.15, 800, 'ashrae');
    const b = fromTP(313.15, 800, 'iir');
    const c = fromTX(273.15, 1, 'ashrae');
    const d = fromTX(273.15, 1, 'iir');
    expect(a.h - c.h).toBeCloseTo(b.h - d.h, 9);
    expect(a.s - c.s).toBeCloseTo(b.s - d.s, 12);
    // Published ASHRAE-reference tables give hg near 250.45 kJ/kg at 0 °C.
    expect(Math.abs(c.h - 250.45)).toBeLessThan(0.3);
  });

  it('shows the saturation iteration and the lever rule for a mixture', () => {
    const result = solveRefrigerant({ pair: 'px', reference: 'iir', p: 140, x: 0.5 });
    const keys = result.steps.map((step) => step.key);
    expect(keys).toContain('r134a.iteration');
    expect(keys).toContain('r134a.saturation');
    expect(keys).toContain('steam.lever');
    expect(value(result, 'temperature') - 273.15).toBeCloseTo(-18.77, 1);
    expect(result.plots?.[0].title).toBe('refrigerantPh');
  });

  it('reads the form', () => {
    const result = spec.solve('state', { pair: 'Tp', reference: 'iir', T: 313.15, p: 800 });
    expect(result.rows[0].word).toBe('vapor');
    expect(result.notes).toContain('iirReference');
  });

  it('says what is wrong in words', () => {
    expect(code({ pair: 'Tp', reference: 'iir', T: 100, p: 100 })).toBe('r134aRange');
    expect(code({ pair: 'Tp', reference: 'iir', T: 300, p: 0 })).toBe('notPositive');
    expect(code({ pair: 'Tp', reference: 'iir', T: 300, p: 1e6 })).toBe('r134aRange');
    expect(code({ pair: 'Tx', reference: 'iir', T: 380, x: 0.5 })).toBe('r134aSatRange');
    expect(code({ pair: 'px', reference: 'iir', p: 5000, x: 0.5 })).toBe('r134aSatRange');
    expect(code({ pair: 'px', reference: 'iir', p: 140, x: -0.1 })).toBe('qualityRange');
    expect(code({ pair: 'ph', reference: 'iir', p: 140, h: -1e4 })).toBe('r134aRange');
    expect(code({ pair: 'ph', reference: 'iir', p: 140 })).toBe('missing');
  });
});
