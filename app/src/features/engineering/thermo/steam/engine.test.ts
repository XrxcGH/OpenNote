// The steam tool as a student uses it: each pair of known properties, the worked steps, the units, and the
// problems it explains in words.
import '../text';
import { describe, expect, it } from 'vitest';
import { kitThermo } from '../../../../strings/en/kitThermo';
import { ThermoError, type ThermoResult } from '../common/types';
import { fromEngine } from '../common/units';
import { shown, type Say } from '../ui/present';
import { solveSteam, type SteamInput } from './engine';
import { spec } from './spec';

const value = (result: ThermoResult, key: string): number => {
  const row = result.rows.find((one) => one.key === key);
  if (!row) throw new Error(`no row ${key}`);
  return row.value;
};

const code = (input: SteamInput): string => {
  try {
    solveSteam(input);
  } catch (error) {
    return error instanceof ThermoError ? error.code : 'other';
  }
  return 'none';
};

const say: Say = (key) => {
  let node: unknown = kitThermo;
  for (const part of key.split('.').slice(1)) node = (node as Record<string, unknown>)[part];
  return String(node);
};

describe('the steam tool', () => {
  it('finds region 3 from T and p: 650 K and 25.5837018 MPa is 500 kg/m3', () => {
    const result = solveSteam({ pair: 'Tp', T: 650, p: 25583.7018 });
    expect(value(result, 'rho')).toBeCloseTo(500, 6);
    expect(value(result, 'h')).toBeCloseTo(1863.43019, 4);
    expect(result.steps.map((step) => step.key)).toContain('steam.test.aboveB23');
    expect(result.steps.map((step) => step.key)).toContain('steam.vars3');
  });

  it('works a saturated mixture from p and h with the lever rule', () => {
    const result = solveSteam({ pair: 'ph', p: 1000, h: 2000 });
    const x = value(result, 'quality');
    expect(x).toBeGreaterThan(0.6);
    expect(x).toBeLessThan(0.65);
    expect(result.rows.find((row) => row.key === 'phase')?.word).toBe('mixture');
    expect(result.rows.some((row) => row.key === 'cp')).toBe(false);
    expect(result.steps.map((step) => step.key)).toEqual(
      expect.arrayContaining(['steam.between', 'steam.test.saturated', 'steam.lever']),
    );
    expect(result.notes).toContain('twoPhaseNoCp');
  });

  it('every pair of the same state agrees', () => {
    const tp = solveSteam({ pair: 'Tp', T: 573.15, p: 2000 });
    const h = value(tp, 'h');
    const s = value(tp, 's');
    expect(value(solveSteam({ pair: 'ph', p: 2000, h }), 'temperature')).toBeCloseTo(573.15, 6);
    expect(value(solveSteam({ pair: 'ps', p: 2000, s }), 'temperature')).toBeCloseTo(573.15, 6);
    const sat = solveSteam({ pair: 'px', p: 101.325, x: 1 });
    expect(value(sat, 'temperature') - 273.15).toBeCloseTo(99.97, 1);
    expect(value(solveSteam({ pair: 'Tx', T: value(sat, 'temperature'), x: 1 }), 'h')).toBeCloseTo(value(sat, 'h'), 4);
  });

  it('shows temperatures in °C and switches to US units without recomputing', () => {
    const result = solveSteam({ pair: 'Tp', T: 673.15, p: 1000 });
    const T = result.rows.find((row) => row.key === 'temperature')!;
    expect(shown(T, 'SI', say)).toEqual({ value: '400', unit: '°C' });
    expect(shown(T, 'US', say)).toEqual({ value: '752', unit: '°F' });
    const h = result.rows.find((row) => row.key === 'h')!;
    expect(Number(shown(h, 'US', say).value)).toBeCloseTo(fromEngine(h.value, 'e', 'Btu/lbm'), 1);
    expect(shown(result.rows[0], 'SI', say).value).toBe('Superheated vapor');
  });

  it('draws the dome on both diagrams with the state marked', () => {
    const result = solveSteam({ pair: 'Tp', T: 673.15, p: 1000 });
    expect(result.plots?.map((plot) => plot.title)).toEqual(['waterTs', 'waterPh']);
    expect(result.plots?.[0].series[0].points.length).toBeGreaterThan(60);
    expect(result.plots?.[1].y.log).toBe(true);
    expect(result.states?.[0].label).toBe('1');
  });

  it('reads the form with °C fields', () => {
    const result = spec.solve('state', { pair: 'Tp', T: 673.15, p: 1000 });
    expect(value(result, 'v')).toBeCloseTo(0.30661, 4);
  });

  it('says what is wrong in words', () => {
    expect(code({ pair: 'Tp', T: 250, p: 100 })).toBe('steamRange');
    expect(code({ pair: 'Tp', T: 500, p: 0 })).toBe('notPositive');
    expect(code({ pair: 'Tp', T: 500, p: -10 })).toBe('notPositive');
    expect(code({ pair: 'Tp', T: 900, p: 2e5 })).toBe('steamRange');
    expect(code({ pair: 'Tp', T: 1e6, p: 100 })).toBe('steamRange');
    expect(code({ pair: 'Tx', T: 700, x: 0.5 })).toBe('steamSatRange');
    expect(code({ pair: 'px', p: 30000, x: 0.5 })).toBe('steamAboveCritical');
    expect(code({ pair: 'px', p: 100, x: 1.2 })).toBe('qualityRange');
    expect(code({ pair: 'ph', p: 100, h: -500 })).toBe('steamRange');
    expect(code({ pair: 'ph', p: 100 })).toBe('missing');
  });

  it('solves a supercritical state from p and h without a saturation line', () => {
    const result = solveSteam({ pair: 'ph', p: 25000, h: 2000 });
    expect(result.steps[0].key).toBe('steam.supercritical');
    expect(value(result, 'temperature')).toBeGreaterThan(640);
  });
});
