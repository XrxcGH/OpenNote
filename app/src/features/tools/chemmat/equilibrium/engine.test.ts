import { describe, expect, it } from 'vitest';
import { iceTable, kcKp, parseEquilibrium, solubility } from './engine';
import type { Outcome } from '../types';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const val = (o: Outcome, key: string): number => {
  if (!o.ok) throw new Error(o.key);
  const row = o.rows.find((r) => r.key === key);
  if (!row || typeof row.value !== 'number') throw new Error(`no row ${key}`);
  return row.value;
};
const species = (o: Outcome, name: string): number => {
  if (!o.ok) throw new Error(o.key);
  const row = o.rows.find((r) => r.keyVars?.name === name);
  if (!row || typeof row.value !== 'number') throw new Error(`no species ${name}`);
  return row.value;
};

describe('ICE tables', () => {
  it('H2 + I2 <-> 2 HI, K = 50, 1 M each', () => {
    const o = iceTable({ reaction: 'H2 + I2 <-> 2 HI', K: 50, initial: 'H2 = 1\nI2 = 1', unit: 'mol/L' });
    expect(Math.abs(val(o, 'kitChemMat.eq.row.x') - 0.77952)).toBeLessThan(1e-5);
    expect(Math.abs(species(o, 'HI') - 1.55904)).toBeLessThan(1e-5);
    // Independent: 2x / (1 - x) = sqrt(K).
    const x = Math.sqrt(50) / (2 + Math.sqrt(50));
    expect(rel(val(o, 'kitChemMat.eq.row.x'), x)).toBeLessThan(1e-12);
    expect(rel(val(o, 'kitChemMat.eq.row.Qcheck'), 50)).toBeLessThan(1e-9);
  });

  it('starting from products only runs the reaction backward (negative extent)', () => {
    const o = iceTable({ reaction: 'H2 + I2 <-> 2 HI', K: 50, initial: 'HI = 2', unit: 'mol/L' });
    const x = val(o, 'kitChemMat.eq.row.x');
    expect(x).toBeLessThan(0);
    expect(rel(species(o, 'H2') * species(o, 'I2') * 50, species(o, 'HI') ** 2)).toBeLessThan(1e-9);
  });

  it('products only: the direction is reverse (Q is infinite), and the extent is negative', () => {
    const o = iceTable({ reaction: 'N2 + 3 H2 <-> 2 NH3', K: 0.5, initial: 'NH3 = 1', unit: 'mol/L' });
    expect(o.ok && o.rows.find((r) => r.key === 'kitChemMat.eq.row.direction')?.word).toBe('kitChemMat.eq.reverse');
    expect(val(o, 'kitChemMat.eq.row.x')).toBeLessThan(0);
    expect(rel(val(o, 'kitChemMat.eq.row.Qcheck'), 0.5)).toBeLessThan(1e-9);
  });

  it('a huge K keeps the trace of the limiting reactant: H2 + Cl2 <-> 2 HCl, K = 1e33', () => {
    const o = iceTable({ reaction: 'H2 + Cl2 <-> 2 HCl', K: 1e33, initial: 'H2 = 1\nCl2 = 0.5', unit: 'mol/L' });
    // HCl = 1 and H2 = 0.5 to 1e-30 relative, so K = 1^2 / (0.5 y) gives y = 2e-33
    expect(rel(species(o, 'Cl2'), 2e-33)).toBeLessThan(1e-6);
    expect(rel(species(o, 'HCl'), 1)).toBeLessThan(1e-12);
    expect(rel(val(o, 'kitChemMat.eq.row.Qcheck'), 1e33)).toBeLessThan(1e-6);
  });

  it('a pure solid takes no part in K, and a dimerization matches its quadratic', () => {
    const o = iceTable({ reaction: 'CaCO3(s) <-> CaO(s) + CO2(g)', K: 0.5, initial: 'CO2(g) = 0', unit: 'bar' });
    expect(val(o, 'kitChemMat.eq.row.x')).toBeCloseTo(0.5, 12); // K = P(CO2), solids do not enter
    expect(iceTable({ reaction: 'A <-> B', K: 1, initial: 'A = 0', unit: '' })).toMatchObject({ ok: false });
    const o2 = iceTable({ reaction: 'N2O4 <-> 2 NO2', K: 0.1143, initial: 'N2O4 = 1', unit: 'bar' });
    // Independent quadratic: (2x)^2 = K (1 - x), so 4x^2 + K x - K = 0.
    const K = 0.1143;
    const x = (-K + Math.sqrt(K * K + 16 * K)) / 8;
    expect(rel(val(o2, 'kitChemMat.eq.row.x'), x)).toBeLessThan(1e-10);
  });

  it('a very large and a very small K stay inside the allowed range', () => {
    const big = iceTable({ reaction: 'A <-> B', K: 1e30, initial: 'A = 1', unit: 'mol/L' });
    expect(species(big, 'A')).toBeLessThan(1e-29);
    const small = iceTable({ reaction: 'A <-> B', K: 1e-30, initial: 'A = 1', unit: 'mol/L' });
    expect(species(small, 'B')).toBeGreaterThan(0);
    expect(species(small, 'B')).toBeLessThan(1e-29);
  });

  it('reports the direction from Q and whether the 5 percent rule holds', () => {
    const o = iceTable({ reaction: 'A <-> B', K: 2, initial: 'A = 1', unit: 'mol/L' });
    if (!o.ok) throw new Error('x');
    expect(o.rows.find((r) => r.key === 'kitChemMat.eq.row.direction')?.word).toBe('kitChemMat.eq.forward');
    expect(o.rows.find((r) => r.key === 'kitChemMat.eq.row.approx')?.word).toBe('kitChemMat.eq.approxBad');
    const weak = iceTable({ reaction: 'HA <-> H + A', K: 1.8e-5, initial: 'HA = 1', unit: 'mol/L' });
    if (!weak.ok) throw new Error('x');
    expect(weak.rows.find((r) => r.key === 'kitChemMat.eq.row.approx')?.word).toBe('kitChemMat.eq.approxOk');
  });

  it('rejects bad input with a message', () => {
    expect(iceTable({ reaction: 'A <-> B', K: 0, initial: 'A = 1', unit: '' })).toMatchObject({ ok: false });
    expect(iceTable({ reaction: 'A <-> B', K: -3, initial: 'A = 1', unit: '' })).toMatchObject({ ok: false });
    expect(iceTable({ reaction: 'A B', K: 1, initial: 'A = 1', unit: '' })).toMatchObject({ ok: false });
    expect(iceTable({ reaction: 'A <-> B', K: 1, initial: 'C = 1', unit: '' })).toMatchObject({ ok: false });
    expect(iceTable({ reaction: 'A <-> B', K: 1, initial: 'A = -1', unit: '' })).toMatchObject({ ok: false });
    expect(iceTable({ reaction: 'A <-> B', K: 1, initial: 'A = x', unit: '' })).toMatchObject({ ok: false });
    expect(iceTable({ reaction: 'A <-> B', K: 1, initial: '', unit: '' })).toMatchObject({ ok: false });
  });

  it('reads coefficients and sides', () => {
    expect(parseEquilibrium('N2 + 3 H2 <-> 2 NH3')?.map((p) => p.nu)).toEqual([-1, -3, 2]);
  });
});

describe('solubility', () => {
  it('AgCl in water and in 0.1 M NaCl', () => {
    const water = solubility({ Ksp: 1.8e-10, a: 1, b: 1, cA: 0, cB: 0 });
    expect(rel(val(water, 'kitChemMat.eq.row.solubility'), 1.3416e-5)).toBeLessThan(1e-4);
    expect(rel(val(water, 'kitChemMat.eq.row.solubility'), Math.sqrt(1.8e-10))).toBeLessThan(1e-12);
    const salty = solubility({ Ksp: 1.8e-10, a: 1, b: 1, cA: 0, cB: 0.1 });
    expect(rel(val(salty, 'kitChemMat.eq.row.solubility'), 1.8e-9)).toBeLessThan(1e-4);
  });

  it('a 1:2 salt solves s(2s)^2 = Ksp', () => {
    const o = solubility({ Ksp: 3.2e-11, a: 1, b: 2, cA: 0, cB: 0 });
    expect(rel(val(o, 'kitChemMat.eq.row.solubility'), Math.cbrt(3.2e-11 / 4))).toBeLessThan(1e-10);
  });

  it('a solution already past saturation precipitates', () => {
    const o = solubility({ Ksp: 1e-10, a: 1, b: 1, cA: 1, cB: 1 });
    expect(val(o, 'kitChemMat.eq.row.solubility')).toBe(0);
  });

  it('rejects impossible input', () => {
    expect(solubility({ Ksp: 0, a: 1, b: 1, cA: 0, cB: 0 })).toMatchObject({ ok: false });
    expect(solubility({ Ksp: 1e-5, a: 0, b: 1, cA: 0, cB: 0 })).toMatchObject({ ok: false });
    expect(solubility({ Ksp: 1e-5, a: 1.5, b: 1, cA: 0, cB: 0 })).toMatchObject({ ok: false });
    expect(solubility({ Ksp: 1e-5, a: 1, b: 1, cA: -1, cB: 0 })).toMatchObject({ ok: false });
  });
});

describe('Kc and Kp', () => {
  it('N2O4 <-> 2 NO2 at 298.15 K', () => {
    const o = kcKp({ K: 4.61e-3, dn: 1, T: 298.15, direction: 'toKp' });
    expect(rel(val(o, 'kitChemMat.eq.row.Kp'), 0.11428)).toBeLessThan(1e-4);
    expect(rel(val(o, 'kitChemMat.eq.row.Kp'), 4.61e-3 * 0.0831446 * 298.15)).toBeLessThan(1e-6);
  });

  it('round-trips and treats dn = 0 as no change', () => {
    const kp = val(kcKp({ K: 7.5, dn: -2, T: 400, direction: 'toKp' }), 'kitChemMat.eq.row.Kp');
    expect(rel(val(kcKp({ K: kp, dn: -2, T: 400, direction: 'toKc' }), 'kitChemMat.eq.row.Kc'), 7.5)).toBeLessThan(
      1e-12,
    );
    expect(val(kcKp({ K: 3, dn: 0, T: 400, direction: 'toKp' }), 'kitChemMat.eq.row.Kp')).toBe(3);
    expect(kcKp({ K: 3, dn: 1, T: 0, direction: 'toKp' })).toMatchObject({ ok: false });
    expect(kcKp({ K: -3, dn: 1, T: 300, direction: 'toKp' })).toMatchObject({ ok: false });
  });
});
