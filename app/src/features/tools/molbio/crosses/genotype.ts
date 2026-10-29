// Genotypes, gametes and offspring of a cross. A genotype is written gene by gene: single-letter pairs run together
// (AaBb, YyRr), or alleles joined by a slash for longer names and sex-linked genes (IA/i, XA/Xa, Xa/Y). Genes pair up
// across the parents by position and assort independently; X-linked genes follow the sex of each child.
import { fail } from '../shared';
import type { MolKey } from '../shared';
import { fAdd, fMul, frac } from '../stats';
import type { Frac } from '../stats';

export interface GeneCall {
  alleles: [string, string];
  /** On the X chromosome; a male carries Y as the second allele. */
  x: boolean;
  /** Written as two single letters, so it prints without a slash. */
  short: boolean;
}

export type Genotype = GeneCall[];

/** A Y chromosome allele: Y alone, or Y with a Y-linked allele after it (Yh). */
export const isY = (allele: string): boolean => allele.startsWith('Y');

function shorthand(run: string, field: MolKey): GeneCall[] {
  if (run.length % 2 !== 0) return fail('crosses.e.oddLetters', { text: run, field });
  const out: GeneCall[] = [];
  for (let i = 0; i < run.length; i += 2) {
    const a = run[i]!;
    const b = run[i + 1]!;
    if (a.toLowerCase() !== b.toLowerCase() && a !== '_' && b !== '_') {
      return fail('crosses.e.pair', { pair: a + b, field });
    }
    out.push({ alleles: [a, b], x: false, short: true });
  }
  return out;
}

/** Reads one parent's genotype (or, with `wild`, a pattern where _ stands for any allele). */
export function parseGenotype(text: string, field: MolKey, wild = false): Genotype {
  const groups = text.trim().split(/\s+/).filter(Boolean);
  if (groups.length === 0) return fail('crosses.e.noGenotype', { field });
  const genes: Genotype = [];
  for (const group of groups) {
    const allowed = wild ? /^[A-Za-z0-9_+/-]+$/ : /^[A-Za-z0-9+/-]+$/;
    if (!allowed.test(group)) return fail('crosses.e.badChar', { text: group, field });
    if (!group.includes('/')) {
      genes.push(...shorthand(group, field));
      continue;
    }
    const parts = group.split('/');
    if (parts.length !== 2 || parts.some((p) => p === '')) return fail('crosses.e.slash', { text: group, field });
    const [a, b] = parts as [string, string];
    const x = a.startsWith('X') && (b.startsWith('X') || isY(b) || b === '_');
    if (!x && (b === 'Y' || a === 'Y')) return fail('crosses.e.yAlone', { text: group, field });
    genes.push({ alleles: [a, b], x, short: false });
  }
  return genes;
}

/** Dominant-looking alleles first: a capital before a small letter, then by name; on the X, a Y always last. */
export function order(a: string, b: string, x = false): [string, string] {
  if (x && isY(b)) return [a, b];
  if (x && isY(a)) return [b, a];
  const core = (s: string) => (s.startsWith('X') && s.length > 1 ? s.slice(1) : s);
  const capA = /^[A-Z]/.test(core(a));
  const capB = /^[A-Z]/.test(core(b));
  if (capA !== capB) return capA ? [a, b] : [b, a];
  return a <= b ? [a, b] : [b, a];
}

export interface Gamete {
  alleles: string[];
  p: Frac;
}

/** Gametes by independent assortment: each gene gives either allele with probability 1/2. */
export function gametes(genotype: Genotype): Gamete[] {
  let list: Gamete[] = [{ alleles: [], p: frac(1) }];
  for (const gene of genotype) {
    const next = new Map<string, Gamete>();
    for (const g of list) {
      for (const allele of gene.alleles) {
        const alleles = [...g.alleles, allele];
        const key = alleles.join(' ');
        const p = fMul(g.p, frac(1, 2));
        const seen = next.get(key);
        next.set(key, seen ? { alleles, p: fAdd(seen.p, p) } : { alleles, p });
      }
    }
    list = [...next.values()];
  }
  return list;
}

export type Sex = 'female' | 'male' | 'either';

export interface Child {
  genes: [string, string][];
  sex: Sex;
  p: Frac;
}

/** Which parent is the mother when an X-linked gene is present; throws if the sexes do not make a pair. */
export function sexes(p1: Genotype, p2: Genotype): { mother: 0 | 1 } | null {
  const xs = p1.map((gene, i) => [gene.x, p2[i]!.x] as const);
  if (!xs.some(([a, b]) => a || b)) return null;
  if (xs.some(([a, b]) => a !== b)) return fail('crosses.e.xMismatch');
  const male = (g: Genotype) => g.some((gene) => gene.x && isY(gene.alleles[1]));
  const m1 = male(p1);
  const m2 = male(p2);
  if (m1 === m2) return fail('crosses.e.sexPair');
  return { mother: m1 ? 1 : 0 };
}

const letter = (gene: GeneCall) => gene.alleles[0].toLowerCase();

export function checkPair(p1: Genotype, p2: Genotype): void {
  if (p1.length !== p2.length) return fail('crosses.e.geneCount', { a: String(p1.length), b: String(p2.length) });
  if (p1.length > 4) return fail('crosses.e.tooManyGenes');
  // Genes on one X are linked, so independent assortment would be wrong for 2 of them.
  if (p1.filter((gene) => gene.x).length > 1) return fail('crosses.e.oneX');
  p1.forEach((gene, i) => {
    const other = p2[i]!;
    if (gene.short && other.short && letter(gene) !== letter(other)) {
      fail('crosses.e.geneOrder', { a: gene.alleles.join(''), b: other.alleles.join(''), n: String(i + 1) });
    }
  });
}

/** Offspring of every pair of gametes, with equal genotypes merged. */
export function offspring(p1: Genotype, p2: Genotype): Child[] {
  checkPair(p1, p2);
  const sexInfo = sexes(p1, p2);
  const merged = new Map<string, Child>();
  for (const g1 of gametes(p1)) {
    for (const g2 of gametes(p2)) {
      const genes = g1.alleles.map((a, i) => order(a, g2.alleles[i]!, p1[i]!.x));
      const hasY = genes.some((pair, i) => p1[i]!.x && isY(pair[1]));
      const sex: Sex = sexInfo === null ? 'either' : hasY ? 'male' : 'female';
      const key = `${sex}|${genes.map((pair) => pair.join('/')).join(' ')}`;
      const p = fMul(g1.p, g2.p);
      const seen = merged.get(key);
      merged.set(key, seen ? { ...seen, p: fAdd(seen.p, p) } : { genes, sex, p });
    }
  }
  return [...merged.values()];
}

/** A genotype for display: single-letter genes run together, others joined by slashes and spaces. */
export function genotypeText(genes: readonly (readonly [string, string])[], template: Genotype): string {
  const parts = genes.map((pair, i) => (template[i]?.short ? pair.join('') : pair.join('/')));
  return template.every((gene) => gene.short) ? parts.join('') : parts.join(' ');
}

/** Whether a child matches a pattern gene by gene, _ matching any allele, in either allele order. */
export function matches(genes: [string, string][], pattern: Genotype): boolean {
  if (pattern.length !== genes.length) return fail('crosses.e.patternGenes', { genes: String(genes.length) });
  return genes.every(([a, b], i) => {
    const [x, y] = pattern[i]!.alleles;
    const fits = (u: string, v: string) => (x === '_' || x === u) && (y === '_' || y === v);
    return fits(a, b) || fits(b, a);
  });
}
