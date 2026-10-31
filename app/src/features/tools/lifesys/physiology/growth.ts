// The CDC 2000 growth-chart LMS tables for ages 2 to 20 years, so the growth z-score can find L, M, and S from age,
// sex, and measure without the person looking them up.
//
// Source: CDC / National Center for Health Statistics, "Percentile Data Files with LMS Values"
// (https://www.cdc.gov/growthcharts/percentile_data_files.htm): wtage.csv (weight-for-age), statage.csv
// (stature-for-age), and bmiagerev.csv (BMI-for-age), unchanged since the charts' release on 30 May 2000.
// License: public domain. It is a work of the United States government (17 U.S.C. section 105).
// data/cdcLms.json keeps each file's Agemos, L, M, and S columns at their published precision, by sex. Every row was
// checked against the file's own P3, P50, and P97 columns (M (1 + L S z)^(1/L) agrees to 1 part in 10^8).
//
// The tables load in a chunk of their own when the physiology tab first opens (kit.ts awaits loadGrowth).
import { LsError } from '../num/errors';

export type GrowthMeasure = 'weight' | 'stature' | 'bmi';
export type GrowthSex = 'male' | 'female';

type Lms = [number, number, number];
type Table = { ages: number[]; male: Lms[]; female: Lms[] };
type Tables = Record<GrowthMeasure, Table>;

let tables: Tables | null = null;

/** Loads the tables once; later calls return at once. */
export async function loadGrowth(): Promise<void> {
  tables ??= (await import('./data/cdcLms.json')).default as unknown as Tables;
}

/** The youngest and oldest age in months the tables for a measure cover. */
export function growthRange(measure: GrowthMeasure): { low: number; high: number } {
  const ages = loaded()[measure].ages;
  return { low: ages[0]!, high: ages.at(-1)! };
}

function loaded(): Tables {
  if (!tables) throw new LsError('physiology.e.lmsLoading');
  return tables;
}

/** L, M, and S at an age in months, interpolated linearly between the tables' rows (each row is at its Agemos). */
export function growthLms(measure: GrowthMeasure, sex: GrowthSex, months: number): { l: number; m: number; s: number } {
  const table = loaded()[measure];
  const { ages } = table;
  const rows = table[sex];
  if (!Number.isFinite(months) || months < ages[0]! || months > ages.at(-1)!) {
    throw new LsError('physiology.e.lmsAge', { low: ages[0]! / 12, high: ages.at(-1)! / 12 });
  }
  let hi = ages.findIndex((age) => age >= months);
  if (ages[hi] === months) {
    const [l, m, s] = rows[hi]!;
    return { l, m, s };
  }
  hi = Math.max(hi, 1);
  const lo = hi - 1;
  const f = (months - ages[lo]!) / (ages[hi]! - ages[lo]!);
  const mix = (i: 0 | 1 | 2) => rows[lo]![i] + f * (rows[hi]![i] - rows[lo]![i]);
  return { l: mix(0), m: mix(1), s: mix(2) };
}
