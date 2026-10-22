// The chemistry helpers: formulas are read with groups and hydrates, molar masses add up, and equations balance to the
// smallest whole numbers or say why they cannot.
import { describe, expect, it } from 'vitest';
import { balanceEquation, formatMass, molarMass, parseFormula, prettyFormula } from './chemistry';

const atoms = (formula: string) => {
  const result = parseFormula(formula);
  if (!result.ok) throw new Error(`${formula}: ${result.reason}`);
  return Object.fromEntries(result.atoms);
};

describe('formulas', () => {
  it('count atoms, including groups, brackets, and hydrates', () => {
    expect(atoms('H2O')).toEqual({ H: 2, O: 1 });
    expect(atoms('Ca(OH)2')).toEqual({ Ca: 1, O: 2, H: 2 });
    expect(atoms('K4[Fe(CN)6]')).toEqual({ K: 4, Fe: 1, C: 6, N: 6 });
    expect(atoms('CuSO4·5H2O')).toEqual({ Cu: 1, S: 1, O: 9, H: 10 });
    expect(atoms('Al2(SO4)3')).toEqual({ Al: 2, S: 3, O: 12 });
    expect(atoms('H₂SO₄')).toEqual({ H: 2, S: 1, O: 4 });
  });
  it('tell Co from CO, and read two-letter symbols', () => {
    expect(atoms('CO')).toEqual({ C: 1, O: 1 });
    expect(atoms('Co')).toEqual({ Co: 1 });
    expect(atoms('NaCl')).toEqual({ Na: 1, Cl: 1 });
  });
  it('say what is wrong', () => {
    expect(parseFormula('')).toMatchObject({ ok: false, reason: 'empty' });
    expect(parseFormula('Xx2')).toMatchObject({ ok: false, reason: 'unknown-element', detail: 'X' });
    expect(parseFormula('H2O)')).toMatchObject({ ok: false, reason: 'syntax' });
    expect(parseFormula('(H2O')).toMatchObject({ ok: false, reason: 'syntax' });
    expect(parseFormula('H2O#')).toMatchObject({ ok: false, reason: 'syntax' });
    expect(parseFormula('H99999999')).toMatchObject({ ok: false, reason: 'syntax' });
  });
  it('show counts as subscripts', () => {
    expect(prettyFormula('H2SO4')).toBe('H₂SO₄');
    expect(prettyFormula('CuSO4·5H2O')).toBe('CuSO₄·5H₂O');
  });
});

describe('molar mass', () => {
  it('adds the atomic masses', () => {
    const water = molarMass('H2O');
    if (!water.ok) throw new Error('water');
    expect(formatMass(water.mass)).toBe('18.015');
    expect(water.parts.map((part) => part.symbol)).toEqual(['H', 'O']);
    expect(water.parts[1].percent).toBeCloseTo(88.81, 1);
    const salt = molarMass('NaCl');
    expect(salt.ok && formatMass(salt.mass)).toBe('58.44');
    const glucose = molarMass('C6H12O6');
    expect(glucose.ok && formatMass(glucose.mass)).toBe('180.156');
    const blue = molarMass('CuSO4·5H2O');
    expect(blue.ok && formatMass(blue.mass)).toBe('249.677');
  });
  it('fails on a formula it cannot read', () => {
    expect(molarMass('Qq')).toMatchObject({ ok: false });
  });
});

describe('balancing', () => {
  const balanced = (equation: string) => {
    const result = balanceEquation(equation);
    if (!result.ok) throw new Error(`${equation}: ${result.reason}`);
    return result;
  };
  it('balances water', () => {
    const result = balanced('H2+O2->H2O');
    expect(result.coefficients).toEqual([2, 1, 2]);
    expect(result.text).toBe('2H₂ + O₂ → 2H₂O');
  });
  it('balances combustion, synthesis, and redox equations', () => {
    expect(balanced('C3H8 + O2 -> CO2 + H2O').coefficients).toEqual([1, 5, 3, 4]);
    expect(balanced('N2 + H2 = NH3').coefficients).toEqual([1, 3, 2]);
    expect(balanced('Fe + O2 → Fe2O3').coefficients).toEqual([4, 3, 2]);
    expect(balanced('KMnO4 + HCl -> KCl + MnCl2 + H2O + Cl2').coefficients).toEqual([2, 16, 2, 2, 8, 5]);
    expect(balanced('Ca(OH)2 + H3PO4 -> Ca3(PO4)2 + H2O').coefficients).toEqual([3, 2, 1, 6]);
    expect(balanced('C6H12O6 + O2 -> CO2 + H2O').coefficients).toEqual([1, 6, 6, 6]);
  });
  it('ignores coefficients that are already typed', () => {
    expect(balanced('2H2 + O2 -> 2H2O').coefficients).toEqual([2, 1, 2]);
    expect(balanced('H2 + 3 O2 -> H2O').coefficients).toEqual([2, 1, 2]);
  });
  it('says when it cannot balance, or when there is more than one way', () => {
    expect(balanceEquation('H2 -> O2')).toMatchObject({ ok: false, reason: 'cannot-balance' });
    expect(balanceEquation('H2 + O2')).toMatchObject({ ok: false, reason: 'no-arrow' });
    expect(balanceEquation('H2 ->')).toMatchObject({ ok: false, reason: 'one-side' });
    expect(balanceEquation('')).toMatchObject({ ok: false, reason: 'empty' });
    expect(balanceEquation('H2 + Zz -> H2Zz')).toMatchObject({ ok: false, reason: 'unknown-element' });
    expect(balanceEquation('H2 + O2 + H2O -> H2O2 + H2O')).toMatchObject({ ok: false, reason: 'many-ways' });
  });
});
