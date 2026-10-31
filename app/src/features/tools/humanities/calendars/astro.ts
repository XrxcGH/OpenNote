// Low-precision positions of the sun and new moons, enough to place equinoxes, solstices, solar terms, and new
// moons within a few minutes for years near the present. The sun is the geometric mean longitude with the equation
// of the center, nutation, and aberration (the low-accuracy series in Meeus, Astronomical Algorithms, chapter 25).
// New moons are the mean lunation with the main periodic terms (chapter 49). The coefficients are published facts;
// this code is written for the app. Times are Julian days; TT is turned into UT with an estimate of ΔT.

const RAD = Math.PI / 180;
const norm = (degrees: number): number => ((degrees % 360) + 360) % 360;
const sin = (degrees: number): number => Math.sin(degrees * RAD);

/** The sun's apparent ecliptic longitude in degrees, at a Julian Ephemeris Day. */
export function solarLongitude(jde: number): number {
  const t = (jde - 2451545) / 36525;
  const l0 = 280.46646 + 36000.76983 * t + 0.0003032 * t * t;
  const m = 357.52911 + 35999.05029 * t - 0.0001537 * t * t;
  const c =
    (1.914602 - 0.004817 * t - 0.000014 * t * t) * sin(m) +
    (0.019993 - 0.000101 * t) * sin(2 * m) +
    0.000289 * sin(3 * m);
  const omega = 125.04 - 1934.136 * t;
  return norm(l0 + c - 0.00569 - 0.00478 * sin(omega));
}

/** ΔT = TT − UT in seconds: the Espenak and Meeus polynomials for 1986 to 2150, and a parabola outside them. */
export function deltaT(year: number): number {
  if (year >= 1986 && year < 2005) {
    const t = year - 2000;
    return 63.86 + 0.3345 * t - 0.060374 * t ** 2 + 0.0017275 * t ** 3 + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5;
  }
  if (year >= 2005 && year < 2050) {
    const t = year - 2000;
    return 62.92 + 0.32217 * t + 0.005589 * t * t;
  }
  if (year >= 2050 && year <= 2150) return -20 + 32 * ((year - 1820) / 100) ** 2 - 0.5628 * (2150 - year);
  return -20 + 32 * ((year - 1820) / 100) ** 2;
}

const yearOf = (jd: number): number => 2000 + (jd - 2451545) / 365.25;
export const ttToUt = (jde: number): number => jde - deltaT(yearOf(jde)) / 86400;

/** The moment (UT, as a Julian day) the sun reaches this longitude, searching from a Julian day near it. */
export function sunAtLongitude(target: number, near: number): number {
  let jde = near;
  for (let i = 0; i < 50; i++) {
    const gap = ((target - solarLongitude(jde) + 540) % 360) - 180;
    // The sun moves about 360/365.2422 degrees a day.
    const step = gap * (365.2422 / 360);
    jde += step;
    if (Math.abs(step) < 1e-7) break;
  }
  return ttToUt(jde);
}

/** The new moon of lunation k (k = 0 near 6 January 2000), as UT Julian days. */
export function newMoon(k: number): number {
  const t = k / 1236.85;
  const jde = 2451550.09766 + 29.530588861 * k + 0.00015437 * t ** 2 - 0.00000015 * t ** 3 + 0.00000000073 * t ** 4;
  const e = 1 - 0.002516 * t - 0.0000074 * t * t;
  const m = 2.5534 + 29.1053567 * k - 0.0000014 * t ** 2 - 0.00000011 * t ** 3;
  const mm = 201.5643 + 385.81693528 * k + 0.0107582 * t ** 2 + 0.00001238 * t ** 3 - 0.000000058 * t ** 4;
  const f = 160.7108 + 390.67050284 * k - 0.0016118 * t ** 2 - 0.00000227 * t ** 3 + 0.000000011 * t ** 4;
  const om = 124.7746 - 1.56375588 * k + 0.0020672 * t ** 2 + 0.00000215 * t ** 3;
  const terms =
    -0.4072 * sin(mm) +
    0.17241 * e * sin(m) +
    0.01608 * sin(2 * mm) +
    0.01039 * sin(2 * f) +
    0.00739 * e * sin(mm - m) -
    0.00514 * e * sin(mm + m) +
    0.00208 * e * e * sin(2 * m) -
    0.00111 * sin(mm - 2 * f) -
    0.00057 * sin(mm + 2 * f) +
    0.00056 * e * sin(2 * mm + m) -
    0.00042 * sin(3 * mm) +
    0.00042 * e * sin(m + 2 * f) +
    0.00038 * e * sin(m - 2 * f) -
    0.00024 * e * sin(2 * mm - m) -
    0.00017 * sin(om) -
    0.00007 * sin(mm + 2 * m) +
    0.00004 * sin(2 * mm - 2 * f) +
    0.00004 * sin(3 * m) +
    0.00003 * sin(mm + m - 2 * f) +
    0.00003 * sin(2 * mm + 2 * f) -
    0.00003 * sin(mm + m + 2 * f) +
    0.00003 * sin(mm - m + 2 * f) -
    0.00002 * sin(mm - m - 2 * f) -
    0.00002 * sin(3 * mm + m) +
    0.00002 * sin(4 * mm);
  return ttToUt(jde + terms);
}

/** The lunation number of the last new moon at or before a UT Julian day. */
export function lunationBefore(jd: number): number {
  let k = Math.floor((jd - 2451550.09766) / 29.530588861);
  while (newMoon(k + 1) <= jd) k += 1;
  while (newMoon(k) > jd) k -= 1;
  return k;
}

/** The civil day (JDN) of a UT moment at a time zone this many hours east of Greenwich. */
export const localDay = (jd: number, zoneHours: number): number => Math.floor(jd + 0.5 + zoneHours / 24);

/** Hours and minutes of a UT moment in a time zone, for the steps. */
export function localTime(jd: number, zoneHours: number): { hours: number; minutes: number } {
  const local = jd + 0.5 + zoneHours / 24;
  const minutes = Math.round((local - Math.floor(local)) * 1440) % 1440;
  return { hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}

// The periodic terms of the equinox and solstice series (Meeus, chapter 27, table 27.C): amplitude, phase, and rate.
const EQUINOX_TERMS: readonly (readonly [number, number, number])[] = [
  [485, 324.96, 1934.136],
  [203, 337.23, 32964.467],
  [199, 342.08, 20.186],
  [182, 27.85, 445267.112],
  [156, 73.14, 45036.886],
  [136, 171.52, 22518.443],
  [77, 222.54, 65928.934],
  [74, 296.72, 3034.906],
  [70, 243.58, 9037.513],
  [58, 119.81, 33718.147],
  [52, 297.17, 150.678],
  [50, 21.02, 2281.226],
  [45, 247.54, 29929.562],
  [44, 325.15, 31555.956],
  [29, 60.93, 4443.417],
  [18, 155.12, 67555.328],
  [17, 288.79, 4562.452],
  [16, 198.04, 62894.029],
  [14, 199.76, 31436.921],
  [12, 95.39, 14577.848],
  [12, 287.11, 31931.756],
  [12, 320.81, 34777.259],
  [9, 227.73, 1222.114],
  [8, 15.45, 16859.074],
];

/** The March equinox of a Gregorian year as a UT Julian day, good to about a minute for years 1000 to 3000. */
export function marchEquinox(year: number): number {
  const y = (year - 2000) / 1000;
  const mean = 2451623.80984 + 365242.37404 * y + 0.05169 * y ** 2 - 0.00411 * y ** 3 - 0.00057 * y ** 4;
  const t = (mean - 2451545) / 36525;
  const w = 35999.373 * t - 2.47;
  const spread = 1 + 0.0334 * Math.cos(w * RAD) + 0.0007 * Math.cos(2 * w * RAD);
  const sum = EQUINOX_TERMS.reduce((total, [a, b, c]) => total + a * Math.cos((b + c * t) * RAD), 0);
  return ttToUt(mean + (0.00001 * sum) / spread);
}
