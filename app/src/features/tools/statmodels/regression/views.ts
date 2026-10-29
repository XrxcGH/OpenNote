// The linear regression tool's other views: comparing nested models, moderation with simple slopes and the
// Johnson-Neyman values, mediation with the Sobel test and a bootstrap interval, and the random-intercept model.
import { completeRows, numbersAt, parseNumbers, parseTable, wordsAt } from '../kit/data';
import { buildDesign } from '../kit/design';
import { linearLatex, percent } from '../kit/format';
import { mean, variance } from '../kit/linalg';
import { line, svg, text, W, type DrawContext } from '../kit/picture';
import { columnList, type Outcome, type Values } from '../kit/spec';
import { fail, step } from '../kit/types';
import { designOptions, readModel } from './fitview';
import { parseFormula } from './formula';
import { fitMixed } from './mixed';
import { fitOls, nestedF } from './ols';
import { mediation, moderation } from './paths';

export function compareOutcome(values: Values): Outcome {
  const table = parseTable(String(values.data));
  const fullFormula = parseFormula(String(values.formula), table.names);
  const reducedFormula = parseFormula(String(values.reduced), table.names);
  if (fullFormula.response !== reducedFormula.response) fail('sameResponse');
  const need = [...new Set([...fullFormula.terms, ...reducedFormula.terms].flatMap((t) => t.factors.map((f) => f.name)))];
  const full = readModel(table, String(values.formula), values, need);
  const reduced = readModel(table, String(values.reduced), values, need);
  const fullFit = fitOls(full.design.x, full.y, full.design.columns);
  const reducedFit = fitOls(reduced.design.x, reduced.y, reduced.design.columns);
  const test = nestedF(fullFit, reducedFit);
  const models = [
    ['@full', fullFit.p, fullFit.rss, fullFit.r2, fullFit.adjR2, fullFit.aic, fullFit.bic],
    ['@reduced', reducedFit.p, reducedFit.rss, reducedFit.r2, reducedFit.adjR2, reducedFit.aic, reducedFit.bic],
  ];
  return {
    rows: [
      { id: 'compareF', value: test.f, answer: true, sym: 'F' },
      { id: 'compareDf1', value: test.df1 },
      { id: 'compareDf2', value: test.df2 },
      { id: 'compareP', value: test.p, answer: true, sym: 'p' },
      { id: 'deltaAic', value: fullFit.aic - reducedFit.aic },
      { id: 'deltaBic', value: fullFit.bic - reducedFit.bic },
    ],
    tables: [{ id: 'models', columns: ['model', 'params', 'rss', 'r2', 'adjR2', 'aic', 'bic'], rows: models }],
    steps: [
      step(
        'regression.nested',
        'F = \\frac{(\\mathrm{RSS}_r - \\mathrm{RSS}_f) / [[df1]]}{\\mathrm{RSS}_f / [[df2]]} = \\frac{([[rssR]] - [[rssF]]) / [[df1]]}{[[rssF]] / [[df2]]} = [[f]]',
        { rssR: reducedFit.rss, rssF: fullFit.rss, df1: test.df1, df2: test.df2, f: test.f, p: test.p },
      ),
      step('regression.ic', '\\mathrm{AIC} = -2\\ell + 2k,\\quad \\mathrm{BIC} = -2\\ell + k \\ln n'),
    ],
    notes: ['nested', 'sameRows'],
    words: step('regression.wordsCompare', undefined, { df1: test.df1, df2: test.df2, f: test.f, p: test.p }),
  };
}

function probeValues(text: string, m: readonly number[]): number[] {
  if (text.trim() !== '') return parseNumbers(text, 'probe');
  const mu = mean(m);
  const sd = Math.sqrt(variance(m));
  return [mu - sd, mu, mu + sd];
}

export function moderationOutcome(values: Values): Outcome {
  const table = parseTable(String(values.data));
  const [yName, xName, mName] = [String(values.outcome), String(values.x), String(values.moderator)];
  if (new Set([yName, xName, mName]).size < 3) fail('sameColumn');
  const covs = columnList(values.covariates).filter((c) => ![yName, xName, mName].includes(c));
  const rows = completeRows(table, [yName, xName, mName, ...covs]);
  const center = values.center === 'mean';
  const raw = (name: string) => numbersAt(table, name, rows);
  const centered = (v: number[]) => (center ? v.map((x) => x - mean(v)) : v);
  const y = raw(yName);
  const x = centered(raw(xName));
  const m = centered(raw(mName));
  const level = Number(values.level);
  const result = moderation(y, x, m, covs.map(raw), covs, probeValues(String(values.probe), m), level);
  const f = result.fit;
  const names = [xName, mName, `${xName}:${mName}`, ...covs];
  const jn = result.jn.filter((v) => v >= Math.min(...m) && v <= Math.max(...m));
  const span = [Math.min(...m), Math.max(...m)];
  const grid = Array.from({ length: 41 }, (_, i) => span[0] + ((span[1] - span[0]) * i) / 40);
  const slopeAt = (at: number) => {
    const slope = f.coef[1] + f.coef[3] * at;
    const se = Math.sqrt(f.cov[1][1] + 2 * at * f.cov[1][3] + at * at * f.cov[3][3]);
    return [at, slope - f.tCrit * se, slope + f.tCrit * se] as [number, number, number];
  };
  return {
    rows: [
      { id: 'interaction', value: f.coef[3], answer: true, sym: 'b_{xm}' },
      { id: 'interactionP', value: f.pValue[3], answer: true, sym: 'p' },
      { id: 'r2', value: f.r2 },
      { id: 'jnLow', value: result.jn[0] ?? NaN },
      { id: 'jnHigh', value: result.jn[1] ?? NaN },
      { id: 'n', value: f.n },
    ],
    tables: [
      {
        id: 'coef',
        columns: ['term', 'estimate', 'se', 't', 'p', 'low', 'high'],
        rows: f.names.map((_, j) => [j === 0 ? '(Intercept)' : names[j - 1], f.coef[j], f.se[j], f.t[j], f.pValue[j], f.low[j], f.high[j]]),
      },
      {
        id: 'slopes',
        columns: ['at', 'slope', 'se', 't', 'p', 'low', 'high'],
        rows: result.slopes.map((s) => [s.at, s.slope, s.se, s.t, s.p, s.low, s.high]),
      },
    ],
    pictures: [
      {
        id: 'jn',
        type: 'plot',
        plot: {
          x: { label: 'moderator' },
          y: { label: 'slope' },
          series: [{ id: 'slope', points: grid.map((at) => [at, f.coef[1] + f.coef[3] * at] as [number, number]) }],
          bands: [{ points: grid.map(slopeAt), pen: 0 }],
          hlines: [0],
          vlines: jn,
        },
      },
    ],
    steps: [
      step('regression.moderationModel', '\\hat y = b_0 + b_1 x + b_2 m + b_3 x m'),
      step('regression.simpleSlope', '\\frac{\\partial \\hat y}{\\partial x} = b_1 + b_3 m,\\quad \\operatorname{SE}^2 = V_{11} + 2 m V_{13} + m^2 V_{33}'),
      step('regression.jn', '(b_1 + b_3 m)^2 = t_{crit}^2 (V_{11} + 2 m V_{13} + m^2 V_{33})', {
        lo: result.jn[0] ?? NaN,
        hi: result.jn[1] ?? NaN,
      }),
      step(result.jnInside ? 'regression.jnInside' : 'regression.jnOutside'),
    ],
    notes: center ? ['centeredModeration', 'linear'] : ['linear'],
    words: step('regression.wordsModeration', undefined, {
      x: xName,
      m: mName,
      b: f.coef[3],
      t: f.t[3],
      df: f.df,
      p: f.pValue[3],
    }),
  };
}

function pathDiagram(r: { a: number; b: number; cPrime: number }, names: { x: string; m: string; y: string }) {
  return (ctx: DrawContext): string => {
    const p = ctx.palette;
    const box = (cx: number, cy: number, label: string) =>
      `<rect x="${cx - 60}" y="${cy - 18}" width="120" height="36" rx="6" fill="${p.surface}" stroke="${p.text}"/>` +
      text(cx, cy + 4, label, p.text, 'middle', 13);
    const arrow = (x1: number, y1: number, x2: number, y2: number) =>
      line(x1, y1, x2, y2, p.text, false, 1.5) +
      `<circle cx="${x2.toFixed(1)}" cy="${y2.toFixed(1)}" r="3" fill="${p.text}"/>`;
    const fmt = (v: number) => (Math.abs(v) >= 100 || Math.abs(v) < 0.001 ? v.toExponential(2) : v.toPrecision(3));
    const parts = [
      `<rect width="${W}" height="200" fill="${p.surface}"/>`,
      box(80, 150, names.x),
      box(W / 2, 40, names.m),
      box(W - 80, 150, names.y),
      arrow(110, 132, W / 2 - 40, 58),
      arrow(W / 2 + 40, 58, W - 110, 132),
      arrow(140, 150, W - 140, 150),
      text(W / 2 - 100, 88, `a = ${fmt(r.a)}`, p.text, 'middle'),
      text(W / 2 + 100, 88, `b = ${fmt(r.b)}`, p.text, 'middle'),
      text(W / 2, 170, `c′ = ${fmt(r.cPrime)}`, p.text, 'middle'),
    ];
    return svg(parts, p, W, 200);
  };
}

export function mediationOutcome(values: Values): Outcome {
  const table = parseTable(String(values.data));
  const [xName, mName, yName] = [String(values.x), String(values.mediator), String(values.outcome)];
  if (new Set([yName, xName, mName]).size < 3) fail('sameColumn');
  const covs = columnList(values.covariates).filter((c) => ![yName, xName, mName].includes(c));
  const rows = completeRows(table, [xName, mName, yName, ...covs]);
  const at = (name: string) => numbersAt(table, name, rows);
  const level = Number(values.level);
  const r = mediation(at(xName), at(mName), at(yName), covs.map(at), Number(values.resamples), Number(values.seed), level);
  const path = (name: string, fit: { coef: readonly number[]; se: readonly number[]; t: readonly number[]; pValue: readonly number[] }, j: number) =>
    [name, fit.coef[j], fit.se[j], fit.t[j], fit.pValue[j]];
  return {
    rows: [
      { id: 'indirect', value: r.indirect, answer: true, sym: 'ab' },
      { id: 'bootLow', value: r.bootLow },
      { id: 'bootHigh', value: r.bootHigh },
      { id: 'sobelZ', value: r.sobelZ, sym: 'z' },
      { id: 'sobelP', value: r.sobelP },
      { id: 'total', value: r.c, sym: 'c' },
      { id: 'direct', value: r.cPrime, sym: "c'" },
      { id: 'proportion', value: r.c === 0 ? NaN : r.indirect / r.c },
      { id: 'resamples', value: r.resamples },
    ],
    tables: [
      {
        id: 'paths',
        columns: ['path', 'estimate', 'se', 't', 'p'],
        rows: [path('a', r.paths.a, 1), path('b', r.paths.b, 2), path('c', r.paths.c, 1), path("c'", r.paths.b, 1)],
      },
    ],
    pictures: [{ id: 'paths', type: 'draw', draw: pathDiagram(r, { x: xName, m: mName, y: yName }) }],
    steps: [
      step('regression.paths', 'm = i_1 + a x,\\quad y = i_2 + c\' x + b m,\\quad y = i_3 + c x'),
      step('regression.sobel', 'z = \\frac{ab}{\\sqrt{b^2 s_a^2 + a^2 s_b^2}} = \\frac{[[ab]]}{[[se]]} = [[z]]', {
        ab: r.indirect,
        se: r.sobelSe,
        z: r.sobelZ,
      }),
      step('regression.bootstrap', undefined, {
        resamples: r.resamples,
        seed: Number(values.seed),
        level: percent(level),
        lo: r.bootLow,
        hi: r.bootHigh,
      }),
    ],
    notes: ['causalOrder', 'bootstrapSeed'],
    words: step('regression.wordsMediation', undefined, {
      ab: r.indirect,
      level: percent(level),
      lo: r.bootLow,
      hi: r.bootHigh,
      z: r.sobelZ,
      p: r.sobelP,
    }),
  };
}

export function mixedOutcome(values: Values): Outcome {
  const table = parseTable(String(values.data));
  const groupName = String(values.group);
  const formula = parseFormula(String(values.formula), table.names);
  const design = buildDesign(table, formula.terms, designOptions(values, formula, [groupName]));
  const y = numbersAt(table, formula.response, design.rows);
  const group = wordsAt(table, groupName, design.rows);
  const level = Number(values.level);
  const fit = fitMixed(design.x, y, group, level);
  return {
    rows: [
      { id: 'icc', value: fit.icc, answer: true, sym: '\\rho' },
      { id: 'tau2', value: fit.tau2, sym: '\\sigma^2_u' },
      { id: 'sigma2', value: fit.sigma2, sym: '\\sigma^2_e' },
      { id: 'groups', value: fit.groups },
      { id: 'n', value: y.length },
      { id: 'reml', value: fit.reml },
    ],
    tables: [
      {
        id: 'coef',
        columns: ['term', 'estimate', 'se', 't', 'p', 'low', 'high'],
        rows: design.columns.map((name, j) => [name, fit.coef[j], fit.se[j], fit.t[j], fit.p[j], fit.low[j], fit.high[j]]),
      },
    ],
    steps: [
      step('regression.mixedModel', 'y_{ij} = x_{ij}^\\top \\beta + u_j + e_{ij},\\quad u_j \\sim N(0, \\sigma^2_u),\\ e_{ij} \\sim N(0, \\sigma^2_e)'),
      step('regression.reml', '\\ell_R(\\lambda) = -\\tfrac12\\left[(n-p)\\ln \\hat\\sigma^2_e + \\ln|H| + \\ln|X^\\top H^{-1} X|\\right]', {
        lambda: fit.lambda,
      }),
      step('regression.icc', '\\rho = \\frac{\\sigma^2_u}{\\sigma^2_u + \\sigma^2_e} = \\frac{[[tau2]]}{[[tau2]] + [[sigma2]]} = [[icc]]', {
        tau2: fit.tau2,
        sigma2: fit.sigma2,
        icc: fit.icc,
      }),
    ],
    notes: ['mixedDf', 'linear'],
    equation: `\\hat{y} = ${linearLatex(fit.coef, design.columns)} + \\hat u_j`,
    words: step('regression.wordsMixed', undefined, { icc: fit.icc, group: groupName, groups: fit.groups }),
  };
}
