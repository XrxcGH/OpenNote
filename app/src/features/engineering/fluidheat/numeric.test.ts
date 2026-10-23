import { describe, expect, it } from 'vitest';
import { bracketScan, besselI, besselJ, besselK, brent, CalcError, erf, erfc, erfcx, fmt } from './numeric';

describe('numeric helpers', () => {
  it('brent finds sqrt(2)', () => {
    expect(brent((x) => x * x - 2, 0, 2)).toBeCloseTo(Math.SQRT2, 12);
  });
  it('brent rejects an unbracketed root', () => {
    expect(() => brent((x) => x * x + 1, -1, 1)).toThrow(CalcError);
  });
  it('bracketScan finds all roots of sin on [1, 10]', () => {
    const r = bracketScan(Math.sin, 1, 10, 100);
    expect(r).toHaveLength(3);
    expect(r[0]).toBeCloseTo(Math.PI, 10);
  });
  // reference values: Abramowitz and Stegun tables 9.1, 9.8 and 9.9
  it('Bessel J0, J1', () => {
    expect(besselJ(0, 1)).toBeCloseTo(0.7651976866, 9);
    expect(besselJ(1, 1)).toBeCloseTo(0.4400505857, 9);
    expect(besselJ(0, 5)).toBeCloseTo(-0.1775967713, 9);
    expect(besselJ(0, 20)).toBeCloseTo(0.1670246643, 8);
    expect(besselJ(1, 20)).toBeCloseTo(0.0668331237, 8);
    expect(besselJ(1, -1)).toBeCloseTo(-0.4400505857, 9);
  });
  it('Bessel I0, I1', () => {
    expect(besselI(0, 1)).toBeCloseTo(1.2660658778, 9);
    expect(besselI(1, 1)).toBeCloseTo(0.565159104, 9);
    expect(besselI(0, 5)).toBeCloseTo(27.2398718236, 8);
  });
  it('Bessel K0, K1', () => {
    expect(besselK(0, 1)).toBeCloseTo(0.4210244382, 9);
    expect(besselK(1, 1)).toBeCloseTo(0.6019072302, 9);
    expect(besselK(0, 0.1)).toBeCloseTo(2.4270690247, 9);
    expect(besselK(1, 0.1)).toBeCloseTo(9.8538447809, 8);
    expect(besselK(0, 3)).toBeCloseTo(0.0347395044, 9);
    expect(besselK(1, 3)).toBeCloseTo(0.0401564311, 9);
    expect(() => besselK(0, 0)).toThrow(CalcError);
  });
  it('fmt', () => {
    expect(fmt(1234.5678)).toBe('1234.6');
    expect(fmt(0.00001234)).toBe('1.234e-5');
  });
});

describe('error functions', () => {
  // reference values from SciPy
  it('erf and erfc', () => {
    expect(erf(0.4729202948659715)).toBeCloseTo(0.4963835012592, 10);
    expect(erf(1)).toBeCloseTo(0.8427007929497149, 14);
    expect(erfc(1)).toBeCloseTo(0.15729920705028513, 14);
    expect(erfc(3)).toBeCloseTo(2.209049699858544e-5, 18);
    expect(erfc(5) / 1.5374597944280347e-12 - 1).toBeLessThan(1e-9);
    expect(erf(-0.5)).toBeCloseTo(-0.5204998778130465, 14);
    expect(erfc(0)).toBe(1);
  });
  it('erfcx stays finite for large arguments', () => {
    expect(erfcx(10)).toBeCloseTo(0.056140992743822, 12);
    expect(erfcx(1e5)).toBeCloseTo(1 / (1e5 * Math.sqrt(Math.PI)), 12);
    expect(erfcx(-1)).toBeCloseTo(5.00898008076228, 10);
  });
});
