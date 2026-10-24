// Modified nodal analysis: the unknowns are the node voltages followed by the branch currents of voltage-like
// elements. Each element stamps its equations into one system, for DC, for a single AC frequency, or for one step of
// a transient (capacitors and inductors become companion models of the previous step).
import { fail } from '../shared';
import { switchClosed, valueAt } from './sources';
import type { Circuit, Element } from './parse';

export interface Layout {
  /** Number of nodes (other than ground). */
  n: number;
  size: number;
  /** Row of the branch current of each V, E, H, L, and O element, by lower-case name. */
  branch: Map<string, number>;
  labels: string[];
}

const HAS_BRANCH = new Set(['V', 'E', 'H', 'L', 'O']);

export function layoutOf(circuit: Circuit): Layout {
  const n = circuit.nodes.length;
  const branch = new Map<string, number>();
  const labels = circuit.nodes.map((name) => `v(${name})`);
  for (const e of circuit.elements) {
    if (!HAS_BRANCH.has(e.kind)) continue;
    branch.set(e.name.toLowerCase(), n + branch.size);
    labels.push(`i(${e.name})`);
  }
  return { n, size: n + branch.size, branch, labels };
}

/** What the previous time step left behind for the companion models. */
export interface TranState {
  capV: Map<string, number>;
  capI: Map<string, number>;
  indI: Map<string, number>;
  indV: Map<string, number>;
}

export interface Context {
  mode: 'dc' | 'ac' | 'tran';
  omega?: number;
  t?: number;
  /** Evaluate sources and switches just before t = 0. */
  initial?: boolean;
  dt?: number;
  trap?: boolean;
  state?: TranState;
  /** Independent sources set to zero, for finding a Thevenin resistance. */
  zeroSources?: boolean;
  /** A 1 A test current into node `testPlus` and out of `testMinus`. */
  test?: { plus: number; minus: number };
}

export const R_ON = 1e-3;
export const R_OFF = 1e9;
/**
 * A tiny conductance from every node to ground so a node with no DC path reads 0 V instead of failing. It is kept
 * a million times below the smallest conductance in the circuit so it cannot disturb a high-resistance divider.
 */
function gminOf(circuit: Circuit): number {
  let largest = 0;
  for (const e of circuit.elements) if (e.kind === 'R' && e.value > largest) largest = e.value;
  return Math.min(1e-14, 1e-6 / Math.max(largest, 1));
}

/** The conductance of a switch. Just before t = 0 an open switch is left out of the circuit, not a 1 GOhm leak. */
export function switchConductance(closed: boolean, initial: boolean | undefined): number {
  if (closed) return 1 / R_ON;
  return initial ? 0 : 1 / R_OFF;
}

export class System {
  re: number[][];
  im: number[][];
  zr: number[];
  zi: number[];
  constructor(readonly size: number) {
    this.re = Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
    this.im = Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
    this.zr = Array.from({ length: size }, () => 0);
    this.zi = Array.from({ length: size }, () => 0);
  }
  add(r: number, c: number, re: number, im = 0): void {
    if (r < 0 || c < 0) return;
    this.re[r]![c]! += re;
    this.im[r]![c]! += im;
  }
  /** Adds to the right-hand side. */
  rhs(r: number, re: number, im = 0): void {
    if (r < 0) return;
    this.zr[r]! += re;
    this.zi[r]! += im;
  }
  /** A two-terminal admittance between nodes p and m. */
  admit(a: number, b: number, re: number, im = 0): void {
    this.add(a, a, re, im);
    this.add(b, b, re, im);
    this.add(a, b, -re, -im);
    this.add(b, a, -re, -im);
  }
}

type Stamp = (s: System, e: Element, c: Context, lay: Layout) => void;

/** The value of an independent source in this context, as a real and imaginary part. */
function drive(e: Element, c: Context): [number, number] {
  const src = e.source!;
  if (c.zeroSources) return [0, 0];
  if (c.mode === 'ac') return [src.acMag * Math.cos(src.acPhase), src.acMag * Math.sin(src.acPhase)];
  return [valueAt(src.shape, c.t ?? 0, c.initial), 0];
}

const branchOf = (e: Element, lay: Layout): number => lay.branch.get(e.name.toLowerCase())!;

/** The KCL columns and the voltage-difference row shared by V, E, H, L: v(+) - v(-) appears in row b. */
function branchEquation(s: System, e: Element, b: number): void {
  const [p, m] = e.nodes as [number, number];
  s.add(p, b, 1);
  s.add(m, b, -1);
  s.add(b, p, 1);
  s.add(b, m, -1);
}

function stampCapacitor(s: System, e: Element, c: Context): void {
  const [p, m] = e.nodes as [number, number];
  if (c.mode === 'ac') s.admit(p, m, 0, (c.omega ?? 0) * e.value);
  if (c.mode !== 'tran') return;
  const geq = ((c.trap ? 2 : 1) * e.value) / (c.dt ?? 1);
  const key = e.name.toLowerCase();
  const v = c.state?.capV.get(key) ?? 0;
  const i = c.state?.capI.get(key) ?? 0;
  const ieq = c.trap ? -(geq * v + i) : -geq * v;
  s.admit(p, m, geq);
  s.rhs(p, -ieq);
  s.rhs(m, ieq);
}

function stampInductor(s: System, e: Element, c: Context, lay: Layout): void {
  const b = branchOf(e, lay);
  branchEquation(s, e, b);
  if (c.mode === 'ac') s.add(b, b, 0, -(c.omega ?? 0) * e.value);
  if (c.mode !== 'tran') return;
  const coef = ((c.trap ? 2 : 1) * e.value) / (c.dt ?? 1);
  const key = e.name.toLowerCase();
  const i = c.state?.indI.get(key) ?? 0;
  const v = c.state?.indV.get(key) ?? 0;
  s.add(b, b, -coef);
  s.rhs(b, c.trap ? -coef * i - v : -coef * i);
}

const STAMPS: Record<Element['kind'], Stamp> = {
  R: (s, e) => s.admit(e.nodes[0]!, e.nodes[1]!, 1 / e.value),
  S: (s, e, c) => s.admit(e.nodes[0]!, e.nodes[1]!, switchConductance(switchClosed(e, c.t ?? 0, c.initial), c.initial)),
  C: stampCapacitor,
  L: stampInductor,
  V: (s, e, c, lay) => {
    const b = branchOf(e, lay);
    branchEquation(s, e, b);
    const [re, im] = drive(e, c);
    s.rhs(b, re, im);
  },
  I: (s, e, c) => {
    const [re, im] = drive(e, c);
    s.rhs(e.nodes[0]!, -re, -im);
    s.rhs(e.nodes[1]!, re, im);
  },
  E: (s, e, _c, lay) => {
    const b = branchOf(e, lay);
    branchEquation(s, e, b);
    s.add(b, e.nodes[2]!, -e.value);
    s.add(b, e.nodes[3]!, e.value);
  },
  G: (s, e) => {
    const [p, m, cp, cm] = e.nodes as [number, number, number, number];
    s.add(p, cp, e.value);
    s.add(p, cm, -e.value);
    s.add(m, cp, -e.value);
    s.add(m, cm, e.value);
  },
  H: (s, e, _c, lay) => {
    const b = branchOf(e, lay);
    branchEquation(s, e, b);
    s.add(b, lay.branch.get(e.control!.toLowerCase())!, -e.value);
  },
  F: (s, e, _c, lay) => {
    const control = lay.branch.get(e.control!.toLowerCase())!;
    s.add(e.nodes[0]!, control, e.value);
    s.add(e.nodes[1]!, control, -e.value);
  },
  O: (s, e, _c, lay) => {
    const [out, plus, minus] = e.nodes as [number, number, number];
    const b = branchOf(e, lay);
    s.add(out, b, 1);
    s.add(b, plus, 1);
    s.add(b, minus, -1);
  },
};

/** The full system for the circuit in this context. */
export function assemble(circuit: Circuit, lay: Layout, c: Context): System {
  const s = new System(lay.size);
  const gmin = gminOf(circuit);
  for (const e of circuit.elements) STAMPS[e.kind](s, e, c, lay);
  for (let i = 0; i < lay.n; i++) s.add(i, i, gmin);
  if (c.test) {
    s.rhs(c.test.plus, 1);
    s.rhs(c.test.minus, -1);
  }
  return s;
}

/**
 * Solves the system. A row is judged singular when its pivot is tiny next to the row's own size, which is what a
 * loop of ideal voltage sources or a node held only by current sources produces.
 */
export function solve(s: System, complex: boolean): { re: number[]; im: number[] } {
  const n = s.size;
  const a = s.re.map((row, i) => row.map((v, j) => ({ re: v, im: complex ? s.im[i]![j]! : 0 })));
  const b = s.zr.map((v, i) => ({ re: v, im: complex ? s.zi[i]! : 0 }));
  const rowSize = a.map((row) => Math.max(...row.map((v) => Math.hypot(v.re, v.im)), 1e-300));
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (
        Math.hypot(a[r]![col]!.re, a[r]![col]!.im) / rowSize[r]! >
        Math.hypot(a[pivot]![col]!.re, a[pivot]![col]!.im) / rowSize[pivot]!
      ) {
        pivot = r;
      }
    }
    const top = a[pivot]![col]!;
    if (Math.hypot(top.re, top.im) <= 1e-11 * rowSize[pivot]!) return fail('netSingular');
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    [b[col], b[pivot]] = [b[pivot]!, b[col]!];
    [rowSize[col], rowSize[pivot]] = [rowSize[pivot]!, rowSize[col]!];
    eliminate(a, b, col, n);
  }
  const x = backSubstitute(a, b, n);
  // A node touched only by current sources has just the tiny leak to ground, which makes its voltage enormous.
  if (x.re.some((v, i) => Math.hypot(v, x.im[i]!) > 1e9)) return fail('netSingular');
  return x;
}

type Z = { re: number; im: number };

function eliminate(a: Z[][], b: Z[], col: number, n: number): void {
  const p = a[col]![col]!;
  const d = p.re * p.re + p.im * p.im;
  for (let r = col + 1; r < n; r++) {
    const v = a[r]![col]!;
    if (v.re === 0 && v.im === 0) continue;
    const f = { re: (v.re * p.re + v.im * p.im) / d, im: (v.im * p.re - v.re * p.im) / d };
    for (let k = col; k < n; k++) {
      const w = a[col]![k]!;
      a[r]![k] = { re: a[r]![k]!.re - (f.re * w.re - f.im * w.im), im: a[r]![k]!.im - (f.re * w.im + f.im * w.re) };
    }
    b[r] = {
      re: b[r]!.re - (f.re * b[col]!.re - f.im * b[col]!.im),
      im: b[r]!.im - (f.re * b[col]!.im + f.im * b[col]!.re),
    };
  }
}

function backSubstitute(a: Z[][], b: Z[], n: number): { re: number[]; im: number[] } {
  const re = Array.from({ length: n }, () => 0);
  const im = Array.from({ length: n }, () => 0);
  for (let r = n - 1; r >= 0; r--) {
    let sr = b[r]!.re;
    let si = b[r]!.im;
    for (let k = r + 1; k < n; k++) {
      const w = a[r]![k]!;
      sr -= w.re * re[k]! - w.im * im[k]!;
      si -= w.re * im[k]! + w.im * re[k]!;
    }
    const p = a[r]![r]!;
    const d = p.re * p.re + p.im * p.im;
    re[r] = (sr * p.re + si * p.im) / d;
    im[r] = (si * p.re - sr * p.im) / d;
  }
  return { re, im };
}

/** A real LU factorization with row exchanges, reusable for any right-hand side. */
export interface Factored {
  lu: number[][];
  /** The row swapped into place at each column. */
  swaps: number[];
}

/**
 * Factors the real matrix of a system. A transient whose step size and switch states repeat has the same matrix at
 * every step, so it is factored once and each step costs only a forward and a back substitution.
 */
export function factor(s: System): Factored {
  const n = s.size;
  const lu = s.re.map((row) => [...row]);
  const rowSize = lu.map((row) => Math.max(...row.map(Math.abs), 1e-300));
  const swaps: number[] = [];
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(lu[r]![col]!) / rowSize[r]! > Math.abs(lu[pivot]![col]!) / rowSize[pivot]!) pivot = r;
    }
    if (Math.abs(lu[pivot]![col]!) <= 1e-11 * rowSize[pivot]!) return fail('netSingular');
    [lu[col], lu[pivot]] = [lu[pivot]!, lu[col]!];
    [rowSize[col], rowSize[pivot]] = [rowSize[pivot]!, rowSize[col]!];
    swaps.push(pivot);
    const top = lu[col]!;
    for (let r = col + 1; r < n; r++) {
      const row = lu[r]!;
      const f = row[col]! / top[col]!;
      row[col] = f;
      if (f !== 0) for (let k = col + 1; k < n; k++) row[k]! -= f * top[k]!;
    }
  }
  return { lu, swaps };
}

/** Solves with a factorization; a node held only by current sources (an enormous voltage) is reported as singular. */
export function solveFactored(f: Factored, rhs: number[]): number[] {
  const n = rhs.length;
  const x = [...rhs];
  for (let col = 0; col < n; col++) {
    const p = f.swaps[col]!;
    if (p !== col) [x[col], x[p]] = [x[p]!, x[col]!];
    for (let r = col + 1; r < n; r++) x[r]! -= f.lu[r]![col]! * x[col]!;
  }
  for (let r = n - 1; r >= 0; r--) {
    let sum = x[r]!;
    for (let k = r + 1; k < n; k++) sum -= f.lu[r]![k]! * x[k]!;
    x[r] = sum / f.lu[r]![r]!;
  }
  if (x.some((v) => Math.abs(v) > 1e9)) return fail('netSingular');
  return x;
}
