// The system models and responses tool: a transfer function typed, built from a physical model, or reduced from a
// block diagram, shown in transfer function, zero-pole-gain, and state-space form with its time response and step
// specifications. It also finds steady-state errors and fits a model to a measured step.
import { ControlError } from '../lib/errors';
import { complexText, fmt, readTF, tfTex, tfText, zpk, type Complex, type TF } from '../lib/tf';
import { poleZeroMap } from '../ui/maps';
import type { PlotSpec } from '../ui/plot';
import { inField } from '../ui/read';
import { FieldProblem, type Outcome, type Row, type ToolSpec, type Values } from '../ui/spec';
import type { UnitKind } from '../ui/units';
import { matrixText } from '../statespace/engine';
import { reduceDiagram } from './blocks';
import {
  checkSystem,
  polesZeros,
  respond,
  secondOrder,
  spanOf,
  specSteps,
  steadyState,
  stepSpecs,
  type Input,
} from './engine';
import { fitFopdt, fitSecondOrder, readData } from './identify';
import { MODEL_FIELDS, model, type ModelKind } from './models';

type Texts = Readonly<Record<string, string>>;
const text = (v: Values, id: string) => String(v[id] ?? '');
const num = (v: Values, id: string) => Number(v[id]);
const mode =
  (...m: string[]) =>
  (t: Texts) =>
    m.includes(t.mode);
const list = (zs: readonly Complex[]) => zs.map((z) => complexText(z)).join(', ') || '—';

/** G as k(s − z₁)…/((s − p₁)…). */
function zpkText(g: TF): string {
  const z = zpk(g);
  const factor = (r: Complex) =>
    Math.abs(r.re) < 1e-12 && Math.abs(r.im) < 1e-12
      ? 's'
      : `(s ${r.re > 0 ? '−' : '+'} ${complexText({ re: Math.abs(r.re), im: r.re > 0 ? -r.im : r.im })})`;
  const top = z.zeros.map(factor).join('');
  const bottom = z.poles.map(factor).join('');
  return `${fmt(z.k)}${top ? ` ${top}` : ''}${bottom ? ` / (${bottom})` : ''}`;
}

/** Everything about a system: its forms, poles, response, and step specifications. */
function analyze(g: TF, values: Values, lead: Outcome['steps'] = []): Outcome {
  const ss = inField(null, () => checkSystem(g), { improper: 'g' });
  const input = (text(values, 'input') || 'step') as Input;
  const spanIn = num(values, 'span');
  const span = Number.isFinite(spanIn) ? spanIn : spanOf(g);
  const r = inField(null, () => respond(g, input, span, text(values, 'u')), {
    inputExpr: 'u',
    inputFinite: 'u',
    spanPositive: 'span',
  });
  const { poles, zeros } = polesZeros(g);
  const rows: Row[] = [
    { id: 'tf', value: tfText(g), tex: `G(s) = ${tfTex(g)}`, answer: true },
    { id: 'zpk', value: zpkText(g) },
    { id: 'poles', value: list(poles) },
    { id: 'zeros', value: list(zeros) },
    { id: 'ssA', value: ss.a.length ? matrixText(ss.a) : '—' },
    { id: 'ssB', value: ss.b.length ? matrixText(ss.b) : '—' },
    { id: 'ssC', value: ss.c.length ? matrixText(ss.c) : '—' },
    { id: 'ssD', value: matrixText(ss.d) },
  ];
  const steps = [...lead];
  const notes: { id: string }[] = [{ id: 'forms' }];
  const marks: Pick<PlotSpec, 'hlines' | 'vlines'> = {};
  if (input === 'step') {
    try {
      const s = stepSpecs(g);
      const f = secondOrder(g);
      rows.push(
        { id: 'final', value: fmt(s.final), answer: true },
        { id: 'overshoot', value: `${fmt(s.overshoot)}%`, answer: true },
        { id: 'tPeak', value: Number.isFinite(s.tPeak) ? `${fmt(s.tPeak)} s` : '—' },
        { id: 'peak', value: fmt(s.peak) },
        { id: 'rise', value: `${fmt(s.rise)} s`, answer: true },
        { id: 'settling', value: `${fmt(s.settling)} s`, answer: true },
      );
      if (f) rows.push({ id: 'zeta', value: fmt(f.zeta) }, { id: 'wn', value: `${fmt(f.wn)} rad/s` });
      steps.push(...specSteps(g, s, f));
      // The 2% band and the peak and settling times, marked on the plot.
      Object.assign(marks, {
        hlines: [
          { at: s.final * 1.02, pen: 3 },
          { at: s.final * 0.98, pen: 3 },
        ],
        vlines: [...(Number.isFinite(s.tPeak) ? [{ at: s.tPeak, pen: 1 }] : []), { at: s.settling, pen: 3 }],
      });
      if (f) notes.push({ id: 'formulas' });
    } catch (error) {
      if (!(error instanceof ControlError)) throw error;
      notes.push({ id: error.code === 'specsZeroFinal' ? 'noFinal' : 'noSpecs' });
    }
  }
  const plot: PlotSpec = {
    ...marks,
    id: 'responsePlot',
    x: { label: 'time' },
    y: { label: 'output' },
    series: [
      { id: 'output', pen: 0, points: r.t.map((t, k) => [t, r.y[k]] as const) },
      ...(input === 'impulse'
        ? []
        : [{ id: 'input', pen: 2, style: 'dash' as const, points: r.t.map((t, k) => [t, r.u[k]] as const) }]),
    ],
  };
  return {
    rows,
    steps,
    latex: `G(s) = ${tfTex(g)}`,
    plots: [plot, poleZeroMap('poleMap', poles, zeros, 's')],
    notes: [...notes, { id: input }],
  };
}

function runResponse(values: Values): Outcome {
  return analyze(
    inField('g', () => readTF(text(values, 'g'))),
    values,
  );
}

const KIND_UNITS: Readonly<Record<string, UnitKind>> = {
  mass: 'mass',
  damping: 'damping',
  stiffness: 'stiffness',
  resistance: 'resistance',
  inductance: 'inductance',
  capacitance: 'capacitance',
  inertia: 'inertia',
  friction: 'rotaryDamping',
  kt: 'torqueConstant',
  thermalR: 'thermalResistance',
  thermalC: 'thermalCapacitance',
  area: 'area',
  flowR: 'flowResistance',
};

function runModel(values: Values): Outcome {
  const kind = (text(values, 'model') || 'msd') as ModelKind;
  const params = Object.fromEntries(MODEL_FIELDS[kind].map((id) => [id, num(values, id)]));
  let m: ReturnType<typeof model>;
  try {
    m = model(kind, params);
  } catch (error) {
    if (error instanceof ControlError && error.vars.field) throw new FieldProblem(error.vars.field, error.code);
    throw error;
  }
  const out = analyze(m.g, values, m.steps);
  return { ...out, notes: [{ id: kind }, { id: 'analogy' }, ...(out.notes ?? [])] };
}

function runBlocks(values: Values): Outcome {
  const r = inField('diagram', () => reduceDiagram(text(values, 'diagram')));
  const out = analyze(r.tf, values, r.steps);
  return { ...out, notes: [{ id: 'blocks' }, ...(out.notes ?? [])] };
}

function runError(values: Values): Outcome {
  const g = inField('g', () => readTF(text(values, 'g')));
  const r = inField('g', () => steadyState(g));
  const inf = (x: number) => (Number.isFinite(x) ? fmt(x) : '∞');
  return {
    rows: [
      { id: 'closed', value: tfText(r.closed), tex: `T(s) = ${tfTex(r.closed)}`, answer: true },
      { id: r.stable ? 'closedStable' : 'closedUnstable', value: '✓' },
      { id: 'type', value: String(r.type), answer: true },
      { id: 'kp', value: inf(r.kp) },
      { id: 'kv', value: inf(r.kv) },
      { id: 'ka', value: inf(r.ka) },
      { id: 'errStep', value: inf(r.step), answer: true },
      { id: 'errRamp', value: inf(r.ramp), answer: true },
      { id: 'errParabola', value: inf(r.parabola), answer: true },
    ],
    steps: r.steps,
    latex: `T(s) = ${tfTex(r.closed)}`,
    notes: [{ id: 'unity' }, ...(r.stable ? [] : [{ id: 'errorsNeedStable' }])],
  };
}

function runIdentify(values: Values): Outcome {
  const d = inField('data', () => readData(text(values, 'data')));
  const kind = text(values, 'fit') === 'second' ? 'second' : 'fopdt';
  const f = inField(
    null,
    () => (kind === 'second' ? fitSecondOrder(d, num(values, 'du')) : fitFopdt(d, num(values, 'du'))),
    {
      stepSize: 'du',
      dataFlat: 'data',
      dataLevels: 'data',
      noOvershoot: 'data',
    },
  );
  const p = f.params;
  const g =
    kind === 'second'
      ? `${fmt(f.gain * p.wn * p.wn)}/(s² + ${fmt(2 * p.zeta * p.wn)}s + ${fmt(p.wn * p.wn)})`
      : `${fmt(f.gain)}·e^(−${fmt(p.theta)}s)/(${fmt(p.tau)}s + 1)`;
  const rows: Row[] = [
    { id: 'fitted', value: g, answer: true },
    { id: 'gain', value: fmt(f.gain) },
    ...(kind === 'second'
      ? [
          { id: 'zeta', value: fmt(p.zeta) },
          { id: 'wn', value: `${fmt(p.wn)} rad/s` },
          { id: 'overshoot', value: `${fmt(p.overshoot)}%` },
        ]
      : [
          { id: 'tau', value: `${fmt(p.tau)} s` },
          { id: 'theta', value: `${fmt(p.theta)} s` },
        ]),
    { id: 'rms', value: fmt(f.rms) },
  ];
  return {
    rows,
    steps: f.steps,
    plots: [
      {
        id: 'fitPlot',
        x: { label: 'time' },
        y: { label: 'output' },
        series: [
          { id: 'measured', pen: 2, style: 'markers', marker: 'dot', points: d.t.map((t, k) => [t, d.y[k]] as const) },
          { id: 'fit', pen: 0, points: d.t.map((t, k) => [t, f.model[k]] as const) },
        ],
      },
    ],
    notes: [{ id: kind === 'second' ? 'fitSecond' : 'fitFopdt' }, { id: 'stepAtZero' }],
  };
}

const RUN: Readonly<Record<string, (values: Values) => Outcome>> = {
  response: runResponse,
  model: runModel,
  blocks: runBlocks,
  error: runError,
  identify: runIdentify,
};

const modelIs =
  (...kinds: string[]) =>
  (t: Texts) =>
    t.mode === 'model' && kinds.includes(t.model || 'msd');
const param = (id: string, first: string, ...kinds: string[]) =>
  ({ id, type: 'number', unit: KIND_UNITS[id], first, when: modelIs(...kinds) }) as const;

const STEP_DATA = Array.from({ length: 49 }, (_, k) => {
  const t = k * 0.25;
  const x = Math.max(0, t - 1);
  return `${t} ${fmt(2 * (1 - Math.exp(-x / 1.5)), 4)}`;
}).join('\n');

export const spec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: Object.keys(RUN), first: 'response' },
    { id: 'g', type: 'text', first: '4/(s^2 + 2s + 4)', when: mode('response', 'error') },
    {
      id: 'model',
      type: 'choice',
      options: ['msd', 'rlc', 'motor', 'thermal', 'tank'],
      first: 'msd',
      when: mode('model'),
    },
    param('mass', '1', 'msd'),
    param('damping', '0.8', 'msd'),
    param('stiffness', '4', 'msd'),
    param('resistance', '10', 'rlc', 'motor'),
    param('inductance', '0.1', 'rlc', 'motor'),
    param('capacitance', '0.001', 'rlc'),
    param('inertia', '0.01', 'motor'),
    param('friction', '0.1', 'motor'),
    param('kt', '0.01', 'motor'),
    param('thermalR', '2', 'thermal'),
    param('thermalC', '50', 'thermal'),
    param('area', '3', 'tank'),
    param('flowR', '4', 'tank'),
    { id: 'diagram', type: 'text', rows: 2, first: 'feedback(series(10/(s + 1), 1/s), 1)', when: mode('blocks') },
    {
      id: 'input',
      type: 'choice',
      options: ['step', 'impulse', 'ramp', 'custom'],
      first: 'step',
      when: mode('response', 'model', 'blocks'),
    },
    {
      id: 'u',
      type: 'text',
      first: 'sin(2 t)',
      when: (t) => mode('response', 'model', 'blocks')(t) && t.input === 'custom',
    },
    { id: 'span', type: 'number', unit: 'time', first: '', optional: true, when: mode('response', 'model', 'blocks') },
    { id: 'data', type: 'text', rows: 6, first: STEP_DATA, when: mode('identify') },
    { id: 'du', type: 'number', first: '1', when: mode('identify') },
    { id: 'fit', type: 'choice', options: ['fopdt', 'second'], first: 'fopdt', when: mode('identify') },
  ],
  run(values) {
    return (RUN[text(values, 'mode')] ?? runResponse)(values);
  },
  examples: [
    { id: 'second', texts: { mode: 'response', g: '4/(s^2 + 2s + 4)', input: 'step' } },
    { id: 'zero', texts: { mode: 'response', g: '(s + 3)/(s^2 + 2s + 3)', input: 'step' } },
    { id: 'ramp', texts: { mode: 'response', g: '10/(s^2 + s + 10)', input: 'ramp' } },
    { id: 'msd', texts: { mode: 'model', model: 'msd' } },
    { id: 'rlc', texts: { mode: 'model', model: 'rlc' } },
    { id: 'motor', texts: { mode: 'model', model: 'motor', resistance: '1', inductance: '0.5' } },
    { id: 'tank', texts: { mode: 'model', model: 'tank' } },
    { id: 'blocks', texts: { mode: 'blocks', diagram: 'feedback(series(10/(s + 1), 1/s), 1)' } },
    { id: 'error', texts: { mode: 'error', g: '10/(s (s + 1))' } },
    { id: 'identify', texts: { mode: 'identify', fit: 'fopdt' } },
  ],
};
