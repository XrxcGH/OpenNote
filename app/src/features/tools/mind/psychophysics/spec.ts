// The psychophysics tool's fields, results, steps, and plots.
import { mean, sd } from '../kit/num';
import { readList, readMatrix } from '../kit/parse';
import { makeRng } from '../kit/rng';
import { num, str, type Note, type Outcome, type ResultRow, type ToolSpec, type Values } from '../kit/spec';
import { fail, positive, step, whole, within, type KitStep } from '../kit/types';
import {
  bootstrap,
  convergence,
  fechnerSteps,
  fitPsi,
  MAX_LAPSE,
  michelson,
  psi,
  psiSlope,
  reversalsOf,
  rmsContrast,
  simulateStaircase,
  sizeForAngle,
  snellen,
  staircaseThreshold,
  stevens,
  threshold,
  visualAngle,
  weber,
  weberContrast,
  weightedUp,
  type Shape,
} from './engine';

const isMode = (mode: string) => (v: Values) => v.mode === mode;
const grid = (n: number, lo: number, hi: number) => Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);
const usesGuess = (v: Values) => v.mode === 'fit' || v.mode === 'simulate';
const vision = (measure: string) => (v: Values) => v.mode === 'vision' && v.measure === measure;

const FIT = [
  '# level | correct | trials',
  '2 | 3 | 40',
  '3 | 5 | 40',
  '4 | 11 | 40',
  '5 | 19 | 40',
  '6 | 30 | 40',
  '7 | 36 | 40',
  '8 | 39 | 40',
].join('\n');

const PSI_MATH = '\\psi(x) = \\gamma + (1 - \\gamma - \\lambda)\\,F(x;\\alpha,\\beta)';
const SHAPE_MATH: Record<Shape, string> = {
  logistic: 'F = \\frac{1}{1 + e^{-\\beta(x - \\alpha)}}',
  gaussian: 'F = \\Phi(\\beta(x - \\alpha))',
  weibull: 'F = 1 - e^{-(x/\\alpha)^{\\beta}}',
};

const guessOf = (values: Values): number => (values.task === 'mafc' ? 1 / whole(num(values, 'm'), 2, 'm') : 0);

function runFit(values: Values): Outcome {
  const { rows } = readMatrix(str(values, 'data'), 'data');
  if (rows[0].length !== 3) fail('ragged', { line: 1, got: rows[0].length, want: 3 }, 'data');
  const points = rows.map(([x, k, n]) => ({ x, k, n }));
  const shape = str(values, 'shape') as Shape;
  const gamma = guessOf(values);
  const lapse = values.lapse === 'free' ? 'free' : within(num(values, 'lambda'), 0, MAX_LAPSE, 'lambda');
  const fit = fitPsi(points, shape, gamma, lapse);
  const level = within(num(values, 'level'), 0, 1, 'level');
  const t = threshold(fit, level);
  if (Number.isNaN(t)) fail('levelOutside', { low: gamma, high: 1 - fit.lambda }, 'level');
  const yesNo = values.task !== 'mafc';
  const rowsOut: ResultRow[] = [
    { id: 'alpha', value: fit.alpha, sym: '\\alpha' },
    { id: 'beta', value: fit.beta, sym: '\\beta' },
    { id: 'gamma', value: gamma, sym: '\\gamma' },
    { id: 'lambda', value: fit.lambda, sym: '\\lambda' },
    { id: 'threshold', value: t, vars: { level }, sym: 'x_t', answer: true },
    { id: 'slope', value: psiSlope(t, fit), sym: "\\psi'(x)" },
    { id: 'logLik', value: fit.logLik, sym: '\\ln L' },
    { id: 'deviance', value: fit.deviance, sym: 'D' },
  ];
  const vars = { a: fit.alpha, b: fit.beta, g: gamma, l: fit.lambda, ll: fit.logLik, t, level, pse: NaN, jnd: NaN };
  const steps: KitStep[] = [
    step('psychophysics.model', `${PSI_MATH},\\quad ${SHAPE_MATH[shape]}`),
    step(
      'psychophysics.likelihood',
      '\\ln L = \\sum_i k_i \\ln\\psi(x_i) + (n_i - k_i)\\ln(1 - \\psi(x_i)) = [[ll]]',
      vars,
    ),
    step('psychophysics.params', '\\alpha = [[a]],\\ \\beta = [[b]],\\ \\gamma = [[g]],\\ \\lambda = [[l]]', vars),
    step('psychophysics.threshold', '\\psi(x) = [[level]] \\Rightarrow x = [[t]]', vars),
  ];
  if (yesNo) {
    const pse = threshold(fit, 0.5);
    const jnd = (threshold(fit, 0.75) - threshold(fit, 0.25)) / 2;
    if (Number.isFinite(pse) && Number.isFinite(jnd)) {
      rowsOut.push({ id: 'pse', value: pse, sym: 'PSE' }, { id: 'jnd', value: jnd, sym: 'JND' });
      steps.push(
        step('psychophysics.pse', 'PSE = x_{0.5} = [[pse]],\\quad JND = \\tfrac12(x_{0.75} - x_{0.25}) = [[jnd]]', {
          ...vars,
          pse,
          jnd,
        }),
      );
    }
  }
  const notes: Note[] = [];
  const draws = whole(num(values, 'boot'), 0, 'boot');
  if (draws > 0) {
    const ci = bootstrap(points, fit, lapse, level, Math.min(draws, 2000), makeRng(num(values, 'seed')));
    rowsOut.push(
      { id: 'thresholdLow', value: ci.threshold.low, vars: { level } },
      { id: 'thresholdHigh', value: ci.threshold.high, vars: { level } },
      { id: 'betaLow', value: ci.beta.low },
      { id: 'betaHigh', value: ci.beta.high },
    );
    notes.push({ id: 'bootstrap', vars: { used: ci.threshold.used, seed: num(values, 'seed') } });
  }
  const xs = points.map((p) => p.x);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const pad = (hi - lo) * 0.1;
  return {
    rows: rowsOut,
    notes,
    tables: [
      {
        id: 'data',
        columns: ['level', 'correct', 'trials', 'observed', 'fitted'],
        rows: points.map((p) => [p.x, p.k, p.n, p.k / p.n, psi(p.x, fit)]),
      },
    ],
    pictures: [
      {
        id: 'fit',
        plot: {
          x: { id: 'level' },
          y: { id: 'pc', min: 0, max: 1 },
          series: [
            { id: 'data', points: points.map((p) => [p.x, p.k / p.n] as const), kind: 'points' },
            {
              id: 'fit',
              points: grid(160, Math.max(shape === 'weibull' ? 1e-6 : -Infinity, lo - pad), hi + pad).map(
                (x) => [x, psi(x, fit)] as const,
              ),
            },
          ],
          marks: [{ x: t }],
        },
      },
    ],
    steps,
  };
}

function trackPicture(levels: readonly number[], reversals: readonly number[]) {
  return {
    id: 'track',
    plot: {
      x: { id: 'trial' },
      y: { id: 'level' },
      series: [
        { id: 'track', points: levels.map((l, i) => [i + 1, l] as const), kind: 'steps' as const },
        { id: 'reversals', points: reversals.map((i) => [i + 1, levels[i]] as const), kind: 'points' as const },
      ],
    },
  };
}

function runStaircase(values: Values): Outcome {
  const levels = readList(str(values, 'track'), 'track');
  const reversals = reversalsOf(levels);
  const last = whole(num(values, 'last'), 1, 'last');
  const r = staircaseThreshold({ levels, reversals }, last);
  return {
    rows: [
      { id: 'trials', value: levels.length },
      { id: 'reversalCount', value: reversals.length },
      { id: 'staircase', value: r.value, vars: { used: r.used }, answer: true },
    ],
    tables: [
      {
        id: 'reversals',
        columns: ['reversal', 'trial', 'level'],
        rows: reversals.map((i, k) => [k + 1, i + 1, levels[i]]),
      },
    ],
    pictures: [trackPicture(levels, reversals)],
    steps: [
      step('psychophysics.reversals'),
      step('psychophysics.lastK', '\\bar x = \\frac{1}{[[used]]}\\sum x_{\\text{rev}} = [[t]]', {
        used: r.used,
        t: r.value,
      }),
    ],
  };
}

function runSimulate(values: Values): Outcome {
  const weighted = values.rule === 'weighted';
  const down = weighted ? 1 : Number(String(values.rule).slice(-1));
  const target = weighted ? within(num(values, 'target'), 0.5, 0.99, 'target') : convergence(down);
  const stepDown = positive(num(values, 'step'), 'step');
  const observer = {
    shape: 'logistic' as const,
    alpha: num(values, 'alpha'),
    beta: positive(num(values, 'beta'), 'beta'),
    gamma: guessOf(values),
    lambda: 0,
  };
  const trials = whole(num(values, 'trials'), 2, 'trials');
  const track = simulateStaircase(
    {
      start: num(values, 'start'),
      stepDown,
      stepUp: weighted ? stepDown * weightedUp(target) : stepDown,
      down,
      trials: Math.min(trials, 5000),
      floor: -Infinity,
    },
    observer,
    makeRng(num(values, 'seed')),
  );
  const last = whole(num(values, 'last'), 1, 'last');
  const r = staircaseThreshold(track, last);
  const truth = threshold(observer, target);
  return {
    rows: [
      { id: 'target', value: target, sym: 'p^*' },
      { id: 'truth', value: truth, sym: 'x^*' },
      { id: 'reversalCount', value: track.reversals.length },
      { id: 'staircase', value: r.value, vars: { used: r.used }, answer: true },
      { id: 'correctShare', value: track.responses.filter(Boolean).length / track.responses.length },
    ],
    pictures: [trackPicture(track.levels, track.reversals)],
    notes: [{ id: 'simulated', vars: { seed: num(values, 'seed') } }],
    steps: weighted
      ? [
          step(
            'psychophysics.weighted',
            '\\frac{\\Delta_{\\uparrow}}{\\Delta_{\\downarrow}} = \\frac{p^*}{1 - p^*} = [[r]]',
            { r: weightedUp(target) },
          ),
        ]
      : [
          step('psychophysics.converge', 'p^{[[n]]} = 0.5 \\Rightarrow p = 0.5^{1/[[n]]} = [[p]]', {
            n: down,
            p: target,
          }),
        ],
  };
}

function runLimits(values: Values): Outcome {
  const xs = readList(str(values, 'settings'), 'settings');
  if (xs.length < 2) fail('fewPoints', { low: 2 }, 'settings');
  const m = mean(xs);
  const s = sd(xs);
  if (values.method === 'adjust') {
    const standard = num(values, 'standard');
    return {
      rows: [
        { id: 'pse', value: m, sym: 'PSE', answer: true },
        { id: 'constantError', value: m - standard, sym: 'CE' },
        { id: 'jndSd', value: s, sym: 'SD' },
        { id: 'jndQ', value: 0.6745 * s, sym: '0.6745\\,SD' },
      ],
      steps: [
        step('psychophysics.adjustPse', 'PSE = \\bar x = [[m]],\\quad CE = PSE - S = [[ce]]', { m, ce: m - standard }),
        step('psychophysics.adjustJnd', 'JND \\approx 0.6745\\,SD = [[j]]', { j: 0.6745 * s }),
      ],
    };
  }
  return {
    rows: [
      { id: 'limitThreshold', value: m, answer: true },
      { id: 'sdSettings', value: s },
      { id: 'series', value: xs.length },
    ],
    steps: [step('psychophysics.limits', '\\bar x = [[m]],\\quad SD = [[s]]', { m, s })],
  };
}

function runWeber(values: Values): Outcome {
  const { rows } = readMatrix(str(values, 'weber'), 'weber');
  if (rows[0].length !== 2) fail('ragged', { line: 1, got: rows[0].length, want: 2 }, 'weber');
  const r = weber(rows);
  const i0 = positive(num(values, 'i0'), 'i0');
  const i = positive(num(values, 'i'), 'i');
  const steps = fechnerSteps(i0, i, r.k);
  return {
    rows: [
      { id: 'weberK', value: r.k, sym: 'k', answer: true },
      { id: 'fechner', value: steps, sym: 'S', answer: true },
    ],
    tables: [
      { id: 'weber', columns: ['intensity', 'jnd', 'fraction'], rows: rows.map(([a, d], k) => [a, d, r.each[k]]) },
    ],
    steps: [
      step('psychophysics.weberFit', 'k = \\frac{\\sum I\\,\\Delta I}{\\sum I^2} = [[k]]', { k: r.k }),
      step(
        'psychophysics.fechner',
        'S = \\frac{\\ln(I/I_0)}{\\ln(1 + k)} = \\frac{\\ln([[i]]/[[i0]])}{\\ln(1 + [[k]])} = [[s]]',
        { i, i0, k: r.k, s: steps },
      ),
    ],
  };
}

function runStevens(values: Values): Outcome {
  const { rows } = readMatrix(str(values, 'stevens'), 'stevens');
  if (rows[0].length !== 2) fail('ragged', { line: 1, got: rows[0].length, want: 2 }, 'stevens');
  const r = stevens(rows);
  const ss = rows.map(([s]) => s);
  return {
    rows: [
      { id: 'exponent', value: r.n, sym: 'n', answer: true },
      { id: 'constant', value: r.k, sym: 'k', answer: true },
      { id: 'r2', value: r.r2, sym: 'r^2' },
    ],
    pictures: [
      {
        id: 'stevens',
        plot: {
          x: { id: 'lnS' },
          y: { id: 'lnPsi' },
          series: [
            { id: 'data', points: rows.map(([s, p]) => [Math.log(s), Math.log(p)] as const), kind: 'points' },
            {
              id: 'fit',
              points: [Math.min(...ss), Math.max(...ss)].map(
                (s) => [Math.log(s), Math.log(r.k) + r.n * Math.log(s)] as const,
              ),
            },
          ],
        },
      },
    ],
    steps: [
      step('psychophysics.stevens', '\\ln\\psi = \\ln k + n\\ln S,\\quad n = [[n]],\\ k = [[k]]', { n: r.n, k: r.k }),
    ],
  };
}

function runVision(values: Values): Outcome {
  const measure = str(values, 'measure');
  if (measure === 'angle') {
    const s = positive(num(values, 'size'), 'size');
    const d = positive(num(values, 'distance'), 'distance');
    const deg = visualAngle(s, d);
    return {
      rows: [
        { id: 'angle', value: deg, sym: '\\theta', answer: true },
        { id: 'arcmin', value: deg * 60, sym: "\\theta'" },
        { id: 'cpd', value: 1 / deg, sym: '\\text{c/deg}' },
      ],
      steps: [
        step(
          'psychophysics.angle',
          '\\theta = 2\\arctan\\frac{s}{2d} = 2\\arctan\\frac{[[s]]}{2 \\times [[d]]} = [[t]]^\\circ',
          { s, d, t: deg },
        ),
        step('psychophysics.cpd', '\\frac{1}{\\theta} = [[c]]\\ \\text{cycles per degree}', { c: 1 / deg }),
      ],
    };
  }
  if (measure === 'size') {
    const deg = positive(num(values, 'angle'), 'angle');
    if (!(deg < 180)) fail('range', { low: 0, high: 180 }, 'angle');
    const d = positive(num(values, 'distance'), 'distance');
    const s = sizeForAngle(deg, d);
    return {
      rows: [{ id: 'size', value: s, sym: 's', answer: true }],
      steps: [step('psychophysics.size', 's = 2d\\tan\\frac{\\theta}{2} = [[s]]', { s })],
    };
  }
  if (measure === 'contrast') {
    const lmax = positive(num(values, 'lmax'), 'lmax');
    const lmin = num(values, 'lmin');
    if (!(lmin >= 0)) fail('notNegative', {}, 'lmin');
    if (lmin > lmax) fail('lumOrder', {}, 'lmin');
    const ls = readList(str(values, 'lums'), 'lums');
    if (ls.some((l) => l < 0)) fail('notNegative', {}, 'lums');
    if (!(mean(ls) > 0)) fail('positive', {}, 'lums');
    const m = michelson(lmax, lmin);
    const w = lmin > 0 ? weberContrast(lmax, lmin) : NaN;
    const r = rmsContrast(ls);
    return {
      rows: [
        { id: 'michelson', value: m, sym: 'C_M', answer: true },
        { id: 'weberC', value: w, sym: 'C_W' },
        { id: 'rms', value: r, sym: 'C_{RMS}' },
      ],
      steps: [
        step('psychophysics.michelson', 'C_M = \\frac{L_{max} - L_{min}}{L_{max} + L_{min}} = [[m]]', { m }),
        step('psychophysics.weberC', 'C_W = \\frac{L_t - L_b}{L_b} = [[w]]', { w }),
        step('psychophysics.rms', 'C_{RMS} = \\frac{\\sigma_L}{\\bar L} = [[r]]', { r }),
      ],
    };
  }
  const match = /^\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*$/.exec(str(values, 'snellen'));
  if (!match) fail('snellenForm', {}, 'snellen');
  const r = snellen(Number(match[1]), Number(match[2]));
  return {
    rows: [
      { id: 'logMar', value: r.logMar, sym: '\\text{logMAR}', answer: true },
      { id: 'decimal', value: r.decimal, sym: 'V' },
      { id: 'mar', value: r.mar, sym: '\\text{MAR}' },
    ],
    steps: [
      step('psychophysics.mar', '\\text{MAR} = \\frac{[[den]]}{[[num]]} = [[mar]]\\ \\text{arcmin}', {
        den: Number(match[2]),
        num: Number(match[1]),
        mar: r.mar,
      }),
      step('psychophysics.logmar', '\\text{logMAR} = \\log_{10}\\text{MAR} = [[l]]', { l: r.logMar }),
    ],
  };
}

export const spec: ToolSpec = {
  fields: [
    {
      id: 'mode',
      type: 'choice',
      options: ['fit', 'staircase', 'simulate', 'limits', 'weber', 'stevens', 'vision'],
      first: 'fit',
    },
    { id: 'data', type: 'text', rows: 7, first: FIT, when: isMode('fit') },
    {
      id: 'shape',
      type: 'choice',
      options: ['logistic', 'gaussian', 'weibull'],
      first: 'logistic',
      when: isMode('fit'),
    },
    { id: 'task', type: 'choice', options: ['yesno', 'mafc'], first: 'yesno', when: usesGuess },
    { id: 'm', type: 'number', first: '2', when: (v) => usesGuess(v) && v.task === 'mafc' },
    { id: 'lapse', type: 'choice', options: ['fixed', 'free'], first: 'fixed', when: isMode('fit') },
    { id: 'lambda', type: 'number', first: '0', when: (v) => v.mode === 'fit' && v.lapse !== 'free' },
    { id: 'level', type: 'number', first: '0.5', when: isMode('fit') },
    { id: 'boot', type: 'number', first: '200', when: isMode('fit') },
    { id: 'seed', type: 'number', first: '1', when: (v) => v.mode === 'fit' || v.mode === 'simulate' },
    {
      id: 'track',
      type: 'text',
      rows: 3,
      first: '10 9 8 7 8 7 6 7 8 7 6 5 6 7 6 5 6 7 6 5',
      when: isMode('staircase'),
    },
    {
      id: 'rule',
      type: 'choice',
      options: ['down1', 'down2', 'down3', 'weighted'],
      first: 'down2',
      when: isMode('simulate'),
    },
    { id: 'target', type: 'number', first: '0.75', when: (v) => v.mode === 'simulate' && v.rule === 'weighted' },
    { id: 'alpha', type: 'number', first: '5', when: isMode('simulate') },
    { id: 'beta', type: 'number', first: '1', when: isMode('simulate') },
    { id: 'start', type: 'number', first: '10', when: isMode('simulate') },
    { id: 'step', type: 'number', first: '0.5', when: isMode('simulate') },
    { id: 'trials', type: 'number', first: '120', when: isMode('simulate') },
    { id: 'last', type: 'number', first: '6', when: (v) => v.mode === 'staircase' || v.mode === 'simulate' },
    { id: 'method', type: 'choice', options: ['series', 'adjust'], first: 'series', when: isMode('limits') },
    { id: 'settings', type: 'line', first: '4.2, 3.8, 4.5, 3.9, 4.1, 4.0', when: isMode('limits') },
    { id: 'standard', type: 'number', first: '4', when: (v) => v.mode === 'limits' && v.method === 'adjust' },
    {
      id: 'weber',
      type: 'text',
      rows: 4,
      first: 'intensity | jnd\n100 | 2\n200 | 4.2\n400 | 7.8',
      when: isMode('weber'),
    },
    { id: 'i0', type: 'number', first: '100', when: isMode('weber') },
    { id: 'i', type: 'number', first: '400', when: isMode('weber') },
    {
      id: 'stevens',
      type: 'text',
      rows: 4,
      first: 'stimulus | judgment\n1 | 2\n2 | 3.18\n4 | 5.07\n8 | 8.06',
      when: isMode('stevens'),
    },
    {
      id: 'measure',
      type: 'choice',
      options: ['angle', 'size', 'contrast', 'acuity'],
      first: 'angle',
      when: isMode('vision'),
    },
    { id: 'size', type: 'number', first: '1', when: vision('angle') },
    { id: 'angle', type: 'number', first: '1', when: vision('size') },
    { id: 'distance', type: 'number', first: '57.3', when: (v) => vision('angle')(v) || vision('size')(v) },
    { id: 'lmax', type: 'number', first: '80', when: vision('contrast') },
    { id: 'lmin', type: 'number', first: '20', when: vision('contrast') },
    { id: 'lums', type: 'line', first: '20, 80, 20, 80', when: vision('contrast') },
    { id: 'snellen', type: 'line', first: '20/40', when: vision('acuity') },
  ],
  run(values) {
    if (values.mode === 'staircase') return runStaircase(values);
    if (values.mode === 'simulate') return runSimulate(values);
    if (values.mode === 'limits') return runLimits(values);
    if (values.mode === 'weber') return runWeber(values);
    if (values.mode === 'stevens') return runStevens(values);
    if (values.mode === 'vision') return runVision(values);
    return runFit(values);
  },
  examples: [
    { id: 'yesno', values: { mode: 'fit' } },
    {
      id: 'twoAfc',
      values: {
        mode: 'fit',
        task: 'mafc',
        m: '2',
        shape: 'weibull',
        level: '0.75',
        data: '1 | 21 | 40\n2 | 24 | 40\n3 | 31 | 40\n4 | 37 | 40\n5 | 40 | 40',
        boot: '0',
      },
    },
    { id: 'staircase', values: { mode: 'staircase' } },
    { id: 'simulate', values: { mode: 'simulate' } },
    { id: 'adjust', values: { mode: 'limits', method: 'adjust' } },
    { id: 'weber', values: { mode: 'weber' } },
    { id: 'stevens', values: { mode: 'stevens' } },
    { id: 'angle', values: { mode: 'vision', measure: 'angle' } },
    { id: 'contrast', values: { mode: 'vision', measure: 'contrast' } },
    { id: 'acuity', values: { mode: 'vision', measure: 'acuity' } },
  ],
};
