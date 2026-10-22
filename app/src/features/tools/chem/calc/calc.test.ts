// Chemistry calculators against textbook problems with known answers.
import { describe, expect, it } from 'vitest';
import { balance } from './balance';
import { combinedGas, gasDensity, grahamRatio, daltonPartials, idealGas } from './gas';
import { hillFormula, molarMass, parseFormula, percentComposition } from './formula';
import { buffer, dilution, dilutionPlan, phOf, serialDilution } from './solution';
import { convertThrough, empiricalFormula, limitingReagent, percentYield } from './stoich';
import { curve, phAt, summary, unknownConcentration } from './titration';
import type { Titration } from './titration';

const text = (equation: string) => {
  const r = balance(equation);
  return r.ok
    ? r.balanced.reactants
        .concat(r.balanced.products)
        .map((s) => s.coefficient)
        .join(',')
    : r.reason;
};

describe('formulas', () => {
  it('reads parentheses and hydrates', () => {
    expect(molarMass('H2O')).toBeCloseTo(18.015, 2);
    expect(molarMass('Ca(OH)2')).toBeCloseTo(74.09, 1);
    expect(molarMass('CuSO4.5H2O')).toBeCloseTo(249.69, 1);
    expect(molarMass('Al2(SO4)3')).toBeCloseTo(342.15, 1);
    expect(molarMass('H₂O')).toBeCloseTo(18.015, 2);
    expect(molarMass('Xx2')).toBeNull();
    expect(molarMass('(H2O')).toBeNull();
  });
  it('writes the Hill formula and the percent composition', () => {
    expect(hillFormula(parseFormula('C2H6O')!)).toBe('C2H6O');
    expect(hillFormula(parseFormula('OHC6H12')!)).toBe('C6H13O');
    const water = percentComposition('H2O')!;
    expect(water.find((p) => p.symbol === 'O')!.percent).toBeCloseTo(88.81, 1);
  });
});

describe('balancing', () => {
  it('balances textbook equations', () => {
    expect(text('C3H8 + O2 -> CO2 + H2O')).toBe('1,5,3,4');
    expect(text('Fe + O2 -> Fe2O3')).toBe('4,3,2');
    expect(text('KMnO4 + HCl -> KCl + MnCl2 + H2O + Cl2')).toBe('2,16,2,2,8,5');
    expect(text('Al + HCl → AlCl3 + H2')).toBe('2,6,2,3');
    expect(text('C6H12O6 + O2 = CO2 + H2O')).toBe('1,6,6,6');
  });
  it('balances charge too', () => {
    expect(text('MnO4- + Fe^2+ + H+ -> Mn^2+ + Fe^3+ + H2O')).toBe('1,5,8,1,5,4');
  });
  it('says why it cannot', () => {
    expect(text('H2 + O2')).toBe('format');
    expect(text('H2 + O2 -> H2O + N2')).toBe('element');
    expect(text('H2 + Zz -> H2O')).toBe('formula');
  });
});

describe('stoichiometry', () => {
  it('converts grams through the equation', () => {
    const r = convertThrough('CH4 + O2 -> CO2 + H2O', 'CH4', 25, 'CO2');
    expect(r.ok && r.grams).toBeCloseTo(68.6, 0);
  });
  it('finds the limiting reagent', () => {
    const r = limitingReagent('N2 + H2 -> NH3', { N2: 10, H2: 10 });
    expect(r.ok && r.limiting).toBe('N2');
    const nh3 = r.ok && r.lines.find((l) => l.text === 'NH3');
    expect(nh3 && nh3.grams).toBeCloseTo(12.17, 1);
    const h2 = r.ok && r.lines.find((l) => l.text === 'H2');
    expect(h2 && h2.leftover).toBeCloseTo(10 - 3 * (10 / 28.014) * 2.016, 2);
  });
  it('gives percent yield and an empirical formula', () => {
    expect(percentYield(8.5, 10)).toBeCloseTo(85, 5);
    const glucose = empiricalFormula([
      { symbol: 'C', amount: 40.0 },
      { symbol: 'H', amount: 6.71 },
      { symbol: 'O', amount: 53.29 },
    ]);
    expect(glucose?.formula).toBe('CH2O');
  });
});

describe('gas laws', () => {
  it('finds the molar volume at STP', () => {
    const r = idealGas({
      p: { value: 1, unit: 'atm' },
      v: { value: null, unit: 'L' },
      n: 1,
      t: { value: 0, unit: '°C' },
    });
    expect(r.ok && r.value).toBeCloseTo(22.414, 2);
  });
  it('finds pressure, moles, and temperature', () => {
    const p = idealGas({
      p: { value: null, unit: 'atm' },
      v: { value: 1.5, unit: 'L' },
      n: 2,
      t: { value: 25, unit: '°C' },
    });
    expect(p.ok && p.value).toBeCloseTo(32.6, 1);
    const n = idealGas({
      p: { value: 101.325, unit: 'kPa' },
      v: { value: 22.414, unit: 'L' },
      n: null,
      t: { value: 273.15, unit: 'K' },
    });
    expect(n.ok && n.value).toBeCloseTo(1, 3);
    const t = idealGas({
      p: { value: 2, unit: 'atm' },
      v: { value: 10, unit: 'L' },
      n: 0.5,
      t: { value: null, unit: 'K' },
    });
    expect(t.ok && t.value).toBeCloseTo(487.4, 0);
    expect(
      idealGas({ p: { value: 1, unit: 'atm' }, v: { value: 1, unit: 'L' }, n: 1, t: { value: 1, unit: 'K' } }),
    ).toEqual({ ok: false, reason: 'count' });
  });
  it('solves the combined gas law', () => {
    const r = combinedGas({ p1: 1, v1: 5, t1: 300, p2: 2, v2: null, t2: 350 });
    expect(r.ok && r.value).toBeCloseTo(2.917, 2);
  });
  it("applies Dalton's and Graham's laws and density", () => {
    expect(daltonPartials([1, 3], 4)).toEqual([1, 3]);
    expect(grahamRatio(2.016, 31.998)).toBeCloseTo(3.984, 2);
    expect(gasDensity(28.014, 1, 273.15)).toBeCloseTo(1.25, 2);
  });
});

describe('solutions', () => {
  it('dilutes', () => {
    const r = dilution({ c1: 6, v1: 50, c2: 0.5, v2: null });
    expect(r.ok && r.value).toBeCloseTo(600, 6);
    expect(dilutionPlan(12, 1, 500)).toEqual({ stockVolume: 500 / 12, water: 500 - 500 / 12 });
    expect(serialDilution(1, 1, 10, 3)).toEqual([0.1, 0.01, 0.001].map((x) => expect.closeTo(x, 10)));
  });
  it('finds the pH of strong and weak acids and bases and buffers', () => {
    expect(phOf('strongAcid', 0.01)!.ph).toBeCloseTo(2, 5);
    expect(phOf('strongBase', 0.001)!.ph).toBeCloseTo(11, 5);
    expect(phOf('weakAcid', 0.1, 1.8e-5)!.ph).toBeCloseTo(2.875, 2);
    expect(phOf('weakBase', 0.1, 1.8e-5)!.ph).toBeCloseTo(11.125, 2);
    expect(buffer(4.745, 0.1, 0.1)!.ph).toBeCloseTo(4.745, 3);
    expect(buffer(4.745, 0.2, 0.1)!.ph).toBeCloseTo(5.046, 2);
  });
});

describe('titration', () => {
  const strong: Titration = { analyte: 'strongAcid', concentration: 0.1, volume: 25, titrantConcentration: 0.1 };
  const weak: Titration = { analyte: 'weakAcid', concentration: 0.1, volume: 25, k: 1.8e-5, titrantConcentration: 0.1 };
  it('curves a strong acid by a strong base', () => {
    expect(phAt(strong, 0)).toBeCloseTo(1, 2);
    expect(phAt(strong, 20)).toBeCloseTo(1.954, 2);
    expect(phAt(strong, 25)).toBeCloseTo(7, 2);
    expect(phAt(strong, 30)).toBeCloseTo(11.96, 2);
    expect(summary(strong).equivalence).toBeCloseTo(25, 6);
  });
  it('curves a weak acid by a strong base', () => {
    expect(phAt(weak, 0)).toBeCloseTo(2.875, 2);
    expect(phAt(weak, 12.5)).toBeCloseTo(4.745, 2);
    expect(phAt(weak, 25)).toBeCloseTo(8.72, 2);
  });
  it('curves bases by a strong acid', () => {
    const base: Titration = { analyte: 'strongBase', concentration: 0.1, volume: 25, titrantConcentration: 0.1 };
    expect(phAt(base, 0)).toBeCloseTo(13, 2);
    expect(phAt(base, 25)).toBeCloseTo(7, 2);
    const weakBase: Titration = {
      analyte: 'weakBase',
      concentration: 0.1,
      volume: 25,
      k: 1.8e-5,
      titrantConcentration: 0.1,
    };
    expect(phAt(weakBase, 25)).toBeCloseTo(5.28, 2);
  });
  it('finds an unknown concentration and makes a curve that rises', () => {
    expect(unknownConcentration(0.1, 23.45, 25).c).toBeCloseTo(0.0938, 4);
    const points = curve(strong);
    expect(points.length).toBe(61);
    for (let i = 1; i < points.length; i += 1) expect(points[i].ph).toBeGreaterThanOrEqual(points[i - 1].ph - 1e-9);
  });
});
