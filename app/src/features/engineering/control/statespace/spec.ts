// The state-space design tool. For ẋ = Ax + Bu, y = Cx + Du it reports controllability, observability, the poles,
// the transfer function and the controllable canonical form; places poles by Ackermann's formula, with integral
// action if asked; designs a full-order observer and shows the separation principle; and solves the LQR problem.
import { complexText, fmt, polyTex, ssToTF, tfTex, tfText, tfToSS, type Complex, type SS } from '../lib/tf';
import { readComplexList } from '../lib/complexList';
import { readNumberList, readNumberMatrix } from '../lib/errors';
import { rows as rowsOf } from '../lib/linalg';
import { step } from '../lib/steps';
import { poleZeroMap } from '../ui/maps';
import type { PlotSpec } from '../ui/plot';
import { inField } from '../ui/read';
import { FieldProblem, type Outcome, type Row, type ToolSpec, type Values } from '../ui/spec';
import {
  ackermann,
  analyzeSS,
  augmentIntegral,
  lqr,
  makeSS,
  matrixTex,
  matrixText,
  observerGain,
  observerResponses,
  spanFor,
  stepResponse,
} from './engine';

type Texts = Readonly<Record<string, string>>;
const text = (v: Values, id: string) => String(v[id] ?? '');
const mode =
  (...m: string[]) =>
  (t: Texts) =>
    m.includes(t.mode);
const list = (zs: readonly Complex[]) => zs.map((z) => complexText(z)).join(', ') || '—';

/** The model from the A, B, C, and D fields; an empty D is zero. */
function model(values: Values): SS {
  const a = inField('a', () => readNumberMatrix(text(values, 'a')));
  const b = inField('b', () => readNumberMatrix(text(values, 'b')));
  const c = inField('c', () => readNumberMatrix(text(values, 'c')));
  const dText = text(values, 'd').trim();
  const d = dText ? inField('d', () => readNumberMatrix(dText)) : null;
  return inField(null, () => makeSS(a, b, c, d), {
    notSquare: 'a',
    tooManyStates: 'a',
    bRows: 'b',
    cCols: 'c',
    dShape: 'd',
  });
}

const poles = (values: Values, id: string) => inField(id, () => readComplexList(text(values, id)));

function response(id: string, t: readonly number[], series: readonly { id: string; y: readonly number[] }[]): PlotSpec {
  return {
    id,
    x: { label: 'time' },
    y: { label: 'output' },
    series: series.map((s, i) => ({
      id: s.id,
      pen: i,
      style: i ? 'dash' : 'line',
      points: t.map((x, k) => [x, s.y[k]] as const),
    })),
  };
}

const gainRow = (id: string, k: number[][], tex: string): Row => ({
  id,
  value: matrixText(k),
  tex: `${tex} = ${matrixTex(k)}`,
  answer: true,
});

function runAnalyze(values: Values): Outcome {
  const ss = model(values);
  const n = rowsOf(ss.a);
  const r = analyzeSS(ss);
  const siso = ss.b[0].length === 1 && ss.c.length === 1;
  const rowsOut: Row[] = [
    { id: 'ctrbRank', value: `${r.ctrbRank} / ${n}`, answer: true },
    { id: 'obsvRank', value: `${r.obsvRank} / ${n}`, answer: true },
    { id: 'poles', value: list(r.poles) },
    { id: 'stable', value: r.poles.every((p) => p.re < -1e-12) ? '✓' : '✗' },
  ];
  const steps = [...r.steps];
  if (siso) {
    const g = ssToTF(ss);
    rowsOut.push({ id: 'tf', value: tfText(g), tex: `G(s) = ${tfTex(g)}` });
    const canon = tfToSS({ num: [1], den: g.den });
    rowsOut.push({ id: 'canonical', value: matrixText(canon.a), tex: `A_c = ${matrixTex(canon.a)}` });
    steps.push(
      step('ss.tf', {}, `G(s) = C(sI - A)^{-1}B + D = ${tfTex(g)}`),
      step('ss.canonical', {}, `\\det(sI - A) = ${polyTex(g.den)},\\quad A_c = ${matrixTex(canon.a)}`),
    );
  }
  return {
    rows: rowsOut,
    steps,
    tables: [
      { id: 'ctrb', columns: matrixColumns(r.ctrb[0].length), rows: matrixRows(r.ctrb) },
      { id: 'obsv', columns: matrixColumns(n), rows: matrixRows(r.obsv) },
    ],
    plots: [poleZeroMap('poleMap', r.poles, [], 's')],
    notes: [{ id: 'model' }, { id: 'rankTolerance' }, ...(siso ? [] : [{ id: 'mimo' }])],
  };
}

const matrixColumns = (m: number) => Array.from({ length: m }, (_, j) => ({ text: String(j + 1) }));
const matrixRows = (m: readonly (readonly number[])[]) =>
  m.map((row) => row.map((x) => fmt(Math.abs(x) < 1e-12 ? 0 : x)));

function runPlace(values: Values): Outcome {
  const ss = model(values);
  const integral = text(values, 'integral') === 'integral';
  const n = rowsOf(ss.a);
  const want = poles(values, 'poles');
  const plant = integral ? inField('c', () => augmentIntegral(ss)) : ss;
  const r = inField('poles', () => ackermann(plant.a, plant.b, want), {
    singleInput: 'b',
    uncontrollable: integral ? 'poles' : 'b',
  });
  const sim = stepResponse(ss, r.k, integral, spanFor(r.closed));
  const rowsOut: Row[] = [
    integral ? gainRow('kx', [r.k[0].slice(0, n)], 'K') : gainRow('k', r.k, 'K'),
    ...(integral ? [{ id: 'ki', value: fmt(-r.k[0][n]), tex: `k_i = ${fmt(-r.k[0][n])}`, answer: true }] : []),
    { id: 'closed', value: list(r.closed) },
  ];
  if (!integral && sim) rowsOut.push({ id: 'nbar', value: fmt(sim.n) });
  return {
    rows: rowsOut,
    steps: [
      ...(integral ? [step('ss.integral', {}, `\\dot z = r - y,\\quad A_a = ${matrixTex(plant.a)}`)] : []),
      ...r.steps,
      step('ss.check', { poles: list(r.closed) }),
      ...(sim && !integral ? [step('ss.nbar', { n: fmt(sim.n) })] : []),
    ],
    plots: [
      ...(sim ? [response('stepPlot', sim.t, [{ id: '', y: sim.y }])] : []),
      poleZeroMap('closedMap', r.closed, [], 's'),
    ],
    notes: [
      { id: integral ? 'integralLaw' : 'placeLaw' },
      ...(sim || integral ? [] : [{ id: 'noDc' }]),
      { id: 'singleInput' },
    ],
  };
}

function runObserver(values: Values): Outcome {
  const ss = model(values);
  const n = rowsOf(ss.a);
  const k = inField('poles', () => ackermann(ss.a, ss.b, poles(values, 'poles')), {
    singleInput: 'b',
    uncontrollable: 'b',
  });
  const l = inField('observerPoles', () => observerGain(ss.a, ss.c, poles(values, 'observerPoles')), {
    singleOutput: 'c',
    unobservable: 'c',
  });
  const x0 = inField('x0', () => readNumberList(text(values, 'x0')));
  if (x0.length !== n) throw new FieldProblem('x0', 'x0Length', { n: String(n) });
  const sim = observerResponses(ss, k.k, l.k, x0, spanFor([...k.closed, ...l.closed]));
  return {
    rows: [
      gainRow('k', k.k, 'K'),
      gainRow('l', l.k, 'L'),
      { id: 'closed', value: list(k.closed) },
      { id: 'observerClosed', value: list(l.closed) },
    ],
    steps: [
      ...k.steps,
      ...l.steps,
      step(
        'ss.separation',
        { poles: list([...k.closed, ...l.closed]) },
        `\\begin{bmatrix} A - BK & BK \\\\ 0 & A - LC \\end{bmatrix}`,
      ),
    ],
    plots: [
      response('observerPlot', sim.t, [
        { id: 'fullState', y: sim.fullState },
        { id: 'withObserver', y: sim.withObserver },
      ]),
    ],
    notes: [{ id: 'observerStart' }, { id: 'observerFaster' }],
  };
}

function runLqr(values: Values): Outcome {
  const ss = model(values);
  const q = inField('q', () => readNumberMatrix(text(values, 'q')));
  const rw = inField('r', () => readNumberMatrix(text(values, 'r')));
  const r = inField(null, () => lqr(ss.a, ss.b, q, rw), {
    qShape: 'q',
    qSymmetric: 'q',
    qNegative: 'q',
    rShape: 'r',
    rPositive: 'r',
  });
  const sim = ss.b[0].length === 1 && ss.c.length === 1 ? stepResponse(ss, r.k, false, spanFor(r.closed)) : null;
  return {
    rows: [
      gainRow('k', r.k, 'K'),
      { id: 'p', value: matrixText(r.p), tex: `P = ${matrixTex(r.p)}` },
      { id: 'closed', value: list(r.closed) },
      { id: 'residual', value: r.residual.toExponential(1) },
    ],
    steps: r.steps,
    plots: [
      ...(sim ? [response('stepPlot', sim.t, [{ id: '', y: sim.y }])] : []),
      poleZeroMap('closedMap', r.closed, [], 's'),
    ],
    notes: [{ id: 'lqrWeights' }, { id: 'lqrConditions' }],
  };
}

const RUN: Readonly<Record<string, (values: Values) => Outcome>> = {
  analyze: runAnalyze,
  place: runPlace,
  observer: runObserver,
  lqr: runLqr,
};

export const spec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: Object.keys(RUN), first: 'place' },
    { id: 'a', type: 'text', rows: 3, first: '0 1\n0 0' },
    { id: 'b', type: 'text', rows: 3, first: '0\n1' },
    { id: 'c', type: 'text', rows: 1, first: '1 0' },
    { id: 'd', type: 'text', rows: 1, first: '' },
    { id: 'poles', type: 'text', first: '-2 ± 2i', when: mode('place', 'observer') },
    { id: 'integral', type: 'choice', options: ['none', 'integral'], first: 'none', when: mode('place') },
    { id: 'observerPoles', type: 'text', first: '-5, -5', when: mode('observer') },
    { id: 'x0', type: 'text', first: '1, 0', when: mode('observer') },
    { id: 'q', type: 'text', rows: 3, first: '1 0\n0 1', when: mode('lqr') },
    { id: 'r', type: 'text', rows: 1, first: '1', when: mode('lqr') },
  ],
  run(values) {
    return (RUN[text(values, 'mode')] ?? runPlace)(values);
  },
  examples: [
    { id: 'place', texts: { mode: 'place', a: '0 1\n0 0', b: '0\n1', c: '1 0', poles: '-2 ± 2i' } },
    {
      id: 'integral',
      texts: { mode: 'place', a: '0 1\n0 0', b: '0\n1', c: '1 0', poles: '-2, -2, -2', integral: 'integral' },
    },
    {
      id: 'observer',
      texts: { mode: 'observer', a: '0 1\n0 0', b: '0\n1', c: '1 0', poles: '-2 ± 2i', observerPoles: '-5, -5' },
    },
    { id: 'lqr', texts: { mode: 'lqr', a: '0 1\n0 0', b: '0\n1', c: '1 0', q: '1 0\n0 1', r: '1' } },
    {
      id: 'uncontrollable',
      texts: { mode: 'analyze', a: '-1 0\n0 -2', b: '1\n0', c: '1 1' },
    },
    {
      id: 'mass',
      texts: { mode: 'analyze', a: '0 1\n-4 -0.8', b: '0\n1', c: '1 0' },
    },
  ],
};
