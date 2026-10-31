// Truth tables, the classification of a formula (tautology, contradiction, or contingent), equivalence and validity
// with a counterexample row, and conversion to conjunctive or disjunctive normal form stage by stage.
import { fail } from '../core/util';
import { evaluate, isPropositional, letters, show } from './formula';
import type { Formula } from './formula';

export const MAX_LETTERS = 12;

export interface TruthTable {
  vars: string[];
  /** Each row: the letters' values, then each formula's value. */
  rows: { values: boolean[]; results: boolean[] }[];
}

export function truthTable(formulas: readonly Formula[]): TruthTable {
  for (const f of formulas) if (!isPropositional(f)) fail('notPropositional');
  const vars: string[] = [];
  for (const f of formulas) letters(f, vars);
  if (vars.length > MAX_LETTERS) fail('tooManyLetters', { max: MAX_LETTERS });
  const rows: TruthTable['rows'] = [];
  for (let m = 0; m < 1 << vars.length; m += 1) {
    // The first row is all true, as in most textbooks.
    const values = vars.map((_, i) => !((m >> (vars.length - 1 - i)) & 1));
    const v = (name: string) => values[vars.indexOf(name)];
    rows.push({ values, results: formulas.map((f) => evaluate(f, v)) });
  }
  return { vars, rows };
}

export type Kind = 'tautology' | 'contradiction' | 'contingent';

export function classify(t: TruthTable, col = 0): Kind {
  const vals = t.rows.map((r) => r.results[col]);
  return vals.every(Boolean) ? 'tautology' : vals.some(Boolean) ? 'contingent' : 'contradiction';
}

/* ---------- Normal forms ---------- */

const not = (f: Formula): Formula => ({ k: 'not', f });
const bin = (k: 'and' | 'or', a: Formula, b: Formula): Formula => ({ k, a, b });

function noIff(f: Formula): Formula {
  switch (f.k) {
    case 'iff': {
      const a = noIff(f.a);
      const b = noIff(f.b);
      return bin('and', { k: 'imp', a, b }, { k: 'imp', a: b, b: a });
    }
    case 'not':
      return not(noIff(f.f));
    case 'and':
    case 'or':
    case 'imp':
      return { k: f.k, a: noIff(f.a), b: noIff(f.b) };
    default:
      return f;
  }
}

function noImp(f: Formula): Formula {
  switch (f.k) {
    case 'imp':
      return bin('or', not(noImp(f.a)), noImp(f.b));
    case 'not':
      return not(noImp(f.f));
    case 'and':
    case 'or':
      return { k: f.k, a: noImp(f.a), b: noImp(f.b) };
    default:
      return f;
  }
}

/** Negation pushed down to the letters by De Morgan's laws and double negation. */
function nnf(f: Formula): Formula {
  if (f.k === 'and' || f.k === 'or') return { k: f.k, a: nnf(f.a), b: nnf(f.b) };
  if (f.k !== 'not') return f;
  const g = f.f;
  switch (g.k) {
    case 'not':
      return nnf(g.f);
    case 'and':
      return bin('or', nnf(not(g.a)), nnf(not(g.b)));
    case 'or':
      return bin('and', nnf(not(g.a)), nnf(not(g.b)));
    case 'top':
      return { k: 'bot' };
    case 'bot':
      return { k: 'top' };
    default:
      return f;
  }
}

/** A literal: a letter and its sign. */
export type Lit = { name: string; neg: boolean };
export type Clause = Lit[];

export const litText = (l: Lit): string => `${l.neg ? '¬' : ''}${l.name}`;
export const MAX_CLAUSES = 4000;

/**
 * The clauses of a formula in negation normal form: for CNF each clause is a disjunction, for DNF a conjunction.
 * Distributing as it goes, it drops clauses that hold a letter and its negation, and repeated literals.
 */
function clausesOf(f: Formula, cnf: boolean): Clause[] {
  const join = cnf ? 'and' : 'or';
  if (f.k === 'top') return cnf ? [] : [[]];
  if (f.k === 'bot') return cnf ? [[]] : [];
  if (f.k === 'atom') return [[{ name: f.name, neg: false }]];
  if (f.k === 'not' && f.f.k === 'atom') return [[{ name: f.f.name, neg: true }]];
  if (f.k === join) return tidy([...clausesOf(f.a, cnf), ...clausesOf(f.b, cnf)]);
  if (f.k === 'and' || f.k === 'or') {
    const a = clausesOf(f.a, cnf);
    const b = clausesOf(f.b, cnf);
    if (a.length * b.length > MAX_CLAUSES) fail('tooBig', { max: MAX_CLAUSES });
    return tidy(a.flatMap((x) => b.map((y) => [...x, ...y])));
  }
  return fail('notPropositional');
}

function tidy(clauses: Clause[]): Clause[] {
  const out: Clause[] = [];
  const seen = new Set<string>();
  for (const c of clauses) {
    const lits: Clause = [];
    for (const l of c) if (!lits.some((x) => x.name === l.name && x.neg === l.neg)) lits.push(l);
    if (lits.some((l) => lits.some((x) => x.name === l.name && x.neg !== l.neg))) continue;
    const key = lits.map(litText).sort().join(',');
    if (!seen.has(key)) {
      seen.add(key);
      out.push(lits);
    }
  }
  // A clause that contains another is redundant.
  const sets = out.map((c) => new Set(c.map(litText)));
  return out.filter(
    (_, i) => !sets.some((t, j) => j !== i && t.size < sets[i].size && [...t].every((x) => sets[i].has(x))),
  );
}

export function clauseText(clauses: readonly Clause[], cnf: boolean): string {
  if (clauses.length === 0) return cnf ? '⊤' : '⊥';
  const inner = cnf ? ' ∨ ' : ' ∧ ';
  const outer = cnf ? ' ∧ ' : ' ∨ ';
  return clauses
    .map((c) =>
      c.length === 0
        ? cnf
          ? '⊥'
          : '⊤'
        : c.length === 1 || clauses.length === 1
          ? c.map(litText).join(inner)
          : `(${c.map(litText).join(inner)})`,
    )
    .join(outer);
}

export interface NormalForm {
  clauses: Clause[];
  text: string;
  /** The formula after each stage that changed it. */
  stages: { key: 'iff' | 'imp' | 'nnf' | 'distribute'; text: string }[];
}

export function normalForm(f: Formula, cnf: boolean): NormalForm {
  if (!isPropositional(f)) fail('notPropositional');
  const stages: NormalForm['stages'] = [];
  let g = f;
  for (const [key, step] of [
    ['iff', noIff],
    ['imp', noImp],
    ['nnf', nnf],
  ] as const) {
    const next = step(g);
    if (show(next) !== show(g)) stages.push({ key, text: show(next) });
    g = next;
  }
  const clauses = clausesOf(g, cnf);
  const text = clauseText(clauses, cnf);
  if (text !== show(g)) stages.push({ key: 'distribute', text });
  return { clauses, text, stages };
}
