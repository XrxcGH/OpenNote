// The scales tool's outcomes for test items, score transforms, item response curves, and the System Usability
// Scale.
import { mean, sd } from '../kit/num';
import { cells, lines, readList, readNumber } from '../kit/parse';
import type { PlotSeries } from '../kit/plot';
import { num, str, type Outcome, type ResultRow, type Values } from '../kit/spec';
import { fail, step } from '../kit/types';
import {
  checkGraded,
  checkItem,
  gradedInformation,
  gradedProbabilities,
  information,
  pCorrect,
  type Graded,
  type Item,
} from './irt';
import { analyseItems, sus, transform } from './items';

/** Answers as letters: separated by spaces or commas, or written together, such as ABDC. */
function readAnswers(text: string): string[][] {
  const found = lines(text);
  if (found.length === 0) fail('empty', {}, 'answers');
  return found.map((one) => {
    const parts = cells(one.text);
    return parts.length === 1 ? parts[0].split('') : parts;
  });
}

export function runItems(values: Values): Outcome {
  const answers = readAnswers(str(values, 'answers'));
  const key = readAnswers(str(values, 'key'))[0];
  const r = analyseItems(answers, key);
  const meanScore = mean(r.totals);
  const vars = { n: answers.length, g: r.groupSize, p1: r.items[0].p, d1: r.items[0].d };
  return {
    rows: [
      { id: 'respondents', value: answers.length },
      { id: 'items', value: key.length },
      { id: 'groupSize', value: r.groupSize },
      { id: 'meanScore', value: meanScore, answer: true },
      { id: 'sdScore', value: sd(r.totals) },
      { id: 'meanP', value: mean(r.items.map((one) => one.p)), answer: true },
    ],
    tables: [
      {
        id: 'itemStats',
        columns: ['item', 'key', 'p', 'd', 'rpb'],
        rows: r.items.map((one) => [one.item, one.key, one.p, one.d, one.rpb]),
      },
      {
        id: 'distractors',
        columns: ['item', 'option', 'upper', 'lower'],
        rows: r.items.flatMap((one) => r.options.map((o) => [one.item, o, one.upper[o] ?? 0, one.lower[o] ?? 0])),
      },
    ],
    steps: [
      step('scales.difficulty', 'p_1 = \\frac{\\text{correct}}{n} = [[p1]]', vars),
      step('scales.groups', 'g = \\operatorname{round}(0.27 \\times [[n]]) = [[g]]', vars),
      step('scales.discrimination', 'D_1 = p_U - p_L = [[d1]]', vars),
      step('scales.pointBiserial'),
    ],
  };
}

export function runTransform(values: Values): Outcome {
  const x = num(values, 'score');
  const m = num(values, 'mean');
  const s = num(values, 'sd');
  const rxx = num(values, 'rxx');
  const level = num(values, 'level');
  const normsText = str(values, 'norms').trim();
  const norms = normsText === '' ? [] : readList(normsText, 'norms');
  const r = transform(x, m, s, rxx, level, norms);
  const vars = {
    x,
    m,
    s,
    z: r.z,
    t: r.t,
    st: r.stanine,
    rxx,
    sem: r.sem,
    low: r.low,
    high: r.high,
    ts: r.trueScore,
    pct: level * 100,
  };
  return {
    rows: [
      { id: 'z', value: r.z, sym: 'z', answer: true },
      { id: 't', value: r.t, sym: 'T', answer: true },
      { id: 'stanine', value: r.stanine },
      { id: 'percentile', value: r.percentile, sym: '\\mathrm{PR}' },
      { id: 'sem', value: r.sem, sym: '\\mathrm{SEM}' },
      { id: 'bandLow', value: r.low },
      { id: 'bandHigh', value: r.high },
      { id: 'trueScore', value: r.trueScore, sym: '\\hat{T}' },
      { id: 'see', value: r.see, sym: '\\mathrm{SE}_{\\hat{T}}' },
    ],
    steps: [
      step('scales.z', 'z = \\frac{x - \\bar{x}}{s} = \\frac{[[x]] - [[m]]}{[[s]]} = [[z]]', vars),
      step('scales.t', 'T = 50 + 10z = [[t]]', vars),
      step('scales.stanine', '\\text{stanine} = \\operatorname{round}(2z + 5) = [[st]]', vars),
      step(norms.length > 0 ? 'scales.percentileNorms' : 'scales.percentileNormal'),
      step('scales.sem', '\\mathrm{SEM} = s\\sqrt{1 - r_{xx}} = [[s]]\\sqrt{1 - [[rxx]]} = [[sem]]', vars),
      step('scales.band', 'x \\pm z_c\\,\\mathrm{SEM} = [[[low]],\\ [[high]]]', vars),
      step('scales.trueScore', '\\hat{T} = \\bar{x} + r_{xx}(x - \\bar{x}) = [[ts]]', vars),
    ],
  };
}

function readIrt(text: string, model: string): { items: Item[]; graded: Graded[] } {
  const found = lines(text);
  if (found.length === 0) fail('empty', {}, 'items');
  const items: Item[] = [];
  const graded: Graded[] = [];
  for (const one of found) {
    const v = cells(one.text).map(readNumber);
    const bad = v.findIndex((x) => Number.isNaN(x));
    if (bad >= 0) fail('badCell', { line: one.line, cell: cells(one.text)[bad] }, 'items');
    if (model === 'grm') graded.push(checkGraded({ a: v[0], b: v.slice(1) }, one.line));
    else if (model === '1pl') items.push(checkItem({ a: 1, b: v[v.length - 1], c: 0 }, one.line));
    else if (model === '2pl') items.push(checkItem({ a: v[0], b: v[1] ?? NaN, c: 0 }, one.line));
    else items.push(checkItem({ a: v[0], b: v[1] ?? NaN, c: v[2] ?? 0 }, one.line));
  }
  return { items, graded };
}

const THETAS = Array.from({ length: 81 }, (_, i) => -4 + i * 0.1);

export function runIrt(values: Values): Outcome {
  const model = str(values, 'model');
  const D = str(values, 'scaling') === 'd1702' ? 1.702 : 1;
  const theta = num(values, 'theta');
  const { items, graded } = readIrt(str(values, 'items'), model);
  const count = model === 'grm' ? graded.length : items.length;
  const infoAt = (t: number, i: number) =>
    model === 'grm' ? gradedInformation(t, graded[i], D) : information(t, items[i], D);
  const expected = (t: number, i: number) =>
    model === 'grm' ? gradedProbabilities(t, graded[i], D).reduce((s, p, k) => s + k * p, 0) : pCorrect(t, items[i], D);
  const testInfo = (t: number) => Array.from({ length: count }, (_, i) => infoAt(t, i)).reduce((s, v) => s + v, 0);
  const total = testInfo(theta);
  const curves: PlotSeries[] = Array.from({ length: Math.min(count, 5) }, (_, i) => ({
    id: 'item',
    vars: { n: i + 1 },
    points: THETAS.map((t) => [t, expected(t, i)]),
  }));
  const first = model === 'grm' ? { a: graded[0].a, b: graded[0].b[0], c: 0 } : items[0];
  const vars = {
    a: first.a,
    b: first.b,
    c: first.c,
    D,
    theta,
    p: expected(theta, 0),
    info: infoAt(theta, 0),
    I: total,
    se: 1 / Math.sqrt(total),
  };
  const rows: ResultRow[] = [
    { id: 'theta', value: theta, sym: '\\theta' },
    { id: 'testInfo', value: total, sym: 'I(\\theta)', answer: true },
    { id: 'seTheta', value: 1 / Math.sqrt(total), sym: '\\mathrm{SE}(\\theta)', answer: true },
  ];
  return {
    rows,
    tables: [
      {
        id: 'atTheta',
        columns: ['item', model === 'grm' ? 'expectedScore' : 'p', 'information'],
        rows: Array.from({ length: count }, (_, i) => [i + 1, expected(theta, i), infoAt(theta, i)]),
      },
    ],
    steps: [
      step(
        model === 'grm' ? 'scales.grm' : 'scales.logistic',
        model === 'grm'
          ? 'P^*_k(\\theta) = \\frac{1}{1 + e^{-Da(\\theta - b_k)}},\\quad P_k = P^*_k - P^*_{k+1}'
          : 'P(\\theta) = c + \\frac{1 - c}{1 + e^{-Da(\\theta - b)}} = [[p]]',
        vars,
      ),
      step(
        model === 'grm' ? 'scales.grmInfo' : 'scales.info',
        model === 'grm'
          ? "I(\\theta) = \\sum_k \\frac{P_k'(\\theta)^2}{P_k(\\theta)}"
          : 'I(\\theta) = D^2 a^2 \\frac{Q}{P}\\left(\\frac{P - c}{1 - c}\\right)^2 = [[info]]',
        vars,
      ),
      step(
        'scales.testInfo',
        'I(\\theta) = \\sum_j I_j(\\theta) = [[I]],\\quad \\mathrm{SE}(\\theta) = \\frac{1}{\\sqrt{I}} = [[se]]',
        vars,
      ),
    ],
    notes: count > 5 ? [{ id: 'firstFive' }] : [],
    pictures: [
      {
        id: 'curves',
        plot: {
          x: { id: 'theta', min: -4, max: 4 },
          y: { id: model === 'grm' ? 'expected' : 'p', min: 0 },
          series: curves,
        },
      },
      {
        id: 'information',
        plot: {
          x: { id: 'theta', min: -4, max: 4 },
          y: { id: 'information', min: 0 },
          series: [{ id: 'testInfo', points: THETAS.map((t) => [t, testInfo(t)]) }],
        },
      },
    ],
  };
}

export function runSus(values: Values): Outcome {
  const found = lines(str(values, 'sus'));
  if (found.length === 0) fail('empty', {}, 'sus');
  const scores = found.map((one) => sus(readList(one.text, 'sus')));
  const vars = { first: scores[0], mean: mean(scores) };
  return {
    rows: [
      { id: 'respondents', value: scores.length },
      { id: 'susMean', value: mean(scores), sym: '\\overline{\\mathrm{SUS}}', answer: true },
      { id: 'susSd', value: scores.length > 1 ? sd(scores) : NaN },
      { id: 'susMin', value: Math.min(...scores) },
      { id: 'susMax', value: Math.max(...scores) },
    ],
    tables: [{ id: 'susScores', columns: ['respondent', 'score'], rows: scores.map((v, i) => [i + 1, v]) }],
    steps: [
      step(
        'scales.sus',
        '\\mathrm{SUS} = 2.5\\left[\\sum_{\\text{odd}} (x - 1) + \\sum_{\\text{even}} (5 - x)\\right] = [[first]]',
        vars,
      ),
      step('scales.susMean', '\\overline{\\mathrm{SUS}} = [[mean]]', vars),
    ],
  };
}
