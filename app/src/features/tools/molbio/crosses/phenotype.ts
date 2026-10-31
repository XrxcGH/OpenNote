// Phenotypes of the children of a cross: complete dominance by capital letters or a dominance order for multiple
// alleles (IA = IB > i), incomplete dominance and codominance (each genotype its own class), the classic two-gene
// epistasis ratios, lethal genotypes, and a phenotype map the student writes.
import { fail } from '../shared';
import { fAdd, frac } from '../stats';
import type { Frac } from '../stats';
import { genotypeText, isY, matches, parseGenotype } from './genotype';
import type { Child, Genotype } from './genotype';

export const DOMINANCE = ['complete', 'incomplete', 'e97', 'e934', 'e1231', 'e151', 'e133', 'e961', 'custom'] as const;
export type Dominance = (typeof DOMINANCE)[number];

export interface PhenoOptions {
  dominance: Dominance;
  /** Allele levels from most to least dominant, such as [['IA', 'IB'], ['i']]. */
  hierarchy: string[][] | null;
  rules: { pattern: Genotype; name: string }[];
  elseName: string | null;
}

const core = (allele: string) => (allele.startsWith('X') && allele.length > 1 ? allele.slice(1) : allele);
const capital = (allele: string) => /^[A-Z]/.test(core(allele));

/** Reads a dominance order such as "IA = IB > i". */
export function readHierarchy(text: string): string[][] | null {
  const t = text.trim();
  if (t === '') return null;
  const levels = t.split('>').map((level) =>
    level
      .split('=')
      .map((a) => a.trim())
      .filter(Boolean),
  );
  if (levels.some((level) => level.length === 0)) return fail('crosses.e.hierarchy');
  return levels;
}

/** Reads "pattern = name" lines, with an optional "else = name" last. */
export function readRules(text: string, genes: number): Pick<PhenoOptions, 'rules' | 'elseName'> {
  const rules: PhenoOptions['rules'] = [];
  let elseName: string | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    const at = line.indexOf('=');
    if (at < 1) return fail('crosses.e.rule', { line });
    const left = line.slice(0, at).trim();
    const name = line.slice(at + 1).trim();
    if (name === '') return fail('crosses.e.rule', { line });
    if (left.toLowerCase() === 'else') elseName = name;
    else {
      const pattern = parseGenotype(left, 'crosses.f.rules', true);
      if (pattern.length !== genes) return fail('crosses.e.patternGenes', { genes: String(genes) });
      rules.push({ pattern, name });
    }
  }
  return { rules, elseName };
}

function geneClass(pair: [string, string], gene: Genotype[number], hierarchy: string[][] | null): string {
  const [a, b] = pair;
  const join = (x: string, y: string) => (gene.short ? `${x}${y}` : `${x}/${y}`);
  if (gene.x && isY(b)) return join(a, b);
  if (hierarchy) {
    const level = (allele: string) => hierarchy.findIndex((l) => l.includes(allele));
    if (level(a) >= 0 && level(b) >= 0) {
      const top = Math.min(level(a), level(b));
      return [...new Set([a, b].filter((allele) => level(allele) === top))].join('/');
    }
  }
  const sameGene = core(a).toLowerCase() === core(b).toLowerCase();
  // Pairs are ordered capital first, so a capital first allele means the dominant phenotype.
  if (!sameGene) return join(a, b);
  return capital(a) ? join(a, '_') : join(a, b);
}

const dominant = (pair: [string, string]) => capital(pair[0]) || capital(pair[1]);

function epistasis(child: Child, template: Genotype, dominance: Dominance): string {
  const [g1, g2] = child.genes;
  if (!g1 || !g2 || template[0]!.x || template[1]!.x) return fail('crosses.e.epistasisGenes');
  const up = (pair: [string, string]) => core(pair[0]).toUpperCase();
  const A = up(g1);
  const a = A.toLowerCase();
  const B = up(g2);
  const b = B.toLowerCase();
  const names = {
    AB: `${A}_${B}_`,
    Abb: `${A}_${b}${b}`,
    aaB: `${a}${a}${B}_`,
    aabb: `${a}${a}${b}${b}`,
  };
  const d1 = dominant(g1);
  const d2 = dominant(g2);
  const cls = d1 && d2 ? 'AB' : d1 ? 'Abb' : d2 ? 'aaB' : 'aabb';
  const groups: Record<string, string[][]> = {
    e97: [['AB'], ['Abb', 'aaB', 'aabb']],
    e934: [['AB'], ['Abb'], ['aaB', 'aabb']],
    e1231: [['AB', 'Abb'], ['aaB'], ['aabb']],
    e151: [['AB', 'Abb', 'aaB'], ['aabb']],
    e133: [['AB', 'Abb', 'aabb'], ['aaB']],
    e961: [['AB'], ['Abb', 'aaB'], ['aabb']],
  };
  const group = groups[dominance]!.find((g) => g.includes(cls))!;
  return group.map((k) => names[k as keyof typeof names]).join(', ');
}

/** The phenotype class of one child, as text for the tables. */
export function phenotypeOf(child: Child, template: Genotype, options: PhenoOptions): string {
  if (options.dominance === 'custom') {
    const rule = options.rules.find((r) => matches(child.genes, r.pattern));
    return rule?.name ?? options.elseName ?? genotypeText(child.genes, template);
  }
  if (options.dominance === 'incomplete') return genotypeText(child.genes, template);
  const rest = child.genes.map((pair, i) => geneClass(pair, template[i]!, options.hierarchy));
  if (options.dominance === 'complete') return template.every((g) => g.short) ? rest.join('') : rest.join(' ');
  const head = epistasis(child, template, options.dominance);
  const tail = rest.slice(2);
  return tail.length === 0 ? head : `${head}; ${tail.join(template.every((g) => g.short) ? '' : ' ')}`;
}

/** Whether a child carries a lethal genotype at any gene, written like "YY" or "AY/AY". */
export function lethal(child: Child, template: Genotype, lethalText: string): boolean {
  const list = lethalText.split(/[\s,;]+/).filter(Boolean);
  return list.some((entry) =>
    child.genes.some((pair, i) => {
      const text = template[i]!.short ? pair.join('') : pair.join('/');
      const flipped = template[i]!.short ? `${pair[1]}${pair[0]}` : `${pair[1]}/${pair[0]}`;
      return entry === text || entry === flipped;
    }),
  );
}

export interface ClassShare {
  label: string;
  sex: Child['sex'];
  p: Frac;
}

/** Shares of each phenotype class, by sex when sex matters, most common first. */
export function phenotypeShares(children: Child[], template: Genotype, options: PhenoOptions): ClassShare[] {
  const map = new Map<string, ClassShare>();
  for (const child of children) {
    const label = phenotypeOf(child, template, options);
    const key = `${child.sex}|${label}`;
    const seen = map.get(key);
    map.set(key, seen ? { ...seen, p: fAdd(seen.p, child.p) } : { label, sex: child.sex, p: child.p });
  }
  const byLabel = (x: ClassShare, y: ClassShare) => (x.label < y.label ? -1 : x.label > y.label ? 1 : 0);
  // Genotype classes read best in allele order (RR, Rr, rr gives 1:2:1); phenotypes most common first (9:3:3:1).
  if (options.dominance === 'incomplete') return [...map.values()].sort(byLabel);
  return [...map.values()].sort((x, y) => y.p.n * x.p.d - x.p.n * y.p.d || byLabel(x, y));
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/** Whole-number ratio of shares, such as 9:3:3:1. */
export function ratio(shares: Frac[]): number[] {
  const lcm = shares.reduce((l, s) => (l * s.d) / gcd(l, s.d), 1);
  const ints = shares.map((s) => (s.n * lcm) / s.d);
  const g = ints.reduce((x, y) => gcd(x, y), 0) || 1;
  return ints.map((v) => v / g);
}

/** Children with the lethal genotypes removed and the rest scaled up to sum to 1. */
export function survivors(children: Child[], template: Genotype, lethalText: string): Child[] {
  if (lethalText.trim() === '') return children;
  const alive = children.filter((c) => !lethal(c, template, lethalText));
  if (alive.length === 0) return fail('crosses.e.allLethal');
  const total = alive.reduce((s, c) => fAdd(s, c.p), frac(0));
  return alive.map((c) => ({ ...c, p: frac(c.p.n * total.d, c.p.d * total.n) }));
}
