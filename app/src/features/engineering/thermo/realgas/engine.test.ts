// The real-gas tool against the planning pass's validation values, then against independent routes. Each root
// goes back into the explicit pressure equation, and departures and fugacity are integrated numerically from
// p(T, v). The critical point of each equation, the saturation pressure where the two roots' fugacities meet, and
// mixtures worked from the NASA molar values are checked too.
import { describe, expect, it } from 'vitest';
import { brent, cubicRoots, integrate } from '../common/num';
import { ThermoError, type ThermoResult } from '../common/types';
import { toEngine } from '../common/units';
import { RU, SPECIES, molarCp } from '../data/nasa';
import { CRITICAL } from './critical';
import { eosParams, eosPressure, residual, solveZ, type EosId } from './cubic';
import { solveEos, solveMixture, type EosInput } from './engine';

const row = (result: ThermoResult, key: string, tag?: string): number => {
  const found = result.rows.find((one) => one.key === key && (tag === undefined || one.tag === tag));
  if (!found) throw new Error(`no row ${key}`);
  return found.value;
};

const code = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return error instanceof ThermoError ? error.code : 'other';
  }
  return 'none';
};

const co2 = CRITICAL.CO2;
const co2State = (over: Partial<EosInput> = {}): EosInput => ({
  eos: 'pr',
  Tc: co2.Tc,
  pc: co2.pc,
  omega: co2.omega,
  M: co2.M,
  given: 'Tp',
  T: 320,
  p: 5000,
  root: 'stable',
  ...over,
});

const rel = (value: number, expected: number) => Math.abs(value / expected - 1);

describe('real gases: validation cases', () => {
  it('CO2 by Peng-Robinson at 320 K and 5 MPa gives Z = 0.7541 and v = 0.009118 m³/kg', () => {
    const result = solveEos(co2State());
    expect(rel(row(result, 'zFactor'), 0.7541)).toBeLessThan(1e-3);
    expect(rel(row(result, 'v'), 0.009118)).toBeLessThan(1e-3);
  });

  it('van der Waals constants for CO2 are a = 0.36566 Pa·m⁶/mol² and b = 4.2846e-5 m³/mol', () => {
    const result = solveEos(co2State({ eos: 'vdw' }));
    expect(rel(row(result, 'eosA'), 0.36566)).toBeLessThan(1e-4);
    expect(rel(row(result, 'eosB'), 4.2846e-5)).toBeLessThan(1e-4);
  });

  it('50 % N2 and 50 % CO2 by mass gives M = 34.235, R = 0.24286, and y_N2 = 0.6110', () => {
    const result = solveMixture({
      basis: 'mass',
      parts: [
        { gas: 'N2', amount: 0.5 },
        { gas: 'CO2', amount: 0.5 },
      ],
      T: 300,
      p: 100,
    });
    expect(rel(row(result, 'molarMassRow'), 34.235)).toBeLessThan(1e-4);
    expect(rel(row(result, 'gasR'), 0.24286)).toBeLessThan(1e-4);
    expect(rel(row(result, 'moleFraction', 'N₂'), 0.611)).toBeLessThan(1e-4);
  });
});

describe('real gases: independent checks', () => {
  it('solves cubics with one, two, and three distinct roots', () => {
    expect(cubicRoots(-6, 11, -6).map((x) => Number(x.toFixed(10)))).toEqual([1, 2, 3]);
    expect(cubicRoots(0, 0, -1)).toEqual([1]);
    const triple = cubicRoots(-6, 12, -8);
    expect(triple.length).toBe(1);
    expect(triple[0]).toBeCloseTo(2, 4);
    const double = cubicRoots(-5, 7, -3);
    expect(double.length).toBe(2);
    expect(double[0]).toBeCloseTo(1, 6);
    expect(double[1]).toBeCloseTo(3, 9);
  });

  it.each(['vdw', 'rk', 'srk', 'pr'] as EosId[])('%s: every root puts back the pressure it came from', (eos) => {
    for (const [T, p] of [
      [320, 5000],
      [280, 4000],
      [250, 1000],
      [600, 20000],
    ]) {
      const e = eosParams(eos, T, co2.Tc, co2.pc * 1000, co2.omega);
      const { roots } = solveZ(e, T, p * 1000, 'stable');
      for (const Z of roots) {
        const v = (Z * RU * T) / (p * 1000);
        expect(rel(eosPressure(e, T, v), p * 1000)).toBeLessThan(1e-9);
      }
    }
  });

  it('has the textbook critical compressibility of each equation', () => {
    const at = (eos: EosId) => solveEos(co2State({ eos, T: co2.Tc, p: co2.pc }));
    expect(row(at('vdw'), 'zFactor')).toBeCloseTo(3 / 8, 3);
    expect(row(at('rk'), 'zFactor')).toBeCloseTo(1 / 3, 3);
    expect(row(at('pr'), 'zFactor')).toBeCloseTo(0.3074, 3);
  });

  it.each(['vdw', 'rk', 'srk', 'pr'] as EosId[])('%s: departures match integrals of p(T, v)', (eos) => {
    const T = 320;
    const p = 5e6;
    const e = eosParams(eos, T, co2.Tc, co2.pc * 1000, co2.omega);
    const Z = solveZ(e, T, p, 'stable').Z;
    const v = (Z * RU * T) / p;
    const dpdT = (vv: number) => {
      const dT = 1e-3;
      const up = eosParams(eos, T + dT, co2.Tc, co2.pc * 1000, co2.omega);
      const down = eosParams(eos, T - dT, co2.Tc, co2.pc * 1000, co2.omega);
      return (eosPressure(up, T + dT, vv) - eosPressure(down, T - dT, vv)) / (2 * dT);
    };
    // Integrate over density from 0 to 1/v, so the infinite volume end is a finite one.
    const overRho = (f: (vv: number) => number) =>
      integrate((rho) => (rho === 0 ? 0 : -f(1 / rho) / rho ** 2), 0, 1 / v, 16);
    const hRes = overRho((vv) => T * dpdT(vv) - eosPressure(e, T, vv)) + p * v - RU * T;
    const sRes = overRho((vv) => dpdT(vv) - RU / vv) + RU * Math.log(Z);
    const res = residual(e, T, v, Z);
    expect(Math.abs(res.h - hRes)).toBeLessThan(1e-3 * Math.abs(hRes) + 0.05);
    expect(Math.abs(res.s - sRes)).toBeLessThan(1e-3 * Math.abs(sRes) + 1e-4);
    // ln φ = ∫ (Z − 1)/p dp along the isotherm, on the gas branch (320 K is above CO2's critical point).
    const lnPhi = integrate((pp) => (solveZ(e, T, pp, 'gas').Z - 1) / pp, 1, p, 32);
    expect(Math.abs(res.lnPhi - lnPhi)).toBeLessThan(1e-4);
  });
});

describe('real gases: saturation, limits, and errors', () => {
  it('puts the Peng-Robinson saturation pressure of CO2 at 280 K within 2 % of 4.1607 MPa', () => {
    const T = 280;
    const e = eosParams('pr', T, co2.Tc, co2.pc * 1000, co2.omega);
    const gap = (pMPa: number) => {
      const pick = solveZ(e, T, pMPa * 1e6, 'stable');
      // Outside the three-root range only one phase exists: the gas below it, the liquid above.
      if (pick.lnPhiGas === undefined || pick.lnPhiLiquid === undefined) return pick.Z > 0.3 ? -1 : 1;
      return pick.lnPhiGas - pick.lnPhiLiquid;
    };
    const pSat = brent(gap, 3.6, 4.6, 1e-10);
    expect(rel(pSat, 4.1607)).toBeLessThan(0.02);
    // Below it the gas root is stable, above it the liquid one.
    expect(solveEos(co2State({ T, p: 3000 })).steps.some((step) => step.key === 'eos.why.stableGas')).toBe(true);
    expect(row(solveEos(co2State({ T, p: 3000 })), 'zFactor')).toBeGreaterThan(0.6);
    expect(row(solveEos(co2State({ T, p: 4400 })), 'zFactor')).toBeLessThan(0.2);
  });

  it('turns back into an ideal gas at high T and low p', () => {
    const result = solveEos(co2State({ T: 2000, p: 1 }));
    expect(Math.abs(row(result, 'zFactor') - 1)).toBeLessThan(1e-4);
    expect(Math.abs(row(result, 'hDeparture'))).toBeLessThan(0.05);
    expect(Math.abs(row(result, 'fugacityCoeff') - 1)).toBeLessThan(1e-4);
  });

  it('goes from T and v back to the same pressure, in any unit', () => {
    const v = row(solveEos(co2State()), 'v');
    expect(rel(row(solveEos(co2State({ given: 'Tv', v, p: undefined })), 'pressure'), 5000)).toBeLessThan(1e-9);
    const inPsia = solveEos(co2State({ p: toEngine(725.18869, 'p', 'psia') }));
    expect(rel(row(inPsia, 'zFactor'), row(solveEos(co2State()), 'zFactor'))).toBeLessThan(1e-6);
  });

  it('handles a very high pressure with one dense root', () => {
    const result = solveEos(co2State({ p: 1e6 }));
    expect(row(result, 'zFactor')).toBeGreaterThan(1);
    expect(Number.isFinite(row(result, 'sDeparture'))).toBe(true);
  });

  it('says what is wrong with impossible input', () => {
    expect(code(() => solveEos(co2State({ T: 0 })))).toBe('notPositive');
    expect(code(() => solveEos(co2State({ p: -5 })))).toBe('notPositive');
    expect(code(() => solveEos(co2State({ Tc: 0 })))).toBe('notPositive');
    expect(code(() => solveEos(co2State({ omega: 3 })))).toBe('omegaRange');
    expect(code(() => solveEos(co2State({ given: 'Tv', v: 1e-5 })))).toBe('eosCovolume');
    expect(code(() => solveEos(co2State({ eos: 'vdw', given: 'Tv', T: 150, v: 0.0029207 })))).toBe(
      'eosNegativePressure',
    );
  });
});

describe('ideal-gas mixtures: independent checks', () => {
  const air = solveMixture({
    basis: 'mole',
    parts: [
      { gas: 'N2', amount: 78.08 },
      { gas: 'O2', amount: 20.95 },
      { gas: 'Ar', amount: 0.97 },
    ],
    T: 400,
    p: 200,
  });

  it('weights cp by mass, the same as molar Cp by mole over M', () => {
    const y = [0.7808, 0.2095, 0.0097];
    const ids = ['N2', 'O2', 'Ar'] as const;
    const M = ids.reduce((sum, id, i) => sum + y[i] * SPECIES[id].M, 0);
    const cp = ids.reduce((sum, id, i) => sum + y[i] * molarCp(SPECIES[id], 400), 0) / M;
    expect(rel(row(air, 'cp'), cp)).toBeLessThan(1e-12);
    expect(rel(row(air, 'molarMassRow'), 28.964)).toBeLessThan(1e-4);
    expect(row(air, 'kRatio')).toBeCloseTo(1.395, 2);
  });

  it('has partial pressures that add up to p, and gives the same mixture by mass or by moles', () => {
    const total = air.rows.filter((one) => one.key === 'partialPressure').reduce((sum, one) => sum + one.value, 0);
    expect(total).toBeCloseTo(200, 10);
    const mf = air.rows.filter((one) => one.key === 'massFraction');
    const byMass = solveMixture({
      basis: 'mass',
      parts: [
        { gas: 'N2', amount: mf[0].value },
        { gas: 'O2', amount: mf[1].value },
        { gas: 'Ar', amount: mf[2].value },
      ],
      T: 400,
      p: 200,
    });
    expect(rel(row(byMass, 'molarMassRow'), row(air, 'molarMassRow'))).toBeLessThan(1e-12);
  });

  it('gives R ln 2 for mixing equal moles and merges a gas listed twice', () => {
    const result = solveMixture({
      basis: 'mole',
      parts: [
        { gas: 'N2', amount: 1 },
        { gas: 'O2', amount: 0.5 },
        { gas: 'O2', amount: 0.5 },
      ],
      T: 300,
      p: 100,
    });
    expect(rel(row(result, 'mixEntropy'), (RU / row(result, 'molarMassRow')) * Math.log(2))).toBeLessThan(1e-12);
    expect(result.rows.filter((one) => one.key === 'moleFraction').length).toBe(2);
  });

  it('applies Kay’s rule with mole-weighted critical constants', () => {
    const Tc = 0.7808 * CRITICAL.N2.Tc + 0.2095 * CRITICAL.O2.Tc + 0.0097 * CRITICAL.Ar.Tc;
    expect(rel(row(air, 'pseudoTc'), Tc)).toBeLessThan(1e-12);
    expect(Math.abs(row(air, 'zFactor') - 1)).toBeLessThan(0.01);
  });

  it('says what is wrong with an empty or negative mixture', () => {
    const run = (amount: number) =>
      code(() => solveMixture({ basis: 'mass', parts: [{ gas: 'N2', amount }], T: 300, p: 100 }));
    expect(run(0)).toBe('mixEmpty');
    expect(run(-1)).toBe('notNegative');
    expect(code(() => solveMixture({ basis: 'mass', parts: [], T: 300, p: 100 }))).toBe('mixEmpty');
    expect(code(() => solveMixture({ basis: 'mass', parts: [{ gas: 'N2', amount: 1 }], T: 100, p: 100 }))).toBe(
      'gasRange',
    );
  });
});
