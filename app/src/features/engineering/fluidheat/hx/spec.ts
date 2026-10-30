// The heat exchanger tool's form and results: rating by the effectiveness-NTU method, sizing for a given duty, sizing for a
// given outlet temperature, and the log-mean temperature difference method from four temperatures.
import { fail, q, type KitStep } from '../kit/types';
import type { Outcome, ResultRow, ToolSpec, Values } from '../kit/spec';
import type { System } from '../kit/units';
import { fromTemperatures, profile, rate, size, type HxResult, type HxType } from './engine';

const num = (values: Values, id: string) => values[id] as number;
const opt = (values: Values, id: string) => (Number.isFinite(num(values, id)) ? num(values, id) : undefined);
const steps = (list: unknown): KitStep[] => list as KitStep[];

type Mode = 'rate' | 'size' | 'lmtd';
const is =
  (...modes: Mode[]) =>
  (v: Values) =>
    modes.includes(v.mode as Mode);

const TYPES: HxType[] = ['counter', 'parallel', 'shell', 'crossUnmixed', 'crossCmaxMixed', 'crossCminMixed'];

/** The heat capacity rate of a stream: mass flow times specific heat, or unlimited for a boiling or condensing one. */
function capacity(values: Values, phase: string, flow: string, cp: string): number {
  if (values[phase] === 'change') return Infinity;
  return num(values, flow) * num(values, cp);
}

function common(values: Values) {
  return {
    type: values.type as HxType,
    ch: capacity(values, 'hotPhase', 'mh', 'cph'),
    cc: capacity(values, 'coldPhase', 'mc', 'cpc'),
    thIn: num(values, 'thIn'),
    tcIn: num(values, 'tcIn'),
  };
}

function resultRows(r: HxResult, values: Values): ResultRow[] {
  const rows: ResultRow[] = [
    { id: 'heat', value: q(r.q, 'heat'), sym: 'q', answer: true },
    { id: 'thOut', value: q(r.thOut, 'temperature'), sym: 'T_{h,out}', answer: true },
    { id: 'tcOut', value: q(r.tcOut, 'temperature'), sym: 'T_{c,out}', answer: true },
    { id: 'effectiveness', value: r.eps, sym: '\\varepsilon' },
    { id: 'ntu', value: r.ntu, sym: '\\mathrm{NTU}' },
    { id: 'ua', value: q(r.ua, 'conductance'), sym: 'UA' },
    { id: 'cr', value: r.cr, sym: 'C_r' },
  ];
  if (Number.isFinite(r.lmtd))
    rows.push({ id: 'lmtd', value: q(r.lmtd, 'tempChange') }, { id: 'correction', value: r.f, sym: 'F' });
  const u = opt(values, 'u');
  if (u !== undefined) rows.push({ id: 'area', value: q(r.ua / u, 'area'), sym: 'A', answer: values.mode === 'size' });
  return rows;
}

function pictureFor(r: HxResult, values: Values): Outcome['picture'] {
  const type = values.type as HxType;
  if (type !== 'counter' && type !== 'parallel') return undefined;
  const p = profile({ ...common(values), ua: r.ua });
  return {
    type: 'plot',
    plot: {
      x: { label: 'length', kind: 'ratio' },
      y: { label: 'temperature', kind: 'temperature' },
      series: [
        { id: 'hot', points: p.x.map((x, i) => [x, p.hot[i]] as [number, number]) },
        { id: 'cold', points: p.x.map((x, i) => [x, p.cold[i]] as [number, number]) },
      ],
    },
  };
}

const HANDLERS: Record<Mode, (values: Values, system: System) => Outcome> = {
  rate: (values) => {
    const ua = opt(values, 'ua') ?? (opt(values, 'u') ?? NaN) * (opt(values, 'area') ?? NaN);
    if (!Number.isFinite(ua)) fail('calc', 'Give the conductance UA, or both U and the area.');
    const r = rate({ ...common(values), ua });
    return {
      rows: resultRows(r, values),
      steps: steps(r.steps),
      notes: ['exchanger', 'limits'],
      picture: pictureFor(r, values),
    };
  },
  size: (values) => {
    const r = size({
      ...common(values),
      ...(opt(values, 'duty') !== undefined ? { q: opt(values, 'duty') } : {}),
      ...(opt(values, 'thOut') !== undefined ? { thOut: opt(values, 'thOut') } : {}),
      ...(opt(values, 'tcOut') !== undefined ? { tcOut: opt(values, 'tcOut') } : {}),
    });
    return {
      rows: resultRows(r, values),
      steps: steps(r.steps),
      notes: ['exchanger', 'sizing'],
      picture: pictureFor(r, values),
    };
  },
  lmtd: (values) => {
    const type = values.lmtdType as 'counter' | 'parallel' | 'shell';
    const r = fromTemperatures({
      type,
      thIn: num(values, 'thIn'),
      thOut: num(values, 'thOutL'),
      tcIn: num(values, 'tcIn'),
      tcOut: num(values, 'tcOutL'),
      q: num(values, 'dutyL'),
    });
    const u = opt(values, 'u');
    return {
      rows: [
        { id: 'ua', value: q(r.ua, 'conductance'), sym: 'UA', answer: true },
        { id: 'lmtd', value: q(r.lmtd, 'tempChange') },
        { id: 'correction', value: r.f, sym: 'F' },
        { id: 'p', value: r.p, sym: 'P' },
        { id: 'r', value: r.r, sym: 'R' },
        ...(u === undefined ? [] : [{ id: 'area', value: q(r.ua / u, 'area'), sym: 'A', answer: true }]),
      ],
      steps: steps(r.steps),
      notes: ['lmtdMethod'],
    };
  },
};

export const hxSpec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: ['rate', 'size', 'lmtd'], first: 'rate' },
    { id: 'type', type: 'choice', options: TYPES, first: 'counter', when: is('rate', 'size') },
    { id: 'lmtdType', type: 'choice', options: ['counter', 'parallel', 'shell'], first: 'counter', when: is('lmtd') },
    { id: 'hotPhase', type: 'choice', options: ['liquid', 'change'], first: 'liquid', when: is('rate', 'size') },
    {
      id: 'mh',
      type: 'quantity',
      kind: 'massFlow',
      first: '0.5 kg/s',
      when: (v) => is('rate', 'size')(v) && v.hotPhase !== 'change',
    },
    {
      id: 'cph',
      type: 'quantity',
      kind: 'specificHeat',
      first: '4.18 kJ/(kg·K)',
      when: (v) => is('rate', 'size')(v) && v.hotPhase !== 'change',
    },
    { id: 'coldPhase', type: 'choice', options: ['liquid', 'change'], first: 'liquid', when: is('rate', 'size') },
    {
      id: 'mc',
      type: 'quantity',
      kind: 'massFlow',
      first: '1.0 kg/s',
      when: (v) => is('rate', 'size')(v) && v.coldPhase !== 'change',
    },
    {
      id: 'cpc',
      type: 'quantity',
      kind: 'specificHeat',
      first: '4.18 kJ/(kg·K)',
      when: (v) => is('rate', 'size')(v) && v.coldPhase !== 'change',
    },
    { id: 'thIn', type: 'quantity', kind: 'temperature', first: '150 °C', when: is('rate', 'size', 'lmtd') },
    { id: 'tcIn', type: 'quantity', kind: 'temperature', first: '30 °C', when: is('rate', 'size', 'lmtd') },
    { id: 'ua', type: 'quantity', kind: 'conductance', first: '2 kW/K', optional: true, when: is('rate') },
    { id: 'area', type: 'quantity', kind: 'area', first: '', optional: true, when: is('rate') },
    { id: 'u', type: 'quantity', kind: 'htc', first: '', optional: true, when: is('rate', 'size', 'lmtd') },
    { id: 'duty', type: 'quantity', kind: 'heat', first: '', optional: true, when: is('size') },
    { id: 'thOut', type: 'quantity', kind: 'temperature', first: '90 °C', optional: true, when: is('size') },
    { id: 'tcOut', type: 'quantity', kind: 'temperature', first: '', optional: true, when: is('size') },
    { id: 'thOutL', type: 'quantity', kind: 'temperature', first: '90 °C', when: is('lmtd') },
    { id: 'tcOutL', type: 'quantity', kind: 'temperature', first: '70 °C', when: is('lmtd') },
    { id: 'dutyL', type: 'quantity', kind: 'heat', first: '100 kW', when: is('lmtd') },
  ],
  examples: [
    {
      id: 'rate',
      values: {
        mode: 'rate',
        type: 'counter',
        hotPhase: 'liquid',
        coldPhase: 'liquid',
        mh: '0.5 kg/s',
        cph: '4.18 kJ/(kg·K)',
        mc: '1.0 kg/s',
        cpc: '4.18 kJ/(kg·K)',
        thIn: '150 °C',
        tcIn: '30 °C',
        ua: '2 kW/K',
        area: '',
        u: '',
      },
    },
    {
      id: 'shell',
      values: {
        mode: 'rate',
        type: 'shell',
        hotPhase: 'liquid',
        coldPhase: 'liquid',
        mh: '0.5 kg/s',
        cph: '4.18 kJ/(kg·K)',
        mc: '1.0 kg/s',
        cpc: '4.18 kJ/(kg·K)',
        thIn: '150 °C',
        tcIn: '30 °C',
        ua: '2 kW/K',
      },
    },
    {
      id: 'size',
      values: {
        mode: 'size',
        type: 'counter',
        hotPhase: 'liquid',
        coldPhase: 'liquid',
        mh: '0.5 kg/s',
        cph: '4.18 kJ/(kg·K)',
        mc: '1.0 kg/s',
        cpc: '4.18 kJ/(kg·K)',
        thIn: '150 °C',
        tcIn: '30 °C',
        thOut: '90 °C',
        tcOut: '',
        duty: '',
        u: '500 W/(m²·K)',
      },
    },
    {
      id: 'condenser',
      values: {
        mode: 'size',
        type: 'counter',
        hotPhase: 'change',
        coldPhase: 'liquid',
        mc: '1.0 kg/s',
        cpc: '4.18 kJ/(kg·K)',
        thIn: '120 °C',
        tcIn: '20 °C',
        thOut: '',
        tcOut: '60 °C',
        duty: '',
        u: '1500 W/(m²·K)',
      },
    },
    {
      id: 'lmtd',
      values: {
        mode: 'lmtd',
        lmtdType: 'shell',
        thIn: '150 °C',
        thOutL: '90 °C',
        tcIn: '30 °C',
        tcOutL: '70 °C',
        dutyL: '100 kW',
        u: '',
      },
    },
  ],
  run(values, system): Outcome {
    return HANDLERS[values.mode as Mode](values, system);
  },
};
