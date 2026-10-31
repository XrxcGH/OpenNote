// TEOS-10 seawater: each expected value comes from a definition, a published check value, or the independent
// EOS-80 equation of state, never from this engine.
import { describe, expect, it } from 'vitest';
import { Problem } from '../core/problem';
import {
  SPECVOL_TERMS,
  SSO,
  conservativeTemperature,
  density,
  freezingConservative,
  freezingPoint,
  potentialFromConservative,
  referenceSalinity,
  sigma0,
  sigmaTheta,
  specificVolume,
  teosDensity,
  teosSample,
  toT68,
} from './engine';

const problem = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof Problem ? error.code : 'other';
  }
  return null;
};

describe('TEOS-10 seawater', () => {
  it('keeps all 75 terms of the specific volume polynomial', () => {
    expect(SPECVOL_TERMS).toBe(75);
  });

  it('gives standard seawater at 0 °C a conservative temperature of 0, as TEOS-10 defines it', () => {
    // The Gibbs function sets enthalpy to zero for SA = 35.16504 g/kg at 0 °C and the surface.
    expect(Math.abs(conservativeTemperature(SSO, 0))).toBeLessThan(1e-6);
    expect(referenceSalinity(35)).toBeCloseTo(35.16504, 12);
  });

  it('matches the IAPWS-08 density of standard seawater at 0 °C', () => {
    // IAPWS-08 check table: ρ = 1028.10633654 kg/m³ at S = 0.03516504 kg/kg, 273.15 K, 101325 Pa.
    expect(Math.abs(teosDensity(SSO, 0, 0) - 1028.10633654)).toBeLessThan(0.003);
  });

  it('puts the density maximum of pure water near 4 °C at 999.975 kg/m³', () => {
    const rho = (pt: number) => teosDensity(0, conservativeTemperature(0, pt), 0);
    expect(Math.abs(rho(3.98) - 999.975)).toBeLessThan(0.01);
    expect(rho(3.98)).toBeGreaterThan(rho(2));
    expect(rho(3.98)).toBeGreaterThan(rho(6));
  });

  it('freezes pure air-free water at its normal melting point, 273.152519 K', () => {
    expect(Math.abs(freezingConservative(0, 0, 0) - conservativeTemperature(0, 0.002519))).toBeLessThan(5e-4);
  });

  it('freezes air-saturated seawater at S 35 near the UNESCO value', () => {
    const ct = freezingConservative(SSO, 0, 1);
    const pt = potentialFromConservative(SSO, ct);
    expect(Math.abs(pt - freezingPoint(35, 0) / 1.00024)).toBeLessThan(0.004);
    // Pressure lowers the freezing point, about 75 mK per 100 dbar.
    expect(freezingConservative(SSO, 1000, 1)).toBeLessThan(ct - 0.6);
  });

  it('agrees with EOS-80 density and potential density across the ocean', () => {
    const cases: [number, number, number][] = [
      [35, 5, 0],
      [35, 15, 1000],
      [34.5, 25, 0],
      [35, 2, 4000],
      [36, 10, 2000],
      [10, 20, 0],
    ];
    for (const [s, t, p] of cases) {
      const sample = teosSample(s, t, p);
      expect(Math.abs(sample.rho - density(s, toT68(t), p))).toBeLessThan(0.01);
      expect(Math.abs(sample.sigma0 - sigmaTheta(s, sample.pt * 1.00024))).toBeLessThan(0.01);
      expect(sample.rho).toBeCloseTo(1 / sample.v, 9);
    }
  });

  it('inverts conservative temperature back to potential temperature', () => {
    for (const pt of [-1.5, 0, 12.3, 29.9]) {
      expect(potentialFromConservative(34, conservativeTemperature(34, pt))).toBeCloseTo(pt, 9);
    }
    expect(sigma0(SSO, 0)).toBeCloseTo(teosDensity(SSO, 0, 0) - 1000, 12);
  });

  it('names impossible input', () => {
    expect(problem(() => referenceSalinity(-1))).toBe('salinity');
    expect(problem(() => referenceSalinity(Number.NaN))).toBe('salinity');
    expect(problem(() => specificVolume(50, 10, 0))).toBe('teosSalinity');
    expect(problem(() => specificVolume(35, 60, 0))).toBe('teosTemperature');
    expect(problem(() => specificVolume(35, 10, -5))).toBe('pressure');
    expect(problem(() => specificVolume(35, 10, 2e4))).toBe('pressure');
    expect(problem(() => freezingConservative(35, 0, 2))).toBe('air');
    expect(problem(() => potentialFromConservative(35, 99))).toBe('teosTemperature');
    expect(problem(() => teosSample(35, 50, 0))).toBe('temperature');
  });
});
