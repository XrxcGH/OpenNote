// The transient conduction tool's form and results: the lumped capacitance method, the exact series solution for a
// wall, cylinder or sphere, and the semi-infinite solid.
import { fail, q, type KitStep } from '../kit/types';
import type { Outcome, ResultRow, ToolSpec, Values } from '../kit/spec';
import type { System } from '../kit/units';
import {
  characteristicLength,
  lumped,
  profile,
  semiInfinite,
  solid,
  type SemiSurface,
  type SolidShape,
} from './engine';

const num = (values: Values, id: string) => values[id] as number;
const opt = (values: Values, id: string) => (Number.isFinite(num(values, id)) ? num(values, id) : undefined);
const steps = (list: unknown): KitStep[] => list as KitStep[];

type Mode = 'lumped' | 'solid' | 'semi';
const is =
  (...modes: Mode[]) =>
  (v: Values) =>
    modes.includes(v.mode as Mode);

const HANDLERS: Record<Mode, (values: Values, system: System) => Outcome> = {
  lumped: (values) => {
    const lc = characteristicLength(values.shape as SolidShape, num(values, 'size'));
    const time = opt(values, 'time');
    const target = opt(values, 'target');
    if (time === undefined && target === undefined) fail('calc', 'Give a time, a target temperature, or both.');
    const r = lumped({
      characteristicLength: lc,
      k: num(values, 'k'),
      rho: num(values, 'rho'),
      cp: num(values, 'cp'),
      h: num(values, 'h'),
      tInitial: num(values, 'tInitial'),
      tFluid: num(values, 'tFluid'),
      ...(time !== undefined ? { time } : {}),
      ...(target !== undefined ? { target } : {}),
    });
    const rows: ResultRow[] = [];
    if (r.temperature !== undefined)
      rows.push({ id: 'temperature', value: q(r.temperature, 'temperature'), sym: 'T', answer: true });
    if (r.timeToTarget !== undefined)
      rows.push({ id: 'timeToTarget', value: q(r.timeToTarget, 'time'), sym: 't', answer: true });
    rows.push(
      { id: 'biot', value: r.biot, sym: '\\mathrm{Bi}' },
      { id: 'tau', value: q(r.tau, 'time'), sym: '\\tau' },
      { id: 'valid', word: r.valid ? 'valid' : 'invalid' },
      { id: 'lc', value: q(lc, 'length') },
    );
    return { rows, steps: steps(r.steps), notes: ['lumped', ...r.warnings] };
  },
  solid: (values) => {
    const time = opt(values, 'time');
    const target = opt(values, 'target');
    if (time === undefined && target === undefined) fail('calc', 'Give a time, or a target temperature to find it.');
    const input = {
      shape: values.shape as SolidShape,
      size: num(values, 'size'),
      alpha: num(values, 'alpha'),
      k: num(values, 'k'),
      h: num(values, 'h'),
      tInitial: num(values, 'tInitial'),
      tFluid: num(values, 'tFluid'),
      xStar: num(values, 'position'),
      ...(target !== undefined ? { target } : { time }),
    };
    const r = solid(input);
    const at = r.timeToTarget ?? time!;
    const prof = profile(input, at);
    return {
      rows: [
        { id: 'temperature', value: q(r.temperature, 'temperature'), sym: 'T', answer: true },
        ...(r.timeToTarget === undefined
          ? []
          : [{ id: 'timeToTarget', value: q(r.timeToTarget, 'time'), sym: 't', answer: true }]),
        { id: 'center', value: q(r.center, 'temperature') },
        { id: 'surface', value: q(r.surface, 'temperature') },
        { id: 'heatFraction', value: q(r.heatFraction, 'percent') },
        { id: 'biot', value: r.biot, sym: '\\mathrm{Bi}' },
        { id: 'fourier', value: r.fourier, sym: '\\mathrm{Fo}' },
      ],
      steps: steps(r.steps),
      notes: ['solid', ...r.series.warnings],
      picture: {
        type: 'plot',
        plot: {
          x: { label: 'position', kind: 'ratio' },
          y: { label: 'temperature', kind: 'temperature' },
          series: [{ id: 'profile', points: prof.x.map((x, i) => [x, prof.temperature[i]] as [number, number]) }],
        },
      },
    };
  },
  semi: (values) => {
    const surface = values.surface as SemiSurface;
    const r = semiInfinite({
      surface,
      alpha: num(values, 'alpha'),
      k: num(values, 'k'),
      tInitial: num(values, 'tInitial'),
      depth: num(values, 'depth'),
      time: num(values, 'time'),
      value: num(values, surface === 'flux' ? 'flux' : surface === 'temperature' ? 'tSurface' : 'tFluidSemi'),
      ...(surface === 'convection' ? { h: num(values, 'h') } : {}),
    });
    return {
      rows: [
        { id: 'temperature', value: q(r.temperature, 'temperature'), sym: 'T', answer: true },
        { id: 'eta', value: r.eta, sym: '\\eta' },
      ],
      steps: steps(r.steps),
      notes: ['semi'],
    };
  },
};

export const transientSpec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: ['lumped', 'solid', 'semi'], first: 'lumped' },
    {
      id: 'shape',
      type: 'choice',
      options: ['sphere', 'cylinder', 'wall'],
      first: 'sphere',
      when: is('lumped', 'solid'),
    },
    { id: 'size', type: 'quantity', kind: 'length', first: '5 mm', when: is('lumped', 'solid') },
    { id: 'k', type: 'quantity', kind: 'conductivity', first: '400 W/(m·K)', when: is('lumped', 'solid', 'semi') },
    { id: 'rho', type: 'quantity', kind: 'density', first: '8933 kg/m^3', when: is('lumped') },
    { id: 'cp', type: 'quantity', kind: 'specificHeat', first: '385 J/(kg·K)', when: is('lumped') },
    { id: 'alpha', type: 'quantity', kind: 'diffusivity', first: '1.1e-4 m^2/s', when: is('solid', 'semi') },
    {
      id: 'h',
      type: 'quantity',
      kind: 'htc',
      first: '100 W/(m²·K)',
      when: (v) => v.mode !== 'semi' || v.surface === 'convection',
    },
    { id: 'tInitial', type: 'quantity', kind: 'temperature', first: '100 °C', when: is('lumped', 'solid', 'semi') },
    { id: 'tFluid', type: 'quantity', kind: 'temperature', first: '25 °C', when: is('lumped', 'solid') },
    { id: 'position', type: 'quantity', kind: 'ratio', first: '0', when: is('solid') },
    { id: 'time', type: 'quantity', kind: 'time', first: '100 s', optional: true, when: is('lumped', 'solid', 'semi') },
    { id: 'target', type: 'quantity', kind: 'temperature', first: '', optional: true, when: is('lumped', 'solid') },
    {
      id: 'surface',
      type: 'choice',
      options: ['temperature', 'flux', 'convection'],
      first: 'temperature',
      when: is('semi'),
    },
    { id: 'depth', type: 'quantity', kind: 'length', first: '10 mm', when: is('semi') },
    {
      id: 'tSurface',
      type: 'quantity',
      kind: 'temperature',
      first: '300 °C',
      when: (v) => v.mode === 'semi' && v.surface === 'temperature',
    },
    {
      id: 'flux',
      type: 'quantity',
      kind: 'heatFlux',
      first: '10000 W/m²',
      when: (v) => v.mode === 'semi' && v.surface === 'flux',
    },
    {
      id: 'tFluidSemi',
      type: 'quantity',
      kind: 'temperature',
      first: '300 °C',
      when: (v) => v.mode === 'semi' && v.surface === 'convection',
    },
  ],
  examples: [
    {
      id: 'sphere',
      values: {
        mode: 'lumped',
        shape: 'sphere',
        size: '10 mm',
        k: '400 W/(m·K)',
        rho: '8933 kg/m^3',
        cp: '385 J/(kg·K)',
        h: '100 W/(m²·K)',
        tInitial: '100 °C',
        tFluid: '25 °C',
        time: '100 s',
        target: '50 °C',
      },
    },
    {
      id: 'steel',
      values: {
        mode: 'solid',
        shape: 'wall',
        size: '25 mm',
        alpha: '1.2e-5 m^2/s',
        k: '45 W/(m·K)',
        h: '500 W/(m²·K)',
        tInitial: '300 °C',
        tFluid: '30 °C',
        position: '0',
        time: '60 s',
        target: '',
      },
    },
    {
      id: 'ground',
      values: {
        mode: 'semi',
        surface: 'temperature',
        alpha: '5e-7 m^2/s',
        k: '1.5 W/(m·K)',
        tInitial: '10 °C',
        depth: '0.5 m',
        time: '86400 s',
        tSurface: '30 °C',
      },
    },
  ],
  run(values, system): Outcome {
    return HANDLERS[values.mode as Mode](values, system);
  },
};
