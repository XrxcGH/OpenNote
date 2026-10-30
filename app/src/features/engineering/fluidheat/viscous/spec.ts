// The viscous and biological flow tool's form and results: laminar flow between plates, in pipes and annuli,
// non-Newtonian pipe flow, pulsatile flow in an artery, and branching vessels.
import { q, type KitStep } from '../kit/types';
import type { Outcome, ResultRow, ToolSpec, Values } from '../kit/spec';
import {
  annulus,
  bingham,
  casson,
  couette,
  murrayAsymmetric,
  murraySymmetric,
  poiseuille,
  powerLaw,
  womersley,
  type PipeFlowResult,
} from './engine';

const num = (values: Values, id: string) => values[id] as number;
const opt = (values: Values, id: string) => (Number.isFinite(num(values, id)) ? num(values, id) : undefined);
const steps = (list: unknown): KitStep[] => list as KitStep[];

const MODES = ['couette', 'poiseuille', 'annulus', 'powerLaw', 'bingham', 'casson', 'womersley', 'murray'] as const;
type Mode = (typeof MODES)[number];
const is =
  (...modes: Mode[]) =>
  (v: Values) =>
    modes.includes(v.mode as Mode);

const pipeRows = (r: PipeFlowResult): ResultRow[] => [
  { id: 'flow', value: q(r.q, 'flow'), sym: 'Q', answer: true },
  { id: 'meanSpeed', value: q(r.meanSpeed, 'speed'), sym: '\\bar{u}' },
  { id: 'maxSpeed', value: q(r.maxSpeed, 'speed'), sym: 'u_{max}' },
  { id: 'wallShear', value: q(r.wallShear, 'smallPressure'), sym: '\\tau_w' },
  { id: 'wallShearRate', value: q(r.wallShearRate, 'rate') },
];

const HANDLERS: Record<Mode, (values: Values) => Outcome> = {
  couette: (values) => {
    const r = couette({
      gap: num(values, 'gap'),
      wallSpeed: num(values, 'wallSpeed'),
      dpdx: num(values, 'dpdx'),
      viscosity: num(values, 'viscosity'),
    });
    return {
      rows: [
        { id: 'flowPerWidth', value: q(r.flowPerWidth, 'kinematic'), sym: 'q', answer: true },
        { id: 'lowerWallShear', value: q(r.lowerWallShear, 'smallPressure') },
        { id: 'upperWallShear', value: q(r.upperWallShear, 'smallPressure') },
      ],
      steps: steps(r.steps),
      notes: ['laminar', 'incompressible'],
      picture: {
        type: 'plot',
        plot: {
          x: { label: 'speed', kind: 'speed' },
          y: { label: 'height', kind: 'length' },
          series: [{ id: 'profile', points: r.y.map((y, i) => [r.u[i], y] as [number, number]) }],
        },
      },
    };
  },
  poiseuille: (values) => {
    const r = poiseuille({
      radius: num(values, 'radius'),
      length: num(values, 'length'),
      dp: num(values, 'dp'),
      viscosity: num(values, 'viscosity'),
    });
    return {
      rows: pipeRows(r),
      steps: steps(r.steps),
      notes: ['laminar', 'incompressible'],
      picture: profilePicture(r.r, r.u),
    };
  },
  annulus: (values) => {
    const r = annulus({
      inner: num(values, 'inner'),
      outer: num(values, 'outer'),
      length: num(values, 'length'),
      dp: num(values, 'dp'),
      viscosity: num(values, 'viscosity'),
    });
    return {
      rows: [
        { id: 'flow', value: q(r.q, 'flow'), sym: 'Q', answer: true },
        { id: 'maxSpeed', value: q(r.velocityMax, 'speed'), sym: 'u_{max}' },
        { id: 'rMax', value: q(r.rMax, 'length') },
      ],
      steps: steps(r.steps),
      notes: ['laminar'],
    };
  },
  powerLaw: (values) => {
    const r = powerLaw({
      radius: num(values, 'radius'),
      length: num(values, 'length'),
      dp: num(values, 'dp'),
      k: num(values, 'k'),
      n: num(values, 'n'),
    });
    return {
      rows: [...pipeRows(r), { id: 'apparentViscosity', value: q(r.apparentViscosityAtWall, 'viscosity') }],
      steps: steps(r.steps),
      notes: ['laminar', 'powerLaw'],
      picture: profilePicture(r.r, r.u),
    };
  },
  bingham: (values) => {
    const mode = values.mode as Mode;
    const input = {
      radius: num(values, 'radius'),
      length: num(values, 'length'),
      dp: num(values, 'dp'),
      viscosity: num(values, 'viscosity'),
      yieldStress: num(values, 'yieldStress'),
    };
    const r = mode === 'bingham' ? bingham(input) : casson(input);
    return {
      rows: [
        ...pipeRows(r),
        { id: 'plugRadius', value: q(r.plugRadius, 'length') },
        { id: 'flowing', word: r.flows ? 'yes' : 'no' },
      ],
      steps: steps(r.steps),
      notes: ['laminar', mode],
      picture: profilePicture(r.r, r.u),
    };
  },
  casson: (values) => HANDLERS.bingham(values),
  womersley: (values) => {
    const r = womersley({
      radius: num(values, 'radius'),
      frequency: num(values, 'frequency'),
      nu: num(values, 'nu'),
      density: num(values, 'density'),
      amplitude: num(values, 'amplitude'),
    });
    return {
      rows: [
        { id: 'alpha', value: r.alpha, sym: '\\alpha', answer: true },
        { id: 'centerlineAmplitude', value: q(r.centerlineAmplitude, 'speed') },
        { id: 'centerlineLag', value: q(r.centerlineLag, 'angle') },
        { id: 'flowAmplitude', value: q(r.flowAmplitude, 'flow') },
        { id: 'flowPhase', value: q(r.flowPhase, 'angle') },
        { id: 'wallShearAmplitude', value: q(r.wallShearAmplitude, 'smallPressure') },
        { id: 'wallShearPhase', value: q(r.wallShearPhase, 'angle') },
        { id: 'quasiSteady', value: q(r.quasiSteadyCenterline, 'speed') },
      ],
      steps: steps(r.steps),
      notes: ['womersley'],
      picture: {
        type: 'plot',
        plot: {
          x: { label: 'radius', kind: 'length' },
          y: { label: 'speed', kind: 'speed' },
          series: r.profiles.map((p, i) => ({
            id: `phase${i}`,
            points: r.r.map((x, k) => [x, p.u[k]] as [number, number]),
          })),
        },
      },
    };
  },
  murray: (values) => {
    const radius = num(values, 'radius');
    const first = opt(values, 'firstChild');
    if (first !== undefined) {
      const second = murrayAsymmetric(radius, first);
      return {
        rows: [{ id: 'secondChild', value: q(second, 'length'), sym: 'r_2', answer: true }],
        steps: [{ key: 'fhViscMurrayAsym', vars: { r: String(second) } }] as KitStep[],
        notes: ['murray'],
      };
    }
    const r = murraySymmetric(radius, num(values, 'children'));
    return {
      rows: [
        { id: 'childRadius', value: q(r.childRadius, 'length'), sym: 'r_c', answer: true },
        { id: 'ratio', value: r.ratio },
      ],
      steps: steps(r.steps),
      notes: ['murray'],
    };
  },
};

export const viscousSpec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: [...MODES], first: 'poiseuille' },
    { id: 'gap', type: 'quantity', kind: 'length', first: '2 mm', when: is('couette') },
    { id: 'wallSpeed', type: 'quantity', kind: 'speed', first: '0.5 m/s', when: is('couette') },
    { id: 'dpdx', type: 'quantity', kind: 'pressureGradient', first: '0', when: is('couette') },
    {
      id: 'viscosity',
      type: 'quantity',
      kind: 'viscosity',
      first: '3.5 mPa·s',
      when: is('couette', 'poiseuille', 'annulus', 'bingham', 'casson'),
    },
    {
      id: 'radius',
      type: 'quantity',
      kind: 'length',
      first: '2 mm',
      when: is('poiseuille', 'powerLaw', 'bingham', 'casson', 'womersley', 'murray'),
    },
    { id: 'inner', type: 'quantity', kind: 'length', first: '1 mm', when: is('annulus') },
    { id: 'outer', type: 'quantity', kind: 'length', first: '3 mm', when: is('annulus') },
    {
      id: 'length',
      type: 'quantity',
      kind: 'span',
      first: '0.5 m',
      when: is('poiseuille', 'annulus', 'powerLaw', 'bingham', 'casson'),
    },
    {
      id: 'dp',
      type: 'quantity',
      kind: 'smallPressure',
      first: '500 Pa',
      when: is('poiseuille', 'annulus', 'powerLaw', 'bingham', 'casson'),
    },
    { id: 'k', type: 'quantity', kind: 'ratio', first: '0.05', when: is('powerLaw') },
    { id: 'n', type: 'quantity', kind: 'ratio', first: '0.7', when: is('powerLaw') },
    { id: 'yieldStress', type: 'quantity', kind: 'smallPressure', first: '0.5 Pa', when: is('bingham', 'casson') },
    { id: 'frequency', type: 'quantity', kind: 'frequency', first: '1.2 Hz', when: is('womersley') },
    { id: 'nu', type: 'quantity', kind: 'kinematic', first: '3.3 mm^2/s', when: is('womersley') },
    { id: 'density', type: 'quantity', kind: 'density', first: '1060 kg/m^3', when: is('womersley') },
    { id: 'amplitude', type: 'quantity', kind: 'pressureGradient', first: '100 Pa/m', when: is('womersley') },
    { id: 'children', type: 'quantity', kind: 'count', first: '2', when: is('murray') },
    { id: 'firstChild', type: 'quantity', kind: 'length', first: '', optional: true, when: is('murray') },
  ],
  examples: [
    {
      id: 'artery',
      values: { mode: 'poiseuille', radius: '2 mm', length: '0.5 m', dp: '500 Pa', viscosity: '3.5 mPa·s' },
    },
    { id: 'plates', values: { mode: 'couette', gap: '2 mm', wallSpeed: '0.5 m/s', dpdx: '0', viscosity: '100 mPa·s' } },
    {
      id: 'annulus',
      values: { mode: 'annulus', inner: '1 mm', outer: '3 mm', length: '0.5 m', dp: '500 Pa', viscosity: '3.5 mPa·s' },
    },
    { id: 'polymer', values: { mode: 'powerLaw', radius: '5 mm', length: '1 m', dp: '5 kPa', k: '0.5', n: '0.6' } },
    {
      id: 'paste',
      values: {
        mode: 'bingham',
        radius: '5 mm',
        length: '1 m',
        dp: '10 kPa',
        yieldStress: '20 Pa',
        viscosity: '50 mPa·s',
      },
    },
    {
      id: 'blood',
      values: {
        mode: 'casson',
        radius: '2 mm',
        length: '0.5 m',
        dp: '500 Pa',
        yieldStress: '0.005 Pa',
        viscosity: '3.5 mPa·s',
      },
    },
    {
      id: 'aorta',
      values: {
        mode: 'womersley',
        radius: '12 mm',
        frequency: '1.2 Hz',
        nu: '3.3 mm^2/s',
        density: '1060 kg/m^3',
        amplitude: '100 Pa/m',
      },
    },
    { id: 'branch', values: { mode: 'murray', radius: '3 mm', children: '2', firstChild: '' } },
  ],
  run(values): Outcome {
    return HANDLERS[values.mode as Mode](values);
  },
};

function profilePicture(r: number[], u: number[]): Outcome['picture'] {
  return {
    type: 'plot',
    plot: {
      x: { label: 'radius', kind: 'length' },
      y: { label: 'speed', kind: 'speed' },
      series: [{ id: 'profile', points: r.map((x, i) => [x, u[i]] as [number, number]) }],
    },
  };
}
