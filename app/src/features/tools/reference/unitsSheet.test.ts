// The units sheet holds the seven SI base units, the named derived units, CODATA 2022 constants, and formulas, and
// searches them all by every word.
import { describe, expect, it } from 'vitest';
import {
  BASE_UNITS,
  CHEMISTRY_FORMULAS,
  CODATA_CONSTANTS,
  DERIVED_UNITS,
  MATH_FORMULAS,
  PHYSICS_FORMULAS,
  constantLine,
  countSheet,
  scientific,
  searchSheet,
} from './unitsSheet';

describe('the units sheet', () => {
  it('lists the seven SI base units and the 22 named derived units', () => {
    expect(BASE_UNITS.map((unit) => unit.symbol)).toEqual(['m', 'kg', 's', 'A', 'K', 'mol', 'cd']);
    expect(DERIVED_UNITS).toHaveLength(22);
    expect(DERIVED_UNITS.find((unit) => unit.name === 'newton')).toMatchObject({ symbol: 'N', definition: 'kg·m/s²' });
  });
  it('lists the CODATA 2022 constants, with the exact ones marked', () => {
    const find = (symbol: string) => CODATA_CONSTANTS.find((one) => one.symbol === symbol);
    expect(find('c')).toMatchObject({ value: 299792458, exact: true });
    expect(find('h')).toMatchObject({ value: 6.62607015e-34, exact: true });
    expect(find('k')).toMatchObject({ value: 1.380649e-23, exact: true });
    expect(find('N_A')).toMatchObject({ value: 6.02214076e23, exact: true });
    // 2022 values that changed from 2018.
    expect(find('m_e')?.value).toBe(9.1093837139e-31);
    expect(find('ε₀')?.value).toBe(8.8541878188e-12);
    expect(find('α')?.exact).toBe(false);
    // The gas constant and the Faraday constant are products of exact constants.
    expect((find('R')?.value ?? 0) / ((find('k')?.value ?? 1) * (find('N_A')?.value ?? 1))).toBeCloseTo(1, 9);
    expect((find('F')?.value ?? 0) / ((find('e')?.value ?? 1) * (find('N_A')?.value ?? 1))).toBeCloseTo(1, 9);
    expect(new Set(CODATA_CONSTANTS.map((one) => one.symbol)).size).toBe(CODATA_CONSTANTS.length);
  });
  it('has formulas for math, physics, and chemistry, each with a name and a meaning', () => {
    for (const list of [MATH_FORMULAS, PHYSICS_FORMULAS, CHEMISTRY_FORMULAS]) {
      expect(list.length).toBeGreaterThanOrEqual(20);
      expect(new Set(list.map((one) => one.name)).size).toBe(list.length);
      for (const one of list) {
        expect(one.text.length).toBeGreaterThan(3);
        expect(one.where.length).toBeGreaterThan(3);
      }
    }
  });
  it('writes numbers in scientific notation for a page', () => {
    expect(scientific(6.62607015e-34)).toBe('6.62607015 × 10⁻³⁴');
    expect(scientific(6.02214076e23)).toBe('6.02214076 × 10²³');
    expect(scientific(101325)).toBe('101325');
    const planck = CODATA_CONSTANTS.find((one) => one.symbol === 'h');
    expect(planck && constantLine(planck)).toBe('h = 6.62607015 × 10⁻³⁴ J·s');
  });
  it('searches every section by every word', () => {
    const all = searchSheet('', 'all');
    expect(countSheet(all)).toBe(
      BASE_UNITS.length +
        DERIVED_UNITS.length +
        CODATA_CONSTANTS.length +
        MATH_FORMULAS.length +
        PHYSICS_FORMULAS.length +
        CHEMISTRY_FORMULAS.length,
    );
    const force = searchSheet('force', 'all');
    expect(force.derived.map((unit) => unit.name)).toContain('newton');
    expect(force.physics.length).toBeGreaterThan(0);
    expect(searchSheet('planck', 'all').constants.length).toBeGreaterThanOrEqual(2);
    expect(searchSheet('planck', 'physics').constants).toEqual([]);
    expect(searchSheet('quadratic zzz', 'all')).toMatchObject({ math: [], base: [] });
    expect(searchSheet('ph henderson', 'chemistry').chemistry).toHaveLength(1);
  });
});
