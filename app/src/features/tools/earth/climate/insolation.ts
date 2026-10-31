// Daily-mean insolation at the top of the atmosphere by latitude and season for any orbit (Berger 1978): the sun's
// declination from the obliquity, the Earth-sun distance from the eccentricity and the longitude of perihelion, and
// the sunrise hour angle with polar day and polar night handled. Angles are in degrees at the edges, radians inside.
import { check } from '../core/problem';

export interface Orbit {
  /** Solar constant at the mean distance, W/m². */
  s0: number;
  eccentricity: number;
  /** Obliquity, degrees. */
  obliquity: number;
  /** Longitude of perihelion from the moving vernal equinox, heliocentric, degrees (Berger's ϖ, 102.9° today). */
  perihelion: number;
}

const RAD = Math.PI / 180;
/** Days in the tropical year. */
export const TROPICAL_YEAR = 365.2422;
/** The day of the year of the March equinox, counting 1 January as day 1. */
export const EQUINOX_DAY = 80;

function checkOrbit(orbit: Orbit): void {
  check(orbit.s0 > 0, 'solar');
  check(orbit.eccentricity >= 0 && orbit.eccentricity < 0.5, 'eccentricity');
  check(orbit.obliquity >= 0 && orbit.obliquity <= 90, 'obliquity');
}

export interface Insolation {
  /** Daily-mean insolation, W/m². */
  q: number;
  /** Declination, degrees. */
  declination: number;
  /** Sunrise hour angle, degrees: 0 in polar night and 180 in polar day. */
  hourAngle: number;
  /** (d0/d)², the distance factor. */
  distance: number;
  daylight: number;
}

/**
 * Q = (S0/π)(d0/d)² (h0 sin φ sin δ + cos φ cos δ sin h0) with sin δ = sin ε sin λ, cos h0 = −tan φ tan δ, and
 * (d0/d)² = (1 + e cos(λ − ϖ − 180°))²/(1 − e²)². `longitude` is the sun's true longitude λ in degrees.
 */
export function dailyInsolation(latitude: number, longitude: number, orbit: Orbit): Insolation {
  checkOrbit(orbit);
  check(latitude >= -90 && latitude <= 90, 'latitude');
  const phi = latitude * RAD;
  const lambda = longitude * RAD;
  const e = orbit.eccentricity;
  const delta = Math.asin(Math.sin(orbit.obliquity * RAD) * Math.sin(lambda));
  const cosH = -Math.tan(phi) * Math.tan(delta);
  const h0 = cosH >= 1 ? 0 : cosH <= -1 ? Math.PI : Math.acos(cosH);
  const distance = (1 + e * Math.cos(lambda - (orbit.perihelion + 180) * RAD)) ** 2 / (1 - e * e) ** 2;
  const shape = h0 * Math.sin(phi) * Math.sin(delta) + Math.cos(phi) * Math.cos(delta) * Math.sin(h0);
  return {
    q: Math.max(0, (orbit.s0 / Math.PI) * distance * shape),
    declination: delta / RAD,
    hourAngle: h0 / RAD,
    distance,
    daylight: (24 * h0) / Math.PI,
  };
}

/** Solves Kepler's equation M = E − e sin E by Newton's method. */
function eccentricAnomaly(mean: number, e: number): number {
  let big = e < 0.8 ? mean : Math.PI;
  for (let i = 0; i < 50; i++) {
    const step = (big - e * Math.sin(big) - mean) / (1 - e * Math.cos(big));
    big -= step;
    if (Math.abs(step) < 1e-14) break;
  }
  return big;
}

/** The sun's true longitude in degrees on a day of the year: the March equinox is day 80, and Kepler's law runs between. */
export function solarLongitude(day: number, orbit: Orbit): number {
  checkOrbit(orbit);
  const e = orbit.eccentricity;
  const peri = (orbit.perihelion + 180) * RAD;
  const half = Math.sqrt((1 - e) / (1 + e));
  const e0 = 2 * Math.atan(half * Math.tan(-peri / 2));
  const m0 = e0 - e * Math.sin(e0);
  const mean = m0 + (2 * Math.PI * (day - EQUINOX_DAY)) / TROPICAL_YEAR;
  const big = eccentricAnomaly(mean, e);
  const v = 2 * Math.atan(Math.tan(big / 2) / half);
  return ((((v + peri) / RAD) % 360) + 360) % 360;
}

/** Insolation on each day of the year (days 1 to 365, at midday) at one latitude. */
export function yearAt(latitude: number, orbit: Orbit): [number, number][] {
  return Array.from({ length: 365 }, (_, i) => {
    const day = i + 1;
    return [day, dailyInsolation(latitude, solarLongitude(day + 0.5, orbit), orbit).q];
  });
}

/** Insolation at every latitude from −90 to 90 in steps of 2° for one solar longitude. */
export const latitudesAt = (longitude: number, orbit: Orbit): [number, number][] =>
  Array.from({ length: 91 }, (_, i) => {
    const lat = -90 + 2 * i;
    return [lat, dailyInsolation(lat, longitude, orbit).q];
  });

/** The annual mean at a latitude, averaging the daily values. */
export function annualMean(latitude: number, orbit: Orbit): number {
  const year = yearAt(latitude, orbit);
  return year.reduce((sum, [, q]) => sum + q, 0) / year.length;
}
