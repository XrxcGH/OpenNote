// The fins tool's form and results: a straight or pin fin with each tip condition, an annular fin, and an array of
// fins on a base.
import { fail, q, type KitStep } from '../kit/types';
import type { Outcome, ResultRow, ToolSpec, Values } from '../kit/spec';
import type { System } from '../kit/units';
import {
  annularFin,
  fin,
  finArray,
  finGeometry,
  finProfile,
  type FinInput,
  type FinShape,
  type TipCondition,
} from './engine';

const num = (values: Values, id: string) => values[id] as number;
const opt = (values: Values, id: string) => (Number.isFinite(num(values, id)) ? num(values, id) : undefined);
const steps = (list: unknown): KitStep[] => list as KitStep[];

type Mode = 'fin' | 'annular' | 'array';
const is =
  (...modes: Mode[]) =>
  (v: Values) =>
    modes.includes(v.mode as Mode);

const TIPS: TipCondition[] = ['adiabatic', 'convective', 'corrected', 'infinite', 'temperature'];

const finInput = (values: Values): FinInput => ({
  shape: values.shape as FinShape,
  size: num(values, 'size'),
  ...(values.shape === 'rectangular' ? { width: num(values, 'width') } : {}),
  length: num(values, 'length'),
  k: num(values, 'k'),
  h: num(values, 'h'),
  thetaBase: num(values, 'thetaBase'),
  ...(opt(values, 'thetaTip') !== undefined ? { thetaTip: opt(values, 'thetaTip') } : {}),
});

const HANDLERS: Record<Mode, (values: Values, system: System) => Outcome> = {
  fin: (values) => {
    const input = finInput(values);
    const r = fin(input);
    const geometry = finGeometry(input);
    const tip = values.tip as TipCondition;
    if (tip === 'temperature' && input.thetaTip === undefined)
      fail('calc', 'Give the tip temperature for that condition.');
    const profile = finProfile(input, tip);
    const rows: ResultRow[] = [
      { id: 'heat', value: q(r.q[tip] ?? NaN, 'heat'), sym: 'q_f', answer: true },
      { id: 'efficiency', value: q(r.efficiency, 'percent'), sym: '\\eta_f', answer: true },
      { id: 'effectiveness', value: r.effectiveness[tip] ?? NaN, sym: '\\varepsilon_f' },
      { id: 'm', value: q(r.m, 'wavenumber'), sym: 'm' },
      { id: 'biot', value: r.biot, sym: '\\mathrm{Bi}' },
      { id: 'correctedLength', value: q(geometry.correctedLength, 'span') },
    ];
    for (const one of TIPS)
      if (r.q[one] !== undefined && one !== tip) rows.push({ id: `heat_${one}`, value: q(r.q[one]!, 'heat') });
    return {
      rows,
      steps: steps(r.steps),
      notes: ['fin', ...r.warnings],
      picture: {
        type: 'plot',
        plot: {
          x: { label: 'position', kind: 'span' },
          y: { label: 'ratio', kind: 'ratio' },
          series: [{ id: 'profile', points: profile.x.map((x, i) => [x, profile.ratio[i]] as [number, number]) }],
        },
      },
    };
  },
  annular: (values) => {
    const r = annularFin({
      innerRadius: num(values, 'innerRadius'),
      outerRadius: num(values, 'outerRadius'),
      thickness: num(values, 'thickness'),
      k: num(values, 'k'),
      h: num(values, 'h'),
      thetaBase: num(values, 'thetaBase'),
    });
    return {
      rows: [
        { id: 'heat', value: q(r.q, 'heat'), sym: 'q_f', answer: true },
        { id: 'efficiency', value: q(r.efficiency, 'percent'), sym: '\\eta_f', answer: true },
        { id: 'finArea', value: q(r.finArea, 'area') },
        { id: 'm', value: q(r.m, 'wavenumber'), sym: 'm' },
        { id: 'correctedOuterRadius', value: q(r.correctedOuterRadius, 'length') },
      ],
      steps: steps(r.steps),
      notes: ['annular'],
    };
  },
  array: (values) => {
    const r = finArray({
      count: num(values, 'count'),
      finHeat: num(values, 'finHeat'),
      finEfficiency: num(values, 'finEfficiency'),
      finArea: num(values, 'finArea'),
      finBaseArea: num(values, 'finBaseArea'),
      baseArea: num(values, 'baseArea'),
      h: num(values, 'h'),
      thetaBase: num(values, 'thetaBase'),
    });
    return {
      rows: [
        { id: 'total', value: q(r.total, 'heat'), sym: 'q_t', answer: true },
        { id: 'enhancement', value: r.enhancement, answer: true },
        { id: 'overallEfficiency', value: q(r.overallEfficiency, 'percent'), sym: '\\eta_o' },
        { id: 'unfinned', value: q(r.unfinned, 'heat') },
        { id: 'unfinnedArea', value: q(r.unfinnedArea, 'area') },
        { id: 'bare', value: q(r.bare, 'heat') },
      ],
      steps: steps(r.steps),
      notes: ['array'],
    };
  },
};

export const finsSpec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: ['fin', 'annular', 'array'], first: 'fin' },
    { id: 'shape', type: 'choice', options: ['pin', 'rectangular'], first: 'pin', when: is('fin') },
    { id: 'size', type: 'quantity', kind: 'length', first: '5 mm', when: is('fin') },
    {
      id: 'width',
      type: 'quantity',
      kind: 'length',
      first: '50 mm',
      when: (v) => v.mode === 'fin' && v.shape === 'rectangular',
    },
    { id: 'length', type: 'quantity', kind: 'length', first: '50 mm', when: is('fin') },
    { id: 'tip', type: 'choice', options: TIPS, first: 'convective', when: is('fin') },
    {
      id: 'thetaTip',
      type: 'quantity',
      kind: 'tempChange',
      first: '',
      optional: true,
      when: (v) => v.mode === 'fin' && v.tip === 'temperature',
    },
    { id: 'innerRadius', type: 'quantity', kind: 'length', first: '25 mm', when: is('annular') },
    { id: 'outerRadius', type: 'quantity', kind: 'length', first: '50 mm', when: is('annular') },
    { id: 'thickness', type: 'quantity', kind: 'length', first: '3 mm', when: is('annular') },
    { id: 'k', type: 'quantity', kind: 'conductivity', first: '200 W/(m·K)', when: is('fin', 'annular') },
    { id: 'h', type: 'quantity', kind: 'htc', first: '50 W/(m²·K)', when: is('fin', 'annular', 'array') },
    { id: 'thetaBase', type: 'quantity', kind: 'tempChange', first: '75 K', when: is('fin', 'annular', 'array') },
    { id: 'count', type: 'quantity', kind: 'count', first: '10', when: is('array') },
    { id: 'finHeat', type: 'quantity', kind: 'heat', first: '8 W', when: is('array') },
    { id: 'finEfficiency', type: 'quantity', kind: 'ratio', first: '0.9', when: is('array') },
    { id: 'finArea', type: 'quantity', kind: 'area', first: '0.0008 m^2', when: is('array') },
    { id: 'finBaseArea', type: 'quantity', kind: 'area', first: '0.00002 m^2', when: is('array') },
    { id: 'baseArea', type: 'quantity', kind: 'area', first: '0.01 m^2', when: is('array') },
  ],
  examples: [
    {
      id: 'pin',
      values: {
        mode: 'fin',
        shape: 'pin',
        size: '5 mm',
        length: '50 mm',
        tip: 'convective',
        k: '200 W/(m·K)',
        h: '50 W/(m²·K)',
        thetaBase: '75 K',
      },
    },
    {
      id: 'plate',
      values: {
        mode: 'fin',
        shape: 'rectangular',
        size: '3 mm',
        width: '100 mm',
        length: '30 mm',
        tip: 'adiabatic',
        k: '200 W/(m·K)',
        h: '25 W/(m²·K)',
        thetaBase: '60 K',
      },
    },
    {
      id: 'ring',
      values: {
        mode: 'annular',
        innerRadius: '25 mm',
        outerRadius: '50 mm',
        thickness: '3 mm',
        k: '200 W/(m·K)',
        h: '50 W/(m²·K)',
        thetaBase: '75 K',
      },
    },
    {
      id: 'array',
      values: {
        mode: 'array',
        count: '10',
        finHeat: '8 W',
        finEfficiency: '0.9',
        finArea: '0.0008 m^2',
        finBaseArea: '0.00002 m^2',
        baseArea: '0.01 m^2',
        h: '50 W/(m²·K)',
        thetaBase: '75 K',
      },
    },
  ],
  run(values, system): Outcome {
    return HANDLERS[values.mode as Mode](values, system);
  },
};
