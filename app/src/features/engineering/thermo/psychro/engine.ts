// The psychrometrics tool: a moist-air state from any two common properties, and the air-conditioning processes
// of a course: sensible heating or cooling, cooling with dehumidification, evaporative cooling, and adiabatic
// mixing. Balances are per kg of dry air; a dry-air flow turns them into kW and kg/s. The chart is computed from
// the same formulas, never copied.
import { fmt, tex } from '../common/format';
import { linspace } from '../common/num';
import {
  ThermoError,
  markAnswer,
  positive,
  type KitStep,
  type PlotSeries,
  type PlotSpec,
  type ResultRow,
  type ThermoResult,
} from '../common/types';
import {
  PSYCHRO_SOURCE,
  moist,
  moistFromPhi,
  omegaFromWetBulb,
  omegaOf,
  pws,
  pwsSource,
  solveDryBulb,
  tFromH,
  type MoistState,
} from './moist';

const C = { SI: '°C' } as const;
const K = 273.15;

export type Known = 'tPhi' | 'tTwb' | 'tOmega' | 'tTdp' | 'tH' | 'twbPhi' | 'tdpPhi' | 'hPhi' | 'hOmega';

export interface StateInput {
  known: Known;
  p: number;
  /** Values in °C, fractions (φ), kg/kg (ω), and kJ/kg dry air (h). */
  t?: number;
  phi?: number;
  twb?: number;
  omega?: number;
  tdp?: number;
  h?: number;
}

const need = (value: number | undefined, name: string): number => {
  if (value === undefined || !Number.isFinite(value)) throw new ThermoError('missing', { name });
  return value;
};

/** The state from the pair the student knows. */
export function stateFrom(input: StateInput): MoistState {
  const p = positive(input.p, 'p');
  const t = () => need(input.t, 'T');
  const phi = () => need(input.phi, 'φ');
  const known = input.known;
  if (known === 'tPhi') return moistFromPhi(t(), phi(), p);
  if (known === 'tOmega') return moist(t(), need(input.omega, 'ω'), p);
  if (known === 'tTwb') {
    const twb = need(input.twb, 'T_wb');
    if (twb > t()) throw new ThermoError('psychroWetBulb');
    return moist(t(), omegaFromWetBulb(t(), twb, p), p);
  }
  if (known === 'tTdp') {
    const tdp = need(input.tdp, 'T_dp');
    if (tdp > t()) throw new ThermoError('psychroDewPoint');
    return moist(t(), omegaOf(pws(tdp), p), p);
  }
  if (known === 'tH') {
    const omega = (need(input.h, 'h') - 1.006 * t()) / (2501 + 1.86 * t());
    if (omega < 0) throw new ThermoError('psychroOmega');
    return moist(t(), omega, p);
  }
  if (known === 'hOmega') {
    const omega = need(input.omega, 'ω');
    return moist(tFromH(need(input.h, 'h'), omega), omega, p);
  }
  if (known === 'tdpPhi') {
    const omega = omegaOf(pws(need(input.tdp, 'T_dp')), p);
    const target = phi();
    if (!(target > 0 && target <= 1)) throw new ThermoError('psychroPhi');
    const pv = (p * omega) / (0.621945 + omega);
    return moist(
      solveDryBulb((tt) => pv / pws(tt) - target, need(input.tdp, 'T_dp'), 199),
      omega,
      p,
    );
  }
  const target = phi();
  if (!(target > 0 && target <= 1)) throw new ThermoError('psychroPhi');
  if (known === 'twbPhi') {
    const twb = need(input.twb, 'T_wb');
    const f = (tt: number) => {
      const omega = omegaFromWetBulb(tt, twb, p);
      return omega <= 0 ? -target : (p * omega) / (0.621945 + omega) / pws(tt) - target;
    };
    const tt = solveDryBulb(f, twb, twb + 80);
    return moist(tt, omegaFromWetBulb(tt, twb, p), p);
  }
  const h = need(input.h, 'h');
  const omegaAt = (tt: number) => (h - 1.006 * tt) / (2501 + 1.86 * tt);
  const f = (tt: number) => {
    const omega = omegaAt(tt);
    return omega <= 0 ? -target : (p * omega) / (0.621945 + omega) / pws(tt) - target;
  };
  const tt = solveDryBulb(f, -59, Math.min(199, h / 1.006));
  return moist(tt, omegaAt(tt), p);
}

function stateRows(state: MoistState, tag?: string): ResultRow[] {
  const rows: ResultRow[] = [
    { key: 'tdb', symbol: 'T', value: state.t + K, qty: 'T', unit: C, tag },
    { key: 'phi', symbol: '\\phi', value: state.phi * 100, qty: 'percent', tag },
    { key: 'omega', symbol: '\\omega', value: state.omega, qty: 'none', tag },
    { key: 'hMoist', symbol: 'h', value: state.h, qty: 'e', tag },
    { key: 'twb', symbol: 'T_{wb}', value: state.twb + K, qty: 'T', unit: C, tag },
    { key: 'tdp', symbol: 'T_{dp}', value: state.tdp + K, qty: 'T', unit: C, tag },
    { key: 'vMoist', symbol: 'v', value: state.v, qty: 'v', tag },
    { key: 'pv', symbol: 'p_v', value: state.pv, qty: 'p', tag },
    { key: 'pws', symbol: 'p_{ws}', value: state.pws, qty: 'p', tag },
  ];
  // Dry air has no dew point.
  return rows.filter((one) => Number.isFinite(one.value));
}

/** The steps that fix one state: pws, pv, ω, h, and the wet bulb and dew point. */
function stateSteps(state: MoistState, label: string): KitStep[] {
  const t = fmt(state.t, 5);
  return [
    {
      key: pwsSource(state.t) === 'ice' ? 'psy.pwsIce' : 'psy.pwsWater',
      vars: { label, t, pws: fmt(state.pws, 5) },
    },
    {
      key: 'psy.omega',
      vars: { pv: fmt(state.pv, 5), phi: fmt(state.phi * 100, 4), omega: fmt(state.omega, 5) },
      math:
        `\\omega=\\frac{0.621945\\,p_v}{p-p_v}=` +
        `\\frac{0.621945\\times${tex(state.pv, 5)}}{${tex(state.p, 6)}-${tex(state.pv, 5)}}=${tex(state.omega, 5)}`,
    },
    {
      key: 'psy.enthalpy',
      vars: { h: fmt(state.h, 5) },
      math: `h=1.006\\,t+\\omega(2501+1.86\\,t)=1.006\\times${t}+${tex(state.omega, 5)}(2501+1.86\\times${t})`,
    },
    {
      key: 'psy.wetDew',
      vars: { twb: fmt(state.twb, 4), tdp: fmt(state.tdp, 4), v: fmt(state.v, 5) },
      math: 'v=\\frac{0.287042\\,T(1+1.607858\\,\\omega)}{p}',
    },
  ];
}

/** A psychrometric chart: lines of constant relative humidity, the states, and the process path. */
export function chart(states: readonly MoistState[], path: boolean): PlotSpec {
  const p = states[0].p;
  const lo = Math.max(-40, Math.floor(Math.min(...states.map((s) => s.t), 0) / 5) * 5 - 5);
  const hi = Math.min(95, Math.ceil(Math.max(...states.map((s) => s.t), 40) / 5) * 5 + 5);
  const top = Math.max(0.03, ...states.map((s) => s.omega * 1.2));
  const ts = linspace(lo, hi, 50);
  const line = (phi: number): PlotSeries => ({
    name: `φ = ${phi * 100} %`,
    inline: true,
    dashed: phi < 1,
    points: ts
      .map((t) => [t + K, phi * pws(t) < p ? omegaOf(phi * pws(t), p) : Infinity] as const)
      .filter(([, omega]) => omega <= top),
  });
  return {
    title: 'psychroChart',
    x: { label: 'T', qty: 'T', unit: C },
    y: { label: 'ω', qty: 'none' },
    series: [
      line(1),
      line(0.8),
      line(0.6),
      line(0.4),
      line(0.2),
      ...(path ? [{ name: '', word: 'path' as const, points: states.map((s) => [s.t + K, s.omega] as const) }] : []),
    ],
    marks: states.map((s, i) => ({ x: s.t + K, y: s.omega, label: String(i + 1) })),
  };
}

const result = (
  rows: ResultRow[],
  steps: KitStep[],
  latex: string,
  states: readonly MoistState[],
  path: boolean,
): ThermoResult => ({
  rows,
  steps,
  latex,
  notes: ['psychroIdeal', 'perDryAir'],
  plots: [chart(states, path)],
  source: PSYCHRO_SOURCE,
});

export function solveState(input: StateInput): ThermoResult {
  const state = stateFrom(input);
  return result(
    markAnswer(stateRows(state), ['omega', 'hMoist', 'twb']),
    stateSteps(state, '1'),
    `\\omega=${tex(state.omega, 5)},\\ h=${tex(state.h, 5)}\\ \\mathrm{kJ/kg_{da}},\\ \\phi=${fmt(state.phi * 100, 4)}\\,\\%`,
    [state],
    false,
  );
}

export interface ProcessInput {
  process: 'sensible' | 'dehumidify' | 'evaporative' | 'mixing';
  p: number;
  t1: number;
  phi1: number;
  /** Exit or second-stream temperature, °C. */
  t2?: number;
  /** Exit or second-stream relative humidity, 0 to 1. */
  phi2?: number;
  /** Dry-air flows, kg/s; m1 also scales heat and water to kW and kg/s. */
  m1?: number;
  m2?: number;
}

/** Heat and water per second for a dry-air flow, when one is given. */
function flowRows(m: number | undefined, q: number | null, water: number | null): ResultRow[] {
  if (m === undefined || !(m > 0)) return [];
  const rows: ResultRow[] = [];
  if (q !== null) rows.push({ key: 'qRate', symbol: '\\dot Q', value: m * q, qty: 'power' });
  if (water !== null) rows.push({ key: 'waterRate', symbol: '\\dot m_w', value: m * water, qty: 'mdot' });
  return rows;
}

export function solveProcess(input: ProcessInput): ThermoResult {
  const p = positive(input.p, 'p');
  const one = moistFromPhi(input.t1, input.phi1, p);
  if (input.process === 'mixing') return mixing(input, one, p);
  if (input.process === 'evaporative') return evaporative(input, one, p);
  const t2 = need(input.t2, 'T₂');
  if (input.process === 'sensible') {
    if (t2 < one.tdp - 1e-9) throw new ThermoError('psychroBelowDew');
    const two = moist(t2, one.omega, p);
    const q = two.h - one.h;
    return result(
      [{ key: 'qMoist', symbol: 'q', value: q, qty: 'e' }, ...flowRows(input.m1, q, null), ...stateRows(two, '2')],
      [...stateSteps(one, '1'), { key: 'psy.sensible', vars: { q: fmt(q, 5), h2: fmt(two.h, 5) }, math: 'q=h_2-h_1' }],
      `q=h_2-h_1=${tex(q, 5)}\\ \\mathrm{kJ/kg_{da}}`,
      [one, two],
      true,
    );
  }
  const phi2 = input.phi2 ?? 1;
  const two = moistFromPhi(t2, phi2, p);
  if (!(two.omega < one.omega)) throw new ThermoError('psychroNoCondense', { tdp: fmt(one.tdp, 4) });
  const water = one.omega - two.omega;
  const hw = 4.186 * t2;
  const q = one.h - two.h - water * hw;
  return result(
    [
      { key: 'waterRemoved', symbol: '\\Delta\\omega', value: water, qty: 'none' },
      { key: 'qRemoved', symbol: 'q_{out}', value: q, qty: 'e' },
      ...flowRows(input.m1, q, water),
      ...stateRows(two, '2'),
    ],
    [
      ...stateSteps(one, '1'),
      ...stateSteps(two, '2'),
      {
        key: 'psy.dehumidify',
        vars: { water: fmt(water, 5), hw: fmt(hw, 4), q: fmt(q, 5) },
        math: `q_{out}=h_1-h_2-(\\omega_1-\\omega_2)h_w=${tex(one.h, 5)}-${tex(two.h, 5)}-${tex(water, 5)}\\times${tex(hw, 4)}`,
      },
    ],
    `q_{out}=${tex(q, 5)}\\ \\mathrm{kJ/kg_{da}},\\ \\Delta\\omega=${tex(water, 5)}`,
    [one, two],
    true,
  );
}

function evaporative(input: ProcessInput, one: MoistState, p: number): ThermoResult {
  const phi2 = need(input.phi2, 'φ₂');
  if (!(phi2 > one.phi && phi2 <= 1)) throw new ThermoError('psychroEvaporative');
  // Along the adiabatic-saturation line the wet bulb stays the same.
  const f = (t: number) => {
    const omega = omegaFromWetBulb(t, one.twb, p);
    return (p * omega) / (0.621945 + omega) / pws(t) - phi2;
  };
  const t2 = solveDryBulb(f, one.twb, one.t);
  const two = moist(t2, omegaFromWetBulb(t2, one.twb, p), p);
  const water = two.omega - one.omega;
  return result(
    [
      { key: 'waterAdded', symbol: '\\Delta\\omega', value: water, qty: 'none' },
      ...flowRows(input.m1, null, water),
      ...stateRows(two, '2'),
    ],
    [
      ...stateSteps(one, '1'),
      { key: 'psy.evaporative', vars: { twb: fmt(one.twb, 4), t2: fmt(t2, 4), water: fmt(water, 5) } },
    ],
    `T_2=${tex(t2, 4)}\\ ^\\circ\\mathrm{C},\\ \\Delta\\omega=${tex(water, 5)}`,
    [one, two],
    true,
  );
}

function mixing(input: ProcessInput, one: MoistState, p: number): ThermoResult {
  const m1 = positive(input.m1, 'ṁ₁');
  const m2 = positive(input.m2, 'ṁ₂');
  const two = moistFromPhi(need(input.t2, 'T₂'), need(input.phi2, 'φ₂'), p);
  const omega = (m1 * one.omega + m2 * two.omega) / (m1 + m2);
  const h = (m1 * one.h + m2 * two.h) / (m1 + m2);
  const three = moist(tFromH(h, omega), omega, p);
  return result(
    stateRows(three, '3'),
    [
      ...stateSteps(one, '1'),
      ...stateSteps(two, '2'),
      {
        key: 'psy.mixing',
        vars: { omega: fmt(omega, 5), h: fmt(h, 5), t: fmt(three.t, 4) },
        math:
          '\\omega_3=\\frac{\\dot m_1\\omega_1+\\dot m_2\\omega_2}{\\dot m_1+\\dot m_2},\\;' +
          'h_3=\\frac{\\dot m_1h_1+\\dot m_2h_2}{\\dot m_1+\\dot m_2}',
      },
    ],
    `\\omega_3=${tex(omega, 5)},\\ h_3=${tex(h, 5)}\\ \\mathrm{kJ/kg_{da}},\\ T_3=${tex(three.t, 4)}\\ ^\\circ\\mathrm{C}`,
    [one, two, three],
    true,
  );
}
