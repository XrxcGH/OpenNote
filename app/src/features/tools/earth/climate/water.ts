// Thornthwaite (1948) potential evapotranspiration, a monthly soil-water balance in the Thornthwaite-Mather style,
// and heating and cooling degree days. Temperatures are in °C and water depths in mm.
import { check } from '../core/problem';

export const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;
/** Day of the year in the middle of each month. */
const MID_DAY = [16, 45, 75, 105, 136, 166, 197, 228, 258, 289, 319, 350];

/** I = Σ (T/5)^1.514 over the months above 0 °C. */
export const heatIndex = (t: readonly number[]): number => t.reduce((s, v) => s + (v > 0 ? (v / 5) ** 1.514 : 0), 0);

/** a = 6.75e-7 I³ − 7.71e-5 I² + 1.792e-2 I + 0.49239. */
export const exponentA = (i: number): number => 6.75e-7 * i ** 3 - 7.71e-5 * i ** 2 + 1.792e-2 * i + 0.49239;

/**
 * Unadjusted PET for a 30-day month of 12-hour days, mm: 16 (10 T/I)^a, 0 at or below 0 °C, and above 26.5 °C the
 * table Thornthwaite gave, −415.85 + 32.24 T − 0.43 T² (as Willmott et al. 1985 fit it).
 */
export function petUnadjusted(temp: number, i: number, a: number): number {
  if (temp <= 0) return 0;
  if (temp > 26.5) return -415.85 + 32.24 * temp - 0.43 * temp * temp;
  return 16 * ((10 * temp) / i) ** a;
}

/** Hours of daylight at a latitude on a day of the year, from the sun's declination (Cooper 1969). */
export function dayLength(latitude: number, day: number): number {
  check(latitude >= -90 && latitude <= 90, 'latitude');
  const delta = ((23.45 * Math.PI) / 180) * Math.sin((2 * Math.PI * (284 + day)) / 365);
  const cosH = -Math.tan((latitude * Math.PI) / 180) * Math.tan(delta);
  if (cosH >= 1) return 0;
  if (cosH <= -1) return 24;
  return (24 / Math.PI) * Math.acos(cosH);
}

export interface Month {
  t: number;
  p: number;
  /** Unadjusted and adjusted PET, mm. */
  raw: number;
  pet: number;
  storage: number;
  aet: number;
  deficit: number;
  surplus: number;
}

export interface Balance {
  heat: number;
  a: number;
  months: Month[];
  totals: { p: number; pet: number; aet: number; deficit: number; surplus: number };
}

/**
 * The monthly balance: in a wet month storage fills to the soil's capacity and the rest is surplus; in a dry month
 * storage falls as S exp(−(PET − P)/capacity) and actual evapotranspiration is P plus what the soil gives. The year
 * is run until storage repeats, so December leads into January.
 */
export function waterBalance(t: readonly number[], p: readonly number[], latitude: number, capacity: number): Balance {
  check(t.length === 12 && p.length === 12, 'twelve');
  check(
    p.every((v) => v >= 0),
    'monthPrecipitation',
  );
  check(capacity > 0 && capacity <= 2000, 'capacity');
  const heat = heatIndex(t);
  check(heat > 0, 'allFrozen');
  const a = exponentA(heat);
  const raw = t.map((v) => petUnadjusted(v, heat, a));
  const pet = raw.map((v, m) => (v * dayLength(latitude, MID_DAY[m]) * MONTH_DAYS[m]) / (12 * 30));
  let storage = capacity;
  let months: Month[] = [];
  for (let pass = 0; pass < 50; pass++) {
    const start = storage;
    months = t.map((temp, m) => {
      const before = storage;
      let aet: number;
      let surplus = 0;
      if (p[m] >= pet[m]) {
        storage = Math.min(capacity, before + p[m] - pet[m]);
        surplus = before + p[m] - pet[m] - storage;
        aet = pet[m];
      } else {
        storage = before * Math.exp(-(pet[m] - p[m]) / capacity);
        aet = p[m] + before - storage;
      }
      return { t: temp, p: p[m], raw: raw[m], pet: pet[m], storage, aet, deficit: pet[m] - aet, surplus };
    });
    if (Math.abs(storage - start) < 1e-9) break;
  }
  const total = (key: 'p' | 'pet' | 'aet' | 'deficit' | 'surplus') => months.reduce((s, m) => s + m[key], 0);
  return {
    heat,
    a,
    months,
    totals: {
      p: total('p'),
      pet: total('pet'),
      aet: total('aet'),
      deficit: total('deficit'),
      surplus: total('surplus'),
    },
  };
}

/** Heating and cooling degree days from daily mean temperatures against a base, in the temperatures' own unit. */
export function degreeDays(means: readonly number[], base: number): { heating: number; cooling: number } {
  check(means.length > 0, 'noDays');
  return {
    heating: means.reduce((s, v) => s + Math.max(base - v, 0), 0),
    cooling: means.reduce((s, v) => s + Math.max(v - base, 0), 0),
  };
}
