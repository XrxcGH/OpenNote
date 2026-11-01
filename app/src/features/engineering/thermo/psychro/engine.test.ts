// Psychrometrics against the published validation values, then against independent hand calculations: every pair
// of known properties returns the same state, the balances close, and the ice formula meets the water one at 0 °C.
import '../text';
import { describe, expect, it } from 'vitest';
import { ThermoError, type ThermoResult } from '../common/types';
import { solveProcess, solveState, stateFrom, type StateInput } from './engine';
import { dewPoint, moistFromPhi, pressureAt, pws } from './moist';
import { spec } from './spec';

const rel = (a: number, b: number) => Math.abs(a / b - 1);
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
const P = 101.325;

describe('psychrometrics: validation cases', () => {
  it('25 °C, 50 %, 101.325 kPa', () => {
    const s = moistFromPhi(25, 0.5, P);
    expect(rel(s.pws, 3.1697)).toBeLessThan(1e-3);
    expect(rel(s.omega, 0.0098827)).toBeLessThan(1e-3);
    expect(rel(s.h, 50.33)).toBeLessThan(1e-3);
    expect(Math.abs(s.tdp - 13.86)).toBeLessThan(0.05);
    expect(Math.abs(s.twb - 17.89)).toBeLessThan(0.05);
  });

  it('mixing 1 kg/s at 30 °C 60 % with 2 kg/s at 15 °C 40 %', () => {
    const result = solveProcess({ process: 'mixing', p: P, t1: 30, phi1: 0.6, t2: 15, phi2: 0.4, m1: 1, m2: 2 });
    expect(rel(row(result, 'omega'), 0.0081588)).toBeLessThan(2e-3);
    expect(rel(row(result, 'hMoist'), 40.9)).toBeLessThan(2e-3);
    expect(rel(row(result, 'tdb') - 273.15, 20.07)).toBeLessThan(2e-3);
    expect(rel(row(result, 'phi') / 100, 0.558)).toBeLessThan(2e-3);
  });

  it('cooling 30 °C 60 % to saturation at 12 °C, with condensate leaving at 12 °C', () => {
    const result = solveProcess({ process: 'dehumidify', p: P, t1: 30, phi1: 0.6, t2: 12, phi2: 1 });
    expect(rel(row(result, 'waterRemoved'), 0.0073119)).toBeLessThan(2e-3);
    expect(rel(row(result, 'qRemoved'), 36.73)).toBeLessThan(2e-3);
  });
});

describe('psychrometrics: independent checks', () => {
  it('ω and h written out by hand agree', () => {
    const s = moistFromPhi(25, 0.5, P);
    const pv = 0.5 * s.pws;
    const omega = (0.621945 * pv) / (P - pv);
    expect(s.omega).toBeCloseTo(omega, 12);
    expect(s.h).toBeCloseTo(1.006 * 25 + omega * (2501 + 1.86 * 25), 10);
    expect(s.v).toBeCloseTo((0.287042 * 298.15 * (1 + 1.607858 * omega)) / P, 10);
  });

  it('every pair of known properties gives back the same state', () => {
    const s = moistFromPhi(25, 0.5, P);
    const pairs: StateInput[] = [
      { known: 'tTwb', p: P, t: 25, twb: s.twb },
      { known: 'tOmega', p: P, t: 25, omega: s.omega },
      { known: 'tTdp', p: P, t: 25, tdp: s.tdp },
      { known: 'tH', p: P, t: 25, h: s.h },
      { known: 'twbPhi', p: P, twb: s.twb, phi: 0.5 },
      { known: 'tdpPhi', p: P, tdp: s.tdp, phi: 0.5 },
      { known: 'hPhi', p: P, h: s.h, phi: 0.5 },
      { known: 'hOmega', p: P, h: s.h, omega: s.omega },
    ];
    for (const pair of pairs) {
      const back = stateFrom(pair);
      expect(back.t, pair.known).toBeCloseTo(25, 6);
      expect(back.omega, pair.known).toBeCloseTo(s.omega, 9);
    }
  });

  it('the ice and water saturation pressures meet at the triple point', () => {
    expect(rel(pws(-1e-9), pws(0))).toBeLessThan(2e-4);
    expect(rel(pws(0.01), 0.611657)).toBeLessThan(1e-4);
    // R14-08 at -20 °C: 103.24 Pa.
    expect(rel(pws(-20), 0.10324)).toBeLessThan(1e-3);
    expect(dewPoint(pws(-10))).toBeCloseTo(-10, 6);
  });

  it('the mixing state lies on the straight line between the streams', () => {
    const result = solveProcess({ process: 'mixing', p: P, t1: 30, phi1: 0.6, t2: 15, phi2: 0.4, m1: 1, m2: 2 });
    const one = moistFromPhi(30, 0.6, P);
    const two = moistFromPhi(15, 0.4, P);
    expect(row(result, 'omega')).toBeCloseTo((one.omega + 2 * two.omega) / 3, 12);
    expect(row(result, 'hMoist')).toBeCloseTo((one.h + 2 * two.h) / 3, 10);
  });

  it('sensible heating keeps ω and needs q = h2 - h1, scaled by the dry-air flow', () => {
    const result = solveProcess({ process: 'sensible', p: P, t1: 10, phi1: 0.7, t2: 30, m1: 2 });
    const one = moistFromPhi(10, 0.7, P);
    expect(row(result, 'omega')).toBeCloseTo(one.omega, 12);
    const q = row(result, 'qMoist');
    expect(q).toBeCloseTo((1.006 + 1.86 * one.omega) * 20, 9);
    expect(row(result, 'qRate')).toBeCloseTo(2 * q, 9);
  });

  it('evaporative cooling keeps the wet bulb and adds water', () => {
    const result = solveProcess({ process: 'evaporative', p: P, t1: 35, phi1: 0.2, phi2: 0.9 });
    const one = moistFromPhi(35, 0.2, P);
    expect(row(result, 'twb')).toBeCloseTo(one.twb + 273.15, 6);
    expect(row(result, 'phi')).toBeCloseTo(90, 6);
    expect(row(result, 'waterAdded')).toBeGreaterThan(0);
    expect(row(result, 'tdb') - 273.15).toBeLessThan(35);
  });

  it('reads altitude, °C, and percent through the form', () => {
    expect(pressureAt(0)).toBeCloseTo(101.325, 9);
    expect(pressureAt(1500)).toBeCloseTo(84.556, 2);
    const result = spec.solve('air', { pFrom: 'pressure', p: P, known: 'tPhi', t: 298.15, phi: 50 });
    expect(rel(row(result, 'omega'), 0.0098827)).toBeLessThan(1e-3);
    expect(result.plots?.[0].title).toBe('psychroChart');
    const high = solveState({ known: 'tPhi', p: pressureAt(1500), t: 25, phi: 0.5 });
    expect(row(high, 'omega')).toBeGreaterThan(row(result, 'omega'));
  });
});

describe('psychrometrics: saturated air', () => {
  // At saturation the wet bulb is the dry bulb by definition, though the balance there is zero only to round-off.
  it('has its wet bulb at the dry bulb from -50 to 90 °C', () => {
    for (let t = -50; t <= 90; t += 0.5) expect(moistFromPhi(t, 1, P).twb).toBeCloseTo(t, 8);
  });

  it('dehumidifies 30 °C 60 % to saturation at 5 °C', () => {
    // IAPWS saturation pressures: 4.2470 kPa at 30 °C and 0.87258 kPa at 5 °C; ω = 0.621945 pv / (p - pv).
    const w = (pv: number) => (0.621945 * pv) / (P - pv);
    const result = solveProcess({ process: 'dehumidify', p: P, t1: 30, phi1: 0.6, t2: 5, phi2: 1 });
    expect(rel(row(result, 'waterRemoved'), w(0.6 * 4.247) - w(0.87258))).toBeLessThan(2e-3);
  });

  it('evaporative cooling to saturation ends at the wet bulb', () => {
    const result = solveProcess({ process: 'evaporative', p: P, t1: 35, phi1: 0.2, phi2: 1 });
    expect(row(result, 'phi')).toBeCloseTo(100, 6);
    expect(row(result, 'tdb')).toBeCloseTo(moistFromPhi(35, 0.2, P).twb + 273.15, 4);
  });
});

describe('psychrometrics: problems in words', () => {
  it('explains impossible and out-of-range inputs', () => {
    expect(code(() => moistFromPhi(25, 1.2, P))).toBe('psychroPhi');
    expect(code(() => moistFromPhi(25, -0.1, P))).toBe('psychroPhi');
    expect(code(() => moistFromPhi(-80, 0.5, P))).toBe('psychroRange');
    expect(code(() => moistFromPhi(1e6, 0.5, P))).toBe('psychroRange');
    expect(code(() => moistFromPhi(120, 0.9, P))).toBe('psychroVapor');
    expect(code(() => stateFrom({ known: 'tTwb', p: P, t: 20, twb: 25 }))).toBe('psychroWetBulb');
    expect(code(() => stateFrom({ known: 'tTdp', p: P, t: 20, tdp: 25 }))).toBe('psychroDewPoint');
    expect(code(() => stateFrom({ known: 'tOmega', p: P, t: 20, omega: 0.05 }))).toBe('psychroSupersaturated');
    expect(code(() => stateFrom({ known: 'tOmega', p: 0, t: 20, omega: 0.01 }))).toBe('notPositive');
    expect(code(() => solveProcess({ process: 'dehumidify', p: P, t1: 30, phi1: 0.3, t2: 25, phi2: 1 }))).toBe(
      'psychroNoCondense',
    );
    expect(code(() => solveProcess({ process: 'sensible', p: P, t1: 30, phi1: 0.6, t2: 10 }))).toBe('psychroBelowDew');
    expect(code(() => solveProcess({ process: 'evaporative', p: P, t1: 30, phi1: 0.6, phi2: 0.5 }))).toBe(
      'psychroEvaporative',
    );
  });

  it('dry air has no dew point and stays finite', () => {
    const s = stateFrom({ known: 'tOmega', p: P, t: 20, omega: 0 });
    expect(s.phi).toBe(0);
    expect(s.tdp).toBe(Number.NEGATIVE_INFINITY);
    expect(Number.isFinite(s.twb)).toBe(true);
  });
});
