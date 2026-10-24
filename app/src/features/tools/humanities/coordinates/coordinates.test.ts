import { describe, expect, it } from 'vitest';
import { GeoError, GRS80 } from '../geo/ellipsoid';
import { formatDm, formatDms, parseAngle, toDms } from './dms';
import { fitHelmert, mapToSite, siteToMap } from './helmert';
import {
  backAzimuth,
  chartDistance,
  courseToSteer,
  deadReckon,
  groundTrack,
  intersect,
  paceDistance,
  resect,
  timeSpeedDistance,
  trueToMagnetic,
} from './nav';
import { band, fromUtm, parseMgrs, toMgrs, toUtm, utmZone } from './utm';
import { zoneForward, zoneInverse } from './zones';
import type { LambertZone } from './zones';

describe('degrees, minutes and seconds', () => {
  it('writes 40.446 degrees as 40 26 45.6', () => {
    expect(toDms(40.446)).toEqual({ negative: false, degrees: 40, minutes: 26, seconds: 45.6 });
    expect(formatDms(40.446, 1, 'lat')).toBe('40° 26′ 45.6″ N');
  });

  it('carries 59.99 seconds up instead of showing 60', () => {
    expect(formatDms(10 + 59 / 60 + 59.99 / 3600, 1)).toBe('11° 0′ 0.0″');
    expect(formatDm(-73.5, 2, 'lon')).toBe('73° 30.00′ W');
  });

  it('reads the common ways of typing an angle', () => {
    expect(parseAngle('40 26 45.6 N', 'lat')).toBeCloseTo(40.446, 12);
    expect(parseAngle(`40°26'45.6"S`, 'lat')).toBeCloseTo(-40.446, 12);
    expect(parseAngle('W 73 30', 'lon')).toBeCloseTo(-73.5, 12);
    expect(parseAngle('40d 26m 45.6s', 'lat')).toBeCloseTo(40.446, 12);
    expect(parseAngle('-12.5', 'lon')).toBe(-12.5);
  });

  it('says what is wrong with an angle it cannot read', () => {
    expect(() => parseAngle('', 'lat')).toThrow('empty');
    expect(() => parseAngle('95', 'lat')).toThrow('latitude');
    expect(() => parseAngle('40 75 0', 'lat')).toThrow('minutesRange');
    expect(() => parseAngle('40 E', 'lat')).toThrow('hemisphere');
    expect(() => parseAngle('forty', 'lat')).toThrow(GeoError);
  });
});

describe('UTM and MGRS', () => {
  it('converts the equator at 3 E and 40 N 75 W', () => {
    const a = toUtm(0, 3);
    expect([a.zone, a.hemisphere]).toEqual([31, 'N']);
    expect(a.easting).toBeCloseTo(500000, 6);
    expect(a.northing).toBeCloseTo(0, 6);
    const b = toUtm(40, -75);
    expect(`${b.zone}${b.band}`).toBe('18T');
    expect(b.easting).toBeCloseTo(500000, 6);
    expect(Math.abs(b.northing - 4427757.219)).toBeLessThan(1e-3);
  });

  it('applies the Norway and Svalbard zone exceptions', () => {
    expect(utmZone(60, 5)).toBe(32);
    expect(utmZone(60, 2)).toBe(31);
    expect(utmZone(78, 15)).toBe(33);
    expect(utmZone(78, 8)).toBe(31);
    expect(band(84)).toBe('X');
    expect(() => band(85)).toThrow('polar');
  });

  it('round-trips UTM in the southern hemisphere', () => {
    const utm = toUtm(-33.8688, 151.2093);
    expect(utm.hemisphere).toBe('S');
    const back = fromUtm(utm.zone, utm.hemisphere, utm.easting, utm.northing);
    expect(back.lat).toBeCloseTo(-33.8688, 9);
    expect(back.lon).toBeCloseTo(151.2093, 9);
  });

  it('writes MGRS square letters by the NGA rules and reads them back', () => {
    expect(toMgrs(40, -75)).toBe('18T WK 00000 27757');
    for (const [lat, lon] of [
      [40, -75],
      [-33.8688, 151.2093],
      [51.4778, -0.0014],
      [64.1466, -21.9426],
      [-54.8, -68.3],
    ]) {
      const ref = toMgrs(lat, lon);
      const read = parseMgrs(ref);
      const utm = toUtm(lat, lon);
      expect(read.easting).toBe(Math.floor(utm.easting));
      expect(read.northing).toBe(Math.floor(utm.northing));
    }
  });

  it('rejects a reference it cannot read', () => {
    expect(() => parseMgrs('18T WK 123')).toThrow('mgrsFormat');
    expect(() => parseMgrs('hello')).toThrow('mgrsFormat');
  });
});

describe('grid zones by parameters', () => {
  const zone: LambertZone = {
    kind: 'lambert',
    lat1: 34 + 2 / 60,
    lat2: 35 + 28 / 60,
    lat0: 33.5,
    lon0: -118,
    falseEasting: 2000000,
    falseNorthing: 500000,
  };

  it('keeps true scale on both standard parallels and the origin at the false origin', () => {
    expect(zoneForward(zone, zone.lat1, -117).scale).toBeCloseTo(1, 12);
    expect(zoneForward(zone, zone.lat2, -119).scale).toBeCloseTo(1, 12);
    const origin = zoneForward(zone, 33.5, -118);
    expect(origin.easting).toBeCloseTo(2000000, 6);
    expect(origin.northing).toBeCloseTo(500000, 6);
  });

  it('round-trips Lambert and transverse Mercator zones', () => {
    const point = zoneForward(zone, 34.2, -118.4);
    const back = zoneInverse(zone, point.easting, point.northing);
    expect(back.lat).toBeCloseTo(34.2, 10);
    expect(back.lon).toBeCloseTo(-118.4, 10);
    const tm = { kind: 'tm', k0: 0.9999, lat0: 31, lon0: -110.1667, falseEasting: 213360, falseNorthing: 0 } as const;
    const p = zoneForward(tm, 32.2, -110.9, GRS80);
    const q = zoneInverse(tm, p.easting, p.northing, GRS80);
    expect(q.lat).toBeCloseTo(32.2, 10);
    expect(q.lon).toBeCloseTo(-110.9, 10);
    expect(zoneForward(tm, 31, -110.1667).northing).toBeCloseTo(0, 6);
  });

  it('rejects parallels on opposite sides of the equator at equal distance', () => {
    expect(() => zoneForward({ ...zone, lat1: 10, lat2: -10 }, 0, -118)).toThrow('parallels');
  });
});

describe('site grids', () => {
  const truth = { scale: 1.0002, rotation: 30, e0: 500000, n0: 4000000 };
  const rad = (truth.rotation * Math.PI) / 180;
  const map = (x: number, y: number) => ({
    e: truth.scale * (Math.cos(rad) * x - Math.sin(rad) * y) + truth.e0,
    n: truth.scale * (Math.sin(rad) * x + Math.cos(rad) * y) + truth.n0,
  });

  it('recovers scale, rotation and shift from three control points', () => {
    const points = [
      [0, 0],
      [100, 0],
      [30, 80],
    ].map(([x, y]) => ({ x, y, ...map(x, y) }));
    const fit = fitHelmert(points);
    expect(fit.scale).toBeCloseTo(1.0002, 10);
    expect(fit.rotation).toBeCloseTo(30, 8);
    expect(fit.rms).toBeLessThan(1e-6);
    const there = siteToMap(fit, 55, 12);
    expect(there.e).toBeCloseTo(map(55, 12).e, 6);
    const back = mapToSite(fit, there.e, there.n);
    expect(back.x).toBeCloseTo(55, 9);
  });

  it('needs two different control points', () => {
    expect(() => fitHelmert([{ x: 0, y: 0, e: 1, n: 1 }])).toThrow('fewPoints');
    expect(() =>
      fitHelmert([
        { x: 1, y: 1, e: 1, n: 1 },
        { x: 1, y: 1, e: 2, n: 2 },
      ]),
    ).toThrow('samePoints');
  });
});

describe('navigation', () => {
  it('crosses bearing 045 from (0, 0) and bearing 315 from (100, 0) at (50, 50)', () => {
    const point = intersect({ x: 0, y: 0 }, 45, { x: 100, y: 0 }, 315);
    expect(point.x).toBeCloseTo(50, 9);
    expect(point.y).toBeCloseTo(50, 9);
    expect(point.behind).toBe(false);
    const own = resect({ x: 50, y: 50 }, 45, { x: 50, y: 50 + 100 }, 0);
    expect(Number.isFinite(own.x)).toBe(true);
    expect(() => intersect({ x: 0, y: 0 }, 10, { x: 5, y: 0 }, 190)).toThrow('parallel');
  });

  it('turns true 100 with 12 east declination into magnetic 88, with back azimuth 280', () => {
    expect(trueToMagnetic(100, 12)).toBe(88);
    expect(backAzimuth(100)).toBe(280);
    expect(paceDistance(130, 65)).toBe(200);
  });

  it('runs course 045 at 10 knots for 3 hours from 30 N', () => {
    const start = deadReckon({ lat: 30, lon: -40 }, 45, 10, 3, 'start');
    expect(start.distance).toBe(30);
    expect(start.dLat).toBeCloseTo(0.35355, 5);
    expect(start.dLon).toBeCloseTo(0.40825, 5);
    const mid = deadReckon({ lat: 30, lon: -40 }, 45, 10, 3, 'mid');
    const midLat = 30 + (30 * Math.SQRT1_2) / 120;
    expect(mid.dLon).toBeCloseTo((30 * Math.SQRT1_2) / (60 * Math.cos((midLat * Math.PI) / 180)), 12);
  });

  it('steers into a beam current and adds the current back up', () => {
    const steer = courseToSteer(0, 10, 90, 2);
    expect(steer.heading).toBeCloseTo(360 - (Math.asin(0.2) * 180) / Math.PI, 9);
    expect(steer.speedMadeGood).toBeCloseTo(10 * Math.cos(Math.asin(0.2)), 9);
    const ground = groundTrack(steer.heading, 10, 90, 2);
    expect(ground.track === 0 || Math.abs(ground.track - 360) < 1e-9 || Math.abs(ground.track) < 1e-9).toBe(true);
    expect(() => courseToSteer(0, 1, 90, 2)).toThrow('currentTooStrong');
  });

  it('solves time, speed and distance and chart scale', () => {
    expect(timeSpeedDistance(2.5, 12, null).miles).toBe(30);
    expect(timeSpeedDistance(null, 12, 30).hours).toBe(2.5);
    expect(() => timeSpeedDistance(null, null, 30)).toThrow('twoOfThree');
    expect(chartDistance(0.05, 50000)).toBe(2500);
  });
});
