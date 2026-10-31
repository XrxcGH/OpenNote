import { describe, expect, it } from 'vitest';
import { PhysicsError } from '../shared/errors';
import {
  airmass,
  calendar,
  equatorialToGalactic,
  gmst,
  horizontal,
  julianDate,
  moon,
  parseDate,
  parseTime,
  precess,
  sun,
} from './astro';
import { dayLength, hms, riseSet, shadow, sunCalc, sunPath, timeCalc } from './engine';

const item = (calc: { items: readonly { key: string; value: number }[] }, key: string) =>
  calc.items.find((one) => one.key === key)!.value;
const site = { date: [2000, 1, 1] as const, time: 12, zone: 0, lat: 0, lon: 0 };

describe('time', () => {
  it('gives JD 2451545.0 and GMST 18.697374558 h at 2000-01-01 12:00', () => {
    expect(julianDate(2000, 1, 1, 12)).toBe(2451545);
    expect(Math.abs(gmst(2451545) - 18.697374558)).toBeLessThan(1e-9);
    expect(item(timeCalc(site), 'mjd')).toBe(51544.5);
  });

  it('shows the Julian Date as a day count with a decimal day, not a power of ten', () => {
    const text = (calc: { items: readonly { key: string; text?: string }[] }) =>
      calc.items.find((one) => one.key === 'jd')!.text;
    expect(text(timeCalc(site))).toBe('2451545.00000');
    // Meeus example 7.a: 1957 October 4.81 is JD 2436116.31.
    expect(text(timeCalc({ ...site, date: [1957, 10, 4], time: 0.81 * 24 }))).toBe('2436116.31000');
  });

  it('matches Meeus for 1957 October 4.81 and 1987 June 19.5, and turns back into a date', () => {
    expect(julianDate(1957, 10, 4, 0.81 * 24)).toBeCloseTo(2436116.31, 6);
    expect(julianDate(1987, 6, 19, 12)).toBe(2446966);
    const back = calendar(2436116.31);
    expect([back.y, back.m, back.d]).toEqual([1957, 10, 4]);
    expect(back.hours).toBeCloseTo(0.81 * 24, 6);
  });

  it('reads dates and times and refuses impossible ones', () => {
    expect(parseDate('2024-02-29')).toEqual([2024, 2, 29]);
    expect(parseTime('06:30:30')).toBeCloseTo(6.508333333, 8);
    expect(() => parseDate('2023-02-29')).toThrow(PhysicsError);
    expect(() => parseDate('tomorrow')).toThrow(PhysicsError);
    expect(() => parseTime('25:00')).toThrow(PhysicsError);
    expect(hms(18.5)).toBe('18h 30m 00s');
  });
});

describe('the Sun and Moon', () => {
  it('gives RA 18.7523 h and Dec −23.0335° for the Sun at 2000-01-01 12:00 UT', () => {
    const p = sun(2451545);
    expect(Math.abs(p.ra - 18.7523)).toBeLessThan(1e-4);
    expect(Math.abs(p.dec - -23.0335)).toBeLessThan(1e-4);
    expect(p.distance).toBeCloseTo(0.98333, 3);
  });

  it('puts the Moon full on the night of the January 2000 lunar eclipse and at a lunar distance', () => {
    const m = moon(julianDate(2000, 1, 21, 4.7));
    const s = sun(julianDate(2000, 1, 21, 4.7));
    const elongation = Math.abs(((m.lambda - s.lambda + 540) % 360) - 180);
    expect(elongation).toBeGreaterThan(178);
    expect(m.distance).toBeGreaterThan(55);
    expect(m.distance).toBeLessThan(64);
  });
});

describe('coordinates', () => {
  it('puts Dec +20° at altitude 70° and azimuth 180° on the meridian at latitude 40° N', () => {
    const h = horizontal(0, 20, 40);
    expect(Math.abs(h.alt - 70)).toBeLessThan(1e-9);
    expect(Math.abs(h.az - 180)).toBeLessThan(1e-9);
    expect(horizontal(6, 0, 0).az).toBeCloseTo(270, 9);
  });

  it('gives an airmass of 2.0 at altitude 30°', () => {
    expect(Math.abs(airmass(30) - 2)).toBeLessThan(1e-6);
    expect(airmass(-1)).toBe(Infinity);
  });

  it('puts the galactic center near l = 0, b = 0 and the galactic pole at b = 90°', () => {
    const center = equatorialToGalactic({ ra: 17 + 45 / 60 + 37.2 / 3600, dec: -(28 + 56 / 60 + 10 / 3600) });
    expect(Math.min(center.l, 360 - center.l)).toBeLessThan(0.01);
    expect(Math.abs(center.b)).toBeLessThan(0.05);
    expect(equatorialToGalactic({ ra: 192.85948 / 15, dec: 27.12825 }).b).toBeCloseTo(90, 9);
  });

  it('precesses a point on the equator by the IAU 1976 rates over a century', () => {
    const p = precess({ ra: 0, dec: 0 }, 2451545 + 36525);
    expect(p.dec).toBeCloseTo(2004.3109 / 3600, 3);
    expect(p.ra * 15).toBeCloseTo((2306.2181 * 2) / 3600, 2);
    expect(precess({ ra: 5, dec: 30 }, 2451545)).toMatchObject({
      ra: expect.closeTo(5, 12),
      dec: expect.closeTo(30, 12),
    });
  });
});

describe('rising, setting, and sun paths', () => {
  it('gives a day of 15.015 h at 40° N with declination 23.44° and h0 −0.833°', () => {
    expect(Math.abs(dayLength(40, 23.44, -0.833) - 15.015)).toBeLessThan(1e-3);
    expect(dayLength(80, 23.44, -0.833)).toBe(24);
    expect(dayLength(-80, 23.44, -0.833)).toBe(0);
  });

  it('gives the noon altitude 79.39° at 34.05° N on the June solstice', () => {
    expect(Math.abs(item(sunPath(34.05, false), 'noonJune') - 79.39)).toBeLessThan(1e-6);
    expect(sunPath(34.05, true).plot!.series.length).toBeGreaterThan(3);
  });

  it('gives an equinox day a little over 12 h on the equator and refuses the midnight sun', () => {
    const calc = riseSet({ ...site, date: [2000, 3, 20] }, null);
    expect(item(calc, 'dayLength')).toBeGreaterThan(12.05);
    expect(item(calc, 'dayLength')).toBeLessThan(12.2);
    expect(Math.abs(item(calc, 'transit') - 12)).toBeLessThan(0.2);
    expect(() => riseSet({ ...site, date: [2000, 6, 21], lat: 80 }, null)).toThrow(PhysicsError);
    expect(() => riseSet({ ...site, lat: 80 }, { ra: 0, dec: 85 })).toThrow(PhysicsError);
  });
});

describe('shadows', () => {
  it('casts a shadow as long as the pole at 45° and sizes an overhang from the profile angle', () => {
    expect(item(shadow(45, 180, 2, 180, 1.5), 'shadow')).toBeCloseTo(2, 12);
    expect(item(shadow(60, 180, 1, 180, 1.5), 'overhang')).toBeCloseTo(1.5 / Math.tan(Math.PI / 3), 12);
    expect(() => shadow(-5, 180, 1, 180, 1)).toThrow(PhysicsError);
    expect(item(sunCalc({ ...site, lat: 51.4769 }), 'alt')).toBeLessThan(20);
  });
});
