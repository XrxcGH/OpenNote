// Small qubit circuits by dense state-vector multiplication: up to five qubits, so 32 amplitudes. Qubit 0 is the
// leftmost digit of a basis label. Circuits are typed one gate per line, read by the parser here.
import { cabs, cadd, cmul, ctext, cx, ONE, ZERO } from '../../kits/num/complex';
import type { Complex } from '../../kits/num/complex';
import { fail, positive } from '../shared/errors';

export const MAX_QUBITS = 5;
export const MAX_GATES = 200;

type Gate1 = 'X' | 'Y' | 'Z' | 'H' | 'S' | 'T' | 'SDG' | 'TDG' | 'RX' | 'RY' | 'RZ';
type Gate2 = 'CNOT' | 'CZ' | 'SWAP';

export type Gate =
  | { kind: Gate1; target: number; angle?: number }
  | { kind: Gate2; a: number; b: number }
  | { kind: 'CCX'; a: number; b: number; target: number };

const ONE_QUBIT = new Set(['X', 'Y', 'Z', 'H', 'S', 'T', 'SDG', 'TDG']);
const ROTATIONS = new Set(['RX', 'RY', 'RZ']);
const ALIASES: Record<string, string> = { CX: 'CNOT', TOFFOLI: 'CCX', CCNOT: 'CCX' };

/** Reads a circuit: one gate per line, such as H 0, CNOT 0 1, RX 0 0.5 (radians), CCX 0 1 2. */
export function parseCircuit(text: string, qubits: number): Gate[] {
  checkQubits(qubits);
  const gates: Gate[] = [];
  const qubit = (raw: string | undefined) => {
    if (raw === undefined || !/^\d+$/.test(raw)) fail('badCircuit');
    const q = Number(raw);
    if (q >= qubits) fail('badCircuit');
    return q;
  };
  for (const line of text.split(/\r?\n|;/)) {
    const parts = line
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean);
    if (parts.length === 0 || parts[0]!.startsWith('#')) continue;
    const name = parts[0]!.toUpperCase();
    const kind = ALIASES[name] ?? name;
    if (ONE_QUBIT.has(kind) && parts.length === 2) gates.push({ kind: kind as Gate1, target: qubit(parts[1]) });
    else if (ROTATIONS.has(kind) && parts.length === 3) {
      const angle = Number(parts[2]!.replace(/[−–]/g, '-'));
      if (!Number.isFinite(angle)) fail('badCircuit');
      gates.push({ kind: kind as Gate1, target: qubit(parts[1]), angle });
    } else if ((kind === 'CNOT' || kind === 'CZ' || kind === 'SWAP') && parts.length === 3) {
      const a = qubit(parts[1]);
      const b = qubit(parts[2]);
      if (a === b) fail('badCircuit');
      gates.push({ kind, a, b });
    } else if (kind === 'CCX' && parts.length === 4) {
      const [a, b, target] = [qubit(parts[1]), qubit(parts[2]), qubit(parts[3])];
      if (a === b || a === target || b === target) fail('badCircuit');
      gates.push({ kind, a, b, target });
    } else fail('badCircuit');
    if (gates.length > MAX_GATES) fail('badCircuit');
  }
  return gates;
}

function checkQubits(n: number) {
  positive(n, 'qubits');
  if (!Number.isInteger(n)) fail('tooManyQubits');
  if (n > MAX_QUBITS) fail('tooManyQubits');
}

const R2 = Math.SQRT1_2;

/** The 2 × 2 matrix of a one-qubit gate, row by row. */
function matrix1(kind: Gate1, angle = 0): [Complex, Complex, Complex, Complex] {
  const c = Math.cos(angle / 2);
  const s = Math.sin(angle / 2);
  switch (kind) {
    case 'X':
      return [ZERO, ONE, ONE, ZERO];
    case 'Y':
      return [ZERO, cx(0, -1), cx(0, 1), ZERO];
    case 'Z':
      return [ONE, ZERO, ZERO, cx(-1)];
    case 'H':
      return [cx(R2), cx(R2), cx(R2), cx(-R2)];
    case 'S':
      return [ONE, ZERO, ZERO, cx(0, 1)];
    case 'SDG':
      return [ONE, ZERO, ZERO, cx(0, -1)];
    case 'T':
      return [ONE, ZERO, ZERO, cx(R2, R2)];
    case 'TDG':
      return [ONE, ZERO, ZERO, cx(R2, -R2)];
    case 'RX':
      return [cx(c), cx(0, -s), cx(0, -s), cx(c)];
    case 'RY':
      return [cx(c), cx(-s), cx(s), cx(c)];
    case 'RZ':
      return [cx(c, -s), ZERO, ZERO, cx(c, s)];
  }
}

/** Applies one gate to a state of n qubits. */
export function apply(state: readonly Complex[], gate: Gate, n: number): Complex[] {
  const bit = (index: number, q: number) => (index >> (n - 1 - q)) & 1;
  const flip = (index: number, q: number) => index ^ (1 << (n - 1 - q));
  const out = state.slice();
  if (gate.kind === 'CNOT' || gate.kind === 'CZ' || gate.kind === 'SWAP' || gate.kind === 'CCX') {
    for (let i = 0; i < state.length; i += 1) {
      if (gate.kind === 'CNOT' && bit(i, gate.a)) out[i] = state[flip(i, gate.b)]!;
      if (gate.kind === 'CZ' && bit(i, gate.a) && bit(i, gate.b)) out[i] = cmul(state[i]!, cx(-1));
      if (gate.kind === 'SWAP' && bit(i, gate.a) !== bit(i, gate.b)) out[i] = state[flip(flip(i, gate.a), gate.b)]!;
      if (gate.kind === 'CCX' && bit(i, gate.a) && bit(i, gate.b)) out[i] = state[flip(i, gate.target)]!;
    }
    return out;
  }
  const one = gate as Extract<Gate, { kind: Gate1 }>;
  const [a, b, c, d] = matrix1(one.kind, one.angle);
  for (let i = 0; i < state.length; i += 1) {
    if (bit(i, one.target)) continue;
    const j = flip(i, one.target);
    out[i] = cadd(cmul(a, state[i]!), cmul(b, state[j]!));
    out[j] = cadd(cmul(c, state[i]!), cmul(d, state[j]!));
  }
  return out;
}

export const basisLabel = (index: number, n: number) => `|${index.toString(2).padStart(n, '0')}⟩`;

/** The state as a sum of its non-zero amplitudes, such as 0.707107|00⟩ + 0.707107|11⟩. */
export function stateText(state: readonly Complex[], n: number): string {
  const parts = state
    .map((amp, index) => ({ amp, index }))
    .filter(({ amp }) => cabs(amp) > 1e-12)
    .map(({ amp, index }) => {
      const text = ctext(amp, 6);
      return `${text.includes(' ') ? `(${text})` : text}${basisLabel(index, n)}`;
    });
  return parts.length ? parts.join(' + ').replace(/\+ -/g, '− ') : '0';
}

export const gateText = (gate: Gate): string => {
  if (gate.kind === 'CCX') return `CCX ${gate.a} ${gate.b} ${gate.target}`;
  if ('a' in gate) return `${gate.kind} ${gate.a} ${gate.b}`;
  return gate.angle === undefined ? `${gate.kind} ${gate.target}` : `${gate.kind} ${gate.target} ${gate.angle}`;
};

/** Runs a circuit from |0…0⟩ and keeps the state after each gate. */
export function run(gates: readonly Gate[], n: number): Complex[][] {
  checkQubits(n);
  let state: Complex[] = Array.from({ length: 2 ** n }, (_, i) => (i === 0 ? ONE : ZERO));
  const history = [state];
  for (const gate of gates) {
    state = apply(state, gate, n);
    history.push(state);
  }
  return history;
}

/** Ready-made circuits: a Bell state, Deutsch-Jozsa for a balanced and a constant one-bit function, and Grover. */
export const PRESETS = {
  bell: { qubits: 2, text: 'H 0\nCNOT 0 1' },
  deutschBalanced: { qubits: 2, text: 'X 1\nH 0\nH 1\nCNOT 0 1\nH 0' },
  deutschConstant: { qubits: 2, text: 'X 1\nH 0\nH 1\nH 0' },
  grover: { qubits: 2, text: 'H 0\nH 1\nCZ 0 1\nH 0\nH 1\nX 0\nX 1\nCZ 0 1\nX 0\nX 1\nH 0\nH 1' },
  ghz: { qubits: 3, text: 'H 0\nCNOT 0 1\nCNOT 1 2' },
} as const;

export type Preset = keyof typeof PRESETS;
