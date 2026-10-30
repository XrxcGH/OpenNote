// The biomechanics tool's form. It works creep and stress relaxation of a spring-and-dashpot model under a step,
// or a ramp and hold, and its complex modulus at a frequency. It also does the statics of a muscle holding a
// segment about a joint, and the rule-of-mixtures bounds for a two-phase tissue such as bone.
import type { DrawContext } from '../kit/picture';
import type { Outcome, ResultRow, ToolSpec, Values } from '../kit/spec';
import { positive, q, step, type KitStep } from '../kit/types';
import { G0, SEGMENTS, type SegmentId } from './dempster';
import { jointSvg } from './draw';
import { constants, creep, dynamic, joint, mixture, relaxation, type Model, type ModelInput } from './engine';

const num = (values: Values, id: string) => values[id] as number;
const or0 = (values: Values, id: string) => (Number.isFinite(num(values, id)) ? num(values, id) : 0);
const isMode =
  (...modes: string[]) =>
  (v: Values) =>
    modes.includes(v.mode as string);
const typedSegment = (v: Values) => v.mode === 'joint' && !((v.segment as string) in SEGMENTS);
const tableSegment = (v: Values) => v.mode === 'joint' && (v.segment as string) in SEGMENTS;
const span = (hi: number, n = 80) => [...Array(n + 1).keys()].map((i) => (hi * i) / n);

function modelOf(values: Values): ModelInput {
  return { model: values.model as Model, E: num(values, 'E'), eta: num(values, 'eta'), Einf: num(values, 'Einf') };
}

function horizon(values: Values, input: ModelInput) {
  const c = constants(input);
  const tau = values.mode === 'creep' ? c.creep.tau : c.relax.tau;
  return Math.max(5 * tau, 1.5 * num(values, 't'), 1.5 * or0(values, 'ramp'), 1e-12);
}

function runHistory(values: Values): Outcome {
  const input = modelOf(values);
  const history = { ...input, ramp: or0(values, 'ramp'), t: num(values, 't') };
  const end = horizon(values, input);
  const notes = ['models', or0(values, 'ramp') > 0 ? 'boltzmann' : 'stepLoad'];
  if (values.mode === 'creep') {
    const r = creep({ ...history, level: num(values, 's0') });
    const rows: ResultRow[] = [
      { id: 'strain', value: r.value, sym: '\\varepsilon(t)', answer: true },
      { id: 'tauC', value: q(r.creep.tau, 'time'), sym: '\\tau_c' },
    ];
    return {
      rows,
      steps: r.steps,
      notes,
      picture: {
        type: 'plot',
        plot: {
          x: { label: 'time', kind: 'time' },
          y: { label: 'strain', kind: 'ratio' },
          series: [{ id: 'creep', points: span(end).map((t) => [t, r.at(t)] as const) }],
          marks: [{ x: num(values, 't'), y: r.value, id: 'here' }],
        },
      },
    };
  }
  const r = relaxation({ ...history, level: num(values, 'e0') });
  if (r.impulse) notes.push('kelvinStep');
  const tau = constants(input).relax.tau;
  return {
    rows: [
      { id: 'stress', value: q(r.value, 'stress'), sym: '\\sigma(t)', answer: true },
      ...(values.model === 'kelvin' ? [] : [{ id: 'tauR', value: q(tau, 'time'), sym: '\\tau' }]),
    ],
    steps: r.steps,
    notes,
    picture: {
      type: 'plot',
      plot: {
        x: { label: 'time', kind: 'time' },
        y: { label: 'stress', kind: 'stress' },
        series: [{ id: 'relax', points: span(end).map((t) => [t, t === 0 && r.impulse ? NaN : r.at(t)] as const) }],
        marks: Number.isFinite(r.value) ? [{ x: num(values, 't'), y: r.value, id: 'here' }] : [],
      },
    },
  };
}

function runDynamic(values: Values): Outcome {
  const input = modelOf(values);
  const omega = 2 * Math.PI * num(values, 'f');
  const r = dynamic(input, omega, num(values, 'amp'));
  const fMax = Math.max(3 * num(values, 'f'), input.model === 'kelvin' ? 1 : (3 * input.E) / (2 * Math.PI * input.eta));
  const curve = span(fMax)
    .slice(1)
    .map((f) => [f, dynamic(input, 2 * Math.PI * f, 0)] as const);
  return {
    rows: [
      { id: 'storage', value: q(r.storage, 'stress'), sym: "E'", answer: true },
      { id: 'loss', value: q(r.loss, 'stress'), sym: "E''", answer: true },
      { id: 'tanDelta', value: r.tanDelta, sym: '\\tan\\delta' },
      { id: 'energy', value: q(r.energy, 'stress'), sym: 'W' },
    ],
    steps: r.steps,
    notes: ['models', 'cycle'],
    picture: {
      type: 'plot',
      plot: {
        x: { label: 'frequency', kind: 'frequency' },
        y: { label: 'modulus', kind: 'stress' },
        series: [
          { id: 'storage', points: curve.map(([f, d]) => [f, d.storage] as const) },
          { id: 'loss', points: curve.map(([f, d]) => [f, d.loss] as const), dashed: true },
        ],
      },
    },
  };
}

/** The segment's weight and the distance of its center of mass from the joint: typed, or from Dempster's table. */
function segmentLoad(values: Values): { W: number; d: number; steps: KitStep[] } {
  const id = values.segment as string;
  if (!(id in SEGMENTS)) return { W: num(values, 'Ws'), d: num(values, 'ds'), steps: [] };
  const segment = SEGMENTS[id as SegmentId];
  const mass = positive(num(values, 'bodyMass'), 'm');
  const length = positive(num(values, 'segLength'), 'L');
  const W = segment.mass * mass * G0;
  const d = segment.com * length;
  return {
    W,
    d,
    steps: [
      step('biomech.segment', 'W_s = [[f]]\\, m g = [[W]], \\quad d_s = [[c]]\\, L_s = [[d]]', {
        f: segment.mass,
        c: segment.com,
        W: q(W, 'smallForce'),
        d: q(d, 'length'),
      }),
    ],
  };
}

function runJoint(values: Values): Outcome {
  const segment = segmentLoad(values);
  const loads = [{ W: segment.W, d: segment.d }];
  if (Number.isFinite(num(values, 'Wh'))) loads.push({ W: num(values, 'Wh'), d: num(values, 'dh') });
  const input = { phi: num(values, 'phi'), dm: num(values, 'dm'), alpha: num(values, 'alpha'), loads };
  const r = joint(input);
  return {
    rows: [
      { id: 'muscle', value: q(r.F, 'smallForce'), sym: 'F_m', answer: true },
      { id: 'Rx', value: q(r.Rx, 'smallForce'), sym: 'R_x' },
      { id: 'Ry', value: q(r.Ry, 'smallForce'), sym: 'R_y' },
      { id: 'R', value: q(r.R, 'smallForce'), sym: 'R', answer: true },
      { id: 'direction', value: q(r.direction, 'angle'), sym: '\\theta_R' },
      { id: 'ratio', value: r.F / loads.reduce((sum, one) => sum + one.W, 0), sym: 'F_m/\\sum W' },
    ],
    steps: [...segment.steps, ...r.steps],
    notes: ['jointAxes', 'jointModel', 'segments', ...(segment.steps.length > 0 ? ['dempster'] : [])],
    picture: { type: 'draw', draw: (ctx: DrawContext) => jointSvg({ ...input, F: r.F, Rx: r.Rx, Ry: r.Ry }, ctx) },
  };
}

function runBone(values: Values): Outcome {
  const [Vf, Ef, Em] = [num(values, 'Vf'), num(values, 'Ef'), num(values, 'Em')];
  const r = mixture(Vf, Ef, Em);
  const fractions = span(1, 50);
  return {
    rows: [
      { id: 'voigt', value: q(r.voigt, 'modulus'), sym: 'E_V', answer: true },
      { id: 'reuss', value: q(r.reuss, 'modulus'), sym: 'E_R', answer: true },
    ],
    steps: r.steps,
    notes: ['bounds'],
    picture: {
      type: 'plot',
      plot: {
        x: { label: 'fraction', kind: 'ratio' },
        y: { label: 'modulusE', kind: 'modulus' },
        series: [
          { id: 'voigt', points: fractions.map((v) => [v, mixture(v, Ef, Em).voigt] as const) },
          { id: 'reuss', points: fractions.map((v) => [v, mixture(v, Ef, Em).reuss] as const), dashed: true },
        ],
        marks: [{ x: Vf, y: r.voigt, id: 'here' }],
      },
    },
  };
}

const viscous = isMode('creep', 'relax', 'dynamic');

export const biomechSpec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: ['creep', 'relax', 'dynamic', 'joint', 'bone'], first: 'creep' },
    { id: 'model', type: 'choice', options: ['maxwell', 'kelvin', 'sls'], first: 'kelvin', when: viscous },
    { id: 'E', type: 'quantity', kind: 'stress', first: '10 MPa', when: viscous },
    { id: 'eta', type: 'quantity', kind: 'viscosity', first: '100 MPa·s', when: viscous },
    { id: 'Einf', type: 'quantity', kind: 'stress', first: '5 MPa', when: (v) => viscous(v) && v.model === 'sls' },
    { id: 's0', type: 'quantity', kind: 'stress', first: '1 MPa', when: isMode('creep') },
    { id: 'e0', type: 'quantity', kind: 'ratio', first: '0.01', when: isMode('relax') },
    { id: 'ramp', type: 'quantity', kind: 'time', first: '', optional: true, when: isMode('creep', 'relax') },
    { id: 't', type: 'quantity', kind: 'time', first: '10 s', when: isMode('creep', 'relax') },
    { id: 'f', type: 'quantity', kind: 'frequency', first: '1 Hz', when: isMode('dynamic') },
    { id: 'amp', type: 'quantity', kind: 'ratio', first: '0.01', when: isMode('dynamic') },
    { id: 'phi', type: 'quantity', kind: 'angle', first: '0', when: isMode('joint') },
    { id: 'dm', type: 'quantity', kind: 'length', first: '40 mm', when: isMode('joint') },
    { id: 'alpha', type: 'quantity', kind: 'angle', first: '90', when: isMode('joint') },
    {
      id: 'segment',
      type: 'choice',
      options: ['typed', ...Object.keys(SEGMENTS)],
      first: 'typed',
      when: isMode('joint'),
    },
    { id: 'Ws', type: 'quantity', kind: 'smallForce', first: '20 N', when: typedSegment },
    { id: 'ds', type: 'quantity', kind: 'length', first: '150 mm', when: typedSegment },
    { id: 'bodyMass', type: 'quantity', kind: 'mass', first: '70 kg', when: tableSegment },
    { id: 'segLength', type: 'quantity', kind: 'length', first: '300 mm', when: tableSegment },
    { id: 'Wh', type: 'quantity', kind: 'smallForce', first: '50 N', optional: true, when: isMode('joint') },
    { id: 'dh', type: 'quantity', kind: 'length', first: '350 mm', when: isMode('joint') },
    { id: 'Vf', type: 'quantity', kind: 'ratio', first: '0.4', when: isMode('bone') },
    { id: 'Ef', type: 'quantity', kind: 'modulus', first: '100 GPa', when: isMode('bone') },
    { id: 'Em', type: 'quantity', kind: 'modulus', first: '1 GPa', when: isMode('bone') },
  ],
  examples: [
    {
      id: 'kelvinCreep',
      values: { mode: 'creep', model: 'kelvin', E: '10 MPa', eta: '100 MPa·s', s0: '1 MPa', t: '10 s' },
    },
    {
      id: 'maxwellRelax',
      values: { mode: 'relax', model: 'maxwell', E: '10 MPa', eta: '100 MPa·s', e0: '0.01', t: '10 s', ramp: '' },
    },
    { id: 'slsRamp', values: { mode: 'creep', model: 'sls', E: '10 MPa', Einf: '5 MPa', ramp: '2 s', t: '10 s' } },
    { id: 'cycle', values: { mode: 'dynamic', model: 'sls', E: '10 MPa', Einf: '5 MPa', f: '0.02 Hz', amp: '0.01' } },
    {
      id: 'elbow',
      values: { mode: 'joint', phi: '0', dm: '40 mm', alpha: '90', Ws: '20 N', ds: '150 mm', Wh: '50 N', dh: '350 mm' },
    },
    {
      id: 'elbowDempster',
      values: {
        mode: 'joint',
        phi: '0',
        dm: '40 mm',
        alpha: '90',
        segment: 'forearmHand',
        bodyMass: '70 kg',
        segLength: '300 mm',
        Wh: '50 N',
        dh: '350 mm',
      },
    },
    { id: 'bone', values: { mode: 'bone', Vf: '0.4', Ef: '100 GPa', Em: '1 GPa' } },
  ],
  run(values) {
    if (values.mode === 'dynamic') return runDynamic(values);
    if (values.mode === 'joint') return runJoint(values);
    if (values.mode === 'bone') return runBone(values);
    return runHistory(values);
  },
};
