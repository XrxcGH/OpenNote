// Finite-state machines for sequential design, Mealy and Moore: read a state table, run an input sequence, minimize
// by partition refinement, and build machines such as sequence detectors and counters.
//
// The table format is one state per line, the first being the start state:
//   Mealy:  S0: 0 -> S0 / 0, 1 -> S1 / 0
//   Moore:  S0 / 0: 0 -> S0, 1 -> S1
import { step } from '../core/step';
import type { Step } from '../core/step';
import { fail, lines } from '../core/util';

export interface Machine {
  kind: 'mealy' | 'moore';
  states: string[];
  inputs: string[];
  next: Record<string, Record<string, string>>;
  /** Mealy: the output on each input; Moore: the state's output under the key ''. */
  out: Record<string, Record<string, string>>;
}

const NAME = /^[A-Za-z0-9_]+$/;

function parseLine(line: string, n: number) {
  const colon = line.indexOf(':');
  if (colon < 0) fail('fsmColon', { line: n });
  const head = line.slice(0, colon).trim();
  const [state, moore] = head.split('/').map((s) => s.trim());
  if (!NAME.test(state)) fail('fsmName', { line: n });
  const arcs = line
    .slice(colon + 1)
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean)
    .map((arc) => {
      const m = /^([A-Za-z0-9_]+)\s*->\s*([A-Za-z0-9_]+)\s*(?:\/\s*([A-Za-z0-9_]+))?$/.exec(arc);
      if (!m) return fail('fsmArc', { line: n, arc });
      return { input: m[1], to: m[2], out: m[3] };
    });
  return { state, moore, arcs };
}

export function parseMachine(text: string): Machine {
  const rows = lines(text).map((l, i) => parseLine(l, i + 1));
  if (rows.length === 0) fail('fsmEmpty');
  const kind = rows[0].moore !== undefined ? 'moore' : 'mealy';
  const states = rows.map((r) => r.state);
  if (new Set(states).size !== states.length) fail('fsmTwice');
  const inputs = [...new Set(rows.flatMap((r) => r.arcs.map((a) => a.input)))];
  const machine: Machine = { kind, states, inputs, next: {}, out: {} };
  for (const r of rows) {
    if ((r.moore !== undefined) !== (kind === 'moore')) fail('fsmMixed', { state: r.state });
    machine.next[r.state] = {};
    machine.out[r.state] = kind === 'moore' ? { '': r.moore ?? '' } : {};
    for (const a of r.arcs) {
      if (!states.includes(a.to)) fail('fsmUnknown', { state: a.to });
      if (machine.next[r.state][a.input] !== undefined) fail('fsmNondet', { state: r.state, input: a.input });
      if (kind === 'mealy' && a.out === undefined) fail('fsmNoOutput', { state: r.state, input: a.input });
      machine.next[r.state][a.input] = a.to;
      if (kind === 'mealy') machine.out[r.state][a.input] = a.out!;
    }
    for (const i of inputs)
      if (machine.next[r.state][i] === undefined) fail('fsmMissing', { state: r.state, input: i });
  }
  return machine;
}

export function machineText(m: Machine): string {
  return m.states
    .map((s) => {
      const arcs = m.inputs.map((i) => `${i} -> ${m.next[s][i]}${m.kind === 'mealy' ? ` / ${m.out[s][i]}` : ''}`);
      return `${s}${m.kind === 'moore' ? ` / ${m.out[s]['']}` : ''}: ${arcs.join(', ')}`;
    })
    .join('\n');
}

/** Splits an input sequence into symbols: characters when every input is one character, else words. */
export function symbolsOf(m: Machine, text: string): string[] {
  const single = m.inputs.every((i) => i.length === 1);
  const syms = single ? [...text.replace(/[\s,]+/g, '')] : text.split(/[\s,]+/).filter(Boolean);
  for (const s of syms) if (!m.inputs.includes(s)) fail('fsmBadInput', { input: s });
  return syms;
}

export interface Run {
  states: string[];
  outputs: string[];
}

/** Runs the machine from its start state. Moore outputs are those of the states entered. */
export function run(m: Machine, syms: readonly string[]): Run {
  let at = m.states[0];
  const states = [at];
  const outputs: string[] = [];
  for (const s of syms) {
    outputs.push(m.kind === 'mealy' ? m.out[at][s] : m.out[m.next[at][s]]['']);
    at = m.next[at][s];
    states.push(at);
  }
  return { states, outputs };
}

/** Removes states the start cannot reach, then merges equivalent states by successive partition refinement. */
export function minimizeMachine(m: Machine): { machine: Machine; steps: Step[]; blocks: string[][] } {
  const reach = new Set([m.states[0]]);
  const queue = [m.states[0]];
  for (let q = 0; q < queue.length; q += 1)
    for (const i of m.inputs) {
      const to = m.next[queue[q]][i];
      if (!reach.has(to)) {
        reach.add(to);
        queue.push(to);
      }
    }
  const steps: Step[] = [];
  const live = m.states.filter((s) => reach.has(s));
  if (live.length < m.states.length)
    steps.push(step('unreachable', { states: m.states.filter((s) => !reach.has(s)).join(', ') }));
  const outSig = (s: string) => (m.kind === 'mealy' ? m.inputs.map((i) => m.out[s][i]).join('|') : m.out[s]['']);
  let block = new Map(live.map((s) => [s, outSig(s)]));
  for (let round = 0; ; round += 1) {
    const groups = groupBy(live, (s) => block.get(s)!);
    steps.push(step('partition', { round, blocks: groups.map((g) => `{${g.join(', ')}}`).join(' ') }));
    const next = new Map(
      live.map((s) => [
        s,
        `${block.get(s)}#${m.inputs.map((i) => groups.findIndex((g) => g.includes(m.next[s][i]))).join(',')}`,
      ]),
    );
    if (groupBy(live, (s) => next.get(s)!).length === groups.length) {
      const names = groups.map((g) => g[0]);
      const rep = (s: string) => names[groups.findIndex((g) => g.includes(s))];
      const machine: Machine = { kind: m.kind, states: names, inputs: m.inputs, next: {}, out: {} };
      for (const s of names) {
        machine.next[s] = Object.fromEntries(m.inputs.map((i) => [i, rep(m.next[s][i])]));
        machine.out[s] = { ...m.out[s] };
      }
      return { machine, steps, blocks: groups };
    }
    block = next;
  }
}

function groupBy(items: readonly string[], key: (s: string) => string): string[][] {
  const map = new Map<string, string[]>();
  for (const s of items) map.set(key(s), [...(map.get(key(s)) ?? []), s]);
  return [...map.values()];
}

/** The longest prefix of `p` that ends `s`. */
function overlapLength(p: string, s: string): number {
  for (let k = Math.min(p.length, s.length); k > 0; k -= 1) if (s.endsWith(p.slice(0, k))) return k;
  return 0;
}

/** A detector for a bit pattern, with or without overlapping matches. States are named by how much has matched. */
export function detector(pattern: string, overlap: boolean, kind: 'mealy' | 'moore'): Machine {
  if (!/^[01]{1,8}$/.test(pattern)) fail('pattern');
  const L = pattern.length;
  const count = kind === 'mealy' ? L : L + 1;
  const states = Array.from({ length: count }, (_, i) => `S${i}`);
  const m: Machine = { kind, states, inputs: ['0', '1'], next: {}, out: {} };
  const border = overlapLength(pattern, pattern.slice(1));
  for (let i = 0; i < count; i += 1) {
    m.next[states[i]] = {};
    m.out[states[i]] = kind === 'moore' ? { '': i === L ? '1' : '0' } : {};
    for (const x of ['0', '1']) {
      const from = i === L ? (overlap ? pattern : '') : pattern.slice(0, i);
      const j = overlapLength(pattern, from + x);
      if (kind === 'mealy') {
        const hit = j === L;
        m.next[states[i]][x] = states[hit ? (overlap ? border : 0) : j];
        m.out[states[i]][x] = hit ? '1' : '0';
      } else m.next[states[i]][x] = states[j];
    }
  }
  return m;
}

export type CounterKind = 'up' | 'down' | 'gray' | 'ring' | 'johnson' | 'shift';

/** A counter or shift register as a Moore machine named by its codes. Counters advance when E is 1. */
export function counter(kind: CounterKind, bits: number): Machine {
  if (!Number.isInteger(bits) || bits < 2 || bits > 4) fail('bits');
  const code = (v: number) => v.toString(2).padStart(bits, '0');
  const seq: string[] =
    kind === 'up' || kind === 'down' || kind === 'shift'
      ? Array.from({ length: 1 << bits }, (_, i) => code(kind === 'down' ? ((1 << bits) - i) % (1 << bits) : i))
      : kind === 'gray'
        ? Array.from({ length: 1 << bits }, (_, i) => code(i ^ (i >> 1)))
        : kind === 'ring'
          ? Array.from({ length: bits }, (_, i) => code(1 << (bits - 1 - i)))
          : Array.from({ length: 2 * bits }, (_, i) =>
              i < bits ? '1'.repeat(i).padEnd(bits, '0') : '0'.repeat(i - bits).padEnd(bits, '1'),
            );
  const m: Machine = { kind: 'moore', states: seq, inputs: ['0', '1'], next: {}, out: {} };
  seq.forEach((s, i) => {
    m.out[s] = { '': s };
    m.next[s] =
      kind === 'shift'
        ? { '0': `0${s.slice(0, -1)}`, '1': `1${s.slice(0, -1)}` }
        : { '0': s, '1': seq[(i + 1) % seq.length] };
  });
  return m;
}
