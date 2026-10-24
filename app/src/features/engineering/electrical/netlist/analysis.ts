// The four analyses of a netlist: the DC operating point (with power in each element), an AC frequency sweep with
// resonance and bandwidth, a transient response, and a Thevenin/Norton equivalent between 2 nodes.
import { fail } from '../shared';
import { assemble, layoutOf, R_OFF, R_ON, solve } from './mna';
import type { Context, Layout, System, TranState } from './mna';
import { breakpoints, switchClosed, valueAt } from './sources';
import type { Circuit, Element } from './parse';
import type { Probe, Solution } from './probes';

const DC: Context = { mode: 'dc', t: 0, initial: true };

const volt = (x: number[], i: number): number => (i < 0 ? 0 : x[i]!);

export interface PowerRow {
  name: string;
  /** Power absorbed by the element; negative when it supplies power. */
  power: number;
}

export interface OperatingPoint {
  lay: Layout;
  system: System;
  x: number[];
  powers: PowerRow[];
  /** The sum of all absorbed powers, which should be zero. */
  balance: number;
}

/** The power an element absorbs in a DC solution. */
function absorbed(e: Element, lay: Layout, x: number[]): number {
  const v = volt(x, e.nodes[0]!) - volt(x, e.nodes[1]!);
  const branch = lay.branch.get(e.name.toLowerCase());
  switch (e.kind) {
    case 'R':
      return (v * v) / e.value;
    case 'S':
      return (v * v) / (switchClosed(e, 0, true) ? R_ON : R_OFF);
    case 'V':
    case 'E':
    case 'H':
      return v * x[branch!]!;
    case 'I':
      return v * valueAt(e.source!.shape, 0, true);
    case 'G':
      return v * e.value * (volt(x, e.nodes[2]!) - volt(x, e.nodes[3]!));
    case 'F':
      return v * e.value * x[lay.branch.get(e.control!.toLowerCase())!]!;
    case 'O':
      return volt(x, e.nodes[0]!) * x[branch!]!;
    default:
      return 0;
  }
}

export function operatingPoint(circuit: Circuit): OperatingPoint {
  const lay = layoutOf(circuit);
  const system = assemble(circuit, lay, DC);
  const { re: x } = solve(system, false);
  const powers = circuit.elements.map((e) => ({ name: e.name, power: absorbed(e, lay, x) }));
  return { lay, system, x, powers, balance: powers.reduce((s, p) => s + p.power, 0) };
}

// ---- AC ----

export function acSolution(circuit: Circuit, lay: Layout, hz: number): Solution {
  return solve(assemble(circuit, lay, { mode: 'ac', omega: 2 * Math.PI * hz }), true);
}

const magnitude = (probe: Probe, circuit: Circuit, lay: Layout, hz: number): number => {
  const v = probe.value(acSolution(circuit, lay, hz), { omega: 2 * Math.PI * hz });
  return Math.hypot(v.re, v.im);
};

export interface Sweep {
  freqs: number[];
  /** Per probe: magnitude and phase in degrees at each frequency. */
  mag: number[][];
  phase: number[][];
}

export function acSweep(
  circuit: Circuit,
  lay: Layout,
  probes: Probe[],
  start: number,
  stop: number,
  count: number,
): Sweep {
  if (!(start > 0) || !(stop > start)) fail('netAcRange');
  if (!Number.isInteger(count) || count < 2 || count > 2000) fail('netAcCount');
  const freqs = Array.from({ length: count }, (_, i) => start * (stop / start) ** (i / (count - 1)));
  const mag = probes.map(() => [] as number[]);
  const phase = probes.map(() => [] as number[]);
  for (const f of freqs) {
    const sol = acSolution(circuit, lay, f);
    probes.forEach((p, k) => {
      const v = p.value(sol, { omega: 2 * Math.PI * f });
      mag[k]!.push(Math.hypot(v.re, v.im));
      phase[k]!.push((Math.atan2(v.im, v.re) * 180) / Math.PI);
    });
  }
  return { freqs, mag, phase };
}

export interface Resonance {
  /** Frequency of the extreme, its magnitude, and the half-power bandwidth and Q when it is an interior peak. */
  f0: number;
  peak: number;
  bandwidth: number | null;
  q: number | null;
  /** Where the response falls 3 dB from its flat end, for a response with no peak. */
  cutoff: number | null;
  lowpass: boolean | null;
}

/** Golden-section search for the maximum of f on [lo, hi], in log frequency. */
function goldenMax(f: (x: number) => number, lo: number, hi: number): number {
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = Math.log(lo);
  let b = Math.log(hi);
  for (let k = 0; k < 80; k++) {
    const c = b - phi * (b - a);
    const d = a + phi * (b - a);
    if (f(Math.exp(c)) > f(Math.exp(d))) b = d;
    else a = c;
  }
  return Math.exp((a + b) / 2);
}

/** The frequency in [lo, hi] where g crosses zero, assuming one sign change. */
function bisect(g: (x: number) => number, lo: number, hi: number): number {
  let a = Math.log(lo);
  let b = Math.log(hi);
  const sign = g(lo) > 0;
  for (let k = 0; k < 100; k++) {
    const mid = (a + b) / 2;
    if (g(Math.exp(mid)) > 0 === sign) a = mid;
    else b = mid;
  }
  return Math.exp((a + b) / 2);
}

/** The peak, half-power bandwidth, and Q of the first probe; or the 3 dB cutoff when the response has no peak. */
export function findResonance(circuit: Circuit, lay: Layout, probe: Probe, sweep: Sweep): Resonance {
  const m = sweep.mag[0]!;
  const f = sweep.freqs;
  const at = (hz: number) => magnitude(probe, circuit, lay, hz);
  const top = m.indexOf(Math.max(...m));
  // An interior maximum is a resonance only when it stands clear of both sweep ends; otherwise rounding noise on a
  // flat passband would be read as a peak.
  const margin = 1e-3 * m[top]!;
  if (top > 0 && top < m.length - 1 && m[top]! - m[0]! > margin && m[top]! - m[m.length - 1]! > margin) {
    const f0 = goldenMax(at, f[top - 1]!, f[top + 1]!);
    const peak = at(f0);
    const half = peak / Math.SQRT2;
    const below = m[0]! < half ? bisect((x) => at(x) - half, f[0]!, f0) : null;
    const above = m[m.length - 1]! < half ? bisect((x) => at(x) - half, f0, f[f.length - 1]!) : null;
    const bandwidth = below !== null && above !== null ? above - below : null;
    return { f0, peak, bandwidth, q: bandwidth ? f0 / bandwidth : null, cutoff: null, lowpass: null };
  }
  const last = m.length - 1;
  const lowpass = m[0]! >= m[last]!;
  // The passband gain is the limit far outside the sweep (the DC gain of a low-pass, the high-frequency gain of a
  // high-pass), not the gain at the sweep's edge, so a narrow sweep still gives the true 3 dB point.
  const reference = lowpass ? at(f[0]! * 1e-6) : at(f[last]! * 1e6);
  const half = reference / Math.SQRT2;
  const inside = lowpass ? m[0]! > half && m[last]! < half : m[last]! > half && m[0]! < half;
  const cutoff = inside ? bisect((x) => at(x) - half, f[0]!, f[last]!) : null;
  return { f0: f[top]!, peak: m[top]!, bandwidth: null, q: null, cutoff, lowpass };
}

// ---- Transient ----

export interface Transient {
  t: number[];
  /** Per probe, the value at each time. */
  values: number[][];
}

function initialState(circuit: Circuit, lay: Layout, x: number[]): TranState {
  const state: TranState = { capV: new Map(), capI: new Map(), indI: new Map(), indV: new Map() };
  for (const e of circuit.elements) {
    const key = e.name.toLowerCase();
    const v = volt(x, e.nodes[0]!) - volt(x, e.nodes[1]!);
    if (e.kind === 'C') {
      state.capV.set(key, e.ic ?? v);
      state.capI.set(key, 0);
    } else if (e.kind === 'L') {
      state.indI.set(key, e.ic ?? x[lay.branch.get(key)!]!);
      state.indV.set(key, e.ic === undefined ? v : 0);
    }
  }
  return state;
}

/** Updates the companion-model state after a step: the capacitor current and the inductor voltage. */
function advanceState(circuit: Circuit, lay: Layout, x: number[], state: TranState, dt: number, trap: boolean) {
  for (const e of circuit.elements) {
    const key = e.name.toLowerCase();
    const v = volt(x, e.nodes[0]!) - volt(x, e.nodes[1]!);
    if (e.kind === 'C') {
      const geq = ((trap ? 2 : 1) * e.value) / dt;
      const prev = state.capV.get(key) ?? 0;
      const ieq = trap ? -(geq * prev + (state.capI.get(key) ?? 0)) : -geq * prev;
      state.capI.set(key, geq * v + ieq);
      state.capV.set(key, v);
    } else if (e.kind === 'L') {
      state.indI.set(key, x[lay.branch.get(key)!]!);
      state.indV.set(key, v);
    }
  }
}

/** The times of the steps: a uniform grid that also lands on every source edge and switch time. */
function timeGrid(circuit: Circuit, step: number, stop: number): { times: number[]; edge: boolean[] } {
  const breaks = breakpoints(circuit.elements, stop);
  const times = [0];
  const edge = [true];
  const close = 1e-9 * step;
  let t = 0;
  let next = 0;
  while (t < stop) {
    while (next < breaks.length && breaks[next]! <= t + close) next++;
    const nextBreak = next < breaks.length ? breaks[next]! : Infinity;
    let target = t + step;
    const onBreak = nextBreak <= target + close;
    if (onBreak) target = nextBreak;
    if (target >= stop - close) target = stop;
    t = target;
    times.push(t);
    edge.push(onBreak);
  }
  return { times, edge };
}

const MAX_STEPS = 40000;

export function transient(circuit: Circuit, lay: Layout, probes: Probe[], step: number, stop: number): Transient {
  if (!(step > 0) || !(stop > step)) fail('netTranRange');
  if (stop / step > MAX_STEPS) fail('netTranSteps', { max: String(MAX_STEPS) });
  const start = solve(assemble(circuit, lay, DC), false);
  const state = initialState(circuit, lay, start.re);
  const { times, edge } = timeGrid(circuit, step, stop);
  const known = circuit.elements.some((e) => e.ic !== undefined);
  // With initial conditions, the t = 0 point is found with a vanishing step, which pins each capacitor voltage and
  // inductor current to its starting value.
  const zero = known
    ? solve(assemble(circuit, lay, { mode: 'tran', t: 0, initial: true, dt: stop * 1e-12, state }), false)
    : start;
  const first: Solution = { re: zero.re, im: zero.re.map(() => 0) };
  const values = probes.map((p) => [p.value(first, { t: 0, initial: true }).re]);
  let useEuler = true;
  for (let k = 1; k < times.length; k++) {
    const dt = times[k]! - times[k - 1]!;
    const trap = !useEuler;
    const { re } = solve(assemble(circuit, lay, { mode: 'tran', t: times[k]!, dt, trap, state }), false);
    advanceState(circuit, lay, re, state, dt, trap);
    const sol: Solution = { re, im: re.map(() => 0) };
    probes.forEach((p, i) => values[i]!.push(p.value(sol, { t: times[k]!, capI: state.capI }).re));
    useEuler = edge[k]!;
  }
  return { t: times, values };
}

// ---- Thevenin and Norton ----

export interface Equivalent {
  vth: number;
  rth: number;
  /** The Norton current, directed from node b to node a through the source so that it drives a positive. */
  norton: number;
  maxPower: number;
}

export function thevenin(circuit: Circuit, a: number, b: number): Equivalent {
  const lay = layoutOf(circuit);
  const open = solve(assemble(circuit, lay, DC), false).re;
  const vth = volt(open, a) - volt(open, b);
  const probe = solve(assemble(circuit, lay, { ...DC, zeroSources: true, test: { plus: a, minus: b } }), false).re;
  const rth = volt(probe, a) - volt(probe, b);
  return { vth, rth, norton: rth === 0 ? Infinity : vth / rth, maxPower: rth > 0 ? (vth * vth) / (4 * rth) : 0 };
}
