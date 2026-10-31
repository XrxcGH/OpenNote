// From a state table to circuit equations: assign each state a code (binary, Gray, one-hot, or the state names when
// they are codes), build the encoded table, then minimize each flip-flop input and each output with Quine-McCluskey.
// Unused codes are don't cares.
import { fail } from '../core/util';
import type { Machine } from './fsm';
import { MAX_VARS, minimize, termText } from './qm';

export type Assignment = 'binary' | 'gray' | 'onehot' | 'named';
export type FlipFlop = 'D' | 'T' | 'JK';

export interface Equation {
  name: string;
  sop: string;
}

export interface Design {
  codes: Record<string, string>;
  vars: string[];
  /** One row per state and input: state, code, input, next state, next code, output. */
  rows: string[][];
  equations: Equation[];
}

const isBits = (s: string, width: number) => s.length === width && /^[01]+$/.test(s);

export function codesFor(m: Machine, how: Assignment): Record<string, string> {
  const n = m.states.length;
  if (how === 'named') {
    const width = m.states[0].length;
    if (!m.states.every((s) => isBits(s, width))) fail('notCodes');
    return Object.fromEntries(m.states.map((s) => [s, s]));
  }
  if (how === 'onehot')
    return Object.fromEntries(m.states.map((s, i) => [s, (1 << (n - 1 - i)).toString(2).padStart(n, '0')]));
  const width = Math.max(1, Math.ceil(Math.log2(n)));
  return Object.fromEntries(
    m.states.map((s, i) => [s, (how === 'gray' ? i ^ (i >> 1) : i).toString(2).padStart(width, '0')]),
  );
}

const names = (base: string, width: number) =>
  width === 1 ? [base] : Array.from({ length: width }, (_, i) => `${base}${width - 1 - i}`);

/** Each flip-flop input for a change from q to next: 1, 0, or X for don't care. */
function excite(ff: FlipFlop, q: number, next: number): string[] {
  if (ff === 'D') return [String(next)];
  if (ff === 'T') return [String(q ^ next)];
  return q === 0 ? [String(next), 'X'] : ['X', String(1 - next)];
}

export function design(m: Machine, how: Assignment, ff: FlipFlop): Design {
  const codes = codesFor(m, how);
  const k = codes[m.states[0]].length;
  const inWidth = m.inputs[0].length;
  if (!m.inputs.every((i) => isBits(i, inWidth))) fail('inputsNotBits');
  const outs = m.states.flatMap((s) => (m.kind === 'moore' ? [m.out[s]['']] : m.inputs.map((i) => m.out[s][i])));
  const outWidth = outs[0].length;
  if (!outs.every((o) => isBits(o, outWidth))) fail('outputsNotBits');
  const stateVars = names('Q', k);
  const inVars = names('X', inWidth);
  const vars = [...stateVars, ...inVars];
  if (vars.length > MAX_VARS) fail('tooManyBits', { max: MAX_VARS });
  const ffNames = stateVars.flatMap((q) =>
    ff === 'JK' ? [`J${q.slice(1)}`, `K${q.slice(1)}`] : [`${ff}${q.slice(1)}`],
  );
  const outNames = names('Z', outWidth);
  const on: number[][] = ffNames.map(() => []);
  const dc: number[][] = ffNames.map(() => []);
  const outOn: number[][] = outNames.map(() => []);
  const outDc: number[][] = outNames.map(() => []);
  const rows: string[][] = [];
  const used = new Set<number>();
  for (const s of m.states)
    for (const x of m.inputs) {
      const term = parseInt(codes[s] + x, 2);
      used.add(term);
      const to = m.next[s][x];
      const z = m.kind === 'moore' ? m.out[s][''] : m.out[s][x];
      rows.push([s, codes[s], x, to, codes[to], z]);
      const inputs = [...codes[s]].flatMap((q, b) => excite(ff, Number(q), Number(codes[to][b])));
      inputs.forEach((v, f) => (v === '1' ? on[f] : v === 'X' ? dc[f] : []).push(term));
      [...z].forEach((v, o) => v === '1' && outOn[o].push(term));
    }
  for (let term = 0; term < 1 << vars.length; term += 1)
    if (!used.has(term)) {
      dc.forEach((list) => list.push(term));
      outDc.forEach((list) => list.push(term));
    }
  const sop = (ons: number[], dcs: number[]) => {
    const unique = [...new Set(dcs)].filter((d) => !ons.includes(d));
    const best = minimize(vars.length, ons, unique).covers[0];
    return best.length ? best.map((c) => termText(c, vars)).join(' + ') : '0';
  };
  const equations = [
    ...ffNames.map((name, f) => ({ name, sop: sop(on[f], dc[f]) })),
    ...outNames.map((name, o) => ({ name, sop: sop(outOn[o], outDc[o]) })),
  ];
  return { codes, vars, rows, equations };
}
