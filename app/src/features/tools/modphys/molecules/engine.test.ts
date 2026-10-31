import { describe, expect, it } from 'vitest';
import { PhysicsError } from '../shared/errors';
import { composition, isotopeMass, isotopePattern, massSpectrum, unsaturation } from './mass';
import { chain, floryHuggins, integration, molarMasses, multiplet, nmr, parseRows } from './nmrPolymer';
import { rotor, rotorB, rovibration, spinWeight, vibLevel, vibration } from './spectra';

const rel = (got: number, want: number) => Math.abs(got / want - 1);
const item = (calc: { items: readonly { key: string; value: number }[] }, key: string) =>
  calc.items.find((one) => one.key === key)!.value;

describe('rotational and vibrational spectra', () => {
  it('gives B = 1.93239 per cm for 12C16O at 112.8 pm', () => {
    expect(Math.abs(rotorB(isotopeMass('12C'), isotopeMass('16O'), 112.8e-12) - 1.93239)).toBeLessThan(1e-4);
    const calc = rotor(12, 15.99491461957, 112.8e-12, 0, 300);
    expect(item(calc, 'spacing')).toBeCloseTo(2 * item(calc, 'rotB'), 12);
  });

  it('gives the fundamental 2143.22 per cm for omega_e 2169.8 and omega_e x_e 13.29', () => {
    expect(Math.abs(item(vibration(2169.8, 13.29), 'fundamental') - 2143.22)).toBeLessThan(1e-9);
    // De = ωe² / (4 ωe xe) worked by hand: 2169.8² / 53.16.
    expect(rel(item(vibration(2169.8, 13.29), 'de'), 2169.8 ** 2 / 53.16)).toBeLessThan(1e-12);
    expect(vibLevel(1000, 0, 0)).toBe(500);
  });

  it('puts R(0) and P(1) 4B apart for a rigid rotor and weights homonuclear levels', () => {
    const calc = rovibration(2000, 0, 2, 0, 300, null);
    expect(item(calc, 'bandGap')).toBeCloseTo(8, 10);
    expect(item(calc, 'bandOrigin')).toBe(2000);
    // H2 (I = 1/2): para (even J) 1, ortho (odd J) 3; 14N2 (I = 1): even 6, odd 3.
    expect([spinWeight(1, 0), spinWeight(1, 1)]).toEqual([1, 3]);
    expect([spinWeight(2, 0), spinWeight(2, 1)]).toEqual([6, 3]);
  });

  it('refuses impossible constants', () => {
    expect(() => vibration(100, 60)).toThrow(PhysicsError);
    expect(() => rotor(12, 16, 0, 0, 300)).toThrow(PhysicsError);
    expect(() => rovibration(2000, 10, 1, 1, 300, null)).toThrow(PhysicsError);
    expect(() => isotopeMass('99C')).toThrow(PhysicsError);
  });
});

describe('mass spectra', () => {
  it('gives the Cl2 pattern 1 : 0.63992 : 0.10237', () => {
    const pattern = isotopePattern(composition('Cl2'));
    const base = pattern[0]![2];
    const r = 0.2424 / 0.7576;
    expect(Math.abs(pattern[1]![2] / base - 0.63992)).toBeLessThan(1e-5);
    expect(Math.abs(pattern[2]![2] / base - 0.10237)).toBeLessThan(1e-5);
    expect(pattern[1]![2] / base).toBeCloseTo(2 * r, 12);
    expect(pattern[2]![2] / base).toBeCloseTo(r * r, 12);
  });

  it('gives degrees of unsaturation 4 and 6 for C6H6 and C7H5NO', () => {
    expect(unsaturation(composition('C6H6'))).toBe(4);
    expect(unsaturation(composition('C7H5NO'))).toBe(6);
  });

  it('gives exact masses and the nitrogen rule', () => {
    expect(item(massSpectrum('H2O'), 'mono')).toBeCloseTo(2 * 1.00782503223 + 15.99491461957, 10);
    expect(massSpectrum('C7H5NO').items.some((one) => one.key === 'nitrogenOdd')).toBe(true);
    expect(item(massSpectrum('C7H5NO'), 'nominal')).toBe(119);
    // M+1 of C6H6 is close to 6 × 1.07/98.93 + 6 × 0.0115/99.9885 ≈ 6.56 %.
    expect(item(massSpectrum('C6H6'), 'mPlus1')).toBeCloseTo(
      100 * (6 * (0.0107 / 0.9893) + 6 * (0.000115 / 0.999885)),
      6,
    );
  });

  it('refuses unknown elements and formulas it cannot read', () => {
    expect(() => composition('C6H6Xe')).toThrow(PhysicsError);
    expect(() => composition('')).toThrow(PhysicsError);
    expect(() => composition('C9999')).toThrow(PhysicsError);
  });
});

describe('NMR', () => {
  it('splits a doublet of doublets with J 10 and 4 Hz into -7, -3, 3, 7 Hz of equal height', () => {
    const { lines } = multiplet([
      [10, 1],
      [4, 1],
    ]);
    expect(lines.map(([x]) => x)).toEqual([-7, -3, 3, 7]);
    expect(new Set(lines.map(([, w]) => w)).size).toBe(1);
  });

  it('gives a 1:2:1 triplet and ppm positions on a 400 MHz magnet', () => {
    const { lines } = multiplet([[7, 2]]);
    expect(lines.map(([, w]) => w * 4)).toEqual([1, 2, 1]);
    const calc = nmr([[7, 2]], 1.2, 400);
    expect(calc.items.filter((one) => one.key === 'nmrLine').map((one) => one.value)).toEqual([-7, 0, 7]);
  });

  it('scales integrals to protons and refuses bad couplings', () => {
    expect(integration([2, 3, 1], 12).items.map((one) => one.value)).toEqual([4, 6, 2]);
    expect(() => multiplet([[-1, 1]])).toThrow(PhysicsError);
    expect(() => multiplet([[7, 0]])).toThrow(PhysicsError);
    expect(() => parseRows('7 x', 2)).toThrow(PhysicsError);
  });
});

describe('polymers', () => {
  it('gives Mn 20000, Mw 25000, D 1.25, and Xn 100', () => {
    const calc = molarMasses(
      [
        [10, 10000],
        [10, 30000],
      ],
      0.99,
    );
    expect(Math.abs(item(calc, 'mn') - 20000)).toBeLessThan(1e-9);
    expect(Math.abs(item(calc, 'mw') - 25000)).toBeLessThan(1e-9);
    expect(Math.abs(item(calc, 'dispersity') - 1.25)).toBeLessThan(1e-9);
    expect(Math.abs(item(calc, 'xn') - 100)).toBeLessThan(1e-9);
    expect(() => molarMasses([[10, 100]], 1)).toThrow(PhysicsError);
  });

  it('gives chi_c 0.02 for N1 = N2 = 100', () => {
    expect(Math.abs(item(floryHuggins(100, 100, 0.01, 0.5), 'chiC') - 0.02)).toBeLessThan(1e-12);
    expect(item(floryHuggins(100, 100, 0.01, 0.5), 'phiC')).toBe(0.5);
    expect(() => floryHuggins(100, 100, 0.01, 0)).toThrow(PhysicsError);
  });

  it('gives √N b for a freely jointed chain and the rod and coil limits of a worm-like chain', () => {
    expect(item(chain(100, 1), 'rms')).toBeCloseTo(10, 12);
    expect(rel(item(chain(1, 1e-9, 1e-3), 'wlc'), 1e-9)).toBeLessThan(1e-5);
    expect(rel(item(chain(1e6, 1, 1), 'wlc'), Math.sqrt(2 * 1e6))).toBeLessThan(1e-5);
    expect(() => chain(0, 1)).toThrow(PhysicsError);
  });
});
