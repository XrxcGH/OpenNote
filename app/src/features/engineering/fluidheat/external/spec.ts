// The external flow tool's form and results: the boundary layer and drag on a flat plate, the terminal speed of a
// sphere, and the drag on a body from its drag coefficient.
import { q, type KitStep } from '../kit/types';
import type { Outcome, ToolSpec, Values } from '../kit/spec';
import { blasius, bodyDrag, flatPlate, terminalVelocity, type SphereModel } from './engine';

const num = (values: Values, id: string) => values[id] as number;
const opt = (values: Values, id: string) => (Number.isFinite(num(values, id)) ? num(values, id) : undefined);
const steps = (list: unknown): KitStep[] => list as KitStep[];
const is = (mode: string) => (v: Values) => v.mode === mode;

const HANDLERS: Record<'plate' | 'sphere' | 'body', (values: Values) => Outcome> = {
  plate: (values) => {
    const r = flatPlate({
      speed: num(values, 'speed'),
      length: num(values, 'plateLength'),
      nu: num(values, 'nu'),
      ...(opt(values, 'plateWidth') !== undefined ? { width: opt(values, 'plateWidth') } : {}),
      ...(opt(values, 'plateDensity') !== undefined ? { density: opt(values, 'plateDensity') } : {}),
      ...(opt(values, 'transitionRe') !== undefined ? { transitionRe: opt(values, 'transitionRe') } : {}),
      tripped: values.tripped === 'yes',
    });
    const profile = blasius();
    return {
      rows: [
        { id: 'reL', value: r.reL, sym: '\\mathrm{Re}_L' },
        { id: 'regime', word: r.regime },
        { id: 'cfAverage', value: r.cfAverage, sym: 'C_f', answer: true },
        { id: 'delta', value: q(r.delta, 'length'), sym: '\\delta' },
        { id: 'displacement', value: q(r.displacement, 'length') },
        { id: 'momentum', value: q(r.momentum, 'length') },
        { id: 'cfLocal', value: r.cfLocal },
        ...(r.drag === undefined ? [] : [{ id: 'drag', value: q(r.drag, 'force'), sym: 'D', answer: true }]),
        ...(r.wallShear === undefined ? [] : [{ id: 'wallShear', value: q(r.wallShear, 'smallPressure') }]),
        ...(r.transitionAt === undefined ? [] : [{ id: 'transitionAt', value: q(r.transitionAt, 'span') }]),
      ],
      steps: steps(r.steps),
      notes: ['plate', ...r.warnings],
      picture: {
        type: 'plot',
        plot: {
          x: { label: 'ratio', kind: 'ratio' },
          y: { label: 'height', kind: 'ratio' },
          series: [{ id: 'blasius', points: profile.eta.map((e, i) => [profile.uOverU[i], e] as [number, number]) }],
        },
      },
    };
  },
  sphere: (values) => {
    const r = terminalVelocity({
      diameter: num(values, 'diameter'),
      sphereDensity: num(values, 'sphereDensity'),
      fluidDensity: num(values, 'fluidDensity'),
      viscosity: num(values, 'viscosity'),
      model: values.model as SphereModel,
      ...(values.model === 'fixed' ? { fixedCd: num(values, 'fixedCd') } : {}),
    });
    return {
      rows: [
        { id: 'velocity', value: q(r.velocity, 'speed'), sym: 'v_t', answer: true },
        { id: 'direction', word: r.rises ? 'rises' : 'sinks' },
        { id: 're', value: r.re, sym: '\\mathrm{Re}' },
        { id: 'cd', value: r.cd, sym: 'C_D' },
        { id: 'drag', value: q(r.drag, 'force') },
      ],
      steps: steps(r.steps),
      notes: ['sphere', ...r.warnings],
    };
  },
  body: (values) => {
    const r = bodyDrag({
      cd: num(values, 'cd'),
      density: num(values, 'density'),
      speed: num(values, 'speed'),
      area: num(values, 'area'),
    });
    return {
      rows: [
        { id: 'drag', value: q(r.drag, 'force'), sym: 'F_D', answer: true },
        { id: 'power', value: q(r.power, 'power'), sym: 'P' },
      ],
      steps: steps(r.steps),
      notes: ['body'],
    };
  },
};

export const externalSpec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: ['plate', 'sphere', 'body'], first: 'plate' },
    {
      id: 'speed',
      type: 'quantity',
      kind: 'speed',
      first: '5 m/s',
      when: (v) => v.mode === 'plate' || v.mode === 'body',
    },
    { id: 'plateLength', type: 'quantity', kind: 'span', first: '2 m', when: is('plate') },
    { id: 'plateWidth', type: 'quantity', kind: 'span', first: '1 m', optional: true, when: is('plate') },
    { id: 'nu', type: 'quantity', kind: 'kinematic', first: '15 mm^2/s', when: is('plate') },
    { id: 'plateDensity', type: 'quantity', kind: 'density', first: '1.2 kg/m^3', optional: true, when: is('plate') },
    { id: 'transitionRe', type: 'quantity', kind: 'ratio', first: '', optional: true, when: is('plate') },
    { id: 'tripped', type: 'choice', options: ['no', 'yes'], first: 'no', when: is('plate') },
    { id: 'diameter', type: 'quantity', kind: 'length', first: '5 mm', when: is('sphere') },
    { id: 'sphereDensity', type: 'quantity', kind: 'density', first: '7800 kg/m^3', when: is('sphere') },
    { id: 'fluidDensity', type: 'quantity', kind: 'density', first: '998 kg/m^3', when: is('sphere') },
    { id: 'viscosity', type: 'quantity', kind: 'viscosity', first: '1.0 mPa·s', when: is('sphere') },
    {
      id: 'model',
      type: 'choice',
      options: ['schillerNaumann', 'stokes', 'fixed'],
      first: 'schillerNaumann',
      when: is('sphere'),
    },
    {
      id: 'fixedCd',
      type: 'quantity',
      kind: 'ratio',
      first: '0.44',
      when: (v) => v.mode === 'sphere' && v.model === 'fixed',
    },
    { id: 'cd', type: 'quantity', kind: 'ratio', first: '0.3', when: is('body') },
    { id: 'density', type: 'quantity', kind: 'density', first: '1.2 kg/m^3', when: is('body') },
    { id: 'area', type: 'quantity', kind: 'area', first: '2.2 m^2', when: is('body') },
  ],
  examples: [
    {
      id: 'plate',
      values: { mode: 'plate', speed: '5 m/s', plateLength: '2 m', nu: '15 mm^2/s', plateDensity: '1.2 kg/m^3' },
    },
    {
      id: 'fast',
      values: { mode: 'plate', speed: '40 m/s', plateLength: '3 m', nu: '15 mm^2/s', plateDensity: '1.2 kg/m^3' },
    },
    {
      id: 'ball',
      values: {
        mode: 'sphere',
        diameter: '5 mm',
        sphereDensity: '7800 kg/m^3',
        fluidDensity: '998 kg/m^3',
        viscosity: '1.0 mPa·s',
        model: 'schillerNaumann',
      },
    },
    { id: 'car', values: { mode: 'body', cd: '0.3', speed: '30 m/s', density: '1.2 kg/m^3', area: '2.2 m^2' } },
  ],
  run(values): Outcome {
    return HANDLERS[values.mode as 'plate' | 'sphere' | 'body'](values);
  },
};
