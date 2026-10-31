// Machines with memory: pushdown automata (searched breadth first, so nondeterminism is fine), single-tape Turing
// machines, and finite-state transducers with composition. Every search stops at a step limit and says so.
import { fail, lines } from '../core/util';

const EPS_WORDS = new Set(['ε', 'eps', 'λ', 'epsilon']);
const isEps = (w: string) => EPS_WORDS.has(w.toLowerCase());
export const STEP_LIMIT = 100_000;

const words = (line: string) => line.split(/[\s,]+/).filter((w) => w !== '' && w !== '->' && w !== '→');

/* ---------- Pushdown automata ---------- */

export interface PdaRule {
  from: string;
  read: string;
  pop: string;
  to: string;
  push: string;
}

export interface Pda {
  start: string;
  accept: Set<string>;
  bottom: string;
  rules: PdaRule[];
}

/** Lines `q a X -> p YZ`: in state q, reading a (or ε), pop X (or ε), go to p and push YZ with Y on top. */
export function parsePda(text: string): Pda {
  let start: string | null = null;
  let bottom = 'Z';
  const accept = new Set<string>();
  const rules: PdaRule[] = [];
  for (const line of lines(text)) {
    const w = words(line);
    const head = w[0].toLowerCase();
    if (head === 'start') start = w[1] ?? fail('startLine', { line });
    else if (head === 'accept' || head === 'final') w.slice(1).forEach((q) => accept.add(q));
    else if (head === 'stack' || head === 'bottom') bottom = w[1] ?? fail('pdaLine', { line });
    else {
      if (w.length !== 5) fail('pdaLine', { line });
      const [from, read, pop, to, push] = w;
      const r = isEps(read) ? '' : read;
      const p = isEps(pop) ? '' : pop;
      if ([...r].length > 1 || [...p].length > 1) fail('pdaSymbol', { line });
      rules.push({ from, read: r, pop: p, to, push: isEps(push) ? '' : push });
    }
  }
  if (rules.length === 0) fail('emptyMachine');
  if ([...bottom].length !== 1) fail('pdaSymbol', { line: bottom });
  return { start: start ?? rules[0].from, accept, bottom, rules };
}

export interface PdaConfig {
  state: string;
  pos: number;
  /** The stack with its top first. */
  stack: string;
}

export interface PdaRun {
  accepted: boolean;
  path: PdaConfig[];
  explored: number;
  capped: boolean;
}

/** Breadth-first search over configurations; accepts by final state or by empty stack at the end of the input. */
export function runPda(pda: Pda, input: readonly string[], byEmpty: boolean): PdaRun {
  const n = input.length;
  const maxStack = 4 * n + 32;
  const first: PdaConfig = { state: pda.start, pos: 0, stack: pda.bottom };
  const key = (c: PdaConfig) => `${c.state}\u0000${c.pos}\u0000${c.stack}`;
  const parent = new Map<string, string | null>([[key(first), null]]);
  const configs = new Map<string, PdaConfig>([[key(first), first]]);
  const queue = [first];
  let capped = false;
  const done = (c: PdaConfig) => c.pos === n && (byEmpty ? c.stack === '' : pda.accept.has(c.state));
  for (let i = 0; i < queue.length; i += 1) {
    const c = queue[i];
    if (done(c)) {
      const path: PdaConfig[] = [];
      for (let k: string | null = key(c); k !== null; k = parent.get(k) ?? null) path.unshift(configs.get(k)!);
      return { accepted: true, path, explored: i + 1, capped: false };
    }
    if (queue.length > STEP_LIMIT) {
      capped = true;
      break;
    }
    for (const r of pda.rules) {
      if (r.from !== c.state) continue;
      if (r.read !== '' && input[c.pos] !== r.read) continue;
      if (r.pop !== '' && c.stack[0] !== r.pop) continue;
      const rest = r.pop === '' ? c.stack : c.stack.slice(1);
      const next: PdaConfig = { state: r.to, pos: c.pos + (r.read === '' ? 0 : 1), stack: r.push + rest };
      if (next.stack.length > maxStack) continue;
      const k = key(next);
      if (parent.has(k)) continue;
      parent.set(k, key(c));
      configs.set(k, next);
      queue.push(next);
    }
  }
  return { accepted: false, path: [], explored: queue.length, capped };
}

/* ---------- Turing machines ---------- */

export interface TmRule {
  write: string;
  move: -1 | 0 | 1;
  to: string;
}

export interface Tm {
  start: string;
  accept: Set<string>;
  reject: Set<string>;
  blank: string;
  rules: Map<string, TmRule>;
}

/** Lines `q a -> p b R`: in state q reading a, write b, move L, R, or S, and go to p. */
export function parseTm(text: string): Tm {
  let start: string | null = null;
  let blank = '_';
  const accept = new Set<string>();
  const reject = new Set<string>();
  const rules = new Map<string, TmRule>();
  for (const line of lines(text)) {
    const w = words(line);
    const head = w[0].toLowerCase();
    if (head === 'start') start = w[1] ?? fail('startLine', { line });
    else if (head === 'accept' || head === 'halt' || head === 'final') w.slice(1).forEach((q) => accept.add(q));
    else if (head === 'reject') w.slice(1).forEach((q) => reject.add(q));
    else if (head === 'blank') blank = w[1] ?? fail('tmLine', { line });
    else {
      if (w.length !== 5) fail('tmLine', { line });
      const [from, read, to, write, dir] = w;
      const m = dir.toUpperCase();
      if (!['L', 'R', 'S', 'N'].includes(m)) fail('tmMove', { line });
      if ([...read].length !== 1 || [...write].length !== 1) fail('tmSymbol', { line });
      const k = `${from}\u0000${read}`;
      if (rules.has(k)) fail('tmTwice', { state: from, symbol: read });
      rules.set(k, { to, write, move: m === 'L' ? -1 : m === 'R' ? 1 : 0 });
    }
  }
  if (rules.size === 0) fail('emptyMachine');
  if ([...blank].length !== 1) fail('tmSymbol', { line: blank });
  return { start: start ?? [...rules.keys()][0].split('\u0000')[0], accept, reject, blank, rules };
}

export interface TmConfig {
  step: number;
  state: string;
  head: number;
  tape: Map<number, string>;
}

export type TmEnd = 'accept' | 'reject' | 'halt' | 'limit';

export interface TmRun {
  end: TmEnd;
  steps: number;
  final: TmConfig;
  /** Configurations at the first steps, for the trace. */
  trace: TmConfig[];
  /** The configuration at the asked step, if the run got that far. */
  at: TmConfig | null;
}

const snapshot = (c: TmConfig): TmConfig => ({ ...c, tape: new Map(c.tape) });

export function runTm(tm: Tm, input: readonly string[], limit = STEP_LIMIT, atStep = -1, traceLength = 40): TmRun {
  const tape = new Map<number, string>();
  input.forEach((c, i) => tape.set(i, c));
  const c: TmConfig = { step: 0, state: tm.start, head: 0, tape };
  const trace = [snapshot(c)];
  let at: TmConfig | null = atStep === 0 ? snapshot(c) : null;
  for (;;) {
    if (tm.accept.has(c.state)) return { end: 'accept', steps: c.step, final: c, trace, at };
    if (tm.reject.has(c.state)) return { end: 'reject', steps: c.step, final: c, trace, at };
    const rule = tm.rules.get(`${c.state}\u0000${c.tape.get(c.head) ?? tm.blank}`);
    if (!rule) return { end: tm.accept.size ? 'reject' : 'halt', steps: c.step, final: c, trace, at };
    if (c.step >= limit) return { end: 'limit', steps: c.step, final: c, trace, at };
    if (rule.write === tm.blank) c.tape.delete(c.head);
    else c.tape.set(c.head, rule.write);
    c.head += rule.move;
    c.state = rule.to;
    c.step += 1;
    if (trace.length < traceLength) trace.push(snapshot(c));
    if (c.step === atStep) at = snapshot(c);
  }
}

/** The written part of the tape, from its first to its last non-blank cell (and the head, when asked). */
export function tapeText(tm: Tm, c: TmConfig, withHead = false): string {
  const cells = [...c.tape.keys()];
  if (withHead) cells.push(c.head);
  if (cells.length === 0) return '';
  const lo = Math.min(...cells);
  const hi = Math.max(...cells);
  let out = '';
  for (let i = lo; i <= hi; i += 1) {
    const s = c.tape.get(i) ?? tm.blank;
    out += withHead && i === c.head ? `[${s}]` : s;
  }
  return withHead ? out : out.replace(new RegExp(`^${escape(tm.blank)}+|${escape(tm.blank)}+$`, 'g'), '');
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ---------- Finite-state transducers ---------- */

export interface FstArc {
  from: string;
  /** One input symbol, or '' for ε. */
  input: string;
  /** The output string, '' for ε. */
  output: string;
  to: string;
}

export interface Fst {
  start: string;
  final: Set<string>;
  arcs: FstArc[];
}

/** Lines `q a:out p`; either side may be ε. Output may be several symbols, the input side only one. */
export function parseFst(text: string): Fst {
  let start: string | null = null;
  const final = new Set<string>();
  const arcs: FstArc[] = [];
  for (const line of lines(text)) {
    const w = words(line);
    const head = w[0].toLowerCase();
    if (head === 'start') start = w[1] ?? fail('startLine', { line });
    else if (head === 'final' || head === 'accept') w.slice(1).forEach((q) => final.add(q));
    else {
      if (w.length !== 3 || !w[1].includes(':')) fail('fstLine', { line });
      const cut = w[1][0] === ':' && w[1].indexOf(':', 1) > 0 ? 1 : w[1].indexOf(':');
      const a = w[1].slice(0, cut);
      const b = w[1].slice(cut + 1);
      const input = isEps(a) ? '' : a;
      if ([...input].length > 1) fail('fstInput', { line });
      arcs.push({ from: w[0], input, output: isEps(b) ? '' : b, to: w[2] });
    }
  }
  if (arcs.length === 0) fail('emptyMachine');
  return { start: start ?? arcs[0].from, final, arcs };
}

/** Every output the transducer can give for the input, sorted, and whether the search hit its limit. */
export function transduce(fst: Fst, input: readonly string[], maxOutputs = 50): { outputs: string[]; capped: boolean } {
  const maxLen = 4 * input.length + 32;
  const seen = new Set<string>();
  const outputs = new Set<string>();
  const queue: [string, number, string][] = [[fst.start, 0, '']];
  let capped = false;
  for (let i = 0; i < queue.length; i += 1) {
    if (queue.length > STEP_LIMIT || outputs.size >= maxOutputs) {
      capped = true;
      break;
    }
    const [q, pos, out] = queue[i];
    if (pos === input.length && fst.final.has(q)) outputs.add(out);
    for (const a of fst.arcs) {
      if (a.from !== q) continue;
      if (a.input !== '' && a.input !== input[pos]) continue;
      const next: [string, number, string] = [a.to, pos + (a.input === '' ? 0 : 1), out + a.output];
      if (next[2].length > maxLen) continue;
      const k = next.join('\u0000');
      if (!seen.has(k)) {
        seen.add(k);
        queue.push(next);
      }
    }
  }
  return { outputs: [...outputs].sort(), capped };
}

/** The same transducer with at most one output symbol per arc, by chains through new states. */
function split(fst: Fst, tag: string): Fst {
  const arcs: FstArc[] = [];
  let n = 0;
  for (const a of fst.arcs) {
    const out = [...a.output];
    if (out.length <= 1) {
      arcs.push(a);
      continue;
    }
    let from = a.from;
    out.forEach((c, i) => {
      const to = i === out.length - 1 ? a.to : `${tag}${(n += 1)}`;
      arcs.push({ from, input: i === 0 ? a.input : '', output: c, to });
      from = to;
    });
  }
  return { ...fst, arcs };
}

/** The composition: the first transducer's output feeds the second's input. */
export function compose(first: Fst, second: Fst): Fst {
  const t1 = split(first, '·a');
  const t2 = split(second, '·b');
  const name = (p: string, q: string) => `${p}|${q}`;
  const arcs: FstArc[] = [];
  const final = new Set<string>();
  const start = name(t1.start, t2.start);
  const seen = new Set([start]);
  const stack: [string, string][] = [[t1.start, t2.start]];
  const add = (from: string, arc: Omit<FstArc, 'from'>, p: string, q: string) => {
    arcs.push({ from, ...arc });
    if (!seen.has(arc.to)) {
      seen.add(arc.to);
      stack.push([p, q]);
    }
  };
  while (stack.length) {
    if (arcs.length > STEP_LIMIT) fail('tooManyStates', { max: STEP_LIMIT });
    const [p, q] = stack.pop()!;
    const from = name(p, q);
    if (t1.final.has(p) && t2.final.has(q)) final.add(from);
    for (const a of t1.arcs.filter((x) => x.from === p)) {
      if (a.output === '') add(from, { input: a.input, output: '', to: name(a.to, q) }, a.to, q);
      else
        for (const b of t2.arcs.filter((x) => x.from === q && x.input === a.output))
          add(from, { input: a.input, output: b.output, to: name(a.to, b.to) }, a.to, b.to);
    }
    for (const b of t2.arcs.filter((x) => x.from === q && x.input === ''))
      add(from, { input: '', output: b.output, to: name(p, b.to) }, p, b.to);
  }
  return { start, final, arcs };
}
