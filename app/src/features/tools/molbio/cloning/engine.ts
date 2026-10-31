// Cloning arithmetic: restriction sites and digests on linear or circular DNA, band sizing from a ladder, primer
// melting temperatures (Wallace, salt-adjusted, nearest-neighbor), primer self-complementarity, PCR products, oligo
// mass and absorbance, and ligation amounts. Pure functions of plain values; problems are thrown as KitErrors.
import { fail } from '../shared';
import { compileMotif, matchesAt, revComp } from '../sequence/dna';
import { AVOGADRO, BP_MASS, ENZYMES, EPS_BASE, EPS_PAIR, NN, NN_INIT, RESIDUE } from './data';

export interface Enzyme {
  name: string;
  /** The recognition site in IUPAC letters, without the caret. */
  site: string;
  /** Bases of the site before the top-strand cut. */
  cut: number;
}

/** An enzyme from its site written with a caret, such as G^AATTC; throws when the caret or a letter is wrong. */
export function enzymeFrom(name: string, written: string): Enzyme {
  const text = written.toUpperCase();
  const caret = text.indexOf('^');
  if (caret === -1 || text.indexOf('^', caret + 1) !== -1) return fail('cloning.e.caret', { name });
  const site = text.replace('^', '');
  compileMotif(site);
  if (revComp(site) !== site) return fail('cloning.e.notPalindrome', { name });
  return { name, site, cut: caret };
}

const BUILT_IN = new Map(ENZYMES.map(([name, site]) => [name.toLowerCase(), enzymeFrom(name, site)]));

/** The built-in enzymes, for the list shown in the tool. */
export const builtInEnzymes = (): Enzyme[] => [...BUILT_IN.values()];

/**
 * Enzymes from a list such as "EcoRI, BamHI" or one per line; a line "MyEnz GG^CC" adds an enzyme of your own.
 * Throws on an unknown name.
 */
export function readEnzymes(text: string): Enzyme[] {
  const out: Enzyme[] = [];
  for (const raw of text.split(/[\n,;]+/)) {
    const words = raw.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) continue;
    if (words.length >= 2) {
      out.push(enzymeFrom(words[0]!, words[1]!));
      continue;
    }
    const known = BUILT_IN.get(words[0]!.toLowerCase());
    out.push(known ?? fail('cloning.e.unknownEnzyme', { name: words[0]! }));
  }
  return out.length > 0 ? out : fail('cloning.e.noEnzyme');
}

export interface Site {
  enzyme: string;
  /** 1-based position of the site's first base. */
  start: number;
  /** The top strand is cut after this base (1-based; 0 or the length mean an end of a linear molecule). */
  cutAfter: number;
}

/** Every site of each enzyme. On a circle the search runs across the origin. */
export function findSites(seq: string, enzymes: readonly Enzyme[], circular: boolean): Site[] {
  const n = seq.length;
  const sites: Site[] = [];
  for (const enzyme of enzymes) {
    const motif = compileMotif(enzyme.site);
    const size = motif.length;
    const text = circular ? seq + seq.slice(0, size - 1) : seq;
    const last = circular ? n - 1 : n - size;
    for (let i = 0; i <= last; i++) {
      if (!matchesAt(text, i, motif)) continue;
      let cutAfter = i + enzyme.cut;
      if (circular) cutAfter = ((cutAfter - 1 + n) % n) + 1;
      sites.push({ enzyme: enzyme.name, start: i + 1, cutAfter });
    }
  }
  return sites.sort((a, b) => a.cutAfter - b.cutAfter || a.enzyme.localeCompare(b.enzyme));
}

export interface Fragment {
  /** 1-based first and last base on the top strand; on a circle `to` may be before `from`. */
  from: number;
  to: number;
  length: number;
}

/** Top-strand fragments from cut positions. A cut at an end of a linear molecule does nothing. */
export function fragments(length: number, cuts: readonly number[], circular: boolean): Fragment[] {
  const inside = [...new Set(cuts.map((c) => (circular ? ((c % length) + length) % length : c)))]
    .filter((c) => circular || (c > 0 && c < length))
    .sort((a, b) => a - b);
  if (circular) {
    return inside.map((c, k) => {
      const next = k + 1 < inside.length ? inside[k + 1]! : inside[0]! + length;
      return { from: (c % length) + 1, to: ((next - 1) % length) + 1, length: next - c };
    });
  }
  const edges = [0, ...inside, length];
  return edges.slice(1).map((end, k) => ({ from: edges[k]! + 1, to: end, length: end - edges[k]! }));
}

/** The overhang an enzyme leaves: 5' or 3' and how long, or blunt. */
export function overhang(enzyme: Enzyme): { kind: 'five' | 'three' | 'blunt'; length: number } {
  const bottom = enzyme.site.length - enzyme.cut;
  if (bottom === enzyme.cut) return { kind: 'blunt', length: 0 };
  return bottom > enzyme.cut
    ? { kind: 'five', length: bottom - enzyme.cut }
    : { kind: 'three', length: enzyme.cut - bottom };
}

// ---- Band sizing ----

/** Least-squares polynomial coefficients c0 + c1 x + ... of `degree`, by the normal equations. */
export function polyFit(x: readonly number[], y: readonly number[], degree: number): number[] {
  const m = degree + 1;
  const a: number[][] = Array.from({ length: m }, () => new Array<number>(m + 1).fill(0));
  for (let k = 0; k < x.length; k++) {
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < m; j++) a[i]![j]! += x[k]! ** (i + j);
      a[i]![m]! += x[k]! ** i * y[k]!;
    }
  }
  for (let col = 0; col < m; col++) {
    let pivot = col;
    for (let r = col + 1; r < m; r++) if (Math.abs(a[r]![col]!) > Math.abs(a[pivot]![col]!)) pivot = r;
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    const p = a[col]![col]!;
    if (Math.abs(p) < 1e-12) return fail('cloning.e.ladderSame');
    for (let r = 0; r < m; r++) {
      if (r === col) continue;
      const f = a[r]![col]! / p;
      for (let c = col; c <= m; c++) a[r]![c]! -= f * a[col]![c]!;
    }
  }
  return a.map((row, i) => row[m]! / row[i]!);
}

export const polyAt = (c: readonly number[], x: number): number => c.reduce((sum, ck, k) => sum + ck * x ** k, 0);

export interface LadderFit {
  coefficients: number[];
  r2: number;
  size(distance: number): number;
}

/** A fit of log10(size) on migration distance: a line, or a cubic with at least 4 bands. */
export function fitLadder(sizes: readonly number[], distances: readonly number[], cubic: boolean): LadderFit {
  if (sizes.length !== distances.length) return fail('cloning.e.ladderPairs');
  const least = cubic ? 4 : 2;
  if (sizes.length < least) return fail('cloning.e.ladderFew', { count: String(least) });
  if (sizes.some((s) => !(s > 0))) return fail('cloning.e.ladderSize');
  if (distances.some((d) => d < 0)) return fail('cloning.e.ladderDistance');
  if (new Set(distances).size < least) return fail('cloning.e.ladderSame');
  const y = sizes.map((s) => Math.log10(s));
  const coefficients = polyFit(distances, y, cubic ? 3 : 1);
  const mean = y.reduce((a, b) => a + b, 0) / y.length;
  const ssTot = y.reduce((s, v) => s + (v - mean) ** 2, 0);
  const ssRes = y.reduce((s, v, k) => s + (v - polyAt(coefficients, distances[k]!)) ** 2, 0);
  return {
    coefficients,
    r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot,
    size: (distance) => 10 ** polyAt(coefficients, distance),
  };
}

// ---- Primers ----

export interface Counts {
  A: number;
  C: number;
  G: number;
  T: number;
}

export function counts(seq: string): Counts {
  const c: Counts = { A: 0, C: 0, G: 0, T: 0 };
  for (const b of seq) if (b === 'A' || b === 'C' || b === 'G' || b === 'T') c[b] += 1;
  return c;
}

/** Plain bases only: primers and oligos with ambiguity codes have no single melting temperature. */
export function plain(seq: string): string {
  const bad = [...seq].findIndex((b) => !'ACGT'.includes(b));
  return bad === -1 ? seq : fail('cloning.e.ambiguous', { char: seq[bad]!, position: String(bad + 1) });
}

/** Wallace rule: 2 °C per A or T and 4 °C per G or C, for short primers. */
export function wallace(seq: string): number {
  const c = counts(seq);
  return 2 * (c.A + c.T) + 4 * (c.G + c.C);
}

/** The basic salt-adjusted formula: 81.5 + 16.6 log10[Na+] + 0.41 (%GC) − 600/N, with [Na+] in mol/L. */
export function saltAdjusted(seq: string, sodium: number): number {
  const c = counts(seq);
  return 81.5 + 16.6 * Math.log10(sodium) + (41 * (c.G + c.C)) / seq.length - 600 / seq.length;
}

export interface NearestNeighbor {
  dH: number;
  dS1M: number;
  saltTerm: number;
  dS: number;
  selfComplementary: boolean;
  /** R ln(C_T / x) with x = 4 for two different strands, 1 for a self-complementary one. */
  concTerm: number;
  tm: number;
}

export const GAS_R = 1.987;

/** Two-state melting temperature by the unified nearest-neighbor parameters with the sodium entropy correction. */
export function nearestNeighbor(seq: string, sodium: number, total: number): NearestNeighbor {
  if (seq.length < 2) return fail('cloning.e.shortOligo');
  let dH = 0;
  let dS = 0;
  for (let i = 0; i + 1 < seq.length; i++) {
    const [h, s] = NN[seq.slice(i, i + 2)]!;
    dH += h;
    dS += s;
  }
  for (const end of [seq[0]!, seq[seq.length - 1]!]) {
    const [h, s] = end === 'G' || end === 'C' ? NN_INIT.GC : NN_INIT.AT;
    dH += h;
    dS += s;
  }
  const selfComplementary = revComp(seq) === seq;
  if (selfComplementary) dS += NN_INIT.symmetry[1];
  const saltTerm = 0.368 * (seq.length - 1) * Math.log(sodium);
  const dSNa = dS + saltTerm;
  const concTerm = GAS_R * Math.log(total / (selfComplementary ? 1 : 4));
  const tm = (1000 * dH) / (dSNa + concTerm) - 273.15;
  return { dH, dS1M: dS, saltTerm, dS: dSNa, selfComplementary, concTerm, tm };
}

export interface Pairing {
  /** The longest run of Watson-Crick pairs. */
  run: number;
  /** The longest run that includes a 3' end. */
  threeEnd: number;
}

const PAIR: Readonly<Record<string, string>> = { A: 'T', T: 'A', G: 'C', C: 'G' };

/** The longest complementary runs when `b` lines up antiparallel with `a` at every offset. */
export function dimer(a: string, b: string): Pairing {
  const rb = [...b].reverse().join('');
  let run = 0;
  let threeEnd = 0;
  for (let offset = -(rb.length - 1); offset < a.length; offset++) {
    let current = 0;
    let touchesEnd = false;
    for (let i = Math.max(0, offset); i < a.length && i - offset < rb.length; i++) {
      const j = i - offset;
      if (PAIR[a[i]!] === rb[j]) {
        current += 1;
        if (i === a.length - 1 || j === 0) touchesEnd = true;
        run = Math.max(run, current);
        if (touchesEnd) threeEnd = Math.max(threeEnd, current);
      } else {
        current = 0;
        touchesEnd = false;
      }
    }
  }
  return { run, threeEnd };
}

/** The longest stem a strand can fold into with a loop of at least 3 bases. */
export function hairpin(seq: string): number {
  let best = 0;
  for (let i = 0; i < seq.length; i++) {
    for (let j = seq.length - 1; j > i; j--) {
      let k = 0;
      while (PAIR[seq[i + k]!] === seq[j - k] && j - k - (i + k) - 1 >= 3) k += 1;
      best = Math.max(best, k);
    }
  }
  return best;
}

/** G and C among the last 5 bases at the 3' end. */
export const gcClamp = (seq: string): number => [...seq.slice(-5)].filter((b) => b === 'G' || b === 'C').length;

// ---- PCR ----

export interface Product {
  /** 1-based start of the forward primer and end of the reverse primer's site on the top strand. */
  from: number;
  to: number;
  length: number;
  seq: string;
  forwardHits: number;
  reverseHits: number;
}

function hits(seq: string, probe: string): number[] {
  const out: number[] = [];
  for (let i = seq.indexOf(probe); i !== -1; i = seq.indexOf(probe, i + 1)) out.push(i);
  return out;
}

/** The product of two primers that match the template exactly; the reverse primer is written 5'→3' as ordered. */
export function pcrProduct(template: string, forward: string, reverse: string, circular: boolean): Product {
  const n = template.length;
  const text = circular ? template + template.slice(0, Math.max(forward.length, reverse.length) - 1) : template;
  const site = revComp(reverse);
  const f = hits(text, forward).filter((i) => i < n);
  const r = hits(text, site).filter((i) => i < n);
  if (f.length === 0) return fail('cloning.e.noForward');
  if (r.length === 0) return fail('cloning.e.noReverse');
  const start = f[0]!;
  const ends = r.map((i) => i + site.length);
  const after = ends.find((end) => end >= start + forward.length);
  let length: number;
  if (after !== undefined && after - start <= n) length = after - start;
  else if (circular) length = ends[0]! + n - start;
  else return fail('cloning.e.wrongOrder');
  const seq = circular ? (template + template).slice(start, start + length) : template.slice(start, start + length);
  return {
    from: start + 1,
    to: ((start + length - 1) % n) + 1,
    length,
    seq,
    forwardHits: f.length,
    reverseHits: r.length,
  };
}

/** Rychlik's annealing temperature from the less stable primer's Tm and the product's Tm. */
export function annealing(
  primerTm: number,
  productGc: number,
  productLength: number,
  sodium: number,
): { productTm: number; ta: number } {
  const productTm = 81.5 + 16.6 * Math.log10(sodium) + 41 * productGc - 675 / productLength;
  return { productTm, ta: 0.3 * primerTm + 0.7 * productTm - 14.9 };
}

// ---- Oligos ----

/** Anhydrous mass of a 5'-OH single-stranded DNA oligo. */
export function oligoMass(seq: string): number {
  const c = counts(seq);
  return RESIDUE.A * c.A + RESIDUE.T * c.T + RESIDUE.C * c.C + RESIDUE.G * c.G + RESIDUE.end;
}

/** Extinction coefficient at 260 nm by nearest neighbors: pairs summed, inner bases subtracted. */
export function extinction(seq: string): number {
  if (seq.length === 1) return EPS_BASE[seq]!;
  let eps = 0;
  for (let i = 0; i + 1 < seq.length; i++) eps += EPS_PAIR[seq.slice(i, i + 2)]!;
  for (let i = 1; i + 1 < seq.length; i++) eps -= EPS_BASE[seq[i]!]!;
  return eps;
}

// ---- Amounts ----

/** Insert mass for a molar ratio of insert to vector. */
export const insertMass = (ratio: number, vectorNg: number, insertBp: number, vectorBp: number): number =>
  (ratio * vectorNg * insertBp) / vectorBp;

/** Moles of double-stranded DNA from nanograms and base pairs. */
export const moles = (ng: number, bp: number): number => (ng * 1e-9) / (bp * BP_MASS);

/** Copies of a double-stranded molecule in a mass. */
export const copies = (ng: number, bp: number): number => moles(ng, bp) * AVOGADRO;

export { AVOGADRO, BP_MASS };
