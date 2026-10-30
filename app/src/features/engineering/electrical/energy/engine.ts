// Energy system estimates in closed form: wind, solar geometry, photovoltaics, emissions, cost of energy, and
// energy units. Everything is in SI units; angles are in degrees at the edges.
import { fail, toDegrees, toRadians } from '../shared';

// ---- Wind ----

/** Power per unit swept area of the wind, ½ ρ v³ (W/m²). */
export const windPowerDensity = (speed: number, rho: number): number => 0.5 * rho * speed ** 3;

/** The most any turbine can take from the wind (Betz): 16/27 of the power in it. */
export const BETZ = 16 / 27;

/** Power of a rotor of diameter D with power coefficient Cp: ½ ρ (π D²/4) v³ Cp (W). */
export function turbinePower(diameter: number, cp: number, speed: number, rho: number): number {
  if (cp > BETZ + 1e-12) fail('betz');
  return windPowerDensity(speed, rho) * ((Math.PI * diameter * diameter) / 4) * cp;
}

/** The gamma function, by the Lanczos approximation (g = 7), good to about 15 digits for positive arguments. */
export function gamma(x: number): number {
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  const y = x - 1;
  let sum = c[0]!;
  for (let i = 1; i < 9; i++) sum += c[i]! / (y + i);
  const t = y + 7.5;
  return Math.sqrt(2 * Math.PI) * t ** (y + 0.5) * Math.exp(-t) * sum;
}

export interface Weibull {
  /** Shape k (2 is the Rayleigh distribution). */
  k: number;
  /** Scale c (m/s). */
  c: number;
  mean: number;
}

/** The Weibull wind distribution with the mean speed given; k = 2 is the Rayleigh distribution. */
export function weibullFromMean(mean: number, k: number): Weibull {
  if (!(mean > 0)) fail('positive', { field: 'meanSpeed' });
  if (!(k > 0)) fail('positive', { field: 'shape' });
  return { k, c: mean / gamma(1 + 1 / k), mean };
}

/** P(speed > v) = exp(−(v/c)^k). */
export const exceedance = (w: Weibull, v: number): number => Math.exp(-((Math.max(v, 0) / w.c) ** w.k));

/** The mean of v³ over the distribution: c³ Γ(1 + 3/k). */
export const meanCube = (w: Weibull): number => w.c ** 3 * gamma(1 + 3 / w.k);

export interface PowerCurve {
  cutIn: number;
  rated: number;
  cutOut: number;
}

/** The capacity factor of a turbine: the expected power over the distribution, divided by the rated power. */
export function capacityFactor(w: Weibull, curve: PowerCurve): number {
  if (!(curve.cutIn >= 0 && curve.cutIn < curve.rated && curve.rated <= curve.cutOut)) fail('curveOrder');
  const { cutIn, rated, cutOut } = curve;
  // Between cut-in and rated the power follows the cube of the speed, scaled to reach 1 at the rated speed;
  // between rated and cut-out it is flat, and its share is exact.
  const steps = 4000;
  const h = (rated - cutIn) / steps;
  const pdf = (v: number) => (w.k / w.c) * (v / w.c) ** (w.k - 1) * Math.exp(-((v / w.c) ** w.k));
  const f = (v: number) => ((v ** 3 - cutIn ** 3) / (rated ** 3 - cutIn ** 3)) * pdf(v);
  let sum = f(cutIn) + f(rated);
  for (let i = 1; i < steps; i++) sum += f(cutIn + i * h) * (i % 2 === 0 ? 2 : 4);
  const ramp = (sum * h) / 3;
  return ramp + exceedance(w, rated) - exceedance(w, cutOut);
}

// ---- Solar ----

/** The solar declination by Cooper's equation, 23.45° sin(360° (284 + n) / 365), for day of the year n. */
export const declination = (day: number): number => 23.45 * Math.sin(toRadians((360 * (284 + day)) / 365));

export interface Sun {
  declination: number;
  hourAngle: number;
  altitude: number;
  zenith: number;
  /** From south, positive toward the west. */
  azimuth: number;
}

/** The sun's position at a latitude, declination, and hour angle (all degrees). */
export function sunPosition(latitude: number, decl: number, hourAngle: number): Sun {
  const phi = toRadians(latitude);
  const d = toRadians(decl);
  const w = toRadians(hourAngle);
  const sinAlt = Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(w);
  const altitude = toDegrees(Math.asin(Math.max(-1, Math.min(1, sinAlt))));
  const zenith = 90 - altitude;
  const cosZ = sinAlt;
  const sinZ = Math.sqrt(Math.max(0, 1 - cosZ * cosZ));
  let azimuth = 0;
  // At solar noon the sun is due south, or due north when it is nearer the pole than the observer.
  if (hourAngle === 0) azimuth = latitude >= decl ? 0 : 180;
  else if (sinZ > 1e-9 && Math.abs(Math.cos(phi)) > 1e-12) {
    const cosAz = Math.max(-1, Math.min(1, (cosZ * Math.sin(phi) - Math.sin(d)) / (sinZ * Math.cos(phi))));
    azimuth = (hourAngle < 0 ? -1 : 1) * toDegrees(Math.acos(cosAz));
  }
  return { declination: decl, hourAngle, altitude, zenith, azimuth };
}

/** Sunrise and sunset as hour angles (± degrees), or 'up' or 'down' for a polar day or night. */
export function sunriseHourAngle(latitude: number, decl: number): number | 'up' | 'down' {
  const x = -Math.tan(toRadians(latitude)) * Math.tan(toRadians(decl));
  if (x <= -1) return 'up';
  if (x >= 1) return 'down';
  return toDegrees(Math.acos(x));
}

/**
 * The cosine of the angle between the sun's rays and the normal of a tilted surface (Duffie and Beckman).
 * Tilt is from horizontal; the surface azimuth is from south, positive toward the west.
 */
export function cosIncidence(
  latitude: number,
  decl: number,
  hourAngle: number,
  tilt: number,
  surfaceAzimuth: number,
): number {
  const [phi, d, w, b, g] = [latitude, decl, hourAngle, tilt, surfaceAzimuth].map(toRadians) as [
    number,
    number,
    number,
    number,
    number,
  ];
  return (
    Math.sin(d) * Math.sin(phi) * Math.cos(b) -
    Math.sin(d) * Math.cos(phi) * Math.sin(b) * Math.cos(g) +
    Math.cos(d) * Math.cos(phi) * Math.cos(b) * Math.cos(w) +
    Math.cos(d) * Math.sin(phi) * Math.sin(b) * Math.cos(g) * Math.cos(w) +
    Math.cos(d) * Math.sin(b) * Math.sin(g) * Math.sin(w)
  );
}

// ---- NOAA solar position ----

export interface Noaa {
  /** Julian day of the instant, from the date, clock time and time zone. */
  jd: number;
  /** Declination of the sun (degrees). */
  declination: number;
  /** Equation of time (minutes): apparent solar time minus mean solar time. */
  equationOfTime: number;
  /** True solar time (minutes after midnight, 0 to 1440). */
  solarTime: number;
  /** Hour angle (degrees), 0 at solar noon and negative in the morning. */
  hourAngle: number;
  /** Clock times in minutes after local midnight; null on a polar day or night. */
  sunrise: number | null;
  sunset: number | null;
  solarNoon: number;
}

/** The Julian day of a calendar date and universal time in hours (Gregorian calendar). */
export function julianDay(year: number, month: number, day: number, utcHours: number): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getTime() / 86400000 + 2440587.5 + utcHours / 24;
}

const sinD = (deg: number): number => Math.sin(toRadians(deg));
const cosD = (deg: number): number => Math.cos(toRadians(deg));

/**
 * The NOAA solar position algorithm (Meeus, as in NOAA's solar calculator): sun declination and equation of time from
 * the Julian century, then true solar time from the clock time, longitude (east positive), and time zone (hours east
 * of UTC). Good to about 0.01 degrees for 1900 to 2100.
 */
export function noaaSun(args: {
  year: number;
  month: number;
  day: number;
  /** Local clock time in hours after midnight. */
  clock: number;
  /** Hours east of UTC, such as -5 for US Eastern standard time. */
  zone: number;
  latitude: number;
  longitude: number;
}): Noaa {
  const { year, month, day, clock, zone, latitude, longitude } = args;
  const jd = julianDay(year, month, day, clock - zone);
  const t = (jd - 2451545) / 36525;
  const l0 = (((280.46646 + t * (36000.76983 + t * 0.0003032)) % 360) + 360) % 360;
  const m = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const center =
    sinD(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    sinD(2 * m) * (0.019993 - 0.000101 * t) +
    sinD(3 * m) * 0.000289;
  const trueLong = l0 + center;
  const omega = 125.04 - 1934.136 * t;
  const apparentLong = trueLong - 0.00569 - 0.00478 * sinD(omega);
  const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * cosD(omega);
  const decl = toDegrees(Math.asin(sinD(obliquity) * sinD(apparentLong)));
  const y = Math.tan(toRadians(obliquity / 2)) ** 2;
  const eot =
    4 *
    toDegrees(
      y * Math.sin(2 * toRadians(l0)) -
        2 * e * Math.sin(toRadians(m)) +
        4 * e * y * Math.sin(toRadians(m)) * Math.cos(2 * toRadians(l0)) -
        0.5 * y * y * Math.sin(4 * toRadians(l0)) -
        1.25 * e * e * Math.sin(2 * toRadians(m)),
    );
  const solarTime = (((clock * 60 + eot + 4 * longitude - 60 * zone) % 1440) + 1440) % 1440;
  const hourAngle = solarTime / 4 - 180;
  const noonUtc = 720 - 4 * longitude - eot;
  // Sunrise and sunset use a zenith of 90.833 degrees: the solar radius plus atmospheric refraction.
  const cosHa =
    cosD(90.833) / (cosD(latitude) * cosD(decl)) - Math.tan(toRadians(latitude)) * Math.tan(toRadians(decl));
  const x = Math.abs(cosHa) <= 1 ? toDegrees(Math.acos(cosHa)) : null;
  const toClock = (utcMinutes: number): number => utcMinutes + 60 * zone;
  return {
    jd,
    declination: decl,
    equationOfTime: eot,
    solarTime,
    hourAngle,
    sunrise: x !== null ? toClock(noonUtc - 4 * x) : null,
    sunset: x !== null ? toClock(noonUtc + 4 * x) : null,
    solarNoon: toClock(noonUtc),
  };
}

// ---- Photovoltaics ----

export interface Pv {
  cellTemperature: number;
  /** Output of the array (W). */
  power: number;
  /** Output at 25 °C cell temperature, for comparison (W). */
  nominal: number;
}

/**
 * Array output: P = G A η [1 − β (Tcell − 25 °C)], with Tcell = Tamb + (NOCT − 20 °C) G / 800 W/m².
 * β is the power temperature coefficient per kelvin (about 0.004 for crystalline silicon).
 */
export function pvOutput(g: number, area: number, efficiency: number, ambient: number, noct: number, beta: number): Pv {
  if (!(efficiency > 0 && efficiency <= 1)) fail('efficiency');
  const cell = ambient + ((noct - 20) / 800) * g;
  const nominal = g * area * efficiency;
  return { cellTemperature: cell, power: nominal * (1 - beta * (cell - 25)), nominal };
}

// ---- Emissions ----

export interface FuelDef {
  /** Molar mass of the fuel (g/mol). */
  molar: number;
  /** Carbon atoms per molecule. */
  carbon: number;
  /** Lower heating value per mole (kJ/mol), from the standard enthalpy of combustion with water as vapor. */
  lhv: number;
}

/** Fuels from their formulas and standard enthalpies of combustion (NIST Chemistry WebBook data). */
export const FUELS: Record<string, FuelDef> = {
  methane: { molar: 16.043, carbon: 1, lhv: 802.3 },
  ethane: { molar: 30.07, carbon: 2, lhv: 1428.6 },
  propane: { molar: 44.097, carbon: 3, lhv: 2043.1 },
  butane: { molar: 58.123, carbon: 4, lhv: 2657.5 },
  carbon: { molar: 12.011, carbon: 1, lhv: 393.5 },
};

export const CO2_MOLAR = 44.009;

/** Kilograms of CO₂ per kilowatt-hour of heat in the fuel (LHV basis). */
export function co2PerFuelKwh(fuel: FuelDef): number {
  const kwhPerMole = fuel.lhv / 3600;
  return (fuel.carbon * CO2_MOLAR) / 1000 / kwhPerMole;
}

/** Kilograms of CO₂ per kilowatt-hour of useful output for a plant of the given efficiency. */
export function co2PerOutputKwh(fuel: FuelDef, efficiency: number): number {
  if (!(efficiency > 0 && efficiency <= 1)) fail('efficiency');
  return co2PerFuelKwh(fuel) / efficiency;
}

// ---- Cost ----

/** The capital recovery factor i (1 + i)^n / ((1 + i)^n − 1), or 1/n when the rate is zero. */
export function capitalRecovery(rate: number, years: number): number {
  if (!(years > 0)) fail('positive', { field: 'lifetime' });
  if (rate < 0) fail('nonNegative', { field: 'discountRate' });
  if (rate === 0) return 1 / years;
  const growth = (1 + rate) ** years;
  return (rate * growth) / (growth - 1);
}

export interface Lcoe {
  crf: number;
  /** Annual energy per kW of capacity (kWh). */
  annualKwh: number;
  /** Dollars per kWh. */
  value: number;
}

/**
 * Levelized cost of energy: (capital cost per kW × CRF + fixed O&M per kW-year) / (8760 h × capacity factor) plus
 * the variable cost per kWh (fuel and variable O&M).
 */
export function lcoe(
  capital: number,
  rate: number,
  years: number,
  cf: number,
  fixedOm: number,
  variable: number,
): Lcoe {
  if (!(cf > 0 && cf <= 1)) fail('capacityFactor');
  if (!(capital >= 0)) fail('nonNegative', { field: 'capitalCost' });
  const crf = capitalRecovery(rate, years);
  const annualKwh = 8760 * cf;
  return { crf, annualKwh, value: (capital * crf + fixedOm) / annualKwh + variable };
}

// ---- Energy units ----

/** Joules in each unit (exact definitions; the BTU is the International Table BTU). */
export const ENERGY_UNITS: Record<string, number> = {
  J: 1,
  kJ: 1e3,
  MJ: 1e6,
  GJ: 1e9,
  kWh: 3.6e6,
  MWh: 3.6e9,
  GWh: 3.6e12,
  BTU: 1055.05585262,
  therm: 1055.05585262e5,
  kcal: 4184,
  toe: 4.1868e10,
  boe: 6.119e9,
  tTNT: 4.184e9,
};

export function convertEnergy(value: number, from: string): Record<string, number> {
  const joules = ENERGY_UNITS[from];
  if (joules === undefined) return fail('unit', { unit: from });
  return Object.fromEntries(Object.entries(ENERGY_UNITS).map(([name, size]) => [name, (value * joules) / size]));
}
