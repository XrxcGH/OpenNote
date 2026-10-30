// Radiation and climate: each planning case is checked against its value from the planning pass, then closed forms
// (analytic energy-balance solutions, published forcings, calendar facts) and the edge cases.
import { describe, expect, it } from 'vitest';
import { Problem } from '../core/problem';
import { printed } from '../core/testing';
import { biotemperature, holdridge, koppen } from './classify';
import type { Normals } from './classify';
import {
  SEAWATER_HEAT,
  boxPath,
  boxTimes,
  budykoSellers,
  effectiveTemperature,
  equilibria,
  forcing,
  layerTemperatures,
  leakyLayer,
  rampForcing,
  tippingPoints,
} from './energy';
import type { IceAlbedo } from './energy';
import { footprint, readActivities } from './footprint';
import { dailyInsolation, solarLongitude } from './insolation';
import type { Orbit } from './insolation';
import { degreeDays, exponentA, heatIndex, petUnadjusted, waterBalance } from './water';

const problem = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof Problem ? error.code : 'other';
  }
  return null;
};

describe('energy balance', () => {
  it('gives 254.578 K for S0 1361 and albedo 0.3, and 302.746 K under one layer', () => {
    const te = effectiveTemperature(1361, 0.3);
    expect(Math.abs(te - 254.578)).toBeLessThan(1e-3);
    expect(Math.abs(layerTemperatures(te, 1).surface - 302.746)).toBeLessThan(1e-3);
  });

  it('matches the full layer when the leaky layer absorbs everything, and none when it absorbs nothing', () => {
    const te = effectiveTemperature(1361, 0.3);
    expect(leakyLayer(te, 1).surface).toBeCloseTo(layerTemperatures(te, 1).surface, 10);
    expect(leakyLayer(te, 0).surface).toBeCloseTo(te, 10);
    expect(layerTemperatures(te, 3).layers[2]).toBeCloseTo(3 ** 0.25 * te, 10);
  });

  it('names impossible albedo, sunlight, layers, and emissivity', () => {
    expect(problem(() => effectiveTemperature(1361, 1))).toBe('albedo');
    expect(problem(() => effectiveTemperature(0, 0.3))).toBe('solar');
    expect(problem(() => layerTemperatures(255, -1))).toBe('layers');
    expect(problem(() => layerTemperatures(255, 1.5))).toBe('layers');
    expect(problem(() => leakyLayer(255, 1.2))).toBe('emissivity');
  });
});

describe('radiative forcing', () => {
  it('gives 3.70834 W/m² for doubled CO2 and 2.96667 K with λ 0.8', () => {
    const f = forcing('co2', 560, 280);
    expect(Math.abs(f - 3.70834)).toBeLessThan(1e-5);
    expect(Math.abs(0.8 * f - 2.96667)).toBeLessThan(1e-5);
  });

  it('gives the IPCC TAR forcings of about 0.48 W/m² for CH4 and 0.15 W/m² for N2O, 1750 to 1998', () => {
    expect(Math.abs(forcing('ch4', 1745, 700, 270) - 0.48)).toBeLessThan(0.01);
    expect(Math.abs(forcing('n2o', 314, 270, 700) - 0.15)).toBeLessThan(0.01);
  });

  it('is negative when the gas falls, and names a zero concentration', () => {
    expect(forcing('co2', 200, 280)).toBeLessThan(0);
    expect(problem(() => forcing('co2', 0, 280))).toBe('concentration');
    expect(problem(() => forcing('ch4', 1800, 700, 0))).toBe('concentration');
  });
});

describe('box models', () => {
  const one = { sensitivity: 0.8, upper: SEAWATER_HEAT * 100, deep: 0, exchange: 0 };

  it('follows λF (1 − e^(−t/τ)) for a step, with τ = Cλ', () => {
    const tau = boxTimes(one)[0];
    expect(tau).toBeCloseTo((SEAWATER_HEAT * 100 * 0.8) / (365.25 * 86400), 10);
    const path = boxPath(one, rampForcing(3.7, 0), 10);
    const end = path.upper[path.upper.length - 1];
    expect(Math.abs(end - 0.8 * 3.7 * (1 - Math.exp(-10 / tau)))).toBeLessThan(1e-6);
  });

  it('settles at λF with a deep ocean, the deep box slower than the upper', () => {
    const two = { sensitivity: 0.8, upper: SEAWATER_HEAT * 70, deep: SEAWATER_HEAT * 1000, exchange: 0.7 };
    const times = boxTimes(two);
    expect(times).toHaveLength(2);
    expect(times[0]).toBeLessThan(times[1]);
    const path = boxPath(two, rampForcing(3.7, 0), 3000);
    expect(Math.abs(path.upper[path.upper.length - 1] - 2.96)).toBeLessThan(1e-3);
    const early = path.t.findIndex((t) => t >= 20);
    expect(path.deep[early]).toBeLessThan(path.upper[early]);
  });

  it('names zero sensitivity and a run of no years', () => {
    expect(problem(() => boxPath({ ...one, sensitivity: 0 }, () => 1, 10))).toBe('sensitivity');
    expect(problem(() => boxPath(one, () => 1, 0))).toBe('years');
  });
});

describe('ice-albedo model', () => {
  const model: IceAlbedo = { s0: 1361, emissivity: 0.61, iceAlbedo: 0.62, warmAlbedo: 0.3, iceT: 250, warmT: 280 };

  it('has one root at the closed form when the albedo does not change', () => {
    const flat = { ...model, iceAlbedo: 0.3 };
    const roots = equilibria(flat, 1);
    expect(roots).toHaveLength(1);
    const closed = ((1361 * 0.7) / (4 * 0.61 * 5.670374419e-8)) ** 0.25;
    expect(roots[0].t).toBeCloseTo(closed, 6);
    expect(roots[0].stable).toBe(true);
  });

  it('has a warm and a frozen stable state today with an unstable one between, and tipping points either side', () => {
    const roots = equilibria(model, 1);
    expect(roots.map((r) => r.stable)).toEqual([true, false, true]);
    expect(roots[2].t).toBeCloseTo(((1361 * 0.7) / (4 * 0.61 * 5.670374419e-8)) ** 0.25, 6);
    const tips = tippingPoints(model);
    expect(tips.freeze).not.toBeNull();
    expect(tips.thaw).not.toBeNull();
    expect(tips.freeze!).toBeLessThan(1);
    expect(tips.thaw!).toBeGreaterThan(1);
  });

  it('names an ice range that runs backward', () => {
    expect(problem(() => equilibria({ ...model, warmT: 240 }, 1))).toBe('iceRange');
  });
});

describe('Budyko-Sellers', () => {
  const north = {
    s0: 1365,
    a: 210,
    b: 2,
    d: 0.555,
    warmAlbedo: 0.3,
    albedoP2: 0.25,
    iceAlbedo: 0.62,
    iceT: -10,
    s2: -0.48,
  };

  it('matches the two-mode solution T0 + T2 P2(x) when ice does not change the albedo', () => {
    const flat = budykoSellers(
      { ...north, s0: 1361, a: 203.3, b: 2.09, d: 0.649, warmAlbedo: 0.3, albedoP2: 0, iceAlbedo: 0.3, s2: -0.482 },
      'warm',
    );
    const q = 1361 / 4;
    const t0 = (q * 0.7 - 203.3) / 2.09;
    const t2 = (q * 0.7 * -0.482) / (2.09 + 6 * 0.649);
    flat.x.forEach((x, i) => expect(Math.abs(flat.t[i] - (t0 + (t2 * (3 * x * x - 1)) / 2))).toBeLessThan(0.01));
    expect(flat.mean).toBeCloseTo(t0, 2);
  });

  it('has an ice cap from a warm start and stays frozen from a frozen one', () => {
    const warm = budykoSellers(north, 'warm');
    expect(warm.iceLine).toBeGreaterThan(50);
    expect(warm.iceLine).toBeLessThan(90);
    expect(budykoSellers(north, 'cold').iceLine).toBe(0);
  });
});

describe('insolation', () => {
  const circular: Orbit = { s0: 1361, eccentricity: 0, obliquity: 23.44, perihelion: 102.9 };

  it('gives 493.623 W/m² at 65° N on the June solstice', () => {
    expect(Math.abs(dailyInsolation(65, 90, circular).q - 493.623)).toBeLessThan(1e-3);
  });

  it('gives S0 sin δ at the pole in polar day, S0/π at the equator at the equinox, and 0 in polar night', () => {
    expect(dailyInsolation(90, 90, circular).q).toBeCloseTo(1361 * Math.sin((23.44 * Math.PI) / 180), 6);
    expect(dailyInsolation(0, 0, circular).q).toBeCloseTo(1361 / Math.PI, 6);
    expect(dailyInsolation(80, 270, circular).q).toBe(0);
    expect(dailyInsolation(80, 270, circular).hourAngle).toBe(0);
  });

  it('puts the September equinox near 23 September for today’s orbit, as northern summer is longer', () => {
    const today = { ...circular, eccentricity: 0.0167 };
    let day = 80;
    while (solarLongitude(day, today) < 180) day += 0.05;
    expect(Math.abs(day - 266)).toBeLessThan(1.5);
    expect(solarLongitude(80, today)).toBeCloseTo(0, 6);
  });

  it('names an impossible latitude and eccentricity', () => {
    expect(problem(() => dailyInsolation(95, 0, circular))).toBe('latitude');
    expect(problem(() => dailyInsolation(0, 0, { ...circular, eccentricity: 0.9 }))).toBe('eccentricity');
  });
});

describe('classification', () => {
  const csa: Normals = {
    t: [12, 13, 15, 17, 20, 24, 27, 27, 25, 21, 16, 13],
    p: [100, 90, 70, 40, 15, 3, 1, 2, 10, 40, 70, 90],
    south: false,
  };

  it('classifies the planning case as Csa: not arid, dry summer, hottest month 27 °C', () => {
    const k = koppen(csa);
    expect(k.code).toBe('Csa');
    expect(k.map).toBe(531);
    expect(k.threshold).toBeCloseTo(38.333, 3);
    expect(k.tests.find((x) => x.rule === 'arid')?.held).toBe(false);
  });

  it('gives Af, BWh, ET, and Dfc for their textbook climates', () => {
    const wet = { t: Array(12).fill(27), p: Array(12).fill(180), south: false };
    expect(koppen(wet).code).toBe('Af');
    expect(koppen({ t: Array(12).fill(28), p: Array(12).fill(2), south: false }).code).toBe('BWh');
    expect(
      koppen({ t: [-20, -18, -14, -8, -2, 3, 6, 5, 1, -5, -12, -17], p: Array(12).fill(30), south: false }).code,
    ).toBe('ET');
    const boreal = [-20, -17, -10, 0, 7, 13, 16, 14, 8, 0, -9, -17];
    expect(koppen({ t: boreal, p: [30, 25, 25, 30, 45, 60, 75, 70, 55, 45, 40, 35], south: false }).code).toBe('Dfc');
  });

  it('flips summer for the southern hemisphere', () => {
    const shifted = { t: [...csa.t.slice(6), ...csa.t.slice(0, 6)], p: [...csa.p.slice(6), ...csa.p.slice(0, 6)] };
    expect(koppen({ ...shifted, south: true }).code).toBe('Csa');
  });

  it('names a year with 11 months and negative rain', () => {
    expect(problem(() => koppen({ ...csa, t: csa.t.slice(1) }))).toBe('twelve');
    expect(problem(() => koppen({ ...csa, p: [-1, ...csa.p.slice(1)] }))).toBe('monthPrecipitation');
  });

  it('places the Holdridge hexagons: cool temperate moist forest and tropical moist forest', () => {
    const cool = holdridge(8.5, 700);
    expect([cool.belt, cool.zone, cool.province]).toEqual(['coolTemperate', 'moistForest', 'humid']);
    const tropical = holdridge(26, 2800);
    expect([tropical.belt, tropical.zone]).toEqual(['tropical', 'moistForest']);
    expect(holdridge(26, 100).zone).toBe('desert');
    expect(holdridge(1, 300).zone).toBe('polarDesert');
    expect(biotemperature([-5, 10, 35, 20])).toBe(7.5);
    expect(problem(() => holdridge(10, 0))).toBe('annualPrecipitation');
  });
});

describe('water balance and degree days', () => {
  it('gives heat index 97.8814, a 2.14075, and PET 73.8683 mm with every month at 20 °C', () => {
    const t = Array(12).fill(20);
    const i = heatIndex(t);
    expect(printed(i, '97.8814')).toBe(true);
    const a = exponentA(i);
    expect(printed(a, '2.14075')).toBe(true);
    expect(printed(petUnadjusted(20, i, a), '73.8683')).toBe(true);
  });

  it('balances water: P = AET + surplus over a repeating year, and deficits only where PET exceeds AET', () => {
    const t = [5, 6, 9, 12, 16, 20, 23, 22, 18, 13, 8, 5];
    const p = [90, 80, 70, 60, 50, 30, 10, 20, 40, 70, 90, 100];
    const out = waterBalance(t, p, 40, 100);
    expect(Math.abs(out.totals.p - out.totals.aet - out.totals.surplus)).toBeLessThan(1e-6);
    expect(out.totals.deficit).toBeGreaterThan(0);
    out.months.forEach((m) => expect(m.aet).toBeLessThanOrEqual(m.pet + 1e-9));
    expect(problem(() => waterBalance(Array(12).fill(-5), p, 40, 100))).toBe('allFrozen');
  });

  it('gives HDD 11 and CDD 9 at base 18 °C for 10, 15, 20, and 25 °C', () => {
    expect(degreeDays([10, 15, 20, 25], 18)).toEqual({ heating: 11, cooling: 9 });
    expect(problem(() => degreeDays([], 18))).toBe('noDays');
  });
});

describe('footprints', () => {
  it('gives 400 kg CO2e for 1000 kWh at 0.4 kg/kWh, and tallies scopes', () => {
    const out = footprint(readActivities('1000, 0.4, 2, electricity kWh\n20, 8.78, 1, gasoline gal'));
    expect(out.lines[0].kg).toBe(400);
    expect(out.scopes[1]).toBe(400);
    expect(out.scopes[0]).toBeCloseTo(175.6, 9);
    expect(out.total).toBeCloseTo(575.6, 9);
    expect(out.lines[0].activity.label).toBe('electricity kWh');
  });

  it('names a fourth scope, a negative amount, and an empty list', () => {
    expect(problem(() => readActivities('10, 1, 4'))).toBe('scope');
    expect(problem(() => readActivities('-1, 1, 1'))).toBe('amount');
    expect(problem(() => readActivities(''))).toBe('rowsNone');
    expect(problem(() => readActivities('10, x, 1'))).toBe('rowNumber');
  });
});
