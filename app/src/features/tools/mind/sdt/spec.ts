// The signal detection tool's fields, results, steps, and plots, drawn by the kit window.
import { normCdf, normQuantile } from '../kit/num';
import { readList } from '../kit/parse';
import type { PlotSeries } from '../kit/plot';
import { num, str, type Note, type Outcome, type ToolSpec, type Values } from '../kit/spec';
import { step, type KitStep } from '../kit/types';
import { dPrimeMafc, pcMafc, ratesFromCounts, ratingRoc, yesNo, type Correction } from './engine';

const isMode = (mode: string) => (v: Values) => v.mode === mode;
const counts = (v: Values) => v.mode === 'yesno' && v.input === 'counts';
const grid = (n: number, lo: number, hi: number) => Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);

/** The curve of every (F, H) with the same d'. */
const isoCurve = (d: number): PlotSeries => ({
  id: 'iso',
  points: grid(80, 0.0005, 0.9995).map((f) => [f, normCdf(d + normQuantile(f))]),
});

function rateSteps(values: Values, H: number, F: number): KitStep[] {
  if (values.input === 'rates') return [step('sdt.ratesGiven', 'H = [[H]],\\quad F = [[F]]', { H, F })];
  const vars = {
    hits: num(values, 'hits'),
    misses: num(values, 'misses'),
    fas: num(values, 'fas'),
    crs: num(values, 'crs'),
    H,
    F,
  };
  if (values.correction === 'loglinear')
    return [
      step(
        'sdt.loglinear',
        'H = \\frac{[[hits]] + 0.5}{[[hits]] + [[misses]] + 1} = [[H]],\\quad F = \\frac{[[fas]] + ' +
          '0.5}{[[fas]] + [[crs]] + 1} = [[F]]',
        vars,
      ),
    ];
  const main = step(
    'sdt.rates',
    'H = \\frac{[[hits]]}{[[hits]] + [[misses]]} = [[H]],\\quad F = \\frac{[[fas]]}{[[fas]] + [[crs]]} = [[F]]',
    vars,
  );
  return values.correction === 'half' ? [main, step('sdt.half')] : [main];
}

function biasNote(c: number): Note {
  if (Math.abs(c) < 1e-9) return { id: 'neutral' };
  return { id: c < 0 ? 'liberal' : 'conservative', vars: { c } };
}

function runYesNo(values: Values): Outcome {
  const correction = str(values, 'correction') as Correction;
  const { H, F } =
    values.input === 'rates'
      ? { H: num(values, 'hitRate'), F: num(values, 'faRate') }
      : ratesFromCounts(num(values, 'hits'), num(values, 'misses'), num(values, 'fas'), num(values, 'crs'), correction);
  const r = yesNo(H, F);
  const vars = { H, F, zH: r.zH, zF: r.zF, d: r.dPrime, c: r.c, lnb: r.lnBeta, b: r.beta, a: r.aPrime, bb: r.bDouble };
  return {
    rows: [
      { id: 'H', value: H, sym: 'H' },
      { id: 'F', value: F, sym: 'F' },
      { id: 'zH', value: r.zH, sym: 'z(H)' },
      { id: 'zF', value: r.zF, sym: 'z(F)' },
      { id: 'dPrime', value: r.dPrime, sym: "d'", answer: true },
      { id: 'c', value: r.c, sym: 'c', answer: true },
      { id: 'beta', value: r.beta, sym: '\\beta' },
      { id: 'lnBeta', value: r.lnBeta, sym: '\\ln\\beta' },
      { id: 'aPrime', value: r.aPrime, sym: "A'" },
      { id: 'bDouble', value: r.bDouble, sym: "B''" },
    ],
    steps: [
      ...rateSteps(values, H, F),
      step('sdt.z', 'z(H) = [[zH]],\\quad z(F) = [[zF]]', vars),
      step('sdt.dprime', "d' = z(H) - z(F) = [[zH]] - ([[zF]]) = [[d]]", vars),
      step('sdt.criterion', 'c = -\\tfrac{1}{2}\\,[z(H) + z(F)] = [[c]]', vars),
      step('sdt.beta', "\\ln\\beta = d'c = [[lnb]],\\quad \\beta = e^{\\ln\\beta} = [[b]]", vars),
      step(
        H >= F ? 'sdt.aprime' : 'sdt.aprimeBelow',
        H >= F
          ? "A' = \\tfrac{1}{2} + \\frac{(H - F)(1 + H - F)}{4H(1 - F)} = [[a]]"
          : "A' = \\tfrac{1}{2} - \\frac{(F - H)(1 + F - H)}{4F(1 - H)} = [[a]]",
        vars,
      ),
      step('sdt.bdouble', "B'' = \\frac{H(1 - H) - F(1 - F)}{H(1 - H) + F(1 - F)} = [[bb]]", vars),
    ],
    notes: [{ id: 'separation', vars: { d: r.dPrime } }, biasNote(r.c)],
    pictures: [
      {
        id: 'roc',
        plot: {
          x: { id: 'F', min: 0, max: 1 },
          y: { id: 'H', min: 0, max: 1 },
          square: true,
          diagonal: true,
          series: [isoCurve(r.dPrime), { id: 'data', kind: 'points', points: [[F, H]] }],
        },
      },
    ],
  };
}

function runMafc(values: Values): Outcome {
  const m = num(values, 'm');
  const pc = num(values, 'pc');
  const d = dPrimeMafc(pc, m);
  const vars = { m, pc, z: normQuantile(pc), d, chance: 1 / m };
  const top = Math.max(4, Math.ceil(d + 0.5));
  return {
    rows: [
      { id: 'm', value: m, sym: 'm' },
      { id: 'pc', value: pc, sym: 'P_c' },
      { id: 'chance', value: 1 / m, sym: '1/m' },
      { id: 'dPrime', value: d, sym: "d'", answer: true },
    ],
    steps:
      m === 2
        ? [step('sdt.twoAfc', "d' = \\sqrt{2}\\, z(P_c) = \\sqrt{2} \\times [[z]] = [[d]]", vars)]
        : [
            step('sdt.mafc', "P_c = \\int_{-\\infty}^{\\infty} \\phi(x - d')\\,\\Phi(x)^{[[m]] - 1}\\,dx", vars),
            step('sdt.mafcSolve', "P_c = [[pc]] \\;\\Rightarrow\\; d' = [[d]]", vars),
          ],
    notes: [{ id: 'chance', vars: { chance: 1 / m } }],
    pictures: [
      {
        id: 'mafc',
        plot: {
          x: { id: 'dPrime', min: Math.min(0, d), max: top },
          y: { id: 'pc', min: 0, max: 1 },
          series: [
            { id: 'pcCurve', points: grid(60, Math.min(0, d), top).map((x) => [x, pcMafc(x, m)]) },
            { id: 'data', kind: 'points', points: [[d, pc]] },
          ],
        },
      },
    ],
  };
}

function runRating(values: Values): Outcome {
  const signal = readList(str(values, 'signal'), 'signal');
  const noise = readList(str(values, 'noise'), 'noise');
  const r = ratingRoc(signal, noise, str(values, 'correction') as Correction);
  const used = r.points.filter((p) => Number.isFinite(p.zH) && Number.isFinite(p.zF));
  const vars = { a: r.intercept, s: r.slope, dA: r.dA, Az: r.Az, area: r.area, k: r.points.length };
  const notes: Note[] = [];
  if (used.length < r.points.length) notes.push({ id: 'dropped', vars: { n: r.points.length - used.length } });
  if (new Set(used.map((p) => p.zF)).size < 2) notes.push({ id: 'onePair' });
  return {
    rows: [
      { id: 'nSignal', value: r.nSignal },
      { id: 'nNoise', value: r.nNoise },
      { id: 'slope', value: r.slope, sym: 's' },
      { id: 'intercept', value: r.intercept, sym: 'a' },
      { id: 'dA', value: r.dA, sym: 'd_a', answer: true },
      { id: 'Az', value: r.Az, sym: 'A_z', answer: true },
      { id: 'area', value: r.area },
      { id: 'r2', value: r.r2, sym: 'r^2' },
    ],
    tables: [
      {
        id: 'pairs',
        columns: ['criterion', 'H', 'F', 'zH', 'zF'],
        rows: r.points.map((p, i) => [i + 1, p.H, p.F, p.zH, p.zF]),
      },
    ],
    steps: [
      step(
        'sdt.cumulative',
        'H_k = \\frac{\\sum_{j \\le k} s_j}{N_s},\\quad F_k = \\frac{\\sum_{j \\le k} n_j}{N_n}',
        vars,
      ),
      step('sdt.zroc', 'z(H) = [[a]] + [[s]]\\, z(F)', vars),
      step('sdt.da', 'd_a = a\\sqrt{\\frac{2}{1 + s^2}} = [[dA]]', vars),
      step('sdt.az', 'A_z = \\Phi\\!\\left(\\frac{d_a}{\\sqrt{2}}\\right) = [[Az]]', vars),
      step('sdt.area', '\\text{area} = [[area]]', vars),
    ],
    notes,
    pictures: [
      {
        id: 'roc',
        plot: {
          x: { id: 'F', min: 0, max: 1 },
          y: { id: 'H', min: 0, max: 1 },
          square: true,
          diagonal: true,
          series: [
            {
              id: 'fit',
              points: grid(80, 0.0005, 0.9995).map((f) => [f, normCdf(r.intercept + r.slope * normQuantile(f))]),
            },
            { id: 'data', kind: 'points', points: r.points.map((p) => [p.F, p.H]) },
          ],
        },
      },
      {
        id: 'zroc',
        plot: {
          x: { id: 'zF' },
          y: { id: 'zH' },
          square: true,
          series: [
            { id: 'fit', points: [-2.5, 2.5].map((z) => [z, r.intercept + r.slope * z]) },
            { id: 'data', kind: 'points', points: used.map((p) => [p.zF, p.zH]) },
          ],
        },
      },
    ],
  };
}

export const spec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: ['yesno', 'mafc', 'rating'], first: 'yesno' },
    { id: 'input', type: 'choice', options: ['counts', 'rates'], first: 'counts', when: isMode('yesno') },
    { id: 'hits', type: 'number', first: '40', when: counts },
    { id: 'misses', type: 'number', first: '10', when: counts },
    { id: 'fas', type: 'number', first: '12', when: counts },
    { id: 'crs', type: 'number', first: '38', when: counts },
    { id: 'hitRate', type: 'number', first: '0.8', when: (v) => v.mode === 'yesno' && v.input === 'rates' },
    { id: 'faRate', type: 'number', first: '0.2', when: (v) => v.mode === 'yesno' && v.input === 'rates' },
    {
      id: 'correction',
      type: 'choice',
      options: ['none', 'loglinear', 'half'],
      first: 'none',
      when: (v) => counts(v) || v.mode === 'rating',
    },
    { id: 'm', type: 'number', first: '2', when: isMode('mafc') },
    { id: 'pc', type: 'number', first: '0.76', when: isMode('mafc') },
    { id: 'signal', type: 'line', first: '45, 25, 15, 10, 5', when: isMode('rating') },
    { id: 'noise', type: 'line', first: '5, 10, 20, 30, 35', when: isMode('rating') },
  ],
  run(values) {
    if (values.mode === 'mafc') return runMafc(values);
    if (values.mode === 'rating') return runRating(values);
    return runYesNo(values);
  },
  examples: [
    { id: 'symmetric', values: { mode: 'yesno', input: 'rates', hitRate: '0.8', faRate: '0.2' } },
    {
      id: 'perfect',
      values: { mode: 'yesno', input: 'counts', hits: '20', misses: '0', fas: '0', crs: '20', correction: 'loglinear' },
    },
    { id: 'twoAfc', values: { mode: 'mafc', m: '2', pc: '0.76' } },
    { id: 'rating', values: { mode: 'rating' } },
  ],
};
