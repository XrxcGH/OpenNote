// Seeded sample points and the numeric tests behind them: are two expressions the same, is an expression zero at a
// point, and where is it zero. Every test answers yes, no, or unsure, and "no" needs a clear margin, so rounding never
// turns a correct step into a broken one.
import { findRoots } from '../../../core/expr';

export type Values = Record<string, number>;
export type Fn = (values: Values) => number;

/** A small seeded random number generator (mulberry32): the same seed gives the same points. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A value to try: mostly between -3 and 3. Zero and the whole numbers, where forms often meet, are rare. */
function sampleValue(next: () => number, wide = false): number {
  const sign = next() < 0.35 ? -1 : 1;
  const size = wide ? 0.2 + next() * 9 : 0.15 + next() * 2.85;
  return sign * size;
}

export function samplePoint(names: readonly string[], next: () => number, wide = false): Values {
  const point: Values = {};
  for (const name of names) point[name] = sampleValue(next, wide);
  return point;
}

const usable = (value: number) => Number.isFinite(value) && Math.abs(value) < 1e12;

export type Same = 'same' | 'different' | 'mixed' | 'unknown';

export interface Comparison {
  result: Same;
  /** A point where the two differ, for the explanation. */
  at?: Values;
  values?: [number, number];
  /** The ratio b / a at every usable point when it is the same number everywhere, for "this is twice that". */
  ratio?: number;
  /** b - a when it is the same number everywhere, for "off by 3". */
  offset?: number;
}

const AGREE = 1e-7;
const DIFFER = 1e-4;

/** How two numbers compare: equal within rounding, clearly different, or too close to call. */
export function numbersCompare(a: number, b: number): 'same' | 'different' | 'unsure' {
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  const gap = Math.abs(a - b);
  if (gap <= AGREE * scale) return 'same';
  return gap > DIFFER * scale ? 'different' : 'unsure';
}

/** Compares two expressions at seeded points where both have a value. Needs six usable points to say anything. */
export function compareAt(fa: Fn, fb: Fn, names: readonly string[], seed: number, points = 24): Comparison {
  const next = rng(seed);
  let agree = 0;
  let differ = 0;
  let unsure = 0;
  // Points where both values are tiny say little: e^(5x) and 25 e^(5x) both round to 0 far to the left.
  let tiny = 0;
  let at: Values | undefined;
  let values: [number, number] | undefined;
  const ratios: number[] = [];
  const offsets: number[] = [];
  for (let tries = 0; tries < points * 4 && agree + differ + unsure + tiny < points; tries += 1) {
    const point = samplePoint(names, next, tries >= points * 2);
    const [a, b] = [fa(point), fb(point)];
    if (!usable(a) || !usable(b)) continue;
    const how = numbersCompare(a, b);
    if (names.length > 0 && Math.max(Math.abs(a), Math.abs(b)) < 1e-6) tiny += 1;
    else if (how === 'same') agree += 1;
    else if (how === 'unsure') unsure += 1;
    else {
      differ += 1;
      if (!at) [at, values] = [point, [a, b]];
      if (Math.abs(a) > 1e-9) ratios.push(b / a);
      offsets.push(b - a);
    }
    if (names.length === 0) break;
  }
  if (agree + differ + unsure < 6) agree += tiny;
  const total = agree + differ + unsure;
  if (names.length === 0 && total === 1) {
    if (agree) return { result: 'same' };
    if (differ) return { result: 'different', at: {}, values, offset: offsets[0], ratio: ratios[0] };
    return { result: 'unknown' };
  }
  if (total < 6) return { result: 'unknown' };
  if (agree === total) return { result: 'same' };
  // Clearly different wherever the values are big enough to tell, and nowhere the same.
  if (agree === 0 && differ >= 6 && differ >= 2 * unsure) {
    const steady = (list: number[]) =>
      list.length === differ && list.length > 0 && list.every((x) => numbersCompare(x, list[0]) === 'same')
        ? list[0]
        : undefined;
    return { result: 'different', at, values, ratio: steady(ratios), offset: steady(offsets) };
  }
  return agree > 0 ? { result: 'mixed', at, values } : { result: 'unknown' };
}

/** Whether f is zero at the point: its value is tiny, or it changes sign right beside it. */
export function zeroAt(f: Fn, scale: Fn, point: Values): 'yes' | 'no' | 'unsure' {
  const value = f(point);
  const size = 1 + Math.abs(scale(point));
  if (!Number.isFinite(value)) return 'unsure';
  if (Math.abs(value) <= 1e-7 * size) return 'yes';
  for (const name of Object.keys(point)) {
    const delta = 1e-6 * (1 + Math.abs(point[name]));
    const below = f({ ...point, [name]: point[name] - delta });
    const above = f({ ...point, [name]: point[name] + delta });
    if (Number.isFinite(below) && Number.isFinite(above) && Math.sign(below) !== Math.sign(above)) return 'yes';
  }
  return Math.abs(value) > 1e-3 * size ? 'no' : 'unsure';
}

/** Points where f is zero: for one name its roots, for more, roots along each name with the others at sample values. */
export function zeros(f: Fn, names: readonly string[], seed: number, most = 10): Values[] {
  const found: Values[] = [];
  if (names.length === 0) return found;
  const next = rng(seed + 7);
  const slices = names.length === 1 ? 1 : 3;
  for (const name of names) {
    for (let s = 0; s < slices && found.length < most; s += 1) {
      const base = samplePoint(names, next);
      const along = (t: number) => f({ ...base, [name]: t });
      const near = findRoots(along, { range: 60, steps: 6000, limit: most });
      const far = findRoots(along, { range: 5000, steps: 2000, limit: 4 }).filter((t) => Math.abs(t) > 60);
      // A "root" where f only fades toward 0, as e^x - e^(2x) does far to the left, is not a solution.
      const fades = (t: number) => {
        const step = Math.max(1, 0.1 * Math.abs(t));
        return [along(t - step), along(t + step)].every((v) => !Number.isFinite(v) || Math.abs(v) < 1e-6);
      };
      for (const t of [...near, ...far]) if (found.length < most && !fades(t)) found.push({ ...base, [name]: t });
    }
    if (names.length === 1) break;
  }
  return found;
}
