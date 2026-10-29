// The response times and movement tool's fields, tables, steps, and plots.
import { percentText } from '../kit/format';
import { readList, readMatrix } from '../kit/parse';
import { makeRng } from '../kit/rng';
import { num, str, type Outcome, type ToolSpec, type Values } from '../kit/spec';
import { fail, step } from '../kit/types';
import {
  checkExGauss,
  exGaussMoments,
  exGaussPdf,
  exGaussQuantile,
  fitExGauss,
  fitts,
  hick,
  readTrials,
  summarizeConditions,
  trim,
  vincentize,
  type TrimRule,
} from './engine';

const isMode = (mode: string) => (v: Values) => v.mode === mode;
const usesTrials = (v: Values) => v.mode === 'trials' || v.mode === 'quantiles';
const cell = (value: number) => (Number.isNaN(value) ? '' : value);
const grid = (n: number, lo: number, hi: number) => Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);
const DECILES = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];

/** A small seeded example, so the first texts are the same on every device. */
function exampleTrials(): string {
  const rng = makeRng(5);
  const out = ['subject, condition, rt, correct'];
  for (const s of ['s1', 's2', 's3', 's4'])
    for (const [c, shift] of [
      ['congruent', 0],
      ['incongruent', 60],
    ] as const)
      for (let i = 0; i < 8; i += 1) {
        const rt = Math.round(380 + shift + 30 * rng.normal() - 80 * Math.log(1 - rng.next()));
        out.push(`${s}, ${c}, ${rt}, ${rng.next() < 0.9 ? 1 : 0}`);
      }
  out.push('s2, congruent, 2900, 1', 's3, incongruent, 120, 1');
  return out.join('\n');
}

function exampleRts(): string {
  const rng = makeRng(9);
  return Array.from({ length: 80 }, () => Math.round(400 + 40 * rng.normal() - 100 * Math.log(1 - rng.next()))).join(
    ', ',
  );
}

function trimmed(values: Values) {
  const { trials, hasAccuracy, skipped } = readTrials(str(values, 'trials'));
  const min = Number.isNaN(num(values, 'min')) ? -Infinity : num(values, 'min');
  const max = Number.isNaN(num(values, 'max')) ? Infinity : num(values, 'max');
  const t = trim(trials, min, max, str(values, 'rule') as TrimRule, num(values, 'k'));
  return { trials, hasAccuracy, skipped, t };
}

function runTrials(values: Values): Outcome {
  const { trials, hasAccuracy, skipped, t } = trimmed(values);
  const r = summarizeConditions(trials, t.kept, hasAccuracy);
  const unit = str(values, 'unit');
  const removed = t.belowMin + t.aboveMax + t.byRule;
  const correct = trials.length - t.errors;
  return {
    rows: [
      { id: 'trials', value: trials.length },
      { id: 'subjects', value: r.subjects.length },
      { id: 'errors', value: t.errors },
      { id: 'removed', value: removed },
      { id: 'removedShare', value: percentText(correct > 0 ? removed / correct : NaN) },
      { id: 'kept', value: t.kept.length, answer: true },
    ],
    tables: [
      {
        id: 'removal',
        columns: ['reason', 'count'],
        rows: [
          [{ word: 'missing' }, skipped],
          [{ word: 'errors' }, t.errors],
          [{ word: 'belowMin' }, t.belowMin],
          [{ word: 'aboveMax' }, t.aboveMax],
          [{ word: str(values, 'rule') }, t.byRule],
        ],
      },
      {
        id: 'conditions',
        columns: ['condition', 'kept', 'mean', 'median', 'halfWidth', 'accuracy', 'ies'],
        rows: r.summaries.map((s) => [
          s.condition,
          s.trials,
          cell(s.mean),
          cell(s.median),
          cell(s.halfWidth),
          Number.isNaN(s.accuracy) ? '' : percentText(s.accuracy),
          cell(s.ies),
        ]),
      },
    ],
    pictures: [
      {
        id: 'means',
        plot: {
          x: { id: 'condition' },
          y: { id: unit === 's' ? 'rtS' : 'rtMs' },
          series: [
            {
              id: 'means',
              points: r.summaries.map((s, i) => [i + 1, s.mean] as const),
              kind: 'points',
              errors: r.summaries.map((s) => (Number.isNaN(s.halfWidth) ? 0 : s.halfWidth)),
            },
          ],
        },
      },
    ],
    notes: [
      { id: 'conditionOrder', vars: { list: r.conditions.map((c, i) => `${i + 1} = ${c}`).join(', ') } },
      ...(r.summaries.some((s) => Number.isNaN(s.halfWidth)) ? [{ id: 'incomplete' }] : []),
    ],
    steps: [
      step('rt.order'),
      step(`rt.${str(values, 'rule') as TrimRule}`, undefined, { k: num(values, 'k') }),
      step('rt.subjectMeans'),
      step(
        'rt.morey',
        'z_{ij} = y_{ij} - \\bar y_i + \\bar y,\\quad h_j = t_{.975,\\,n-1}\\,\\frac{s_j(z)}{\\sqrt n}\\sqrt{\\frac{k}{k-1}}',
      ),
      ...(hasAccuracy ? [step('rt.ies', '\\text{IES} = \\frac{\\overline{RT}}{\\text{accuracy}}')] : []),
    ],
  };
}

function runExGauss(values: Values): Outcome {
  if (values.source === 'params') {
    const p = checkExGauss({ mu: num(values, 'mu'), sigma: num(values, 'sigma'), tau: num(values, 'tau') });
    const x = num(values, 'x');
    const m = exGaussMoments(p);
    const d = exGaussPdf(x, p);
    const vars = { ...p, x, d, mean: m.mean, sd: m.sd };
    const xs = grid(160, Math.max(0, m.mean - 4 * m.sd), m.mean + 6 * m.sd);
    return {
      rows: [
        { id: 'density', value: d, sym: 'f(x)', answer: true },
        { id: 'mean', value: m.mean, sym: '\\mu + \\tau' },
        { id: 'sd', value: m.sd, sym: '\\sqrt{\\sigma^2 + \\tau^2}' },
      ],
      pictures: [
        {
          id: 'pdf',
          plot: {
            x: { id: 'rt' },
            y: { id: 'density', min: 0 },
            series: [{ id: 'fit', points: xs.map((t) => [t, exGaussPdf(t, p)] as const) }],
            marks: [{ x }],
          },
        },
      ],
      steps: [
        step(
          'rt.exPdf',
          'f(x) = \\frac{1}{\\tau}\\exp\\!\\left(\\frac{\\mu}{\\tau} + \\frac{\\sigma^2}{2\\tau^2} - \\frac{x}{\\tau}\\right)\\Phi\\!\\left(\\frac{x - \\mu}{\\sigma} - \\frac{\\sigma}{\\tau}\\right) = [[d]]',
          vars,
        ),
        step('rt.exMoments', '\\text{mean} = [[mean]],\\quad \\text{SD} = [[sd]]', vars),
      ],
    };
  }
  const rts = readList(str(values, 'rts'), 'rts');
  const fit = fitExGauss(rts);
  const m = exGaussMoments(fit);
  const sorted = [...rts].sort((a, b) => a - b);
  const n = sorted.length;
  const every = Math.max(1, Math.ceil(n / 60));
  const qq = sorted
    .map((x, i) => [i, x] as const)
    .filter(([i]) => i % every === 0)
    .map(([i, x]) => [exGaussQuantile((i + 0.5) / n, fit), x] as const);
  const lo = sorted[0];
  const hi = sorted[n - 1];
  const bins = Math.min(30, Math.max(6, Math.round(Math.sqrt(n))));
  const width = (hi - lo) / bins || 1;
  const counts = Array.from({ length: bins }, () => 0);
  for (const x of sorted) counts[Math.min(bins - 1, Math.floor((x - lo) / width))] += 1;
  return {
    rows: [
      { id: 'n', value: n },
      { id: 'mu', value: fit.mu, sym: '\\mu', answer: true },
      { id: 'sigma', value: fit.sigma, sym: '\\sigma', answer: true },
      { id: 'tau', value: fit.tau, sym: '\\tau', answer: true },
      { id: 'mean', value: m.mean, sym: '\\mu + \\tau' },
      { id: 'logLik', value: fit.logLik, sym: '\\ln L' },
    ],
    pictures: [
      {
        id: 'fit',
        plot: {
          x: { id: 'rt' },
          y: { id: 'density', min: 0 },
          series: [
            {
              id: 'data',
              points: counts.map((c, i) => [lo + (i + 0.5) * width, c / (n * width)] as const),
              kind: 'bars',
            },
            { id: 'fit', points: grid(160, lo, hi).map((t) => [t, exGaussPdf(t, fit)] as const) },
          ],
        },
      },
      {
        id: 'qq',
        plot: {
          x: { id: 'fitted' },
          y: { id: 'observed' },
          diagonal: true,
          square: true,
          series: [{ id: 'data', points: qq, kind: 'points' }],
        },
      },
    ],
    steps: [
      step('rt.exStart'),
      step('rt.exFit', '\\ln L = \\sum_i \\ln f(x_i;\\, \\mu, \\sigma, \\tau) = [[ll]]', { ll: fit.logLik }),
      step('rt.qq'),
    ],
  };
}

function runQuantiles(values: Values): Outcome {
  const { t } = trimmed(values);
  const names = str(values, 'compare')
    .split(/[,;|]/)
    .map((one) => one.trim())
    .filter((one) => one !== '');
  if (names.length !== 2) fail('twoConditions', {}, 'compare');
  const [a, b] = names.map((c) => vincentize(t.kept, c, DECILES));
  const unit = str(values, 'unit') === 's' ? 'rtS' : 'rtMs';
  return {
    rows: [
      { id: 'subjects', value: Math.min(a.subjects, b.subjects) },
      { id: 'medianDelta', value: b.quantiles[4] - a.quantiles[4], answer: true },
    ],
    tables: [
      {
        id: 'vincentiles',
        columns: ['quantile', { raw: names[0] }, { raw: names[1] }, 'delta'],
        rows: DECILES.map((p, i) => [p, a.quantiles[i], b.quantiles[i], b.quantiles[i] - a.quantiles[i]]),
      },
    ],
    pictures: [
      {
        id: 'quantiles',
        plot: {
          x: { id: 'quantile', min: 0, max: 1 },
          y: { id: unit },
          series: [
            { id: 'condition', label: names[0], points: DECILES.map((p, i) => [p, a.quantiles[i]] as const) },
            { id: 'condition', label: names[1], points: DECILES.map((p, i) => [p, b.quantiles[i]] as const) },
          ],
        },
      },
      {
        id: 'delta',
        plot: {
          x: { id: 'meanQuantile' },
          y: { id: 'delta' },
          series: [
            {
              id: 'delta',
              points: DECILES.map(
                (_, i) => [(a.quantiles[i] + b.quantiles[i]) / 2, b.quantiles[i] - a.quantiles[i]] as const,
              ),
            },
          ],
        },
      },
    ],
    steps: [step('rt.vincent'), step('rt.deltaPlot')],
  };
}

function runFitts(values: Values): Outcome {
  const { rows } = readMatrix(str(values, 'fitts'), 'fitts');
  if (rows[0].length !== 3) fail('ragged', { line: 1, got: rows[0].length, want: 3 }, 'fitts');
  const r = fitts(rows);
  const perSecond = str(values, 'unit') === 's' ? 1 : 1000;
  const vars = {
    a: r.a,
    b: r.b,
    r2: r.r2,
    d: rows[0][0],
    w: rows[0][1],
    id: r.ids[0],
    inv: perSecond / r.b,
    tp: r.throughput * perSecond,
  };
  const ids = r.ids;
  return {
    rows: [
      { id: 'a', value: r.a, sym: 'a', answer: true },
      { id: 'b', value: r.b, sym: 'b', answer: true },
      { id: 'r2', value: r.r2, sym: 'r^2' },
      { id: 'inverseB', value: perSecond / r.b, sym: '1/b' },
      { id: 'throughput', value: r.throughput * perSecond, sym: 'TP' },
    ],
    tables: [
      {
        id: 'fitts',
        columns: ['distance', 'width', 'id', 'mt', 'predicted'],
        rows: rows.map(([d, w, mt], i) => [d, w, ids[i], mt, r.a + r.b * ids[i]]),
      },
    ],
    pictures: [
      {
        id: 'fitts',
        plot: {
          x: { id: 'idBits', min: 0 },
          y: { id: str(values, 'unit') === 's' ? 'mtS' : 'mtMs' },
          series: [
            { id: 'data', points: rows.map((row, i) => [ids[i], row[2]] as const), kind: 'points' },
            { id: 'line', points: [0, Math.max(...ids)].map((x) => [x, r.a + r.b * x] as const) },
          ],
        },
      },
    ],
    steps: [
      step(
        'rt.fittsId',
        'ID = \\log_2\\!\\left(\\frac{D}{W} + 1\\right) = \\log_2\\!\\left(\\frac{[[d]]}{[[w]]} + 1\\right) = [[id]]\\ \\text{bits}',
        vars,
      ),
      step('rt.fittsLine', 'MT = a + b\\,ID = [[a]] + [[b]]\\,ID,\\quad r^2 = [[r2]]', vars),
      step('rt.throughput', '\\frac{1}{b} = [[inv]],\\quad TP = \\overline{ID/MT} = [[tp]]\\ \\text{bits/s}', vars),
    ],
  };
}

function runHick(values: Values): Outcome {
  const { rows } = readMatrix(str(values, 'hick'), 'hick');
  if (rows[0].length !== 2) fail('ragged', { line: 1, got: rows[0].length, want: 2 }, 'hick');
  const plusOne = values.plusOne === 'yes';
  const r = hick(rows, plusOne);
  return {
    rows: [
      { id: 'a', value: r.a, sym: 'a', answer: true },
      { id: 'b', value: r.b, sym: 'b', answer: true },
      { id: 'r2', value: r.r2, sym: 'r^2' },
    ],
    pictures: [
      {
        id: 'hick',
        plot: {
          x: { id: 'hBits', min: 0 },
          y: { id: str(values, 'unit') === 's' ? 'rtS' : 'rtMs' },
          series: [
            { id: 'data', points: rows.map((row, i) => [r.x[i], row[1]] as const), kind: 'points' },
            { id: 'line', points: [0, Math.max(...r.x)].map((x) => [x, r.a + r.b * x] as const) },
          ],
        },
      },
    ],
    steps: [
      step(plusOne ? 'rt.hickPlus' : 'rt.hick', plusOne ? 'H = \\log_2(N + 1)' : 'H = \\log_2 N'),
      step('rt.hickLine', 'RT = a + bH = [[a]] + [[b]]\\,H', { a: r.a, b: r.b }),
    ],
  };
}

export const spec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: ['trials', 'exgauss', 'quantiles', 'fitts', 'hick'], first: 'trials' },
    { id: 'unit', type: 'choice', options: ['ms', 's'], first: 'ms' },
    { id: 'trials', type: 'text', rows: 8, first: exampleTrials(), when: usesTrials },
    { id: 'min', type: 'number', first: '150', optional: true, when: usesTrials },
    { id: 'max', type: 'number', first: '2500', optional: true, when: usesTrials },
    { id: 'rule', type: 'choice', options: ['none', 'sd', 'mad', 'recursive'], first: 'sd', when: usesTrials },
    { id: 'k', type: 'number', first: '2.5', when: (v) => usesTrials(v) && v.rule !== 'none' },
    { id: 'compare', type: 'line', first: 'congruent, incongruent', when: isMode('quantiles') },
    { id: 'source', type: 'choice', options: ['data', 'params'], first: 'data', when: isMode('exgauss') },
    {
      id: 'rts',
      type: 'text',
      rows: 5,
      first: exampleRts(),
      when: (v) => v.mode === 'exgauss' && v.source !== 'params',
    },
    { id: 'mu', type: 'number', first: '400', when: (v) => v.mode === 'exgauss' && v.source === 'params' },
    { id: 'sigma', type: 'number', first: '40', when: (v) => v.mode === 'exgauss' && v.source === 'params' },
    { id: 'tau', type: 'number', first: '100', when: (v) => v.mode === 'exgauss' && v.source === 'params' },
    { id: 'x', type: 'number', first: '500', when: (v) => v.mode === 'exgauss' && v.source === 'params' },
    {
      id: 'fitts',
      type: 'text',
      rows: 5,
      first: 'distance | width | time\n64 | 32 | 310\n128 | 16 | 480\n256 | 16 | 610\n512 | 8 | 890',
      when: isMode('fitts'),
    },
    {
      id: 'hick',
      type: 'text',
      rows: 5,
      first: 'alternatives | time\n1 | 210\n2 | 330\n4 | 470\n8 | 590',
      when: isMode('hick'),
    },
    { id: 'plusOne', type: 'choice', options: ['no', 'yes'], first: 'no', when: isMode('hick') },
  ],
  run(values) {
    if (values.mode === 'exgauss') return runExGauss(values);
    if (values.mode === 'quantiles') return runQuantiles(values);
    if (values.mode === 'fitts') return runFitts(values);
    if (values.mode === 'hick') return runHick(values);
    return runTrials(values);
  },
  examples: [
    { id: 'trials', values: { mode: 'trials' } },
    { id: 'mad', values: { mode: 'trials', rule: 'mad', k: '3' } },
    { id: 'exgauss', values: { mode: 'exgauss' } },
    { id: 'density', values: { mode: 'exgauss', source: 'params' } },
    { id: 'delta', values: { mode: 'quantiles' } },
    { id: 'fitts', values: { mode: 'fitts', fitts: '1 | 1 | 300\n3 | 1 | 400\n7 | 1 | 500\n15 | 1 | 600' } },
    { id: 'hick', values: { mode: 'hick' } },
  ],
};
