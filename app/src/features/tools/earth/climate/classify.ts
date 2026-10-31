// Climate classification from 12 monthly normals. Köppen-Geiger follows the rules of Peel, Finlayson, and McMahon
// (2007) and records each rule it tests, in order, so the student sees the path. The Holdridge life zone comes from
// biotemperature and annual precipitation: the hexagon whose center is nearest in the chart's log axes.
import { check } from '../core/problem';

export interface Normals {
  /** Mean temperature of each month, January first, °C. */
  t: readonly number[];
  /** Precipitation of each month, mm. */
  p: readonly number[];
  south: boolean;
}

/** One rule tested: what it says, with the numbers, and whether it held. */
export interface Test {
  rule: string;
  vars: Record<string, string | number>;
  held: boolean;
}

export interface Koppen {
  code: string;
  tests: Test[];
  mat: number;
  map: number;
  hot: number;
  cold: number;
  threshold: number;
  summerShare: number;
}

export function checkNormals(n: Normals): void {
  check(n.t.length === 12 && n.p.length === 12, 'twelve');
  check(
    n.t.every((v) => Number.isFinite(v) && v > -90 && v < 60),
    'monthTemperature',
  );
  check(
    n.p.every((v) => Number.isFinite(v) && v >= 0),
    'monthPrecipitation',
  );
}

const round = (v: number, places = 1) => Number(v.toFixed(places));
const sum = (values: readonly number[]) => values.reduce((s, v) => s + v, 0);

/** The months of summer (April to September north, October to March south), as indexes. */
export const summerMonths = (south: boolean): number[] => (south ? [9, 10, 11, 0, 1, 2] : [3, 4, 5, 6, 7, 8]);

/** Köppen-Geiger as Peel et al. (2007): E first, then B, then A, C, or D with their second and third letters. */
export function koppen(n: Normals): Koppen {
  checkNormals(n);
  const tests: Test[] = [];
  const test = (rule: string, held: boolean, vars: Record<string, string | number> = {}) => {
    tests.push({ rule, held, vars });
    return held;
  };
  const mat = sum(n.t) / 12;
  const map = sum(n.p);
  const hot = Math.max(...n.t);
  const cold = Math.min(...n.t);
  const summer = summerMonths(n.south);
  const winter = [...Array(12).keys()].filter((i) => !summer.includes(i));
  const ps = summer.map((i) => n.p[i]);
  const pw = winter.map((i) => n.p[i]);
  const summerShare = map > 0 ? sum(ps) / map : 0.5;
  const threshold = summerShare <= 0.3 ? 2 * mat : summerShare >= 0.7 ? 2 * mat + 28 : 2 * mat + 14;
  const base = { mat: round(mat, 2), map: round(map), hot: round(hot), cold: round(cold) };
  const pth = { ...base, pth: round(threshold, 2), pth10: round(10 * threshold, 1), pth5: round(5 * threshold, 1) };
  const out = (code: string): Koppen => ({ code, tests, mat, map, hot, cold, threshold, summerShare });
  if (test('polar', hot < 10, base)) return out(test('frost', hot <= 0, base) ? 'EF' : 'ET');
  test('threshold', true, { ...pth, share: round(100 * summerShare) });
  if (test('arid', map < 10 * threshold, pth)) {
    const desert = test('desert', map < 5 * threshold, pth);
    const warm = test('hotArid', mat >= 18, base);
    return out(`B${desert ? 'W' : 'S'}${warm ? 'h' : 'k'}`);
  }
  const dry = Math.min(...n.p);
  if (test('tropical', cold >= 18, base)) {
    if (test('rainforest', dry >= 60, { dry })) return out('Af');
    const limit = 100 - map / 25;
    return out(test('monsoon', dry >= limit, { dry, limit: round(limit, 2) }) ? 'Am' : 'Aw');
  }
  const group = test('temperate', cold > 0, base) ? 'C' : 'D';
  const sDry = Math.min(...ps);
  const wWet = Math.max(...pw);
  const wDry = Math.min(...pw);
  const sWet = Math.max(...ps);
  let second = 'f';
  if (test('drySummer', sDry < 40 && sDry < wWet / 3, { sDry, wWet, third: round(wWet / 3, 2) })) second = 's';
  else if (test('dryWinter', wDry < sWet / 10, { wDry, sWet, tenth: round(sWet / 10, 2) })) second = 'w';
  else test('noDrySeason', true);
  const warmMonths = n.t.filter((v) => v >= 10).length;
  let third: string;
  if (test('hotSummer', hot >= 22, base)) third = 'a';
  else if (test('warmSummer', warmMonths >= 4, { months: warmMonths })) third = 'b';
  else if (group === 'D' && test('severe', cold < -38, base)) third = 'd';
  else third = 'c';
  return out(`${group}${second}${third}`);
}

/** Walter-Lieth months: temperature and precipitation, with dry months where P < 2T (10 °C matches 20 mm). */
export function dryMonths(n: Normals): number[] {
  return [...Array(12).keys()].filter((i) => n.p[i] < 2 * n.t[i]);
}

export type Belt = 'polar' | 'subpolar' | 'boreal' | 'coolTemperate' | 'warmTemperate' | 'subtropical' | 'tropical';

export const PROVINCES = [
  'superhumid',
  'perhumid',
  'humid',
  'subhumid',
  'semiarid',
  'arid',
  'perarid',
  'superarid',
] as const;
export type Province = (typeof PROVINCES)[number];

const WARM = ['rainForest', 'wetForest', 'moistForest', 'dryForest', 'thornSteppe', 'desertScrub', 'desert'] as const;

/** The life zones of each belt from the wettest to the driest province that the belt has on the chart. */
const ZONES: Record<Exclude<Belt, 'polar'>, readonly string[]> = {
  subpolar: ['rainTundra', 'wetTundra', 'moistTundra', 'dryTundra'],
  boreal: ['rainForest', 'wetForest', 'moistForest', 'dryScrub', 'desert'],
  coolTemperate: ['rainForest', 'wetForest', 'moistForest', 'steppe', 'desertScrub', 'desert'],
  warmTemperate: WARM,
  subtropical: WARM,
  tropical: [
    'rainForest',
    'wetForest',
    'moistForest',
    'dryForest',
    'veryDryForest',
    'thornWoodland',
    'desertScrub',
    'desert',
  ],
};

export interface Holdridge {
  biotemperature: number;
  precipitation: number;
  /** Potential evapotranspiration ratio, 58.93 BT/P. */
  ratio: number;
  belt: Belt;
  province: Province;
  zone: string;
}

/** Biotemperature: the mean of the monthly temperatures with those below 0 °C or above 30 °C counted as 0. */
export const biotemperature = (t: readonly number[]): number => sum(t.map((v) => (v < 0 || v > 30 ? 0 : v))) / t.length;

/** Hexagonal rounding in the chart's three log axes (biotemperature, precipitation, ratio), which sum to a constant. */
function nearestHexagon(x: number, y: number): [number, number] {
  const q = x;
  const r = -y;
  const s = y - x;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return [rq, -rr];
}

/**
 * The Holdridge life zone. Belts double in biotemperature from 1.5 °C and precipitation bands double from 62.5 mm,
 * so a hexagon's center sits at the middle of a band on every axis. The belt from 12 to 24 °C splits into warm
 * temperate below 17 °C, near the frost line, and subtropical above it.
 */
export function holdridge(bio: number, precipitation: number): Holdridge {
  check(bio >= 0 && bio <= 30, 'biotemperature');
  check(precipitation > 0, 'annualPrecipitation');
  const ratio = bio > 0 ? (58.93 * bio) / precipitation : 0;
  if (bio < 1.5)
    return { biotemperature: bio, precipitation, ratio, belt: 'polar', province: 'superhumid', zone: 'polarDesert' };
  const x = Math.log2(bio / 1.5) - 0.5;
  const y = Math.log2(precipitation / 62.5) - 0.5;
  const [i0, j0] = nearestHexagon(x, y);
  const i = Math.max(0, Math.min(4, i0));
  const belts = ['subpolar', 'boreal', 'coolTemperate', 'warmTemperate', 'tropical'] as const;
  let belt: Exclude<Belt, 'polar'> = belts[i];
  if (belt === 'warmTemperate' && bio >= 17) belt = 'subtropical';
  const zones = ZONES[belt];
  // Band j counts up from the belt's driest zone; the ratio's band, counted from superhumid, is then 3 + i − j.
  const j = Math.max(0, Math.min(zones.length - 1, j0));
  const zone = zones[zones.length - 1 - j];
  const province = PROVINCES[Math.max(0, Math.min(7, 3 + i - j))];
  return { biotemperature: bio, precipitation, ratio, belt, province, zone };
}
