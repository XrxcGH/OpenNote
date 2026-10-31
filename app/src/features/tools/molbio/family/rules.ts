// Which modes of inheritance fit a pedigree's affected statuses, by exact rules for a fully penetrant single-gene
// trait with no new mutations. Each pattern stops at the first person who contradicts it, and names the rule.
import type { Family, Person } from './people';

export const PATTERNS = ['ad', 'ar', 'xd', 'xr', 'y', 'mt'] as const;
export type Pattern = (typeof PATTERNS)[number];

export interface Verdict {
  pattern: Pattern;
  consistent: boolean;
  /** The rule that excluded the pattern and the people it is about. */
  rule?: string;
  vars?: Record<string, string>;
}

export interface CheckOptions {
  /** Unaffected people may carry a dominant allele (incomplete penetrance), so rules that rest on them are skipped. */
  incomplete: boolean;
  /** A rare trait: a recessive pattern may not need an unaffected partner of an affected person to be a carrier. */
  rare: boolean;
}

interface Trio {
  child: Person;
  father: Person | null;
  mother: Person | null;
}

const known = (p: Person | null): p is Person => p !== null && !p.unknown;
const affected = (p: Person | null): boolean => known(p) && p.affected;
const unaffected = (p: Person | null): boolean => known(p) && !p.affected;

type Rule = (t: Trio, o: CheckOptions) => string | null;

const RULES: Record<Pattern, Rule[]> = {
  ad: [
    (t, o) => (!o.incomplete && affected(t.child) && unaffected(t.father) && unaffected(t.mother) ? 'adParents' : null),
  ],
  ar: [
    (t) => (unaffected(t.child) && affected(t.father) && affected(t.mother) ? 'arBoth' : null),
    (t, o) =>
      o.rare &&
      affected(t.child) &&
      affected(t.father) !== affected(t.mother) &&
      unaffected(t.father) !== unaffected(t.mother)
        ? 'arRare'
        : null,
  ],
  xd: [
    (t, o) => (!o.incomplete && t.child.sex === 'F' && unaffected(t.child) && affected(t.father) ? 'xdFather' : null),
    (t, o) => (!o.incomplete && t.child.sex === 'M' && affected(t.child) && unaffected(t.mother) ? 'xdSon' : null),
    (t, o) =>
      !o.incomplete && t.child.sex === 'F' && affected(t.child) && unaffected(t.father) && unaffected(t.mother)
        ? 'xdDaughter'
        : null,
  ],
  xr: [
    (t) => (t.child.sex === 'F' && affected(t.child) && unaffected(t.father) ? 'xrDaughter' : null),
    (t) => (t.child.sex === 'M' && unaffected(t.child) && affected(t.mother) ? 'xrMother' : null),
    (t, o) => (o.rare && affected(t.child) && affected(t.father) && unaffected(t.mother) ? 'xrRare' : null),
  ],
  y: [
    (t) => (t.child.sex === 'M' && unaffected(t.child) && affected(t.father) ? 'yFather' : null),
    (t) => (t.child.sex === 'M' && affected(t.child) && unaffected(t.father) ? 'ySon' : null),
  ],
  mt: [
    (t) => (unaffected(t.child) && affected(t.mother) ? 'mtMother' : null),
    (t) => (affected(t.child) && unaffected(t.mother) ? 'mtChild' : null),
  ],
};

/** Checks every pattern against every parent-child trio and, for Y-linked traits, every affected female. */
export function checkPatterns(family: Family, options: CheckOptions): Verdict[] {
  const trios: Trio[] = family.people.map((child) => ({
    child,
    father: child.father ? family.byId.get(child.father)! : null,
    mother: child.mother ? family.byId.get(child.mother)! : null,
  }));
  return PATTERNS.map((pattern): Verdict => {
    if (pattern === 'y') {
      const female = family.people.find((p) => p.sex === 'F' && affected(p));
      if (female) return { pattern, consistent: false, rule: 'yFemale', vars: { child: female.id } };
    }
    for (const trio of trios) {
      for (const rule of RULES[pattern]) {
        const hit = rule(trio, options);
        if (hit) {
          return {
            pattern,
            consistent: false,
            rule: hit,
            vars: { child: trio.child.id, father: trio.father?.id ?? '—', mother: trio.mother?.id ?? '—' },
          };
        }
      }
    }
    return { pattern, consistent: true };
  });
}
