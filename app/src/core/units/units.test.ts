// Engineering units against conversions in standard references (NIST SP 811 factors).
import { describe, expect, it } from 'vitest';
import { convertUnit, engineeringText, parseUnit, prefixedText, splitQuantity } from './units';

describe('engineering units', () => {
  it('reads prefixed, customary, and compound units', () => {
    expect(parseUnit('kN')).toEqual({ factor: 1000, dim: [1, 1, -2, 0, 0, 0, 0] });
    expect(parseUnit('MPa')?.factor).toBe(1e6);
    expect(parseUnit('N/mm^2')?.factor).toBeCloseTo(1e6, 6);
    expect(parseUnit('m/s²')?.dim).toEqual([1, 0, -2, 0, 0, 0, 0]);
    expect(parseUnit('W/(m·K)')?.dim).toEqual([1, 1, -3, -1, 0, 0, 0]);
    expect(parseUnit('kΩ')?.factor).toBe(1000);
    expect(parseUnit('uF')?.factor).toBeCloseTo(1e-6, 18);
    expect(parseUnit('min')?.factor).toBe(60);
    expect(parseUnit('ms')?.factor).toBe(0.001);
    expect(parseUnit('hPa')?.factor).toBe(100);
    expect(parseUnit('furlong')).toBeNull();
    expect(parseUnit('kN·')).toBeNull();
    expect(parseUnit('m^0')).toBeNull();
  });

  it('converts between units of the same kind and refuses different kinds', () => {
    expect(convertUnit(250, 'N', 'kN')).toBe(0.25);
    expect(convertUnit(1, 'kip', 'kN')).toBeCloseTo(4.448221615, 9);
    expect(convertUnit(1, 'ksi', 'MPa')).toBeCloseTo(6.894757293, 9);
    expect(convertUnit(1, 'kN·m', 'lbf·ft')).toBeCloseTo(737.5621493, 6);
    expect(convertUnit(100, '°C', '°F')).toBe(212);
    expect(convertUnit(1, 'kWh', 'MJ')).toBe(3.6);
    expect(convertUnit(1, 'N·m', 'J')).toBe(1);
    expect(convertUnit(1, 'N', 'N·m')).toBeNull();
  });

  it('splits a typed quantity into its number and unit', () => {
    expect(splitQuantity('250 N')).toEqual({ number: '250', unit: 'N' });
    expect(splitQuantity('1.2e3kN·m')).toEqual({ number: '1.2e3', unit: 'kN·m' });
    expect(splitQuantity('-4,5 mm')).toEqual({ number: '-4,5', unit: 'mm' });
    expect(splitQuantity('12')).toEqual({ number: '12', unit: '' });
  });

  it('writes engineering notation and SI prefixes', () => {
    expect(engineeringText(12500)).toBe('12.5×10³');
    expect(engineeringText(0.00042)).toBe('420×10⁻⁶');
    expect(engineeringText(-3)).toBe('−3');
    expect(prefixedText(12500, 'N')).toBe('12.5 kN');
    expect(prefixedText(0.0042, 'm')).toBe('4.2 mm');
    expect(prefixedText(4700, 'Ω')).toBe('4.7 kΩ');
    expect(prefixedText(2500, 'kPa')).toBe('2.5 MPa');
    expect(prefixedText(3, 'ft')).toBeNull();
    expect(prefixedText(3, 'N·m')).toBeNull();
  });
});
