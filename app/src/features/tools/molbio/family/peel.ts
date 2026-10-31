// Mendelian probabilities on a pedigree by peeling: each person's genotype is a variable, founders get Hardy-Weinberg
// priors, children get transmission probabilities from their parents, and affected statuses (and known carriers)
// are evidence. Variables are summed out one at a time, smallest factor first, until only the asked person is left.
import { fail } from '../shared';
import type { Family, Person } from './people';

export type Mode = 'ar' | 'ad' | 'xr' | 'xd';

/** States count copies of the disease allele: 0, 1, or 2, or 0 and 1 for an X-linked male. */
export const statesOf = (mode: Mode, p: Person): number => (mode.startsWith('x') && p.sex === 'M' ? 2 : 3);

interface Factor {
  vars: number[];
  sizes: number[];
  table: Float64Array;
}

function index(sizes: readonly number[], values: readonly number[]): number {
  let k = 0;
  for (let i = 0; i < sizes.length; i++) k = k * sizes[i]! + values[i]!;
  return k;
}

function* assignments(sizes: readonly number[]): Generator<number[]> {
  const total = sizes.reduce((a, b) => a * b, 1);
  const values = new Array<number>(sizes.length).fill(0);
  for (let k = 0; k < total; k++) {
    yield values;
    for (let i = sizes.length - 1; i >= 0; i--) {
      values[i]! += 1;
      if (values[i]! < sizes[i]!) break;
      values[i] = 0;
    }
  }
}

function multiply(a: Factor, b: Factor, size: (v: number) => number): Factor {
  const vars = [...new Set([...a.vars, ...b.vars])];
  const sizes = vars.map(size);
  const table = new Float64Array(sizes.reduce((x, y) => x * y, 1));
  const pa = a.vars.map((v) => vars.indexOf(v));
  const pb = b.vars.map((v) => vars.indexOf(v));
  let k = 0;
  for (const values of assignments(sizes)) {
    table[k++] =
      a.table[
        index(
          a.sizes,
          pa.map((i) => values[i]!),
        )
      ]! *
      b.table[
        index(
          b.sizes,
          pb.map((i) => values[i]!),
        )
      ]!;
  }
  return { vars, sizes, table };
}

function sumOut(f: Factor, v: number): Factor {
  const at = f.vars.indexOf(v);
  const vars = f.vars.filter((x) => x !== v);
  const sizes = f.sizes.filter((_, i) => i !== at);
  const table = new Float64Array(sizes.reduce((x, y) => x * y, 1));
  let k = 0;
  for (const values of assignments(f.sizes)) {
    table[
      index(
        sizes,
        values.filter((_, i) => i !== at),
      )
    ]! += f.table[k++]!;
  }
  return { vars, sizes, table };
}

/** Chance that a parent with g disease alleles passes one on. */
const passes = (mode: Mode, parent: Person, g: number): number =>
  mode.startsWith('x') && parent.sex === 'M' ? g : g / 2;

const showsTrait = (mode: Mode, sex: Person['sex'], g: number): boolean => {
  const male = mode.startsWith('x') && sex === 'M';
  if (mode === 'ar' || mode === 'xr') return male ? g === 1 : g === 2;
  return g >= 1;
};

export interface Peeling {
  /** Posterior probability of each state of the person asked about. */
  posterior: number[];
  /** The likelihood of the pedigree's evidence. */
  likelihood: number;
  /** Who was summed out, in order, with the size of the factor made. */
  order: { id: string; size: number }[];
}

/** The genotype distribution of `target` given every affected status and known carrier in the pedigree. */
export function peel(family: Family, mode: Mode, q: number, target: string): Peeling {
  if (!(q > 0 && q < 1)) return fail('family.e.frequency');
  const people = family.people;
  if (people.length > 30) return fail('family.e.tooMany');
  const id = new Map(people.map((p, k) => [p.id, k]));
  if (!id.has(target)) return fail('family.e.unknownPerson', { id: target });
  if (mode.startsWith('x') && people.some((p) => p.sex === 'U')) return fail('family.e.sexNeeded');
  const size = (v: number) => statesOf(mode, people[v]!);
  let factors: Factor[] = [];
  people.forEach((p, v) => {
    const own = size(v);
    const evidence = (g: number) => {
      if (p.carrier && !p.affected) return g === 1 ? 1 : 0;
      if (p.unknown) return 1;
      return showsTrait(mode, p.sex, g) === p.affected ? 1 : 0;
    };
    const father = p.father ? family.byId.get(p.father)! : null;
    const mother = p.mother ? family.byId.get(p.mother)! : null;
    if (!father && !mother) {
      const prior = own === 2 ? [1 - q, q] : [(1 - q) ** 2, 2 * q * (1 - q), q * q];
      factors.push({ vars: [v], sizes: [own], table: Float64Array.from(prior.map((x, g) => x * evidence(g))) });
      return;
    }
    // A missing parent is a founder of the population: it passes the allele with chance q.
    const parentVars = [father, mother].flatMap((x) => (x ? [id.get(x.id)!] : []));
    const vars = [v, ...parentVars];
    const sizes = vars.map(size);
    const table = new Float64Array(sizes.reduce((a, b) => a * b, 1));
    let k = 0;
    for (const values of assignments(sizes)) {
      const g = values[0]!;
      const get = (who: Person | null): number => {
        if (!who) return q;
        return passes(mode, who, values[vars.indexOf(id.get(who.id)!)]!);
      };
      const pm = get(mother);
      let prob: number;
      if (own === 2) {
        // An X-linked son gets his only X from his mother.
        prob = g === 1 ? pm : 1 - pm;
      } else {
        const pf = get(father);
        prob = g === 0 ? (1 - pf) * (1 - pm) : g === 1 ? pf * (1 - pm) + (1 - pf) * pm : pf * pm;
      }
      table[k++] = prob * evidence(g);
    }
    factors.push({ vars, sizes, table });
  });
  const keep = id.get(target)!;
  const remaining = new Set(people.map((_, v) => v).filter((v) => v !== keep));
  const order: { id: string; size: number }[] = [];
  while (remaining.size > 0) {
    // The variable whose elimination makes the smallest factor goes next.
    let best = -1;
    let bestSize = Infinity;
    for (const v of remaining) {
      const vars = new Set(factors.filter((f) => f.vars.includes(v)).flatMap((f) => f.vars));
      const s = [...vars].reduce((a, x) => a * size(x), 1);
      if (s < bestSize) [best, bestSize] = [v, s];
    }
    const touching = factors.filter((f) => f.vars.includes(best));
    factors = factors.filter((f) => !f.vars.includes(best));
    const merged = touching.reduce((a, b) => multiply(a, b, size));
    const out = sumOut(merged, best);
    factors.push(out);
    order.push({ id: people[best]!.id, size: merged.table.length });
    remaining.delete(best);
  }
  const final = factors.reduce((a, b) => multiply(a, b, size));
  const likelihood = final.table.reduce((a, b) => a + b, 0);
  if (!(likelihood > 0)) return fail('family.e.impossible');
  const pos = final.vars.indexOf(keep);
  const posterior = new Array<number>(size(keep)).fill(0);
  let k = 0;
  for (const values of assignments(final.sizes))
    posterior[pos === -1 ? 0 : values[pos]!]! += final.table[k++]! / likelihood;
  return { posterior, likelihood, order };
}
