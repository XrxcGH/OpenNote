import { describe, expect, it } from 'vitest';
import { UNIT_CATEGORIES, convert, convertText, findUnit, parseConversion, unitsIn } from './units';

function converted(value: number, from: string, to: string): number {
  const result = convert(value, from, to);
  if (!result.ok) throw new Error(`${from} to ${to}: ${result.reason}`);
  return result.value;
}

describe('unit conversion', () => {
  it('converts length, mass, and time', () => {
    expect(converted(1, 'mi', 'km')).toBe(1.609344);
    expect(converted(5, 'km', 'mi')).toBeCloseTo(3.10685596, 7);
    expect(converted(12, 'in', 'ft')).toBe(1);
    expect(converted(1, 'ft', 'cm')).toBe(30.48);
    expect(converted(1, 'lb', 'kg')).toBe(0.45359237);
    expect(converted(16, 'oz', 'lb')).toBeCloseTo(1, 12);
    expect(converted(2, 'h', 'min')).toBe(120);
    expect(converted(1, 'wk', 'd')).toBe(7);
    expect(converted(1, 'yr', 'd')).toBe(365.25);
    expect(converted(1, 'ly', 'km')).toBeCloseTo(9.4607304725808e12, 0);
  });

  it('converts temperature as a reading', () => {
    expect(converted(100, 'C', 'F')).toBe(212);
    expect(converted(32, 'F', 'C')).toBe(0);
    expect(converted(0, 'C', 'K')).toBe(273.15);
    expect(converted(-40, 'C', 'F')).toBe(-40);
    expect(converted(0, 'K', 'C')).toBe(-273.15);
    expect(converted(-459.67, 'F', 'K')).toBe(0);
    expect(converted(491.67, 'R', 'F')).toBeCloseTo(32, 10);
    expect(convert(-300, 'C', 'F')).toEqual({ ok: false, reason: 'below-absolute-zero' });
    expect(convert(-1, 'K', 'C')).toEqual({ ok: false, reason: 'below-absolute-zero' });
  });
});

describe('area, volume, pressure, and data conversion', () => {
  it('converts area, volume, and speed', () => {
    expect(converted(1, 'ha', 'm²')).toBe(10000);
    expect(converted(1, 'ac', 'm²')).toBeCloseTo(4046.8564224, 6);
    expect(converted(1, 'km²', 'ha')).toBe(100);
    expect(converted(1, 'gal', 'L')).toBe(3.785411784);
    expect(converted(1, 'L', 'mL')).toBe(1000);
    expect(converted(1, 'm³', 'L')).toBe(1000);
    expect(converted(1, 'cup', 'fl oz')).toBeCloseTo(8, 10);
    expect(converted(36, 'km/h', 'm/s')).toBe(10);
    expect(converted(60, 'mph', 'km/h')).toBeCloseTo(96.56064, 8);
    expect(converted(1, 'kn', 'km/h')).toBeCloseTo(1.852, 10);
  });

  it('converts pressure and energy', () => {
    expect(converted(1, 'atm', 'Pa')).toBe(101325);
    expect(converted(1, 'atm', 'mmHg')).toBeCloseTo(760, 9);
    expect(converted(1, 'bar', 'kPa')).toBe(100);
    expect(converted(14.6959, 'psi', 'atm')).toBeCloseTo(1, 4);
    expect(converted(1, 'kcal', 'cal')).toBe(1000);
    expect(converted(1, 'kWh', 'MJ')).toBe(3.6);
    expect(converted(1, 'eV', 'J')).toBe(1.602176634e-19);
  });

  it('keeps bits, bytes, decimal, and binary prefixes apart', () => {
    expect(converted(1, 'B', 'bit')).toBe(8);
    expect(converted(1, 'kB', 'B')).toBe(1000);
    expect(converted(1, 'KiB', 'B')).toBe(1024);
    expect(converted(1, 'GiB', 'MiB')).toBe(1024);
    expect(converted(1, 'MB', 'Mb')).toBe(8);
    expect(converted(100, 'Mb', 'MB')).toBe(12.5);
    expect(converted(1, 'GB', 'GiB')).toBeCloseTo(0.931322574615, 11);
    expect(converted(1, 'TB', 'GB')).toBe(1000);
  });

  it('refuses unknown units and mixed kinds', () => {
    expect(convert(1, 'furlong', 'm')).toEqual({ ok: false, reason: 'unknown-unit' });
    expect(convert(1, 'm', 'USD')).toEqual({ ok: false, reason: 'unknown-unit' });
    expect(convert(1, 'kg', 'm')).toEqual({ ok: false, reason: 'different-kinds' });
    expect(convert(1, 'C', 'J')).toEqual({ ok: false, reason: 'different-kinds' });
  });
});

describe('finding units', () => {
  it('matches symbols exactly first and names in any case', () => {
    expect(findUnit('MB')?.id).toBe('MB');
    expect(findUnit('Mb')?.id).toBe('Mb');
    expect(findUnit('mb')).toBeNull();
    expect(findUnit('b')?.id).toBe('bit');
    expect(findUnit('Kilometers')?.id).toBe('km');
    expect(findUnit('  feet ')?.id).toBe('ft');
    expect(findUnit('°F')?.id).toBe('F');
    expect(findUnit('miles per hour')?.id).toBe('mph');
    expect(findUnit('square feet')?.id).toBe('ft²');
    expect(findUnit('sq m')?.id).toBe('m²');
    expect(findUnit('fluid ounces')?.id).toBe('fl oz');
    expect(findUnit('µm')?.id).toBe('µm');
    expect(findUnit('um')?.id).toBe('µm');
    expect(findUnit('')).toBeNull();
    expect(findUnit('constructor')).toBeNull();
  });

  it('covers ten categories with no repeated symbols', () => {
    expect(UNIT_CATEGORIES).toHaveLength(10);
    const all = UNIT_CATEGORIES.flatMap((c) => unitsIn(c));
    expect(new Set(all).size).toBe(all.length);
    expect(unitsIn('temperature')).toEqual(['C', 'F', 'K', 'R']);
    expect(UNIT_CATEGORIES.every((c) => unitsIn(c).length >= 4)).toBe(true);
  });

  it('gives every unit a way back to itself', () => {
    for (const category of UNIT_CATEGORIES) {
      for (const id of unitsIn(category)) {
        expect(findUnit(id)?.id).toBe(id);
        expect(converted(3.5, id, id)).toBeCloseTo(3.5, 12);
      }
    }
  });
});

describe('conversion text', () => {
  it('reads "5 km to mi" and its variants', () => {
    expect(parseConversion('5 km to mi')).toEqual({ value: 5, from: 'km', to: 'mi' });
    expect(parseConversion('72 F in C')).toEqual({ value: 72, from: 'F', to: 'C' });
    expect(parseConversion('-3.5e2 MB as GiB')).toEqual({ value: -350, from: 'MB', to: 'GiB' });
    expect(parseConversion('10km -> m')).toEqual({ value: 10, from: 'km', to: 'm' });
    expect(parseConversion('5 in in cm')).toEqual({ value: 5, from: 'in', to: 'cm' });
    expect(parseConversion('3 eV to J')).toEqual({ value: 3, from: 'eV', to: 'J' });
    expect(parseConversion('hello')).toBeNull();
    expect(parseConversion('5 km')).toBeNull();
  });

  it('converts it in one step', () => {
    expect(convertText('2 h to min')).toEqual({ ok: true, value: 120 });
    expect(convertText('1 kg to m')).toEqual({ ok: false, reason: 'different-kinds' });
    expect(convertText('nonsense')).toBeNull();
  });

  it('reads a long run of digits or spaces without backtracking, and refuses text over the length limit', () => {
    const started = performance.now();
    expect(convertText('1'.repeat(2000))).toBeNull();
    expect(convertText(`5 km${' '.repeat(1900)}x`)).toBeNull();
    expect(performance.now() - started).toBeLessThan(1000);
    expect(parseConversion(`5 km to mi${' '.repeat(2000)}`)).toBeNull();
    expect(parseConversion('5   km   to   mi  ')).toEqual({ value: 5, from: 'km', to: 'mi' });
  });
});
