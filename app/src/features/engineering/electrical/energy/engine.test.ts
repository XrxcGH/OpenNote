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
  julianDay,
  lcoe,
  meanCube,
  noaaSun,
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

describe('NOAA solar position', () => {
  const noon = (year: number, month: number, day: number, lat = 0, lon = 0) =>
    noaaSun({ year, month, day, clock: 12, zone: 0, latitude: lat, longitude: lon });
  it('the Julian day of 2000-01-01 12:00 UT is 2451545.0', () => {
    expect(julianDay(2000, 1, 1, 12)).toBe(2451545);
    expect(julianDay(2024, 3, 20, 0)).toBe(2460389.5);
  });
  it('the equation of time matches the almanac: +16.4 min on 3 November, -14.2 min on 11 February', () => {
    expect(Math.abs(noon(2023, 11, 3).equationOfTime - 16.4)).toBeLessThan(0.15);
    expect(Math.abs(noon(2023, 2, 11).equationOfTime + 14.2)).toBeLessThan(0.15);
  });
  it('the declination is +23.44 degrees at the June solstice and zero at the March equinox', () => {
    expect(Math.abs(noon(2023, 6, 21).declination - 23.44)).toBeLessThan(0.02);
    const equinox = noaaSun({ year: 2024, month: 3, day: 20, clock: 3 + 6 / 60, zone: 0, latitude: 0, longitude: 0 });
    expect(Math.abs(equinox.declination)).toBeLessThan(0.02);
  });
  it('at solar noon the hour angle is zero and the altitude is 90 - latitude + declination', () => {
    const lat = 51.4779;
    const first = noon(2023, 6, 21, lat, 0);
    const at = noaaSun({
      year: 2023,
      month: 6,
      day: 21,
      clock: first.solarNoon / 60,
      zone: 0,
      latitude: lat,
      longitude: 0,
    });
    expect(Math.abs(at.hourAngle)).toBeLessThan(0.01);
    const sun = sunPosition(lat, at.declination, at.hourAngle);
    expect(Math.abs(sun.altitude - (90 - lat + at.declination))).toBeLessThan(1e-9);
    expect(Math.abs(sun.altitude - 61.96)).toBeLessThan(0.02);
  });
  it('Greenwich on the June solstice: sunrise about 03:43 UT and sunset about 20:21 UT', () => {
    const r = noon(2023, 6, 21, 51.4779, 0);
    expect(Math.abs(r.sunrise! - (3 * 60 + 43))).toBeLessThan(2);
    expect(Math.abs(r.sunset! - (20 * 60 + 21))).toBeLessThan(2);
  });
  it('time zone and longitude move the solar time: 84 W in zone -5 at 12:00 clock is near solar noon in June', () => {
    const r = noaaSun({ year: 2024, month: 6, day: 20, clock: 12, zone: -5, latitude: 34, longitude: -84 });
    // 4 min per degree: (-84 + 75) = 9 degrees west of the zone meridian, plus the equation of time (about -1.5 min).
    expect(Math.abs(r.solarTime - (720 - 36 + r.equationOfTime))).toBeLessThan(1e-9);
  });
  it('the energy form takes a NOAA date and clock time, and US units give the SI answer', () => {
    const base = initialValues(spec);
    const sun = runTool(spec, { ...base, mode: 'solar', method: 'noaa' });
    expect(sun.ok && sun.answer).toContain('2024-06-20');
    expect(runTool(spec, { ...base, mode: 'solar', method: 'noaa', date: 'June 20' }).ok).toBe(false);
    const si = runTool(spec, { ...base, mode: 'wind', speed: '8', rho: '1.225', dia: '80' });
    const us = runTool(spec, {
      ...base,
      mode: 'wind',
      units: 'us',
      speed: String(8 / 0.44704),
      rho: String(1.225 / 16.018463),
      dia: String(80 / 0.3048),
    });
    expect(us.ok && si.ok && us.answer).toBe(si.ok && si.answer);
  });
});
