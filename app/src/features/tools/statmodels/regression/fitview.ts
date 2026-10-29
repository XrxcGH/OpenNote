// The linear regression tool's main view: the coefficient table, the ANOVA table, fit measures, case diagnostics
// with the 4 standard plots, collinearity, and confidence and prediction intervals for new cases.
import { cellNumber, parseTable, numbersAt, wordsAt, type DataTable } from '../kit/data';
import { buildDesign, designRow, type Design, type DesignOptions } from '../kit/design';
import { fUpper, normalQuantile } from '../kit/dist';
import { linearLatex } from '../kit/format';
import { leastSquares } from '../kit/linalg';
import type { Outcome, Picture, ResultRow, ResultTable, Values } from '../kit/spec';
import { fail, step, type KitStep } from '../kit/types';
import { parseFormula, type Formula } from './formula';
import { diagnostics, fitOls, predictAt, type CaseDiagnostics, type OlsFit, type Robust } from './ols';

export function designOptions(values: Values, formula: Formula, need: readonly string[] = []): DesignOptions {
  return {
    coding: values.coding === 'effect' ? 'effect' : 'reference',
    center: values.center === 'mean',
    intercept: formula.intercept,
    need: [formula.response, ...need],
  };
}

export function readModel(table: DataTable, text: string, values: Values, need: readonly string[] = []) {
  const formula = parseFormula(text, table.names);
  const design = buildDesign(table, formula.terms, designOptions(values, formula, need));
  const y = numbersAt(table, formula.response, design.rows);
  return { formula, design, y };
}

/** Sequential (type I) sums of squares: each term's drop in the residual sum of squares when it is added in order. */
export function anova(design: Design, y: readonly number[], fit: OlsFit): (string | number)[][] {
  const base = design.columns[0] === '(Intercept)' ? [0] : [];
  const rows: (string | number)[][] = [];
  const ybar = y.reduce((a, b) => a + b, 0) / y.length;
  let before = base.length > 0 ? y.reduce((s, v) => s + (v - ybar) ** 2, 0) : y.reduce((s, v) => s + v * v, 0);
  const used = [...base];
  const ms = fit.rss / fit.df;
  for (const term of design.terms) {
    used.push(...term.columns);
    const x = design.x.map((row) => used.map((j) => row[j]));
    const rss = leastSquares(
      x,
      y,
      used.map((j) => design.columns[j]),
    ).rss;
    const ss = before - rss;
    const df = term.columns.length;
    rows.push([term.label, df, ss, ss / df, ss / df / ms, fUpper(ss / df / ms, df, fit.df)]);
    before = rss;
  }
  rows.push(['@residuals', fit.df, fit.rss, ms, NaN, NaN]);
  return rows;
}

/** Reads "x1 = 11, x2 = 10" lines, one new case a line. */
export function parseCases(text: string): Map<string, string>[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .map((line, k) => {
      const values = new Map<string, string>();
      for (const part of line.split(/[,;]/)) {
        const at = part.indexOf('=');
        if (at < 0) fail('caseLine', String(k + 1));
        values.set(part.slice(0, at).trim().replace(/^`|`$/g, ''), part.slice(at + 1).trim());
      }
      return values;
    });
}

function diagnosticPictures(fit: OlsFit, d: CaseDiagnostics): Picture[] {
  const n = fit.n;
  const order = d.standardized.map((_, i) => i).sort((a, b) => d.standardized[a] - d.standardized[b]);
  const qq = order.map((i, k) => [normalQuantile((k + 0.625) / (n + 0.25)), d.standardized[i]] as [number, number]);
  const top = d.cook
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c - a.c)
    .slice(0, 3);
  const pts = (xs: readonly number[], ys: readonly number[]) => xs.map((x, i) => [x, ys[i]] as [number, number]);
  return [
    {
      id: 'residuals',
      type: 'plot',
      plot: {
        x: { label: 'fitted' },
        y: { label: 'residual' },
        series: [{ id: 'cases', points: pts(fit.fitted, fit.resid), style: 'points' }],
        hlines: [0],
        marks: top.map(({ i }) => ({ x: fit.fitted[i], y: fit.resid[i], text: String(i + 1) })),
      },
    },
    {
      id: 'qq',
      type: 'plot',
      plot: {
        x: { label: 'theoretical' },
        y: { label: 'standardized' },
        series: [
          { id: 'cases', points: qq, style: 'points' },
          {
            id: 'reference',
            points: [
              [qq[0][0], qq[0][0]],
              [qq[n - 1][0], qq[n - 1][0]],
            ],
            style: 'dashed',
          },
        ],
        legend: false,
      },
    },
    {
      id: 'scale',
      type: 'plot',
      plot: {
        x: { label: 'fitted' },
        y: { label: 'rootStandardized' },
        series: [
          {
            id: 'cases',
            points: pts(
              fit.fitted,
              d.standardized.map((r) => Math.sqrt(Math.abs(r))),
            ),
            style: 'points',
          },
        ],
      },
    },
    {
      id: 'leverage',
      type: 'plot',
      plot: {
        x: { label: 'leverage' },
        y: { label: 'standardized' },
        series: [{ id: 'cases', points: pts(d.leverage, d.standardized), style: 'points' }],
        hlines: [0],
        marks: top.map(({ i }) => ({ x: d.leverage[i], y: d.standardized[i], text: String(i + 1) })),
      },
    },
  ];
}

/** The fitted line with confidence and prediction bands, when the model has 1 numeric predictor. */
function linePicture(design: Design, y: readonly number[], fit: OlsFit): Picture | null {
  if (design.columns.length !== 2 || design.columns[0] !== '(Intercept)' || design.terms.length !== 1) return null;
  const xs = design.x.map((row) => row[1]);
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const grid = Array.from({ length: 41 }, (_, i) => lo + ((hi - lo) * i) / 40);
  const at = grid.map((x) => ({ x, ...predictAt(fit, [1, x]) }));
  return {
    id: 'line',
    type: 'plot',
    plot: {
      x: { label: 'predictor' },
      y: { label: 'response' },
      series: [
        { id: 'cases', points: xs.map((x, i) => [x, y[i]] as [number, number]), style: 'points' },
        { id: 'fitted', points: at.map((p) => [p.x, p.value] as [number, number]) },
        { id: 'prediction', points: at.map((p) => [p.x, p.predLow] as [number, number]), style: 'dashed', pen: 2 },
        {
          id: 'prediction',
          points: at.map((p) => [p.x, p.predHigh] as [number, number]),
          style: 'dashed',
          pen: 2,
          legend: false,
        },
      ],
      bands: [{ points: at.map((p) => [p.x, p.low, p.high] as [number, number, number]), pen: 1 }],
    },
  };
}

function fitSteps(design: Design, fit: OlsFit, d: CaseDiagnostics, robust: Robust): KitStep[] {
  const out: KitStep[] = [
    step('regression.design', undefined, { columns: design.columns.join(', '), n: fit.n, p: fit.p }),
    step('regression.qr', '\\hat\\beta = \\arg\\min_\\beta \\lVert y - X\\beta \\rVert^2 = R^{-1} Q^\\top y'),
    step('regression.sigma', 's^2 = \\frac{e^\\top e}{n - p} = \\frac{[[rss]]}{[[df]]} = [[s2]]', {
      rss: fit.rss,
      df: fit.df,
      s2: fit.sigma ** 2,
    }),
  ];
  for (let j = 0; j < Math.min(fit.p, 8); j += 1)
    out.push(
      step('regression.coef', 't = \\frac{[[b]]}{[[se]]} = [[t]]', {
        term: fit.names[j],
        b: fit.coef[j],
        se: fit.se[j],
        t: fit.t[j],
        p: fit.pValue[j],
      }),
    );
  if (robust !== 'classical')
    out.push(
      step('regression.robust', '(X^\\top X)^{-1} X^\\top \\hat\\Omega X (X^\\top X)^{-1}', {
        kind: robust === 'cluster' ? 'CR1' : robust.toUpperCase(),
      }),
    );
  if (fit.fDf1 > 0)
    out.push(
      step('regression.f', 'F = \\frac{(\\mathrm{TSS} - \\mathrm{RSS}) / [[df1]]}{\\mathrm{RSS} / [[df2]]} = [[f]]', {
        df1: fit.fDf1,
        df2: fit.df,
        f: fit.f,
        p: fit.fP,
      }),
    );
  out.push(
    step('regression.r2', 'R^2 = 1 - \\frac{\\mathrm{RSS}}{\\mathrm{TSS}} = 1 - \\frac{[[rss]]}{[[tss]]} = [[r2]]', {
      rss: fit.rss,
      tss: fit.tss,
      r2: fit.r2,
    }),
  );
  const flagged = (test: (i: number) => boolean) =>
    fit.resid
      .map((_, i) => i)
      .filter(test)
      .map((i) => String(i + 1))
      .join(', ') || '—';
  out.push(
    step('regression.flags', undefined, {
      cook: flagged((i) => d.cook[i] > 4 / fit.n),
      student: flagged((i) => Math.abs(d.studentized[i]) > 2),
      leverage: flagged((i) => d.leverage[i] > (2 * fit.p) / fit.n),
      cut: 4 / fit.n,
      hcut: (2 * fit.p) / fit.n,
    }),
  );
  return out;
}

function predictions(
  values: Values,
  table: DataTable,
  formula: Formula,
  design: Design,
  fit: OlsFit,
): ResultTable | null {
  const text = String(values.predict ?? '').trim();
  if (text === '') return null;
  const rows = parseCases(text).map((given, k) => {
    for (const name of given.keys()) if (!table.names.includes(name)) fail('noColumn', name);
    const row = designRow(table, design, formula.terms, given, designOptions(values, formula));
    const p = predictAt(fit, row);
    return [`${k + 1}`, p.value, p.low, p.high, p.predLow, p.predHigh];
  });
  return { id: 'predictions', columns: ['case', 'fit', 'low', 'high', 'predLow', 'predHigh'], rows };
}

export function fitOutcome(values: Values): Outcome {
  const table = parseTable(String(values.data));
  const robust = String(values.se) as Robust;
  const clusterName = robust === 'cluster' ? String(values.cluster) : '';
  if (robust === 'cluster' && clusterName === '') fail('pickColumn');
  const { formula, design, y } = readModel(table, String(values.formula), values, clusterName ? [clusterName] : []);
  const level = Number(values.level);
  const cluster = clusterName ? wordsAt(table, clusterName, design.rows) : undefined;
  const fit = fitOls(design.x, y, design.columns, { level, robust, ...(cluster ? { cluster } : {}) });
  const classical = robust === 'classical' ? fit : fitOls(design.x, y, design.columns, { level });
  const d = diagnostics(design.x, classical);
  const maxCook = d.cook.reduce((best, c, i) => (c > d.cook[best] ? i : best), 0);
  const rows: ResultRow[] = [
    { id: 'r2', value: fit.r2, answer: true, sym: 'R^2' },
    { id: 'adjR2', value: fit.adjR2, sym: '\\bar R^2' },
    { id: 'f', value: fit.f, sym: 'F' },
    { id: 'fDf1', value: fit.fDf1 },
    { id: 'df', value: fit.df },
    { id: 'fP', value: fit.fP, sym: 'p' },
    { id: 'sigma', value: fit.sigma, sym: 's' },
    { id: 'n', value: fit.n },
    { id: 'aic', value: fit.aic },
    { id: 'bic', value: fit.bic },
    { id: 'dw', value: d.durbinWatson },
    { id: 'bp', value: d.breuschPagan },
    { id: 'bpP', value: d.bpP },
    { id: 'maxCook', value: d.cook[maxCook] },
    { id: 'maxCookCase', value: maxCook + 1 },
  ];
  const tables: ResultTable[] = [
    {
      id: 'coef',
      columns: ['term', 'estimate', 'se', 't', 'p', 'low', 'high', 'beta'],
      rows: fit.names.map((name, j) => [
        name,
        fit.coef[j],
        fit.se[j],
        fit.t[j],
        fit.pValue[j],
        fit.low[j],
        fit.high[j],
        fit.beta[j],
      ]),
    },
    { id: 'anova', columns: ['term', 'df', 'ss', 'ms', 'f', 'p'], rows: anova(design, y, classical) },
    {
      id: 'vif',
      columns: ['term', 'vif'],
      rows: fit.names.slice(fit.intercept ? 1 : 0).map((name) => [name, d.vif[fit.names.indexOf(name)]]),
    },
    {
      id: 'cases',
      columns: ['case', 'fit', 'residual', 'leverage', 'studentized', 'cook'],
      rows: fit.resid.map((e, i) => [
        `${design.rows[i] + 1}`,
        fit.fitted[i],
        e,
        d.leverage[i],
        d.studentized[i],
        d.cook[i],
      ]),
    },
  ];
  const predicted = predictions(values, table, formula, design, classical);
  if (predicted) tables.push(predicted);
  const line = linePicture(design, y, classical);
  const notes = ['linear', 'independent', 'constantVariance', 'normal'];
  if (robust !== 'classical') notes.push('robust');
  if (d.vif.some((v) => v > 10)) notes.push('collinearity');
  if (values.center === 'mean') notes.push('centered');
  return {
    rows,
    tables,
    steps: fitSteps(design, fit, d, robust),
    notes,
    pictures: [...(line ? [line] : []), ...diagnosticPictures(classical, d)],
    equation: `\\hat{y} = ${linearLatex(fit.coef, fit.names)}`,
    words: step('regression.words', undefined, {
      r2: Number((fit.r2 * 100).toPrecision(4)),
      response: formula.response,
      df1: fit.fDf1,
      df2: fit.df,
      f: fit.f,
      p: fit.fP,
    }),
  };
}

export const isNumberText = (text: string): boolean => {
  const v = cellNumber(text);
  return v !== null && !Number.isNaN(v);
};
