import { describe, expect, it } from 'vitest';
import { parsePrefixed, prefixFor, withPrefix } from './prefix';

describe('SI prefixes', () => {
  it('shows a value with the prefix that leaves 1 to 1000 of it', () => {
    expect(withPrefix(4700, 'Ω')).toBe('4.7 kΩ');
    expect(withPrefix(0.001, 'A')).toBe('1 mA');
    expect(withPrefix(0.000047, 'F')).toBe('47 µF');
    expect(withPrefix(12, 'V')).toBe('12 V');
    expect(withPrefix(-0.0025, 'A')).toBe('−2.5 mA');
    expect(withPrefix(0, 'V')).toBe('0 V');
    expect(withPrefix(999.96, 'W')).toBe('1 kW');
    expect(prefixFor(2.5e9)).toEqual({ symbol: 'G', power: 9 });
  });

  it('reads typed values with or without the unit', () => {
    expect(parsePrefixed('4.7k')).toBe(4700);
    expect(parsePrefixed('4.7 kΩ', 'Ω')).toBe(4700);
    expect(parsePrefixed('2 mA', 'A')).toBeCloseTo(0.002, 15);
    expect(parsePrefixed('10u')).toBeCloseTo(1e-5, 18);
    expect(parsePrefixed('1e-3')).toBe(0.001);
    expect(parsePrefixed('−12')).toBe(-12);
    expect(parsePrefixed('220 ohms', 'Ω')).toBe(220);
    expect(parsePrefixed('abc')).toBeNull();
    expect(parsePrefixed('5 x')).toBeNull();
  });
});
