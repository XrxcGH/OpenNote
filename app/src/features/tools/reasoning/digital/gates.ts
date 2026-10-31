// Gate-level views of a function: two-level NAND-only and NOR-only circuits from the minimal SOP and POS, the gate
// tree of an expression, and a transport-delay simulation that shows glitches in a timing diagram.
import type { TreeNode } from '../core/treeFigure';
import { fail } from '../core/util';
import { evalBool, rowEnv } from './expr';
import type { BoolExpr } from './expr';
import { literals } from './qm';
import type { Cube } from './qm';

interface Lit {
  name: string;
  positive: boolean;
}

function litsOf(c: Cube, vars: readonly string[]): Lit[] {
  const n = vars.length;
  const out: Lit[] = [];
  for (let i = 0; i < n; i += 1) {
    const bit = n - 1 - i;
    if ((c.care >> bit) & 1) out.push({ name: vars[i], positive: ((c.value >> bit) & 1) === 1 });
  }
  return out;
}

export interface TwoLevel {
  text: string;
  gates: number;
}

/**
 * Two-level NAND-NAND (from SOP) or NOR-NOR (from POS) with any fan-in. A complemented literal inside a term takes
 * an inverter built from the same gate; a one-literal term goes to the output gate complemented.
 */
export function twoLevel(terms: readonly Cube[], vars: readonly string[], gate: 'NAND' | 'NOR'): TwoLevel {
  // For NOR from POS, a cube of the complement stands for a sum whose literals are complemented.
  const flip = gate === 'NOR';
  if (terms.length === 0) return { text: flip ? '1' : '0', gates: 0 };
  if (terms.some((t) => literals(t, vars.length) === 0)) return { text: flip ? '0' : '1', gates: 0 };
  const lists = terms.map((term) =>
    litsOf(term, vars).map((l) => ({ ...l, positive: flip ? !l.positive : l.positive })),
  );
  const inverter = (name: string) => `${gate}(${name}, ${name})`;
  if (lists.length === 1 && lists[0].length === 1) {
    const [l] = lists[0];
    return l.positive ? { text: l.name, gates: 0 } : { text: inverter(l.name), gates: 1 };
  }
  const inverters = new Set<string>();
  const firstLevel = new Set<string>();
  const inputs = lists.map((lits) => {
    if (lits.length === 1) {
      // The output gate inverts, so a lone literal x feeds in as x'.
      const [l] = lits;
      if (!l.positive) return l.name;
      inverters.add(l.name);
      return inverter(l.name);
    }
    const parts = lits.map((l) => {
      if (l.positive) return l.name;
      inverters.add(l.name);
      return inverter(l.name);
    });
    const text = `${gate}(${parts.join(', ')})`;
    firstLevel.add(text);
    return text;
  });
  return { text: `${gate}(${inputs.join(', ')})`, gates: inverters.size + firstLevel.size + 1 };
}

const GATE_NAME: Record<string, string> = {
  not: 'NOT',
  and: 'AND',
  or: 'OR',
  xor: 'XOR',
  nand: 'NAND',
  nor: 'NOR',
  xnor: 'XNOR',
};

/** The expression as a tree of gates with the output at the top, numbering gates in reading order. */
export function gateTree(e: BoolExpr, count = { n: 0 }): TreeNode {
  if (e.k === 'var') return { label: e.name, children: [], shape: 'circle' };
  if (e.k === 'const') return { label: String(e.v), children: [], shape: 'circle' };
  count.n += 1;
  const id = count.n;
  const kids = e.k === 'not' ? [gateTree(e.a, count)] : [gateTree(e.a, count), gateTree(e.b, count)];
  return { label: `${GATE_NAME[e.k]} g${id}`, children: kids, tone: 'accent' };
}

export interface SimResult {
  times: number;
  inputs: { name: string; levels: (0 | 1)[] }[];
  output: (0 | 1)[];
  /** The time steps where the output changes. */
  changes: number[];
  /** The input steps whose output changes more than once before it settles. */
  glitches: number[];
}

/**
 * Transport-delay simulation: every gate's output at time t is its function of its inputs at time t - delay.
 * Before time 0 the circuit rests in the steady state of the first input vector.
 */
export function simulate(
  e: BoolExpr,
  vars: readonly string[],
  vectors: readonly number[],
  delay: number,
  hold: number,
): SimResult {
  if (vectors.length === 0) fail('noVectors');
  if (!Number.isInteger(delay) || delay < 0 || delay > 20) fail('delayRange');
  if (!Number.isInteger(hold) || hold < 1 || hold > 50) fail('holdRange');
  const times = vectors.length * hold;
  if (times > 2000) fail('tooLong');
  const inputAt = (t: number) => vectors[Math.min(vectors.length - 1, Math.max(0, Math.floor(t / hold)))];
  const memo = new Map<BoolExpr, Map<number, 0 | 1>>();
  const value = (node: BoolExpr, t: number): 0 | 1 => {
    if (node.k === 'var' || node.k === 'const') return evalBool(node, rowEnv(vars, inputAt(t)));
    if (t < 0) return evalBool(node, rowEnv(vars, vectors[0]));
    let seen = memo.get(node);
    if (!seen) memo.set(node, (seen = new Map()));
    const cached = seen.get(t);
    if (cached !== undefined) return cached;
    const env: Record<string, number> = {};
    const a: BoolExpr = { k: 'var', name: '\u0000a' };
    const b: BoolExpr = { k: 'var', name: '\u0000b' };
    env['\u0000a'] = value(node.a, t - delay);
    if (node.k !== 'not') env['\u0000b'] = value(node.b, t - delay);
    const v = evalBool(node.k === 'not' ? { k: 'not', a } : { k: node.k, a, b }, env);
    seen.set(t, v);
    return v;
  };
  const output: (0 | 1)[] = [];
  for (let t = 0; t < times; t += 1) output.push(value(e, t));
  const changes = output.flatMap((v, t) => (t > 0 && v !== output[t - 1] ? [t] : []));
  const glitches = vectors.flatMap((_, i) =>
    changes.filter((t) => t >= i * hold && t < (i + 1) * hold).length > 1 ? [i] : [],
  );
  const inputs = vars.map((name, vi) => ({
    name,
    levels: Array.from({ length: times }, (_, t) => ((inputAt(t) >> (vars.length - 1 - vi)) & 1) as 0 | 1),
  }));
  return { times, inputs, output, changes, glitches };
}
