// The decision and choice models tool's fields, results, steps, and plots.
import { lines, readNumber } from '../kit/parse';
import { makeRng } from '../kit/rng';
import {
  num,
  str,
  type Note,
  type Outcome,
  type Picture,
  type ResultTable,
  type ToolSpec,
  type Values,
} from '../kit/spec';
import { fail, positive, step, whole, within } from '../kit/types';
import {
  checkDiffusion,
  diffusionChoice,
  ez,
  gamble,
  passageDensity,
  QUANTILES,
  rtQuantiles,
  simulate,
  value,
  weight,
  type GambleValue,
  type Outcome as Prospect,
  type Weighting,
} from './engine';

const isMode = (mode: string) => (v: Values) => v.mode === mode;
const usesModel = (v: Values) => v.mode === 'diffusion' || v.mode === 'speed';
const usesShape = (v: Values) => v.mode === 'prospect' || v.mode === 'gamble';
const grid = (n: number, lo: number, hi: number) => Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);

const model = (values: Values) =>
  checkDiffusion({ v: num(values, 'v'), a: num(values, 'a'), w: num(values, 'w'), s: num(values, 's') });

function runDiffusion(values: Values): Outcome {
  const d = model(values);
  const ter = within(num(values, 'ter'), 0, 10, 'ter');
  const r = diffusionChoice(d);
  const symmetric = Math.abs(d.w - 0.5) < 1e-12;
  const A = d.a / 2;
  const vars = { v: d.v, a: d.a, A, s: d.s, z: d.w * d.a, p: r.pUpper, dt: r.meanDt, rt: ter + r.meanDt, ter };
  const end = Math.max(0.5, 4 * r.meanDt + 0.2);
  const ts = grid(160, end / 160, end);
  const pictures: Picture[] = [
    {
      id: 'density',
      plot: {
        x: { id: 'time', min: 0 },
        y: { id: 'density', min: 0 },
        series: [
          { id: 'upper', points: ts.map((t) => [t, passageDensity(t, d, 'upper')] as const) },
          { id: 'lower', points: ts.map((t) => [t, passageDensity(t, d, 'lower')] as const), dashed: true },
        ],
      },
    },
  ];
  const tables: ResultTable[] = [];
  const notes: Note[] = [];
  const trials = whole(num(values, 'sim'), 0, 'sim');
  const rows = [
    { id: 'pUpper', value: r.pUpper, sym: 'P(\\text{upper})', answer: true },
    { id: 'meanDt', value: r.meanDt, sym: 'E[T_d]', answer: true },
    { id: 'meanRt', value: ter + r.meanDt, sym: 'E[RT]' },
  ];
  if (trials > 0) {
    const sim = simulate(d, ter, Math.min(trials, 20000), 0.001, makeRng(num(values, 'seed')));
    const upperQ = rtQuantiles(sim.upper);
    const lowerQ = rtQuantiles(sim.lower);
    rows.push({ id: 'simUpper', value: sim.upper.length / sim.trials, sym: '\\hat P' });
    tables.push({
      id: 'quantiles',
      columns: ['quantile', 'upperRt', 'lowerRt'],
      rows: QUANTILES.map((q, i) => [
        q,
        Number.isNaN(upperQ[i]) ? '' : upperQ[i],
        Number.isNaN(lowerQ[i]) ? '' : lowerQ[i],
      ]),
    });
    const all = [...sim.upper, ...sim.lower];
    if (all.length > 0) {
      const lo = Math.min(...all);
      const hi = Math.max(...all);
      const bins = 30;
      const width = (hi - lo) / bins || 0.01;
      const count = (times: readonly number[]) => {
        const out = Array.from({ length: bins }, () => 0);
        for (const t of times) out[Math.min(bins - 1, Math.floor((t - lo) / width))] += 1;
        return out.map((n, i) => [lo + (i + 0.5) * width, n / (sim.trials * width)] as const);
      };
      pictures.push({
        id: 'histogram',
        plot: {
          x: { id: 'rt' },
          y: { id: 'density', min: 0 },
          series: [
            { id: 'upper', points: count(sim.upper), kind: 'bars' },
            { id: 'lower', points: count(sim.lower), kind: 'bars' },
          ],
        },
      });
    }
    notes.push({ id: 'simulated', vars: { n: sim.trials, seed: num(values, 'seed'), left: sim.unfinished } });
  }
  return {
    rows,
    tables,
    notes,
    pictures,
    steps: symmetric
      ? [
          step('choice.symmetric', 'A = a/2 = [[A]]', vars),
          step(
            'choice.pSym',
            'P = \\frac{1}{1 + e^{-2vA/s^2}} = \\frac{1}{1 + e^{-2([[v]])([[A]])/[[s]]^2}} = [[p]]',
            vars,
          ),
          step(
            'choice.dtSym',
            'E[T_d] = \\frac{A}{v}\\tanh\\!\\left(\\frac{Av}{s^2}\\right) = [[dt]]\\ \\text{s}',
            vars,
          ),
          step('choice.rt', 'E[RT] = T_{er} + E[T_d] = [[ter]] + [[dt]] = [[rt]]\\ \\text{s}', vars),
        ]
      : [
          step('choice.pBias', 'P = \\frac{1 - e^{-2vz/s^2}}{1 - e^{-2va/s^2}} = [[p]]', vars),
          step('choice.dtBias', 'E[T_d] = \\frac{aP - z}{v} = [[dt]]\\ \\text{s}', vars),
          step('choice.rt', 'E[RT] = T_{er} + E[T_d] = [[ter]] + [[dt]] = [[rt]]\\ \\text{s}', vars),
        ],
  };
}

function runSpeed(values: Values): Outcome {
  const d = model(values);
  const ter = within(num(values, 'ter'), 0, 10, 'ter');
  const seps = grid(40, d.a / 10, d.a * 3);
  const points = seps.map((a) => {
    const r = diffusionChoice({ ...d, a });
    return { a, p: r.pUpper, rt: ter + r.meanDt };
  });
  const pick = [0.5, 1, 1.5, 2, 3].map((k) => d.a * k);
  return {
    rows: [{ id: 'pUpper', value: diffusionChoice(d).pUpper, sym: 'P', answer: true }],
    tables: [
      {
        id: 'tradeoff',
        columns: ['separation', 'accuracy', 'meanRt'],
        rows: pick.map((a) => {
          const r = diffusionChoice({ ...d, a });
          return [a, r.pUpper, ter + r.meanDt];
        }),
      },
    ],
    pictures: [
      {
        id: 'tradeoff',
        plot: {
          x: { id: 'meanRt' },
          y: { id: 'accuracy', max: 1 },
          series: [{ id: 'curve', points: points.map((one) => [one.rt, one.p] as const) }],
        },
      },
    ],
    steps: [step('choice.tradeoff')],
  };
}

function runEz(values: Values): Outcome {
  const pc = within(num(values, 'pc'), 0, 1, 'pc');
  const s = positive(num(values, 's'), 's');
  const r = ez(pc, num(values, 'vrt'), num(values, 'mrt'), s);
  const vars = {
    pc,
    vrt: num(values, 'vrt'),
    mrt: num(values, 'mrt'),
    s,
    L: r.L,
    x: r.x,
    v: r.v,
    a: r.a,
    mdt: r.mdt,
    ter: r.ter,
  };
  return {
    rows: [
      { id: 'v', value: r.v, sym: 'v', answer: true },
      { id: 'a', value: r.a, sym: 'a', answer: true },
      { id: 'ter', value: r.ter, sym: 'T_{er}', answer: true },
      { id: 'mdt', value: r.mdt, sym: 'MDT' },
    ],
    notes: pc > 0.99 ? [{ id: 'ezNearOne' }] : [],
    steps: [
      step(
        'choice.ezLogit',
        'L = \\ln\\frac{P_c}{1 - P_c} = [[L]],\\quad x = \\frac{L(LP_c^2 - LP_c + P_c - \\tfrac12)}{VRT} = [[x]]',
        vars,
      ),
      step(
        'choice.ezDrift',
        'v = \\operatorname{sign}(P_c - \\tfrac12)\\, s\\, x^{1/4} = [[v]],\\quad a = \\frac{s^2 L}{v} = [[a]]',
        vars,
      ),
      step(
        'choice.ezTer',
        'MDT = \\frac{a}{2v}\\cdot\\frac{1 - e^{-va/s^2}}{1 + e^{-va/s^2}} = [[mdt]],\\quad T_{er} ' +
          '= MRT - MDT = [[ter]]',
        vars,
      ),
    ],
  };
}

const shapeOf = (values: Values) => ({
  alpha: within(num(values, 'alpha'), 0.01, 2, 'alpha'),
  beta: within(num(values, 'beta'), 0.01, 2, 'beta'),
  lambda: positive(num(values, 'lambda'), 'lambda'),
});

const weighting = (values: Values) => str(values, 'weighting') as Weighting;

function runProspect(values: Values): Outcome {
  const shape = shapeOf(values);
  const x = num(values, 'x');
  const p = within(num(values, 'p'), 0, 1, 'p');
  const g = positive(num(values, 'gammaGain'), 'gammaGain');
  const delta = positive(num(values, 'delta'), 'delta');
  const v = value(x, shape);
  const w = weight(p, weighting(values), g, delta);
  const span = Math.max(Math.abs(x) * 1.5, 1);
  const vars = { x, v, p, w, g, alpha: shape.alpha, beta: shape.beta, lambda: shape.lambda, delta };
  return {
    rows: [
      { id: 'value', value: v, sym: 'v(x)', answer: true },
      { id: 'weight', value: w, sym: 'w(p)', answer: true },
    ],
    pictures: [
      {
        id: 'value',
        plot: {
          x: { id: 'outcome' },
          y: { id: 'value' },
          series: [{ id: 'valueCurve', points: grid(120, -span, span).map((t) => [t, value(t, shape)] as const) }],
        },
      },
      {
        id: 'weight',
        plot: {
          x: { id: 'p', min: 0, max: 1 },
          y: { id: 'w', min: 0, max: 1 },
          diagonal: true,
          square: true,
          series: [
            {
              id: 'weightCurve',
              points: grid(100, 0, 1).map((q) => [q, weight(q, weighting(values), g, delta)] as const),
            },
          ],
        },
      },
    ],
    steps: [
      x >= 0
        ? step('choice.valueGain', 'v(x) = x^{\\alpha} = [[x]]^{[[alpha]]} = [[v]]', vars)
        : step('choice.valueLoss', 'v(x) = -\\lambda(-x)^{\\beta} = -[[lambda]]\\,(-([[x]]))^{[[beta]]} = [[v]]', vars),
      weighting(values) === 'prelec'
        ? step('choice.prelec', 'w(p) = e^{-\\delta(-\\ln p)^{\\gamma}} = [[w]]', vars)
        : weighting(values) === 'none'
          ? step('choice.linear', 'w(p) = p = [[w]]', vars)
          : step('choice.tk', 'w(p) = \\frac{p^{\\gamma}}{(p^{\\gamma} + (1-p)^{\\gamma})^{1/\\gamma}} = [[w]]', vars),
    ],
  };
}

/** A gamble, one outcome a line: amount | probability. */
function readGamble(text: string, field: string): Prospect[] {
  const found = lines(text);
  if (found.length === 0) fail('empty', {}, field);
  return found.map(({ line, text: one }) => {
    const [xText, pText] = one.split(/[|,;\t]/).map((c) => c.trim());
    const x = readNumber(xText ?? '');
    const p = readNumber(pText ?? '');
    if (Number.isNaN(x) || Number.isNaN(p)) fail('gambleLine', { line }, field);
    return { x, p };
  });
}

const gambleTable = (id: string, g: GambleValue): ResultTable => ({
  id,
  columns: ['outcome', 'p', 'weight', 'value', 'product'],
  rows: g.outcomes.map((o) => [o.x, o.p, o.weight, o.value, o.weight * o.value]),
});

function runGamble(values: Values): Outcome {
  const shape = shapeOf(values);
  const g = positive(num(values, 'gammaGain'), 'gammaGain');
  const gl = positive(num(values, 'gammaLoss'), 'gammaLoss');
  const delta = positive(num(values, 'delta'), 'delta');
  const valueOf = (field: string) =>
    gamble(readGamble(str(values, field), field), shape, weighting(values), g, gl, delta);
  const A = valueOf('gambleA');
  const hasB = str(values, 'gambleB').trim() !== '';
  const B = hasB ? valueOf('gambleB') : null;
  const rows = [
    { id: 'worthA', value: A.worth, sym: 'V(A)', answer: true },
    { id: 'ceA', value: A.certainty, sym: 'CE(A)' },
    { id: 'evA', value: A.expected, sym: 'EV(A)' },
  ];
  if (B) {
    rows.push(
      { id: 'worthB', value: B.worth, sym: 'V(B)', answer: true },
      { id: 'ceB', value: B.certainty, sym: 'CE(B)' },
      { id: 'evB', value: B.expected, sym: 'EV(B)' },
    );
  }
  const prefer = B
    ? Math.abs(A.worth - B.worth) < 1e-12
      ? 'indifferent'
      : A.worth > B.worth
        ? 'preferA'
        : 'preferB'
    : null;
  return {
    rows,
    tables: B ? [gambleTable('gambleA', A), gambleTable('gambleB', B)] : [gambleTable('gambleA', A)],
    notes: prefer ? [{ id: prefer }] : [],
    steps: [
      step('choice.rank'),
      step('choice.worth', 'V = \\sum_i \\pi_i\\, v(x_i) = [[V]]', { V: A.worth }),
      step(
        A.worth >= 0 ? 'choice.ceGain' : 'choice.ceLoss',
        A.worth >= 0 ? 'CE = V^{1/\\alpha} = [[ce]]' : 'CE = -(-V/\\lambda)^{1/\\beta} = [[ce]]',
        { ce: A.certainty },
      ),
    ],
  };
}

export const spec: ToolSpec = {
  fields: [
    { id: 'mode', type: 'choice', options: ['diffusion', 'speed', 'ez', 'prospect', 'gamble'], first: 'diffusion' },
    { id: 'v', type: 'number', first: '0.2', when: usesModel },
    { id: 'a', type: 'number', first: '0.1', when: usesModel },
    { id: 'w', type: 'number', first: '0.5', when: usesModel },
    { id: 's', type: 'number', first: '0.1', when: (v) => usesModel(v) || v.mode === 'ez' },
    { id: 'ter', type: 'number', first: '0.3', when: usesModel },
    { id: 'sim', type: 'number', first: '1000', when: isMode('diffusion') },
    { id: 'seed', type: 'number', first: '1', when: isMode('diffusion') },
    { id: 'pc', type: 'number', first: '0.916827', when: isMode('ez') },
    { id: 'vrt', type: 'number', first: '0.0350723', when: isMode('ez') },
    { id: 'mrt', type: 'number', first: '0.550096', when: isMode('ez') },
    { id: 'alpha', type: 'number', first: '0.88', when: usesShape },
    { id: 'beta', type: 'number', first: '0.88', when: usesShape },
    { id: 'lambda', type: 'number', first: '2.25', when: usesShape },
    { id: 'weighting', type: 'choice', options: ['tk', 'prelec', 'none'], first: 'tk', when: usesShape },
    { id: 'gammaGain', type: 'number', first: '0.61', when: (v) => usesShape(v) && v.weighting !== 'none' },
    { id: 'gammaLoss', type: 'number', first: '0.69', when: (v) => v.mode === 'gamble' && v.weighting !== 'none' },
    { id: 'delta', type: 'number', first: '1', when: (v) => usesShape(v) && v.weighting === 'prelec' },
    { id: 'x', type: 'number', first: '100', when: isMode('prospect') },
    { id: 'p', type: 'number', first: '0.1', when: isMode('prospect') },
    { id: 'gambleA', type: 'text', rows: 3, first: '1000000 | 1', when: isMode('gamble') },
    { id: 'gambleB', type: 'text', rows: 3, first: '5000000 | 0.10\n1000000 | 0.89\n0 | 0.01', when: isMode('gamble') },
  ],
  run(values) {
    if (values.mode === 'speed') return runSpeed(values);
    if (values.mode === 'ez') return runEz(values);
    if (values.mode === 'prospect') return runProspect(values);
    if (values.mode === 'gamble') return runGamble(values);
    return runDiffusion(values);
  },
  examples: [
    { id: 'diffusion', values: { mode: 'diffusion' } },
    { id: 'biased', values: { mode: 'diffusion', w: '0.7', sim: '0' } },
    { id: 'speed', values: { mode: 'speed' } },
    { id: 'ez', values: { mode: 'ez' } },
    { id: 'loss', values: { mode: 'prospect', x: '-100' } },
    { id: 'allais', values: { mode: 'gamble' } },
    {
      id: 'gainFrame',
      values: { mode: 'gamble', gambleA: '200 | 1', gambleB: '600 | 0.3333333333\n0 | 0.6666666667' },
    },
    {
      id: 'lossFrame',
      values: { mode: 'gamble', gambleA: '-400 | 1', gambleB: '0 | 0.3333333333\n-600 | 0.6666666667' },
    },
  ],
};
