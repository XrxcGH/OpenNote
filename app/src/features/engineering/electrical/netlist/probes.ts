// Reading what to look at: v(node), v(a,b), i(name), or a bare node name; and evaluating it on a solution.
import { fail } from '../shared';
import { R_OFF, R_ON } from './mna';
import type { Layout } from './mna';
import { nodeIndex } from './parse';
import type { Circuit, Element } from './parse';
import { switchClosed, valueAt } from './sources';

export interface Solution {
  re: number[];
  im: number[];
}

export interface Aux {
  omega?: number;
  t?: number;
  initial?: boolean;
  /** Capacitor currents of the transient step. */
  capI?: Map<string, number>;
}

export interface Probe {
  label: string;
  unit: 'V' | 'A';
  value(sol: Solution, aux: Aux): { re: number; im: number };
}

const at = (sol: Solution, i: number): { re: number; im: number } =>
  i < 0 ? { re: 0, im: 0 } : { re: sol.re[i]!, im: sol.im[i]! };

const sub = (a: { re: number; im: number }, b: { re: number; im: number }) => ({ re: a.re - b.re, im: a.im - b.im });

/** The current through an element, from its terminal voltages when it has no branch unknown. */
function elementCurrent(e: Element, lay: Layout, sol: Solution, aux: Aux): { re: number; im: number } {
  const branch = lay.branch.get(e.name.toLowerCase());
  if (branch !== undefined) return at(sol, branch);
  const v = sub(at(sol, e.nodes[0]!), at(sol, e.nodes[1]!));
  if (e.kind === 'R') return { re: v.re / e.value, im: v.im / e.value };
  if (e.kind === 'S') {
    const g = 1 / (switchClosed(e, aux.t ?? 0, aux.initial) ? R_ON : R_OFF);
    return { re: v.re * g, im: v.im * g };
  }
  if (e.kind === 'C') {
    if (aux.capI) return { re: aux.capI.get(e.name.toLowerCase()) ?? 0, im: 0 };
    const w = (aux.omega ?? 0) * e.value;
    return { re: -v.im * w, im: v.re * w };
  }
  if (e.kind === 'I') {
    const shape = e.source!.shape;
    return aux.omega !== undefined
      ? { re: e.source!.acMag * Math.cos(e.source!.acPhase), im: e.source!.acMag * Math.sin(e.source!.acPhase) }
      : { re: valueAt(shape, aux.t ?? 0, aux.initial), im: 0 };
  }
  return { re: 0, im: 0 };
}

/** Reads one probe such as `out`, `v(out)`, `v(a,b)`, or `i(R1)`. */
export function parseProbe(circuit: Circuit, lay: Layout, text: string): Probe {
  const clean = text.trim();
  const call = /^([vi])\s*\(([^)]*)\)$/i.exec(clean);
  if (call && call[1]!.toLowerCase() === 'i') {
    const e = circuit.elements.find((el) => el.name.toLowerCase() === call[2]!.trim().toLowerCase());
    if (!e) return fail('netProbe', { probe: clean });
    return { label: `i(${e.name})`, unit: 'A', value: (sol, aux) => elementCurrent(e, lay, sol, aux) };
  }
  const names = (call ? call[2]! : clean).split(/[\s,]+/).filter((w) => w !== '');
  if (names.length < 1 || names.length > 2) return fail('netProbe', { probe: clean });
  const nodes = names.map((name) => nodeIndex(circuit, name));
  if (nodes.some((n) => n === null)) return fail('netProbe', { probe: clean });
  const [a, b] = nodes as number[];
  return { label: `v(${names.join(',')})`, unit: 'V', value: (sol) => sub(at(sol, a!), at(sol, b ?? -1)) };
}

/** The list typed in the probes field, split on commas outside parentheses. */
export function parseProbes(circuit: Circuit, lay: Layout, text: string): Probe[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of text) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if ((ch === ',' || ch === ';') && depth === 0) {
      parts.push(current);
      current = '';
    } else current += ch;
  }
  parts.push(current);
  const probes = parts.filter((p) => p.trim() !== '').map((p) => parseProbe(circuit, lay, p));
  if (probes.length === 0 || probes.length > 6) return fail('netProbeCount');
  return probes;
}
