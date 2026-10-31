// TEOS-10 seawater: each expected value comes from a definition, a published check value, or the independent
// EOS-80 equation of state, never from this engine.
import { describe, expect, it } from 'vitest';
import { Problem } from '../core/problem';
import {
  SPECVOL_TERMS,
  SSO,
  buoyancy,
  conservativeFromInSitu,
  conservativeTemperature,
  expansion,
  gravity,
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

describe('TEOS-10 derived properties', () => {
  it('matches the GSW check-cast potential temperatures to 0.05 mK', () => {
    // gsw_pt_from_t on the GSW check cast (SA g/kg, t °C, p dbar), from the GSW documentation's check values.
    const cast: [number, number, number, number][] = [
      [34.7118, 28.7856, 10, 28.783177048624573],
      [34.8915, 28.4329, 50, 28.420955597191984],
      [35.0256, 22.8103, 125, 22.784953468087107],
      [34.8472, 10.26, 250, 10.230534394434429],
      [34.7366, 6.8863, 600, 6.829216587061605],
      [34.7324, 4.4036, 1000, 4.324534835990236],
    ];
    for (const [sa, t, p, pt] of cast) {
      expect(Math.abs(potentialFromConservative(sa, conservativeFromInSitu(sa, t, p)) - pt)).toBeLessThan(5e-5);
    }
    // At the surface in-situ and potential temperature are the same thing.
    expect(conservativeFromInSitu(35, 12, 0)).toBeCloseTo(conservativeTemperature(35, 12), 12);
  });

  it('differentiates the polynomial to match centred differences of the density', () => {
    for (const [sa, ct, p] of [
      [35, 10, 0],
      [34.5, 2, 4000],
      [20, 25, 500],
    ]) {
      const h = 1e-4;
      const v = specificVolume(sa, ct, p);
      const alpha = (specificVolume(sa, ct + h, p) - specificVolume(sa, ct - h, p)) / (2 * h * v);
      const beta = -(specificVolume(sa + h, ct, p) - specificVolume(sa - h, ct, p)) / (2 * h * v);
      const got = expansion(sa, ct, p);
      expect(got.alpha / alpha).toBeCloseTo(1, 6);
      expect(got.beta / beta).toBeCloseTo(1, 6);
    }
    // Fresh water is densest near 4 °C, so α changes sign between 3 and 5 °C at the surface.
    expect(expansion(0, 3, 0).alpha).toBeLessThan(0);
    expect(expansion(0, 5, 0).alpha).toBeGreaterThan(0);
  });

  it('gives N² from α and β that equals g² Δρ/ΔP of densities taken at the mid-point pressure', () => {
    const upper = { sa: 35.2, ct: 15, p: 100 };
    const lower = { sa: 34.9, ct: 10, p: 300 };
    const lat = 30;
    const { n2, pMid } = buoyancy(upper, lower, lat);
    const g = gravity(lat, pMid);
    const direct =
      (g * g * (teosDensity(lower.sa, lower.ct, pMid) - teosDensity(upper.sa, upper.ct, pMid))) /
      ((lower.p - upper.p) * 1e4);
    expect(n2 / direct).toBeCloseTo(1, 2);
    expect(n2).toBeGreaterThan(0);
    // A well-mixed layer is neutral.
    expect(buoyancy({ sa: 35, ct: 8, p: 0 }, { sa: 35, ct: 8, p: 50 }, lat).n2).toBe(0);
    // Surface gravity runs from 9.7803 m/s² at the equator to 9.8322 m/s² at the pole.
    expect(gravity(0, 0)).toBeCloseTo(9.780327, 6);
    expect(gravity(90, 0)).toBeCloseTo(9.83218, 4);
  });

  it('gives the in-situ freezing temperature that UNESCO 1983 gives at S 35 and 500 dbar', () => {
    // UNESCO: tf = −0.0575 S + 1.710523e−3 S^1.5 − 2.154996e−4 S² − 7.53e−4 p.
    const s = 35;
    const unesco = -0.0575 * s + 1.710523e-3 * s ** 1.5 - 2.154996e-4 * s * s - 7.53e-4 * 500;
    const sample = teosSample(s, 0, 500, 1);
    expect(Math.abs(sample.tFreeze - unesco)).toBeLessThan(0.005);
    // At the surface the in-situ and potential freezing temperatures coincide.
    const top = teosSample(s, 0, 0);
    expect(top.tFreeze).toBeCloseTo(top.ptFreeze, 9);
  });
});

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
    expect(problem(() => teosSample(35, 50, 0))).toBe('teosTemperature');
    expect(problem(() => buoyancy({ sa: 35, ct: 5, p: 100 }, { sa: 35, ct: 4, p: 50 }, 0))).toBe('teosOrder');
    expect(problem(() => gravity(95, 0))).toBe('latitude');
  });
});
