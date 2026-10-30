// Steady-flow devices and the second law: turbines, compressors, pumps, nozzles, diffusers, throttles, heat
// exchangers, mixing chambers, and heat flowing between two reservoirs. Each device is a first-law balance
// with an isentropic step and an efficiency where they apply. The second law then gives the entropy generated,
// s_gen = s₂ − s₁ − q/T_b, the exergy destroyed, T₀ s_gen, and a second-law efficiency. Work is positive out of
// turbines and into compressors and pumps.
import { fmt } from '../common/format';
import { ThermoError, positive, type KitStep, type PlotSpec, type ResultRow, type ThermoResult } from '../common/types';
import type { GasId, GasModel } from '../idealgas/gas';
import { refrigerantPlot } from '../r134a/engine';
import { steamPlots } from '../steam/engine';
import { fluidOf, type Fluid, type FluidId, type FluidState } from './fluids';

export type Device =
  'turbine' | 'compressor' | 'pump' | 'nozzle' | 'diffuser' | 'throttle' | 'exchanger' | 'mixing' | 'reservoirs';

/** A state given by T and p, or by p and a quality. */
export interface StateSpec {
  known: 'Tp' | 'px';
  p: number;
  T?: number;
  x?: number;
}

/** An exit at the inlet's pressure, given by T or by a quality. */
export interface ExitSpec {
  known: 'T' | 'x';
  T?: number;
  x?: number;
}

export interface DeviceInput {
  device: Device;
  fluid: FluidId;
  gas?: GasId;
  model?: GasModel;
  inlet: StateSpec;
  /** Exit pressure, kPa. */
  p2?: number;
  /** Isentropic efficiency, 0 to 1. */
  eta?: number;
  /** Mass flow, kg/s. */
  m?: number;
  V1?: number;
  V2?: number;
  /** Heat exchanger: the hot stream's exit; the cold stream's inlet and exit. */
  exit?: ExitSpec;
  inletB?: StateSpec;
  exitB?: ExitSpec;
  /** Mixing chamber: the second stream's flow, and heat lost to the surroundings, kW. */
  mB?: number;
  qLoss?: number;
  /** One-stream devices: heat lost per kg of flow (kJ/kg; negative is heat gained), at boundary temperature Tb (K). */
  qOut?: number;
  Tb?: number;
  /** Reservoirs: heat (kW) from T_H to T_L. */
  Q?: number;
  TH?: number;
  TL?: number;
  T0: number;
  p0: number;
}

const need = (value: number | undefined, name: string): number => {
  if (value === undefined || !Number.isFinite(value)) throw new ThermoError('missing', { name });
  return value;
};

function stateOf(fluid: Fluid, spec: StateSpec): FluidState {
  const p = positive(spec.p, 'p');
  if (spec.known === 'px') {
    if (fluid.kind === 'gas') throw new ThermoError('gasNoSaturation');
    return fluid.fromPX(p, need(spec.x, 'x'));
  }
  return fluid.fromTP(positive(spec.T, 'T'), p);
}

function exitOf(fluid: Fluid, p: number, spec: ExitSpec): FluidState {
  if (spec.known === 'x') {
    if (fluid.kind === 'gas') throw new ThermoError('gasNoSaturation');
    return fluid.fromPX(p, need(spec.x, 'x'));
  }
  return fluid.fromTP(positive(spec.T, 'T'), p);
}

const C = { SI: '°C' } as const;

/** Rows of one state: T, p, h, s, and x when two-phase. */
function stateRows(state: FluidState, tag: string, fluid: Fluid): ResultRow[] {
  const unit = fluid.kind === 'gas' ? undefined : C;
  const rows: ResultRow[] = [
    { key: 'temperature', symbol: 'T', value: state.T, qty: 'T', unit, tag },
    { key: 'h', symbol: 'h', value: state.h, qty: 'e', tag },
    { key: 's', symbol: 's', value: state.s, qty: 's', tag },
  ];
  if (state.x !== null) rows.push({ key: 'quality', symbol: 'x', value: state.x, qty: 'none', tag });
  return rows;
}

const stateVars = (state: FluidState, label: string) => ({
  label,
  T: fmt(state.T, 6),
  p: fmt(state.p, 6),
  h: fmt(state.h, 6),
  s: fmt(state.s, 6),
});

/** Flow exergy relative to the dead state, kJ/kg, with kinetic energy when a velocity is given. */
const exergy = (state: FluidState, dead: FluidState, T0: number, V = 0): number =>
  state.h - dead.h - T0 * (state.s - dead.s) + (V * V) / 2000;

function plotOf(fluid: Fluid, points: { label: string; state: FluidState }[]): PlotSpec[] {
  const marks = points.map(({ label, state }) => ({ label, ...state }));
  if (fluid.kind === 'water') return [steamPlots(marks)[0]];
  if (fluid.kind === 'r134a') return [refrigerantPlot(marks, 'iir')];
  const s0 = points[0].state.s;
  return [
    {
      title: 'deviceTs',
      x: { label: 's − s₁', qty: 's' },
      y: { label: 'T', qty: 'T' },
      series: [{ name: '', word: 'path', points: points.map(({ state }) => [state.s - s0, state.T] as const) }],
      marks: points.map(({ label, state }) => ({ x: state.s - s0, y: state.T, label })),
    },
  ];
}

interface Second {
  rows: ResultRow[];
  steps: KitStep[];
}

/** Entropy generated and exergy destroyed, per kg and, with a flow, per second. */
function secondLaw(sgen: number, T0: number, m: number | undefined, etaII: number | null): Second {
  if (sgen < -1e-7) throw new ThermoError('secondLaw', { sgen: fmt(sgen, 4) });
  const rows: ResultRow[] = [
    { key: 'sgen', symbol: 's_{gen}', value: Math.max(0, sgen), qty: 's' },
    { key: 'xdest', symbol: 'x_{dest}', value: T0 * Math.max(0, sgen), qty: 'e' },
  ];
  if (m !== undefined) {
    rows.push(
      { key: 'sgenRate', symbol: '\\dot S_{gen}', value: m * Math.max(0, sgen), qty: 'sgen' },
      { key: 'xdestRate', symbol: '\\dot X_{dest}', value: m * T0 * Math.max(0, sgen), qty: 'power' },
    );
  }
  if (etaII !== null) rows.push({ key: 'etaII', symbol: '\\eta_{II}', value: etaII * 100, qty: 'percent' });
  return {
    rows,
    steps: [
      {
        key: 'dev.exergy',
        vars: { sgen: fmt(sgen, 5), T0: fmt(T0, 5), x: fmt(T0 * sgen, 5) },
        math: 'x_{dest}=T_0\\,s_{gen}',
      },
      ...(etaII === null ? [] : [{ key: 'dev.etaII' as const, vars: { eta: fmt(etaII * 100, 4) } }]),
    ],
  };
}

/** Heat lost per kg and the boundary temperature it crosses, T₀ unless given; zero loss is adiabatic. */
function heatOf(input: DeviceInput, T0: number): { q: number; Tb: number; sq: number } {
  const q = input.qOut ?? 0;
  if (!Number.isFinite(q)) throw new ThermoError('missing', { name: 'q_out' });
  const Tb = input.Tb === undefined ? T0 : positive(input.Tb, 'T_b');
  return { q, Tb, sq: q / Tb };
}

/** The exit state's step, with the entropy the lost heat carries out when there is any. */
const exitStep = (two: FluidState, sgen: number, q: number, Tb: number): KitStep =>
  q === 0
    ? { key: 'dev.exitState', vars: { ...stateVars(two, '2'), sgen: fmt(sgen, 5) }, math: 's_{gen}=s_2-s_1' }
    : {
        key: 'dev.exitStateQ',
        vars: { ...stateVars(two, '2'), q: fmt(q, 6), Tb: fmt(Tb, 5), sgen: fmt(sgen, 5) },
        math: 's_{gen}=s_2-s_1+\\frac{q_{out}}{T_b}',
      };

/** The entropy balance with heat lost, for the devices whose energy step does not give s_gen. */
const entropySteps = (q: number, Tb: number, sgen: number): KitStep[] =>
  q === 0
    ? []
    : [
        {
          key: 'dev.heatEntropy',
          vars: { q: fmt(q, 6), Tb: fmt(Tb, 5), sgen: fmt(sgen, 5) },
          math: 's_{gen}=s_2-s_1+\\frac{q_{out}}{T_b}',
        },
      ];

const heatRows = (q: number): ResultRow[] => (q === 0 ? [] : [{ key: 'qOut', symbol: 'q_{out}', value: q, qty: 'e' }]);

function finish(
  fluid: Fluid,
  rows: ResultRow[],
  steps: KitStep[],
  latex: string,
  points: { label: string; state: FluidState }[],
): ThermoResult {
  return {
    rows,
    steps,
    latex,
    notes: ['steadyFlow', 'deviceSigns'],
    plots: plotOf(fluid, points),
    source: fluid.source,
    states: points.map(({ label, state }) => ({ label, ...state })),
  };
}

/** Turbines, compressors, and pumps: the isentropic exit, then the actual one from the efficiency. */
function workDevice(input: DeviceInput, fluid: Fluid): ThermoResult {
  const one = stateOf(fluid, input.inlet);
  const p2 = positive(input.p2, 'p₂');
  const eta = need(input.eta, 'η');
  if (!(eta > 0 && eta <= 1)) throw new ThermoError('efficiencyRange');
  const expands = input.device === 'turbine';
  if (expands ? p2 >= one.p : p2 <= one.p) throw new ThermoError(expands ? 'turbinePressure' : 'compressorPressure');
  const twoS = fluid.fromPS(p2, one.s);
  const ws = expands ? one.h - twoS.h : twoS.h - one.h;
  // The efficiency sets the exit enthalpy; heat lost on the way takes work from a turbine and adds it to a compressor.
  const dh = expands ? eta * ws : ws / eta;
  const two = fluid.fromPH(p2, expands ? one.h - dh : one.h + dh);
  const T0 = positive(input.T0, 'T₀');
  const { q, Tb, sq } = heatOf(input, T0);
  const w = expands ? dh - q : dh + q;
  if (!(w > 0)) throw new ThermoError('heatLossTooLarge');
  const sgen = two.s - one.s + sq;
  // The exergy the lost heat carries out at Tb, q (1 − T₀/Tb), leaves the device but is not destroyed in it.
  const xHeat = q * (1 - T0 / Tb);
  const etaII = expands ? w / (w + T0 * sgen + xHeat) : (w - T0 * sgen - xHeat) / w;
  const second = secondLaw(sgen, T0, input.m, etaII);
  const unit = fluid.kind === 'gas' ? undefined : C;
  const rows: ResultRow[] = [
    { key: expands ? 'wOut' : 'wIn', symbol: 'w', value: w, qty: 'e' },
    { key: 'wsIsentropic', symbol: 'w_s', value: ws, qty: 'e' },
    ...heatRows(q),
    ...(input.m === undefined
      ? []
      : [{ key: 'powerRow' as const, symbol: '\\dot W', value: input.m * w, qty: 'power' as const }]),
    { key: 'T2s', symbol: 'T_{2s}', value: twoS.T, qty: 'T', unit },
    { key: 'h2s', symbol: 'h_{2s}', value: twoS.h, qty: 'e' },
    ...stateRows(two, '2', fluid),
    ...second.rows,
  ];
  const effKey = expands ? 'dev.etaTurbine' : 'dev.etaCompressor';
  const steps: KitStep[] = [
    { key: 'dev.state', vars: stateVars(one, '1') },
    {
      key: 'dev.isentropic',
      vars: { p2: fmt(p2, 6), s: fmt(one.s, 6), T: fmt(twoS.T, 6), h: fmt(twoS.h, 6) },
      math: 's_{2s}=s_1',
    },
    q === 0
      ? {
          key: effKey,
          vars: { eta: fmt(eta, 4), ws: fmt(ws, 6), w: fmt(w, 6) },
          math: expands ? 'w=\\eta_t(h_1-h_{2s})' : 'w=\\frac{h_{2s}-h_1}{\\eta_c}',
        }
      : {
          key: expands ? 'dev.etaTurbineQ' : 'dev.etaCompressorQ',
          vars: { eta: fmt(eta, 4), ws: fmt(ws, 6), dh: fmt(dh, 6), q: fmt(q, 6), w: fmt(w, 6) },
          math: expands ? 'w=\\eta_t(h_1-h_{2s})-q_{out}' : 'w=\\frac{h_{2s}-h_1}{\\eta_c}+q_{out}',
        },
    exitStep(two, sgen, q, Tb),
    ...(input.m === undefined
      ? []
      : [
          {
            key: 'dev.power' as const,
            vars: { m: fmt(input.m, 5), W: fmt(input.m * w, 6) },
            math: '\\dot W=\\dot m\\,w',
          },
        ]),
    ...second.steps,
  ];
  return finish(fluid, rows, steps, `w=${fmt(w, 6)}\\ \\mathrm{kJ/kg},\\ T_2=${fmt(two.T, 6)}\\ \\mathrm{K}`, [
    { label: '1', state: one },
    { label: '2s', state: twoS },
    { label: '2', state: two },
  ]);
}

/** Nozzles and diffusers: h₁ + V₁²/2 = h₂ + V₂²/2. */
function flowDevice(input: DeviceInput, fluid: Fluid): ThermoResult {
  const one = stateOf(fluid, input.inlet);
  const p2 = positive(input.p2, 'p₂');
  const V1 = need(input.V1, 'V₁');
  if (V1 < 0) throw new ThermoError('notPositive', { name: 'V₁' });
  const T0 = positive(input.T0, 'T₀');
  const { q, Tb, sq } = heatOf(input, T0);
  const unit = fluid.kind === 'gas' ? undefined : C;
  if (input.device === 'nozzle') {
    const eta = input.eta ?? 1;
    if (!(eta > 0 && eta <= 1)) throw new ThermoError('efficiencyRange');
    if (p2 >= one.p) throw new ThermoError('nozzlePressure');
    const twoS = fluid.fromPS(p2, one.s);
    const drop = eta * (one.h - twoS.h);
    const two = fluid.fromPH(p2, one.h - drop);
    const kinetic = 2000 * (drop - q) + V1 * V1;
    if (!(kinetic >= 0)) throw new ThermoError('heatLossTooLarge');
    const V2 = Math.sqrt(kinetic);
    const second = secondLaw(two.s - one.s + sq, T0, input.m, null);
    return finish(
      fluid,
      [
        { key: 'V2', symbol: 'V_2', value: V2, qty: 'speed' },
        ...heatRows(q),
        { key: 'T2s', symbol: 'T_{2s}', value: twoS.T, qty: 'T', unit },
        ...stateRows(two, '2', fluid),
        ...second.rows,
      ],
      [
        { key: 'dev.state', vars: stateVars(one, '1') },
        {
          key: 'dev.isentropic',
          vars: { p2: fmt(p2, 6), s: fmt(one.s, 6), T: fmt(twoS.T, 6), h: fmt(twoS.h, 6) },
          math: 's_{2s}=s_1',
        },
        q === 0
          ? {
              key: 'dev.nozzle',
              vars: { eta: fmt(eta, 4), h2: fmt(two.h, 6), V2: fmt(V2, 6) },
              math: 'V_2=\\sqrt{2(h_1-h_2)+V_1^2}',
            }
          : {
              key: 'dev.nozzleQ',
              vars: { eta: fmt(eta, 4), q: fmt(q, 6), h2: fmt(two.h, 6), V2: fmt(V2, 6) },
              math: 'V_2=\\sqrt{2(h_1-h_2-q_{out})+V_1^2}',
            },
        ...entropySteps(q, Tb, two.s - one.s + sq),
        ...second.steps,
      ],
      `V_2=${fmt(V2, 6)}\\ \\mathrm{m/s},\\ T_2=${fmt(two.T, 6)}\\ \\mathrm{K}`,
      [
        { label: '1', state: one },
        { label: '2', state: two },
      ],
    );
  }
  const V2 = need(input.V2, 'V₂');
  if (V2 < 0 || V2 > V1) throw new ThermoError('diffuserSpeed');
  const two = fluid.fromPH(p2, one.h + (V1 * V1 - V2 * V2) / 2000 - q);
  const second = secondLaw(two.s - one.s + sq, T0, input.m, null);
  return finish(
    fluid,
    [...heatRows(q), ...stateRows(two, '2', fluid), ...second.rows],
    [
      { key: 'dev.state', vars: stateVars(one, '1') },
      q === 0
        ? {
            key: 'dev.diffuser',
            vars: { h2: fmt(two.h, 6), T2: fmt(two.T, 6) },
            math: 'h_2=h_1+\\frac{V_1^2-V_2^2}{2}',
          }
        : {
            key: 'dev.diffuserQ',
            vars: { q: fmt(q, 6), h2: fmt(two.h, 6), T2: fmt(two.T, 6) },
            math: 'h_2=h_1+\\frac{V_1^2-V_2^2}{2}-q_{out}',
          },
      ...entropySteps(q, Tb, two.s - one.s + sq),
      ...second.steps,
    ],
    `T_2=${fmt(two.T, 6)}\\ \\mathrm{K}`,
    [
      { label: '1', state: one },
      { label: '2', state: two },
    ],
  );
}

function throttle(input: DeviceInput, fluid: Fluid): ThermoResult {
  const one = stateOf(fluid, input.inlet);
  const p2 = positive(input.p2, 'p₂');
  if (p2 >= one.p) throw new ThermoError('throttlePressure');
  const T0 = positive(input.T0, 'T₀');
  const { q, Tb, sq } = heatOf(input, T0);
  const two = fluid.fromPH(p2, one.h - q);
  const second = secondLaw(two.s - one.s + sq, T0, input.m, null);
  return finish(
    fluid,
    [...heatRows(q), ...stateRows(two, '2', fluid), ...second.rows],
    [
      { key: 'dev.state', vars: stateVars(one, '1') },
      q === 0
        ? { key: 'dev.throttle', vars: { ...stateVars(two, '2') }, math: 'h_2=h_1' }
        : { key: 'dev.throttleQ', vars: { ...stateVars(two, '2'), q: fmt(q, 6) }, math: 'h_2=h_1-q_{out}' },
      ...entropySteps(q, Tb, two.s - one.s + sq),
      ...second.steps,
    ],
    `h_2=h_1=${fmt(one.h, 6)}\\ \\mathrm{kJ/kg},\\ T_2=${fmt(two.T, 6)}\\ \\mathrm{K}`,
    [
      { label: '1', state: one },
      { label: '2', state: two },
    ],
  );
}

/** A heat exchanger of one fluid on both sides: the cold stream's flow from the energy balance. */
function exchanger(input: DeviceInput, fluid: Fluid): ThermoResult {
  const mA = positive(input.m, 'ṁ');
  const a1 = stateOf(fluid, input.inlet);
  const a2 = exitOf(fluid, a1.p, input.exit ?? { known: 'T' });
  const b1 = stateOf(fluid, input.inletB ?? { known: 'Tp', p: NaN });
  const b2 = exitOf(fluid, b1.p, input.exitB ?? { known: 'T' });
  const Q = mA * (a1.h - a2.h);
  if (!(Q > 0) || !(b2.h > b1.h)) throw new ThermoError('exchangerDirection');
  const mB = Q / (b2.h - b1.h);
  const T0 = positive(input.T0, 'T₀');
  const sgenRate = mA * (a2.s - a1.s) + mB * (b2.s - b1.s);
  if (sgenRate < -1e-7) throw new ThermoError('secondLaw', { sgen: fmt(sgenRate, 4) });
  const dead = fluid.fromTP(T0, positive(input.p0, 'p₀'));
  const given = mA * (exergy(a1, dead, T0) - exergy(a2, dead, T0));
  const gained = mB * (exergy(b2, dead, T0) - exergy(b1, dead, T0));
  const etaII = gained / given;
  return finish(
    fluid,
    [
      { key: 'qRate', symbol: '\\dot Q', value: Q, qty: 'power' },
      { key: 'mCold', symbol: '\\dot m_B', value: mB, qty: 'mdot' },
      { key: 'sgenRate', symbol: '\\dot S_{gen}', value: Math.max(0, sgenRate), qty: 'sgen' },
      { key: 'xdestRate', symbol: '\\dot X_{dest}', value: T0 * Math.max(0, sgenRate), qty: 'power' },
      { key: 'etaII', symbol: '\\eta_{II}', value: etaII * 100, qty: 'percent' },
    ],
    [
      { key: 'dev.state', vars: stateVars(a1, 'A1') },
      { key: 'dev.state', vars: stateVars(a2, 'A2') },
      { key: 'dev.state', vars: stateVars(b1, 'B1') },
      { key: 'dev.state', vars: stateVars(b2, 'B2') },
      {
        key: 'dev.exchanger',
        vars: { Q: fmt(Q, 6), mB: fmt(mB, 6) },
        math: '\\dot m_A(h_{A1}-h_{A2})=\\dot m_B(h_{B2}-h_{B1})',
      },
      {
        key: 'dev.exchangerEntropy',
        vars: { sgen: fmt(sgenRate, 5), x: fmt(T0 * sgenRate, 5), eta: fmt(etaII * 100, 4) },
        math: '\\dot S_{gen}=\\dot m_A(s_{A2}-s_{A1})+\\dot m_B(s_{B2}-s_{B1})',
      },
    ],
    `\\dot Q=${fmt(Q, 6)}\\ \\mathrm{kW},\\ \\dot m_B=${fmt(mB, 6)}\\ \\mathrm{kg/s}`,
    [
      { label: 'A1', state: a1 },
      { label: 'A2', state: a2 },
      { label: 'B1', state: b1 },
      { label: 'B2', state: b2 },
    ],
  );
}

function mixing(input: DeviceInput, fluid: Fluid): ThermoResult {
  const mA = positive(input.m, 'ṁ₁');
  const mB = positive(input.mB, 'ṁ₂');
  const a = stateOf(fluid, input.inlet);
  const b = stateOf(fluid, input.inletB ?? { known: 'Tp', p: NaN });
  const p3 = positive(input.p2, 'p₃');
  const loss = input.qLoss ?? 0;
  const m3 = mA + mB;
  const three = fluid.fromPH(p3, (mA * a.h + mB * b.h - loss) / m3);
  const T0 = positive(input.T0, 'T₀');
  const sgenRate = m3 * three.s - mA * a.s - mB * b.s + loss / T0;
  if (sgenRate < -1e-7) throw new ThermoError('secondLaw', { sgen: fmt(sgenRate, 4) });
  return finish(
    fluid,
    [
      ...stateRows(three, '3', fluid),
      { key: 'm3', symbol: '\\dot m_3', value: m3, qty: 'mdot' },
      { key: 'sgenRate', symbol: '\\dot S_{gen}', value: Math.max(0, sgenRate), qty: 'sgen' },
      { key: 'xdestRate', symbol: '\\dot X_{dest}', value: T0 * Math.max(0, sgenRate), qty: 'power' },
    ],
    [
      { key: 'dev.state', vars: stateVars(a, '1') },
      { key: 'dev.state', vars: stateVars(b, '2') },
      {
        key: 'dev.mixing',
        vars: { h3: fmt(three.h, 6), T3: fmt(three.T, 6), loss: fmt(loss, 5) },
        math: '\\dot m_3h_3=\\dot m_1h_1+\\dot m_2h_2-\\dot Q_{out}',
      },
      {
        key: 'dev.mixingEntropy',
        vars: { sgen: fmt(sgenRate, 5), x: fmt(T0 * sgenRate, 5) },
        math: '\\dot S_{gen}=\\dot m_3s_3-\\dot m_1s_1-\\dot m_2s_2+\\frac{\\dot Q_{out}}{T_0}',
      },
    ],
    `h_3=${fmt(three.h, 6)}\\ \\mathrm{kJ/kg},\\ T_3=${fmt(three.T, 6)}\\ \\mathrm{K}`,
    [
      { label: '1', state: a },
      { label: '2', state: b },
      { label: '3', state: three },
    ],
  );
}

/** Heat Q flowing from a reservoir at T_H to one at T_L. */
export function reservoirs(input: DeviceInput): ThermoResult {
  const Q = positive(input.Q, 'Q');
  const TH = positive(input.TH, 'T_H');
  const TL = positive(input.TL, 'T_L');
  const T0 = positive(input.T0, 'T₀');
  if (TL > TH) throw new ThermoError('reservoirOrder');
  const sgen = Q / TL - Q / TH;
  const etaII = TL > T0 ? (1 - T0 / TL) / (1 - T0 / TH) : 0;
  return {
    rows: [
      { key: 'sgenRate', symbol: '\\dot S_{gen}', value: sgen, qty: 'sgen' },
      { key: 'xdestRate', symbol: '\\dot X_{dest}', value: T0 * sgen, qty: 'power' },
      { key: 'etaII', symbol: '\\eta_{II}', value: etaII * 100, qty: 'percent' },
    ],
    steps: [
      {
        key: 'dev.reservoirs',
        vars: { Q: fmt(Q, 6), TH: fmt(TH, 6), TL: fmt(TL, 6), sgen: fmt(sgen, 6) },
        math:
          '\\dot S_{gen}=\\frac{\\dot Q}{T_L}-\\frac{\\dot Q}{T_H}=' +
          `\\frac{${fmt(Q, 6)}}{${fmt(TL, 6)}}-\\frac{${fmt(Q, 6)}}{${fmt(TH, 6)}}`,
      },
      {
        key: 'dev.exergy',
        vars: { sgen: fmt(sgen, 6), T0: fmt(T0, 5), x: fmt(T0 * sgen, 6) },
        math: '\\dot X_{dest}=T_0\\dot S_{gen}',
      },
    ],
    latex: `\\dot S_{gen}=${fmt(sgen, 6)}\\ \\mathrm{kW/K},\\ \\dot X_{dest}=${fmt(T0 * sgen, 6)}\\ \\mathrm{kW}`,
    notes: ['reservoirsNote'],
  };
}

export function solveDevice(input: DeviceInput): ThermoResult {
  if (input.device === 'reservoirs') return reservoirs(input);
  const fluid = fluidOf(input.fluid, input.gas, input.model);
  if (input.m !== undefined && !(input.m > 0)) throw new ThermoError('notPositive', { name: 'ṁ' });
  switch (input.device) {
    case 'turbine':
    case 'compressor':
    case 'pump':
      return workDevice(input, fluid);
    case 'nozzle':
    case 'diffuser':
      return flowDevice(input, fluid);
    case 'throttle':
      return throttle(input, fluid);
    case 'exchanger':
      return exchanger(input, fluid);
    default:
      return mixing(input, fluid);
  }
}
