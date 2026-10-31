import { describe, expect, it } from 'vitest';
import { ASTRO, C, MASS_SUN } from '../shared/constants';
import { PhysicsError } from '../shared/errors';
import { ccd, comovingVolume, cosmology, hubbleLaw, photons, rotation, telescope, vDisk, vIso, vNfw } from './engine';

const rel = (got: number, want: number) => Math.abs(got / want - 1);
const item = (calc: { items: readonly { key: string; value: number }[] }, key: string) =>
  calc.items.find((one) => one.key === key)!.value;
const GYR = 1e9 * ASTRO.year;
const MPC = 1e6 * ASTRO.pc;
const KPC = 1e3 * ASTRO.pc;
const flat = { h0: 70, om: 0.3, or: 0, ol: 0.7 };

describe('distances and ages', () => {
  it('gives the planning values for flat Lambda-CDM to z 1', () => {
    const calc = cosmology(flat, 1);
    expect(rel(item(calc, 'age'), 13.467)).toBeLessThan(1e-4);
    expect(rel(item(calc, 'comoving'), 3303.83)).toBeLessThan(1e-4);
    expect(rel(item(calc, 'luminosityDistance'), 6607.66)).toBeLessThan(1e-4);
    expect(rel(item(calc, 'lookback'), 7.71534)).toBeLessThan(1e-4);
  });

  it('matches the closed-form age of a flat Lambda-CDM universe', () => {
    // t0 = 2 / (3 H0 √ΩΛ) asinh(√(ΩΛ/Ωm)), with 1/H0 in Gyr.
    const hubbleGyr = MPC / (70e3 * GYR);
    const want = ((2 * hubbleGyr) / (3 * Math.sqrt(0.7))) * Math.asinh(Math.sqrt(0.7 / 0.3));
    expect(rel(item(cosmology(flat, 1), 'age'), want)).toBeLessThan(1e-8);
  });

  it('matches Einstein-de Sitter and the empty universe in closed form', () => {
    const dh = C.c / 1e3 / 70;
    const eds = cosmology({ h0: 70, om: 1, or: 0, ol: 0 }, 3);
    expect(rel(item(eds, 'comoving'), 2 * dh * (1 - 1 / 2))).toBeLessThan(1e-9);
    expect(rel(item(eds, 'age'), (2 / 3) * (MPC / (70e3 * GYR)))).toBeLessThan(1e-8);
    const empty = cosmology({ h0: 70, om: 0, or: 0, ol: 0 }, 2);
    expect(rel(item(empty, 'comoving'), dh * Math.log(3))).toBeLessThan(1e-9);
    // With Ωk = 1, D_M = D_H sinh(D_C / D_H) = D_H (3 − 1/3) / 2.
    expect(rel(item(empty, 'transverse'), (dh * (3 - 1 / 3)) / 2)).toBeLessThan(1e-9);
  });

  it('gives 4π/3 D³ for a flat universe and the 3-sphere cap π R³ (2ψ − sin 2ψ) for a closed one', () => {
    expect(rel(comovingVolume(flat, 1000), ((4 * Math.PI) / 3) * 1e9)).toBeLessThan(1e-12);
    const radius = C.c / 1e3 / 70 / Math.sqrt(0.2);
    const psi = Math.asin(3000 / radius);
    const want = Math.PI * radius ** 3 * (2 * psi - Math.sin(2 * psi));
    expect(rel(comovingVolume({ h0: 70, om: 1.2, or: 0, ol: 0 }, 3000), want)).toBeLessThan(1e-9);
  });

  it('gives the CMB temperature and an angular size', () => {
    const calc = cosmology(flat, 1, 10);
    expect(item(calc, 'tcmb')).toBeCloseTo(5.451, 6);
    const da = item(calc, 'angularDistance');
    expect(rel(item(calc, 'angularSize'), ((10e-3 / da) * 648000) / Math.PI)).toBeLessThan(1e-12);
  });

  it('refuses a bouncing universe, a negative redshift, and a zero Hubble constant', () => {
    expect(() => cosmology({ h0: 70, om: 0.1, or: 0, ol: 2 }, 1)).toThrow(PhysicsError);
    expect(() => cosmology(flat, -1)).toThrow(PhysicsError);
    expect(() => cosmology({ ...flat, h0: 0 }, 1)).toThrow(PhysicsError);
    expect(() => cosmology({ ...flat, om: -0.1 }, 1)).toThrow(PhysicsError);
  });

  it('gives zero distance at z 0', () => {
    const calc = cosmology(flat, 0);
    expect(item(calc, 'comoving')).toBe(0);
    expect(item(calc, 'lookback')).toBeCloseTo(0, 12);
  });
});

describe('the Hubble law', () => {
  it('gives v = 0.384615 c for z 0.5', () => {
    expect(Math.abs(item(hubbleLaw(0.5, 70), 'beta') - 5 / 13)).toBeLessThan(1e-12);
    expect(Math.abs(item(hubbleLaw(0.5, 70), 'beta') - 0.384615)).toBeLessThan(1e-6);
  });

  it('gives cz/H0 for the distance', () => {
    expect(rel(item(hubbleLaw(0.01, 70), 'lawDistance'), (299792.458 * 0.01) / 70)).toBeLessThan(1e-12);
    expect(() => hubbleLaw(-0.1, 70)).toThrow(PhysicsError);
  });
});

describe('rotation curves', () => {
  it('matches the thin-disk formula at R = 2 R_d with tabulated Bessel values', () => {
    // I0(1) K0(1) − I1(1) K1(1) from Abramowitz and Stegun, Table 9.8.
    const bracket = 1.266065878 * 0.421024438 - 0.565159104 * 0.60190723;
    const m = 5e10 * MASS_SUN;
    const rd = 3 * KPC;
    const sigma0 = m / (2 * Math.PI * rd * rd);
    const want = Math.sqrt(4 * Math.PI * C.G * sigma0 * rd * bracket);
    expect(rel(vDisk(m, rd, 2 * rd), want)).toBeLessThan(1e-7);
  });

  it('falls to the Kepler speed far out for every component', () => {
    const m = 1e11 * MASS_SUN;
    const r = 500 * KPC;
    expect(rel(vDisk(m, 1 * KPC, r), Math.sqrt((C.G * m) / r))).toBeLessThan(1e-4);
    const rho = 0.01 * (MASS_SUN / ASTRO.pc ** 3);
    const rc = 2 * KPC;
    expect(rel(vIso(rho, rc, 1e4 * rc), Math.sqrt(4 * Math.PI * C.G * rho * rc * rc))).toBeLessThan(2e-4);
    const x = 3;
    const mNfw = 4 * Math.PI * rho * (20 * KPC) ** 3 * (Math.log(4) - 3 / 4);
    expect(rel(vNfw(rho, 20 * KPC, x * 20 * KPC), Math.sqrt((C.G * mNfw) / (60 * KPC)))).toBeLessThan(1e-12);
  });

  it('adds components in quadrature and needs at least one', () => {
    const g = {
      r: 8 * KPC,
      point: 1e10 * MASS_SUN,
      disk: 0,
      diskScale: 0,
      isoRho: 0,
      isoCore: 0,
      nfwRho: 0,
      nfwScale: 0,
    };
    expect(rel(item(rotation(g), 'vTotal') * 1e3, Math.sqrt((C.G * g.point) / g.r))).toBeLessThan(1e-12);
    expect(() => rotation({ ...g, point: 0 })).toThrow(PhysicsError);
    expect(() => rotation({ ...g, disk: 1e10 * MASS_SUN })).toThrow(PhysicsError);
  });
});

describe('telescopes and detectors', () => {
  const scope = {
    d: 0.2,
    f: 2,
    pixel: 3.76e-6,
    nx: 6248,
    ny: 4176,
    lambda: 550e-9,
    seeing: 2 / 206264.806,
    eyepiece: 0.025,
  };

  it('gives 103.132″/mm at f 2000 mm and a 0.69202″ Rayleigh limit at 550 nm with D 0.2 m', () => {
    const calc = telescope(scope);
    expect(Math.abs(item(calc, 'plateScale') - 103.132)).toBeLessThan(1e-3);
    expect(Math.abs(item(calc, 'rayleigh') - 0.69202)).toBeLessThan(1e-4);
    expect(item(calc, 'focalRatio')).toBeCloseTo(10, 12);
    expect(item(calc, 'magnification')).toBeCloseTo(80, 12);
    expect(item(calc, 'dawes')).toBeCloseTo(0.58, 12);
  });

  it('refuses a zero aperture', () => {
    expect(() => telescope({ ...scope, d: 0 })).toThrow(PhysicsError);
  });

  it('gives SNR 33.4159 for the planning CCD case', () => {
    const c = { source: 100, time: 30, npix: 20, sky: 5, dark: 0.1, read: 10, gain: 2, target: 50 };
    const calc = ccd(c);
    expect(Math.abs(item(calc, 'snr') - 3000 / Math.sqrt(3000 + 20 * (150 + 3 + 100)))).toBeLessThan(1e-12);
    expect(Math.abs(item(calc, 'snr') - 33.4159)).toBeLessThan(1e-4);
    expect(item(calc, 'signalAdu')).toBe(1500);
    // The time for SNR 50, put back into the equation, gives 50.
    expect(item(ccd({ ...c, time: item(calc, 'timeForSnr') }), 'snr')).toBeCloseTo(50, 9);
    expect(() => ccd({ ...c, source: 0 })).toThrow(PhysicsError);
  });

  it('gives 3631 Jy at AB magnitude 0 and a hundredfold drop five magnitudes fainter', () => {
    const zero = photons(0, 3631, 550e-9, 90e-9, 1, 0, 1);
    expect(item(zero, 'fnu')).toBeCloseTo(3631, 9);
    const five = photons(5, 3631, 550e-9, 90e-9, 1, 0, 1);
    expect(rel(item(zero, 'photonFlux') / item(five, 'photonFlux'), 100)).toBeLessThan(1e-12);
    // N = f_ν Δλ / (h λ), and a 1 m aperture with no obstruction collects π/4 m².
    const n = (3631e-26 * 90e-9) / (C.h * 550e-9);
    expect(rel(item(zero, 'photonFlux'), n)).toBeLessThan(1e-12);
    expect(rel(item(zero, 'electronRate'), (n * Math.PI) / 4)).toBeLessThan(1e-12);
    expect(() => photons(0, 3631, 550e-9, 90e-9, 1, 1.2, 1)).toThrow(PhysicsError);
    expect(() => photons(Infinity, 3631, 550e-9, 90e-9, 1, 0, 1)).toThrow(PhysicsError);
  });
});
