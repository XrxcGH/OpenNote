// The digital control tool. It discretizes a plant or controller and analyzes a discrete transfer function: its
// poles against the unit circle, the Jury test, the difference equation, and the step response. It also finds the
// gains that keep a sampled loop stable, checks aliasing, and writes a digital PID as a difference equation.
import { step } from '../lib/steps';
import { complexText, fmt, polyText, readTF, tfTex, tfText, type TF } from '../lib/tf';
import { locusMap, poleZeroMap } from '../ui/maps';
import type { PlotSpec } from '../ui/plot';
import { inField } from '../ui/read';
import type { Outcome, Row, Table, ToolSpec, Values } from '../ui/spec';
import { alias, analyzeDiscrete, digitalPid, discretize, jury, zLocus, type Method } from './engine';

type Texts = Readonly<Record<string, string>>;
const text = (v: Values, id: string) => String(v[id] ?? '');
const num = (v: Values, id: string) => Number(v[id]);
const mode =
  (...m: string[]) =>
  (t: Texts) =>
    m.includes(t.mode);

/** The difference equation y[k] = Σ b_i u[k−i] − Σ a_i y[k−i] as text. */
function differenceText(b: readonly number[], a: readonly number[]): string {
  const terms: string[] = [];
  b.forEach((c, i) => {
    if (Math.abs(c) > 1e-15) terms.push(`${fmt(c)}·u[k${i ? `−${i}` : ''}]`);
  });
  a.slice(1).forEach((c, i) => {
    if (Math.abs(c) > 1e-15) terms.push(`${fmt(-c)}·y[k−${i + 1}]`);
  });
  return `y[k] = ${terms.join(' + ').replace(/\+ −/g, '− ') || '0'}`;
}

function stairs(id: string, values: readonly number[], T: number | undefined): PlotSpec {
  return {
    id,
    x: { label: T ? 'time' : 'sample' },
    y: { label: 'output' },
    series: [{ id: '', style: 'stairs', marker: 'dot', points: values.map((y, k) => [T ? k * T : k, y] as const) }],
  };
}

/** Everything about a discrete transfer function: poles, Jury, difference equation, and responses. */
function analysis(hz: TF, T: number | undefined, samples: number, lead: Outcome['steps'] = []): Outcome {
  const r = inField('samples', () => analyzeDiscrete(hz, samples, T), { improperDiscrete: 'hz' });
  const juryTable: Table = {
    id: 'jury',
    columns: ['row', 'coefficients'],
    rows: r.jury.rows.map((row, i) => [String(i + 1), row.coeffs.map((c) => fmt(c)).join(', ')]),
  };
  const rows: Row[] = [
    { id: 'hz', value: tfText(hz, 'z'), tex: `H(z) = ${tfTex(hz, 'z')}`, answer: true },
    { id: 'poles', value: r.poles.map((p) => complexText(p)).join(', ') || '—' },
    { id: 'magnitudes', value: r.magnitudes.map((m) => fmt(m)).join(', ') || '—' },
    { id: 'zeros', value: r.zeros.map((z) => complexText(z)).join(', ') || '—' },
    { id: 'stable', value: r.stable ? '✓' : '✗', answer: true },
    { id: 'dcGain', value: fmt(r.dcGain) },
    { id: 'difference', value: differenceText(r.difference.b, r.difference.a) },
  ];
  return {
    rows,
    latex: `H(z) = ${tfTex(hz, 'z')}`,
    steps: [...lead, ...r.steps, ...r.jury.conditions.map((c) => step(c.key, c.vars))],
    tables: [
      juryTable,
      {
        id: 'response',
        columns: ['k', 'stepValue', 'impulseValue'],
        rows: r.step.slice(0, 21).map((y, k) => [String(k), fmt(y), fmt(r.impulse[k])]),
      },
    ],
    plots: [stairs('stepPlot', r.step, T), poleZeroMap('zPlane', r.poles, r.zeros, 'z')],
    notes: [{ id: 'unitCircle' }, ...(T ? [] : [{ id: 'noPeriod' }])],
  };
}

function runDiscretize(values: Values): Outcome {
  const g = inField('gs', () => readTF(text(values, 'gs')));
  const T = num(values, 'period');
  const method = text(values, 'method') as Method;
  const w0 = num(values, 'w0');
  const d = inField(null, () => discretize(g, T, method, Number.isFinite(w0) ? w0 : undefined), {
    periodPositive: 'period',
    prewarpRange: 'w0',
    improper: 'gs',
  });
  const out = analysis(d.hz, T, num(values, 'samples'), d.steps);
  return { ...out, notes: [{ id: method }, ...(out.notes ?? [])] };
}

function runAnalyze(values: Values): Outcome {
  const hz = inField('hz', () => readTF(text(values, 'hz'), 'z'));
  const T = num(values, 'periodOptional');
  return analysis(hz, Number.isFinite(T) && T > 0 ? T : undefined, num(values, 'samples'));
}

function runJury(values: Values): Outcome {
  const p = inField('poly', () => readTF(text(values, 'poly'), 'z'));
  const r = inField('poly', () => jury(p.num));
  return {
    rows: [
      { id: 'polynomial', value: polyText(p.num, 'z') },
      { id: 'stable', value: r.stable ? '✓' : '✗', answer: true },
    ],
    steps: r.conditions.map((c) => step(c.key, c.vars)),
    tables: [
      {
        id: 'jury',
        columns: ['row', 'coefficients'],
        rows: r.rows.map((row, i) => [String(i + 1), row.coeffs.map((c) => fmt(c)).join(', ')]),
      },
    ],
    notes: [{ id: 'juryCoefficients' }],
  };
}

function runLocus(values: Values): Outcome {
  const hz = inField('hz', () => readTF(text(values, 'hz'), 'z'));
  const r = inField('hz', () => zLocus(hz));
  const a = analyzeDiscrete(hz, 2);
  return {
    rows: [
      {
        id: 'ranges',
        value: r.ranges.map(([lo, hi]) => `${fmt(lo)} < K < ${fmt(hi)}`).join('; ') || '—',
        answer: true,
      },
      ...r.crossings.map((c, i) => ({
        id: 'crossing',
        vars: { n: String(i + 1) },
        value: `K = ${fmt(c.k)}, z = ${complexText(c.point)}`,
      })),
    ],
    steps: r.steps,
    plots: [locusMap('zLocus', r.locus, a.poles, a.zeros, 'z')],
    notes: [{ id: 'locusGain' }],
  };
}

function runAlias(values: Values): Outcome {
  const r = inField(null, () => alias(num(values, 'signal'), num(values, 'rate')), { frequencyPositive: 'rate' });
  return {
    rows: [
      { id: 'apparent', value: `${fmt(r.apparent)} Hz`, tex: `f_a = ${fmt(r.apparent)}\\ \\text{Hz}`, answer: true },
      { id: 'nyquist', value: `${fmt(r.nyquist)} Hz` },
      { id: 'aliased', value: r.aliased ? '✓' : '✗' },
    ],
    steps: r.steps,
    notes: [{ id: 'alias' }],
  };
}

function runPid(values: Values): Outcome {
  const T = num(values, 'period');
  const integral = text(values, 'integral') === 'trapezoid' ? 'trapezoid' : 'backward';
  const r = inField(null, () => digitalPid(num(values, 'kp'), num(values, 'ki'), num(values, 'kd'), T, integral), {
    periodPositive: 'period',
  });
  const [q0, q1, q2] = r.q;
  const law = `u[k] = u[k−1] + ${fmt(q0)}·e[k] + ${fmt(q1)}·e[k−1] + ${fmt(q2)}·e[k−2]`.replace(/\+ −/g, '− ');
  return {
    rows: [
      { id: 'law', value: law, answer: true },
      { id: 'cz', value: tfText(r.cz, 'z'), tex: `C(z) = ${tfTex(r.cz, 'z')}` },
      { id: 'q0', value: fmt(q0) },
      { id: 'q1', value: fmt(q1) },
      { id: 'q2', value: fmt(q2) },
    ],
    latex: `C(z) = ${tfTex(r.cz, 'z')}`,
    steps: r.steps,
    notes: [{ id: 'windup' }],
  };
}

const RUN: Readonly<Record<string, (values: Values) => Outcome>> = {
  discretize: runDiscretize,
  analyze: runAnalyze,
  jury: runJury,
  locus: runLocus,
  alias: runAlias,
  pid: runPid,
};

export const spec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: Object.keys(RUN), first: 'discretize' },
    { id: 'gs', type: 'text', first: '1/(s + 1)', when: mode('discretize') },
    { id: 'hz', type: 'text', first: '0.1/(z - 0.9)', when: mode('analyze', 'locus') },
    { id: 'poly', type: 'text', first: 'z^2 - 1.2z + 0.5', when: mode('jury') },
    {
      id: 'method',
      type: 'choice',
      options: ['zoh', 'tustin', 'prewarp', 'matched'],
      first: 'zoh',
      when: mode('discretize'),
    },
    {
      id: 'w0',
      type: 'number',
      unit: 'rate',
      first: '1',
      when: (t) => t.mode === 'discretize' && t.method === 'prewarp',
    },
    { id: 'period', type: 'number', unit: 'time', first: '0.1', when: mode('discretize', 'pid') },
    {
      id: 'periodOptional',
      type: 'number',
      unit: 'time',
      first: '',
      optional: true,
      when: mode('analyze'),
    },
    { id: 'samples', type: 'number', first: '40', when: mode('discretize', 'analyze') },
    { id: 'signal', type: 'number', unit: 'hertz', first: '70', when: mode('alias') },
    { id: 'rate', type: 'number', unit: 'hertz', first: '100', when: mode('alias') },
    { id: 'kp', type: 'number', first: '2', when: mode('pid') },
    { id: 'ki', type: 'number', first: '1', when: mode('pid') },
    { id: 'kd', type: 'number', first: '0.5', when: mode('pid') },
    { id: 'integral', type: 'choice', options: ['backward', 'trapezoid'], first: 'backward', when: mode('pid') },
  ],
  run(values) {
    return (RUN[text(values, 'mode')] ?? runDiscretize)(values);
  },
  examples: [
    { id: 'zoh', texts: { mode: 'discretize', gs: '1/(s + 1)', period: '0.1', method: 'zoh' } },
    { id: 'tustin', texts: { mode: 'discretize', gs: '1/(s + 1)', period: '0.1', method: 'tustin' } },
    { id: 'motor', texts: { mode: 'discretize', gs: '10/(s (s + 2))', period: '0.05', method: 'zoh' } },
    { id: 'jury', texts: { mode: 'jury', poly: 'z^2 - 1.2z + 0.5' } },
    { id: 'locus', texts: { mode: 'locus', hz: '(z + 1)/((z - 1) (z - 0.5))' } },
    { id: 'alias', texts: { mode: 'alias', signal: '70', rate: '100' } },
    { id: 'pid', texts: { mode: 'pid', kp: '2', ki: '1', kd: '0.5', period: '0.1', integral: 'trapezoid' } },
  ],
};
