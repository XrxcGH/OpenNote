// The ideal-gas tool against the published validation values, then against independent calculations: the entropy
// change integrated from cp directly, the first law, and the NASA fits joining smoothly at 1000 K.
import '../text';
import { describe, expect, it } from 'vitest';
import { integrate } from '../common/num';
import { ThermoError, type ThermoResult } from '../common/types';
import { toEngine } from '../common/units';
import { RU, SPECIES, molarCp, molarH, molarS } from '../data/nasa';
import { solveProcess, solveState, type ProcessInput } from './engine';
import { gasOf } from './gas';
import { spec } from './spec';

const row = (result: ThermoResult, key: string): number => {
  const found = result.rows.find((one) => one.key === key);
  if (!found) throw new Error(`no row ${key}`);
  return found.value;
};

const compression: ProcessInput = {
  gas: 'air',
  model: 'cold',
  process: 'isentropic',
  T1: 300,
  p1: 100,
  end: 'p2',
  value: 1000,
  n: 1,
};

const code = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return error instanceof ThermoError ? error.code : 'other';
  }
  return 'none';
};

describe('ideal gases: validation cases', () => {
  it('cold-air isentropic compression from 300 K, 100 kPa to 1 MPa gives T2 = 579.21 K', () => {
    expect(row(solveProcess(compression), 'T2')).toBeCloseTo(579.21, 2);
  });

  it('air with variable specific heats gives T2 near 574 K for the same compression', () => {
    const T2 = row(solveProcess({ ...compression, model: 'variable' }), 'T2');
    expect(T2).toBeGreaterThan(572);
    expect(T2).toBeLessThan(576);
  });

  it('polytropic n = 1.3 from 300 K, 100 kPa to 1 MPa gives T2 = 510.38 K and w = -201.26 kJ/kg', () => {
    const result = solveProcess({ ...compression, process: 'polytropic', n: 1.3 });
    expect(Math.abs(row(result, 'T2') / 510.38 - 1)).toBeLessThan(1e-4);
    expect(Math.abs(row(result, 'wb') / -201.26 - 1)).toBeLessThan(1e-4);
  });

  it('NASA data at 298.15 K: N2 cp = 29.124, CO2 s0 = 213.79 J/(mol K), H2O(g) hf = -241.826 kJ/mol', () => {
    expect(Math.abs(molarCp(SPECIES.N2, 298.15) / 29.124 - 1)).toBeLessThan(1e-3);
    expect(Math.abs(molarS(SPECIES.CO2, 298.15) / 213.79 - 1)).toBeLessThan(1e-3);
    expect(Math.abs(molarH(SPECIES.H2O, 298.15) / 1000 / -241.826 - 1)).toBeLessThan(1e-3);
  });
});

describe('ideal gases: independent checks', () => {
  it('the variable-cp isentrope has zero entropy change when cp/T is integrated directly', () => {
    const result = solveProcess({ ...compression, model: 'variable' });
    const T2 = row(result, 'T2');
    const air = gasOf('air', 'variable');
    const ds = integrate((T) => air.cp(T) / T, 300, T2, 16) - air.R * Math.log(10);
    expect(Math.abs(ds)).toBeLessThan(1e-7);
    expect(Math.abs(row(result, 'ds'))).toBeLessThan(1e-9);
    // Adiabatic and reversible: the closed-system heat is zero and the work is the drop in u.
    expect(Math.abs(row(result, 'qClosed'))).toBeLessThan(1e-6);
  });

  it('the enthalpy of every species is the integral of its cp', () => {
    for (const species of Object.values(SPECIES)) {
      const integral = integrate((T) => molarCp(species, T), 300, 900, 8);
      expect(molarH(species, 900) - molarH(species, 300)).toBeCloseTo(integral, 3);
    }
  });

  it('every NASA fit joins smoothly at 1000 K', () => {
    for (const species of Object.values(SPECIES)) {
      expect(Math.abs(molarCp(species, 999.999) - molarCp(species, 1000))).toBeLessThan(0.05);
      expect(Math.abs(molarH(species, 999.999) - molarH(species, 1000))).toBeLessThan(5);
      expect(Math.abs(molarS(species, 999.999) - molarS(species, 1000))).toBeLessThan(0.02);
    }
  });

  it('isothermal work is RT ln(p1/p2), and the heat equals the work', () => {
    const result = solveProcess({ ...compression, process: 'isothermal' });
    const expected = 0.287 * 300 * Math.log(100 / 1000);
    expect(row(result, 'wb')).toBeCloseTo(expected, 9);
    expect(row(result, 'qClosed')).toBeCloseTo(expected, 9);
    expect(row(result, 'T2')).toBe(300);
  });

  it('constant-pressure heating needs q = cp dT, and constant-volume heating q = cv dT', () => {
    const isobaric = solveProcess({ ...compression, process: 'isobaric', end: 'T2', value: 400 });
    expect(row(isobaric, 'qClosed')).toBeCloseTo(1.005 * 100, 9);
    expect(row(isobaric, 'wb')).toBeCloseTo(0.287 * 100, 9);
    const isochoric = solveProcess({ ...compression, process: 'isochoric', end: 'T2', value: 400 });
    expect(row(isochoric, 'qClosed')).toBeCloseTo(0.718 * 100, 9);
    expect(row(isochoric, 'p2')).toBeCloseTo((100 * 400) / 300, 9);
  });

  it('a volume ratio of 8 with k = 1.4 gives T2 = T1 8^0.4', () => {
    const result = solveProcess({ ...compression, end: 'r', value: 8 });
    expect(row(result, 'T2')).toBeCloseTo(300 * 8 ** 0.4, 9);
    expect(row(result, 'v1') / row(result, 'v2')).toBeCloseTo(8, 9);
  });

  it('one state: h - u = RT, the speed of sound, and Pr ratios match an isentrope', () => {
    const state = solveState({ gas: 'air', model: 'cold', T: 300, p: 100 });
    expect(row(state, 'h') - row(state, 'u')).toBeCloseTo(0.287 * 300, 9);
    expect(row(state, 'soundSpeed')).toBeCloseTo(Math.sqrt(1.4 * 287 * 300), 6);
    const T2 = row(solveProcess({ ...compression, model: 'variable' }), 'T2');
    const pr1 = row(solveState({ gas: 'air', model: 'variable', T: 300, p: 100 }), 'pr');
    const pr2 = row(solveState({ gas: 'air', model: 'variable', T: T2, p: 1000 }), 'pr');
    expect(pr2 / pr1).toBeCloseTo(10, 6);
  });

  it('air is 28.965 g/mol from its composition, and its constant cp at 300 K is near 1.005 kJ/(kg K)', () => {
    const air = gasOf('air', 'constant');
    expect(air.M).toBeCloseTo(28.965, 2);
    expect(air.cp(300)).toBeCloseTo(1.005, 2);
    expect(RU / air.M).toBeCloseTo(0.28706, 4);
  });

  it('offers the cold-air standard only for air, and refuses it for another gas', () => {
    // Helium is monatomic, k = 5/3: isentropic 300 K, 100 kPa to 1 MPa gives 300 (10)^0.4 = 753.57 K.
    expect(code(() => solveProcess({ ...compression, gas: 'He' }))).toBe('coldAirOnly');
    expect(row(solveProcess({ ...compression, gas: 'He', model: 'constant' }), 'T2')).toBeCloseTo(300 * 10 ** 0.4, 0);
    const models = (gas: string) =>
      spec.modes[1]
        .fields({ gas })
        .find((field) => field.id === 'model')!
        .options!.map((one) => one.value);
    expect(models('air')).toContain('cold');
    expect(models('He')).not.toContain('cold');
  });

  it('reads a temperature typed in °C through the form', () => {
    const values = {
      gas: 'air',
      model: 'cold',
      process: 'isentropic',
      end: 'p2',
      T1: toEngine(26.85, 'T', '°C'),
      p1: 100,
      p2: 1000,
    };
    expect(row(spec.solve('process', values), 'T2')).toBeCloseTo(579.21, 2);
  });
});

describe('ideal gases: problems in words', () => {
  it('rejects zero and negative temperature and pressure', () => {
    expect(code(() => solveProcess({ ...compression, T1: 0 }))).toBe('notPositive');
    expect(code(() => solveProcess({ ...compression, p1: -5 }))).toBe('notPositive');
    expect(code(() => solveProcess({ ...compression, value: 0 }))).toBe('notPositive');
    expect(code(() => solveState({ gas: 'N2', model: 'variable', T: -1, p: 100 }))).toBe('notPositive');
  });

  it('says when a temperature leaves the fitted range', () => {
    expect(code(() => solveState({ gas: 'air', model: 'variable', T: 150, p: 100 }))).toBe('gasRange');
    expect(code(() => solveProcess({ ...compression, model: 'variable', value: 1e9 }))).toBe('gasRange');
  });

  it('refuses an end condition the process cannot take and a bad exponent', () => {
    expect(code(() => solveProcess({ ...compression, process: 'isothermal', end: 'T2', value: 400 }))).toBe(
      'endNotAllowed',
    );
    expect(code(() => solveProcess({ ...compression, process: 'polytropic', n: -1 }))).toBe('badExponent');
  });

  it('treats n = 1 as isothermal and stays finite for a huge pressure ratio with constant cp', () => {
    const one = solveProcess({ ...compression, process: 'polytropic', n: 1 });
    expect(row(one, 'T2')).toBeCloseTo(300, 9);
    const huge = solveProcess({ ...compression, value: 1e8 });
    expect(Number.isFinite(row(huge, 'T2'))).toBe(true);
  });
});
