// The survival analysis tool. It takes a time column and an event column (1 for an event, 0 for censored). It shows
// Kaplan-Meier curves with the log-rank test, the Cox proportional hazards model, or the actuarial life table.
import { numbersAt, parseTable, wordsAt, completeRows } from '../kit/data';
import { buildDesign, mainTerms } from '../kit/design';
import { percent } from '../kit/format';
import { columnList, type Outcome, type ToolSpec, type Values } from '../kit/spec';
import { fail, step, type KitStep } from '../kit/types';
import { fitCox, type Ties } from './cox';
import { lifeTable } from './engine';
import { kmOutcome } from './km';

const TWO_GROUPS = 'time,status,group\n5,1,A\n8,1,A\n12,0,A\n15,1,A\n20,1,A\n10,1,B\n14,0,B\n18,1,B\n25,1,B\n30,0,B';
const ONE_GROUP =
  'weeks,relapse\n6,1\n6,1\n6,1\n7,1\n10,1\n13,1\n16,1\n22,1\n23,1\n6,0\n9,0\n10,0\n11,0\n17,0\n19,0\n20,0\n25,0\n' +
  '32,0\n32,0\n34,0\n35,0';
const COX =
  'months,died,age,treatment\n4,1,62,standard\n6,1,58,standard\n7,0,49,new\n9,1,70,standard\n11,1,66,new\n' +
  '12,0,51,new\n14,1,73,standard\n17,1,60,new\n20,0,55,new\n22,1,68,standard\n25,0,47,new\n28,1,64,standard\n' +
  '31,0,52,new\n36,0,45,new';

const is = (mode: string) => (v: Values) => v.analysis === mode;

function read(values: Values) {
  const table = parseTable(String(values.data));
  const timeName = String(values.time);
  const eventName = String(values.event);
  return { table, timeName, eventName };
}

function coxOutcome(values: Values): Outcome {
  const { table, timeName, eventName } = read(values);
  const covariates = columnList(values.covariates);
  if (covariates.includes(timeName) || covariates.includes(eventName)) fail('outcomeIsPredictor', timeName);
  const design = buildDesign(table, mainTerms(covariates), { intercept: false, need: [timeName, eventName] });
  const time = numbersAt(table, timeName, design.rows);
  const event = numbersAt(table, eventName, design.rows);
  if (event.some((e) => e !== 0 && e !== 1)) fail('eventCode');
  const ties = String(values.ties) as Ties;
  const level = Number(values.level);
  const cox = fitCox(time, event, design.x, design.columns, ties, level);
  const steps: KitStep[] = [
    step(
      ties === 'efron' ? 'survival.coxEfron' : 'survival.coxBreslow',
      '\\ell(\\beta) = \\sum_{j} \\Big[ \\sum_{i \\in D_j} x_i^\\top\\beta - \\sum_{l=0}^{d_j - 1} ' +
        '\\ln\\Big(\\sum_{k \\in R_j} e^{x_k^\\top\\beta} - c_l \\sum_{i \\in D_j} e^{x_i^\\top\\beta}\\Big)\\Big]',
    ),
    step('survival.newton', '\\beta^{(m+1)} = \\beta^{(m)} + I(\\beta^{(m)})^{-1} U(\\beta^{(m)})', {
      iterations: cox.history.length - 1,
      ll0: cox.ll0,
      ll: cox.ll,
    }),
    ...cox.names.map((name, a) =>
      step(
        'survival.coxCoef',
        '\\mathrm{HR} = e^{[[b]]} = [[hr]],\\quad e^{[[b]] \\pm z \\times [[se]]} = ([[lo]],\\ [[hi]])',
        {
          term: name,
          b: cox.coef[a],
          se: cox.se[a],
          hr: Math.exp(cox.coef[a]),
          lo: Math.exp(cox.low[a]),
          hi: Math.exp(cox.high[a]),
          p: cox.p[a],
        },
      ),
    ),
    step('survival.coxTests', '2(\\ell(\\hat\\beta) - \\ell(0)) = [[lr]]', {
      lr: cox.lr,
      wald: cox.wald,
      score: cox.score,
      df: cox.df,
    }),
  ];
  return {
    rows: [
      { id: 'hr', value: Math.exp(cox.coef[0]), answer: true, sym: '\\mathrm{HR}' },
      { id: 'n', value: time.length },
      { id: 'events', value: event.reduce((a, b) => a + b, 0) },
      { id: 'lr', value: cox.lr },
      { id: 'lrP', value: cox.lrP },
      { id: 'wald', value: cox.wald },
      { id: 'waldP', value: cox.waldP },
      { id: 'score', value: cox.score },
      { id: 'scoreP', value: cox.scoreP },
      { id: 'logLik', value: cox.ll },
    ],
    tables: [
      {
        id: 'cox',
        columns: ['term', 'estimate', 'se', 'z', 'p', 'hr', 'low', 'high'],
        rows: cox.names.map((name, a) => [
          name,
          cox.coef[a],
          cox.se[a],
          cox.z[a],
          cox.p[a],
          Math.exp(cox.coef[a]),
          Math.exp(cox.low[a]),
          Math.exp(cox.high[a]),
        ]),
      },
      { id: 'iterations', columns: ['iteration', 'logLik'], rows: cox.history.map((ll, i) => [i, ll]) },
    ],
    steps,
    notes: ['censoring', 'proportional', 'coxLinear'],
    words: step('survival.wordsCox', undefined, {
      term: cox.names[0],
      hr: Math.exp(cox.coef[0]),
      lo: Math.exp(cox.low[0]),
      hi: Math.exp(cox.high[0]),
      level: percent(level),
      p: cox.p[0],
    }),
  };
}

function lifeOutcome(values: Values): Outcome {
  const { table, timeName, eventName } = read(values);
  const rowsUsed = completeRows(table, [timeName, eventName]);
  const time = numbersAt(table, timeName, rowsUsed);
  const event = numbersAt(table, eventName, rowsUsed);
  const width = Number(values.width);
  const rows = lifeTable(time, event, width);
  const cross = rows.findIndex((r) => r.survival <= 0.5);
  const before = cross > 0 ? rows[cross - 1].survival : 1;
  const median =
    cross < 0 ? NaN : rows[cross].start + (width * (before - 0.5)) / Math.max(before - rows[cross].survival, 1e-300);
  const first = rows[0];
  return {
    rows: [
      { id: 'median', value: median, answer: true, sym: '\\tilde t' },
      { id: 'n', value: time.length },
      { id: 'events', value: event.reduce((a, b) => a + b, 0) },
      { id: 'intervals', value: rows.length },
    ],
    tables: [
      {
        id: 'life',
        columns: [
          'start',
          'end',
          'entering',
          'withdrawn',
          'events',
          'effective',
          'q',
          'survival',
          'se',
          'hazard',
          'density',
        ],
        rows: rows.map((r) => [
          r.start,
          r.end,
          r.entering,
          r.withdrawn,
          r.events,
          r.effective,
          r.q,
          r.survival,
          r.se,
          r.hazard,
          r.density,
        ]),
      },
    ],
    steps: [
      step('survival.effective', "n' = n - \\frac{c}{2} = [[n]] - \\frac{[[c]]}{2} = [[eff]]", {
        n: first.entering,
        c: first.withdrawn,
        eff: first.effective,
      }),
      step('survival.lifeQ', "q = \\frac{d}{n'} = \\frac{[[d]]}{[[eff]]} = [[q]],\\quad S = \\prod (1 - q)", {
        d: first.events,
        eff: first.effective,
        q: first.q,
      }),
      step('survival.lifeMedian', undefined, { median }),
    ],
    pictures: [
      {
        id: 'life',
        type: 'plot',
        plot: {
          x: { label: 'time' },
          y: { label: 'survival' },
          series: [{ id: 'survival', points: [[0, 1], ...rows.map((r) => [r.end, r.survival] as [number, number])] }],
          yRange: [0, 1.02],
        },
      },
    ],
    notes: ['censoring', 'withdrawnHalf'],
  };
}

function run(values: Values): Outcome {
  if (values.analysis === 'cox') return coxOutcome(values);
  if (values.analysis === 'lifetable') return lifeOutcome(values);
  const { table, timeName, eventName } = read(values);
  const groupName = String(values.group);
  const strataName = String(values.strata);
  const need = [timeName, eventName, groupName, strataName].filter((n) => n !== '');
  const rows = completeRows(table, need);
  return kmOutcome({
    time: numbersAt(table, timeName, rows),
    event: numbersAt(table, eventName, rows),
    ...(groupName ? { group: wordsAt(table, groupName, rows) } : {}),
    ...(groupName && strataName ? { strata: wordsAt(table, strataName, rows) } : {}),
    peto: values.weights === 'peto',
    level: Number(values.level),
  });
}

export const survivalSpec: ToolSpec = {
  fields: [
    { id: 'data', type: 'data', first: TWO_GROUPS, rows: 6 },
    { id: 'analysis', type: 'choice', options: ['km', 'cox', 'lifetable'], first: 'km' },
    { id: 'time', type: 'column', data: 'data', first: 'time' },
    { id: 'event', type: 'column', data: 'data', first: 'status' },
    { id: 'group', type: 'column', data: 'data', first: 'group', optional: true, when: is('km') },
    {
      id: 'strata',
      type: 'column',
      data: 'data',
      first: '',
      optional: true,
      when: (v) => is('km')(v) && v.group !== '',
    },
    {
      id: 'weights',
      type: 'choice',
      options: ['logrank', 'peto'],
      first: 'logrank',
      when: (v) => is('km')(v) && v.group !== '',
    },
    { id: 'covariates', type: 'column', data: 'data', first: 'group', multi: true, when: is('cox') },
    { id: 'ties', type: 'choice', options: ['efron', 'breslow'], first: 'efron', when: is('cox') },
    { id: 'width', type: 'number', first: '10', min: 1e-9, when: is('lifetable') },
    { id: 'level', type: 'number', first: '0.95', min: 0.5, max: 0.999, when: (v) => !is('lifetable')(v) },
  ],
  run,
  caution: true,
  examples: [
    { id: 'twoGroups', values: { data: TWO_GROUPS, analysis: 'km', time: 'time', event: 'status', group: 'group' } },
    { id: 'oneGroup', values: { data: ONE_GROUP, analysis: 'km', time: 'weeks', event: 'relapse', group: '' } },
    {
      id: 'cox',
      values: {
        data: COX,
        analysis: 'cox',
        time: 'months',
        event: 'died',
        covariates: 'age\ntreatment',
        ties: 'efron',
      },
    },
    {
      id: 'lifeTable',
      values: { data: ONE_GROUP, analysis: 'lifetable', time: 'weeks', event: 'relapse', width: '10' },
    },
  ],
};
