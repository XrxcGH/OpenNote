// A Fitch-style natural-deduction checker for propositional and first-order logic with identity. Each line is
// "number. formula  rule citations", with one | per level of subproof before the formula. The checker follows the
// subproofs, makes sure each cited line or subproof is still in reach, and matches the rule's pattern against them,
// with the scope conditions for universal introduction and existential elimination.
import { KitError, fail, lines as textLines } from '../core/util';
import { names, parseFormula, same, termText } from './formula';
import type { Formula, Term } from './formula';

export const RULES: Record<string, readonly string[]> = {
  premise: ['premise', 'pr', 'prem', 'given', 'pre'],
  assumption: ['assumption', 'assume', 'as', 'ass', 'hyp', 'hypothesis', 'acp', 'aip'],
  reit: ['reit', 'r', 're', 'reiteration'],
  andI: ['∧i', '&i', 'andi', '^i', 'conj', 'adj'],
  andE: ['∧e', '&e', 'ande', '^e', 'simp'],
  orI: ['∨i', '|i', 'ori', 'vi', 'add'],
  orE: ['∨e', '|e', 'ore', 've'],
  impI: ['→i', '->i', 'impi', 'cp', '⊃i'],
  impE: ['→e', '->e', 'impe', 'mp', '⊃e'],
  notI: ['¬i', '~i', 'noti', '-i'],
  notE: ['¬e', '~e', 'note', '-e', '⊥i', 'contra'],
  botE: ['⊥e', 'x', 'ex', 'explosion', 'efq'],
  ip: ['ip', 'raa', 'pbc'],
  dne: ['dne', '¬¬e', '~~e', 'dn'],
  dni: ['dni', '¬¬i', '~~i'],
  iffI: ['↔i', '<->i', 'iffi'],
  iffE: ['↔e', '<->e', 'iffe'],
  mt: ['mt'],
  hs: ['hs'],
  ds: ['ds'],
  allE: ['∀e', 'alle', 'ui'],
  allI: ['∀i', 'alli', 'ug'],
  someI: ['∃i', 'somei', 'exi', 'eg'],
  someE: ['∃e', 'somee', 'exe'],
  eqI: ['=i', 'idi'],
  eqE: ['=e', 'ide'],
};

const ALIAS = new Map(Object.entries(RULES).flatMap(([k, list]) => list.map((a) => [a, k] as const)));

export interface Ref {
  from: number;
  to?: number;
}

export interface ProofLine {
  n: number;
  depth: number;
  formula: Formula;
  rule: string;
  refs: Ref[];
  /** The subproofs open at this line, by their first line. */
  chain: number[];
}

export interface Subproof {
  start: number;
  end: number;
  parent: number[];
}

export type Problem = { key: string; vars?: Record<string, string | number> };

export interface Checked {
  lines: ProofLine[];
  problems: (Problem | null)[];
  ok: boolean;
}

const RULE_TAIL = /^([^\s\d,]+(?:\s?[ie])?)\s*((?:\d+(?:\s*[-–]\s*\d+)?\s*,?\s*)*)$/i;

function splitLine(text: string): { formula: Formula; rule: string; refs: Ref[] } {
  const words = [...text.matchAll(/\s+/g)].map((m) => m.index!);
  for (const cut of words) {
    const tail = text.slice(cut).trim();
    const m = RULE_TAIL.exec(tail);
    if (!m) continue;
    const rule = ALIAS.get(m[1].toLowerCase().replace(/\s+/g, ''));
    if (!rule) continue;
    let formula: Formula;
    try {
      formula = parseFormula(text.slice(0, cut));
    } catch {
      continue;
    }
    const refs = [...m[2].matchAll(/(\d+)(?:\s*[-–]\s*(\d+))?/g)].map((r) =>
      r[2] ? { from: Number(r[1]), to: Number(r[2]) } : { from: Number(r[1]) },
    );
    return { formula, rule, refs };
  }
  // A rule-shaped tail after a formula that reads, with a word the tool does not know.
  for (const cut of words) {
    const m = RULE_TAIL.exec(text.slice(cut).trim());
    if (!m) continue;
    try {
      parseFormula(text.slice(0, cut));
    } catch {
      continue;
    }
    return fail('noRule', { rule: m[1] });
  }
  // No rule name fits: report the rule word, or the formula problem.
  const parts = text.trim().split(/\s+/);
  try {
    parseFormula(parts.slice(0, -1).join(' '));
  } catch {
    // Not a formula and a rule word: say what is wrong with the formula, or that the rule is missing.
    parseFormula(text);
    return fail('noRuleGiven');
  }
  return fail('noRule', { rule: parts[parts.length - 1] });
}

export function parseProof(text: string): { lines: ProofLine[]; subproofs: Subproof[] } {
  const raw = textLines(text);
  if (raw.length === 0) fail('emptyProof');
  if (raw.length > 400) fail('proofLong', { max: 400 });
  const parsed = raw.map((line, i) => {
    const m = /^(\d+)\s*[.):]?\s*/.exec(line);
    const n = m ? Number(m[1]) : i + 1;
    let rest = m ? line.slice(m[0].length) : line;
    let depth = 0;
    for (;;) {
      const bar = /^\s*\|\s*/.exec(rest);
      if (!bar) break;
      depth += 1;
      rest = rest.slice(bar[0].length);
    }
    try {
      return { n, depth, ...splitLine(rest) };
    } catch (e) {
      throw e instanceof KitError ? new KitError(e.key, { ...e.vars, line: n }) : e;
    }
  });
  const base = parsed[0].depth;
  const lines: ProofLine[] = [];
  const subproofs: Subproof[] = [];
  const open: number[] = [];
  const close = () => {
    const start = open.pop()!;
    const sp = subproofs.find((s) => s.start === start)!;
    sp.end = lines[lines.length - 1].n;
  };
  for (const p of parsed) {
    const depth = p.depth - base;
    if (depth < 0) fail('depthJump', { line: p.n });
    if (lines.some((l) => l.n === p.n)) fail('lineTwice', { line: p.n });
    if (p.rule === 'assumption') {
      if (depth > open.length + 1 || depth === 0) fail('depthJump', { line: p.n });
      while (open.length >= depth) close();
      subproofs.push({ start: p.n, end: p.n, parent: [...open] });
      open.push(p.n);
    } else {
      if (depth > open.length) fail('depthJump', { line: p.n });
      while (open.length > depth) close();
    }
    lines.push({ ...p, depth, chain: [...open] });
  }
  while (open.length) close();
  return { lines, subproofs };
}

const prefix = (a: readonly number[], b: readonly number[]) => a.length <= b.length && a.every((x, i) => b[i] === x);

/* ---------- Term matching for the quantifier and identity rules ---------- */

const termSame = (a: Term, b: Term) => termText(a) === termText(b);

/** The term t with general[t/x] = specific, 'none' when x is not free, or null when no term fits. */
function instance(general: Formula, x: string, specific: Formula): Term | 'none' | null {
  let found: Term | null = null;
  const tm = (a: Term, b: Term, bound: boolean): boolean => {
    if (a.k === 'var' && a.name === x && !bound) {
      if (found && !termSame(found, b)) return false;
      found = b;
      return true;
    }
    if (a.k !== b.k || a.name !== b.name) return false;
    return (
      a.k === 'var' ||
      (b.k === 'fn' && a.args.length === b.args.length && a.args.every((t, i) => tm(t, b.args[i], bound)))
    );
  };
  const go = (a: Formula, b: Formula, bound: boolean): boolean => {
    if (a.k !== b.k) return false;
    switch (a.k) {
      case 'pred': {
        const bb = b as typeof a;
        return (
          a.name === bb.name && a.args.length === bb.args.length && a.args.every((t, i) => tm(t, bb.args[i], bound))
        );
      }
      case 'eq': {
        const bb = b as typeof a;
        return tm(a.a, bb.a, bound) && tm(a.b, bb.b, bound);
      }
      case 'atom':
        return a.name === (b as typeof a).name;
      case 'not':
      case 'box':
      case 'dia':
        return go(a.f, (b as typeof a).f, bound);
      case 'all':
      case 'some': {
        const bb = b as typeof a;
        return a.v === bb.v && go(a.f, bb.f, bound || a.v === x);
      }
      case 'and':
      case 'or':
      case 'imp':
      case 'iff': {
        const bb = b as typeof a;
        return go(a.a, bb.a, bound) && go(a.b, bb.b, bound);
      }
      default:
        return true;
    }
  };
  if (!go(general, specific, false)) return null;
  return found ?? 'none';
}

/** Whether `to` is `from` with some occurrences of the term a replaced by b. */
function replaces(from: Formula, to: Formula, a: Term, b: Term): boolean {
  const tm = (x: Term, y: Term): boolean => {
    if (termSame(x, y)) return true;
    if (termSame(x, a) && termSame(y, b)) return true;
    return (
      x.k === 'fn' &&
      y.k === 'fn' &&
      x.name === y.name &&
      x.args.length === y.args.length &&
      x.args.every((t, i) => tm(t, y.args[i]))
    );
  };
  const go = (x: Formula, y: Formula): boolean => {
    if (x.k !== y.k) return false;
    switch (x.k) {
      case 'pred': {
        const yy = y as typeof x;
        return x.name === yy.name && x.args.length === yy.args.length && x.args.every((t, i) => tm(t, yy.args[i]));
      }
      case 'eq': {
        const yy = y as typeof x;
        return tm(x.a, yy.a) && tm(x.b, yy.b);
      }
      case 'not':
      case 'box':
      case 'dia':
        return go(x.f, (y as typeof x).f);
      case 'all':
      case 'some':
        return x.v === (y as typeof x).v && go(x.f, (y as typeof x).f);
      case 'and':
      case 'or':
      case 'imp':
      case 'iff':
        return go(x.a, (y as typeof x).a) && go(x.b, (y as typeof x).b);
      default:
        return same(x, y);
    }
  };
  return go(from, to);
}

/* ---------- Checking ---------- */

const bad = (key: string, vars?: Record<string, string | number>): Problem => ({ key, vars });

export function checkProof(text: string): Checked {
  const { lines, subproofs } = parseProof(text);
  const at = new Map(lines.map((l) => [l.n, l]));
  const problems = lines.map((line, idx) => {
    const cites: Formula[] = [];
    const boxes: Box[] = [];
    for (const r of line.refs) {
      if (r.to === undefined) {
        const c = at.get(r.from);
        if (!c || lines.indexOf(c) >= idx) return bad('noSuchLine', { line: r.from });
        if (!prefix(c.chain, line.chain)) return bad('notAccessible', { line: r.from });
        cites.push(c.formula);
      } else {
        const sp = subproofs.find((s) => s.start === r.from && s.end === r.to);
        if (!sp) return bad('noSubproof', { from: r.from, to: r.to });
        if (lines.indexOf(at.get(sp.end)!) >= idx || !prefix(sp.parent, line.chain) || line.chain.includes(sp.start))
          return bad('subproofOpen', { from: r.from, to: r.to });
        boxes.push({ first: at.get(sp.start)!.formula, last: at.get(sp.end)!.formula, start: sp.start, end: sp.end });
      }
    }
    return checkRule(line, cites, boxes, lines.slice(0, idx), subproofs);
  });
  return { lines, problems, ok: problems.every((p) => p === null) };
}

interface Box {
  first: Formula;
  last: Formula;
  start: number;
  end: number;
}

interface Ctx {
  line: ProofLine;
  f: Formula;
  cites: readonly Formula[];
  boxes: readonly Box[];
  before: readonly ProofLine[];
  subproofs: readonly Subproof[];
}

/** Each rule's test: true when it fits, false for the rule's own message, or a more specific problem. */
type Check = (c: Ctx) => boolean | Problem;

const need = (c: Ctx, nLines: number, nBoxes: number) => c.cites.length === nLines && c.boxes.length === nBoxes;
const pairOf = (c: Ctx, test: (a: Formula, b: Formula) => boolean) =>
  need(c, 2, 0) && (test(c.cites[0], c.cites[1]) || test(c.cites[1], c.cites[0]));
const boxPair = (c: Ctx, test: (x: Box, y: Box) => boolean) =>
  c.boxes.length === 2 && (test(c.boxes[0], c.boxes[1]) || test(c.boxes[1], c.boxes[0]));

const allI: Check = ({ f, cites, boxes, before, line }) => {
  if (cites.length !== 1 || boxes.length || f.k !== 'all') return false;
  const t = instance(f.f, f.v, cites[0]);
  if (t === null) return false;
  if (t === 'none') return true;
  if (t.k !== 'var') return bad('allIName');
  if (names(f).has(t.name)) return bad('allIScope', { name: t.name });
  const open = before.filter((l) => (l.rule === 'premise' || l.rule === 'assumption') && prefix(l.chain, line.chain));
  return open.some((l) => names(l.formula).has(t.name)) ? bad('allIScope', { name: t.name }) : true;
};

const someE: Check = ({ f, cites, boxes, before, subproofs }) => {
  const e = cites[0];
  if (cites.length !== 1 || boxes.length !== 1 || e.k !== 'some') return false;
  const t = instance(e.f, e.v, boxes[0].first);
  if (t === null || !same(boxes[0].last, f)) return false;
  if (t === 'none') return true;
  if (t.k !== 'var') return bad('someEName');
  const sp = subproofs.find((x) => x.start === boxes[0].start)!;
  const outside = before.filter((l) => l.n < sp.start && prefix(l.chain, sp.parent));
  const used = names(e).has(t.name) || names(f).has(t.name) || outside.some((l) => names(l.formula).has(t.name));
  return used ? bad('someEScope', { name: t.name }) : true;
};

const iffI: Check = (c) => {
  const { f } = c;
  if (f.k !== 'iff') return false;
  if (need(c, 0, 2))
    return boxPair(c, (x, y) => same(x.first, f.a) && same(x.last, f.b) && same(y.first, f.b) && same(y.last, f.a));
  const ab: Formula = { k: 'imp', a: f.a, b: f.b };
  const ba: Formula = { k: 'imp', a: f.b, b: f.a };
  return pairOf(c, (x, y) => same(x, ab) && same(y, ba));
};

const CHECKS: Record<string, Check> = {
  premise: ({ line }) => (line.depth === 0 ? true : bad('premiseDepth')),
  assumption: () => true,
  reit: (c) => need(c, 1, 0) && same(c.cites[0], c.f),
  andI: (c) => c.f.k === 'and' && pairOf(c, (a, b) => c.f.k === 'and' && same(a, c.f.a) && same(b, c.f.b)),
  andE: (c) => need(c, 1, 0) && c.cites[0].k === 'and' && (same(c.cites[0].a, c.f) || same(c.cites[0].b, c.f)),
  orI: (c) => need(c, 1, 0) && c.f.k === 'or' && (same(c.f.a, c.cites[0]) || same(c.f.b, c.cites[0])),
  orE: (c) => {
    const d = c.cites[0];
    if (c.cites.length !== 1 || d.k !== 'or') return false;
    return boxPair(c, (x, y) => same(x.first, d.a) && same(y.first, d.b) && same(x.last, c.f) && same(y.last, c.f));
  },
  impI: (c) => need(c, 0, 1) && c.f.k === 'imp' && same(c.boxes[0].first, c.f.a) && same(c.boxes[0].last, c.f.b),
  impE: (c) => pairOf(c, (a, b) => a.k === 'imp' && same(a.a, b) && same(a.b, c.f)),
  notI: (c) => need(c, 0, 1) && c.f.k === 'not' && same(c.boxes[0].first, c.f.f) && c.boxes[0].last.k === 'bot',
  notE: (c) => c.f.k === 'bot' && pairOf(c, (a, b) => b.k === 'not' && same(b.f, a)),
  botE: (c) => need(c, 1, 0) && c.cites[0].k === 'bot',
  ip: (c) => {
    if (!need(c, 0, 1)) return false;
    const { first, last } = c.boxes[0];
    return first.k === 'not' && same(first.f, c.f) && last.k === 'bot';
  },
  dne: (c) => {
    const a = c.cites[0];
    return need(c, 1, 0) && a.k === 'not' && a.f.k === 'not' && same(a.f.f, c.f);
  },
  dni: (c) => need(c, 1, 0) && c.f.k === 'not' && c.f.f.k === 'not' && same(c.f.f.f, c.cites[0]),
  iffI,
  iffE: (c) =>
    pairOf(c, (a, b) => a.k === 'iff' && ((same(a.a, b) && same(a.b, c.f)) || (same(a.b, b) && same(a.a, c.f)))),
  mt: (c) => {
    const { f } = c;
    return f.k === 'not' && pairOf(c, (a, b) => a.k === 'imp' && b.k === 'not' && same(a.b, b.f) && same(a.a, f.f));
  },
  hs: (c) => {
    const { f } = c;
    if (f.k !== 'imp') return false;
    return pairOf(c, (a, b) => a.k === 'imp' && b.k === 'imp' && same(a.b, b.a) && same(a.a, f.a) && same(b.b, f.b));
  },
  ds: (c) =>
    pairOf(c, (a, b) => {
      if (a.k !== 'or' || b.k !== 'not') return false;
      return (same(b.f, a.a) && same(a.b, c.f)) || (same(b.f, a.b) && same(a.a, c.f));
    }),
  allE: (c) => {
    const a = c.cites[0];
    return need(c, 1, 0) && a.k === 'all' && instance(a.f, a.v, c.f) !== null;
  },
  someI: (c) => need(c, 1, 0) && c.f.k === 'some' && instance(c.f.f, c.f.v, c.cites[0]) !== null,
  allI,
  someE,
  eqI: (c) => need(c, 0, 0) && c.f.k === 'eq' && termText(c.f.a) === termText(c.f.b),
  eqE: (c) => pairOf(c, (e, src) => e.k === 'eq' && (replaces(src, c.f, e.a, e.b) || replaces(src, c.f, e.b, e.a))),
};

function checkRule(
  line: ProofLine,
  cites: readonly Formula[],
  boxes: readonly Box[],
  before: readonly ProofLine[],
  subproofs: readonly Subproof[],
): Problem | null {
  const check = CHECKS[line.rule];
  if (!check) return bad('noRule', { rule: line.rule });
  const r = check({ line, f: line.formula, cites, boxes, before, subproofs });
  return r === true ? null : r === false ? bad(`rule_${line.rule}`) : r;
}

/** A cited rule's name in the usual notation, for messages. */
export const ruleName = (rule: string): string =>
  ({
    andI: '∧I',
    andE: '∧E',
    orI: '∨I',
    orE: '∨E',
    impI: '→I',
    impE: '→E',
    notI: '¬I',
    notE: '¬E',
    botE: '⊥E',
    ip: 'IP',
    dne: 'DNE',
    dni: 'DNI',
    iffI: '↔I',
    iffE: '↔E',
    mt: 'MT',
    hs: 'HS',
    ds: 'DS',
    allE: '∀E',
    allI: '∀I',
    someI: '∃I',
    someE: '∃E',
    eqI: '=I',
    eqE: '=E',
    reit: 'R',
    premise: 'Premise',
    assumption: 'Assumption',
  })[rule] ?? rule;
