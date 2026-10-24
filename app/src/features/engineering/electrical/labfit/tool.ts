// The lab data fitting tool: a table of x, y and optional uncertainty, a model, and the fitted parameters with their
// uncertainties, chi-square, and plots of the fit and the residuals.
import type { Field, ToolSpec } from '../spec';
import { compileExpression, namesIn, readExpression } from './expression';
import { fail, fmt, need, ok, readNumber } from '../shared';
import type { KitOk, KitRow, KitStep, NoteKey, Plot, Values } from '../shared';
import {
  chiSquareP,
  levenbergMarquardt,
  linearFit,
  lineSums,
  parseData,
  polynomialBasis,
  predict,
  propagateParameters,
  rSquared,
} from './engine';
import type { Data, Fit, Model } from './engine';

const MODELS = ['line', 'poly', 'exponential', 'powerlaw', 'expLinear', 'powerLinear', 'custom'] as const;
const modelOf = (v: Values): string => v.model ?? 'line';
const is =
  (...models: string[]) =>
  (v: Values): boolean =>
    models.includes(modelOf(v));

const DATA = `# x, y, and the uncertainty in y (sigma)
1 2.9 0.1
2 5.1 0.1
3 7.0 0.2
4 9.2 0.2
5 10.9 0.3`;

const FIELDS: readonly Field[] = [
  {
    id: 'model',
    label: 'fitModel',
    initial: 'line',
    kind: 'select',
    options: MODELS.map((value) => ({ value, label: value as Field['label'] })),
  },
  { id: 'degree', label: 'degree', initial: '2', when: is('poly') },
  { id: 'expression', label: 'expressionText', initial: 'a*exp(-x/b)+c', hint: 'expressionHint', when: is('custom') },
  { id: 'start', label: 'startValues', initial: '1, 1, 0', hint: 'startHint', when: is('custom') },
  { id: 'data', label: 'dataText', initial: DATA, kind: 'area', hint: 'dataHint' },
  { id: 'xUnit', label: 'xUnit', initial: '', hint: 'unitHint' },
  { id: 'yUnit', label: 'yUnit', initial: '' },
  { id: 'xnew', label: 'predictAt', initial: '', hint: 'blankHint' },
  { id: 'derived', label: 'derivedQuantity', initial: '', hint: 'derivedHint' },
];

const plusMinus = (v: number, u: number, unit = ''): string => `${fmt(v, 5)} ± ${fmt(u, 3)}${unit ? ` ${unit}` : ''}`;
const listParams = (labels: string[], p: number[], cov: number[][]): string =>
  p.map((v, k) => `${labels[k]} = ${plusMinus(v, Math.sqrt(cov[k]![k]!))}`).join(', ');
const ascii = (v: number): string => fmt(v, 6).replace('−', '-');

/** A unit written as x^k, such as "s^2" or "1/s". */
function power(unit: string, k: number): string {
  if (unit === '') return '';
  if (k === 0) return '';
  if (k === 1) return unit;
  if (k === -1) return `1/${unit}`;
  return k > 0 ? `${unit}^${k}` : `1/${unit}^${-k}`;
}

function unitOfCoefficient(k: number, xu: string, yu: string): string {
  if (yu === '' && xu === '') return '';
  const top = yu;
  const bottom = power(xu, k);
  if (bottom === '') return top;
  if (top === '') return bottom.startsWith('1/') ? bottom : `1/${bottom}`;
  return bottom.startsWith('1/') ? `${top}${bottom.slice(1)}` : `${top}/${bottom}`;
}

const names = (count: number): string[] => Array.from({ length: count }, (_, k) => String.fromCharCode(97 + k));

function statistics(fit: Fit, data: Data, extraNotes: NoteKey[]): { rows: KitRow[]; notes: NoteKey[] } {
  const rows: KitRow[] = [
    { key: 'chiSquare', value: fmt(fit.chi2, 5) },
    { key: 'dof', value: String(fit.dof) },
  ];
  const notes: NoteKey[] = [...extraNotes];
  if (fit.scaled) {
    rows.push({ key: 'scatterRow', value: fmt(Math.sqrt(fit.chi2 / Math.max(1, fit.dof)), 4) });
    notes.push('scaledNote');
  } else if (fit.dof > 0) {
    rows.push(
      { key: 'reducedChi', value: fmt(fit.chi2 / fit.dof, 5) },
      { key: 'pValue', value: fmt(chiSquareP(fit.chi2, fit.dof), 4) },
    );
    notes.push('chiNote');
  }
  rows.push({ key: 'rSquared', value: fmt(rSquared(data.y, fit.fitted), 6) });
  return { rows, notes };
}

function plots(data: Data, model: Model, p: number[], residuals: number[], xLabel: string, yLabel: string) {
  const lo = Math.min(...data.x);
  const hi = Math.max(...data.x);
  const pad = (hi - lo) * 0.05 || 1;
  const xs = Array.from({ length: 101 }, (_, i) => lo - pad + ((hi - lo + 2 * pad) * i) / 100);
  const ys = xs.map((x) => model(x, p));
  const main: Plot = {
    xLabel,
    yLabel,
    series: [
      { name: 'fit', x: xs, y: ys },
      { name: 'data', x: data.x, y: data.y, dots: true, err: data.sigma ?? undefined },
    ],
  };
  const residual: Plot = {
    xLabel,
    yLabel: `${yLabel} residual`,
    series: [
      { name: 'zero', x: [lo - pad, hi + pad], y: [0, 0] },
      { name: 'residual', x: data.x, y: residuals, dots: true, err: data.sigma ?? undefined },
    ],
  };
  return { main, residual };
}

function finish(args: {
  rows: KitRow[];
  steps: KitStep[];
  answer: string;
  latex: string;
  data: Data;
  fit: Fit;
  model: Model;
  p: number[];
  cov: number[][];
  values: Values;
  notes: NoteKey[];
  labels?: string[];
}): KitOk {
  const { data, fit, model, p, cov, values } = args;
  const stats = statistics(fit, data, args.notes);
  const rows = [...args.rows];
  for (let i = 0; i < p.length; i++) {
    for (let j = i + 1; j < p.length; j++) {
      const corr = cov[i]![j]! / Math.sqrt(cov[i]![i]! * cov[j]![j]!);
      rows.push({
        key: 'covarianceRow',
        vars: { a: names(p.length)[i]!, b: names(p.length)[j]! },
        value: `${fmt(cov[i]![j]!, 4)} (correlation ${Number.isFinite(corr) ? fmt(corr, 3) : '—'})`,
      });
    }
  }
  rows.push(...stats.rows);
  const text = (values.xnew ?? '').trim();
  if (text !== '') {
    const x0 = readNumber(text);
    if (x0 === null) fail('number', { field: 'predictAt' });
    const pr = predict(model, p, cov, x0!);
    const yUnit = (values.yUnit ?? '').trim();
    rows.push({ key: 'prediction', vars: { x: fmt(x0!) }, value: plusMinus(pr.y, pr.u, yUnit) });
  }
  const derivedText = (values.derived ?? '').trim();
  if (derivedText !== '') {
    const tree = readExpression(derivedText);
    if (!tree) fail('fitExpression', { text: derivedText });
    const labels = args.labels ?? names(p.length);
    const used = [...namesIn(tree!)];
    const unknown = used.find((n) => !labels.includes(n));
    if (unknown !== undefined) fail('fitDerivedName', { name: unknown, names: labels.join(', ') });
    const run = compileExpression(tree!, labels);
    const out = propagateParameters((q) => run(q), p, cov);
    if (!Number.isFinite(out.y)) fail('fitDerivedValue', { text: derivedText });
    rows.push({ key: 'derivedRow', vars: { text: derivedText }, value: plusMinus(out.y, out.u, '') });
  }
  const { main, residual } = plots(
    data,
    model,
    p,
    fit.residuals,
    (values.xUnit ?? '').trim() ? `x (${values.xUnit!.trim()})` : 'x',
    (values.yUnit ?? '').trim() ? `y (${values.yUnit!.trim()})` : 'y',
  );
  return ok({
    rows,
    steps: args.steps,
    answer: args.answer,
    latex: args.latex,
    plot: main,
    plot2: residual,
    notes: stats.notes,
  });
}

const parameterRows = (p: number[], cov: number[][], units: string[]): KitRow[] =>
  p.map((v, k): KitRow => ({
    key: 'parameter',
    vars: { name: names(p.length)[k]! },
    value: plusMinus(v, Math.sqrt(cov[k]![k]!), units[k] ?? ''),
  }));

function lineModel(data: Data, values: Values): KitOk {
  const xu = (values.xUnit ?? '').trim();
  const yu = (values.yUnit ?? '').trim();
  const fit = linearFit((x) => [1, x], data);
  const sums = lineSums(data);
  const p = fit.coef;
  const weighted = data.sigma !== null;
  const sumsMath = [
    `S = ${ascii(sums.s)}`,
    `S_x = ${ascii(sums.sx)}`,
    `S_y = ${ascii(sums.sy)}`,
    `S_{xx} = ${ascii(sums.sxx)}`,
    `S_{xy} = ${ascii(sums.sxy)}`,
  ].join(',\\ ');
  const steps: KitStep[] = [
    {
      key: 'fitSums',
      vars: { weights: weighted ? 'w = 1/σ²' : 'w = 1' },
      math: sumsMath,
    },
    { key: 'fitDelta', vars: { value: ascii(sums.delta) }, math: '\\Delta = S\\,S_{xx} - S_x^2' },
    {
      key: 'fitSlopeIntercept',
      math: 'a = \\frac{S_{xx}S_y - S_xS_{xy}}{\\Delta},\\quad b = \\frac{S\\,S_{xy} - S_xS_y}{\\Delta}',
    },
    { key: 'fitLineUncertainty', math: 'u_a = \\sqrt{S_{xx}/\\Delta},\\quad u_b = \\sqrt{S/\\Delta}' },
    {
      key: 'fitLineResult',
      vars: { a: plusMinus(p[0]!, Math.sqrt(fit.cov[0]![0]!)), b: plusMinus(p[1]!, Math.sqrt(fit.cov[1]![1]!)) },
    },
  ];
  if (fit.scaled) steps.push({ key: 'fitScaleStep', math: 'u \\to u\\sqrt{\\chi^2/(N - 2)}' });
  steps.push({
    key: 'fitChiStep',
    vars: { value: fmt(fit.chi2, 5) },
    math: '\\chi^2 = \\sum_i \\left(\\frac{y_i - a - bx_i}{\\sigma_i}\\right)^2',
  });
  return finish({
    rows: [
      { key: 'modelRow', value: 'y = a + b x' },
      ...parameterRows(p, fit.cov, [unitOfCoefficient(0, xu, yu), unitOfCoefficient(1, xu, yu)]),
    ],
    steps,
    answer: `y = a + b x with ${listParams(['a', 'b'], p, fit.cov)}`,
    latex: `y = ${ascii(p[0]!)} + ${ascii(p[1]!)}\\,x`,
    data,
    fit,
    model: (x, q) => q[0]! + q[1]! * x,
    p,
    cov: fit.cov,
    values,
    notes: ['lineNote'],
  });
}

function polynomial(data: Data, values: Values): KitOk {
  const degree = need(values, 'degree', 'degree');
  if (!Number.isInteger(degree) || degree < 1 || degree > 8) fail('fitDegree');
  const xu = (values.xUnit ?? '').trim();
  const yu = (values.yUnit ?? '').trim();
  const fit = linearFit(polynomialBasis(degree), data);
  const p = fit.coef;
  const model: Model = (x, q) => q.reduce((s, c, k) => s + c * x ** k, 0);
  return finish({
    rows: [
      {
        key: 'modelRow',
        value: `y = ${names(degree + 1)
          .map((n, k) => (k === 0 ? n : k === 1 ? `${n} x` : `${n} x^${k}`))
          .join(' + ')}`,
      },
      ...parameterRows(
        p,
        fit.cov,
        p.map((_, k) => unitOfCoefficient(k, xu, yu)),
      ),
    ],
    steps: [
      {
        key: 'fitDesign',
        vars: { degree: String(degree) },
        math: 'A_{ij} = x_i^{\\,j}/\\sigma_i,\\quad b_i = y_i/\\sigma_i',
      },
      { key: 'fitQr', math: 'A = QR,\\quad Rc = Q^Tb,\\quad C = (R^TR)^{-1}' },
      {
        key: 'fitChiStep',
        vars: { value: fmt(fit.chi2, 5) },
        math: '\\chi^2 = \\sum_i \\left(\\frac{y_i - f(x_i)}{\\sigma_i}\\right)^2',
      },
    ],
    answer: `Polynomial of degree ${degree}: ${listParams(names(degree + 1), p, fit.cov)}`,
    latex: `y = ${p.map((v, k) => `${ascii(v)}x^{${k}}`).join(' + ')}`,
    data,
    fit,
    model,
    p,
    cov: fit.cov,
    values,
    notes: ['polyNote'],
  });
}

/** Takes the natural log of y (and x for a power law); refuses data that cannot be. */
function logData(data: Data, both: boolean): Data {
  if (data.y.some((v) => v <= 0)) fail('fitLogDomain', { what: 'y' });
  if (both && data.x.some((v) => v <= 0)) fail('fitLogDomain', { what: 'x' });
  return {
    x: both ? data.x.map(Math.log) : data.x,
    y: data.y.map(Math.log),
    sigma: data.sigma ? data.sigma.map((s, i) => s / data.y[i]!) : null,
  };
}

function expOrPower(data: Data, values: Values, kind: 'exponential' | 'power', linear: boolean): KitOk {
  const power = kind === 'power';
  const form = power ? 'y = a x^b' : 'y = a e^(b x)';
  const logged = logData(data, power);
  const lin = linearFit((x) => [1, x], logged);
  const xu = (values.xUnit ?? '').trim();
  const yu = (values.yUnit ?? '').trim();
  const model: Model = power ? (x, q) => q[0]! * x ** q[1]! : (x, q) => q[0]! * Math.exp(q[1]! * x);
  let p: number[];
  let cov: number[][];
  let fit: Fit;
  const a0 = Math.exp(lin.coef[0]!);
  const notes: NoteKey[] = [power ? 'powerNote' : 'expNote'];
  const steps: KitStep[] = [];
  if (linear) {
    p = [a0, lin.coef[1]!];
    cov = [
      [a0 * a0 * lin.cov[0]![0]!, a0 * lin.cov[0]![1]!],
      [a0 * lin.cov[1]![0]!, lin.cov[1]![1]!],
    ];
    const fitted = data.x.map((x) => model(x, p));
    // Chi-square in y space, the same formula as the other fits, not the log-space value of the straight-line fit.
    const chi2 = data.y.reduce((sum, v, i) => sum + ((v - fitted[i]!) / (data.sigma ? data.sigma[i]! : 1)) ** 2, 0);
    fit = {
      coef: p,
      cov,
      chi2,
      dof: lin.dof,
      scaled: lin.scaled,
      fitted,
      residuals: data.y.map((v, i) => v - fitted[i]!),
    };
    steps.push(
      {
        key: power ? 'fitLogLog' : 'fitSemiLog',
        math: power ? '\\ln y = \\ln a + b\\ln x' : '\\ln y = \\ln a + b\\,x',
      },
      { key: 'fitLogSigma', math: '\\sigma_{\\ln y} = \\sigma_y / y' },
      { key: 'fitBack', math: 'a = e^{c_0},\\quad u_a = a\\,u_{c_0}' },
    );
    notes.push('linearizedNote');
  } else {
    const nl = levenbergMarquardt(model, data, [a0, lin.coef[1]!]);
    p = nl.coef;
    cov = nl.cov;
    fit = nl;
    steps.push(
      { key: 'fitStart', vars: { a: fmt(a0, 5), b: fmt(lin.coef[1]!, 5) } },
      {
        key: 'fitLm',
        vars: { n: String(nl.iterations) },
        math: '(J^TWJ + \\lambda\\,\\mathrm{diag})\\,\\delta = J^TW(y - f)',
      },
      { key: 'fitCovStep', math: 'C = (J^TWJ)^{-1}' },
    );
  }
  steps.push({
    key: 'fitChiStep',
    vars: { value: fmt(fit.chi2, 5) },
    math: '\\chi^2 = \\sum_i \\left(\\frac{y_i - f(x_i)}{\\sigma_i}\\right)^2',
  });
  return finish({
    rows: [
      { key: 'modelRow', value: form },
      ...parameterRows(p, cov, [power ? (xu === '' ? yu : `${yu}/${xu}^b`) : yu, power || xu === '' ? '' : `1/${xu}`]),
    ],
    steps,
    answer: `${form} with ${listParams(['a', 'b'], p, cov)}`,
    latex: power ? `y = ${ascii(p[0]!)}\\,x^{${ascii(p[1]!)}}` : `y = ${ascii(p[0]!)}\\,e^{${ascii(p[1]!)}x}`,
    data,
    fit,
    model,
    p,
    cov,
    values,
    notes,
  });
}

function custom(data: Data, values: Values): KitOk {
  const source = (values.expression ?? '').trim();
  const tree = readExpression(source);
  if (!tree) return fail('fitExpression', { text: source });
  const params = [...namesIn(tree)].filter((n) => n !== 'x');
  if (params.length === 0) fail('fitNoParameters');
  if (params.length > 6) fail('fitManyParameters');
  const run = compileExpression(tree, ['x', ...params]);
  const startText = (values.start ?? '').split(/[\s,;]+/).filter((w) => w !== '');
  const start = params.map((_, k) => {
    if (startText[k] === undefined) return 1;
    const v = readNumber(startText[k]!);
    return v === null ? fail('fitStartNumber', { text: startText[k]! }) : v;
  });
  const model: Model = (x, q) => run([x, ...q]);
  const nl = levenbergMarquardt(model, data, start);
  const labels = params;
  return finish({
    rows: [
      { key: 'modelRow', value: `y = ${source}` },
      ...nl.coef.map((v, k): KitRow => ({
        key: 'parameter',
        vars: { name: labels[k]! },
        value: plusMinus(v, Math.sqrt(nl.cov[k]![k]!)),
      })),
    ],
    steps: [
      { key: 'fitStart', vars: { a: start.map((s) => fmt(s, 4)).join(', '), b: params.join(', ') } },
      {
        key: 'fitLm',
        vars: { n: String(nl.iterations) },
        math: '(J^TWJ + \\lambda\\,\\mathrm{diag})\\,\\delta = J^TW(y - f)',
      },
      { key: 'fitCovStep', math: 'C = (J^TWJ)^{-1}' },
      {
        key: 'fitChiStep',
        vars: { value: fmt(nl.chi2, 5) },
        math: '\\chi^2 = \\sum_i \\left(\\frac{y_i - f(x_i)}{\\sigma_i}\\right)^2',
      },
    ],
    answer: `y = ${source}: ${listParams(labels, nl.coef, nl.cov)}`,
    latex: `\\chi^2 = ${ascii(nl.chi2)}`,
    data,
    fit: nl,
    model,
    p: nl.coef,
    cov: nl.cov,
    values,
    labels,
    notes: ['customNote'],
  });
}

export const spec: ToolSpec = {
  id: 'labfit',
  fields: FIELDS,
  run: (values) => {
    const data = parseData(values.data ?? '');
    switch (modelOf(values)) {
      case 'poly':
        return polynomial(data, values);
      case 'exponential':
        return expOrPower(data, values, 'exponential', false);
      case 'expLinear':
        return expOrPower(data, values, 'exponential', true);
      case 'powerlaw':
        return expOrPower(data, values, 'power', false);
      case 'powerLinear':
        return expOrPower(data, values, 'power', true);
      case 'custom':
        return custom(data, values);
      default:
        return lineModel(data, values);
    }
  },
};
