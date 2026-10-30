// Cycles against the published validation values, then against independent hand calculations: closed-form
// air-standard efficiencies, the first law around every cycle, textbook Rankine plants, and the inputs no cycle
// can have.
import { describe, expect, it } from 'vitest';
import { ThermoError, type ThermoResult } from '../common/types';
import { fromPS, fromPX } from '../steam/water';
import { fieldsOf, valuesOf } from '../ui/formState';
import { plotSvg, SCREEN_COLORS } from '../ui/plotSvg';
import { solveBrayton, solveCarnot, solvePiston, type BraytonInput, type PistonInput } from './gas';
import { spec } from './spec';
import { solveFridge, solveRankine, type FridgeInput, type RankineInput } from './vapor';

const rel = (a: number, b: number) => Math.abs(a / b - 1);
const row = (result: ThermoResult, key: string): number => {
  const found = result.rows.find((one) => one.key === key);
  if (!found) throw new Error(`no row ${key}`);
  return found.value;
};
const eta = (result: ThermoResult) => row(result, 'etaTh') / 100;
const state = (result: ThermoResult, label: string) => {
  const found = result.states?.find((one) => one.label === label);
  if (!found) throw new Error(`no state ${label}`);
  return found;
};
const code = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    return error instanceof ThermoError ? error.code : 'other';
  }
  return 'none';
};
/** The first law around the cycle: net work equals heat in minus heat out. */
const closes = (result: ThermoResult) =>
  expect(Math.abs(row(result, 'wNet') - (row(result, 'qIn') - row(result, 'qOut')))).toBeLessThan(1e-6);

const K = 1.4;
const piston = (over: Partial<PistonInput>): PistonInput => ({
  cycle: 'otto',
  model: 'cold',
  T1: 300,
  p1: 100,
  r: 8,
  T3: 1800,
  ...over,
});
const brayton = (over: Partial<BraytonInput>): BraytonInput => ({
  model: 'cold',
  T1: 300,
  p1: 100,
  rp: 10,
  T3: 1200,
  etaC: 1,
  etaT: 1,
  regen: 0,
  intercool: false,
  reheat: false,
  ...over,
});
const rankine = (over: Partial<RankineInput>): RankineInput => ({
  variant: 'simple',
  pHigh: 8000,
  pLow: 10,
  etaT: 1,
  etaP: 1,
  ...over,
});
const fridge = (over: Partial<FridgeInput>): FridgeInput => ({
  pLow: 140,
  pHigh: 800,
  etaC: 1,
  superheat: 0,
  subcool: 0,
  ...over,
});

describe('cycles: validation cases', () => {
  it('Otto r = 8, k = 1.4: η = 0.5647', () => {
    const result = solvePiston(piston({}));
    expect(Math.abs(eta(result) - 0.5647)).toBeLessThan(1e-4);
    expect(Math.abs(eta(result) - (1 - 8 ** (1 - K)))).toBeLessThan(1e-9);
  });

  it('Diesel r = 18, rc = 2, k = 1.4: η = 0.6316', () => {
    const result = solvePiston(piston({ cycle: 'diesel', r: 18, rc: 2 }));
    // Closed form: η = 1 − (rc^k − 1) / (k (rc − 1) r^(k−1)). The cold-air standard's cp/cv = 1.005/0.718 is
    // 1.39972, not exactly 1.4, so the state-by-state answer sits 9e-5 below the formula, as in textbooks.
    const formula = 1 - (2 ** K - 1) / (K * (2 - 1) * 18 ** (K - 1));
    expect(Math.abs(eta(result) - 0.6316)).toBeLessThan(1e-4);
    expect(Math.abs(eta(result) - formula)).toBeLessThan(1e-4);
    closes(result);
  });

  it('ideal Brayton rp = 10, k = 1.4: η = 0.4821', () => {
    const result = solveBrayton(brayton({}));
    expect(Math.abs(eta(result) - 0.4821)).toBeLessThan(1e-4);
    expect(Math.abs(eta(result) - (1 - 10 ** (-(K - 1) / K)))).toBeLessThan(1e-9);
  });

  it('Brayton rp = 10, 300 K to 1200 K, η_c 0.85, η_t 0.88, cp 1.005', () => {
    const result = solveBrayton(brayton({ etaC: 0.85, etaT: 0.88 }));
    // By hand: T2s = 300 × 10^(0.4/1.4), T4s = 1200 / 10^(0.4/1.4).
    const T2s = 300 * 10 ** (0.4 / 1.4);
    const T4s = 1200 / 10 ** (0.4 / 1.4);
    const wc = (1.005 * (T2s - 300)) / 0.85;
    const wt = 0.88 * 1.005 * (1200 - T4s);
    expect(rel(row(result, 'wCompressor'), 330.12)).toBeLessThan(1e-3);
    expect(rel(row(result, 'wTurbine'), 511.59)).toBeLessThan(1e-3);
    expect(rel(row(result, 'bwr'), 0.6453)).toBeLessThan(1e-3);
    expect(rel(eta(result), 0.3159)).toBeLessThan(1e-3);
    expect(rel(row(result, 'wCompressor'), wc)).toBeLessThan(1e-9);
    expect(rel(row(result, 'wTurbine'), wt)).toBeLessThan(1e-9);
    expect(rel(eta(result), (wt - wc) / (1.005 * (1200 - 300) - wc))).toBeLessThan(1e-9);
    closes(result);
  });

  it('ideal Rankine, 8 MPa saturated vapor to 10 kPa', () => {
    const result = solveRankine(rankine({}));
    expect(rel(state(result, '4').x ?? NaN, 0.6795)).toBeLessThan(3e-3);
    expect(rel(row(result, 'wPump'), 8.07)).toBeLessThan(3e-3);
    expect(rel(row(result, 'wTurbine'), 941.5)).toBeLessThan(3e-3);
    expect(rel(eta(result), 0.3648)).toBeLessThan(3e-3);
    // By hand: the pump work is close to v_f Δp, and the turbine exit has s = s_g(8 MPa).
    const f = fromPX(10, 0);
    expect(rel(row(result, 'wPump'), f.v * (8000 - 10))).toBeLessThan(2e-3);
    const g = fromPX(8000, 1);
    const sat = { f, g: fromPX(10, 1) };
    const x4 = (g.s - sat.f.s) / (sat.g.s - sat.f.s);
    expect(Math.abs((state(result, '4').x ?? NaN) - x4)).toBeLessThan(1e-6);
    closes(result);
  });

  it('ideal R-134a refrigerator, 0.14 to 0.8 MPa: COP about 3.97', () => {
    const result = solveFridge(fridge({}));
    expect(rel(row(result, 'copR'), 3.97)).toBeLessThan(0.02);
    expect(Math.abs(row(result, 'copHP') - row(result, 'copR') - 1)).toBeLessThan(1e-9);
    expect(Math.abs(row(result, 'qH') - row(result, 'qL') - row(result, 'wIn'))).toBeLessThan(1e-9);
  });
});

describe('cycles: Rankine plants and the first law', () => {
  it('reheat Rankine, 15 MPa and 600 °C, reheat at 4 MPa to 600 °C, 10 kPa: η about 45.0 %', () => {
    const result = solveRankine(rankine({ variant: 'reheat', pHigh: 15000, T3: 873.15, pReheat: 4000 }));
    expect(Math.abs(eta(result) - 0.45)).toBeLessThan(0.003);
    expect(Math.abs((state(result, '6').x ?? NaN) - 0.896)).toBeLessThan(0.002);
    closes(result);
  });

  it('open feedwater heater at 1.2 MPa, 15 MPa and 600 °C to 10 kPa: y about 0.227, η about 46.3 %', () => {
    const result = solveRankine(rankine({ variant: 'openFwh', pHigh: 15000, T3: 873.15, pFwh: 1200 }));
    expect(Math.abs(row(result, 'yFraction') - 0.227)).toBeLessThan(0.002);
    expect(Math.abs(eta(result) - 0.463)).toBeLessThan(0.003);
    closes(result);
  });

  it('a closed feedwater heater beats the simple cycle and closes the first law', () => {
    const base = rankine({ pHigh: 15000, T3: 873.15 });
    const simple = solveRankine(base);
    const closed = solveRankine({ ...base, variant: 'closedFwh', pFwh: 1200 });
    expect(eta(closed)).toBeGreaterThan(eta(simple));
    closes(closed);
    // The drain leaves the heater as saturated liquid at the extraction pressure.
    expect(Math.abs(state(closed, '7').T - fromPX(1200, 0).T)).toBeLessThan(1e-9);
  });

  it('real turbines and pumps lower the efficiency, and the turbine exit has more entropy', () => {
    const ideal = solveRankine(rankine({}));
    const real = solveRankine(rankine({ etaT: 0.87, etaP: 0.85 }));
    expect(eta(real)).toBeLessThan(eta(ideal));
    expect(state(real, '4').s).toBeGreaterThan(state(ideal, '4').s);
    expect(rel(row(real, 'wTurbine'), 0.87 * row(ideal, 'wTurbine'))).toBeLessThan(1e-6);
  });

  it('mass flow for a net power', () => {
    const result = solveRankine(rankine({ power: 100000 }));
    expect(rel(row(result, 'mFlow') * row(result, 'wNet'), 100000)).toBeLessThan(1e-12);
    expect(rel(row(result, 'heatInRate'), row(result, 'mFlow') * row(result, 'qIn'))).toBeLessThan(1e-12);
  });
});

describe('cycles: gas cycles, Carnot, and refrigerators', () => {
  it('a cold-air regenerator by hand, and intercooling with reheat closing the first law', () => {
    const result = solveBrayton(brayton({ rp: 8, T3: 1300, etaC: 0.8, etaT: 0.85, regen: 0.8 }));
    const tr = 8 ** (0.4 / 1.4);
    const T2 = 300 + (300 * tr - 300) / 0.8;
    const T4 = 1300 - 0.85 * (1300 - 1300 / tr);
    const T5 = T2 + 0.8 * (T4 - T2);
    const w = 1.005 * (1300 - T4 - (T2 - 300));
    expect(rel(eta(result), w / (1.005 * (1300 - T5)))).toBeLessThan(1e-9);
    closes(result);
    const both = solveBrayton(brayton({ rp: 16, regen: 0.75, intercool: true, reheat: true }));
    closes(both);
    expect(both.states?.length).toBe(10);
  });

  it('variable specific heats give a lower Otto efficiency than the cold-air standard', () => {
    const cold = solvePiston(piston({}));
    const variable = solvePiston(piston({ model: 'variable' }));
    expect(eta(variable)).toBeLessThan(eta(cold));
    expect(eta(variable)).toBeGreaterThan(0.45);
    closes(variable);
    expect(rel(state(variable, '2').v ?? NaN, (state(variable, '1').v ?? NaN) / 8)).toBeLessThan(1e-6);
  });

  it('a dual cycle with r_p = 1 is the Diesel cycle', () => {
    const diesel = solvePiston(piston({ cycle: 'diesel', r: 18, rc: 2 }));
    const dual = solvePiston(piston({ cycle: 'dual', r: 18, rc: 2, rp: 1 }));
    expect(Math.abs(eta(dual) - eta(diesel))).toBeLessThan(1e-9);
    const more = solvePiston(piston({ cycle: 'dual', r: 18, rc: 1.5, rp: 1.5 }));
    closes(more);
  });

  it('the Otto mean effective pressure is w_net/(v₁ − v₂)', () => {
    const result = solvePiston(piston({}));
    const v1 = (0.287 * 300) / 100;
    expect(rel(row(result, 'mep'), row(result, 'wNet') / (v1 - v1 / 8))).toBeLessThan(1e-9);
  });

  it('Carnot between 1000 K and 300 K', () => {
    const result = solveCarnot(1000, 300, 50);
    expect(row(result, 'etaTh')).toBeCloseTo(70, 12);
    expect(row(result, 'copR')).toBeCloseTo(300 / 700, 12);
    expect(row(result, 'copHP')).toBeCloseTo(1000 / 700, 12);
    expect(row(result, 'powerRow')).toBeCloseTo(35, 12);
  });

  it('superheat and subcooling in the refrigerator', () => {
    const plain = solveFridge(fridge({}));
    const sub = solveFridge(fridge({ subcool: 5, superheat: 5, etaC: 0.8, load: 10 }));
    expect(row(sub, 'qL')).toBeGreaterThan(row(plain, 'qL'));
    expect(rel(row(sub, 'mFlow') * row(sub, 'qL'), 10)).toBeLessThan(1e-12);
    expect(Math.abs(state(sub, '4').h - state(sub, '3').h)).toBeLessThan(1e-9);
  });

  it('every cycle draws a closed diagram and a state table', () => {
    for (const result of [solveRankine(rankine({})), solveBrayton(brayton({})), solveFridge(fridge({}))]) {
      expect(result.plots?.length).toBeGreaterThan(0);
      for (const plot of result.plots ?? []) expect(plot.marks?.length).toBe(result.states?.length);
    }
    // Each process is its own piece of line (the gaps between them must not join up), plus the axis box.
    const ts = solveBrayton(brayton({})).plots?.[0];
    if (!ts) throw new Error('no plot');
    expect(plotSvg(ts, 'SI', SCREEN_COLORS, 'cycle').match(/<polyline/g)?.length).toBe(4 + 1);
  });
});

describe('cycles: impossible inputs', () => {
  it('names each problem', () => {
    expect(code(() => solvePiston(piston({ r: 1 })))).toBe('ratioAboveOne');
    expect(code(() => solvePiston(piston({ r: -3 })))).toBe('notPositive');
    expect(code(() => solvePiston(piston({ T3: 500 })))).toBe('cycleHeatIn');
    expect(code(() => solvePiston(piston({ cycle: 'diesel', rc: 0.5 })))).toBe('ratioAboveOne');
    expect(code(() => solvePiston(piston({ cycle: 'dual', rc: 2, rp: 0.5 })))).toBe('ratioAtLeastOne');
    expect(code(() => solveBrayton(brayton({ rp: 0.5 })))).toBe('ratioAboveOne');
    expect(code(() => solveBrayton(brayton({ etaC: 0 })))).toBe('efficiencyRange');
    expect(code(() => solveBrayton(brayton({ etaT: 1.2 })))).toBe('efficiencyRange');
    expect(code(() => solveBrayton(brayton({ regen: 1.5 })))).toBe('effectivenessRange');
    expect(code(() => solveBrayton(brayton({ rp: 40, regen: 0.8 })))).toBe('regenImpossible');
    expect(code(() => solveBrayton(brayton({ etaC: 0.5, etaT: 0.5 })))).toBe('cycleNoWork');
    expect(code(() => solveBrayton(brayton({ T1: 0 })))).toBe('notPositive');
    expect(code(() => solveRankine(rankine({ pLow: 9000 })))).toBe('pressureOrder');
    expect(code(() => solveRankine(rankine({ pHigh: 25000 })))).toBe('steamAboveCritical');
    expect(code(() => solveRankine(rankine({ variant: 'reheat', pReheat: 9000 })))).toBe('pressureBetween');
    expect(code(() => solveRankine(rankine({ variant: 'openFwh', pFwh: 5 })))).toBe('pressureBetween');
    expect(code(() => solveRankine(rankine({ variant: 'closedFwh', pFwh: 10.1 })))).toBe('fwhTooCold');
    expect(code(() => solveRankine(rankine({ etaP: 0 })))).toBe('efficiencyRange');
    expect(code(() => solveFridge(fridge({ superheat: -2 })))).toBe('notNegative');
    expect(code(() => solveFridge(fridge({ pHigh: 100 })))).toBe('pressureOrder');
    expect(code(() => solveFridge(fridge({ pHigh: 5000 })))).toBe('r134aSatRange');
    expect(code(() => solveCarnot(300, 1000))).toBe('reservoirOrder');
    expect(code(() => solveCarnot(0, -1))).toBe('notPositive');
  });

  it('stays exact for a huge pressure ratio, and says when compression passes the turbine inlet', () => {
    const result = solveBrayton(brayton({ rp: 1000, T3: 3000 }));
    expect(Math.abs(eta(result) - (1 - 1000 ** (-(K - 1) / K)))).toBeLessThan(1e-9);
    expect(code(() => solveBrayton(brayton({ rp: 1e4, T3: 3000 })))).toBe('cycleHeatIn');
  });
});

describe('cycles: the form', () => {
  it('solves the first values of every mode, and US units give the same cycle', () => {
    for (const mode of spec.modes) {
      const form = { mode: mode.id, text: {}, unit: {} };
      const values = valuesOf(fieldsOf(mode, form, 'SI'), form, 'SI').values;
      expect(spec.solve(mode.id, values).rows.length).toBeGreaterThan(0);
    }
    const mode = spec.modes[0];
    const us = { mode: 'rankine', text: { pHigh: '1160.30', pLow: '1.45038' }, unit: { pHigh: 'psia', pLow: 'psia' } };
    const values = valuesOf(fieldsOf(mode, us, 'US'), us, 'US').values;
    expect(rel(eta(spec.solve('rankine', values)), eta(solveRankine(rankine({}))))).toBeLessThan(1e-4);
  });

  it('shows only the fields the layout needs', () => {
    const mode = spec.modes[0];
    const ids = (text: Record<string, string>) =>
      fieldsOf(mode, { mode: 'rankine', text, unit: {} }, 'SI').map((one) => one.id);
    expect(ids({})).not.toContain('T3');
    expect(ids({ variant: 'reheat' })).toEqual(expect.arrayContaining(['T3', 'pReheat', 'tReheat']));
    expect(ids({ variant: 'openFwh' })).toContain('pFwh');
    const reheat = { mode: 'rankine', text: { variant: 'reheat' }, unit: {} };
    const result = spec.solve('rankine', valuesOf(fieldsOf(mode, reheat, 'SI'), reheat, 'SI').values);
    expect(Math.abs(eta(result) - 0.45)).toBeLessThan(0.003);
    // fromPS is the steam engine's own entry; the turbine exit is on the same isentrope as its inlet.
    expect(Math.abs(fromPS(10, state(result, '5').s).h - state(result, '6').h)).toBeLessThan(1e-6);
  });
});
