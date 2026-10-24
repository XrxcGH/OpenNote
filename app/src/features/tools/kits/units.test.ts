// Unit choices against the exact definitions of the units (NIST SP 811).
import { describe, expect, it } from 'vitest';
import type { QuantityKind } from './units';
import { convertKind, findUnit, formatQuantity, formatValue, fromSI, latexValue, toSI, unitChoices } from './units';

const relative = (actual: number, expected: number, tol: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol * Math.abs(expected));

describe('kit units', () => {
  it('converts 14.6959 psi to 101.325 kPa, 1 Btu/lbm to 2.326 kJ/kg, and 1 ft·lbf to 1.3558179 J', () => {
    // 14.6959 psi is 1 atm rounded to 6 digits, so it lands 3.4e-6 from 101.325 kPa; the exact product is checked too.
    relative(convertKind(14.6959, 'pressure', 'psi', 'kPa'), (14.6959 * 4.4482216152605) / 0.0254 ** 2 / 1000, 1e-12);
    relative(convertKind(14.6959, 'pressure', 'psi', 'kPa'), 101.325, 4e-6);
    relative(convertKind(14.695948775513449, 'pressure', 'psi', 'kPa'), 101.325, 1e-12);
    relative(convertKind(1, 'energyPerMass', 'Btu/lbm', 'kJ/kg'), 2.326, 1e-6);
    relative(convertKind(1, 'energy', 'ft·lbf', 'J'), 1.3558179, 1e-6);
  });

  it('handles temperatures, differences, and the Rankine labels', () => {
    expect(convertKind(100, 'temperature', '°C', '°F')).toBeCloseTo(212, 12);
    expect(convertKind(491.67, 'temperature', '°R', 'K')).toBeCloseTo(273.15, 12);
    expect(convertKind(10, 'temperatureDifference', '°C (difference)', '°F (difference)')).toBeCloseTo(18, 12);
    relative(convertKind(1, 'specificEntropy', 'Btu/(lbm·°R)', 'kJ/(kg·K)'), 4.1868, 1e-6);
    relative(convertKind(1, 'conductivity', 'Btu/(h·ft·°F)', 'W/(m·K)'), 1.730735, 1e-6);
    relative(convertKind(1, 'heatTransferCoefficient', 'Btu/(h·ft²·°F)', 'W/(m²·K)'), 5.678263, 1e-6);
  });

  it('lists units for every kind in both systems, each one readable', () => {
    const kinds: QuantityKind[] = ['pressure', 'stress', 'modulus', 'torque', 'areaMoment', 'dynamicViscosity'];
    for (const kind of kinds) {
      for (const system of ['SI', 'US'] as const) {
        const list = unitChoices(kind, system);
        expect(list.length).toBeGreaterThan(0);
        for (const unit of list) expect(fromSI(toSI(3.5, unit), unit)).toBeCloseTo(3.5, 12);
      }
    }
    expect(unitChoices('area', 'SI')[0].label).toBe('m²');
    expect(findUnit('pressure', 'furlong')).toBeNull();
    expect(() => convertKind(1, 'pressure', 'kPa', 'm')).toThrow(/domain/);
  });

  it('formats values with significant digits, in text and LaTeX', () => {
    expect(formatValue(101325, 4)).toBe('101300');
    expect(formatValue(1.23456e-5, 4)).toBe('1.235×10⁻⁵');
    expect(formatValue(-2.5)).toBe('−2.5');
    expect(formatValue(Infinity)).toBe('∞');
    expect(latexValue(1.23456e-5, 4)).toBe('1.235 \\times 10^{-5}');
    expect(formatQuantity(101.325, findUnit('pressure', 'kPa')!, 5)).toBe('101.33 kPa');
  });
});
