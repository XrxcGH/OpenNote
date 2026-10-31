// Geophysics on the sphere: the dipole field and its inclination, paleolatitude and the virtual geomagnetic pole,
// the anomaly of an induced sphere, and plate velocities from Euler poles. Angles are in degrees.
import { check } from '../core/problem';
import { SECONDS_PER_YEAR } from '../core/units';

export const EARTH_RADIUS = 6371e3;
const rad = (deg: number) => (deg * Math.PI) / 180;
const deg = (r: number) => (r * 180) / Math.PI;
const wrap = (d: number) => ((d % 360) + 360) % 360;
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** The inclination of a dipole field at magnetic latitude λ: tan I = 2 tan λ. */
export function inclination(latitude: number): number {
  check(Math.abs(latitude) <= 90, 'latitude');
  return deg(Math.atan(2 * Math.tan(rad(latitude))));
}

/** The magnetic latitude (or paleolatitude) at which a dipole has inclination I. */
export function latitudeFromInclination(inc: number): number {
  check(Math.abs(inc) <= 90, 'inclination');
  return deg(Math.atan(Math.tan(rad(inc)) / 2));
}

/** The strength of a dipole field at magnetic latitude λ, given its strength at the equator. */
export const dipoleStrength = (equator: number, latitude: number): number =>
  equator * Math.sqrt(1 + 3 * Math.sin(rad(latitude)) ** 2);

export interface Pole {
  latitude: number;
  longitude: number;
  /** The angular distance from the site to the pole (the paleocolatitude). */
  colatitude: number;
  /** The longitude difference from the site to the pole before the hemisphere test. */
  beta: number;
}

/** The virtual geomagnetic pole of a mean direction (declination, inclination) at a site. */
export function virtualPole(site: { latitude: number; longitude: number }, dec: number, inc: number): Pole {
  check(Math.abs(site.latitude) <= 90 && Math.abs(inc) <= 90, 'direction');
  const p = Math.atan2(2, Math.tan(rad(inc)));
  const ls = rad(site.latitude);
  const sinLp = Math.sin(ls) * Math.cos(p) + Math.cos(ls) * Math.sin(p) * Math.cos(rad(dec));
  const lp = Math.asin(Math.max(-1, Math.min(1, sinLp)));
  const beta = deg(Math.asin(Math.max(-1, Math.min(1, (Math.sin(p) * Math.sin(rad(dec))) / Math.cos(lp)))));
  const longitude = Math.cos(p) >= Math.sin(ls) * sinLp ? site.longitude + beta : site.longitude + 180 - beta;
  return { latitude: deg(lp), longitude: wrap180(longitude), colatitude: deg(p), beta };
}

/**
 * The total-field anomaly of a sphere magnetized by induction, along a profile in the magnetic north direction
 * over its center. The field has strength F and inclination I; the sphere has susceptibility χ (SI).
 */
export function inducedSphere(
  spec: { field: number; inc: number; chi: number; radius: number; depth: number },
  x: number,
): number {
  check(spec.depth > spec.radius && spec.radius > 0, 'buried');
  const mu0 = 4e-7 * Math.PI;
  // The induced moment, m = χ V F / μ0 (A·m²), lies along the field.
  const moment = (spec.chi * (4 / 3) * Math.PI * spec.radius ** 3 * spec.field) / mu0;
  const f = [Math.cos(rad(spec.inc)), 0, -Math.sin(rad(spec.inc))];
  // North is +x and up is +z; the observer is at (x, 0, 0) and the center at (0, 0, −depth).
  const r = [x, 0, spec.depth];
  const dist = Math.hypot(r[0], r[1], r[2]);
  const cos = (r[0] * f[0] + r[2] * f[2]) / dist;
  return ((mu0 * moment) / (4 * Math.PI * dist ** 3)) * (3 * cos * cos - 1);
}

const vector = (latitude: number, longitude: number): [number, number, number] => [
  Math.cos(rad(latitude)) * Math.cos(rad(longitude)),
  Math.cos(rad(latitude)) * Math.sin(rad(longitude)),
  Math.sin(rad(latitude)),
];

export interface PlateVelocity {
  north: number;
  east: number;
  speed: number;
  azimuth: number;
  /** The angular distance from the pole to the site. */
  distance: number;
}

/** The velocity of a site (m/s) on a plate turning about its Euler pole at `rate` degrees per million years. */
export function eulerVelocity(
  pole: { latitude: number; longitude: number },
  rate: number,
  site: { latitude: number; longitude: number },
): PlateVelocity {
  check(Math.abs(pole.latitude) <= 90 && Math.abs(site.latitude) <= 90, 'latitude');
  const omega = rad(rate) / (1e6 * SECONDS_PER_YEAR);
  const w = vector(pole.latitude, pole.longitude).map((c) => c * omega);
  const r = vector(site.latitude, site.longitude).map((c) => c * EARTH_RADIUS);
  const v = [w[1] * r[2] - w[2] * r[1], w[2] * r[0] - w[0] * r[2], w[0] * r[1] - w[1] * r[0]];
  const [la, lo] = [rad(site.latitude), rad(site.longitude)];
  const east = -Math.sin(lo) * v[0] + Math.cos(lo) * v[1];
  const north = -Math.sin(la) * Math.cos(lo) * v[0] - Math.sin(la) * Math.sin(lo) * v[1] + Math.cos(la) * v[2];
  const unitW = vector(pole.latitude, pole.longitude);
  const unitR = vector(site.latitude, site.longitude);
  const dot = unitW[0] * unitR[0] + unitW[1] * unitR[1] + unitW[2] * unitR[2];
  return {
    north,
    east,
    speed: Math.hypot(north, east),
    azimuth: wrap(deg(Math.atan2(east, north))),
    distance: deg(Math.acos(Math.max(-1, Math.min(1, dot)))),
  };
}

/** The half and full spreading rates (m/s) from the distance of a dated anomaly to the ridge axis. */
export function spreading(distance: number, age: number): { half: number; full: number } {
  check(distance > 0 && age > 0, 'spreading');
  return { half: distance / age, full: (2 * distance) / age };
}
