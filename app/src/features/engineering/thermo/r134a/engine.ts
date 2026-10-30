// The R-134a tool: a refrigerant state from two properties, with the equation-of-state terms, the saturation
// iteration, the lever rule for a mixture, and a p-h diagram with the saturation dome.
import { fmt, tex } from '../common/format';
import {
  ThermoError,
  markAnswer,
  type KitStep,
  type PlotSpec,
  type ResultRow,
  type ThermoResult,
} from '../common/types';
import { R134A_SOURCE, RHO_C, T_C, T_SAT_MAX, saturationP, saturationT } from './eos';
import {
  fromPH,
  fromPS,
  fromPX,
  fromTP,
  fromTX,
  offsets,
  refrigerantDome,
  type Reference,
  type RefrigerantPoint,
} from './refrigerant';

export type RefrigerantPair = 'Tp' | 'ph' | 'ps' | 'Tx' | 'px';

export interface RefrigerantInput {
  pair: RefrigerantPair;
  reference: Reference;
  T?: number;
  p?: number;
  h?: number;
  s?: number;
  x?: number;
}

const C = { SI: '°C' } as const;

export function refrigerantPoint(input: RefrigerantInput): RefrigerantPoint {
  const get = (key: 'T' | 'p' | 'h' | 's' | 'x'): number => {
    const value = input[key];
    if (value === undefined || !Number.isFinite(value)) throw new ThermoError('missing', { name: key });
    return value;
  };
  const ref = input.reference;
  if (input.pair === 'Tp') return fromTP(get('T'), get('p'), ref);
  if (input.pair === 'ph') return fromPH(get('p'), get('h'), ref);
  if (input.pair === 'ps') return fromPS(get('p'), get('s'), ref);
  if (input.pair === 'Tx') return fromTX(get('T'), get('x'), ref);
  return fromPX(get('p'), get('x'), ref);
}

function sideSteps(input: RefrigerantInput, point: RefrigerantPoint): KitStep[] {
  if (point.sat) return [];
  if (input.pair === 'ph' || input.pair === 'ps') {
    const key = input.pair === 'ph' ? 'h' : 's';
    if (point.p > saturationT(T_SAT_MAX).p) return [{ key: 'steam.supercritical', vars: { T: fmt(point.T, 6) } }];
    const sat = saturationP(point.p);
    const off = offsets(input.reference)[key];
    const vars = {
      key,
      value: fmt(point[key], 6),
      f: fmt(sat.liquid[key] + off, 6),
      g: fmt(sat.vapor[key] + off, 6),
      T: fmt(point.T, 6),
    };
    return [{ key: point.phase === 'liquid' ? 'steam.belowF' : 'steam.aboveG', vars }];
  }
  if (point.T > T_SAT_MAX) return [{ key: 'r134a.aboveCritical', vars: { T: fmt(point.T, 6) } }];
  const psat = saturationT(point.T).p;
  return [
    {
      key: point.phase === 'liquid' ? 'r134a.liquidSide' : 'r134a.vaporSide',
      vars: { T: fmt(point.T, 6), p: fmt(point.p, 6), psat: fmt(psat, 6) },
    },
  ];
}

function satSteps(point: RefrigerantPoint, reference: Reference): KitStep[] {
  if (!point.sat || point.x === null) return [];
  const { sat } = point;
  const off = offsets(reference);
  const hf = sat.liquid.h + off.h;
  const hfg = sat.vapor.h - sat.liquid.h;
  const rows: KitStep[] = sat.iterations.slice(0, 3).map((one, i) => ({
    key: 'r134a.iteration',
    vars: { n: String(i + 1), p: fmt(one.p, 6), dg: fmt(one.dg, 3) },
  }));
  return [
    ...rows,
    {
      key: 'r134a.saturation',
      vars: { T: fmt(sat.T, 6), p: fmt(sat.p, 6), rl: fmt(sat.liquid.rho, 5), rv: fmt(sat.vapor.rho, 5) },
      math: 'g_l=g_v,\\;p(\\rho_l,T)=p(\\rho_v,T)',
    },
    {
      key: 'steam.lever',
      vars: { x: fmt(point.x, 5), hf: fmt(hf, 6), hfg: fmt(hfg, 6), h: fmt(point.h, 6) },
      math: `h=h_f+x\\,h_{fg}=${tex(hf, 6)}+${fmt(point.x, 5)}\\times${tex(hfg, 6)}`,
    },
  ];
}

export function refrigerantPlot(
  points: readonly { label: string; p: number; h: number }[],
  reference: Reference,
): PlotSpec {
  const off = offsets(reference).h;
  const dome = refrigerantDome();
  const line = [
    ...dome.map((one) => [one.liquid.h + off, one.p] as const),
    ...[...dome].reverse().map((one) => [one.vapor.h + off, one.p] as const),
  ];
  return {
    title: 'refrigerantPh',
    x: { label: 'h', qty: 'e' },
    y: { label: 'p', qty: 'p', log: true },
    series: [{ name: '', word: 'saturationLine', points: line }],
    marks: points.map((one) => ({ x: one.h, y: one.p, label: one.label })),
  };
}

export function refrigerantRows(point: RefrigerantPoint): ResultRow[] {
  const rows: ResultRow[] = [
    { key: 'phase', symbol: '', value: 0, qty: 'none', word: point.phase },
    { key: 'temperature', symbol: 'T', value: point.T, qty: 'T', unit: C },
    { key: 'pressure', symbol: 'p', value: point.p, qty: 'p' },
    { key: 'v', symbol: 'v', value: point.v, qty: 'v' },
    { key: 'rho', symbol: '\\rho', value: point.rho, qty: 'rho' },
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

export function solveRefrigerant(input: RefrigerantInput): ThermoResult {
  const point = refrigerantPoint(input);
  const steps: KitStep[] = [
    ...sideSteps(input, point),
    {
      key: 'r134a.eos',
      vars: { delta: fmt(point.rho / RHO_C, 6), tau: fmt(T_C / point.T, 6) },
      math: 'p=\\rho RT(1+\\delta\\phi^r_\\delta),\\;h=RT\\left[\\tau(\\phi^\\circ_\\tau+\\phi^r_\\tau)+1+\\delta\\phi^r_\\delta\\right]',
    },
    ...satSteps(point, input.reference),
    {
      key: 'steam.result',
      vars: { v: fmt(point.v, 6), u: fmt(point.u, 6), h: fmt(point.h, 6), s: fmt(point.s, 6) },
    },
  ];
  return {
    rows: markAnswer(refrigerantRows(point), ['v', 'h', 's', 'quality']),
    steps,
    latex:
      `T=${tex(point.T, 6)}\\ \\mathrm{K},\\ p=${tex(point.p, 6)}\\ \\mathrm{kPa}:\\ ` +
      `h=${tex(point.h, 6)}\\ \\mathrm{kJ/kg},\\ s=${tex(point.s, 6)}\\ \\mathrm{kJ/(kg\\,K)}`,
    notes: [
      input.reference === 'iir' ? 'iirReference' : 'ashraeReference',
      ...(point.sat ? (['twoPhaseNoCp'] as const) : []),
    ],
    plots: [refrigerantPlot([{ label: '1', ...point }], input.reference)],
    source: R134A_SOURCE,
    states: [{ label: '1', T: point.T, p: point.p, h: point.h, s: point.s, x: point.x, v: point.v }],
  };
}
