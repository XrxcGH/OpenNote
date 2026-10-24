// The probability distributions and inference tool: probabilities and quantiles of fourteen distributions with the
// region shaded, confidence intervals, hypothesis tests with the rejection region drawn, goodness of fit, and the
// power of a z test.
import { ControlError, readNumberList } from '../lib/errors';
import { fmt } from '../lib/tf';
import type { PlotSpec, Series } from '../ui/plot';
import { inField } from '../ui/read';
import { FieldProblem, type Field, type Outcome, type Row, type ToolSpec, type Values } from '../ui/spec';
import {
  chi2Quantile,
  DISTRIBUTIONS,
  makeDist,
  plotData,
  probability,
  quantileOf,
  type Dist,
  type DistId,
  type RegionKind,
} from './engine';
import {
  ciMean,
  ciProportion,
  ciVariance,
  goodnessOfFit,
  powerZ,
  summarize,
  testMean,
  testPaired,
  testProportion,
  testTwoMeans,
  testVariance,
  type Alternative,
  type Summary,
  type TestResult,
} from './inference';

type Texts = Readonly<Record<string, string>>;
const DIST_IDS = Object.keys(DISTRIBUTIONS) as DistId[];
const PARAM_IDS = [...new Set(DIST_IDS.flatMap((id) => DISTRIBUTIONS[id].params.map((p) => p.id)))];
const text = (v: Values, id: string) => String(v[id] ?? '');
const num = (v: Values, id: string) => Number(v[id]);

const mode = (m: string) => (t: Texts) => t.mode === m;
const usesDist = (t: Texts) => t.mode === 'probability' || t.mode === 'quantile';
const twoEnded = (region: string) => region === 'between' || region === 'outside';
const fromData = (t: Texts) => t.source === 'data';
const isInterval = (t: Texts, target: string) => t.mode === 'interval' && t.target === target;
const isTest = (t: Texts, test: string) => t.mode === 'test' && t.test === test;
const proportion = (t: Texts) => isInterval(t, 'proportion') || isTest(t, 'proportion');
const variance = (t: Texts) => isInterval(t, 'variance') || isTest(t, 'variance');
/** A sample described by n, mean, and s, or by its data. */
const summaryNeeded = (t: Texts) => isInterval(t, 'mean') || isTest(t, 'mean') || isTest(t, 'twoMeans') || variance(t);
const summaryNumbers = (t: Texts) => summaryNeeded(t) && !fromData(t);

function paramFields(): Field[] {
  return PARAM_IDS.map((id) => {
    const fallback = DIST_IDS.flatMap((d) => DISTRIBUTIONS[d].params).find((p) => p.id === id)?.fallback ?? 1;
    return {
      id,
      type: 'number',
      first: String(fallback),
      when: (t: Texts) => usesDist(t) && (DISTRIBUTIONS[t.dist as DistId]?.params ?? []).some((p) => p.id === id),
    };
  });
}

function distOf(values: Values): Dist {
  const id = text(values, 'dist') as DistId;
  const params = DISTRIBUTIONS[id].params.map((p) => num(values, p.id));
  try {
    return makeDist(id, params);
  } catch (error) {
    if (error instanceof ControlError && error.vars.name) {
      throw new FieldProblem(error.vars.name, error.code, error.vars);
    }
    throw error;
  }
}

/** The density or bars of a distribution, with the points inside a region shaded. */
function distPlot(id: string, dist: Dist, inside: (x: number) => boolean, mark?: number): PlotSpec {
  const data = plotData(dist, inside);
  const pts = data.xs.map((x, i) => [x, data.ys[i]] as const);
  const series: Series[] = dist.discrete
    ? [
        { id: 'outside', style: 'bars', points: pts.filter((_, i) => !data.inside[i]) },
        { id: 'inside', style: 'bars', fill: true, pen: 1, points: pts.filter((_, i) => data.inside[i]) },
      ]
    : [
        {
          id: 'inside',
          style: 'line',
          fill: true,
          pen: 1,
          points: pts.map((p, i) => (data.inside[i] ? p : ([p[0], Number.NaN] as const))),
        },
        { id: 'density', style: 'line', pen: 0, points: pts },
      ];
  return {
    id,
    x: { label: 'x' },
    y: { label: dist.discrete ? 'pmf' : 'pdf', min: 0 },
    series,
    ...(mark !== undefined && Number.isFinite(mark) ? { vlines: [{ at: mark, pen: 2 }] } : {}),
  };
}

function inRegion(kind: RegionKind, a: number, b: number): (x: number) => boolean {
  const eps = 1e-9;
  switch (kind) {
    case 'le':
      return (x) => x <= a + eps;
    case 'lt':
      return (x) => x < a - eps;
    case 'ge':
      return (x) => x >= a - eps;
    case 'gt':
      return (x) => x > a + eps;
    case 'eq':
      return (x) => Math.abs(x - a) < eps;
    case 'between':
      return (x) => x >= a - eps && x <= b + eps;
    default:
      return (x) => x < a - eps || x > b + eps;
  }
}

function runProbability(values: Values): Outcome {
  const dist = distOf(values);
  const kind = text(values, 'region') as RegionKind;
  const a = num(values, 'a');
  const b = twoEnded(kind) ? num(values, 'b') : a;
  if (kind === 'eq' && !dist.discrete) throw new FieldProblem('region', 'pointContinuous');
  const r = inField(null, () => probability(dist, { kind, a, b }), { regionOrder: 'b', regionNumber: 'a' });
  return {
    rows: [
      { id: 'probability', value: fmt(r.p), tex: `P = ${fmt(r.p)}`, answer: true },
      { id: 'model', value: r.label },
      { id: 'mean', value: fmt(r.mean) },
      { id: 'variance', value: fmt(r.variance) },
      { id: 'sd', value: fmt(Math.sqrt(r.variance)) },
    ],
    steps: r.steps,
    plots: [distPlot('region', dist, inRegion(kind, a, b))],
  };
}

function runQuantile(values: Values): Outcome {
  const dist = distOf(values);
  const r = inField('prob', () => quantileOf(dist, num(values, 'prob')));
  return {
    rows: [
      { id: 'quantile', value: fmt(r.x), tex: `x = ${fmt(r.x)}`, answer: true },
      { id: 'model', value: dist.label },
    ],
    steps: r.steps,
    plots: [distPlot('quantilePlot', dist, (x) => x <= r.x + 1e-9, r.x)],
  };
}

function summaryOf(values: Values, prefix = ''): Summary {
  if (text(values, 'source') === 'data') {
    const field = prefix ? 'data2' : 'data';
    return inField(field, () => summarize(readNumberList(text(values, field))));
  }
  return { n: num(values, `${prefix}size`), mean: num(values, `${prefix}avg`), sd: num(values, `${prefix}sdev`) };
}

const pair = (a: number, b: number) => `(${fmt(a)}, ${fmt(b)})`;

const intervalRows = (lower: number, upper: number, extra: Row[] = []): Row[] => [
  { id: 'interval', value: pair(lower, upper), tex: `(${fmt(lower)},\\ ${fmt(upper)})`, answer: true },
  ...extra,
];

const SAMPLE_FIELDS = { needTwo: 'size', nWhole: 'size', sdPositive: 'sdev', successesRange: 'count' };

function runInterval(values: Values): Outcome {
  const conf = num(values, 'conf') / 100;
  const target = text(values, 'target');
  const byCode = { ...SAMPLE_FIELDS, confidenceRange: 'conf', variancePositive: 'sdev' };
  if (target === 'proportion') {
    const r = inField(null, () => ciProportion(num(values, 'count'), num(values, 'size'), conf), byCode);
    return {
      rows: intervalRows(r.lower, r.upper, [
        { id: 'estimate', value: fmt(r.estimate) },
        { id: 'wilson', value: pair(r.wilson[0], r.wilson[1]) },
        { id: 'critical', value: fmt(r.critical) },
      ]),
      steps: r.steps,
      notes: [{ id: 'proportion' }],
    };
  }
  const s = summaryOf(values);
  if (target === 'variance') {
    const r = inField(null, () => ciVariance(s.sd * s.sd, s.n, conf), byCode);
    return {
      rows: intervalRows(r.lower, r.upper, [
        { id: 'sdInterval', value: pair(r.sdLower, r.sdUpper) },
        { id: 'df', value: String(r.df) },
      ]),
      steps: r.steps,
      notes: [{ id: 'normalPopulation' }],
    };
  }
  const known = text(values, 'sigma') === 'known';
  const r = inField(null, () => ciMean({ ...s, conf, knownSigma: known }), byCode);
  return {
    rows: intervalRows(r.lower, r.upper, [
      { id: 'estimate', value: fmt(r.estimate) },
      { id: 'halfWidth', value: fmt(r.halfWidth) },
      { id: 'critical', value: fmt(r.critical) },
      ...(r.df !== undefined ? [{ id: 'df', value: String(r.df) }] : []),
    ]),
    steps: r.steps,
    notes: [{ id: known ? 'knownSigma' : 'tInterval' }],
  };
}

/** The null distribution of the statistic with the rejection region shaded and the statistic marked. */
function testPlot(r: TestResult, alt: Alternative): PlotSpec {
  const df = r.df ?? 1;
  const dist = r.kind === 'z' ? makeDist('normal', [0, 1]) : makeDist(r.kind === 't' ? 't' : 'chi2', [df]);
  const c = r.critical;
  // A two-sided chi-square test rejects in both tails, which are not mirror images.
  const [lowTail, highTail] = [chi2Quantile(r.alpha / 2, df), chi2Quantile(1 - r.alpha / 2, df)];
  const reject = (x: number) => {
    if (alt === 'greater') return x >= c;
    if (alt === 'less') return x <= c;
    if (r.kind === 'chi2') return x <= lowTail || x >= highTail;
    return Math.abs(x) >= Math.abs(c);
  };
  return distPlot('nullPlot', dist, reject, r.statistic);
}

function testRows(r: TestResult): Row[] {
  const sym = r.kind === 'chi2' ? '\\chi^2' : r.kind;
  return [
    {
      id: 'statistic',
      vars: { kind: r.kind === 'chi2' ? 'χ²' : r.kind },
      value: fmt(r.statistic),
      tex: `${sym} = ${fmt(r.statistic)}`,
      answer: true,
    },
    ...(r.df !== undefined ? [{ id: 'df', value: fmt(r.df) }] : []),
    { id: 'pValue', value: fmt(r.p), tex: `p = ${fmt(r.p)}`, answer: true },
    { id: 'critical', value: fmt(r.critical) },
    { id: 'decision', value: r.reject ? '✓' : '✗' },
    ...(r.interval ? [{ id: 'testInterval', value: pair(r.interval[0], r.interval[1]) }] : []),
  ];
}

function runTest(values: Values): Outcome {
  const alt = text(values, 'alt') as Alternative;
  const alpha = num(values, 'level');
  const h0 = num(values, 'h0');
  const test = text(values, 'test');
  const byCode = { ...SAMPLE_FIELDS, alphaRange: 'level' };
  let r: TestResult;
  if (test === 'mean') {
    const s = summaryOf(values);
    const knownSigma = text(values, 'sigma') === 'known';
    r = inField(null, () => testMean({ ...s, mu0: h0, alt, alpha, knownSigma }), byCode);
  } else if (test === 'twoMeans') {
    const a = summaryOf(values);
    const b = summaryOf(values, 'second');
    const pooled = text(values, 'pool') === 'pooled';
    r = inField(null, () => testTwoMeans({ a, b, delta0: h0, alt, alpha, pooled }), byCode);
  } else if (test === 'paired') {
    const first = inField('data', () => readNumberList(text(values, 'data')));
    const second = inField('data2', () => readNumberList(text(values, 'data2')));
    r = inField(null, () => testPaired(first, second, h0, alt, alpha), {
      ...byCode,
      pairedLength: 'data2',
      needTwo: 'data',
    });
  } else if (test === 'proportion') {
    r = inField(null, () => testProportion(num(values, 'count'), num(values, 'size'), h0, alt, alpha), {
      ...byCode,
      probabilityOpen: 'h0',
    });
  } else {
    const s = summaryOf(values);
    r = inField(null, () => testVariance(s.sd * s.sd, s.n, h0, alt, alpha), { ...byCode, variancePositive: 'h0' });
  }
  return {
    rows: testRows(r),
    steps: r.steps,
    plots: [testPlot(r, alt)],
    notes: [{ id: r.reject ? 'reject' : 'keep', vars: { alpha: fmt(alpha) } }],
  };
}

function runFit(values: Values): Outcome {
  const observed = inField('observed', () => readNumberList(text(values, 'observed')));
  const typed = text(values, 'expected').trim();
  const expected = typed ? inField('expected', () => readNumberList(typed)) : observed.map(() => 1);
  const alpha = num(values, 'level');
  const r = inField(null, () => goodnessOfFit(observed, expected, alpha, num(values, 'estimated')), {
    alphaRange: 'level',
    gofLength: 'expected',
    gofValues: 'observed',
    gofCategories: 'observed',
    gofDf: 'estimated',
  });
  return {
    rows: testRows(r),
    steps: r.steps,
    tables: [
      {
        id: 'cells',
        columns: ['category', 'observed', 'expected', 'contribution'],
        rows: observed.map((o, i) => [String(i + 1), fmt(o), fmt(r.expected[i]), fmt(r.contributions[i])]),
      },
    ],
    plots: [testPlot(r, 'greater')],
    notes: [{ id: r.reject ? 'reject' : 'keep', vars: { alpha: fmt(alpha) } }],
  };
}

function runPower(values: Values): Outcome {
  const input = {
    mu0: num(values, 'h0'),
    mu1: num(values, 'mu1'),
    sigma: num(values, 'sdev'),
    n: num(values, 'size'),
    alpha: num(values, 'level'),
    alt: text(values, 'alt') as Alternative,
  };
  const r = inField(null, () => powerZ(input), { ...SAMPLE_FIELDS, alphaRange: 'level' });
  return {
    rows: [
      { id: 'power', value: fmt(r.power), tex: `1 - \\beta = ${fmt(r.power)}`, answer: true },
      { id: 'beta', value: fmt(1 - r.power) },
    ],
    steps: r.steps,
    notes: [{ id: 'knownSigma' }],
  };
}

export const spec: ToolSpec = {
  fields: [
    {
      id: 'mode',
      type: 'choice',
      options: ['probability', 'quantile', 'interval', 'test', 'gof', 'power'],
      first: 'probability',
    },
    { id: 'dist', type: 'choice', options: DIST_IDS, first: 'normal', when: usesDist },
    ...paramFields(),
    {
      id: 'region',
      type: 'choice',
      options: ['le', 'lt', 'ge', 'gt', 'eq', 'between', 'outside'],
      first: 'le',
      when: mode('probability'),
    },
    { id: 'a', type: 'number', first: '1', when: mode('probability') },
    { id: 'b', type: 'number', first: '2', when: (t) => t.mode === 'probability' && twoEnded(t.region) },
    { id: 'prob', type: 'number', first: '0.95', when: mode('quantile') },
    {
      id: 'target',
      type: 'choice',
      options: ['mean', 'proportion', 'variance'],
      first: 'mean',
      when: mode('interval'),
    },
    {
      id: 'test',
      type: 'choice',
      options: ['mean', 'twoMeans', 'paired', 'proportion', 'variance'],
      first: 'mean',
      when: mode('test'),
    },
    { id: 'source', type: 'choice', options: ['summary', 'data'], first: 'summary', when: summaryNeeded },
    { id: 'size', type: 'number', first: '10', when: (t) => summaryNumbers(t) || t.mode === 'power' || proportion(t) },
    { id: 'count', type: 'number', first: '58', when: proportion },
    { id: 'avg', type: 'number', first: '5', when: (t) => summaryNumbers(t) && !variance(t) },
    { id: 'sdev', type: 'number', first: '1', when: (t) => summaryNumbers(t) || t.mode === 'power' },
    {
      id: 'data',
      type: 'text',
      rows: 3,
      first: '',
      when: (t) => (summaryNeeded(t) && fromData(t)) || isTest(t, 'paired'),
    },
    { id: 'secondsize', type: 'number', first: '12', when: (t) => isTest(t, 'twoMeans') && !fromData(t) },
    { id: 'secondavg', type: 'number', first: '12', when: (t) => isTest(t, 'twoMeans') && !fromData(t) },
    { id: 'secondsdev', type: 'number', first: '3', when: (t) => isTest(t, 'twoMeans') && !fromData(t) },
    {
      id: 'data2',
      type: 'text',
      rows: 3,
      first: '',
      when: (t) => (isTest(t, 'twoMeans') && fromData(t)) || isTest(t, 'paired'),
    },
    { id: 'pool', type: 'choice', options: ['welch', 'pooled'], first: 'welch', when: (t) => isTest(t, 'twoMeans') },
    {
      id: 'sigma',
      type: 'choice',
      options: ['unknown', 'known'],
      first: 'unknown',
      when: (t) => isInterval(t, 'mean') || isTest(t, 'mean'),
    },
    { id: 'conf', type: 'number', first: '95', when: mode('interval') },
    { id: 'h0', type: 'number', first: '0', when: (t) => t.mode === 'test' || t.mode === 'power' },
    { id: 'mu1', type: 'number', first: '0.5', when: mode('power') },
    {
      id: 'alt',
      type: 'choice',
      options: ['two', 'less', 'greater'],
      first: 'two',
      when: (t) => t.mode === 'test' || t.mode === 'power',
    },
    { id: 'level', type: 'number', first: '0.05', when: (t) => ['test', 'gof', 'power'].includes(t.mode) },
    { id: 'observed', type: 'text', first: '18 22 20 25 15', when: mode('gof') },
    { id: 'expected', type: 'text', first: '', when: mode('gof') },
    { id: 'estimated', type: 'number', first: '0', when: mode('gof') },
  ],
  run(values) {
    const m = text(values, 'mode');
    if (m === 'quantile') return runQuantile(values);
    if (m === 'interval') return runInterval(values);
    if (m === 'test') return runTest(values);
    if (m === 'gof') return runFit(values);
    if (m === 'power') return runPower(values);
    return runProbability(values);
  },
  examples: [
    { id: 'poisson', texts: { mode: 'probability', dist: 'poisson', lambda: '3', region: 'le', a: '2' } },
    { id: 'binomial', texts: { mode: 'probability', dist: 'binomial', n: '10', p: '0.3', region: 'eq', a: '2' } },
    {
      id: 'normal',
      texts: { mode: 'probability', dist: 'normal', mean: '0', sd: '1', region: 'between', a: '-1.96', b: '1.96' },
    },
    { id: 'tQuantile', texts: { mode: 'quantile', dist: 't', df: '9', prob: '0.975' } },
    {
      id: 'tInterval',
      texts: { mode: 'interval', target: 'mean', source: 'summary', size: '10', avg: '5', sdev: '1', conf: '95' },
    },
    {
      id: 'varInterval',
      texts: { mode: 'interval', target: 'variance', source: 'summary', size: '10', sdev: '1', conf: '95' },
    },
    {
      id: 'welch',
      texts: {
        mode: 'test',
        test: 'twoMeans',
        source: 'summary',
        size: '15',
        avg: '10',
        sdev: '2',
        secondsize: '12',
        secondavg: '12',
        secondsdev: '3',
        pool: 'welch',
        h0: '0',
        alt: 'two',
        level: '0.05',
      },
    },
    {
      id: 'proportion',
      texts: { mode: 'test', test: 'proportion', count: '58', size: '100', h0: '0.5', alt: 'greater', level: '0.05' },
    },
    { id: 'dice', texts: { mode: 'gof', observed: '8 12 9 11 6 14', expected: '', estimated: '0', level: '0.05' } },
    {
      id: 'power',
      texts: { mode: 'power', h0: '0', mu1: '0.5', sdev: '1', size: '25', level: '0.05', alt: 'greater' },
    },
  ],
};
