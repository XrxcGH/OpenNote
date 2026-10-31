import { describe, expect, it } from 'vitest';
import { GeoError, WGS84, direct, haversine, inverse, meridianArc, midpoint, rhumb, wrap180 } from './ellipsoid';
import { tmForward, tmInverse } from './tm';

/** The meridian arc by Simpson's rule on the integrand a (1 - e^2) / (1 - e^2 sin^2)^(3/2): an independent check. */
function arcBySimpson(latDeg: number): number {
  const e2 = WGS84.f * (2 - WGS84.f);
  const phi = (latDeg * Math.PI) / 180;
  const steps = 4000;
  const h = phi / steps;
  let sum = 0;
  for (let i = 0; i <= steps; i += 1) {
    const weight = i === 0 || i === steps ? 1 : i % 2 ? 4 : 2;
    sum += (weight * WGS84.a * (1 - e2)) / (1 - e2 * Math.sin(i * h) ** 2) ** 1.5;
  }
  return (sum * h) / 3;
}

describe('the ellipsoid', () => {
  it('gives the meridian arc that integration gives', () => {
    for (const lat of [0, 10, 40, 66.5, 89]) expect(meridianArc(lat)).toBeCloseTo(arcBySimpson(lat), 4);
  });

  it('measures JFK to LHR on WGS84 and by haversine', () => {
    const path = inverse(40.6413, -73.7781, 51.47, -0.4543);
    expect(Math.abs(path.distance / 1000 - 5554.909)).toBeLessThan(1e-3);
    expect(path.azimuth1).toBeCloseTo(51.3816, 4);
    expect(Math.abs(haversine(40.6413, -73.7781, 51.47, -0.4543) / 1000 - 5540.02)).toBeLessThan(0.005);
  });

  it('runs the direct problem back to the second point', () => {
    const path = inverse(-33.8688, 151.2093, 35.6762, 139.6503);
    const end = direct(-33.8688, 151.2093, path.azimuth1, path.distance);
    expect(end.lat).toBeCloseTo(35.6762, 9);
    expect(end.lon).toBeCloseTo(139.6503, 9);
    expect(end.azimuth).toBeCloseTo(path.azimuth2, 8);
  });

  it('puts the midpoint at equal distances from both ends', () => {
    const mid = midpoint(10, 20, 30, 60);
    const a = inverse(10, 20, mid.lat, mid.lon).distance;
    const b = inverse(mid.lat, mid.lon, 30, 60).distance;
    expect(a).toBeCloseTo(b, 3);
  });

  it('gives zero for the same point and reports nearly antipodal points', () => {
    expect(inverse(12, 34, 12, 34).distance).toBe(0);
    expect(() => inverse(0, 0, 0.5, 179.7)).toThrow(GeoError);
  });

  it('follows rhumb lines along the equator and a meridian', () => {
    const east = rhumb(0, 0, 0, 1);
    expect(east.course).toBeCloseTo(90, 12);
    expect(east.distance).toBeCloseTo((WGS84.a * Math.PI) / 180, 6);
    const north = rhumb(0, 5, 1, 5);
    expect(north.course).toBeCloseTo(0, 12);
    expect(north.distance).toBeCloseTo(meridianArc(1), 6);
  });

  it('rejects latitudes beyond the poles', () => {
    expect(() => inverse(91, 0, 0, 0)).toThrow(GeoError);
    expect(wrap180(190)).toBe(-170);
  });
});

describe('transverse Mercator', () => {
  it('maps the central meridian to k0 times the meridian arc with scale k0', () => {
    const point = tmForward(40, -75, -75, 0.9996);
    expect(point.x).toBeCloseTo(0, 9);
    expect(point.y).toBeCloseTo(0.9996 * meridianArc(40), 6);
    expect(point.scale).toBeCloseTo(0.9996, 12);
    expect(point.convergence).toBeCloseTo(0, 12);
  });

  it('gives convergence close to the spherical value and a scale that grows off the meridian', () => {
    const point = tmForward(45, 2, 0, 1);
    const spherical = (Math.atan(Math.tan((2 * Math.PI) / 180) * Math.sin(Math.PI / 4)) * 180) / Math.PI;
    expect(Math.abs(point.convergence - spherical)).toBeLessThan(0.002);
    const approx = 1 + (((2 * Math.PI) / 180) * Math.cos(Math.PI / 4)) ** 2 / 2;
    expect(Math.abs(point.scale - approx)).toBeLessThan(2e-5);
  });

  it('round-trips points within 3 degrees of the central meridian to under a millimeter', () => {
    let seed = 7;
    const next = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 200; i += 1) {
      const lat = -79 + next() * 162;
      const lon = -3 + next() * 6;
      const point = tmForward(lat, lon, 0, 0.9996);
      const back = tmInverse(point.x, point.y, 0, 0.9996);
      const again = tmForward(back.lat, back.lon, 0, 0.9996);
      expect(Math.hypot(again.x - point.x, again.y - point.y)).toBeLessThan(1e-3);
      expect(Math.abs(back.lat - lat)).toBeLessThan(1e-8);
    }
  });
});
