// Unit choices against the exact definitions of the units (NIST SP 811).
import { describe, expect, it } from 'vitest';
import type { QuantityKind } from './units';
import { convertKind, findUnit, formatQuantity, formatValue, latexValue, unitChoices } from './units';

const relative = (actual: number, expected: number, tol: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol * Math.abs(expected));

// One factor to SI per unit label, typed from NIST SP 811 Appendix B (and the SI prefixes), never computed from
// units.ts; SP 811 rounds to 7 digits, so the bound is 6e-7. Temperatures list the scale factor only.
const NIST: Record<QuantityKind, Record<string, number>> = {
  dimensionless: { '': 1 },
  length: { m: 1, mm: 1e-3, cm: 1e-2, km: 1e3, µm: 1e-6, ft: 0.3048, in: 0.0254, yd: 0.9144, mi: 1609.344 },
  area: { 'm²': 1, 'mm²': 1e-6, 'cm²': 1e-4, 'ft²': 9.290304e-2, 'in²': 6.4516e-4 },
  volume: { 'm³': 1, L: 1e-3, mL: 1e-6, 'cm³': 1e-6, 'ft³': 2.831685e-2, 'in³': 1.6387064e-5, gal: 3.785412e-3 },
  mass: { kg: 1, g: 1e-3, t: 1e3, lbm: 0.45359237, slug: 14.593903, oz: 2.834952e-2 },
  amount: { mol: 1, kmol: 1e3, lbmol: 453.59237 },
  time: { s: 1, ms: 1e-3, min: 60, h: 3600 },
  temperature: { K: 1, '°C': 1, '°R': 0.5555555556, '°F': 0.5555555556 },
  temperatureDifference: { K: 1, '°C (difference)': 1, '°R': 0.5555555556, '°F (difference)': 0.5555555556 },
  pressure: { kPa: 1e3, Pa: 1, MPa: 1e6, bar: 1e5, atm: 101325, psi: 6894.757, psf: 47.88026, inHg: 3386.389 },
  stress: { MPa: 1e6, kPa: 1e3, GPa: 1e9, Pa: 1, ksi: 6.894757e6, psi: 6894.757 },
  modulus: { GPa: 1e9, MPa: 1e6, ksi: 6.894757e6, Msi: 6.894757e9 },
  force: { N: 1, kN: 1e3, MN: 1e6, lbf: 4.448222, kip: 4448.222 },
  energy: { J: 1, kJ: 1e3, MJ: 1e6, kWh: 3.6e6, Btu: 1055.056, 'ft·lbf': 1.355818, 'in·lbf': 0.1129848 },
  power: { W: 1, kW: 1e3, MW: 1e6, hp: 745.69987158, 'Btu/h': 0.2930711, 'ft·lbf/s': 1.355818 },
  energyPerMass: { 'kJ/kg': 1e3, 'J/kg': 1, 'MJ/kg': 1e6, 'Btu/lbm': 2326 },
  specificEntropy: { 'kJ/(kg·K)': 1e3, 'J/(kg·K)': 1, 'Btu/(lbm·°R)': 4186.8 },
  specificVolume: { 'm³/kg': 1, 'L/kg': 1e-3, 'ft³/lbm': 6.242796e-2 },
  density: { 'kg/m³': 1, 'g/cm³': 1e3, 'lbm/ft³': 16.01846, 'slug/ft³': 515.3788, 'lbm/in³': 2.76799e4 },
  velocity: { 'm/s': 1, 'km/h': 0.2777778, 'ft/s': 0.3048, 'mi/h': 0.44704, kn: 0.5144444 },
  acceleration: { 'm/s²': 1, 'ft/s²': 0.3048 },
  massFlow: {
    'kg/s': 1,
    'kg/min': 1.666667e-2,
    'kg/h': 2.777778e-4,
    'lbm/s': 0.4535924,
    'lbm/min': 7.559873e-3,
    'lbm/h': 1.259979e-4,
  },
  volumeFlow: {
    'm³/s': 1,
    'L/s': 1e-3,
    'L/min': 1.666667e-5,
    'm³/h': 2.777778e-4,
    'ft³/s': 2.831685e-2,
    'ft³/min': 4.719474e-4,
    'gal/min': 6.30902e-5,
  },
  torque: { 'N·m': 1, 'kN·m': 1e3, 'lbf·ft': 1.355818, 'lbf·in': 0.1129848, 'kip·ft': 1355.818 },
  angle: { rad: 1, deg: 1.745329e-2 },
  frequency: { Hz: 1, kHz: 1e3, MHz: 1e6 },
  angularVelocity: { 'rad/s': 1, rpm: 0.104719755 },
  dynamicViscosity: { 'Pa·s': 1, 'mPa·s': 1e-3, cP: 1e-3, 'lbf·s/ft²': 47.88026, 'lbm/(ft·s)': 1.4881639 },
  kinematicViscosity: { 'm²/s': 1, 'mm²/s': 1e-6, cSt: 1e-6, 'ft²/s': 9.290304e-2 },
  conductivity: { 'W/(m·K)': 1, 'Btu/(h·ft·°F)': 1.730735 },
  heatTransferCoefficient: { 'W/(m²·K)': 1, 'Btu/(h·ft²·°F)': 5.678263 },
  heatFlux: { 'W/m²': 1, 'kW/m²': 1e3, 'Btu/(h·ft²)': 3.154591 },
  areaMoment: { 'm⁴': 1, 'mm⁴': 1e-12, 'cm⁴': 1e-8, 'in⁴': 4.162314e-7, 'ft⁴': 8.630975e-3 },
  voltage: { V: 1, mV: 1e-3, kV: 1e3 },
  current: { A: 1, mA: 1e-3, kA: 1e3 },
  resistance: { Ω: 1, kΩ: 1e3, MΩ: 1e6 },
  capacitance: { µF: 1e-6, nF: 1e-9, pF: 1e-12, F: 1 },
  inductance: { mH: 1e-3, H: 1, µH: 1e-6 },
};

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

  it('lists units for every kind in both systems and reads labels from either', () => {
    for (const kind of Object.keys(NIST) as QuantityKind[]) {
      for (const system of ['SI', 'US'] as const) expect(unitChoices(kind, system).length).toBeGreaterThan(0);
    }
    expect(unitChoices('area', 'SI')[0].label).toBe('m²');
    expect(findUnit('pressure', 'furlong')).toBeNull();
    expect(() => convertKind(1, 'pressure', 'kPa', 'm')).toThrow(/domain/);
  });

  it('gives every unit of every kind its NIST SP 811 factor to SI', () => {
    for (const [kind, factors] of Object.entries(NIST) as [QuantityKind, Record<string, number>][]) {
      for (const system of ['SI', 'US'] as const) {
        for (const unit of unitChoices(kind, system)) {
          const expected = factors[unit.label];
          expect(expected, `${kind} ${unit.label} has no reference factor`).toBeDefined();
          expect(Math.abs(unit.factor - expected) / expected, `${kind} ${unit.label}`).toBeLessThan(6e-7);
        }
      }
    }
  });

  it('turns 1 rpm into 0.10471975512 rad/s and 60 rpm into 2π rad/s', () => {
    relative(convertKind(1, 'angularVelocity', 'rpm', 'rad/s'), 0.10471975512, 1e-10);
    relative(convertKind(60, 'angularVelocity', 'rpm', 'rad/s'), 6.283185307179586, 1e-12);
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
