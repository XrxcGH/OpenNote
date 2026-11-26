import '../text';
import { describe, expect, it } from 'vitest';
import {
  calibration,
  calibrationLine,
  calorimetry,
  colligative,
  kfFromEnthalpy,
  osmotic,
  osmoticPressure,
  unknownConcentration,
  yieldCalc,
} from './engine';
import type { Outcome } from '../types';

const val = (o: Outcome, key: string): number => {
  if (!o.ok) throw new Error(o.key);
  const r = o.rows.find((x) => x.key === key);
  if (!r || typeof r.value !== 'number') throw new Error(`no ${key}`);
  return r.value;
};
const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const base = { solvent: 'water', nSolute: 1, solventMass: 1000, i: 2, Kf: NaN, Kb: NaN, Tf: NaN, Tb: NaN, M: NaN };

describe('colligative properties', () => {
  it('1 mol NaCl (i = 2) in 1 kg water lowers the freezing point by 3.72 K', () => {
    const o = colligative(base);
    expect(rel(val(o, 'kitChemMat.sol.row.dTf'), 3.72)).toBeLessThan(1e-3);
    expect(val(o, 'kitChemMat.sol.row.Tf')).toBeCloseTo(273.15 - 3.72, 9);
    expect(val(o, 'kitChemMat.sol.row.dTb')).toBeCloseTo(2 * 0.512, 12);
    expect(val(o, 'kitChemMat.sol.row.molality')).toBe(1);
  });

  it('Kf from R Tf^2 M / dH_fus matches the tabulated 1.86 within 1e-3', () => {
    expect(rel(kfFromEnthalpy(273.15, 18.015, 6010), 1.8604)).toBeLessThan(1e-3);
    expect(rel(val(colligative(base), 'kitChemMat.sol.row.kfCheck'), 1.86)).toBeLessThan(1e-3);
  });

  it('the mole fraction of solute is n / (n + n_solvent)', () => {
    const o = colligative({ ...base, nSolute: 0.5, solventMass: 500, i: 1 });
    const nWater = 500 / 18.015;
    expect(val(o, 'kitChemMat.sol.row.fraction')).toBeCloseTo(0.5 / (0.5 + nWater), 12);
  });

  it('takes a custom solvent', () => {
    const o = colligative({ ...base, solvent: 'custom', Kf: 5, Kb: 2, Tf: 280, Tb: 350, M: 78, i: 1, nSolute: 0.2 });
    expect(val(o, 'kitChemMat.sol.row.dTf')).toBeCloseTo(1, 12);
    expect(val(o, 'kitChemMat.sol.row.Tb')).toBeCloseTo(350.4, 12);
  });

  it('zero solute changes nothing; bad input gets a clear message', () => {
    expect(val(colligative({ ...base, nSolute: 0 }), 'kitChemMat.sol.row.dTf')).toBe(0);
    expect(colligative({ ...base, nSolute: -1 })).toMatchObject({ ok: false, key: 'kitChemMat.sol.err.amount' });
    expect(colligative({ ...base, solventMass: 0 })).toMatchObject({ ok: false, key: 'kitChemMat.sol.err.solvent' });
    expect(colligative({ ...base, i: 0 })).toMatchObject({ ok: false, key: 'kitChemMat.sol.err.factor' });
    expect(colligative({ ...base, solvent: 'custom' })).toMatchObject({
      ok: false,
      key: 'kitChemMat.sol.err.constants',
    });
    expect(colligative({ ...base, nSolute: 1e6 })).toMatchObject({
      ok: false,
      key: 'kitChemMat.sol.err.tooConcentrated',
    });
  });
});

describe('osmotic pressure', () => {
  it('0.1 M glucose at 298.15 K is 2.4790 bar', () => {
    const o = osmotic({ c: 0.1, i: 1, T: 298.15 });
    expect(rel(val(o, 'kitChemMat.sol.row.osmotic') / 1e5, 2.479)).toBeLessThan(1e-4);
    expect(osmoticPressure(0.1, 1, 298.15)).toBeCloseTo(100 * 8.314462618 * 298.15, 6);
  });

  it('scales with i and rejects impossible input', () => {
    expect(osmoticPressure(0.2, 3, 300)).toBeCloseTo(6 * osmoticPressure(0.1, 1, 300), 6);
    expect(osmotic({ c: -1, i: 1, T: 300 })).toMatchObject({ ok: false, key: 'kitChemMat.sol.err.conc' });
    expect(osmotic({ c: 1, i: 1, T: 0 })).toMatchObject({ ok: false, key: 'kitChemMat.err.temperature' });
  });
});

const cup = { kind: 'cup', mass: 100, c: 4.184, cal: NaN, dT: 6.7, n: 0.05, dn: NaN, T: NaN };

describe('calorimetry', () => {
  it('50 mL 1 M HCl + 50 mL 1 M NaOH, 6.7 C rise: q = 2803.3 J, dH = -56.07 kJ/mol', () => {
    const o = calorimetry(cup);
    expect(rel(val(o, 'kitChemMat.sol.row.q'), 2803.3)).toBeLessThan(1e-4);
    expect(rel(val(o, 'kitChemMat.sol.row.dH'), -56070)).toBeLessThan(2e-4);
    expect(rel(val(o, 'kitChemMat.sol.row.dH'), -(100 * 4.184 * 6.7) / 0.05)).toBeLessThan(1e-12);
  });

  it('a cooling solution is endothermic; the calorimeter adds to the heat capacity', () => {
    const o = calorimetry({ ...cup, dT: -3, cal: 20 });
    expect(val(o, 'kitChemMat.sol.row.q')).toBeCloseTo((418.4 + 20) * -3, 9);
    expect(val(o, 'kitChemMat.sol.row.dH')).toBeGreaterThan(0);
  });

  it('a bomb gives dU, and dH after the change in moles of gas', () => {
    const o = calorimetry({ kind: 'bomb', mass: NaN, c: NaN, cal: 10000, dT: 2.5, n: 0.01, dn: -1, T: 298.15 });
    expect(val(o, 'kitChemMat.sol.row.dU')).toBeCloseTo(-2.5e6, 6);
    expect(val(o, 'kitChemMat.sol.row.dHbomb')).toBeCloseTo(-2.5e6 - 8.314462618 * 298.15, 6);
  });

  it('rejects zero moles, no solution, and a bomb without a heat capacity', () => {
    expect(calorimetry({ ...cup, n: 0 })).toMatchObject({ ok: false, key: 'kitChemMat.sol.err.moles' });
    expect(calorimetry({ ...cup, mass: 0 })).toMatchObject({ ok: false, key: 'kitChemMat.sol.err.solution' });
    expect(calorimetry({ ...cup, kind: 'bomb' })).toMatchObject({ ok: false, key: 'kitChemMat.sol.err.capacity' });
    expect(calorimetry({ ...cup, dT: NaN })).toMatchObject({ ok: false, key: 'kitChemMat.sol.err.deltaT' });
  });
});

describe('calibration', () => {
  const exact = '0.1, 0.05\n0.2, 0.1\n0.4, 0.2\n0.8, 0.4';

  it('standards exactly on A = 0.5 c give slope 0.5, and A = 0.30 means c = 0.60', () => {
    const o = calibration(exact, '0.30', 1);
    expect(Math.abs(val(o, 'kitChemMat.sol.row.slope') - 0.5)).toBeLessThan(1e-12);
    expect(Math.abs(val(o, 'kitChemMat.sol.row.intercept'))).toBeLessThan(1e-12);
    expect(Math.abs(val(o, 'kitChemMat.sol.row.unknown') - 0.6)).toBeLessThan(1e-12);
    expect(Math.abs(val(o, 'kitChemMat.sol.row.r2') - 1)).toBeLessThan(1e-12);
    expect(Math.abs(val(o, 'kitChemMat.sol.row.unknownErr'))).toBeLessThan(1e-12);
    expect(val(o, 'kitChemMat.sol.row.epsilon')).toBeCloseTo(0.5, 12);
  });

  it('noisy standards match an independent least-squares and prediction-interval calculation', () => {
    const c = [1, 2, 3, 4, 5];
    const a = [0.11, 0.19, 0.32, 0.38, 0.52];
    const fit = calibrationLine(c, a)!;
    // Independent: sums by hand.
    const n = 5;
    const sx = 15;
    const sy = a.reduce((p, v) => p + v, 0);
    const sxy = c.reduce((p, v, i) => p + v * a[i], 0);
    const sxx = c.reduce((p, v) => p + v * v, 0);
    const slope = (n * sxy - sx * sy) / (n * sxx - sx * sx);
    const intercept = (sy - slope * sx) / n;
    expect(fit.slope).toBeCloseTo(slope, 12);
    expect(fit.intercept).toBeCloseTo(intercept, 12);
    const resid = c.map((x, i) => a[i] - intercept - slope * x);
    const s = Math.sqrt(resid.reduce((p, r) => p + r * r, 0) / 3);
    const u = unknownConcentration(fit, [0.3]);
    const expected = (s / slope) * Math.sqrt(1 + 1 / 5 + (0.3 - sy / 5) ** 2 / (slope ** 2 * 10));
    expect(u.x0).toBeCloseTo((0.3 - intercept) / slope, 12);
    expect(u.se).toBeCloseTo(expected, 12);
    // More replicates tighten the uncertainty.
    expect(unknownConcentration(fit, [0.3, 0.3, 0.3, 0.3]).se).toBeLessThan(u.se);
  });

  it('warns when the unknown lies outside the standards, and rejects bad tables', () => {
    const o = calibration(exact, '0.9', NaN);
    expect(o.ok && o.notes.some((n) => n.key === 'kitChemMat.sol.note.extrapolated')).toBe(true);
    expect(calibration('1, 2, 3', '0.3', NaN)).toMatchObject({ ok: false, key: 'kitChemMat.sol.err.standards' });
    expect(calibration('1, 0.1', '0.3', NaN)).toMatchObject({ ok: false, key: 'kitChemMat.sol.err.fewStandards' });
    expect(calibration('1, 0.1\n1, 0.2', '0.3', NaN)).toMatchObject({
      ok: false,
      key: 'kitChemMat.sol.err.sameStandards',
    });
    expect(calibration('1, 0.1\n2, 0.1', '0.3', NaN)).toMatchObject({ ok: false, key: 'kitChemMat.sol.err.flat' });
    expect(calibration(exact, 'abc', NaN)).toMatchObject({ ok: false, key: 'kitChemMat.sol.err.unknown' });
    expect(calibration('-1, 0.1\n2, 0.3', '0.3', NaN)).toMatchObject({
      ok: false,
      key: 'kitChemMat.sol.err.negativeStandard',
    });
  });
});

describe('percent yield and purity', () => {
  it('computes the yield and the pure yield', () => {
    const o = yieldCalc(8.2, 10, 95);
    expect(val(o, 'kitChemMat.sol.row.yield')).toBeCloseTo(82, 12);
    expect(val(o, 'kitChemMat.sol.row.pureYield')).toBeCloseTo(77.9, 12);
  });

  it('flags a yield over 100% and rejects impossible values', () => {
    const o = yieldCalc(11, 10, NaN);
    expect(o.ok && o.notes[0].key).toBe('kitChemMat.sol.note.over');
    expect(yieldCalc(1, 0, NaN)).toMatchObject({ ok: false, key: 'kitChemMat.sol.err.theoretical' });
    expect(yieldCalc(-1, 10, NaN)).toMatchObject({ ok: false, key: 'kitChemMat.sol.err.actual' });
    expect(yieldCalc(1, 10, 120)).toMatchObject({ ok: false, key: 'kitChemMat.sol.err.purity' });
  });
});
