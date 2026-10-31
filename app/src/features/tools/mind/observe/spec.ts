// The behavior observation tool's fields, tables, steps, and graphs. A session is typed as a timed log, so it can
// come from a stopwatch, a video's time stamps, or notes; single-case data are typed by phase.
import { percentText } from '../kit/format';
import type { PlotSeries } from '../kit/plot';
import { num, str, type Outcome, type ToolSpec, type Values } from '../kit/spec';
import { fail, positive, step } from '../kit/types';
import {
  observers,
  overlap,
  phaseSummary,
  readEthogram,
  readLog,
  readPhases,
  readRecord,
  scoreIntervals,
  summarize,
  boutsOf,
  type IntervalRule,
} from './engine';

const isMode = (mode: string) => (v: Values) => v.mode === mode;
const usesLog = (v: Values) => v.mode === 'session' || v.mode === 'intervals';
const cell = (value: number) => (Number.isNaN(value) ? '' : value);
const raw = (text: string) => ({ raw: text });

const ETHOGRAM = [
  '# behavior | event or state | exclusive group',
  'rest | state | activity',
  'feed | state | activity',
  'call | event',
].join('\n');
const LOG = [
  '# seconds | behavior | start or stop',
  '0 | rest',
  '12 | call',
  '30 | feed',
  '41 | call',
  '75 | rest',
  '90 | call',
].join('\n');
const PHASES = ['# phase | values in session order', 'A | 3, 4, 5, 4', 'B | 6, 5, 7, 8, 4'].join('\n');

function readSession(values: Values) {
  const session = positive(num(values, 'session'), 'session');
  const ethogram = readEthogram(str(values, 'ethogram'));
  const marks = readLog(str(values, 'log'), ethogram, session);
  return { session, ethogram, marks };
}

function runSession(values: Values): Outcome {
  const { session, ethogram, marks } = readSession(values);
  const r = summarize(marks, ethogram, session);
  const names = ethogram.map((b) => b.name);
  const state = r.behaviors.find((b) => b.kind === 'state' && b.count > 0);
  const event = r.behaviors.find((b) => b.kind === 'event');
  const vars = {
    minutes: session / 60,
    session,
    name: state?.name ?? '',
    total: state?.total ?? 0,
    count: state?.count ?? 0,
    budget: state ? state.budget * 100 : 0,
    mean: state?.meanBout ?? 0,
    ename: event?.name ?? '',
    ecount: event?.count ?? 0,
    rate: event?.rate ?? 0,
  };
  return {
    rows: [
      { id: 'session', value: session, sym: 'T' },
      { id: 'marks', value: marks.length },
      { id: 'onsets', value: r.sequence.length },
    ],
    tables: [
      {
        id: 'behaviors',
        columns: ['behavior', 'kind', 'count', 'rate', 'total', 'meanBout', 'budget', 'latency'],
        rows: r.behaviors.map((b) => [
          b.name,
          { word: b.kind },
          b.count,
          b.rate,
          cell(b.total),
          cell(b.meanBout),
          Number.isNaN(b.budget) ? '' : percentText(b.budget),
          cell(b.latency),
        ]),
      },
      { id: 'transitions', columns: ['from', ...names.map(raw)], rows: names.map((n, i) => [n, ...r.transitions[i]]) },
      {
        id: 'bouts',
        columns: ['behavior', 'start', 'end', 'length'],
        rows: r.bouts.map((b) => [b.name, b.start, b.end, b.end - b.start]),
      },
    ],
    steps: [
      step('observe.bouts'),
      ...(state
        ? [
            step('observe.budget', '\\frac{[[total]]\\ \\text{s}}{[[session]]\\ \\text{s}} = [[budget]]\\%', vars),
            step('observe.meanBout', '\\frac{[[total]]\\ \\text{s}}{[[count]]} = [[mean]]\\ \\text{s}', vars),
          ]
        : []),
      ...(event
        ? [step('observe.rate', '\\frac{[[ecount]]}{[[minutes]]\\ \\text{min}} = [[rate]]\\ \\text{per min}', vars)]
        : []),
      step('observe.transitions'),
    ],
  };
}

function runIntervals(values: Values): Outcome {
  const { session, ethogram, marks } = readSession(values);
  const name = str(values, 'behavior').trim();
  if (!ethogram.some((b) => b.name === name)) fail('unknownBehavior', { name, line: 1 }, 'behavior');
  const length = positive(num(values, 'interval'), 'interval');
  const rule = str(values, 'rule') as IntervalRule;
  const r = summarize(marks, ethogram, session);
  const events = boutsOf(marks, ethogram, session).events.get(name) ?? [];
  const scores = scoreIntervals(name, r, events, length, session, rule);
  const scored = scores.filter((s) => s === 1).length;
  const share = scored / scores.length;
  return {
    rows: [
      { id: 'intervals', value: scores.length },
      { id: 'scored', value: scored },
      { id: 'share', value: percentText(share), answer: true },
    ],
    tables: [
      {
        id: 'intervals',
        columns: ['interval', 'from', 'to', 'score'],
        rows: scores.map((s, i) => [i + 1, i * length, (i + 1) * length, s]),
      },
    ],
    notes: [
      ...(session % length > 1e-9 ? [{ id: 'leftover', vars: { left: session % length } }] : []),
      { id: rule === 'momentary' ? 'momentaryBias' : rule === 'whole' ? 'wholeBias' : 'partialBias' },
    ],
    steps: [
      step(`observe.${rule}`),
      step('observe.share', '\\frac{[[scored]]}{[[n]]} = [[share]]', { scored, n: scores.length, share }),
    ],
  };
}

function runObservers(values: Values): Outcome {
  const r = observers(readRecord(str(values, 'first'), 'first'), readRecord(str(values, 'second'), 'second'));
  return {
    rows: [
      { id: 'intervals', value: r.intervals },
      { id: 'total', value: percentText(r.total), answer: true },
      { id: 'occurrence', value: Number.isNaN(r.occurrence) ? '' : percentText(r.occurrence) },
      { id: 'nonoccurrence', value: Number.isNaN(r.nonoccurrence) ? '' : percentText(r.nonoccurrence) },
      { id: 'kappa', value: r.kappa, sym: '\\kappa' },
    ],
    steps: [
      step('observe.total', '\\frac{\\text{agreements}}{\\text{intervals}} = [[t]]', { t: r.total }),
      step('observe.occurrence'),
      step('observe.kappa', '\\kappa = [[k]]', { k: r.kappa }),
    ],
  };
}

function runSingleCase(values: Values): Outcome {
  const phases = readPhases(str(values, 'phases'));
  const increase = values.direction !== 'decrease';
  const summaries = phases.map(phaseSummary);
  const [a, b] = phases;
  const o = overlap(a.values, b.values, increase);
  const series: PlotSeries[] = phases.map((p, i) => ({
    id: 'phase',
    label: p.name,
    points: p.sessions.map((s, k) => [s, p.values[k]] as const),
    kind: 'line',
    pen: i % 2,
  }));
  const trendKind = str(values, 'trend');
  if (trendKind !== 'none')
    phases.forEach((p, i) => {
      const s = summaries[i];
      const slope = trendKind === 'split' ? s.splitSlope : s.slope;
      const intercept = trendKind === 'split' ? s.splitIntercept : s.intercept;
      if (Number.isNaN(slope)) return;
      const ends = [p.sessions[0], p.sessions[p.sessions.length - 1]];
      series.push({
        id: 'trend',
        vars: { phase: p.name },
        points: ends.map((x) => [x, intercept + slope * x] as const),
        dashed: true,
        pen: 2 + (i % 2),
      });
    });
  const edge = increase ? Math.max(...a.values) : Math.min(...a.values);
  const vars = {
    edge,
    beyond: o.beyond,
    nb: b.values.length,
    pnd: o.pnd * 100,
    better: o.better,
    ties: o.ties,
    worse: o.worse,
    pairs: o.pairs,
    nap: o.nap,
    tau: o.tau,
    a: a.name,
    b: b.name,
  };
  return {
    rows: [
      { id: 'pnd', value: percentText(o.pnd), answer: true },
      { id: 'nap', value: o.nap, sym: '\\text{NAP}', answer: true },
      { id: 'tau', value: o.tau, sym: '\\tau_{AB}' },
      { id: 'pairs', value: o.pairs },
    ],
    tables: [
      {
        id: 'phases',
        columns: ['phase', 'n', 'mean', 'median', 'sd', 'range', 'slope', 'splitSlope'],
        rows: phases.map((p, i) => {
          const s = summaries[i];
          return [p.name, s.n, s.mean, s.median, cell(s.sd), `${s.min} to ${s.max}`, cell(s.slope), cell(s.splitSlope)];
        }),
      },
    ],
    pictures: [
      {
        id: 'graph',
        plot: {
          x: { id: 'session' },
          y: { id: 'value' },
          series,
          marks: phases.slice(1).map((p) => ({ x: p.sessions[0] - 0.5, label: p.name })),
        },
      },
    ],
    notes: phases.length > 2 ? [{ id: 'firstTwo', vars: { a: a.name, b: b.name } }] : [],
    steps: [
      step('observe.level'),
      step(
        increase ? 'observe.pndUp' : 'observe.pndDown',
        '\\text{PND} = \\frac{[[beyond]]}{[[nb]]} = [[pnd]]\\%',
        vars,
      ),
      step('observe.nap', '\\text{NAP} = \\frac{[[better]] + 0.5 \\times [[ties]]}{[[pairs]]} = [[nap]]', vars),
      step('observe.tau', '\\tau = \\frac{[[better]] - [[worse]]}{[[pairs]]} = [[tau]]', vars),
    ],
  };
}

export const spec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: ['session', 'intervals', 'observers', 'singleCase'], first: 'session' },
    { id: 'ethogram', type: 'text', rows: 4, first: ETHOGRAM, when: usesLog },
    { id: 'log', type: 'text', rows: 7, first: LOG, when: usesLog },
    { id: 'session', type: 'number', first: '120', when: usesLog },
    { id: 'behavior', type: 'line', first: 'call', when: isMode('intervals') },
    { id: 'interval', type: 'number', first: '10', when: isMode('intervals') },
    {
      id: 'rule',
      type: 'choice',
      options: ['partial', 'whole', 'momentary'],
      first: 'partial',
      when: isMode('intervals'),
    },
    { id: 'first', type: 'line', first: '1 1 0 0 1 1 0 0 1 0', when: isMode('observers') },
    { id: 'second', type: 'line', first: '1 0 0 1 1 1 0 0 1 0', when: isMode('observers') },
    { id: 'phases', type: 'text', rows: 4, first: PHASES, when: isMode('singleCase') },
    {
      id: 'direction',
      type: 'choice',
      options: ['increase', 'decrease'],
      first: 'increase',
      when: isMode('singleCase'),
    },
    { id: 'trend', type: 'choice', options: ['split', 'ols', 'none'], first: 'split', when: isMode('singleCase') },
  ],
  run(values) {
    if (values.mode === 'intervals') return runIntervals(values);
    if (values.mode === 'observers') return runObservers(values);
    if (values.mode === 'singleCase') return runSingleCase(values);
    return runSession(values);
  },
  examples: [
    { id: 'budget', values: { mode: 'session', log: '0 | rest\n30 | feed\n75 | rest', session: '120' } },
    {
      id: 'rate',
      values: { mode: 'session', log: '5 | call\n12 | call\n40 | call\n41 | call\n90 | call', session: '120' },
    },
    {
      id: 'partial',
      values: {
        mode: 'intervals',
        ethogram: 'tap | state',
        log: '3 | tap\n4 | tap | stop\n25 | tap\n28 | tap | stop',
        session: '40',
        behavior: 'tap',
        interval: '10',
      },
    },
    { id: 'observers', values: { mode: 'observers' } },
    { id: 'abab', values: { mode: 'singleCase', phases: 'A1 | 3 4 5 4\nB1 | 6 5 7 8 4\nA2 | 4 3 4\nB2 | 7 8 8 9' } },
  ],
};
