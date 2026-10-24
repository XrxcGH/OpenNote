// Ideal-gas states and processes: isothermal, isobaric, isochoric, isentropic, and polytropic, from state 1 to an
// end condition (p2, T2, or the volume ratio r = v1/v2). It gives the end state and the changes in u, h, and s.
// It also gives the boundary work and heat of a closed system and the shaft work of a steady-flow device. Values
// are per kg and per mol, with p-v and T-s plots of the path. Work is positive when the gas does it, and heat is
// positive when it is added to the gas.
import { fmt, tex } from '../common/format';
import { brent, linspace } from '../common/num';
import { ThermoError, positive, type KitStep, type PlotSpec, type ResultRow, type ThermoResult } from '../common/types';
import { NASA_SOURCE } from '../data/nasa';
import { gasOf, gasTMax, type Gas, type GasId, type GasModel } from './gas';

/** The state where relative pressure and volume are 1, K. */
const T_REF = 298.15;

export type Process = 'isothermal' | 'isobaric' | 'isochoric' | 'isentropic' | 'polytropic';
export type EndKind = 'p2' | 'T2' | 'r';

export interface ProcessInput {
  gas: GasId;
  model: GasModel;
  process: Process;
  T1: number;
  p1: number;
  end: EndKind;
  /** The end value: p2 in kPa, T2 in K, or r = v1/v2. */
  value: number;
  /** Polytropic exponent. */
  n: number;
}

interface End {
  T2: number;
  p2: number;
}

const ALLOWED: Record<Process, readonly EndKind[]> = {
  isothermal: ['p2', 'r'],
  isobaric: ['T2', 'r'],
  isochoric: ['T2', 'p2'],
  isentropic: ['p2', 'T2', 'r'],
  polytropic: ['p2', 'T2', 'r'],
};

/** The isentropic end state: s0(T2) - s0(T1) = R ln(p2/p1), or T2 from (p2/p1)^((k-1)/k) with constant k. */
function isentropicEnd(gas: Gas, T1: number, p1: number, end: EndKind, value: number): End {
  const k = gas.k(T1);
  const constant = gas.model !== 'variable';
  if (end === 'p2') {
    const T2 = constant ? T1 * (value / p1) ** ((k - 1) / k) : gas.tOfS0(gas.s0(T1) + gas.R * Math.log(value / p1));
    return { T2, p2: value };
  }
  if (end === 'T2') {
    const p2 = constant ? p1 * (value / T1) ** (k / (k - 1)) : p1 * Math.exp((gas.s0(value) - gas.s0(T1)) / gas.R);
    return { T2: value, p2 };
  }
  // Volume ratio: p2/p1 = r T2/T1, so s0(T2) - R ln T2 = s0(T1) - R ln T1 + R ln r.
  const T2 = constant
    ? T1 * value ** (k - 1)
    : solveT(
        (T) => gas.s0(T) - gas.R * Math.log(T) - (gas.s0(T1) - gas.R * Math.log(T1) + gas.R * Math.log(value)),
        gas,
      );
  return { T2, p2: (p1 * value * T2) / T1 };
}

/** A temperature root of f between 200 K and the gas's fitted limit, found by widening a bracket, then Brent. */
function solveT(f: (T: number) => number, gas: Gas): number {
  const hi = gasTMax(gas.id);
  let top = Math.min(hi, 400);
  while (f(200) * f(top) > 0 && top < hi) top = Math.min(hi, top * 1.5);
  if (f(200) * f(top) > 0) throw new ThermoError('gasRange', { formula: gas.id, max: String(hi) });
  return brent(f, 200, top);
}

function endState(gas: Gas, input: ProcessInput): End {
  const { process, T1, p1, end, value } = input;
  if (!ALLOWED[process].includes(end)) throw new ThermoError('endNotAllowed');
  if (end === 'p2' || end === 'T2' || end === 'r') positive(value, end);
  if (process === 'isothermal') return { T2: T1, p2: end === 'p2' ? value : p1 * value };
  if (process === 'isobaric') return { T2: end === 'T2' ? value : T1 / value, p2: p1 };
  if (process === 'isochoric')
    return end === 'T2' ? { T2: value, p2: (p1 * value) / T1 } : { T2: (T1 * value) / p1, p2: value };
  if (process === 'isentropic') return isentropicEnd(gas, T1, p1, end, value);
  const n = input.n;
  if (!Number.isFinite(n) || n <= 0) throw new ThermoError('badExponent');
  if (Math.abs(n - 1) < 1e-9) return endState(gas, { ...input, process: 'isothermal' });
  if (end === 'p2') return { T2: T1 * (value / p1) ** ((n - 1) / n), p2: value };
  if (end === 'T2') return { T2: value, p2: p1 * (value / T1) ** (n / (n - 1)) };
  return { T2: T1 * value ** (n - 1), p2: p1 * value ** n };
}

/** Boundary work (closed) and shaft work (steady flow) of the reversible process, kJ/kg, positive out. */
function works(gas: Gas, input: ProcessInput, e: End, v1: number, v2: number): { wb: number; ws: number } {
  const { T1, p1 } = input;
  const R = gas.R;
  switch (input.process) {
    case 'isothermal':
      return { wb: R * T1 * Math.log(v2 / v1), ws: R * T1 * Math.log(v2 / v1) };
    case 'isobaric':
      return { wb: p1 * (v2 - v1), ws: 0 };
    case 'isochoric':
      return { wb: 0, ws: -v1 * (e.p2 - p1) };
    case 'isentropic':
      // Reversible and adiabatic: the work is the drop in u (closed) or h (open).
      return { wb: gas.u(T1) - gas.u(e.T2), ws: gas.h(T1) - gas.h(e.T2) };
    default: {
      const n = input.n;
      if (Math.abs(n - 1) < 1e-9) return works(gas, { ...input, process: 'isothermal' }, e, v1, v2);
      const wb = (R * (e.T2 - T1)) / (1 - n);
      return { wb, ws: n * wb };
    }
  }
}

function pathPoints(gas: Gas, input: ProcessInput, e: End): { p: number; T: number }[] {
  const { T1, p1, process } = input;
  return linspace(0, 1, 60).map((t) => {
    if (process === 'isobaric') return { p: p1, T: T1 + t * (e.T2 - T1) };
    if (process === 'isochoric') {
      const T = T1 + t * (e.T2 - T1);
      return { p: (p1 * T) / T1, T };
    }
    const p = p1 * (e.p2 / p1) ** t;
    if (process === 'isothermal') return { p, T: T1 };
    if (process === 'isentropic') return { p, T: isentropicEnd(gas, T1, p1, 'p2', p).T2 };
    const n = input.n;
    return { p, T: T1 * (p / p1) ** ((n - 1) / n) };
  });
}

function plots(gas: Gas, input: ProcessInput, e: End): PlotSpec[] {
  const points = pathPoints(gas, input, e);
  const s1 = gas.s0(input.T1) - gas.R * Math.log(input.p1 / 100);
  const s = (pt: { p: number; T: number }) => gas.s0(pt.T) - gas.R * Math.log(pt.p / 100) - s1;
  const v = (pt: { p: number; T: number }) => (gas.R * pt.T) / pt.p;
  const ends = [points[0], points[points.length - 1]];
  return [
    {
      title: 'pv',
      x: { label: 'v', qty: 'v' },
      y: { label: 'p', qty: 'p' },
      series: [{ name: '', word: 'path', points: points.map((pt) => [v(pt), pt.p] as const) }],
      marks: ends.map((pt, i) => ({ x: v(pt), y: pt.p, label: String(i + 1) })),
    },
    {
      title: 'Ts',
      x: { label: 's - s₁', qty: 's' },
      y: { label: 'T', qty: 'T' },
      series: [{ name: '', word: 'path', points: points.map((pt) => [s(pt), pt.T] as const) }],
      marks: ends.map((pt, i) => ({ x: s(pt), y: pt.T, label: String(i + 1) })),
    },
  ];
}

function relationStep(gas: Gas, input: ProcessInput, e: End): KitStep {
  const k = fmt(gas.k(input.T1), 4);
  if (input.process === 'isentropic' && gas.model === 'variable')
    return {
      key: 'gas.isentropicVariable',
      vars: { s1: fmt(gas.s0(input.T1), 6), s2: fmt(gas.s0(e.T2), 6), ratio: fmt(e.p2 / input.p1, 5) },
      math: 's^\\circ(T_2)=s^\\circ(T_1)+R\\ln\\frac{p_2}{p_1}',
    };
  if (input.process === 'isentropic')
    return {
      key: 'gas.isentropicConstant',
      vars: { k },
      math: `T_2=T_1\\left(\\frac{p_2}{p_1}\\right)^{(k-1)/k},\\;k=${k}`,
    };
  if (input.process === 'polytropic')
    return {
      key: 'gas.polytropic',
      vars: { n: fmt(input.n, 4) },
      math: 'pv^n=C,\\;\\frac{T_2}{T_1}=\\left(\\frac{p_2}{p_1}\\right)^{(n-1)/n}',
    };
  return { key: `gas.${input.process}` as KitStep['key'], math: 'pv=RT' };
}

export function solveProcess(input: ProcessInput): ThermoResult {
  const T1 = positive(input.T1, 'T₁');
  const p1 = positive(input.p1, 'p₁');
  const gas = gasOf(input.gas, input.model);
  const e = endState(gas, input);
  if (!(e.T2 > 0) || !(e.p2 > 0) || !Number.isFinite(e.T2)) throw new ThermoError('noRoot');
  const v1 = (gas.R * T1) / p1;
  const v2 = (gas.R * e.T2) / e.p2;
  const du = gas.u(e.T2) - gas.u(T1);
  const dh = gas.h(e.T2) - gas.h(T1);
  const ds = gas.s0(e.T2) - gas.s0(T1) - gas.R * Math.log(e.p2 / p1);
  const { wb, ws } = works(gas, input, e, v1, v2);
  const perMol = (x: number) => (x * gas.M) / 1000;
  const rows: ResultRow[] = [
    { key: 'T2', symbol: 'T_2', value: e.T2, qty: 'T' },
    { key: 'p2', symbol: 'p_2', value: e.p2, qty: 'p' },
    { key: 'v1', symbol: 'v_1', value: v1, qty: 'v' },
    { key: 'v2', symbol: 'v_2', value: v2, qty: 'v' },
    { key: 'du', symbol: '\\Delta u', value: du, qty: 'e' },
    { key: 'dh', symbol: '\\Delta h', value: dh, qty: 'e' },
    { key: 'ds', symbol: '\\Delta s', value: ds, qty: 's' },
    { key: 'wb', symbol: 'w_b', value: wb, qty: 'e' },
    { key: 'qClosed', symbol: 'q', value: du + wb, qty: 'e' },
    { key: 'ws', symbol: 'w_s', value: ws, qty: 'e' },
    { key: 'wbMolar', symbol: '\\bar w_b', value: perMol(wb), qty: 'molarE' },
    { key: 'qMolar', symbol: '\\bar q', value: perMol(du + wb), qty: 'molarE' },
    { key: 'gasR', symbol: 'R', value: gas.R, qty: 's' },
    { key: 'kRatio', symbol: 'k', value: gas.k(T1), qty: 'none' },
  ];
  const steps: KitStep[] = [
    { key: `gas.model.${input.model}`, vars: { R: fmt(gas.R, 5), cp: fmt(gas.cp(T1), 5), k: fmt(gas.k(T1), 4) } },
    relationStep(gas, input, e),
    { key: 'gas.end', vars: { T2: fmt(e.T2, 6), p2: fmt(e.p2, 6), v1: fmt(v1, 5), v2: fmt(v2, 5) } },
    { key: 'gas.changes', vars: { du: fmt(du, 5), dh: fmt(dh, 5), ds: fmt(ds, 5) } },
    { key: 'gas.work', vars: { wb: fmt(wb, 5), q: fmt(du + wb, 5), ws: fmt(ws, 5) }, math: 'q=\\Delta u+w_b' },
  ];
  return {
    rows,
    steps,
    latex: `T_2=${tex(e.T2, 6)}\\ \\mathrm{K},\\quad w_b=${tex(wb, 5)}\\ \\mathrm{kJ/kg},\\quad q=${tex(du + wb, 5)}\\ \\mathrm{kJ/kg}`,
    notes: ['idealGas', 'workSign', ...(input.model === 'cold' ? (['coldAir'] as const) : [])],
    plots: plots(gas, input, e),
    source: input.model === 'cold' ? undefined : NASA_SOURCE,
  };
}

export interface StateInput {
  gas: GasId;
  model: GasModel;
  T: number;
  p: number;
}

/** One ideal-gas state: v, rho, u, h, s, cp, cv, k, and the speed of sound. */
export function solveState(input: StateInput): ThermoResult {
  const T = positive(input.T, 'T');
  const p = positive(input.p, 'p');
  const gas = gasOf(input.gas, input.model);
  const v = (gas.R * T) / p;
  const s = gas.s0(T) - gas.R * Math.log(p / 100);
  const k = gas.k(T);
  const a = Math.sqrt(k * gas.R * 1000 * T);
  const pr = Math.exp((gas.s0(T) - gas.s0(T_REF)) / gas.R);
  const vr = T / T_REF / pr;
  return {
    rows: [
      { key: 'v', symbol: 'v', value: v, qty: 'v' },
      { key: 'rho', symbol: '\\rho', value: 1 / v, qty: 'rho' },
      { key: 'u', symbol: 'u', value: gas.u(T), qty: 'e' },
      { key: 'h', symbol: 'h', value: gas.h(T), qty: 'e' },
      { key: 's', symbol: 's', value: s, qty: 's' },
      { key: 's0', symbol: 's^\\circ', value: gas.s0(T), qty: 's' },
      { key: 'cp', symbol: 'c_p', value: gas.cp(T), qty: 's' },
      { key: 'cv', symbol: 'c_v', value: gas.cv(T), qty: 's' },
      { key: 'kRatio', symbol: 'k', value: k, qty: 'none' },
      { key: 'pr', symbol: 'P_r', value: pr, qty: 'none' },
      { key: 'vr', symbol: 'v_r', value: vr, qty: 'none' },
      { key: 'soundSpeed', symbol: 'a', value: a, qty: 'speed' },
      { key: 'molarMassRow', symbol: 'M', value: gas.M, qty: 'molarM' },
      { key: 'gasR', symbol: 'R', value: gas.R, qty: 's' },
    ],
    steps: [
      {
        key: 'gas.law',
        vars: { v: fmt(v, 5) },
        math: `v=\\frac{RT}{p}=\\frac{${tex(gas.R, 5)}\\times${tex(T, 6)}}{${tex(p, 6)}}`,
      },
      { key: 'gas.entropy', vars: { s0: fmt(gas.s0(T), 6), s: fmt(s, 6) }, math: 's=s^\\circ(T)-R\\ln\\frac{p}{p_0}' },
      { key: 'gas.relative', vars: { pr: fmt(pr, 5), vr: fmt(vr, 5) } },
      { key: 'gas.sound', vars: { a: fmt(a, 5) }, math: 'a=\\sqrt{kRT}' },
    ],
    latex: `v=${tex(v, 5)}\\ \\mathrm{m^3/kg},\\quad h=${tex(gas.h(T), 6)}\\ \\mathrm{kJ/kg}`,
    notes: ['idealGas', input.model === 'variable' ? 'hReference' : 'hFromZero', 'relativeRef'],
    source: input.model === 'cold' ? undefined : NASA_SOURCE,
  };
}
