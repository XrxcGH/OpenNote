// Satisfiability for propositional clauses: resolution refutation, which shows the derivation of the empty clause,
// and DPLL with unit propagation and pure-literal elimination, which keeps its search tree.
import { fail } from '../core/util';
import { litText } from './normal';
import type { Clause, Lit } from './normal';

const key = (c: Clause) => c.map(litText).sort().join(',');
export const clauseShow = (c: Clause): string => (c.length ? `{${c.map(litText).join(', ')}}` : '□');

export interface Resolved {
  clause: Clause;
  /** The 2 parents, by index, and the letter resolved on; none for input clauses. */
  from?: [number, number, string];
}

export const MAX_RESOLVED = 3000;

export function resolution(input: readonly Clause[]): { refuted: boolean; all: Resolved[]; proof: number[] } {
  const all: Resolved[] = [];
  const seen = new Set<string>();
  const add = (c: Clause, from?: [number, number, string]) => {
    const k = key(c);
    if (seen.has(k) || c.some((l) => c.some((m) => m.name === l.name && m.neg !== l.neg))) return -1;
    seen.add(k);
    all.push({ clause: c, from });
    return all.length - 1;
  };
  for (const c of input) add(c);
  const proofOf = (i: number): number[] => {
    const out = new Set<number>();
    const walk = (j: number) => {
      if (out.has(j)) return;
      out.add(j);
      const f = all[j].from;
      if (f) {
        walk(f[0]);
        walk(f[1]);
      }
    };
    walk(i);
    return [...out].sort((a, b) => a - b);
  };
  const empty = all.findIndex((r) => r.clause.length === 0);
  if (empty >= 0) return { refuted: true, all, proof: [empty] };
  for (let i = 0; i < all.length; i += 1)
    for (let j = 0; j < i; j += 1)
      for (const l of all[i].clause) {
        if (!all[j].clause.some((m) => m.name === l.name && m.neg !== l.neg)) continue;
        const merged: Clause = [];
        for (const m of [...all[j].clause, ...all[i].clause])
          if (m.name !== l.name && !merged.some((x) => x.name === m.name && x.neg === m.neg)) merged.push(m);
        const at = add(merged, [j, i, l.name]);
        if (at >= 0 && merged.length === 0) return { refuted: true, all, proof: proofOf(at) };
        if (all.length > MAX_RESOLVED) fail('resolutionBig', { max: MAX_RESOLVED });
      }
  return { refuted: false, all, proof: [] };
}

export interface DpllNode {
  /** What this node did: split on a literal, or propagate units and pure literals. */
  label: string;
  edge?: string;
  result?: 'sat' | 'unsat';
  kids: DpllNode[];
}

export const MAX_DPLL = 5000;

export function dpll(input: readonly Clause[]): {
  sat: boolean;
  model: Map<string, boolean> | null;
  tree: DpllNode;
  nodes: number;
} {
  let nodes = 0;
  const simplify = (cs: Clause[], l: Lit): Clause[] =>
    cs
      .filter((c) => !c.some((m) => m.name === l.name && m.neg === l.neg))
      .map((c) => c.filter((m) => m.name !== l.name));
  const go = (
    cs: Clause[],
    model: Map<string, boolean>,
    edge?: string,
  ): { node: DpllNode; model: Map<string, boolean> | null } => {
    if ((nodes += 1) > MAX_DPLL) fail('dpllBig', { max: MAX_DPLL });
    const forced: string[] = [];
    let work = cs;
    for (;;) {
      if (work.some((c) => c.length === 0)) break;
      const unit = work.find((c) => c.length === 1)?.[0];
      const lits = work.flat();
      const pure = lits.find((l) => !lits.some((m) => m.name === l.name && m.neg !== l.neg));
      const pick = unit ?? pure;
      if (!pick) break;
      forced.push(`${unit ? '' : '*'}${litText(pick)}`);
      model = new Map(model).set(pick.name, !pick.neg);
      work = simplify(work, pick);
    }
    const label = forced.length ? forced.join(', ') : '—';
    if (work.some((c) => c.length === 0)) return { node: { label, edge, result: 'unsat', kids: [] }, model: null };
    if (work.length === 0) return { node: { label, edge, result: 'sat', kids: [] }, model };
    const v = work[0][0].name;
    const kids: DpllNode[] = [];
    for (const neg of [false, true]) {
      const l: Lit = { name: v, neg };
      const r = go(simplify(work, l), new Map(model).set(v, !neg), litText(l));
      kids.push(r.node);
      if (r.model) return { node: { label, edge, kids }, model: r.model };
    }
    return { node: { label, edge, kids }, model: null };
  };
  const r = go([...input.map((c) => [...c])], new Map());
  return { sat: r.model !== null, model: r.model, tree: r.node, nodes };
}
