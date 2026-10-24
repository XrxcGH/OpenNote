// The steam tool: a state of water from two properties, with the region test, the dimensionless variables, the
// lever rule for a mixture, and T-s and p-h diagrams with the saturation dome. Pure, like every engine of the kit.
import { fmt, tex } from '../common/format';
import { ThermoError, type KitStep, type PlotSpec, type ResultRow, type ThermoResult } from '../common/types';
import { IF97_SOURCE, P_CRIT, pB23, psat, type WaterState } from './if97';
import { dome, fromPH, fromPS, fromPX, fromTP, fromTX, saturationAtP, type WaterPoint } from './water';

export type SteamPair = 'Tp' | 'ph' | 'ps' | 'Tx' | 'px';

export interface SteamInput {
  pair: SteamPair;
  T?: number;
  p?: number;
  h?: number;
  s?: number;
  x?: number;
}

const C = { SI: '°C' } as const;

/** The state the pair names. */
export function steamPoint(input: SteamInput): WaterPoint {
  const get = (key: 'T' | 'p' | 'h' | 's' | 'x'): number => {
    const value = input[key];
    if (value === undefined || !Number.isFinite(value)) throw new ThermoError('missing', { name: key });
    return value;
  };
  if (input.pair === 'Tp') return fromTP(get('T'), get('p'));
  if (input.pair === 'ph') return fromPH(get('p'), get('h'));
  if (input.pair === 'ps') return fromPS(get('p'), get('s'));
  if (input.pair === 'Tx') return fromTX(get('T'), get('x'));
  return fromPX(get('p'), get('x'));
}

function regionSteps(point: WaterPoint): KitStep[] {
  const T = fmt(point.T, 6);
  const p = fmt(point.p, 6);
  switch (point.test) {
    case 'abovePsat':
    case 'belowPsat':
      return [{ key: `steam.test.${point.test}`, vars: { T, p, psat: fmt(psat(point.T), 6) } }];
    case 'aboveB23':
    case 'belowB23':
      return [{ key: `steam.test.${point.test}`, vars: { T, p, pb: fmt(pB23(point.T), 6) } }];
    case 'aboveRegion2':
      return [{ key: 'steam.test.aboveRegion2', vars: { T } }];
    default:
      return [{ key: 'steam.test.saturated', vars: { T, p } }];
  }
}

/** π and τ (or δ and τ) of the region, and the formulas the properties come from. */
function variableStep(state: Pick<WaterPoint, 'region' | 'T' | 'p' | 'v'>): KitStep {
  const T = state.T;
  if (state.region === 1)
    return {
      key: 'steam.vars1',
      vars: { pi: fmt(state.p / 16530, 6), tau: fmt(1386 / T, 6) },
      math: 'v=\\frac{RT}{p}\\pi\\gamma_\\pi,\\;h=RT\\tau\\gamma_\\tau,\\;s=R(\\tau\\gamma_\\tau-\\gamma)',
    };
  if (state.region === 3)
    return {
      key: 'steam.vars3',
      vars: { delta: fmt(1 / state.v / 322, 6), tau: fmt(647.096 / T, 6), rho: fmt(1 / state.v, 6) },
      math: 'p=\\rho RT\\delta\\phi_\\delta,\\;h=RT(\\tau\\phi_\\tau+\\delta\\phi_\\delta),\\;s=R(\\tau\\phi_\\tau-\\phi)',
    };
  return {
    key: state.region === 5 ? 'steam.vars5' : 'steam.vars2',
    vars: { pi: fmt(state.p / 1000, 6), tau: fmt((state.region === 5 ? 1000 : 540) / T, 6) },
    math: 'v=\\frac{RT}{p}\\pi(\\gamma^\\circ_\\pi+\\gamma^r_\\pi),\\;h=RT\\tau(\\gamma^\\circ_\\tau+\\gamma^r_\\tau)',
  };
}

/** For (p, h) and (p, s): where the value sits against the saturated liquid and vapor. */
function compareStep(input: SteamInput, point: WaterPoint): KitStep[] {
  if (input.pair !== 'ph' && input.pair !== 'ps') return [];
  const key = input.pair === 'ph' ? 'h' : 's';
  const value = fmt(point[key], 6);
  if (point.p >= P_CRIT) return [{ key: 'steam.supercritical', vars: { T: fmt(point.T, 6) } }];
  const { liquid, vapor } = saturationAtP(point.p);
  const vars = { key, value, f: fmt(liquid[key], 6), g: fmt(vapor[key], 6), T: fmt(point.T, 6) };
  if (point.phase === 'liquid') return [{ key: 'steam.belowF', vars }];
  if (point.phase === 'vapor' || point.phase === 'supercritical') return [{ key: 'steam.aboveG', vars }];
  return [{ key: 'steam.between', vars }];
}

function leverStep(point: WaterPoint): KitStep[] {
  if (!point.sat || point.x === null) return [];
  const { liquid, vapor } = point.sat;
  const x = fmt(point.x, 5);
  return [
    {
      key: 'steam.lever',
      vars: { x, hf: fmt(liquid.h, 6), hfg: fmt(vapor.h - liquid.h, 6), h: fmt(point.h, 6) },
      math: `h=h_f+x\\,h_{fg}=${tex(liquid.h, 6)}+${x}\\times${tex(vapor.h - liquid.h, 6)}`,
    },
    {
      key: 'steam.leverS',
      vars: { sf: fmt(liquid.s, 6), sfg: fmt(vapor.s - liquid.s, 6), s: fmt(point.s, 6), v: fmt(point.v, 6) },
      math: 's=s_f+x\\,s_{fg},\\;v=v_f+x\\,v_{fg}',
    },
  ];
}

/** T-s and p-h diagrams with the saturation dome and the state marked. */
export function steamPlots(
  points: readonly { label: string; T: number; p: number; h: number; s: number }[],
): PlotSpec[] {
  const { liquid, vapor } = dome();
  const line = (pick: (one: WaterState) => readonly [number, number]) => [
    ...liquid.map(pick),
    ...[...vapor].reverse().map(pick),
  ];
  return [
    {
      title: 'waterTs',
      x: { label: 's', qty: 's' },
      y: { label: 'T', qty: 'T', unit: C },
      series: [{ name: '', word: 'saturationLine', points: line((one) => [one.s, one.T]) }],
      marks: points.map((one) => ({ x: one.s, y: one.T, label: one.label })),
    },
    {
      title: 'waterPh',
      x: { label: 'h', qty: 'e' },
      y: { label: 'p', qty: 'p', log: true },
      series: [{ name: '', word: 'saturationLine', points: line((one) => [one.h, one.p]) }],
      marks: points.map((one) => ({ x: one.h, y: one.p, label: one.label })),
    },
  ];
}

/** The result rows of a water state, which the devices tool and the cycles tool use too. */
export function waterRows(point: WaterPoint): ResultRow[] {
  const rows: ResultRow[] = [
    { key: 'phase', symbol: '', value: 0, qty: 'none', word: point.phase },
    { key: 'region', symbol: '', value: point.region, qty: 'none' },
    { key: 'temperature', symbol: 'T', value: point.T, qty: 'T', unit: C },
    { key: 'pressure', symbol: 'p', value: point.p, qty: 'p' },
    { key: 'v', symbol: 'v', value: point.v, qty: 'v' },
    { key: 'rho', symbol: '\\rho', value: 1 / point.v, qty: 'rho' },
    { key: 'u', symbol: 'u', value: point.u, qty: 'e' },
    { key: 'h', symbol: 'h', value: point.h, qty: 'e' },
    { key: 's', symbol: 's', value: point.s, qty: 's' },
  ];
  if (point.x !== null) rows.push({ key: 'quality', symbol: 'x', value: point.x, qty: 'none' });
  if (point.cp !== null) rows.push({ key: 'cp', symbol: 'c_p', value: point.cp, qty: 's' });
  if (point.cv !== null) rows.push({ key: 'cv', symbol: 'c_v', value: point.cv, qty: 's' });
  if (point.w !== null) rows.push({ key: 'soundSpeed', symbol: 'w', value: point.w, qty: 'speed' });
  return rows;
}

export function solveSteam(input: SteamInput): ThermoResult {
  const point = steamPoint(input);
  const steps: KitStep[] = [
    ...compareStep(input, point),
    ...regionSteps(point),
    ...(point.region === 4 ? [] : [variableStep(point)]),
    ...leverStep(point),
    {
      key: 'steam.result',
      vars: { v: fmt(point.v, 6), u: fmt(point.u, 6), h: fmt(point.h, 6), s: fmt(point.s, 6) },
    },
  ];
  return {
    rows: waterRows(point),
    steps,
    latex:
      `T=${tex(point.T, 6)}\\ \\mathrm{K},\\ p=${tex(point.p, 6)}\\ \\mathrm{kPa}:\\ ` +
      `h=${tex(point.h, 6)}\\ \\mathrm{kJ/kg},\\ s=${tex(point.s, 6)}\\ \\mathrm{kJ/(kg\\,K)}`,
    notes: ['if97Reference', ...(point.sat ? (['twoPhaseNoCp'] as const) : [])],
    plots: steamPlots([{ label: '1', ...point }]),
    source: IF97_SOURCE,
    states: [{ label: '1', T: point.T, p: point.p, h: point.h, s: point.s, x: point.x, v: point.v }],
  };
}
