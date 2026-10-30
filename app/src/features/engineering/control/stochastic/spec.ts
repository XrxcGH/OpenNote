// The random processes tool: a linear SDE's covariance and sample paths, white noise through G(s), and the steady
// discrete Kalman filter with a simulated run.
import { ControlError, readNumberList, readNumberMatrix } from '../lib/errors';
import { rows as rowsOf } from '../lib/linalg';
import { fmt, readTF } from '../lib/tf';
import type { PlotSpec, Series } from '../ui/plot';
import { inField } from '../ui/read';
import { FieldProblem, type Outcome, type Row, type ToolSpec, type Values } from '../ui/spec';
import { matrixTex, matrixText } from '../statespace/engine';
import {
  cholesky,
  makeKalman,
  type Paths,
  makeSde,
  runKalman,
  simulatePaths,
  spectrum,
  stationary,
  steadyKalman,
} from './engine';

type Texts = Readonly<Record<string, string>>;
const text = (v: Values, id: string) => String(v[id] ?? '');
const num = (v: Values, id: string) => Number(v[id]);
const mode =
  (...m: string[]) =>
  (t: Texts) =>
    m.includes(t.mode);
const matrix = (v: Values, id: string) => inField(id, () => readNumberMatrix(text(v, id)));
const line = (id: string, xs: readonly number[], ys: readonly number[], extra: Partial<Series> = {}): Series => ({
  id,
  points: xs.map((x, k) => [x, ys[k]] as const),
  ...extra,
});

/** A few sample paths with the exact mean and the band of two standard deviations either side. */
function pathsPlot(sim: Paths): PlotSpec {
  const upper = sim.mean.map((mu, k) => mu + 2 * sim.sd[k]);
  const lower = sim.mean.map((mu, k) => mu - 2 * sim.sd[k]);
  return {
    id: 'paths',
    x: { label: 'time' },
    y: { label: 'output' },
    series: [
      ...sim.shown.map((y, i) => line(i ? '' : 'samplePaths', sim.t, y, { pen: 2 })),
      line('mean', sim.t, sim.mean, { pen: 0 }),
      line('band', sim.t, upper, { pen: 1, style: 'dash' }),
      line('', sim.t, lower, { pen: 1, style: 'dash' }),
    ],
  };
}

function runSde(values: Values): Outcome {
  const a = matrix(values, 'a');
  const b = matrix(values, 'b');
  const c = matrix(values, 'c');
  const w = matrix(values, 'w');
  const s = inField(null, () => makeSde(a, b, c, w), {
    notSquare: 'a',
    tooManyStates: 'a',
    bRows: 'b',
    cCols: 'c',
    wShape: 'w',
    notCovariance: 'w',
  });
  const x0 = inField('x0', () => readNumberList(text(values, 'x0')));
  const sim = inField(
    null,
    () => simulatePaths(s, x0, num(values, 'span'), 400, num(values, 'paths'), num(values, 'seed')),
    {
      x0Length: 'x0',
      spanPositive: 'span',
      pathsRange: 'paths',
    },
  );
  let st: ReturnType<typeof stationary> | null = null;
  try {
    st = stationary(s);
  } catch (error) {
    if (!(error instanceof ControlError)) throw error;
  }
  const n = rowsOf(s.a);
  const rows: Row[] = st
    ? [
        { id: 'p', value: matrixText(st.p), tex: `P = ${matrixTex(st.p)}`, answer: true },
        {
          id: 'outputVariance',
          value: fmt(st.outputVariance[0]),
          tex: `\\sigma_y^2 = ${fmt(st.outputVariance[0])}`,
          answer: true,
        },
        { id: 'outputSd', value: fmt(Math.sqrt(st.outputVariance[0])) },
      ]
    : [{ id: 'p', value: '—' }];
  rows.push(
    { id: 'theoryEnd', vars: { t: fmt(sim.t[sim.t.length - 1]) }, value: fmt(sim.theoryEndVariance) },
    {
      id: 'sampleEnd',
      vars: { t: fmt(sim.t[sim.t.length - 1]), paths: fmt(num(values, 'paths')) },
      value: fmt(sim.endVariance),
    },
    { id: 'sampleMean', value: fmt(sim.endMean) },
  );
  return {
    rows,
    steps: st?.steps ?? [],
    plots: [pathsPlot(sim)],
    notes: [
      { id: 'sdeModel' },
      { id: st ? 'stationary' : 'notStationary' },
      { id: 'eulerMaruyama', vars: { n: String(n) } },
      { id: 'seed' },
    ],
  };
}

function runPsd(values: Values): Outcome {
  const g = inField('g', () => readTF(text(values, 'g')));
  const r = inField('g', () => spectrum(g, num(values, 's0')), { intensityPositive: 's0' });
  return {
    rows: [
      { id: 'variance', value: fmt(r.variance), tex: `\\sigma_y^2 = ${fmt(r.variance)}`, answer: true },
      { id: 'integrated', value: fmt(r.integrated) },
      { id: 'sd', value: fmt(Math.sqrt(r.variance)) },
      { id: 'r0', value: fmt(r.autocorrelation[0]) },
    ],
    steps: r.steps,
    plots: [
      {
        id: 'psdPlot',
        x: { label: 'frequency', log: true },
        y: { label: 'density', log: true },
        series: [line('', r.w, r.psd)],
      },
      {
        id: 'autoPlot',
        x: { label: 'lag' },
        y: { label: 'correlation' },
        series: [line('', r.tau, r.autocorrelation)],
      },
    ],
    notes: [{ id: 'twoSided' }, { id: 'stableProper' }],
  };
}

function runKalmanMode(values: Values): Outcome {
  const f = matrix(values, 'f');
  const h = matrix(values, 'h');
  const q = matrix(values, 'qk');
  const r = matrix(values, 'rk');
  const model = inField(null, () => makeKalman(f, h, q, r), {
    fSquare: 'f',
    tooManyStates: 'f',
    hCols: 'h',
    qShape: 'qk',
    qCovariance: 'qk',
    rkShape: 'rk',
    rCovariance: 'rk',
  });
  const p0 = matrix(values, 'p0');
  const n = rowsOf(f);
  if (rowsOf(p0) !== n || p0[0].length !== n) throw new FieldProblem('p0', 'p0Shape', { n: String(n) });
  inField('p0', () => cholesky(p0, 'p0Covariance'));
  const k = inField(null, () => steadyKalman(model, p0));
  const x0 = inField('x0k', () => readNumberList(text(values, 'x0k')));
  const run = inField(null, () => runKalman(model, p0, x0, num(values, 'samples'), num(values, 'seed')), {
    x0Length: 'x0k',
    kalmanSamples: 'samples',
  });
  const ks = run.truth.map((_, i) => i);
  const series: Series[] = [line('truth', ks, run.truth, { pen: 0 }), line('estimate', ks, run.estimate, { pen: 1 })];
  if (Number.isFinite(run.rmsMeasured))
    series.push(line('measured', ks, run.measured, { pen: 2, style: 'markers', marker: 'dot' }));
  return {
    rows: [
      { id: 'prior', value: matrixText(k.prior), tex: `P^- = ${matrixTex(k.prior)}`, answer: true },
      { id: 'gain', value: matrixText(k.gain), tex: `K = ${matrixTex(k.gain)}`, answer: true },
      { id: 'posterior', value: matrixText(k.posterior), tex: `P^+ = ${matrixTex(k.posterior)}`, answer: true },
      { id: 'iterations', value: String(k.iterations) },
      { id: 'rmsEstimate', value: fmt(run.rmsEstimate) },
      ...(Number.isFinite(run.rmsMeasured) ? [{ id: 'rmsMeasured', value: fmt(run.rmsMeasured) }] : []),
    ],
    steps: k.steps,
    tables: [
      {
        id: 'recursion',
        columns: ['k', 'prior', 'gain', 'posterior'],
        rows: k.first.map((row, i) => [
          String(i),
          matrixText(row.prior),
          matrixText(row.gain),
          matrixText(row.posterior),
        ]),
      },
    ],
    plots: [{ id: 'kalmanPlot', x: { label: 'sample' }, y: { label: 'state' }, series }],
    notes: [{ id: 'kalmanModel' }, { id: 'kalmanStart' }, { id: 'seed' }],
  };
}

const RUN: Readonly<Record<string, (values: Values) => Outcome>> = {
  sde: runSde,
  psd: runPsd,
  kalman: runKalmanMode,
};

export const spec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: Object.keys(RUN), first: 'sde' },
    { id: 'a', type: 'text', rows: 2, first: '-2', when: mode('sde') },
    { id: 'b', type: 'text', rows: 2, first: '1', when: mode('sde') },
    { id: 'c', type: 'text', rows: 1, first: '1', when: mode('sde') },
    { id: 'w', type: 'text', rows: 1, first: '1', when: mode('sde') },
    { id: 'x0', type: 'text', first: '0', when: mode('sde') },
    { id: 'span', type: 'number', unit: 'time', first: '5', when: mode('sde') },
    { id: 'paths', type: 'number', first: '500', when: mode('sde') },
    { id: 'g', type: 'text', first: '1/(s + 2)', when: mode('psd') },
    { id: 's0', type: 'number', first: '1', when: mode('psd') },
    { id: 'f', type: 'text', rows: 2, first: '1', when: mode('kalman') },
    { id: 'h', type: 'text', rows: 1, first: '1', when: mode('kalman') },
    { id: 'qk', type: 'text', rows: 2, first: '1', when: mode('kalman') },
    { id: 'rk', type: 'text', rows: 1, first: '1', when: mode('kalman') },
    { id: 'p0', type: 'text', rows: 2, first: '1', when: mode('kalman') },
    { id: 'x0k', type: 'text', first: '0', when: mode('kalman') },
    { id: 'samples', type: 'number', first: '100', when: mode('kalman') },
    { id: 'seed', type: 'number', first: '1', when: mode('sde', 'kalman') },
  ],
  run(values) {
    return (RUN[text(values, 'mode')] ?? runSde)(values);
  },
  examples: [
    { id: 'ou', texts: { mode: 'sde', a: '-2', b: '1', c: '1', w: '1', x0: '0' } },
    { id: 'brownian', texts: { mode: 'sde', a: '0', b: '1', c: '1', w: '1', x0: '0' } },
    {
      id: 'oscillator',
      texts: { mode: 'sde', a: '0 1\n-4 -0.8', b: '0\n1', c: '1 0', w: '1', x0: '1, 0', span: '20' },
    },
    { id: 'lowpass', texts: { mode: 'psd', g: '1/(s + 2)', s0: '1' } },
    { id: 'resonant', texts: { mode: 'psd', g: '4/(s^2 + 0.8s + 4)', s0: '1' } },
    { id: 'walk', texts: { mode: 'kalman', f: '1', h: '1', qk: '1', rk: '1', p0: '1' } },
    {
      id: 'velocity',
      texts: {
        mode: 'kalman',
        f: '1 0.1\n0 1',
        h: '1 0',
        qk: '0.001 0\n0 0.01',
        rk: '0.5',
        p0: '1 0\n0 1',
        x0k: '0, 1',
      },
    },
  ],
};
