// Tolerance stack-ups, fits, and position tolerance. All lengths share one unit (mm or in); the engine does not care.
import { bad, finite, fmt } from './types';
import type { Outcome, Step } from './types';

export interface StackItem {
  name: string;
  /** Nominal size; the direction sign is applied separately. */
  nominal: number;
  /** The dimension may be anywhere from nominal - minus to nominal + plus (both >= 0). */
  plus: number;
  minus: number;
  /** +1 when the dimension adds to the gap, -1 when it subtracts. */
  sign: 1 | -1;
}

export interface StackResult {
  nominal: number;
  worstMin: number;
  worstMax: number;
  /** How far the worst case reaches above and below the nominal. */
  worstPlus: number;
  worstMinus: number;
  /** Statistical (RSS) mean, half-band, and limits. */
  rssMean: number;
  rss: number;
  rssMin: number;
  rssMax: number;
  /** Each item's share of the worst-case band and of the RSS variance, 0 to 1. */
  share: { name: string; worst: number; rss: number }[];
  steps: Step[];
}

function checkItems(items: StackItem[]): string | null {
  if (items.length === 0) return 'stackEmpty';
  for (const i of items) {
    if (!finite(i.nominal, i.plus, i.minus)) return 'notNumber';
    if (i.plus < 0 || i.minus < 0) return 'negativeTolerance';
  }
  return null;
}

/** Worst-case and root-sum-square stack. */
export function stack(items: StackItem[]): Outcome<StackResult> {
  const err = checkItems(items);
  if (err) return bad(err);
  let nominal = 0;
  let up = 0;
  let down = 0;
  let shift = 0;
  let sumSq = 0;
  for (const i of items) {
    nominal += i.sign * i.nominal;
    // A +1 item raises the gap by up to `plus` and lowers it by up to `minus`; a -1 item does the reverse.
    up += i.sign === 1 ? i.plus : i.minus;
    down += i.sign === 1 ? i.minus : i.plus;
    shift += (i.sign * (i.plus - i.minus)) / 2;
    const half = (i.plus + i.minus) / 2;
    sumSq += half * half;
  }
  const rss = Math.sqrt(sumSq);
  const mean = nominal + shift;
  const total = up + down;
  const share = items.map((i) => {
    const half = (i.plus + i.minus) / 2;
    return {
      name: i.name,
      worst: total === 0 ? 0 : (i.plus + i.minus) / total,
      rss: sumSq === 0 ? 0 : (half * half) / sumSq,
    };
  });
  const steps: Step[] = [
    { key: 'nominal', latex: `N=\\sum s_i n_i=${fmt(nominal)}` },
    { key: 'worst', latex: `${fmt(nominal - down)}\\le N\\le ${fmt(nominal + up)}` },
    { key: 'rss', latex: `t_{\\mathrm{RSS}}=\\sqrt{\\textstyle\\sum t_i^2}=${fmt(rss)}` },
  ];
  return {
    ok: true,
    nominal,
    worstMin: nominal - down,
    worstMax: nominal + up,
    worstPlus: up,
    worstMinus: down,
    rssMean: mean,
    rss,
    rssMin: mean - rss,
    rssMax: mean + rss,
    share,
    steps,
  };
}

/** A small seeded generator (mulberry32) so a Monte Carlo run repeats. */
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

export type Distribution = 'uniform' | 'normal';

export interface MonteCarloResult {
  mean: number;
  sd: number;
  min: number;
  max: number;
  /** Fraction of assemblies inside the limits, when limits were given. */
  inside: number | null;
  bins: { from: number; to: number; count: number }[];
}

/**
 * Seeded Monte Carlo of a stack. Uniform draws fill the whole band; normal draws take the band as plus and minus
 * three sigma, truncated at the band.
 */
export function monteCarlo(
  items: StackItem[],
  dist: Distribution,
  runs: number,
  seed: number,
  limits?: { lo: number; hi: number },
): Outcome<MonteCarloResult> {
  const err = checkItems(items);
  if (err) return bad(err);
  if (!Number.isInteger(runs) || runs < 10 || runs > 1_000_000) return bad('runsRange');
  const rand = rng(seed);
  const gauss = () => Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-300))) * Math.cos(2 * Math.PI * rand());
  const out = new Float64Array(runs);
  for (let r = 0; r < runs; r++) {
    let sum = 0;
    for (const i of items) {
      const lo = i.nominal - i.minus;
      const hi = i.nominal + i.plus;
      const v =
        dist === 'uniform'
          ? lo + (hi - lo) * rand()
          : Math.min(hi, Math.max(lo, (lo + hi) / 2 + ((hi - lo) / 6) * gauss()));
      sum += i.sign * v;
    }
    out[r] = sum;
  }
  let mean = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const v of out) {
    mean += v;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  mean /= runs;
  let ss = 0;
  for (const v of out) ss += (v - mean) ** 2;
  const nb = 24;
  const width = (max - min) / nb || 1;
  const bins = Array.from({ length: nb }, (_, k) => ({ from: min + k * width, to: min + (k + 1) * width, count: 0 }));
  for (const v of out) bins[Math.min(nb - 1, Math.floor((v - min) / width))]!.count++;
  let inside: number | null = null;
  if (limits) {
    let n = 0;
    for (const v of out) if (v >= limits.lo && v <= limits.hi) n++;
    inside = n / runs;
  }
  return { ok: true, mean, sd: Math.sqrt(ss / (runs - 1)), min, max, inside, bins };
}

export type FitKind = 'clearance' | 'transition' | 'interference';

export interface FitResult {
  kind: FitKind;
  /** Largest and smallest clearance; a negative value is interference. */
  maxClearance: number;
  minClearance: number;
  steps: Step[];
}

/** Fit from hole and shaft limits (the user enters them; ISO 286 tables are not bundled). */
export function fit(hole: { min: number; max: number }, shaft: { min: number; max: number }): Outcome<FitResult> {
  if (!finite(hole.min, hole.max, shaft.min, shaft.max)) return bad('notNumber');
  if (hole.min <= 0 || shaft.min <= 0) return bad('sizePositive');
  if (hole.max < hole.min || shaft.max < shaft.min) return bad('limitsOrder');
  const maxC = hole.max - shaft.min;
  const minC = hole.min - shaft.max;
  const kind: FitKind = minC >= 0 ? 'clearance' : maxC <= 0 ? 'interference' : 'transition';
  const steps: Step[] = [
    { key: 'maxClearance', latex: `C_{\\max}=D_{\\max}-d_{\\min}=${fmt(hole.max)}-${fmt(shaft.min)}=${fmt(maxC)}` },
    { key: 'minClearance', latex: `C_{\\min}=D_{\\min}-d_{\\max}=${fmt(hole.min)}-${fmt(shaft.max)}=${fmt(minC)}` },
  ];
  return { ok: true, kind, maxClearance: maxC, minClearance: minC, steps };
}

export interface PositionResult {
  /** Diameter of the cylindrical zone the feature actually uses. */
  position: number;
  bonus: number;
  allowed: number;
  pass: boolean;
  steps: Step[];
}

/**
 * True position: the zone diameter used is 2 sqrt(dx^2 + dy^2). At MMC or LMC the allowed zone grows by the amount
 * the feature size departs from that condition (the bonus, `departure` >= 0). RFS gets no bonus.
 */
export function position(
  dx: number,
  dy: number,
  tolerance: number,
  modifier: 'RFS' | 'MMC' | 'LMC',
  departure: number,
): Outcome<PositionResult> {
  if (!finite(dx, dy, tolerance, departure)) return bad('notNumber');
  if (tolerance <= 0) return bad('tolerancePositive');
  if (departure < 0) return bad('departureNegative');
  const pos = 2 * Math.hypot(dx, dy);
  const bonus = modifier === 'RFS' ? 0 : departure;
  const allowed = tolerance + bonus;
  const steps: Step[] = [
    { key: 'position', latex: `\\varnothing_{pos}=2\\sqrt{\\Delta x^2+\\Delta y^2}=${fmt(pos)}` },
    { key: 'allowed', latex: `\\varnothing_{ok}=t+\\mathrm{bonus}=${fmt(tolerance)}+${fmt(bonus)}=${fmt(allowed)}` },
  ];
  return { ok: true, position: pos, bonus, allowed, pass: pos <= allowed + 1e-12, steps };
}
