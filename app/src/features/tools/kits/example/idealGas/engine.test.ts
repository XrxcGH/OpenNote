// The example tool's validation cases, each checked against an independent value: the molar volume of an ideal gas
// at 273.15 K and 101.325 kPa is 22.413 969 54 L/mol (CODATA 2022, NIST), and the other cases invert it.
import { describe, expect, it } from 'vitest';
import { KitProblem } from '../../problem';
import { R, idealGas } from './engine';

const STP = { p: 101325, V: 0.02241396954, n: 1, T: 273.15 };

describe('ideal gas law', () => {
  it('gives the CODATA molar volume at 273.15 K and 101.325 kPa', () => {
    const { values, steps } = idealGas('V', { ...STP, V: NaN });
    expect(values.V).toBeCloseTo(0.02241396954, 10);
    expect(steps.map((step) => step.key)).toEqual([
      'kits.example.step.law',
      'kits.example.step.rearrange',
      'kits.example.step.substitute',
      'kits.example.step.result',
    ]);
    expect(steps[3].vars?.value).toBe('V = 0.022414 m³');
    expect(steps[3].math).toBe('V = 0.022414\\,\\mathrm{m^3}');
  });

  it('inverts to the pressure, the amount, and the temperature', () => {
    expect(idealGas('p', { ...STP, p: NaN }).values.p).toBeCloseTo(101325, 3);
    expect(idealGas('n', { ...STP, n: NaN }).values.n).toBeCloseTo(1, 9);
    expect(idealGas('T', { ...STP, T: NaN }).values.T).toBeCloseTo(273.15, 6);
    // 2 mol in 10 L at 300 K: p = 2 · 8.314462618 · 300 / 0.01 = 498 867.757 08 Pa.
    expect(idealGas('p', { p: NaN, V: 0.01, n: 2, T: 300 }).values.p).toBeCloseTo((2 * R * 300) / 0.01, 6);
    expect((2 * R * 300) / 0.01).toBeCloseTo(498867.75708, 4);
  });

  it('refuses zero, negative, and non-numeric inputs with words, and ignores the unknown', () => {
    const code = (fn: () => unknown) => {
      try {
        fn();
        return null;
      } catch (error) {
        return error instanceof KitProblem ? error.key : 'other';
      }
    };
    expect(code(() => idealGas('V', { ...STP, T: 0 }))).toBe('kits.example.error.temperature');
    expect(code(() => idealGas('V', { ...STP, T: -5 }))).toBe('kits.example.error.temperature');
    expect(code(() => idealGas('V', { ...STP, p: 0 }))).toBe('kits.field.positive');
    expect(code(() => idealGas('T', { ...STP, n: -1 }))).toBe('kits.field.positive');
    expect(code(() => idealGas('p', { ...STP, V: Number.NaN }))).toBe('kits.field.notNumber');
    expect(code(() => idealGas('p', { ...STP, p: -1 }))).toBeNull();
  });

  it('says when the answer overflows instead of showing infinity, and handles huge and tiny values', () => {
    expect(() => idealGas('p', { p: NaN, V: 1e-300, n: 1e300, T: 1e10 })).toThrow(KitProblem);
    expect(idealGas('V', { p: 1e-20, V: NaN, n: 1e-20, T: 1 }).values.V).toBeCloseTo(R, 9);
    expect(idealGas('n', { p: 1e9, V: 1e3, n: NaN, T: 1e4 }).values.n).toBeCloseTo(1e12 / (R * 1e4), 3);
  });
});
