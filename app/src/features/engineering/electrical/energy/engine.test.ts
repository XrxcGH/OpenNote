import { describe, expect, it } from 'vitest';
import { initialValues, runTool } from '../spec';
import {
  BETZ,
  FUELS,
  capacityFactor,
  capitalRecovery,
  co2PerOutputKwh,
  convertEnergy,
  cosIncidence,
  declination,
  exceedance,
  gamma,
  lcoe,
  meanCube,
  pvOutput,
  sunPosition,
  sunriseHourAngle,
  turbinePower,
  weibullFromMean,
  windPowerDensity,
} from './engine';
import { spec } from './tool';

const close = (a: number, b: number, rel: number) => expect(Math.abs(a - b)).toBeLessThanOrEqual(rel * Math.abs(b));

describe('wind', () => {
  it('8 m/s at 1.225 kg/m³: 313.6 W/m², and 185.84 W/m² at the Betz limit', () => {
    close(windPowerDensity(8, 1.225), 313.6, 1e-6);
    close(windPowerDensity(8, 1.225) * BETZ, 185.84, 1e-4);
  });
  it('an 80 m rotor at Cp 0.45 and 10 m/s gives 1.3854 MW', () => {
    close(turbinePower(80, 0.45, 10, 1.225), 1.3854e6, 1e-4);
  });
  it('refuses a power coefficient above the Betz limit', () => {
    expect(() => turbinePower(80, 0.7, 10, 1.225)).toThrow();
  });
  it('the gamma function matches known values', () => {
    close(gamma(0.5), Math.sqrt(Math.PI), 1e-13);
    close(gamma(5), 24, 1e-13);
    close(gamma(1.5), Math.sqrt(Math.PI) / 2, 1e-13);
  });
  it('Rayleigh wind, mean 7 m/s: the chance of more than 12 m/s is 0.099449', () => {
    const w = weibullFromMean(7, 2);
    close(exceedance(w, 12), 0.099449, 1e-4);
    // Independent form: exp(−π/4 (v/mean)²).
    close(exceedance(w, 12), Math.exp(-(Math.PI / 4) * (12 / 7) ** 2), 1e-12);
    // The mean of v³ of a Rayleigh wind is 6 / π times the cube of the mean.
    close(meanCube(w), (6 / Math.PI) * 7 ** 3, 1e-12);
  });
  it('the capacity factor matches a fine brute-force integral', () => {
    const w = weibullFromMean(7, 2);
    const curve = { cutIn: 3, rated: 12, cutOut: 25 };
    let brute = 0;
    const n = 400000;
    const dv = 30 / n;
    for (let i = 0; i < n; i++) {
      const v = (i + 0.5) * dv;
      const p = v < curve.cutIn || v > curve.cutOut ? 0 : v >= curve.rated ? 1 : (v ** 3 - 27) / (12 ** 3 - 27);
      const pdf = ((v * 2 * Math.PI) / (4 * 7 ** 2)) * Math.exp(-(Math.PI / 4) * (v / 7) ** 2);
      brute += p * pdf * dv;
    }
    close(capacityFactor(w, curve), brute, 1e-5);
  });
  it('refuses a power curve whose speeds are out of order', () => {
    expect(() => capacityFactor(weibullFromMean(7, 2), { cutIn: 13, rated: 12, cutOut: 25 })).toThrow();
  });
});

describe('solar geometry', () => {
  it('day 172 at 34° N: declination 23.450° and noon altitude 79.450°', () => {
    const decl = declination(172);
    expect(Math.abs(decl - 23.45)).toBeLessThan(1e-3);
    const noon = sunPosition(34, decl, 0);
    expect(Math.abs(noon.altitude - 79.45)).toBeLessThan(1e-3);
    expect(Math.abs(noon.azimuth)).toBeLessThan(1e-3);
  });
  it('equinox at the equator has a 12 hour day, and polar day and night are named', () => {
    expect(sunriseHourAngle(0, 0)).toBeCloseTo(90, 9);
    expect(sunriseHourAngle(80, 23.45)).toBe('up');
    expect(sunriseHourAngle(80, -23.45)).toBe('down');
  });
  it('a flat surface sees the sun at the zenith angle, and a surface tilted to the latitude faces an equinox sun', () => {
    const sun = sunPosition(40, 12, 30);
    close(cosIncidence(40, 12, 30, 0, 0), Math.sin((sun.altitude * Math.PI) / 180), 1e-12);
    close(cosIncidence(40, 0, 0, 40, 0), 1, 1e-12);
  });
  it('the sun is east in the morning and west in the afternoon', () => {
    expect(sunPosition(34, 10, -45).azimuth).toBeLessThan(0);
    expect(sunPosition(34, 10, 45).azimuth).toBeGreaterThan(0);
  });
});

describe('photovoltaics', () => {
  it('a cell hotter than 25 °C loses output, linearly', () => {
    const r = pvOutput(1000, 20, 0.2, 25, 45, 0.004);
    close(r.cellTemperature, 25 + (25 * 1000) / 800, 1e-12);
    close(r.nominal, 4000, 1e-12);
    close(r.power, 4000 * (1 - 0.004 * (r.cellTemperature - 25)), 1e-12);
  });
  it('refuses an efficiency above 1', () => {
    expect(() => pvOutput(1000, 20, 1.2, 25, 45, 0.004)).toThrow();
  });
});

describe('emissions, cost, and units', () => {
  it('a methane plant at 50 % efficiency emits 0.39495 kg CO₂ per kWh', () => {
    close(co2PerOutputKwh(FUELS.methane!, 0.5), 0.39495, 1e-4);
    // Independent: 44.01 / 16.043 kg CO₂ per kg of methane, 50.01 MJ/kg lower heating value.
    close(co2PerOutputKwh(FUELS.methane!, 0.5), ((44.009 / 16.043) * 3.6) / (802.3 / 16.043) / 0.5, 1e-9);
  });
  it('LCOE: 1000 $/kW, 7 %, 20 years, capacity factor 0.35: CRF 0.094393 and 0.030787 $/kWh', () => {
    close(capitalRecovery(0.07, 20), 0.094393, 1e-5);
    close(lcoe(1000, 0.07, 20, 0.35, 0, 0).value, 0.030787, 1e-5);
    close(lcoe(1000, 0.07, 20, 0.35, 0, 0).value, (1000 * capitalRecovery(0.07, 20)) / (8760 * 0.35), 1e-12);
  });
  it('a zero discount rate spreads the cost evenly; a negative one is refused', () => {
    close(capitalRecovery(0, 25), 0.04, 1e-12);
    expect(() => capitalRecovery(-0.01, 20)).toThrow();
    expect(() => lcoe(1000, 0.07, 20, 0, 0, 0)).toThrow();
  });
  it('converts energy units', () => {
    const all = convertEnergy(1, 'kWh');
    close(all.MJ!, 3.6, 1e-12);
    close(all.BTU!, 3412.14, 1e-5);
    close(all.kcal!, 860.4207, 1e-6);
    expect(() => convertEnergy(1, 'bogus')).toThrow();
  });
});

describe('the energy form', () => {
  it('opens on the wind example and every mode answers', () => {
    const values = initialValues(spec);
    const first = runTool(spec, values);
    expect(first.ok && first.rows.length).toBeGreaterThan(0);
    for (const mode of ['windStats', 'solar', 'pv', 'emissions', 'lcoe', 'convert']) {
      expect(runTool(spec, { ...values, mode }).ok, mode).toBe(true);
    }
    expect(runTool(spec, { ...values, speed: '-4' }).ok).toBe(false);
    expect(runTool(spec, { ...values, speed: '1e9' }).ok).toBe(true);
    expect(runTool(spec, { ...values, mode: 'solar', day: '400' }).ok).toBe(false);
  });
});
