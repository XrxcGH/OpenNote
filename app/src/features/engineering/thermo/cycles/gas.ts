// Air-standard cycles: Otto, Diesel, and dual for engines, Brayton with regeneration, intercooling, and reheat for
// gas turbines, and the Carnot limits. Air runs with variable specific heats or the cold-air standard (k = 1.4).
import { fmt, tex } from '../common/format';
import { brent } from '../common/num';
import { ThermoError, positive, type ResultRow, type ThermoResult } from '../common/types';
import { gasFluid, type Fluid, type FluidState } from '../devices/fluids';
import { gasOf, gasTMax, type GasModel } from '../idealgas/gas';
import {
  CycleBuilder,
  cycleResult,
  internalEnergy as u,
  massRows,
  type CycleState,
  type Fixed,
  type PathKind,
} from './model';

export interface PistonInput {
  cycle: 'otto' | 'diesel' | 'dual';
  model: GasModel;
  T1: number;
  p1: number;
  /** Compression ratio v₁/v₂. */
  r: number;
  /** Otto: the peak temperature, K. */
  T3?: number;
  /** Diesel and dual: the cutoff ratio v₃/v₂. */
  rc?: number;
  /** Dual: the pressure ratio of the constant-volume heating. */
  rp?: number;
}

/** The isentropic state at volume v₂ from state a. */
function isentropeV(fluid: Fluid, model: GasModel, a: FluidState, v2: number): FluidState {
  const gas = gasOf('air', model);
  if (model !== 'variable') {
    const ratio = a.v / v2;
    const k = gas.k(300);
    return fluid.fromTP(a.T * ratio ** (k - 1), a.p * ratio ** k);
  }
  const f = (T: number) => fluid.fromTP(T, (gas.R * T) / v2).s - a.s;
  const hi = gasTMax('air');
  if (f(200) * f(hi) > 0) throw new ThermoError('gasRange', { formula: 'air', max: String(hi) });
  const T = brent(f, 200, hi);
  return fluid.fromTP(T, (gas.R * T) / v2);
}

const engineRows = (w: number, qin: number, qout: number): ResultRow[] => [
  { key: 'wNet', symbol: 'w_{net}', value: w, qty: 'e', answer: true },
  { key: 'qIn', symbol: 'q_{in}', value: qin, qty: 'e' },
  { key: 'qOut', symbol: 'q_{out}', value: qout, qty: 'e' },
  { key: 'etaTh', symbol: '\\eta_{th}', value: (100 * w) / qin, qty: 'percent', answer: true },
];

export function solvePiston(input: PistonInput): ThermoResult {
  const fluid = gasFluid('air', input.model);
  const r = positive(input.r, 'r');
  if (!(r > 1)) throw new ThermoError('ratioAboveOne', { name: 'r' });
  const build = new CycleBuilder(fluid);
  const one = build.add('1', fluid.fromTP(positive(input.T1, 'T₁'), positive(input.p1, 'p₁')), 'Tp');
  const two = build.add('2', isentropeV(fluid, input.model, one, one.v / r), 'sv', '1');
  build.join('1', '2', 's');
  let qin: number;
  let top: FluidState;
  if (input.cycle === 'otto') {
    const T3 = positive(input.T3, 'T₃');
    if (!(T3 > two.T)) throw new ThermoError('cycleHeatIn', { T: fmt(two.T, 5) });
    top = build.add('3', fluid.fromTP(T3, (two.p * T3) / two.T), 'Tv');
    build.join('2', '3', 'v');
    qin = u(top) - u(two);
    build.step({ key: 'cyc.heatV', vars: { q: fmt(qin, 6) }, math: 'q_{in}=u_3-u_2' });
  } else {
    const rc = positive(input.rc, 'r_c');
    if (!(rc > 1)) throw new ThermoError('ratioAboveOne', { name: 'r_c' });
    let start: CycleState = two;
    let qv = 0;
    if (input.cycle === 'dual') {
      const rp = positive(input.rp, 'r_p');
      if (!(rp >= 1)) throw new ThermoError('ratioAtLeastOne', { name: 'r_p' });
      start = build.add('x', fluid.fromTP(two.T * rp, two.p * rp), 'Tv');
      build.join('2', 'x', 'v');
      qv = u(start) - u(two);
      build.step({ key: 'cyc.heatV', vars: { q: fmt(qv, 6) }, math: 'q_{v}=u_x-u_2' });
    }
    top = build.add('3', fluid.fromTP(start.T * rc, start.p), 'Tp');
    build.join(start.label, '3', 'p');
    const qp = top.h - start.h;
    build.step({ key: 'cyc.heatP', vars: { q: fmt(qp, 6) }, math: `q_{p}=h_3-h_${start.label}` });
    qin = qv + qp;
  }
  const four = build.add('4', isentropeV(fluid, input.model, top, one.v), 'sv', '3');
  build.join('3', '4', 's');
  build.join('4', '1', 'v');
  const qout = u(four) - u(one);
  build.step({ key: 'cyc.rejectV', vars: { q: fmt(qout, 6) }, math: 'q_{out}=u_4-u_1' });
  const w = qin - qout;
  const mep = w / (one.v - two.v);
  build.step({
    key: 'cyc.totals',
    vars: { w: fmt(w, 6), qin: fmt(qin, 6), qout: fmt(qout, 6), eta: fmt((100 * w) / qin, 5) },
    math: '\\eta_{th}=\\frac{w_{net}}{q_{in}}=1-\\frac{q_{out}}{q_{in}}',
  });
  build.step({ key: 'cyc.mep', vars: { mep: fmt(mep, 5) }, math: '\\mathrm{MEP}=\\frac{w_{net}}{v_1-v_2}' });
  return cycleResult(
    build,
    [
      ...engineRows(w, qin, qout),
      { key: 'mep', symbol: '\\mathrm{MEP}', value: mep, qty: 'p' },
      { key: 'peakT', symbol: 'T_{max}', value: top.T, qty: 'T' },
      { key: 'peakP', symbol: 'p_{max}', value: top.p, qty: 'p' },
    ],
    `\\eta_{th}=${tex(w / qin, 5)},\\ w_{net}=${tex(w, 5)}\\ \\mathrm{kJ/kg}`,
    ['airStandard', ...(input.model === 'cold' ? (['coldAir'] as const) : [])],
  );
}

export interface BraytonInput {
  model: GasModel;
  T1: number;
  p1: number;
  rp: number;
  T3: number;
  etaC: number;
  etaT: number;
  /** Regenerator effectiveness, 0 for none. */
  regen: number;
  intercool: boolean;
  reheat: boolean;
  /** Net power, kW, for the mass flow. */
  power?: number;
}

/** One compressor or turbine stage from a state to a pressure, with its isentropic work. */
function stage(fluid: Fluid, start: FluidState, p: number, eta: number, compress: boolean) {
  const ideal = fluid.fromPS(p, start.s);
  const ws = compress ? ideal.h - start.h : start.h - ideal.h;
  const w = compress ? ws / eta : eta * ws;
  return { state: fluid.fromPH(p, compress ? start.h + w : start.h - w), w, ws };
}

/** The turbine train from the combustor exit: its stages, with reheat to T₃ between them. */
function turbines(fluid: Fluid, inlet: FluidState, input: BraytonInput, stages: number) {
  const out: { state: FluidState; w: number; reheat: boolean }[] = [];
  let state = inlet;
  for (let i = 0; i < stages; i++) {
    if (i > 0) {
      state = fluid.fromTP(input.T3, state.p);
      out.push({ state, w: 0, reheat: true });
    }
    const next = stage(fluid, state, state.p / input.rp ** (1 / stages), input.etaT, false);
    state = next.state;
    out.push({ state, w: next.w, reheat: false });
  }
  return out;
}

export function solveBrayton(input: BraytonInput): ThermoResult {
  const fluid = gasFluid('air', input.model);
  const rp = positive(input.rp, 'r_p');
  if (!(rp > 1)) throw new ThermoError('ratioAboveOne', { name: 'r_p' });
  for (const eta of [input.etaC, input.etaT]) if (!(eta > 0 && eta <= 1)) throw new ThermoError('efficiencyRange');
  if (!(input.regen >= 0 && input.regen <= 1)) throw new ThermoError('effectivenessRange');
  const T1 = positive(input.T1, 'T₁');
  const T3 = positive(input.T3, 'T₃');
  const build = new CycleBuilder(fluid);
  let n = 0;
  const label = () => String(++n);
  let state = build.add(label(), fluid.fromTP(T1, positive(input.p1, 'p₁')), 'Tp');
  const sums = { wc: 0, wt: 0, qin: 0, qout: 0 };
  const move = (next: FluidState, how: Fixed, kind: PathKind) => {
    const from = state.label;
    state = build.add(label(), next, how, from);
    build.join(from, state.label, kind);
  };
  const cStages = input.intercool ? 2 : 1;
  for (let i = 0; i < cStages; i++) {
    if (i > 0) {
      const before = state.h;
      move(fluid.fromTP(T1, state.p), 'Tp', 'p');
      sums.qout += before - state.h;
      build.step({ key: 'cyc.intercool', vars: { q: fmt(before - state.h, 6) } });
    }
    const next = stage(fluid, state, state.p * rp ** (1 / cStages), input.etaC, true);
    move(next.state, 'ph', input.etaC === 1 ? 's' : 'line');
    sums.wc += next.w;
    build.step({ key: 'cyc.compressor', vars: { w: fmt(next.w, 6), ws: fmt(next.ws, 6) } });
  }
  const compressorExit = state;
  if (!(T3 > compressorExit.T)) throw new ThermoError('cycleHeatIn', { T: fmt(compressorExit.T, 5) });
  const tStages = input.reheat ? 2 : 1;
  const combustorExit = (from: FluidState) => fluid.fromTP(T3, from.p);
  // The exhaust does not depend on the regenerator, so it is found first to size the regenerator.
  const exhaust = turbines(fluid, combustorExit(compressorExit), input, tStages).at(-1)!.state;
  let regenQ = 0;
  if (input.regen > 0) {
    if (!(exhaust.T > compressorExit.T)) throw new ThermoError('regenImpossible');
    regenQ = input.regen * (exhaust.h - compressorExit.h);
    move(fluid.fromPH(compressorExit.p, compressorExit.h + regenQ), 'ph', 'p');
    build.step({ key: 'cyc.regenerator', vars: { q: fmt(regenQ, 6), eps: fmt(input.regen, 3) } });
  }
  const before = state.h;
  move(combustorExit(state), 'Tp', 'p');
  sums.qin += state.h - before;
  build.step({ key: 'cyc.combustor', vars: { q: fmt(state.h - before, 6) } });
  for (const piece of turbines(fluid, state, input, tStages)) {
    const from = state.h;
    move(piece.state, piece.reheat ? 'Tp' : 'ph', piece.reheat ? 'p' : input.etaT === 1 ? 's' : 'line');
    if (piece.reheat) {
      sums.qin += state.h - from;
      build.step({ key: 'cyc.combustor', vars: { q: fmt(state.h - from, 6) } });
    } else {
      sums.wt += piece.w;
      build.step({ key: 'cyc.turbine', vars: { w: fmt(piece.w, 6) } });
    }
  }
  if (regenQ > 0) move(fluid.fromPH(state.p, state.h - regenQ), 'ph', 'p');
  build.join(state.label, '1', 'p');
  const first = build.get('1');
  sums.qout += state.h - first.h;
  build.step({ key: 'cyc.cooler', vars: { q: fmt(state.h - first.h, 6) } });
  const { wc, wt, qin, qout } = sums;
  const w = wt - wc;
  if (!(w > 0)) throw new ThermoError('cycleNoWork');
  build.step({
    key: 'cyc.totals',
    vars: { w: fmt(w, 6), qin: fmt(qin, 6), qout: fmt(qout, 6), eta: fmt((100 * w) / qin, 5) },
    math: '\\eta_{th}=\\frac{w_t-w_c}{q_{in}}',
  });
  build.step({ key: 'cyc.bwr', vars: { bwr: fmt(wc / wt, 5) }, math: 'r_{bw}=\\frac{w_c}{w_t}' });
  const rows: ResultRow[] = [
    ...engineRows(w, qin, qout),
    { key: 'wTurbine', symbol: 'w_t', value: wt, qty: 'e' },
    { key: 'wCompressor', symbol: 'w_c', value: wc, qty: 'e' },
    { key: 'bwr', symbol: 'r_{bw}', value: wc / wt, qty: 'none' },
    ...massRows(build, input.power, w, qin),
  ];
  return cycleResult(build, rows, `\\eta_{th}=${tex(w / qin, 5)},\\ r_{bw}=${tex(wc / wt, 5)}`, [
    'airStandard',
    'steadyCycle',
    ...(input.model === 'cold' ? (['coldAir'] as const) : []),
  ]);
}

export function solveCarnot(TH: number, TL: number, QH?: number): ThermoResult {
  const hot = positive(TH, 'T_H');
  const cold = positive(TL, 'T_L');
  if (!(hot > cold)) throw new ThermoError('reservoirOrder');
  const eta = 1 - cold / hot;
  const copR = cold / (hot - cold);
  const copHP = hot / (hot - cold);
  const rows: ResultRow[] = [
    { key: 'etaTh', symbol: '\\eta_{Carnot}', value: eta * 100, qty: 'percent', answer: true },
    { key: 'copR', symbol: '\\mathrm{COP}_R', value: copR, qty: 'none', answer: true },
    { key: 'copHP', symbol: '\\mathrm{COP}_{HP}', value: copHP, qty: 'none' },
  ];
  if (QH !== undefined)
    rows.push({ key: 'powerRow', symbol: '\\dot W', value: eta * positive(QH, 'Q_H'), qty: 'power' });
  return {
    rows,
    steps: [
      {
        key: 'cyc.carnot',
        vars: { eta: fmt(eta * 100, 5), copR: fmt(copR, 5), copHP: fmt(copHP, 5) },
        math: `\\eta=1-\\frac{T_L}{T_H}=1-\\frac{${fmt(cold, 6)}}{${fmt(hot, 6)}}`,
      },
    ],
    latex: `\\eta_{Carnot}=1-\\frac{T_L}{T_H}=${tex(eta, 5)}`,
    notes: ['carnotLimit'],
  };
}
