// Positional astronomy: calendar dates to Julian Dates, sidereal time, coordinate conversions (equatorial,
// horizontal, ecliptic, galactic J2000), IAU 1976 precession, the Sun by the US Naval Observatory low-precision
// formulas, and the Moon by the Astronomical Almanac low-precision series. Angles are in degrees unless named.
import { fail } from '../shared/errors';

const RAD = Math.PI / 180;
export const sind = (x: number) => Math.sin(x * RAD);
export const cosd = (x: number) => Math.cos(x * RAD);
export const tand = (x: number) => Math.tan(x * RAD);
export const asind = (x: number) => Math.asin(Math.max(-1, Math.min(1, x))) / RAD;
export const acosd = (x: number) => Math.acos(Math.max(-1, Math.min(1, x))) / RAD;
export const atan2d = (y: number, x: number) => Math.atan2(y, x) / RAD;
export const wrap = (x: number, turn = 360) => ((x % turn) + turn) % turn;

export const J2000 = 2451545;

/** A date typed as YYYY-MM-DD (proleptic Gregorian). */
export function parseDate(text: string): [number, number, number] {
  const m = /^\s*(-?\d{1,4})-(\d{1,2})-(\d{1,2})\s*$/.exec(text);
  if (!m) fail('badDate');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const days = [31, y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (mo < 1 || mo > 12 || d < 1 || d > days[mo - 1]!) fail('badDate');
  return [y, mo, d];
}

/** A time typed as HH:MM or HH:MM:SS, in hours. */
export function parseTime(text: string): number {
  const m = /^\s*(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?\s*$/.exec(text);
  if (!m) fail('badDate');
  const [h, mi, s] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)];
  if (h > 24 || mi > 59 || s >= 60) fail('badDate');
  return h + mi / 60 + s / 3600;
}

/** The Julian Date at 0h of a Gregorian calendar date (Meeus, Astronomical Algorithms, chapter 7). */
export function julianDay0(y: number, m: number, d: number): number {
  const [yy, mm] = m <= 2 ? [y - 1, m + 12] : [y, m];
  const a = Math.floor(yy / 100);
  const b = 2 - a + Math.floor(a / 4);
  return Math.floor(365.25 * (yy + 4716)) + Math.floor(30.6001 * (mm + 1)) + d + b - 1524.5;
}

/** The Julian Date of a calendar date and a universal time in hours. */
export const julianDate = (y: number, m: number, d: number, hours: number) => julianDay0(y, m, d) + hours / 24;

/** The calendar date and UT hours of a Julian Date. */
export function calendar(jd: number): { y: number; m: number; d: number; hours: number } {
  const z = Math.floor(jd + 0.5);
  const f = jd + 0.5 - z;
  const alpha = Math.floor((z - 1867216.25) / 36524.25);
  const a = z + 1 + alpha - Math.floor(alpha / 4);
  const b = a + 1524;
  const c = Math.floor((b - 122.1) / 365.25);
  const dd = Math.floor(365.25 * c);
  const e = Math.floor((b - dd) / 30.6001);
  const d = b - dd - Math.floor(30.6001 * e);
  const m = e < 14 ? e - 1 : e - 13;
  return { y: m > 2 ? c - 4716 : c - 4715, m, d, hours: f * 24 };
}

/** Greenwich mean sidereal time in hours (USNO approximation of the IAU 1982 expression). */
export const gmst = (jd: number) => wrap(18.697374558 + 24.06570982441908 * (jd - J2000), 24);

export interface Equatorial {
  /** Right ascension in hours and declination in degrees. */
  ra: number;
  dec: number;
}

export interface SunPosition extends Equatorial {
  g: number;
  q: number;
  lambda: number;
  epsilon: number;
  /** Distance in au and the equation of time in minutes. */
  distance: number;
  eot: number;
}

/** The Sun by the USNO low-precision formulas (about 0.01° from 1950 to 2050). */
export function sun(jd: number): SunPosition {
  const d = jd - J2000;
  const g = wrap(357.529 + 0.98560028 * d);
  const q = wrap(280.459 + 0.98564736 * d);
  const lambda = wrap(q + 1.915 * sind(g) + 0.02 * sind(2 * g));
  const epsilon = 23.439 - 3.6e-7 * d;
  const ra = wrap(atan2d(cosd(epsilon) * sind(lambda), cosd(lambda)), 360) / 15;
  const dec = asind(sind(epsilon) * sind(lambda));
  const distance = 1.00014 - 0.01671 * cosd(g) - 0.00014 * cosd(2 * g);
  let eot = q / 15 - ra;
  eot = ((((eot + 12) % 24) + 24) % 24) - 12;
  return { ra, dec, g, q, lambda, epsilon, distance, eot: eot * 60 };
}

export interface MoonPosition extends Equatorial {
  lambda: number;
  beta: number;
  /** Horizontal parallax in degrees and distance in Earth radii. */
  parallax: number;
  distance: number;
}

/** The Moon by the Astronomical Almanac low-precision formulas (about 0.3° in longitude). */
export function moon(jd: number): MoonPosition {
  const t = (jd - J2000) / 36525;
  const lambda = wrap(
    218.32 +
      481267.881 * t +
      6.29 * sind(135 + 477198.87 * t) -
      1.27 * sind(259.3 - 413335.36 * t) +
      0.66 * sind(235.7 + 890534.22 * t) +
      0.21 * sind(269.9 + 954397.74 * t) -
      0.19 * sind(357.5 + 35999.05 * t) -
      0.11 * sind(186.5 + 966404.03 * t),
  );
  const beta =
    5.13 * sind(93.3 + 483202.02 * t) +
    0.28 * sind(228.2 + 960400.89 * t) -
    0.28 * sind(318.3 + 6003.15 * t) -
    0.17 * sind(217.6 - 407332.21 * t);
  const parallax =
    0.9508 +
    0.0518 * cosd(135 + 477198.87 * t) +
    0.0095 * cosd(259.3 - 413335.36 * t) +
    0.0078 * cosd(235.7 + 890534.22 * t) +
    0.0028 * cosd(269.9 + 954397.74 * t);
  const eq = eclipticToEquatorial(lambda, beta, 23.439 - 3.6e-7 * (jd - J2000));
  return { ...eq, lambda, beta, parallax, distance: 1 / sind(parallax) };
}

export function eclipticToEquatorial(lambda: number, beta: number, epsilon: number): Equatorial {
  const x = cosd(beta) * cosd(lambda);
  const y = cosd(epsilon) * cosd(beta) * sind(lambda) - sind(epsilon) * sind(beta);
  const z = sind(epsilon) * cosd(beta) * sind(lambda) + cosd(epsilon) * sind(beta);
  return { ra: wrap(atan2d(y, x)) / 15, dec: asind(z) };
}

export function equatorialToEcliptic(eq: Equatorial, epsilon: number): { lambda: number; beta: number } {
  const a = eq.ra * 15;
  const x = cosd(eq.dec) * cosd(a);
  const y = cosd(epsilon) * cosd(eq.dec) * sind(a) + sind(epsilon) * sind(eq.dec);
  const z = -sind(epsilon) * cosd(eq.dec) * sind(a) + cosd(epsilon) * sind(eq.dec);
  return { lambda: wrap(atan2d(y, x)), beta: asind(z) };
}

/** The galactic pole and node for J2000 (Hipparcos introduction, 1997). */
const NGP = { ra: 192.85948, dec: 27.12825, lNcp: 122.93192 };

export function equatorialToGalactic(eq: Equatorial): { l: number; b: number } {
  const a = eq.ra * 15;
  const sb = sind(eq.dec) * sind(NGP.dec) + cosd(eq.dec) * cosd(NGP.dec) * cosd(a - NGP.ra);
  const y = cosd(eq.dec) * sind(a - NGP.ra);
  const x = sind(eq.dec) * cosd(NGP.dec) - cosd(eq.dec) * sind(NGP.dec) * cosd(a - NGP.ra);
  return { l: wrap(NGP.lNcp - atan2d(y, x)), b: asind(sb) };
}

/** Precession from J2000 to a Julian Date by the IAU 1976 angles ζ, z, θ (Lieske 1977). */
export function precess(eq: Equatorial, jd: number): Equatorial & { zeta: number; z: number; theta: number } {
  const t = (jd - J2000) / 36525;
  const arc = 1 / 3600;
  const zeta = (2306.2181 * t + 0.30188 * t * t + 0.017998 * t ** 3) * arc;
  const z = (2306.2181 * t + 1.09468 * t * t + 0.018203 * t ** 3) * arc;
  const theta = (2004.3109 * t - 0.42665 * t * t - 0.041833 * t ** 3) * arc;
  const a = eq.ra * 15 + zeta;
  const A = cosd(eq.dec) * sind(a);
  const B = cosd(theta) * cosd(eq.dec) * cosd(a) - sind(theta) * sind(eq.dec);
  const C = sind(theta) * cosd(eq.dec) * cosd(a) + cosd(theta) * sind(eq.dec);
  return { ra: wrap(atan2d(A, B) + z) / 15, dec: asind(C), zeta, z, theta };
}

/** Altitude and azimuth (from north through east) of an hour angle (hours) and declination at a latitude. */
export function horizontal(hourAngle: number, dec: number, lat: number): { alt: number; az: number } {
  const h = hourAngle * 15;
  const alt = asind(sind(lat) * sind(dec) + cosd(lat) * cosd(dec) * cosd(h));
  const az = wrap(atan2d(-cosd(dec) * sind(h), sind(dec) * cosd(lat) - cosd(dec) * sind(lat) * cosd(h)));
  return { alt, az };
}

/** The hour angle (hours) at which an object of declination dec reaches altitude h0; NaN when it never does. */
export function hourAngleAt(dec: number, lat: number, h0: number): number {
  const c = (sind(h0) - sind(lat) * sind(dec)) / (cosd(lat) * cosd(dec));
  if (c < -1) return Infinity;
  if (c > 1) return -Infinity;
  return acosd(c) / 15;
}

/** Plane-parallel airmass, sec z = 1 / sin(altitude). */
export function airmass(alt: number): number {
  if (alt <= 0) return Infinity;
  return 1 / sind(alt);
}
