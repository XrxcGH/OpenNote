// The logistic and Poisson regression tool. It takes an outcome column (0/1, successes out of trials, or counts with
// an exposure) and predictor columns, where words become reference-coded levels. It shows the fitted model with odds
// or rate ratios and their intervals, likelihood-ratio tests, fit measures, the ROC curve, and each IRLS step.
import { parseTable, numbersAt } from '../kit/data';
import { buildDesign, INTERCEPT, mainTerms, type Design } from '../kit/design';
import { linearLatex, percent } from '../kit/format';
import type { PlotSpec } from '../kit/picture';
import {
  columnList,
  type Outcome,
  type Picture,
  type ResultRow,
  type ResultTable,
  type ToolSpec,
  type Values,
} from '../kit/spec';
import { fail, step, type KitStep } from '../kit/types';
import { analyzeGlm, rates, type GlmResult } from './engine';

const LOGISTIC = 'hours,passed\n0,0\n1,0\n2,0\n3,1\n4,0\n5,1\n6,1\n7,0\n8,1\n9,1';
const POISSON = 'week,cases,exposure\n1,2,10\n2,3,10\n3,6,12\n4,7,12\n5,8,12\n6,9,14\n7,10,14\n8,12,15\n9,15,15';
const GROUPED =
  'dose,group,dead,total\n1,A,2,20\n2,A,5,20\n3,A,11,20\n4,A,16,20\n1,B,1,20\n2,B,3,20\n3,B,8,20\n4,B,13,20';

const isLogistic = (v: Values) => v.family === 'logistic';

function prepare(values: Values) {
  const table = parseTable(String(values.data));
  const outcome = String(values.outcome);
  const predictors = columnList(values.predictors);
  if (predictors.includes(outcome)) fail('outcomeIsPredictor', outcome);
  const trials = isLogistic(values) ? String(values.trials) : '';
  const exposure = isLogistic(values) ? '' : String(values.exposure);
  const need = [outcome, trials, exposure].filter((name) => name !== '');
  const design = buildDesign(table, mainTerms(predictors), { need });
  const at = (name: string) => numbersAt(table, name, design.rows);
  const exposures = exposure ? at(exposure) : undefined;
  if (exposures?.some((e) => !(e > 0))) fail('exposurePositive', exposure);
  const result = analyzeGlm({
    family: isLogistic(values) ? 'logistic' : 'poisson',
    design,
    y: at(outcome),
    ...(trials ? { trials: at(trials) } : {}),
    ...(exposures ? { offset: exposures.map(Math.log) } : {}),
    level: Number(values.level),
    threshold: isLogistic(values) ? Number(values.threshold) : 0.5,
  });
  return { result, design, outcome, exposures, y: at(outcome), trials: trials ? at(trials) : undefined };
}

function rows(r: GlmResult): ResultRow[] {
  const first = r.coefs[1];
  const out: ResultRow[] = [];
  if (first)
    out.push({
      id: 'ratio',
      value: Math.exp(first.estimate),
      answer: true,
      sym: r.family === 'logistic' ? '\\mathrm{OR}' : '\\mathrm{RR}',
    });
  out.push(
    { id: 'n', value: r.n },
    { id: 'deviance', value: r.fit.deviance, sym: 'D' },
    { id: 'nullDeviance', value: r.nullDeviance, sym: 'D_0' },
    { id: 'lr', value: r.lr, sym: 'G^2' },
    { id: 'lrDf', value: r.lrDf },
    { id: 'lrP', value: r.lrP, sym: 'p' },
    { id: 'aic', value: r.aic, sym: '\\mathrm{AIC}' },
    { id: 'bic', value: r.bic, sym: '\\mathrm{BIC}' },
    { id: 'mcFadden', value: r.mcFadden },
    { id: 'coxSnell', value: r.coxSnell },
    { id: 'nagelkerke', value: r.nagelkerke },
  );
  if (r.auc !== undefined) out.push({ id: 'auc', value: r.auc, sym: '\\mathrm{AUC}' });
  if (r.hosmer) out.push({ id: 'hosmer', value: r.hosmer.chi2 }, { id: 'hosmerP', value: r.hosmer.p });
  if (r.table) {
    const t = rates(r.table);
    out.push(
      { id: 'accuracy', value: t.accuracy },
      { id: 'sensitivity', value: t.sensitivity },
      { id: 'specificity', value: t.specificity },
    );
  }
  if (r.family === 'poisson') out.push({ id: 'dispersion', value: r.dispersion, sym: '\\hat\\phi' });
  return out;
}

function tables(r: GlmResult): ResultTable[] {
  const out: ResultTable[] = [
    {
      id: 'coef',
      columns: ['term', 'estimate', 'se', 'z', 'p', 'low', 'high'],
      rows: r.coefs.map((c) => [c.name, c.estimate, c.se, c.z, c.p, c.low, c.high]),
    },
    {
      id: 'ratios',
      columns: ['term', 'ratio', 'low', 'high', 'profileLow', 'profileHigh'],
      rows: r.coefs
        .slice(1)
        .map((c) => [
          c.name,
          Math.exp(c.estimate),
          Math.exp(c.low),
          Math.exp(c.high),
          Math.exp(c.profileLow),
          Math.exp(c.profileHigh),
        ]),
    },
    { id: 'terms', columns: ['term', 'df', 'chi2', 'p'], rows: r.terms.map((t) => [t.label, t.df, t.chi2, t.p]) },
    { id: 'iterations', columns: ['iteration', 'deviance'], rows: r.fit.history.map((d, i) => [i + 1, d]) },
  ];
  if (r.family === 'poisson')
    out[0] = {
      id: 'coef',
      columns: ['term', 'estimate', 'se', 'z', 'p', 'low', 'high', 'quasiSe'],
      rows: r.coefs.map((c) => [c.name, c.estimate, c.se, c.z, c.p, c.low, c.high, c.se * Math.sqrt(r.dispersion)]),
    };
  if (r.table)
    out.push({
      id: 'classification',
      columns: ['actual', 'said1', 'said0'],
      rows: [
        ['1', r.table.tp, r.table.fn],
        ['0', r.table.fp, r.table.tn],
      ],
    });
  return out;
}

/** The fitted curve against the first numeric predictor, with the others at their means. */
function curve(
  r: GlmResult,
  design: Design,
  y: readonly number[],
  denom: readonly number[] | undefined,
): Picture | null {
  const j = design.columns.findIndex((name, k) => k > 0 && design.terms.some((t) => t.label === name));
  if (j < 0) return null;
  const xs = design.x.map((row) => row[j]);
  const means = design.columns.map((_, k) => design.x.reduce((s, row) => s + row[k], 0) / design.x.length);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const points: [number, number][] = Array.from({ length: 61 }, (_, i) => {
    const x = lo + ((hi - lo) * i) / 60;
    const eta = r.fit.coef.reduce((s, b, k) => s + b * (k === j ? x : means[k]), 0);
    return [x, r.family === 'logistic' ? 1 / (1 + Math.exp(-eta)) : Math.exp(eta)];
  });
  const observed = xs.map((x, i) => [x, y[i] / (denom?.[i] ?? 1)] as [number, number]);
  const plot: PlotSpec = {
    x: { label: 'predictor' },
    y: { label: r.family === 'logistic' ? 'probability' : 'rate' },
    series: [
      { id: 'observed', points: observed, style: 'points' },
      { id: 'fitted', points },
    ],
    ...(r.family === 'logistic' ? { yRange: [-0.05, 1.05] as const } : {}),
  };
  return { id: 'curve', type: 'plot', plot };
}

function steps(r: GlmResult, level: number): KitStep[] {
  const logistic = r.family === 'logistic';
  const out: KitStep[] = [
    step(
      logistic ? 'glm.modelLogistic' : 'glm.modelPoisson',
      logistic ? '\\ln\\frac{\\pi}{1-\\pi} = \\eta = X\\beta' : '\\ln \\mu = \\ln(\\text{exposure}) + X\\beta',
    ),
    step(
      'glm.irls',
      'z = \\eta + \\frac{y - \\mu}{d\\mu/d\\eta},\\quad W = \\frac{(d\\mu/d\\eta)^2}{\\operatorname{Var}(\\mu)},' +
        '\\quad \\hat\\beta = (X^\\top W X)^{-1} X^\\top W z',
      { iterations: r.fit.history.length, first: r.fit.history[0], last: r.fit.deviance },
    ),
  ];
  for (const c of r.coefs)
    out.push(
      step('glm.coef', 'z = \\frac{[[b]]}{[[se]]} = [[z]]', { term: c.name, b: c.estimate, se: c.se, z: c.z, p: c.p }),
    );
  for (const c of r.coefs.slice(1))
    out.push(
      step('glm.ratio', 'e^{[[b]]} = [[ratio]],\\quad e^{[[b]] \\pm [[zc]] \\times [[se]]} = ([[lo]],\\ [[hi]])', {
        term: c.name,
        b: c.estimate,
        se: c.se,
        zc: r.zCrit,
        ratio: Math.exp(c.estimate),
        lo: Math.exp(c.low),
        hi: Math.exp(c.high),
        level: percent(level),
      }),
    );
  out.push(
    step('glm.lr', 'G^2 = D_0 - D = [[d0]] - [[d]] = [[lr]],\\quad df = [[df]],\\quad p = [[p]]', {
      d0: r.nullDeviance,
      d: r.fit.deviance,
      lr: r.lr,
      df: r.lrDf,
      p: r.lrP,
    }),
    step('glm.pseudo', 'R^2_{\\mathrm{McF}} = 1 - \\frac{\\ell}{\\ell_0} = 1 - \\frac{[[ll]]}{[[ll0]]} = [[r2]]', {
      ll: r.fit.logLik,
      ll0: r.nullLogLik,
      r2: r.mcFadden,
    }),
  );
  if (r.auc !== undefined) out.push(step('glm.auc', undefined, { auc: r.auc }));
  if (r.family === 'poisson')
    out.push(step('glm.dispersion', '\\hat\\phi = \\frac{X^2}{n - p} = [[phi]]', { phi: r.dispersion }));
  return out;
}

function words(r: GlmResult, outcome: string, level: number): KitStep | undefined {
  const c = r.coefs[1];
  if (!c) return undefined;
  return step(r.family === 'logistic' ? 'glm.wordsLogistic' : 'glm.wordsPoisson', undefined, {
    term: c.name,
    outcome,
    ratio: Math.exp(c.estimate),
    lo: Math.exp(c.low),
    hi: Math.exp(c.high),
    level: percent(level),
    z: c.z,
    p: c.p,
  });
}

function run(values: Values): Outcome {
  const { result: r, design, outcome, exposures, y, trials } = prepare(values);
  const level = Number(values.level);
  const notes = [r.family === 'logistic' ? 'linearLogit' : 'linearLog', 'independent'];
  if (r.family === 'poisson' && r.dispersion > 1.5) notes.push('overdispersed');
  if (r.coefs.some((c) => Number.isNaN(c.profileLow) || Number.isNaN(c.profileHigh))) notes.push('profileMissing');
  const pictures: Picture[] = [];
  const fitted = curve(r, design, y, exposures ?? trials);
  if (fitted) pictures.push(fitted);
  if (r.roc)
    pictures.push({
      id: 'roc',
      type: 'plot',
      plot: {
        x: { label: 'fpr' },
        y: { label: 'tpr' },
        series: [
          { id: 'roc', points: r.roc, style: 'step' },
          {
            id: 'chance',
            points: [
              [0, 0],
              [1, 1],
            ],
            style: 'dashed',
          },
        ],
        xRange: [0, 1],
        yRange: [0, 1],
      },
    });
  const link = r.family === 'logistic' ? '\\operatorname{logit}(\\hat\\pi)' : '\\ln \\hat\\mu';
  const offset = exposures ? '\\ln(\\text{exposure}) + ' : '';
  const outcomeWords = words(r, outcome, level);
  return {
    rows: rows(r),
    tables: tables(r),
    steps: steps(r, level),
    notes,
    pictures,
    equation: `${link} = ${offset}${linearLatex(r.fit.coef, design.columns, INTERCEPT)}`,
    ...(outcomeWords ? { words: outcomeWords } : {}),
  };
}

export const glmSpec: ToolSpec = {
  fields: [
    { id: 'data', type: 'data', first: LOGISTIC, rows: 6 },
    { id: 'family', type: 'choice', options: ['logistic', 'poisson'], first: 'logistic' },
    { id: 'outcome', type: 'column', data: 'data', first: 'passed' },
    { id: 'trials', type: 'column', data: 'data', first: '', optional: true, when: isLogistic },
    { id: 'exposure', type: 'column', data: 'data', first: '', optional: true, when: (v) => !isLogistic(v) },
    { id: 'predictors', type: 'column', data: 'data', first: 'hours', multi: true },
    { id: 'level', type: 'number', first: '0.95', min: 0.5, max: 0.999 },
    { id: 'threshold', type: 'number', first: '0.5', min: 0, max: 1, when: isLogistic },
  ],
  run,
  examples: [
    { id: 'logistic', values: { data: LOGISTIC, family: 'logistic', outcome: 'passed', predictors: 'hours' } },
    {
      id: 'grouped',
      values: { data: GROUPED, family: 'logistic', outcome: 'dead', trials: 'total', predictors: 'dose\ngroup' },
    },
    {
      id: 'poisson',
      values: { data: POISSON, family: 'poisson', outcome: 'cases', exposure: 'exposure', predictors: 'week' },
    },
  ],
};
