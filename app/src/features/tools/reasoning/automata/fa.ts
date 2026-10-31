// Finite automata. A machine is typed one transition per line, `from symbol to` (more targets may follow, and ε or
// eps marks an empty move), with `start q` and `accept q r` lines; `alphabet a b` adds symbols no transition uses.
// From a machine come runs with the set of active states, the subset construction, minimization by partition
// refinement, complements, products, equivalence with a shortest telling string, Thompson's construction from a
// regular expression, and state elimination back to one.
import { fail, lines } from '../core/util';
import { EPS as EPS_RE, NONE, alt, cat, star, sym } from './regex';
import type { Re } from './regex';

export const EPS = 'ε';
const EPS_WORDS = new Set(['ε', 'eps', 'λ', 'epsilon']);
export const MAX_STATES = 400;

export interface Fa {
  states: string[];
  alphabet: string[];
  start: string;
  accept: Set<string>;
  /** from → symbol (or ε) → targets. */
  delta: Map<string, Map<string, Set<string>>>;
}

export function emptyFa(start: string): Fa {
  const fa: Fa = { states: [], alphabet: [], start, accept: new Set(), delta: new Map() };
  addState(fa, start);
  return fa;
}

export function addState(fa: Fa, q: string): void {
  if (fa.delta.has(q)) return;
  if (fa.states.length >= MAX_STATES) fail('tooManyStates', { max: MAX_STATES });
  fa.states.push(q);
  fa.delta.set(q, new Map());
}

export function addEdge(fa: Fa, from: string, symbol: string, to: string): void {
  addState(fa, from);
  addState(fa, to);
  if (symbol !== EPS && !fa.alphabet.includes(symbol)) fa.alphabet.push(symbol);
  const row = fa.delta.get(from)!;
  if (!row.has(symbol)) row.set(symbol, new Set());
  row.get(symbol)!.add(to);
}

const targets = (fa: Fa, q: string, symbol: string): Set<string> => fa.delta.get(q)?.get(symbol) ?? new Set();

/** Reads a machine from its lines; raises a worded error for anything it cannot use. */
export function parseFa(text: string): Fa {
  let start: string | null = null;
  const accept: string[] = [];
  const extra: string[] = [];
  const edges: [string, string, string][] = [];
  for (const line of lines(text)) {
    const words = line.split(/[\s,]+/).filter((w) => w !== '' && w !== '->' && w !== '→');
    const head = words[0].toLowerCase();
    if (head === 'start' || head === 'initial') {
      if (words.length !== 2) fail('startLine', { line });
      start = words[1];
    } else if (head === 'accept' || head === 'final' || head === 'accepting') accept.push(...words.slice(1));
    else if (head === 'alphabet') extra.push(...words.slice(1));
    else {
      if (words.length < 3) fail('faLine', { line });
      const [from, symbol, ...to] = words;
      const s = EPS_WORDS.has(symbol.toLowerCase()) ? EPS : symbol;
      if ([...s].length !== 1) fail('symbolLength', { symbol });
      for (const t of to) edges.push([from, s, t]);
    }
  }
  if (edges.length === 0 && start === null) fail('emptyMachine');
  const fa = emptyFa(start ?? edges[0][0]);
  for (const [from, s, to] of edges) addEdge(fa, from, s, to);
  for (const q of accept) {
    addState(fa, q);
    fa.accept.add(q);
  }
  for (const a of extra) {
    if ([...a].length !== 1) fail('symbolLength', { symbol: a });
    if (!fa.alphabet.includes(a)) fa.alphabet.push(a);
  }
  fa.alphabet.sort();
  return fa;
}

export function isDfa(fa: Fa): boolean {
  for (const row of fa.delta.values()) for (const [symbol, to] of row) if (symbol === EPS || to.size > 1) return false;
  return true;
}

export function closure(fa: Fa, set: Iterable<string>): Set<string> {
  const out = new Set(set);
  const stack = [...out];
  while (stack.length) {
    const q = stack.pop()!;
    for (const t of targets(fa, q, EPS))
      if (!out.has(t)) {
        out.add(t);
        stack.push(t);
      }
  }
  return out;
}

export function move(fa: Fa, set: Iterable<string>, symbol: string): Set<string> {
  const out = new Set<string>();
  for (const q of set) for (const t of targets(fa, q, symbol)) out.add(t);
  return out;
}

/** The symbols of an input string: one per character; ε or nothing is the empty string. */
export const symbolsOfInput = (text: string): string[] => {
  const t = text.trim();
  return t === '' || EPS_WORDS.has(t.toLowerCase()) ? [] : [...t.replace(/\s+/g, '')];
};

export interface Run {
  accepted: boolean;
  /** The active states before any input, then after each symbol, ε-closures included. */
  sets: Set<string>[];
}

export function run(fa: Fa, input: readonly string[]): Run {
  let current = closure(fa, [fa.start]);
  const sets = [current];
  for (const a of input) {
    current = closure(fa, move(fa, current, a));
    sets.push(current);
  }
  return { accepted: [...current].some((q) => fa.accept.has(q)), sets };
}

const order = (fa: Fa) => new Map(fa.states.map((q, i) => [q, i]));
export const setText = (fa: Fa, set: Iterable<string>): string => {
  const o = order(fa);
  const list = [...set].sort((a, b) => (o.get(a) ?? 0) - (o.get(b) ?? 0));
  return list.length ? `{${list.join(', ')}}` : '∅';
};

const letterName = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `S${i}`);

export interface SubsetRow {
  name: string;
  set: string;
  accept: boolean;
  to: string[];
}

/** The subset construction: a DFA whose states are the ε-closed sets of NFA states that can be reached. */
export function subset(fa: Fa): { dfa: Fa; rows: SubsetRow[] } {
  const key = (s: Set<string>) => setText(fa, s);
  const first = closure(fa, [fa.start]);
  const names = new Map<string, string>([[key(first), letterName(0)]]);
  const sets = [first];
  const dfa = emptyFa(letterName(0));
  dfa.alphabet = [...fa.alphabet];
  const rows: SubsetRow[] = [];
  for (let i = 0; i < sets.length; i += 1) {
    const from = names.get(key(sets[i]))!;
    const to: string[] = [];
    for (const a of fa.alphabet) {
      const next = closure(fa, move(fa, sets[i], a));
      const k = key(next);
      if (!names.has(k)) {
        if (sets.length >= MAX_STATES) fail('tooManyStates', { max: MAX_STATES });
        names.set(k, next.size ? letterName(sets.length) : '∅');
        sets.push(next);
      }
      addEdge(dfa, from, a, names.get(k)!);
      to.push(names.get(k)!);
    }
    const accepting = [...sets[i]].some((q) => fa.accept.has(q));
    addState(dfa, from);
    if (accepting) dfa.accept.add(from);
    rows.push({ name: from, set: key(sets[i]), accept: accepting, to });
  }
  return { dfa, rows };
}

/** A DFA with a transition for every symbol: missing ones go to a new dead state. */
export function complete(dfa: Fa, alphabet: readonly string[] = dfa.alphabet): Fa {
  const out = copy(dfa);
  for (const a of alphabet) if (!out.alphabet.includes(a)) out.alphabet.push(a);
  out.alphabet.sort();
  let dead: string | null = null;
  for (const q of [...out.states])
    for (const a of out.alphabet)
      if (targets(out, q, a).size === 0) {
        if (dead === null) {
          dead = out.states.includes('dead') ? '∅' : 'dead';
          addState(out, dead);
          for (const b of out.alphabet) addEdge(out, dead, b, dead);
        }
        addEdge(out, q, a, dead);
      }
  return out;
}

function copy(fa: Fa): Fa {
  const out = emptyFa(fa.start);
  out.alphabet = [...fa.alphabet];
  for (const q of fa.states) addState(out, q);
  for (const [q, row] of fa.delta) for (const [a, to] of row) for (const t of to) addEdge(out, q, a, t);
  out.accept = new Set(fa.accept);
  return out;
}

/** A DFA for the machine: itself when it already is one, else by the subset construction. */
export const toDfa = (fa: Fa): Fa => (isDfa(fa) ? fa : subset(fa).dfa);

export function reachable(fa: Fa): Fa {
  const seen = new Set([fa.start]);
  const stack = [fa.start];
  while (stack.length) {
    const q = stack.pop()!;
    for (const to of fa.delta.get(q)?.values() ?? [])
      for (const t of to)
        if (!seen.has(t)) {
          seen.add(t);
          stack.push(t);
        }
  }
  const out = emptyFa(fa.start);
  out.alphabet = [...fa.alphabet];
  for (const q of fa.states.filter((x) => seen.has(x))) {
    addState(out, q);
    if (fa.accept.has(q)) out.accept.add(q);
    for (const [a, to] of fa.delta.get(q)!) for (const t of to) addEdge(out, q, a, t);
  }
  return out;
}

export interface Minimized {
  dfa: Fa;
  /** The partition after each round of refinement, as lists of state sets. */
  rounds: string[][];
  removed: string[];
}

/** Minimization: drop unreachable states, add a dead state if needed, then split classes until none splits. */
export function minimize(fa: Fa): Minimized {
  const base = toDfa(fa);
  const live = reachable(base);
  const removed = base.states.filter((q) => !live.states.includes(q));
  const d = complete(live);
  let classOf = new Map(d.states.map((q) => [q, d.accept.has(q) ? 0 : 1]));
  const show = (m: Map<string, number>) => {
    const groups = new Map<number, string[]>();
    for (const q of d.states) {
      const c = m.get(q)!;
      if (!groups.has(c)) groups.set(c, []);
      groups.get(c)!.push(q);
    }
    return [...groups.values()].map((g) => `{${g.join(', ')}}`);
  };
  const rounds = [show(classOf)];
  for (;;) {
    const sigs = new Map<string, number>();
    const next = new Map<string, number>();
    for (const q of d.states) {
      const sig = [classOf.get(q), ...d.alphabet.map((a) => classOf.get([...targets(d, q, a)][0]))].join(',');
      if (!sigs.has(sig)) sigs.set(sig, sigs.size);
      next.set(q, sigs.get(sig)!);
    }
    const before = new Set(classOf.values()).size;
    classOf = next;
    if (sigs.size === before) break;
    rounds.push(show(classOf));
  }
  const nameOf = new Map<number, string>();
  for (const q of d.states) {
    const c = classOf.get(q)!;
    nameOf.set(c, nameOf.has(c) ? `${nameOf.get(c)},${q}` : q);
  }
  const name = (q: string) => nameOf.get(classOf.get(q)!)!;
  const out = emptyFa(name(d.start));
  out.alphabet = [...d.alphabet];
  for (const q of d.states) {
    addState(out, name(q));
    if (d.accept.has(q)) out.accept.add(name(q));
    for (const a of d.alphabet) {
      const t = [...targets(d, q, a)][0];
      if (!targets(out, name(q), a).size) addEdge(out, name(q), a, name(t));
    }
  }
  return { dfa: out, rounds, removed };
}

/** The complement over the machine's alphabet (and any extra symbols). */
export function complement(fa: Fa, alphabet: readonly string[] = fa.alphabet): Fa {
  const d = complete(toDfa(fa), alphabet);
  d.accept = new Set(d.states.filter((q) => !d.accept.has(q)));
  return d;
}

export type ProductOp = 'union' | 'intersection' | 'difference';

/** The product machine of two automata, accepting by the chosen operation. */
export function product(a: Fa, b: Fa, op: ProductOp): Fa {
  const alphabet = [...new Set([...a.alphabet, ...b.alphabet])].sort();
  const da = complete(toDfa(a), alphabet);
  const db = complete(toDfa(b), alphabet);
  const name = (p: string, q: string) => `(${p}, ${q})`;
  const out = emptyFa(name(da.start, db.start));
  out.alphabet = alphabet;
  const stack: [string, string][] = [[da.start, db.start]];
  const seen = new Set([name(da.start, db.start)]);
  while (stack.length) {
    const [p, q] = stack.pop()!;
    const n = name(p, q);
    const inA = da.accept.has(p);
    const inB = db.accept.has(q);
    if (op === 'union' ? inA || inB : op === 'intersection' ? inA && inB : inA && !inB) out.accept.add(n);
    for (const s of alphabet) {
      const p2 = [...targets(da, p, s)][0];
      const q2 = [...targets(db, q, s)][0];
      const m = name(p2, q2);
      addEdge(out, n, s, m);
      if (!seen.has(m)) {
        seen.add(m);
        stack.push([p2, q2]);
      }
    }
  }
  return out;
}

/** Whether two automata accept the same strings; when not, a shortest string exactly one of them accepts. */
export function equivalent(a: Fa, b: Fa): { equal: true } | { equal: false; witness: string; first: boolean } {
  const alphabet = [...new Set([...a.alphabet, ...b.alphabet])].sort();
  const da = complete(toDfa(a), alphabet);
  const db = complete(toDfa(b), alphabet);
  const start = `${da.start}\u0000${db.start}`;
  const path = new Map<string, string>([[start, '']]);
  const queue: [string, string][] = [[da.start, db.start]];
  for (let i = 0; i < queue.length; i += 1) {
    const [p, q] = queue[i];
    const w = path.get(`${p}\u0000${q}`)!;
    if (da.accept.has(p) !== db.accept.has(q)) return { equal: false, witness: w, first: da.accept.has(p) };
    for (const s of alphabet) {
      const p2 = [...targets(da, p, s)][0];
      const q2 = [...targets(db, q, s)][0];
      const k = `${p2}\u0000${q2}`;
      if (!path.has(k)) {
        path.set(k, w + s);
        queue.push([p2, q2]);
      }
    }
  }
  return { equal: true };
}

/** Thompson's construction: states 0, 1, 2, … with one start and one accepting state. */
export function thompson(re: Re): Fa {
  const fa = emptyFa('0');
  let count = 1;
  const fresh = () => {
    const q = String(count++);
    addState(fa, q);
    return q;
  };
  const build = (r: Re, from: string): string => {
    switch (r.k) {
      case 'none':
        return fresh();
      case 'eps': {
        const to = fresh();
        addEdge(fa, from, EPS, to);
        return to;
      }
      case 'sym': {
        const to = fresh();
        addEdge(fa, from, r.c, to);
        return to;
      }
      case 'cat':
        return r.items.reduce((at, x) => build(x, at), from);
      case 'alt': {
        const ends = r.items.map((x) => {
          const s = fresh();
          addEdge(fa, from, EPS, s);
          return build(x, s);
        });
        const f = fresh();
        for (const e of ends) addEdge(fa, e, EPS, f);
        return f;
      }
      case 'star':
      case 'plus':
      case 'opt': {
        const s = fresh();
        addEdge(fa, from, EPS, s);
        const e = build(r.r, s);
        const f = fresh();
        if (r.k !== 'opt') addEdge(fa, e, EPS, s);
        addEdge(fa, e, EPS, f);
        if (r.k !== 'plus') addEdge(fa, from, EPS, f);
        return f;
      }
    }
  };
  fa.accept.add(build(re, '0'));
  fa.alphabet.sort();
  return fa;
}

/** State elimination: the machine as one regular expression, with the expression after each state goes. */
export function toRegex(fa: Fa): { re: Re; steps: { state: string; re: Re }[] } {
  const S = '\u0000start';
  const F = '\u0000final';
  const edge = new Map<string, Re>();
  const k = (p: string, q: string) => `${p}\u0001${q}`;
  const get = (p: string, q: string) => edge.get(k(p, q)) ?? NONE;
  const put = (p: string, q: string, r: Re) => edge.set(k(p, q), alt(get(p, q), r));
  put(S, fa.start, EPS_RE);
  for (const q of fa.accept) put(q, F, EPS_RE);
  for (const [p, row] of fa.delta)
    for (const [a, to] of row) for (const q of to) put(p, q, a === EPS ? EPS_RE : sym(a));
  const left = [...fa.states];
  const steps: { state: string; re: Re }[] = [];
  for (const x of fa.states) {
    left.splice(left.indexOf(x), 1);
    const loop = star(get(x, x));
    const ins = [S, ...left].filter((p) => get(p, x).k !== 'none');
    const outs = [...left, F].filter((q) => get(x, q).k !== 'none');
    for (const p of ins) for (const q of outs) put(p, q, cat(get(p, x), loop, get(x, q)));
    for (const key of [...edge.keys()]) {
      const [p, q] = key.split('\u0001');
      if (p === x || q === x) edge.delete(key);
    }
    steps.push({ state: x, re: get(S, F) });
  }
  return { re: get(S, F), steps };
}
