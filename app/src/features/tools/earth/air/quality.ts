// Air quality: the US EPA Air Quality Index from a concentration, Gaussian plume dispersion with Briggs sigmas and
// plume rise, ppm to µg/m³ conversion, a well-mixed box model, and radar rain rates from Z-R relations.
// SI units unless a name says otherwise; concentrations in the units each pollutant's AQI table uses.
import { check } from '../core/problem';

export const SOURCES = {
  aqi: 'US EPA, Technical Assistance Document for the Reporting of Daily Air Quality (AQI), 2024 revision (public domain)',
  plume: 'Turner (1970) dispersion workbook and the Briggs (1973) sigmas, as published by the US EPA (public domain)',
  radar: 'Marshall and Palmer (1948) Z = 200 R^1.6; other Z-R pairs as published by the US National Weather Service',
} as const;

export type Pollutant = 'pm25' | 'pm10' | 'o3_8' | 'o3_1' | 'co' | 'so2' | 'no2';

/** Concentration breakpoints [C_lo, C_hi, I_lo, I_hi] and the decimals each pollutant is truncated to. */
const TABLE: Record<Pollutant, { places: number; rows: readonly (readonly [number, number, number, number])[] }> = {
  pm25: {
    places: 1,
    rows: [
      [0.0, 9.0, 0, 50],
      [9.1, 35.4, 51, 100],
      [35.5, 55.4, 101, 150],
      [55.5, 125.4, 151, 200],
      [125.5, 225.4, 201, 300],
      [225.5, 325.4, 301, 500],
    ],
  },
  pm10: {
    places: 0,
    rows: [
      [0, 54, 0, 50],
      [55, 154, 51, 100],
      [155, 254, 101, 150],
      [255, 354, 151, 200],
      [355, 424, 201, 300],
      [425, 604, 301, 500],
    ],
  },
  o3_8: {
    places: 3,
    rows: [
      [0.0, 0.054, 0, 50],
      [0.055, 0.07, 51, 100],
      [0.071, 0.085, 101, 150],
      [0.086, 0.105, 151, 200],
      [0.106, 0.2, 201, 300],
    ],
  },
  o3_1: {
    places: 3,
    rows: [
      [0.125, 0.164, 101, 150],
      [0.165, 0.204, 151, 200],
      [0.205, 0.404, 201, 300],
      [0.405, 0.604, 301, 500],
    ],
  },
  co: {
    places: 1,
    rows: [
      [0.0, 4.4, 0, 50],
      [4.5, 9.4, 51, 100],
      [9.5, 12.4, 101, 150],
      [12.5, 15.4, 151, 200],
      [15.5, 30.4, 201, 300],
      [30.5, 50.4, 301, 500],
    ],
  },
  so2: {
    places: 0,
    rows: [
      [0, 35, 0, 50],
      [36, 75, 51, 100],
      [76, 185, 101, 150],
      [186, 304, 151, 200],
      [305, 604, 201, 300],
      [605, 1004, 301, 500],
    ],
  },
  no2: {
    places: 0,
    rows: [
      [0, 53, 0, 50],
      [54, 100, 51, 100],
      [101, 360, 101, 150],
      [361, 649, 151, 200],
      [650, 1249, 201, 300],
      [1250, 2049, 301, 500],
    ],
  },
};

export const POLLUTANTS = Object.keys(TABLE) as Pollutant[];

export const CATEGORIES = ['good', 'moderate', 'sensitive', 'unhealthy', 'veryUnhealthy', 'hazardous'] as const;
export type Category = (typeof CATEGORIES)[number];

export function category(index: number): Category {
  if (index <= 50) return 'good';
  if (index <= 100) return 'moderate';
  if (index <= 150) return 'sensitive';
  if (index <= 200) return 'unhealthy';
  if (index <= 300) return 'veryUnhealthy';
  return 'hazardous';
}

export interface Aqi {
  index: number;
  category: Category;
  truncated: number;
  row: readonly [number, number, number, number];
}

/** Truncates toward zero to `places` decimals, guarding against binary noise such as 0.065 = 0.06499999. */
function truncate(value: number, places: number): number {
  const scale = 10 ** places;
  return Math.floor(value * scale + 1e-9) / scale;
}

/** The AQI of one pollutant: truncate, find the breakpoint row, interpolate, and round to the nearest integer. */
export function aqi(pollutant: Pollutant, concentration: number): Aqi {
  check(Number.isFinite(concentration) && concentration >= 0, 'concentration');
  const table = TABLE[pollutant];
  const c = truncate(concentration, table.places);
  const first = table.rows[0];
  if (pollutant === 'o3_1') check(c >= first[0], 'ozoneLow');
  if (pollutant === 'o3_8') check(c <= 0.2, 'ozoneHigh');
  const row = table.rows.find(([lo, hi]) => c >= lo && c <= hi);
  check(row !== undefined, 'beyond', { top: table.rows[table.rows.length - 1][1] });
  const [cLo, cHi, iLo, iHi] = row!;
  const index = Math.round(((iHi - iLo) / (cHi - cLo)) * (c - cLo) + iLo);
  return { index, category: category(index), truncated: c, row: row! };
}

export const STABILITY = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export type Stability = (typeof STABILITY)[number];

/** Briggs (1973) open-country or urban dispersion coefficients σy and σz at a distance x downwind (m). */
export function sigmas(stability: Stability, x: number, urban = false): { sy: number; sz: number } {
  check(x > 0, 'distance');
  if (urban) {
    const sy = (a: number) => (a * x) / Math.sqrt(1 + 0.0004 * x);
    switch (stability) {
      case 'A':
      case 'B':
        return { sy: sy(0.32), sz: 0.24 * x * Math.sqrt(1 + 0.001 * x) };
      case 'C':
        return { sy: sy(0.22), sz: 0.2 * x };
      case 'D':
        return { sy: sy(0.16), sz: (0.14 * x) / Math.sqrt(1 + 0.0003 * x) };
      default:
        return { sy: sy(0.11), sz: (0.08 * x) / Math.sqrt(1 + 0.0015 * x) };
    }
  }
  const sy = (a: number) => (a * x) / Math.sqrt(1 + 0.0001 * x);
  switch (stability) {
    case 'A':
      return { sy: sy(0.22), sz: 0.2 * x };
    case 'B':
      return { sy: sy(0.16), sz: 0.12 * x };
    case 'C':
      return { sy: sy(0.11), sz: (0.08 * x) / Math.sqrt(1 + 0.0002 * x) };
    case 'D':
      return { sy: sy(0.08), sz: (0.06 * x) / Math.sqrt(1 + 0.0015 * x) };
    case 'E':
      return { sy: sy(0.06), sz: (0.03 * x) / (1 + 0.0003 * x) };
    default:
      return { sy: sy(0.04), sz: (0.016 * x) / (1 + 0.0003 * x) };
  }
}

export type Sky = 'strong' | 'moderate' | 'slight' | 'overcast' | 'nightCloudy' | 'nightClear';

/**
 * The Pasquill-Gifford stability class from the surface wind and the sky (Turner 1970, table 1). Where the table
 * gives two classes (such as A-B) the more unstable one is used; overcast skies are neutral (D) by day and by night.
 */
export function stabilityClass(wind: number, sky: Sky): Stability {
  check(wind >= 0, 'wind');
  if (sky === 'overcast') return 'D';
  const band = wind < 2 ? 0 : wind < 3 ? 1 : wind < 5 ? 2 : wind < 6 ? 3 : 4;
  const day: Record<'strong' | 'moderate' | 'slight', readonly Stability[]> = {
    strong: ['A', 'A', 'B', 'C', 'C'],
    moderate: ['A', 'B', 'B', 'C', 'D'],
    slight: ['B', 'C', 'C', 'D', 'D'],
  };
  if (sky === 'nightCloudy') return (['F', 'E', 'D', 'D', 'D'] as const)[band];
  if (sky === 'nightClear') return (['F', 'F', 'E', 'D', 'D'] as const)[band];
  return day[sky][band];
}

/** Gaussian plume concentration (g/m³) at (x, y, z) for emission Q (g/s), wind u, and effective height H, with ground reflection. */
export function plume(q: number, u: number, sy: number, sz: number, h: number, y = 0, z = 0): number {
  check(q >= 0, 'emission');
  check(u > 0, 'wind');
  check(sy > 0 && sz > 0, 'sigma');
  check(h >= 0 && z >= 0, 'height');
  const lateral = Math.exp(-(y * y) / (2 * sy * sy));
  const vertical = Math.exp(-((z - h) ** 2) / (2 * sz * sz)) + Math.exp(-((z + h) ** 2) / (2 * sz * sz));
  return (q / (2 * Math.PI * u * sy * sz)) * lateral * vertical;
}

/** Briggs buoyancy flux F = g vₛ dₛ² (Tₛ − Tₐ) / (4 Tₛ) in m⁴/s³. */
export function buoyancyFlux(exitSpeed: number, diameter: number, stackT: number, airT: number, g = 9.80665): number {
  check(exitSpeed > 0 && diameter > 0, 'stack');
  check(stackT > 0 && airT > 0, 'temperature');
  return Math.max(0, (g * exitSpeed * diameter * diameter * (stackT - airT)) / (4 * stackT));
}

/**
 * Briggs buoyant rise for neutral and unstable air: Δh = 1.6 F^(1/3) x^(2/3) / u up to the distance of final rise,
 * x_f = 49 F^(5/8) for F < 55 m⁴/s³ and 119 F^(2/5) otherwise.
 */
export function plumeRise(flux: number, u: number, x: number): { rise: number; final: number; finalDistance: number } {
  check(u > 0, 'wind');
  check(x > 0, 'distance');
  const finalDistance = flux < 55 ? 49 * flux ** 0.625 : 119 * flux ** 0.4;
  const at = (d: number) => (1.6 * Math.cbrt(flux) * d ** (2 / 3)) / u;
  return { rise: at(Math.min(x, finalDistance)), final: at(finalDistance), finalDistance };
}

/** The largest ground-level centerline concentration and where it falls, by a fine search from 10 m to 50 km. */
export function groundMaximum(
  q: number,
  u: number,
  h: number,
  stability: Stability,
  urban: boolean,
): { x: number; c: number } {
  let best = { x: 10, c: 0 };
  for (let k = 0; k <= 2000; k++) {
    const x = 10 * 5000 ** (k / 2000);
    const s = sigmas(stability, x, urban);
    const c = plume(q, u, s.sy, s.sz, h);
    if (c > best.c) best = { x, c };
  }
  return best;
}

/** Molar masses (g/mol) for ppm conversions. */
export const MOLAR_MASS = {
  so2: 64.066,
  no2: 46.0055,
  no: 30.006,
  o3: 47.997,
  co: 28.01,
  nh3: 17.031,
  ch4: 16.043,
  h2s: 34.08,
  benzene: 78.112,
} as const;

/** The molar volume (L/mol) scaled from 24.45 L at 25 °C and 1 atm, as US air-quality practice writes it. */
export const molarVolume = (temperature: number, pressure: number): number => {
  check(temperature > 0, 'temperature');
  check(pressure > 0, 'pressure');
  return 24.45 * (temperature / 298.15) * (101325 / pressure);
};

/** ppm to µg/m³: ppm × M × 1000 / V_m. */
export const ppmToUg = (ppm: number, molar: number, vm: number): number => (ppm * molar * 1000) / vm;
export const ugToPpm = (ug: number, molar: number, vm: number): number => (ug * vm) / (molar * 1000);

export interface Box {
  steady: number;
  /** The e-folding time 1/(u/L + k) in seconds. */
  tau: number;
  at(t: number): number;
}

/**
 * A well-mixed box of length L along the wind, width W, and mixing height H, with emission E (mass per time),
 * inflow concentration C_in, and first-order loss k: dC/dt = E/(LWH) + (u/L)(C_in − C) − kC.
 */
export function box(
  emission: number,
  length: number,
  width: number,
  height: number,
  u: number,
  inflow: number,
  loss: number,
  start: number,
): Box {
  check(length > 0 && width > 0 && height > 0, 'box');
  check(u >= 0 && loss >= 0 && emission >= 0 && inflow >= 0 && start >= 0, 'boxRates');
  const rate = u / length + loss;
  check(rate > 0, 'boxFlush');
  const steady = (emission / (length * width * height) + (u / length) * inflow) / rate;
  return { steady, tau: 1 / rate, at: (t: number) => steady + (start - steady) * Math.exp(-rate * t) };
}

export const ZR = {
  marshallPalmer: { a: 200, b: 1.6 },
  convective: { a: 300, b: 1.4 },
  tropical: { a: 250, b: 1.2 },
} as const;

/** Reflectivity factor Z (mm⁶/m³) from dBZ, and the rain rate R = (Z/a)^(1/b) in mm/h. */
export function rainRate(dbz: number, a: number, b: number): { z: number; rate: number } {
  check(a > 0 && b > 0, 'zr');
  check(dbz < 100, 'dbz');
  const z = 10 ** (dbz / 10);
  return { z, rate: (z / a) ** (1 / b) };
}
