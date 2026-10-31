// Gene mapping: recombination frequency and the Haldane and Kosambi map functions, the three-point test cross
// (gene order from the double crossovers, distances, coincidence and interference), and LOD scores.
import { fail } from '../shared';

/** Haldane map distance in cM for recombination fraction r < 0.5: d = -50 ln(1 - 2r). */
export const haldane = (r: number): number => (r >= 0.5 ? Infinity : -50 * Math.log(1 - 2 * r));

/** Kosambi map distance in cM: d = 25 ln((1 + 2r)/(1 - 2r)). */
export const kosambi = (r: number): number => (r >= 0.5 ? Infinity : 25 * Math.log((1 + 2 * r) / (1 - 2 * r)));

export interface ClassCount {
  /** One allele symbol per gene, + for wild type. */
  alleles: string[];
  count: number;
}

export interface ThreePoint {
  /** Column indices of the genes in map order: left, middle, right. */
  order: [number, number, number];
  genes: string[];
  total: number;
  parental: ClassCount[];
  double: ClassCount[];
  singleLeft: ClassCount[];
  singleRight: ClassCount[];
  rLeft: number;
  rRight: number;
  expectedDouble: number;
  coincidence: number;
  interference: number;
}

/** Reads lines of 3 allele symbols and a count, such as "+ b c 55". */
export function readClasses(text: string): ClassCount[] {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split(/[\s,]+/);
      const count = Number(parts.at(-1));
      if (parts.length !== 4 || !Number.isInteger(count) || count < 0) return fail('crosses.e.classLine', { line });
      return { alleles: parts.slice(0, 3), count };
    });
  if (rows.length !== 8) return fail('crosses.e.eightClasses', { count: String(rows.length) });
  return rows;
}

const key = (c: ClassCount) => c.alleles.join(' ');

/** Whether two classes are each other's reciprocal: different at every gene. */
const reciprocal = (a: ClassCount, b: ClassCount) => a.alleles.every((x, i) => x !== b.alleles[i]);

function geneNames(classes: ClassCount[]): string[] {
  return [0, 1, 2].map((i) => classes.map((c) => c.alleles[i]!).find((a) => a !== '+') ?? `gene ${i + 1}`);
}

/** Gene order, distances, coincidence, and interference from the 8 classes of a three-point test cross. */
export function threePoint(classes: ClassCount[]): ThreePoint {
  const sorted = [...classes].sort((a, b) => b.count - a.count);
  const total = classes.reduce((s, c) => s + c.count, 0);
  if (total === 0) return fail('e.noCounts');
  if (new Set(classes.map(key)).size !== 8) return fail('crosses.e.duplicateClass');
  const parental = [sorted[0]!, sorted.find((c) => reciprocal(c, sorted[0]!))!];
  if (!parental[1] || parental[1] !== sorted[1]) return fail('crosses.e.parentals');
  const double = [sorted[7]!, sorted[6]!];
  if (!reciprocal(double[0]!, double[1]!)) return fail('crosses.e.doubles');
  // The middle gene is the one a double crossover swaps relative to the parental class it otherwise matches.
  const p = parental.find((c) => c.alleles.filter((x, i) => x === double[0]!.alleles[i]).length === 2);
  if (!p) return fail('crosses.e.doubles');
  const middle = p.alleles.findIndex((x, i) => x !== double[0]!.alleles[i]);
  const [left, right] = [0, 1, 2].filter((i) => i !== middle) as [number, number];
  const singles = sorted.slice(2, 6);
  const isLeft = (c: ClassCount) => {
    const q = parental.find((x) => x.alleles[middle] === c.alleles[middle])!;
    return c.alleles[left] !== q.alleles[left];
  };
  const singleLeft = singles.filter(isLeft);
  const singleRight = singles.filter((c) => !isLeft(c));
  const sum = (list: ClassCount[]) => list.reduce((s, c) => s + c.count, 0);
  const dco = sum(double);
  const rLeft = (sum(singleLeft) + dco) / total;
  const rRight = (sum(singleRight) + dco) / total;
  const expectedDouble = rLeft * rRight * total;
  const coincidence = expectedDouble === 0 ? NaN : dco / expectedDouble;
  return {
    order: [left, middle, right],
    genes: geneNames(classes),
    total,
    parental,
    double,
    singleLeft,
    singleRight,
    rLeft,
    rRight,
    expectedDouble,
    coincidence,
    interference: 1 - coincidence,
  };
}

export interface Family {
  recombinants: number;
  meioses: number;
}

/** LOD(theta) summed over families; phase-unknown families average the two phases. */
export function lod(families: Family[], theta: number, phaseKnown: boolean): number {
  let total = 0;
  for (const { recombinants: r, meioses: n } of families) {
    const nr = n - r;
    const known = (a: number, b: number) => (theta === 0 ? (a === 0 ? 1 : 0) : theta ** a) * (1 - theta) ** b;
    const likelihood = phaseKnown ? known(r, nr) : 0.5 * (known(r, nr) + known(nr, r));
    total += Math.log10(likelihood / 0.5 ** n);
  }
  return total;
}

/** Reads lines of "recombinants meioses". */
export function readFamilies(text: string): Family[] {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [a, b, ...rest] = line.split(/[\s,]+/).map(Number);
      if (rest.length > 0 || !Number.isInteger(a) || !Number.isInteger(b) || a! < 0 || b! < 1 || a! > b!) {
        return fail('crosses.e.familyLine', { line });
      }
      return { recombinants: a!, meioses: b! };
    });
  return rows.length > 0 ? rows : fail('crosses.e.noFamilies');
}

/** The theta in [0, 0.5] with the highest LOD, on a grid of 0.0005 then refined by golden section. */
export function maxLod(families: Family[], phaseKnown: boolean): { theta: number; lod: number } {
  let best = { theta: 0.5, lod: lod(families, 0.5, phaseKnown) };
  for (let k = 0; k <= 1000; k++) {
    const theta = k * 0.0005;
    const value = lod(families, theta, phaseKnown);
    if (value > best.lod + 1e-12) best = { theta, lod: value };
  }
  let lo = Math.max(0, best.theta - 0.0005);
  let hi = Math.min(0.5, best.theta + 0.0005);
  const golden = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 60; i++) {
    const a = hi - golden * (hi - lo);
    const b = lo + golden * (hi - lo);
    if (lod(families, a, phaseKnown) >= lod(families, b, phaseKnown)) hi = b;
    else lo = a;
  }
  const theta = (lo + hi) / 2;
  const value = lod(families, theta, phaseKnown);
  return value >= best.lod ? { theta, lod: value } : best;
}
