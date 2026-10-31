// Context-free grammars. A grammar is typed one left side per line, `A -> α | β`, with ε (or eps) for the empty
// string. When any right side has a space in it, symbols are separated by spaces (E -> T E'); otherwise each
// character is a symbol and nonterminal names are matched longest first (S -> aSb). From a grammar come parse trees
// and their number (to show ambiguity), the leftmost derivation, Chomsky normal form stage by stage, CYK, FIRST and
// FOLLOW, the LL(1) table, LR(0) item sets, and the SLR(1) table with a shift-reduce trace.
import { fail, lines } from '../core/util';

const EPS_WORDS = new Set(['ε', 'eps', 'λ', 'epsilon']);
export const END = '$';

export interface Prod {
  lhs: string;
  rhs: readonly string[];
}

export interface Grammar {
  start: string;
  nonterminals: string[];
  terminals: string[];
  prods: Prod[];
}

function tokenize(text: string, names: readonly string[]): string[] {
  const sorted = [...names].sort((a, b) => b.length - a.length);
  const out: string[] = [];
  const chars = [...text];
  for (let i = 0; i < chars.length;) {
    const rest = chars.slice(i).join('');
    const hit = sorted.find((n) => rest.startsWith(n));
    if (hit) {
      out.push(hit);
      i += [...hit].length;
    } else {
      let j = i + 1;
      while (chars[j] === "'") j += 1;
      out.push(chars.slice(i, j).join(''));
      i = j;
    }
  }
  return out;
}

export function parseGrammar(text: string): Grammar {
  const raw: { lhs: string; alts: string[] }[] = [];
  for (const line of lines(text)) {
    if (line.startsWith('|')) {
      if (!raw.length) fail('grammarLine', { line });
      raw[raw.length - 1].alts.push(...line.slice(1).split('|'));
      continue;
    }
    const m = /^(\S+?)\s*(->|→|::=)(.*)$/.exec(line);
    if (!m) fail('grammarLine', { line });
    raw.push({ lhs: m![1], alts: m![3].split('|') });
  }
  if (raw.length === 0) fail('emptyGrammar');
  const nonterminals = [...new Set(raw.map((r) => r.lhs))];
  const spaced = raw.some((r) => r.alts.some((a) => /\S\s+\S/.test(a.trim())));
  const prods: Prod[] = [];
  for (const r of raw)
    for (const alt of r.alts) {
      const t = alt.trim();
      const symbols =
        t === '' || EPS_WORDS.has(t.toLowerCase()) ? [] : spaced ? t.split(/\s+/) : tokenize(t, nonterminals);
      const rhs = symbols.filter((s) => !EPS_WORDS.has(s.toLowerCase()));
      if (!prods.some((p) => p.lhs === r.lhs && p.rhs.join(' ') === rhs.join(' '))) prods.push({ lhs: r.lhs, rhs });
    }
  if (prods.length > 300) fail('grammarSize', { max: 300 });
  return build(raw[0].lhs, prods, nonterminals);
}

function build(start: string, prods: Prod[], order: readonly string[] = []): Grammar {
  const nonterminals = [...new Set([...order, start, ...prods.map((p) => p.lhs)])].filter((n) =>
    prods.some((p) => p.lhs === n),
  );
  const nt = new Set(nonterminals);
  const terminals = [...new Set(prods.flatMap((p) => p.rhs.filter((s) => !nt.has(s))))];
  return { start, nonterminals, terminals, prods };
}

export const isNt = (g: Grammar, s: string): boolean => g.nonterminals.includes(s);

/** The symbols of an input: split at spaces when it has any, else matched longest first against the terminals. */
export function tokensOf(g: Grammar, text: string): string[] {
  const t = text.trim();
  if (t === '' || EPS_WORDS.has(t.toLowerCase())) return [];
  return /\s/.test(t) ? t.split(/\s+/) : tokenize(t, g.terminals);
}

export const rhsText = (rhs: readonly string[]): string => (rhs.length ? rhs.join(' ') : 'ε');
export const prodText = (p: Prod): string => `${p.lhs} → ${rhsText(p.rhs)}`;

/** The grammar as lines, one per left side. */
export function grammarLines(g: Grammar): string[] {
  return g.nonterminals.map(
    (a) =>
      `${a} → ${g.prods
        .filter((p) => p.lhs === a)
        .map((p) => rhsText(p.rhs))
        .join(' | ')}`,
  );
}

/* ---------- FIRST and FOLLOW ---------- */

export interface Sets {
  nullable: Set<string>;
  first: Map<string, Set<string>>;
  follow: Map<string, Set<string>>;
}

export function firstOfSeq(g: Grammar, sets: Pick<Sets, 'nullable' | 'first'>, seq: readonly string[]) {
  const out = new Set<string>();
  for (const s of seq) {
    if (!isNt(g, s)) {
      out.add(s);
      return { set: out, nullable: false };
    }
    for (const t of sets.first.get(s) ?? []) out.add(t);
    if (!sets.nullable.has(s)) return { set: out, nullable: false };
  }
  return { set: out, nullable: true };
}

export function firstFollow(g: Grammar): Sets {
  const nullable = new Set<string>();
  const first = new Map(g.nonterminals.map((a) => [a, new Set<string>()]));
  const follow = new Map(g.nonterminals.map((a) => [a, new Set<string>()]));
  follow.get(g.start)!.add(END);
  for (let changed = true; changed;) {
    changed = false;
    for (const p of g.prods) {
      const f = firstOfSeq(g, { nullable, first }, p.rhs);
      const target = first.get(p.lhs)!;
      for (const t of f.set)
        if (!target.has(t)) {
          target.add(t);
          changed = true;
        }
      if (f.nullable && !nullable.has(p.lhs)) {
        nullable.add(p.lhs);
        changed = true;
      }
    }
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const p of g.prods)
      p.rhs.forEach((s, i) => {
        if (!isNt(g, s)) return;
        const rest = firstOfSeq(g, { nullable, first }, p.rhs.slice(i + 1));
        const target = follow.get(s)!;
        const add = [...rest.set, ...(rest.nullable ? follow.get(p.lhs)! : [])];
        for (const t of add)
          if (!target.has(t)) {
            target.add(t);
            changed = true;
          }
      });
  }
  return { nullable, first, follow };
}

/* ---------- LL(1) ---------- */

export interface Ll1 {
  sets: Sets;
  columns: string[];
  /** nonterminal → terminal → production numbers. */
  table: Map<string, Map<string, number[]>>;
  conflicts: { nt: string; t: string; prods: number[] }[];
}

export function ll1(g: Grammar): Ll1 {
  const sets = firstFollow(g);
  const columns = [...g.terminals, END];
  const table = new Map(g.nonterminals.map((a) => [a, new Map<string, number[]>()]));
  g.prods.forEach((p, i) => {
    const f = firstOfSeq(g, sets, p.rhs);
    const cols = [...f.set, ...(f.nullable ? sets.follow.get(p.lhs)! : [])];
    const row = table.get(p.lhs)!;
    for (const t of new Set(cols)) row.set(t, [...(row.get(t) ?? []), i]);
  });
  const conflicts = [...table].flatMap(([nt, row]) =>
    [...row].filter(([, ps]) => ps.length > 1).map(([t, prods]) => ({ nt, t, prods })),
  );
  return { sets, columns, table, conflicts };
}

export interface TraceRow {
  stack: string;
  input: string;
  action: string;
}

export const PARSE_LIMIT = 10_000;

/** A table-driven predictive parse; each row is the stack (top at the right), the input left, and the move. */
export function ll1Parse(g: Grammar, t: Ll1, tokens: readonly string[]): { ok: boolean; rows: TraceRow[] } {
  const stack = [END, g.start];
  const input = [...tokens, END];
  let pos = 0;
  const rows: TraceRow[] = [];
  const row = (action: string) => rows.push({ stack: stack.join(' '), input: input.slice(pos).join(' '), action });
  while (rows.length < PARSE_LIMIT) {
    const top = stack[stack.length - 1];
    const a = input[pos];
    if (top === END && a === END) {
      row('accept');
      return { ok: true, rows };
    }
    if (!isNt(g, top)) {
      if (top !== a) {
        row(`error:${top}`);
        return { ok: false, rows };
      }
      row(`match:${a}`);
      stack.pop();
      pos += 1;
      continue;
    }
    const ps = t.table.get(top)?.get(a);
    if (!ps?.length) {
      row(`error:${a}`);
      return { ok: false, rows };
    }
    row(`use:${ps[0]}`);
    stack.pop();
    for (const s of [...g.prods[ps[0]].rhs].reverse()) stack.push(s);
  }
  return { ok: false, rows };
}

/* ---------- LR(0) and SLR(1) ---------- */

export interface Lr {
  /** The augmented grammar: production 0 is S' → S. */
  g: Grammar;
  states: [number, number][][];
  goto: Map<number, Map<string, number>>;
  /** state → terminal or $ → actions such as s4, r2, acc. */
  action: Map<number, Map<string, string[]>>;
  conflicts: { state: number; t: string; actions: string[] }[];
}

export const itemText = (g: Grammar, [p, dot]: readonly [number, number]): string => {
  const rhs = [...g.prods[p].rhs];
  rhs.splice(dot, 0, '•');
  return `${g.prods[p].lhs} → ${rhs.join(' ')}`;
};

export function slr(base: Grammar): Lr {
  let top = `${base.start}'`;
  while (base.nonterminals.includes(top)) top += "'";
  const g = build(top, [{ lhs: top, rhs: [base.start] }, ...base.prods], [top, ...base.nonterminals]);
  const closure = (items: [number, number][]) => {
    const out = [...items];
    const keys = new Set(out.map((i) => i.join(',')));
    for (let k = 0; k < out.length; k += 1) {
      const [p, dot] = out[k];
      const next = g.prods[p].rhs[dot];
      if (next === undefined || !isNt(g, next)) continue;
      g.prods.forEach((q, i) => {
        if (q.lhs === next && !keys.has(`${i},0`)) {
          keys.add(`${i},0`);
          out.push([i, 0]);
        }
      });
    }
    return out.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  };
  const key = (items: [number, number][]) => items.map((i) => i.join(',')).join(';');
  const states = [closure([[0, 0]])];
  const index = new Map([[key(states[0]), 0]]);
  const goto = new Map<number, Map<string, number>>();
  for (let s = 0; s < states.length; s += 1) {
    if (states.length > 500) fail('grammarSize', { max: 500 });
    const row = new Map<string, number>();
    const symbols = [...new Set(states[s].map(([p, d]) => g.prods[p].rhs[d]).filter((x) => x !== undefined))];
    for (const x of symbols) {
      const moved = closure(
        states[s].filter(([p, d]) => g.prods[p].rhs[d] === x).map(([p, d]) => [p, d + 1] as [number, number]),
      );
      const k = key(moved);
      if (!index.has(k)) {
        index.set(k, states.length);
        states.push(moved);
      }
      row.set(x, index.get(k)!);
    }
    goto.set(s, row);
  }
  const { follow } = firstFollow(g);
  const action = new Map<number, Map<string, string[]>>();
  states.forEach((items, s) => {
    const row = new Map<string, string[]>();
    const add = (t: string, a: string) => {
      const list = row.get(t) ?? [];
      if (!list.includes(a)) row.set(t, [...list, a]);
    };
    for (const [p, d] of items) {
      const next = g.prods[p].rhs[d];
      if (next !== undefined && !isNt(g, next)) add(next, `s${goto.get(s)!.get(next)}`);
      if (next === undefined) {
        if (p === 0) add(END, 'acc');
        else for (const t of follow.get(g.prods[p].lhs)!) add(t, `r${p}`);
      }
    }
    action.set(s, row);
  });
  const conflicts = [...action].flatMap(([state, row]) =>
    [...row].filter(([, a]) => a.length > 1).map(([t, actions]) => ({ state, t, actions })),
  );
  return { g, states, goto, action, conflicts };
}

/** A shift-reduce parse by the SLR table; with a conflict it takes the first action listed. */
export function slrParse(lr: Lr, tokens: readonly string[]): { ok: boolean; rows: TraceRow[] } {
  const states = [0];
  const symbols: string[] = [];
  const input = [...tokens, END];
  let pos = 0;
  const rows: TraceRow[] = [];
  const stackText = () => [0, ...symbols.flatMap((x, i) => [x, states[i + 1]])].join(' ');
  while (rows.length < PARSE_LIMIT) {
    const s = states[states.length - 1];
    const a = input[pos];
    const act = lr.action.get(s)?.get(a)?.[0];
    const row = (action: string) => rows.push({ stack: stackText(), input: input.slice(pos).join(' '), action });
    if (!act) {
      row(`error:${a}`);
      return { ok: false, rows };
    }
    if (act === 'acc') {
      row('accept');
      return { ok: true, rows };
    }
    if (act[0] === 's') {
      row(`shift:${act.slice(1)}`);
      states.push(Number(act.slice(1)));
      symbols.push(a);
      pos += 1;
    } else {
      const p = lr.g.prods[Number(act.slice(1))];
      row(`reduce:${act.slice(1)}`);
      states.splice(states.length - p.rhs.length);
      symbols.splice(symbols.length - p.rhs.length);
      const back = lr.goto.get(states[states.length - 1])?.get(p.lhs);
      if (back === undefined) return { ok: false, rows };
      states.push(back);
      symbols.push(p.lhs);
    }
  }
  return { ok: false, rows };
}

/* ---------- Chomsky normal form and CYK ---------- */

export interface Stage {
  key: 'start' | 'term' | 'bin' | 'del' | 'unit' | 'useless';
  g: Grammar;
}

function freshName(taken: Set<string>, base: string): string {
  let name = base;
  for (let i = 1; taken.has(name); i += 1) name = `${base}${i}`;
  taken.add(name);
  return name;
}

const dedupe = (prods: Prod[]): Prod[] => {
  const seen = new Set<string>();
  return prods.filter((p) => {
    const k = `${p.lhs}\u0000${p.rhs.join('\u0001')}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
};

/** Chomsky normal form, with the grammar after each stage: new start, terminals, binarize, ε rules, unit rules. */
export function toCnf(g0: Grammar): { cnf: Grammar; stages: Stage[] } {
  const taken = new Set([...g0.nonterminals, ...g0.terminals]);
  const stages: Stage[] = [];
  let start = g0.start;
  let prods: Prod[] = g0.prods.map((p) => ({ lhs: p.lhs, rhs: [...p.rhs] }));
  const nts = () => [...new Set([start, ...g0.nonterminals, ...prods.map((p) => p.lhs)])];
  if (prods.some((p) => p.rhs.includes(start))) {
    const s0 = freshName(taken, `${start}0`);
    prods.unshift({ lhs: s0, rhs: [start] });
    start = s0;
    stages.push({ key: 'start', g: build(start, prods, nts()) });
  }
  const ntSet = () => new Set(prods.map((p) => p.lhs));
  // Terminals inside longer right sides get a nonterminal of their own.
  const termOf = new Map<string, string>();
  let changed = false;
  prods = prods.flatMap((p) => {
    if (p.rhs.length < 2) return [p];
    const set = ntSet();
    return [
      {
        lhs: p.lhs,
        rhs: p.rhs.map((s) => {
          if (set.has(s)) return s;
          changed = true;
          if (!termOf.has(s)) termOf.set(s, freshName(taken, /^[a-z0-9]$/i.test(s) ? `T${s}` : 'T'));
          return termOf.get(s)!;
        }),
      },
    ];
  });
  for (const [t, n] of termOf) prods.push({ lhs: n, rhs: [t] });
  if (changed) stages.push({ key: 'term', g: build(start, prods, nts()) });
  // Long right sides become chains of pairs.
  changed = false;
  prods = prods.flatMap((p) => {
    if (p.rhs.length <= 2) return [p];
    changed = true;
    const out: Prod[] = [];
    let lhs = p.lhs;
    for (let i = 0; i < p.rhs.length - 2; i += 1) {
      const next = freshName(taken, `${p.lhs}_`);
      out.push({ lhs, rhs: [p.rhs[i], next] });
      lhs = next;
    }
    out.push({ lhs, rhs: p.rhs.slice(-2) });
    return out;
  });
  if (changed) stages.push({ key: 'bin', g: build(start, prods, nts()) });
  // ε rules: every way of leaving out nullable symbols, then no ε except at the start.
  const nullable = new Set<string>();
  for (let more = true; more;) {
    more = false;
    for (const p of prods)
      if (!nullable.has(p.lhs) && p.rhs.every((s) => nullable.has(s))) {
        nullable.add(p.lhs);
        more = true;
      }
  }
  if (nullable.size) {
    const out: Prod[] = [];
    for (const p of prods) {
      const spots = p.rhs.map((s, i) => (nullable.has(s) ? i : -1)).filter((i) => i >= 0);
      for (let m = 0; m < 1 << spots.length; m += 1) {
        const rhs = p.rhs.filter((_, i) => !spots.some((sp, b) => sp === i && m & (1 << b)));
        if (rhs.length || p.lhs === start) out.push({ lhs: p.lhs, rhs });
      }
    }
    prods = dedupe(out).filter((p) => p.rhs.length > 0 || p.lhs === start);
    stages.push({ key: 'del', g: build(start, prods, nts()) });
  }
  // Unit rules: A → B is replaced by B's other rules, through chains of unit rules.
  const isUnit = (p: Prod) => p.rhs.length === 1 && ntSet().has(p.rhs[0]);
  if (prods.some(isUnit)) {
    const set = ntSet();
    const out: Prod[] = [];
    for (const a of set) {
      const reach = new Set([a]);
      const stack = [a];
      while (stack.length) {
        const b = stack.pop()!;
        for (const p of prods)
          if (p.lhs === b && p.rhs.length === 1 && set.has(p.rhs[0]) && !reach.has(p.rhs[0])) {
            reach.add(p.rhs[0]);
            stack.push(p.rhs[0]);
          }
      }
      for (const b of reach)
        for (const p of prods)
          if (p.lhs === b && !(p.rhs.length === 1 && set.has(p.rhs[0]))) out.push({ lhs: a, rhs: p.rhs });
    }
    prods = dedupe(out);
    stages.push({ key: 'unit', g: build(start, prods, nts()) });
  }
  // Symbols that derive no string, or that the start never reaches, go.
  const before = prods.length;
  const generating = new Set<string>();
  const nt = ntSet();
  for (let more = true; more;) {
    more = false;
    for (const p of prods)
      if (!generating.has(p.lhs) && p.rhs.every((s) => !nt.has(s) || generating.has(s))) {
        generating.add(p.lhs);
        more = true;
      }
  }
  prods = prods.filter((p) => generating.has(p.lhs) && p.rhs.every((s) => !nt.has(s) || generating.has(s)));
  const reached = new Set([start]);
  for (let more = true; more;) {
    more = false;
    for (const p of prods)
      if (reached.has(p.lhs))
        for (const s of p.rhs)
          if (nt.has(s) && !reached.has(s)) {
            reached.add(s);
            more = true;
          }
  }
  prods = prods.filter((p) => reached.has(p.lhs));
  if (prods.length !== before) stages.push({ key: 'useless', g: build(start, prods, nts()) });
  return { cnf: build(start, prods, nts()), stages };
}

/** CYK on a grammar in Chomsky normal form: cell [length − 1][start] holds the nonterminals deriving that span. */
export function cyk(g: Grammar, tokens: readonly string[]): { accepted: boolean; table: string[][][] } {
  const n = tokens.length;
  if (n === 0) return { accepted: g.prods.some((p) => p.lhs === g.start && p.rhs.length === 0), table: [] };
  const table: Set<string>[][] = Array.from({ length: n }, (_, l) => Array.from({ length: n - l }, () => new Set()));
  tokens.forEach((t, i) => {
    for (const p of g.prods) if (p.rhs.length === 1 && p.rhs[0] === t) table[0][i].add(p.lhs);
  });
  for (let l = 2; l <= n; l += 1)
    for (let i = 0; i + l <= n; i += 1)
      for (let k = 1; k < l; k += 1)
        for (const p of g.prods)
          if (p.rhs.length === 2 && table[k - 1][i].has(p.rhs[0]) && table[l - k - 1][i + k].has(p.rhs[1]))
            table[l - 1][i].add(p.lhs);
  const order = new Map(g.nonterminals.map((a, i) => [a, i]));
  const sorted = table.map((row) => row.map((c) => [...c].sort((a, b) => order.get(a)! - order.get(b)!)));
  return { accepted: table[n - 1][0].has(g.start), table: sorted };
}

/* ---------- Parse trees ---------- */

export interface Tree {
  sym: string;
  children: Tree[];
}

export const TREE_TOKENS = 40;
const CAP = 1_000_000;

/** How many parse trees the input has (capped), with up to 2 of them. Cycles of unit or ε rules are not followed. */
export function parseTrees(g: Grammar, tokens: readonly string[]): { count: number; trees: Tree[] } {
  if (tokens.length > TREE_TOKENS) fail('inputLong', { max: TREE_TOKENS });
  const minLen = new Map<string, number>(g.nonterminals.map((a) => [a, Infinity]));
  const lenOf = (s: string) => (isNt(g, s) ? minLen.get(s)! : 1);
  for (let more = true; more;) {
    more = false;
    for (const p of g.prods) {
      const l = p.rhs.reduce((a, s) => a + lenOf(s), 0);
      if (l < minLen.get(p.lhs)!) {
        minLen.set(p.lhs, l);
        more = true;
      }
    }
  }
  type Result = { count: number; trees: Tree[][] };
  const symMemo = new Map<string, { count: number; trees: Tree[] } | null>();
  const seqMemo = new Map<string, Result>();
  const symbol = (x: string, i: number, j: number): { count: number; trees: Tree[] } => {
    if (!isNt(g, x)) return j === i + 1 && tokens[i] === x ? { count: 1, trees: [{ sym: x, children: [] }] } : NO;
    const k = `${x}|${i}|${j}`;
    if (symMemo.has(k)) return symMemo.get(k) ?? NO;
    symMemo.set(k, null);
    let count = 0;
    const trees: Tree[] = [];
    g.prods.forEach((p, pi) => {
      if (p.lhs !== x) return;
      const r = seq(pi, 0, i, j);
      count = Math.min(CAP, count + r.count);
      for (const kids of r.trees)
        if (trees.length < 2) trees.push({ sym: x, children: kids.length ? kids : [{ sym: 'ε', children: [] }] });
    });
    const out = { count, trees };
    symMemo.set(k, out);
    return out;
  };
  const NO = { count: 0, trees: [] as Tree[] };
  const seq = (pi: number, idx: number, i: number, j: number): Result => {
    const rhs = g.prods[pi].rhs;
    if (idx === rhs.length) return j === i ? { count: 1, trees: [[]] } : { count: 0, trees: [] };
    const k = `${pi}|${idx}|${i}|${j}`;
    const hit = seqMemo.get(k);
    if (hit) return hit;
    let rest = 0;
    for (let q = idx + 1; q < rhs.length; q += 1) rest += lenOf(rhs[q]);
    let count = 0;
    const trees: Tree[][] = [];
    for (let m = i + lenOf(rhs[idx]); m <= j - rest; m += 1) {
      const left = symbol(rhs[idx], i, m);
      if (!left.count) continue;
      const right = seq(pi, idx + 1, m, j);
      if (!right.count) continue;
      count = Math.min(CAP, count + left.count * right.count);
      for (const a of left.trees) for (const b of right.trees) if (trees.length < 2) trees.push([a, ...b]);
    }
    const out = { count, trees };
    seqMemo.set(k, out);
    return out;
  };
  const r = symbol(g.start, 0, tokens.length);
  return { count: r.count, trees: r.trees };
}

/** The leftmost derivation a parse tree stands for, as sentential forms. */
export function leftmost(g: Grammar, tree: Tree): string[] {
  let form: Tree[] = [tree];
  const out = [tree.sym];
  for (;;) {
    const i = form.findIndex((t) => isNt(g, t.sym) && t.children.length > 0);
    if (i < 0) break;
    const kids = form[i].children.filter((c) => c.sym !== 'ε' || c.children.length > 0);
    form = [...form.slice(0, i), ...kids, ...form.slice(i + 1)];
    out.push(form.length ? form.map((t) => t.sym).join(' ') : 'ε');
  }
  return out;
}
