// Population genetics: allele and genotype frequencies, Hardy-Weinberg tests (chi-square and the exact test of
// Wigginton, Cutler, and Abecasis 2005), inbreeding, selection, mutation, migration, drift, effective size, linkage
// disequilibrium, and the breeder's equation. Pure functions; problems are thrown as KitErrors.
import { Rng } from '../../subjects/num/rng';
import { fail } from '../shared';
import { chiSquareP } from '../stats';

export interface GenotypeCount {
  a: string;
  b: string;
  count: number;
}

/** Genotype lines such as "A/a 489" or "AA 298" (one letter per allele when there is no slash). */
export function readGenotypes(text: string): GenotypeCount[] {
  const out: GenotypeCount[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const words = line.split(/[\s:=,]+/).filter(Boolean);
    const count = Number(words[1]?.replace(/−/g, '-'));
    const name = words[0] ?? '';
    if (words.length !== 2 || !Number.isFinite(count)) return fail('popgen.e.genotypeLine', { line });
    if (count < 0 || !Number.isInteger(count)) return fail('popgen.e.count', { line });
    const parts = name.includes('/') ? name.split('/') : name.length === 2 ? [...name] : [];
    if (parts.length !== 2 || parts.some((p) => p === '')) return fail('popgen.e.genotypeName', { name });
    out.push({ a: parts[0]!, b: parts[1]!, count });
  }
  return out.length > 0 ? out : fail('popgen.e.noGenotypes');
}

export interface HweClass {
  a: string;
  b: string;
  observed: number;
  expected: number;
}

export interface Hwe {
  alleles: string[];
  freqs: number[];
  n: number;
  classes: HweClass[];
  chi2: number;
  df: number;
  p: number;
  observedHet: number;
  expectedHet: number;
  /** 1 − Ho/He. */
  f: number;
  /** The exact test's p-value, for two alleles only. */
  exactP: number | null;
}

/** Allele frequencies by counting and the Hardy-Weinberg chi-square over every possible genotype. */
export function hardyWeinberg(genotypes: readonly GenotypeCount[]): Hwe {
  const alleles: string[] = [];
  for (const g of genotypes) for (const x of [g.a, g.b]) if (!alleles.includes(x)) alleles.push(x);
  if (alleles.length < 2) return fail('popgen.e.oneAllele');
  const n = genotypes.reduce((s, g) => s + g.count, 0);
  if (n === 0) return fail('popgen.e.noIndividuals');
  const copies = alleles.map((x) =>
    genotypes.reduce((s, g) => s + g.count * (Number(g.a === x) + Number(g.b === x)), 0),
  );
  const freqs = copies.map((c) => c / (2 * n));
  const classes: HweClass[] = [];
  for (let i = 0; i < alleles.length; i++) {
    for (let j = i; j < alleles.length; j++) {
      const a = alleles[i]!;
      const b = alleles[j]!;
      const observed = genotypes
        .filter((g) => (g.a === a && g.b === b) || (g.a === b && g.b === a))
        .reduce((s, g) => s + g.count, 0);
      const expected = i === j ? n * freqs[i]! ** 2 : 2 * n * freqs[i]! * freqs[j]!;
      classes.push({ a, b, observed, expected });
    }
  }
  const chi2 = classes.reduce((s, c) => s + (c.expected > 0 ? (c.observed - c.expected) ** 2 / c.expected : 0), 0);
  const df = (alleles.length * (alleles.length - 1)) / 2;
  const het = classes.filter((c) => c.a !== c.b);
  const observedHet = het.reduce((s, c) => s + c.observed, 0) / n;
  const expectedHet = 1 - freqs.reduce((s, p) => s + p * p, 0);
  let exactP: number | null = null;
  if (alleles.length === 2) {
    const [aa, ab, bb] = [classes[0]!.observed, classes[1]!.observed, classes[2]!.observed];
    exactP = hweExact(ab, aa, bb);
  }
  return {
    alleles,
    freqs,
    n,
    classes,
    chi2,
    df,
    p: chiSquareP(chi2, df),
    observedHet,
    expectedHet,
    f: expectedHet > 0 ? 1 - observedHet / expectedHet : 0,
    exactP,
  };
}

/** The Hardy-Weinberg exact test p-value for one biallelic locus (Wigginton, Cutler, and Abecasis 2005). */
export function hweExact(het: number, homA: number, homB: number): number {
  const homRare = Math.min(homA, homB);
  const homCommon = Math.max(homA, homB);
  const n = het + homRare + homCommon;
  const rare = 2 * homRare + het;
  if (n === 0) return 1;
  const probs = new Array<number>(rare + 1).fill(0);
  let mid = Math.floor((rare * (2 * n - rare)) / (2 * n));
  if ((rare - mid) % 2 !== 0) mid += 1;
  probs[mid] = 1;
  let sum = 1;
  let hr = (rare - mid) / 2;
  let hc = n - mid - hr;
  for (let h = mid; h > 1; h -= 2) {
    probs[h - 2] = (probs[h]! * h * (h - 1)) / (4 * (hr + 1) * (hc + 1));
    sum += probs[h - 2]!;
    hr += 1;
    hc += 1;
  }
  hr = (rare - mid) / 2;
  hc = n - mid - hr;
  for (let h = mid; h <= rare - 2; h += 2) {
    probs[h + 2] = (probs[h]! * 4 * hr * hc) / ((h + 2) * (h + 1));
    sum += probs[h + 2]!;
    hr -= 1;
    hc -= 1;
  }
  const target = probs[het]! / sum;
  let p = 0;
  for (const value of probs) if (value / sum <= target * (1 + 1e-9)) p += value / sum;
  return Math.min(1, p);
}

/** The frequency of A at an X-linked locus: females carry 2 copies, males 1. */
export function xLinked(fAA: number, fAa: number, faa: number, mA: number, ma: number) {
  const copies = 2 * (fAA + fAa + faa) + mA + ma;
  if (copies === 0) return fail('popgen.e.noIndividuals');
  const p = (2 * fAA + fAa + mA) / copies;
  const females = fAA + fAa + faa;
  const males = mA + ma;
  return {
    p,
    q: 1 - p,
    femaleP: females > 0 ? (2 * fAA + fAa) / (2 * females) : NaN,
    maleP: males > 0 ? mA / males : NaN,
    copies,
  };
}

/** Inbreeding by path counting: F = Σ (1/2)^n (1 + F_A) over the paths, n counting the people on each loop. */
export function pathF(paths: readonly { n: number; fa: number }[]): number {
  return paths.reduce((s, path) => s + 0.5 ** path.n * (1 + path.fa), 0);
}

// ---- Selection ----

export interface Fitness {
  AA: number;
  Aa: number;
  aa: number;
}

/** One generation of selection on frequency p of A, with the mean fitness. */
export function selectOnce(p: number, w: Fitness): { p: number; mean: number } {
  const q = 1 - p;
  const mean = p * p * w.AA + 2 * p * q * w.Aa + q * q * w.aa;
  if (!(mean > 0)) return fail('popgen.e.noFitness');
  return { p: (p * (p * w.AA + q * w.Aa)) / mean, mean };
}

export function trajectory(p0: number, w: Fitness, generations: number): number[] {
  const out = [p0];
  for (let t = 0; t < generations; t++) out.push(selectOnce(out[t]!, w).p);
  return out;
}

/** The interior equilibrium of A, and whether it is stable (heterozygote advantage) or not; null when there is none. */
export function equilibrium(w: Fitness): { p: number; stable: boolean } | null {
  const denominator = 2 * w.Aa - w.AA - w.aa;
  if (denominator === 0) return null;
  const p = (w.Aa - w.aa) / denominator;
  if (!(p > 0 && p < 1)) return null;
  return { p, stable: w.Aa > w.AA && w.Aa > w.aa };
}

/** Mutation-selection balance for a harmful allele: √(µ/s) when recessive, µ/(h s) otherwise. */
export function mutationBalance(mu: number, s: number, h: number): number {
  if (!(s > 0)) return fail('popgen.e.noSelection');
  return h === 0 ? Math.sqrt(mu / s) : mu / (h * s);
}

/** A under forward mutation µ (A to a) and back mutation ν: its equilibrium and its value after t generations. */
export function mutationPressure(p0: number, mu: number, nu: number, t: number) {
  const total = mu + nu;
  const pHat = total > 0 ? nu / total : p0;
  return { pHat, p: pHat + (p0 - pHat) * (1 - total) ** t };
}

/** The island model: each generation a fraction m of the island comes from a mainland with frequency pm. */
export const migration = (p0: number, pm: number, m: number, t: number): number => pm + (p0 - pm) * (1 - m) ** t;

// ---- Drift ----

export const heterozygosity = (h0: number, n: number, t: number): number => h0 * (1 - 1 / (2 * n)) ** t;

export interface DriftRun {
  /** Frequency of A in each replicate at each generation. */
  paths: number[][];
  fixed: number;
  lost: number;
  meanHet: number[];
}

/** Wright-Fisher drift: each generation 2N gene copies are drawn from the last generation's frequency. */
export function wrightFisher(n: number, p0: number, generations: number, replicates: number, seed: bigint): DriftRun {
  const rng = new Rng(seed);
  const paths: number[][] = [];
  const hetSum = new Array<number>(generations + 1).fill(0);
  let fixed = 0;
  let lost = 0;
  for (let r = 0; r < replicates; r++) {
    const path = [p0];
    let p = p0;
    hetSum[0]! += 2 * p * (1 - p);
    for (let t = 1; t <= generations; t++) {
      p = rng.binomial(2 * n, p) / (2 * n);
      path.push(p);
      hetSum[t]! += 2 * p * (1 - p);
    }
    if (p === 1) fixed += 1;
    if (p === 0) lost += 1;
    paths.push(path);
  }
  return { paths, fixed, lost, meanHet: hetSum.map((h) => h / replicates) };
}

/** The harmonic mean of population sizes over generations. */
export function harmonicNe(sizes: readonly number[]): number {
  if (sizes.length === 0) return fail('popgen.e.noSizes');
  if (sizes.some((s) => !(s > 0))) return fail('popgen.e.sizePositive');
  return sizes.length / sizes.reduce((s, n) => s + 1 / n, 0);
}

export function sexRatioNe(males: number, females: number): number {
  if (!(males > 0 && females > 0)) return fail('popgen.e.sexes');
  return (4 * males * females) / (males + females);
}

// ---- Linkage disequilibrium ----

export interface Ld {
  pA: number;
  pB: number;
  d: number;
  dMax: number;
  dPrime: number;
  r2: number;
}

/** D, D′, and r² from the four haplotype frequencies or counts, in the order AB, Ab, aB, ab. */
export function linkage(AB: number, Ab: number, aB: number, ab: number): Ld {
  const total = AB + Ab + aB + ab;
  if ([AB, Ab, aB, ab].some((v) => v < 0)) return fail('popgen.e.negative');
  if (!(total > 0)) return fail('popgen.e.noHaplotypes');
  const [x11, x12, x21] = [AB / total, Ab / total, aB / total];
  const pA = x11 + x12;
  const pB = x11 + x21;
  const qa = 1 - pA;
  const qb = 1 - pB;
  const d = x11 - pA * pB;
  const dMax = d >= 0 ? Math.min(pA * qb, qa * pB) : Math.min(pA * pB, qa * qb);
  const denominator = pA * qa * pB * qb;
  if (!(denominator > 0)) return fail('popgen.e.monomorphic');
  return { pA, pB, d, dMax, dPrime: dMax > 0 ? d / dMax : 0, r2: (d * d) / denominator };
}

// ---- Quantitative genetics ----

/** Least-squares slope and intercept of y on x. */
export function regression(
  x: readonly number[],
  y: readonly number[],
): { slope: number; intercept: number; r: number } {
  if (x.length !== y.length) return fail('popgen.e.pairs');
  if (x.length < 3) return fail('popgen.e.fewPairs');
  const mx = x.reduce((a, b) => a + b, 0) / x.length;
  const my = y.reduce((a, b) => a + b, 0) / y.length;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  x.forEach((xi, i) => {
    sxy += (xi - mx) * (y[i]! - my);
    sxx += (xi - mx) ** 2;
    syy += (y[i]! - my) ** 2;
  });
  if (sxx === 0) return fail('popgen.e.sameParents');
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r: syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy) };
}
