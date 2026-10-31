// Relatedness and kin terms. Kinship and inbreeding coefficients come from the recursive method, with the paths
// through common ancestors that a student sums by hand. Kin types (F, M, B, Z, S, D, H, W) link two people, and the
// genealogy lists give ancestors, descendants, and an order of succession.
import { fail } from '../shared';
import { byBirth, childrenOf } from './people';
import type { Family, Person } from './people';

/** Generations below the founders: 0 for a founder, else one more than the deeper parent. */
export function depthOf(family: Family): Map<string, number> {
  const depth = new Map<string, number>();
  const visit = (p: Person): number => {
    const known = depth.get(p.id);
    if (known !== undefined) return known;
    const parents = [p.father, p.mother].filter((x): x is string => x !== null);
    const d = parents.length === 0 ? 0 : 1 + Math.max(...parents.map((id) => visit(family.byId.get(id)!)));
    depth.set(p.id, d);
    return d;
  };
  family.people.forEach(visit);
  return depth;
}

/** Kinship coefficients φ (the chance that alleles drawn from two people are identical by descent). */
export function kinship(family: Family): (a: string, b: string) => number {
  const depth = depthOf(family);
  const memo = new Map<string, number>();
  const phi = (a: string, b: string): number => {
    const key = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
    const cached = memo.get(key);
    if (cached !== undefined) return cached;
    let value: number;
    if (a === b) {
      const p = family.byId.get(a)!;
      value = (1 + (p.father && p.mother ? phi(p.father, p.mother) : 0)) / 2;
    } else {
      // Expand the person further from the founders; a founder is unrelated to anyone but their descendants.
      const [x, y] = depth.get(a)! >= depth.get(b)! ? [a, b] : [b, a];
      const p = family.byId.get(x)!;
      const f = p.father ? phi(p.father, y) : 0;
      const m = p.mother ? phi(p.mother, y) : 0;
      value = (f + m) / 2;
    }
    memo.set(key, value);
    return value;
  };
  return phi;
}

/** F of a person: the kinship of their parents. */
export function inbreeding(family: Family, id: string): number {
  const p = family.byId.get(id)!;
  return p.father && p.mother ? kinship(family)(p.father, p.mother) : 0;
}

export interface Path {
  ancestor: string;
  /** The people from the first person up to the ancestor and down to the second. */
  people: string[];
  /** Generational steps on the path. */
  steps: number;
  ancestorF: number;
}

/** Chains from a person up to each ancestor (the person first). */
function chains(family: Family, id: string): string[][] {
  const out: string[][] = [[id]];
  const p = family.byId.get(id)!;
  for (const parent of [p.father, p.mother]) {
    if (parent === null) continue;
    for (const chain of chains(family, parent)) out.push([id, ...chain]);
  }
  return out;
}

/** Every path joining two people through a common ancestor that meets no other person twice. */
export function paths(family: Family, a: string, b: string, limit = 64): Path[] {
  const up = chains(family, a);
  const down = chains(family, b);
  const out: Path[] = [];
  for (const x of up) {
    for (const y of down) {
      const top = x.at(-1)!;
      if (top !== y.at(-1)) continue;
      const left = new Set(x.slice(0, -1));
      if (y.slice(0, -1).some((id) => left.has(id))) continue;
      out.push({
        ancestor: top,
        people: [...x, ...y.slice(0, -1).reverse()],
        steps: x.length - 1 + (y.length - 1),
        ancestorF: inbreeding(family, top),
      });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** Coefficient of relationship by path counting: Σ (1/2)^n (1 + F_A). */
export const relationship = (list: readonly Path[]): number =>
  list.reduce((s, p) => s + 0.5 ** p.steps * (1 + p.ancestorF), 0);

// ---- Kin types ----

const LETTER: Record<string, Record<'M' | 'F' | 'U', string>> = {
  parent: { M: 'F', F: 'M', U: 'P' },
  child: { M: 'S', F: 'D', U: 'C' },
  sibling: { M: 'B', F: 'Z', U: 'G' },
  spouse: { M: 'H', F: 'W', U: 'E' },
};

/** The kin type of `to` from `ego` by the shortest chain of parent, child, and partner links, such as FBD. */
export function kinType(family: Family, ego: string, to: string): string {
  if (!family.byId.has(ego)) return fail('family.e.unknownPerson', { id: ego });
  if (!family.byId.has(to)) return fail('family.e.unknownPerson', { id: to });
  if (ego === to) return 'Ego';
  type Move = { id: string; kind: 'parent' | 'child' | 'spouse' };
  const prev = new Map<string, { from: string; kind: Move['kind'] } | null>([[ego, null]]);
  const queue = [ego];
  while (queue.length > 0) {
    const at = queue.shift()!;
    if (at === to) break;
    const p = family.byId.get(at)!;
    const moves: Move[] = [
      ...[p.father, p.mother].flatMap((id) => (id ? [{ id, kind: 'parent' as const }] : [])),
      ...childrenOf(family, p).map((c) => ({ id: c.id, kind: 'child' as const })),
      ...p.partners.map((id) => ({ id, kind: 'spouse' as const })),
    ];
    for (const m of moves) {
      if (prev.has(m.id)) continue;
      prev.set(m.id, { from: at, kind: m.kind });
      queue.push(m.id);
    }
  }
  if (!prev.has(to)) return fail('family.e.unrelated', { a: ego, b: to });
  const steps: { kind: Move['kind']; id: string }[] = [];
  for (let at = to; prev.get(at); at = prev.get(at)!.from) steps.unshift({ kind: prev.get(at)!.kind, id: at });
  const letters: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    const next = steps[i + 1];
    const sex = family.byId.get(s.id)!.sex;
    // A parent's child other than the one before is a sibling.
    if (s.kind === 'parent' && next?.kind === 'child') {
      letters.push(LETTER.sibling![family.byId.get(next.id)!.sex]);
      i += 1;
      continue;
    }
    letters.push(LETTER[s.kind]![sex]);
  }
  return letters.join('');
}

/** Reads a kin type such as FBD or MZS, one letter per link. */
export function readKinType(text: string): string {
  const t = text.replace(/\s/g, '').toUpperCase();
  if (t === '') return fail('family.e.noKinType');
  const bad = [...t].findIndex((ch) => !'FMBZSDHWPCGE'.includes(ch));
  return bad === -1 ? t : fail('family.e.kinLetter', { char: t[bad]!, position: String(bad + 1) });
}

/** Cousins through a parent's sibling: parallel when the parent and the sibling are the same sex, else cross. */
export function cousinKind(type: string): 'parallel' | 'cross' | null {
  if (!/^[FM][BZ][SD]$/.test(type)) return null;
  const parentMale = type[0] === 'F';
  const siblingMale = type[1] === 'B';
  return parentMale === siblingMale ? 'parallel' : 'cross';
}

/** The kin type in words, such as "father’s brother’s daughter"; words come from the strings by letter. */
export const kinLetters = (type: string): string[] => [...type];

// ---- Genealogy ----

export function ancestors(family: Family, id: string): { id: string; generation: number }[] {
  const out: { id: string; generation: number }[] = [];
  const seen = new Set<string>();
  const visit = (pid: string, g: number) => {
    const p = family.byId.get(pid)!;
    for (const parent of [p.father, p.mother]) {
      if (parent === null || seen.has(parent)) continue;
      seen.add(parent);
      out.push({ id: parent, generation: g });
      visit(parent, g + 1);
    }
  };
  visit(id, 1);
  return out.sort((a, b) => a.generation - b.generation);
}

export function descendants(family: Family, id: string): { id: string; generation: number }[] {
  const out: { id: string; generation: number }[] = [];
  const seen = new Set<string>();
  const visit = (pid: string, g: number) => {
    for (const c of childrenOf(family, family.byId.get(pid)!).sort(byBirth)) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push({ id: c.id, generation: g });
      visit(c.id, g + 1);
    }
  };
  visit(id, 1);
  return out;
}

/**
 * The line of succession after a holder: each child's line in birth order, depth first (primogeniture). With male
 * preference, sons, and their lines come before daughters. Deceased people are skipped but their lines are kept.
 */
export function succession(family: Family, holder: string, malePreference: boolean): string[] {
  const out: string[] = [];
  const seen = new Set<string>([holder]);
  const visit = (pid: string) => {
    const kids = childrenOf(family, family.byId.get(pid)!).sort(byBirth);
    if (malePreference) kids.sort((a, b) => Number(b.sex === 'M') - Number(a.sex === 'M') || byBirth(a, b));
    for (const c of kids) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      if (!c.deceased) out.push(c.id);
      visit(c.id);
    }
  };
  visit(holder);
  return out;
}
