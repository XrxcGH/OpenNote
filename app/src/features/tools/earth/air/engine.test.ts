// Air quality and weather reports: each planning case checks the engine against a value worked out independently
// (by hand from the published breakpoints and formulas, or the planning pass's computation), then edge cases.
import { describe, expect, it } from 'vitest';
import { Problem } from '../core/problem';
import { rel } from '../core/testing';
import { decodeMetar, decodeTaf, skyEighths } from './metar';
import {
  MOLAR_MASS,
  aqi,
  box,
  buoyancyFlux,
  groundMaximum,
  molarVolume,
  plume,
  plumeRise,
  ppmToUg,
  rainRate,
  sigmas,
  stabilityClass,
  ugToPpm,
} from './quality';

const problem = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof Problem ? error.code : 'other';
  }
  return null;
};

describe('air quality index', () => {
  it('gives 71 for PM2.5 at 20.0 µg/m³ and 84 for 8-hour ozone at 0.065 ppm, both moderate', () => {
    // By hand: 49/26.3 × 10.9 + 51 = 71.31; 49/0.015 × 0.010 + 51 = 83.67.
    expect(aqi('pm25', 20.0)).toMatchObject({ index: 71, category: 'moderate' });
    expect(aqi('o3_8', 0.065)).toMatchObject({ index: 84, category: 'moderate' });
  });

  it('truncates before looking up, so PM2.5 9.08 reads as 9.0 and stays good', () => {
    expect(aqi('pm25', 9.08)).toMatchObject({ index: 50, truncated: 9, category: 'good' });
    expect(aqi('pm25', 0).index).toBe(0);
    expect(aqi('pm25', 325.4).index).toBe(500);
    expect(aqi('pm10', 155).index).toBe(101);
  });

  it('names a negative value, one beyond the table, and ozone outside its averaging table', () => {
    expect(problem(() => aqi('pm25', -1))).toBe('concentration');
    expect(problem(() => aqi('pm25', 400))).toBe('beyond');
    expect(problem(() => aqi('o3_8', 0.25))).toBe('ozoneHigh');
    expect(problem(() => aqi('o3_1', 0.1))).toBe('ozoneLow');
  });
});

describe('plume', () => {
  it('gives 1058.28 µg/m³ on the ground under the centerline', () => {
    expect(rel(plume(100, 5, 50, 30, 50) * 1e6, 1058.28)).toBeLessThan(1e-5);
  });

  it('gives the Briggs open-country class D sigmas at 1 km', () => {
    const s = sigmas('D', 1000);
    expect(Math.abs(s.sy - 76.277)).toBeLessThan(5e-4);
    expect(Math.abs(s.sz - 37.9473)).toBeLessThan(5e-5);
  });

  it('doubles a ground-level source by reflection and falls off sideways as a normal curve', () => {
    const centered = plume(1, 1, 10, 10, 0);
    expect(rel(centered, 1 / (Math.PI * 100))).toBeLessThan(1e-12);
    expect(rel(plume(1, 1, 10, 10, 0, 10), centered * Math.exp(-0.5))).toBeLessThan(1e-12);
  });

  it('reads the Turner stability table', () => {
    expect(stabilityClass(1, 'strong')).toBe('A');
    expect(stabilityClass(4, 'slight')).toBe('C');
    expect(stabilityClass(4, 'nightClear')).toBe('E');
    expect(stabilityClass(10, 'overcast')).toBe('D');
  });

  it('finds the ground maximum where σz is near H/√2 and grows plume rise as x^(2/3)', () => {
    const max = groundMaximum(100, 5, 50, 'C', false);
    const s = sigmas('C', max.x);
    // For σy ∝ σz the maximum falls where σz = H/√2; Briggs C is close to proportional at these distances.
    expect(Math.abs(s.sz - 50 / Math.SQRT2) / (50 / Math.SQRT2)).toBeLessThan(0.05);
    const f = buoyancyFlux(10, 2, 400, 290);
    expect(rel(f, (9.80665 * 10 * 4 * 110) / 1600)).toBeLessThan(1e-12);
    const r1 = plumeRise(f, 5, 40).rise;
    expect(rel(plumeRise(f, 5, 320).rise, r1 * 4)).toBeLessThan(1e-9);
    expect(plumeRise(f, 5, 5000).rise).toBe(plumeRise(f, 5, 1e5).rise);
  });

  it('names a calm wind and a zero distance', () => {
    expect(problem(() => plume(100, 0, 50, 30, 50))).toBe('wind');
    expect(problem(() => sigmas('D', 0))).toBe('distance');
  });
});

describe('conversions, boxes, and radar', () => {
  it('gives 2620.29 µg/m³ for 1 ppm SO2 at 25 °C and 1 atm, and back', () => {
    const vm = molarVolume(298.15, 101325);
    expect(rel(ppmToUg(1, MOLAR_MASS.so2, vm), 2620.29)).toBeLessThan(1e-5);
    expect(rel(ugToPpm(2620.29, MOLAR_MASS.so2, vm), 1)).toBeLessThan(1e-5);
    expect(problem(() => molarVolume(0, 101325))).toBe('temperature');
  });

  it('gives 11.5307 mm/h at 40 dBZ by Marshall-Palmer', () => {
    expect(Math.abs(rainRate(40, 200, 1.6).rate - 11.5307)).toBeLessThan(5e-5);
    expect(problem(() => rainRate(40, 0, 1.6))).toBe('zr');
  });

  it('reaches the steady state of a flushed box with loss, from a hand balance', () => {
    // E/(LWH) = 1e-3/1e9 per s; u/L = 1e-3; k = 1e-3; so C_ss = (1e-12 + 1e-3 × 2e-9)/2e-3 = 1.0005e-6.
    const b = box(1e-3, 1e4, 1e3, 100, 10, 2e-9, 1e-3, 0);
    expect(rel(b.steady, (1e-12 + 1e-3 * 2e-9) / 2e-3)).toBeLessThan(1e-12);
    expect(rel(b.at(b.tau), b.steady * (1 - Math.exp(-1)))).toBeLessThan(1e-12);
    expect(problem(() => box(1, 1, 1, 1, 0, 0, 0, 0))).toBe('boxFlush');
  });
});

describe('weather reports', () => {
  const metar = decodeMetar('KORD 231751Z 25012G20KT 10SM FEW020 SCT250 22/14 A2992 RMK AO2 SLP132 T02220139');

  it('decodes the planning report', () => {
    expect(metar.station).toBe('KORD');
    expect(metar.wind).toEqual({ direction: 250, speed: 12, gust: 20, unit: 'KT' });
    expect(metar.visibility).toEqual({ value: 10 });
    expect(metar.clouds).toEqual([
      { cover: 'FEW', base: 2000 },
      { cover: 'SCT', base: 25000 },
    ]);
    expect([metar.temperature, metar.dewPoint]).toEqual([22, 14]);
    expect(metar.altimeter).toEqual({ value: 29.92, unit: 'inHg' });
    expect(metar.remarks.station).toBe('AO2');
    expect(metar.remarks.seaLevel).toBeCloseTo(1013.2, 9);
    expect(metar.remarks.precise).toEqual({ temperature: 22.2, dewPoint: 13.9 });
    expect(metar.unknown).toEqual([]);
    expect(skyEighths(metar.clouds)).toBe(4);
  });

  it('reads fractions, below-zero temperatures, weather, and SLP in the 900s', () => {
    const m = decodeMetar('METAR KDEN 021553Z VRB03KT 1 1/2SM -SN BR OVC008 M05/M07 A3012 RMK AO2 SLP985 T10501072');
    expect(m.wind?.direction).toBeNull();
    expect(m.visibility).toEqual({ value: 1.5 });
    expect(m.weather.map((w) => [w.intensity, w.phenomena.join('')])).toEqual([
      ['light', 'SN'],
      ['moderate', 'BR'],
    ]);
    expect([m.temperature, m.dewPoint]).toEqual([-5, -7]);
    expect(m.remarks.seaLevel).toBeCloseTo(998.5, 9);
    expect(m.remarks.precise).toEqual({ temperature: -5, dewPoint: -7.2 });
    expect(decodeMetar('EGLL 011200Z 9999 TSRA VCSH').weather.map((w) => w.descriptor)).toEqual(['TS', 'SH']);
  });

  it('keeps groups it cannot read instead of guessing, and reads an empty report as empty', () => {
    expect(decodeMetar('KXYZ 011200Z 27010KT ZZZZ 10SM').unknown).toEqual(['ZZZZ']);
    expect(decodeMetar('').station).toBe('');
  });

  it('splits a TAF into its periods', () => {
    const taf = decodeTaf(
      'TAF KJFK 251130Z 2512/2618 31010KT P6SM SCT035 FM251800 33015G25KT P6SM BKN040 TEMPO 2520/2524 3SM -SHRA BKN025 PROB30 2602/2606 1SM BR',
    );
    expect(taf.station).toBe('KJFK');
    expect([taf.validFrom, taf.validTo]).toEqual(['2512', '2618']);
    expect(taf.periods.map((p) => p.change)).toEqual(['BASE', 'FM', 'TEMPO', 'PROB']);
    expect(taf.periods[1].wind).toMatchObject({ direction: 330, speed: 15, gust: 25 });
    expect(taf.periods[0].visibility).toEqual({ value: 6, bound: 'more' });
    expect(taf.periods[3].probability).toBe(30);
    expect(taf.unknown).toEqual([]);
  });
});
