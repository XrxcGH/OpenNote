import { describe, expect, it } from 'vitest';
import { initialValues, runTool } from '../spec';
import {
  adc,
  decibels,
  decodeBands,
  fromDecibels,
  nearestStandard,
  phaseFromShift,
  rtdResistance,
  rtdTemperature,
  sineLevels,
  strainBridge,
  wheatstone,
} from './engine';
import { spec } from './tool';
import { thermocoupleRange, thermocoupleTemperature, thermocoupleVoltage } from './thermocouple';

const close = (a: number, b: number, rel: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.abs(b));

describe('resistor color codes', () => {
  it('reads brown black red gold as 1 kΩ ± 5 %', () => {
    const code = decodeBands('brown, black, red, gold');
    expect(code.ohms).toBe(1000);
    expect(code.tolerance).toBe(5);
    expect(code.low).toBe(950);
    expect(code.high).toBe(1050);
  });
  it('reads five bands, gold and silver multipliers, and three bands', () => {
    expect(decodeBands('yellow violet black brown brown').ohms).toBe(4700);
    expect(decodeBands('orange orange gold gold').ohms).toBeCloseTo(3.3, 12);
    expect(decodeBands('red red silver silver').ohms).toBeCloseTo(0.22, 12);
    expect(decodeBands('green blue orange').tolerance).toBe(20);
  });
  it('names the band that does not belong', () => {
    expect(() => decodeBands('brown pink red gold')).toThrow();
    expect(() => decodeBands('brown')).toThrow();
    expect(() => decodeBands('gold black red gold')).toThrow();
    expect(() => decodeBands('brown black red black')).toThrow();
  });
});

describe('standard values', () => {
  it('finds the nearest E-series value on a log scale', () => {
    expect(nearestStandard(4800, 'E12')).toBe(4700);
    expect(nearestStandard(4800, 'E24')).toBe(4700);
    expect(nearestStandard(5000, 'E24')).toBe(5100);
    expect(nearestStandard(0.5, 'E12')).toBeCloseTo(0.47, 12);
    expect(nearestStandard(1234, 'E96')).toBe(1240);
    expect(() => nearestStandard(0, 'E24')).toThrow();
  });
});

describe('thermocouples (NIST ITS-90 tables)', () => {
  const cases: [Parameters<typeof thermocoupleVoltage>[0], number, number][] = [
    ['K', 100, 4.096],
    ['K', 500, 20.644],
    ['J', 100, 5.269],
    ['T', 100, 4.279],
    // further published table values
    ['K', 1000, 41.276],
    ['K', -100, -3.554],
    ['J', 1000, 57.953],
    ['J', 500, 27.393],
    ['T', -100, -3.379],
    ['E', 100, 6.319],
    ['E', -100, -5.237],
    ['E', 500, 37.005],
  ];
  it.each(cases)('type %s at %d °C is %f mV', (type, celsius, mv) => {
    expect(Math.abs(thermocoupleVoltage(type, celsius)! - mv)).toBeLessThanOrEqual(0.001);
  });
  it('is zero at the reference temperature for every type', () => {
    for (const type of ['K', 'J', 'T', 'E'] as const)
      expect(Math.abs(thermocoupleVoltage(type, 0)!)).toBeLessThan(2e-2);
    expect(thermocoupleVoltage('J', 0)).toBe(0);
  });
  it('inverts the reference functions', () => {
    for (const type of ['K', 'J', 'T', 'E'] as const) {
      const [low, high] = thermocoupleRange(type);
      for (const t of [low + 1, -50, 25, 0.5, (high * 2) / 3, high - 1]) {
        const back = thermocoupleTemperature(type, thermocoupleVoltage(type, t)!);
        expect(Math.abs(back! - t)).toBeLessThan(1e-6);
      }
    }
  });
  it('is continuous across the segments', () => {
    expect(Math.abs(thermocoupleVoltage('J', 760)! - thermocoupleVoltage('J', 760.0001)!)).toBeLessThan(1e-4);
    expect(Math.abs(thermocoupleVoltage('K', -0.0001)! - thermocoupleVoltage('K', 0.0001)!)).toBeLessThan(2e-2);
  });
  it('refuses temperatures and voltages outside the table', () => {
    expect(thermocoupleVoltage('T', 401)).toBeNull();
    expect(thermocoupleVoltage('K', -300)).toBeNull();
    expect(thermocoupleTemperature('K', 100)).toBeNull();
  });
});

describe('RTD', () => {
  it('Pt100 at 100 °C is 138.5055 Ω, 0 °C is 100 Ω, and −100 °C uses the C term', () => {
    close(rtdResistance(100), 138.5055, 1e-6);
    expect(rtdResistance(0)).toBe(100);
    close(rtdResistance(-100), 60.2564, 1e-4);
    close(rtdResistance(100, 1000), 1385.055, 1e-6);
  });
  it('inverts above and below zero', () => {
    for (const t of [-199, -100, -0.5, 0, 37, 100, 400, 850])
      expect(Math.abs(rtdTemperature(rtdResistance(t)) - t)).toBeLessThan(1e-7);
  });
  it('refuses temperatures and resistances outside the standard range', () => {
    expect(() => rtdResistance(900)).toThrow();
    expect(() => rtdTemperature(10)).toThrow();
    expect(() => rtdTemperature(500)).toThrow();
  });
});

describe('bridges', () => {
  it('quarter bridge, GF 2, 1000 microstrain, 5 V: 2.5000 mV linear, 2.4975 mV exact', () => {
    const out = strainBridge('quarter', 2, 1000e-6, 5);
    expect(Math.abs(out.linear * 1e3 - 2.5)).toBeLessThan(1e-6);
    expect(Math.abs(out.exact * 1e3 - 2.4975)).toBeLessThan(1e-4);
  });
  it('half and full bridges are twice and four times the quarter bridge', () => {
    close(strainBridge('half', 2, 1000e-6, 5).exact, 5e-3, 1e-12);
    close(strainBridge('full', 2, 1000e-6, 5).exact, 10e-3, 1e-12);
  });
  it('quarter bridge matches the resistor network', () => {
    const r = 350;
    const x = 2 * 1000e-6;
    close(wheatstone(5, r, r, r, r * (1 + x)), strainBridge('quarter', 2, 1000e-6, 5).exact, 1e-9);
  });
  it('Wheatstone balances when R1 R3 = R2 R4', () => {
    expect(wheatstone(10, 1000, 2000, 3000, 1500)).toBeCloseTo(0, 12);
    close(wheatstone(10, 1000, 2000, 3000, 1000), 10 * (2 / 3 - 3 / 4), 1e-12);
  });
  it('refuses a strain that breaks the equation', () => {
    expect(() => strainBridge('quarter', 2, -2, 5)).toThrow();
  });
});

describe('signals', () => {
  it('a 10 V peak sine is 7.0711 V rms, and doubling the amplitude adds 6.0206 dB', () => {
    close(sineLevels('peak', 10).rms, 7.0711, 1e-5);
    close(sineLevels('rms', 7.0710678).peak, 10, 1e-7);
    expect(sineLevels('peakToPeak', 20).peak).toBe(10);
    close(sineLevels('peak', 10).average, 6.3662, 1e-5);
    close(decibels(2), 6.0206, 1e-5);
    close(decibels(2, true), 3.0103, 1e-5);
    close(fromDecibels(20), 10, 1e-12);
    expect(() => decibels(0)).toThrow();
    expect(() => decibels(-1)).toThrow();
  });
  it('a 0.25 ms shift on a 1 kHz signal is 90°', () => {
    close(phaseFromShift(0.25e-3, 1000), 90, 1e-12);
    expect(() => phaseFromShift(1, 0)).toThrow();
  });
});

describe('converters', () => {
  it('a 12-bit 3.3 V converter has 0.8057 mV steps and reads 1.65 V as code 2048', () => {
    const a = adc(12, 3.3, 1.65);
    close(a.lsb, 3.3 / 4096, 1e-12);
    expect(a.code).toBe(2048);
    close(a.snr, 74.0, 1e-3);
    close(a.rmsError, a.lsb / Math.sqrt(12), 1e-12);
  });
  it('clamps to the range and refuses nonsense bit counts', () => {
    expect(adc(8, 5, 6).code).toBe(255);
    expect(adc(8, 5, -1).code).toBe(0);
    expect(() => adc(0, 5, 1)).toThrow();
    expect(() => adc(2.5, 5, 1)).toThrow();
  });
});

describe('the tool', () => {
  const run = (v: Record<string, string>) => runTool(spec, { ...initialValues(spec), ...v });
  it('answers each mode', () => {
    expect(run({})).toMatchObject({ ok: true, answer: '1 kΩ ± 5 %' });
    const tc = run({ mode: 'thermocouple', tctype: 'K', temp: '100' });
    expect(tc).toMatchObject({ ok: true });
    if (tc.ok) {
      expect(tc.answer).toContain('4.096');
      expect(tc.source).toContain('NIST');
    }
    const cold = run({ mode: 'thermocouple', tctype: 'K', tcdir: 'toTemperature', mv: '3.5', tref: '25' });
    expect(cold.ok).toBe(true);
    if (cold.ok) expect(cold.rows.find((row) => row.key === 'temperature')!.value).toMatch(/^1\d\d(\.\d+)? °C$/);
    expect(run({ mode: 'rtd' })).toMatchObject({ ok: true });
    expect(run({ mode: 'bridge' })).toMatchObject({ ok: true });
    expect(run({ mode: 'signal' })).toMatchObject({ ok: true });
    expect(run({ mode: 'adc' })).toMatchObject({ ok: true });
    expect(run({ mode: 'standard' })).toMatchObject({ ok: true });
  });
  it('works in Fahrenheit', () => {
    const f = run({ mode: 'thermocouple', tunit: 'fahrenheit', temp: '212', tref: '32' });
    expect(f.ok && f.answer).toContain('4.096');
  });
  it('reports problems in words', () => {
    expect(run({ bands: 'brown pink red gold' })).toMatchObject({ ok: false, error: 'band' });
    expect(run({ mode: 'thermocouple', temp: '2000' })).toMatchObject({ ok: false, error: 'tcRange' });
    expect(run({ mode: 'thermocouple', tcdir: 'toTemperature', mv: '500' })).toMatchObject({
      ok: false,
      error: 'tcVoltage',
    });
    expect(run({ mode: 'adc', bits: '0' })).toMatchObject({ ok: false, error: 'bits' });
    expect(run({ mode: 'rtd', temp: '-300' })).toMatchObject({ ok: false, error: 'rtdRange' });
  });
});
