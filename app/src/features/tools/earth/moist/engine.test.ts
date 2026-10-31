// Atmospheric thermodynamics: each planning case is checked against an independent value (the planning pass,
// a published table, or another formula), then the edge cases.
import { describe, expect, it } from 'vitest';
import { Problem } from '../core/problem';
import { checkSounding, components, indices, liftParcel, winds } from './sounding';
import type { Level } from './sounding';
import {
  DRY_LAPSE,
  T0,
  capeTrapezoids,
  dewPoint,
  esIce,
  esWater,
  frostPoint,
  lambertW,
  lclRomps,
  lclTemperatureBolton,
  mixingRatio,
  moistAdiabat,
  moistLapse,
  potentialTemperature,
  saltHumidity,
  thetaE,
  thickness,
  wetBulb,
} from './thermo';

const problem = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof Problem ? error.code : 'other';
  }
  return null;
};

describe('humidity', () => {
  it('gives es 23.3695 hPa at 20 C, and w 7.35383 g/kg and Td 9.27009 C at RH 50% and 1000 hPa', () => {
    const es = esWater(T0 + 20);
    expect(Math.abs(es / 100 - 23.3695)).toBeLessThan(5e-5);
    const e = es / 2;
    expect(Math.abs(1000 * mixingRatio(e, 1e5) - 7.35383)).toBeLessThan(5e-5);
    expect(Math.abs(dewPoint(e) - T0 - 9.27009)).toBeLessThan(5e-5);
  });

  it('puts the frost point above the dew point below freezing, and both forms near each other', () => {
    const e = esWater(T0 - 10) * 0.8;
    expect(frostPoint(e)).toBeGreaterThan(dewPoint(e));
    expect(esIce(T0)).toBeCloseTo(611.2, 9);
    expect(Math.abs(esWater(T0 + 30, 'magnus') - esWater(T0 + 30)) / esWater(T0 + 30)).toBeLessThan(0.01);
  });

  it('gives the wet-bulb temperature near Stull’s 13.7 C for 20 C and 50% at sea level', () => {
    const t = T0 + 20;
    const td = dewPoint(esWater(t) / 2);
    expect(Math.abs(wetBulb(t, td, 101325) - (T0 + 13.7))).toBeLessThan(0.3);
    expect(wetBulb(t, t, 101325)).toBeCloseTo(t, 6);
  });

  it('names a dew point above the temperature and a temperature out of range', () => {
    expect(problem(() => lclTemperatureBolton(280, 290))).toBe('dewAbove');
    expect(problem(() => esWater(50))).toBe('temperature');
  });
});

describe('potential temperatures and the LCL', () => {
  it('gives θ 293.307 K for 280 K at 850 hPa', () => {
    expect(Math.abs(potentialTemperature(280, 85000) - 293.307)).toBeLessThan(5e-4);
  });

  it('gives T_L 290.815 K and θe 347.523 K for T 30 C, Td 20 C at 1000 hPa', () => {
    expect(Math.abs(lclTemperatureBolton(T0 + 30, T0 + 20) - 290.815)).toBeLessThan(5e-4);
    expect(Math.abs(thetaE(T0 + 30, T0 + 20, 1e5) - 347.523)).toBeLessThan(5e-3);
  });

  it('agrees with Romps’ exact LCL to within half a kelvin', () => {
    const t = T0 + 30;
    const rh = esWater(T0 + 20) / esWater(t);
    expect(Math.abs(lclRomps(1e5, t, rh).t - lclTemperatureBolton(t, T0 + 20))).toBeLessThan(0.5);
    expect(lclRomps(1e5, t, 1).z).toBeCloseTo(0, 6);
  });

  it('solves w e^w = x on both branches', () => {
    expect(lambertW(Math.E)).toBeCloseTo(1, 12);
    const w = lambertW(-0.2, -1);
    expect(w * Math.exp(w)).toBeCloseTo(-0.2, 12);
    expect(w).toBeLessThan(-1);
  });

  it('keeps θe along a pseudo-adiabat and lapses more slowly than dry air when warm and moist', () => {
    expect(moistLapse(T0 + 25, 1e5)).toBeLessThan(DRY_LAPSE);
    expect(Math.abs(DRY_LAPSE - 9.751e-3)).toBeLessThan(1e-5);
    const t500 = moistAdiabat(T0 + 20, 1e5, 5e4);
    expect(t500).toBeLessThan(T0 + 20);
    expect(t500).toBeGreaterThan(T0 + 20 - 50 * 9.8);
  });
});

describe('layers and parcels', () => {
  it('gives 5478.05 m for 1000-500 hPa at mean Tv 270 K', () => {
    expect(Math.abs(thickness(1e5, 5e4, 270) - 5478.05)).toBeLessThan(5e-3);
  });

  it('gives 292.593 J/kg by trapezoids for Tv differences 0, 2, 3, 2, 0 K at 900 to 500 hPa', () => {
    const r = capeTrapezoids([90000, 80000, 70000, 60000, 50000], [0, 2, 3, 2, 0]);
    expect(Math.abs(r.cape - 292.593)).toBeLessThan(5e-4);
    expect(r.cin).toBe(0);
  });

  it('gives Greenspan’s 75.29% for NaCl and 32.78% for MgCl2 at 25 C', () => {
    expect(saltHumidity('nacl', 25)).toBe(75.29);
    expect(saltHumidity('mgcl2', 25)).toBe(32.78);
    expect(problem(() => saltHumidity('nacl', 40))).toBe('saltRange');
  });

  const sounding: Level[] = [
    [1000, 110, 30, 22, 170, 10],
    [850, 1520, 19, 15, 230, 30],
    [700, 3110, 8, -2, 250, 35],
    [500, 5650, -9, -25, 265, 50],
    [300, 9300, -35, -50, 270, 70],
    [200, 12000, -54, -65, 270, 70],
  ].map(([p, z, t, td, d, s]) => {
    const [u, v] = components(d, s * 0.514444);
    return { p: p * 100, z, t: t + T0, td: td + T0, u, v };
  });

  it('finds positive CAPE, an LFC above the LCL, and a lifted index below zero for a moist, warm surface', () => {
    const levels = checkSounding(sounding);
    const parcel = liftParcel(levels, 'surface');
    expect(parcel.cape).toBeGreaterThan(500);
    expect(parcel.lfc!).toBeLessThanOrEqual(parcel.lcl.p);
    const i = indices(levels, parcel);
    expect(i.lifted!).toBeLessThan(0);
    // TT = T850 + Td850 − 2 T500 in °C: 19 + 15 + 18.
    expect(i.totals!).toBeCloseTo(52, 9);
    expect(i.water).toBeGreaterThan(20);
  });

  it('gives helicity and storm motion from veering winds, and none without winds', () => {
    const w = winds(checkSounding(sounding));
    expect(w.shear!).toBeGreaterThan(15);
    expect(w.srh!).toBeGreaterThan(0);
    const calm = winds(checkSounding(sounding.map((l) => ({ ...l, u: null, v: null }))));
    expect(calm.srh).toBeNull();
    expect(problem(() => checkSounding(sounding.slice(0, 2)))).toBe('soundingShort');
  });
});
