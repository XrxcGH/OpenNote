// 4PL and 5PL standard curves with back-calculated unknowns, log-logistic dose response, and Schild analysis.
import { LsError, nonNegative, positive } from '../num/errors';
import { levenberg, lineFit, type Model } from '../num/fit';
import { tQuantile } from '../num/special';
import type { CalcResult, ResultRow, Step } from '../types';
import { type Point, type Rows, logSpace, median, columns, weightsFrom } from './shared';

// ---- 4PL and 5PL standard curves -------------------------------------------------------------------------------

/** y = d + (a − d) / (1 + (x/c)^b)^g, where g = 1 gives the 4PL curve; it starts from a when x = 0 and levels off at d. */
export const logistic5 = (x: number, a: number, b: number, c: number, d: number, g = 1): number =>
  d + (a - d) / (1 + (x / c) ** b) ** g;

/** The inverse x = c (((a − d)/(y − d))^(1/g) − 1)^(1/b), or NaN when y is outside the curve's range. */
export function inverse5(y: number, a: number, b: number, c: number, d: number, g = 1): number {
  const ratio = (a - d) / (y - d);
  const inner = ratio ** (1 / g) - 1;
  if (!(ratio > 0) || !(inner > 0)) return NaN;
  return c * inner ** (1 / b);
}

export function fourPlResult(
  a: number,
  b: number,
  c: number,
  d: number,
  g: number,
  x: number | null,
  y: number | null,
): CalcResult {
  positive(c, 'c');
  positive(g, 'g');
  if (b === 0) throw new LsError('errors.positive', { name: 'b' });
  if (a === d) throw new LsError('curves.e.flat');
  const rows: ResultRow[] = [];
  const steps: Step[] = [];
  if (x !== null) {
    const yx = logistic5(nonNegative(x, 'x'), a, b, c, d, g);
    rows.push({ label: 'curves.r.yAt', vars: { x }, value: yx });
    steps.push({ key: 'curves.s.plY', vars: { x, y: yx } });
  }
  if (y !== null) {
    const xy = inverse5(y, a, b, c, d, g);
    if (!Number.isFinite(xy)) throw new LsError('curves.e.outside', { low: Math.min(a, d), high: Math.max(a, d) });
    rows.push({ label: 'curves.r.xAt', vars: { y }, value: xy });
    steps.push({ key: 'curves.s.plX', vars: { x: xy, y } });
  }
  if (rows.length === 0) throw new LsError('curves.e.xOrY');
  const latex = g === 1 ? 'y = d + \\frac{a - d}{1 + (x/c)^b}' : 'y = d + \\frac{a - d}{\\left(1 + (x/c)^b\\right)^g}';
  const xs = logSpace(c / 100, c * 100);
  return {
    rows,
    steps,
    latex,
    plots: [
      {
        title: 'curves.p.standard',
        x: { label: 'curves.p.x', log: true },
        y: { label: 'curves.p.response' },
        series: [{ name: 'curves.p.curve', points: xs.map((v) => [v, logistic5(v, a, b, c, d, g)] as Point) }],
      },
    ],
  };
}

export function standardCurveResult(rows: Rows, five: boolean, unknowns: readonly number[]): CalcResult {
  const data = columns(rows, 2, five ? 6 : 5);
  data.forEach((r) => positive(r[0], 'x'));
  const x = data.map((r) => r[0]);
  const y = data.map((r) => r[1]);
  const w = weightsFrom(data, 2);
  const lowX = x.indexOf(Math.min(...x));
  const highX = x.indexOf(Math.max(...x));
  const p0 = [y[lowX], 1, median(x), y[highX]];
  const model: Model = five
    ? ([v], [a, b, c, d, g]) => logistic5(v, a, b, Math.abs(c), d, g)
    : ([v], [a, b, c, d]) => logistic5(v, a, b, Math.abs(c), d);
  const fit = levenberg(
    model,
    x.map((v) => [v]),
    y,
    five ? [...p0, 1] : p0,
    w,
  );
  const [a, b, cRaw, d] = fit.params;
  const c = Math.abs(cRaw);
  const g = five ? fit.params[4] : 1;
  if (five && !(g > 0)) throw new LsError('curves.e.asymmetry');
  const s = Math.sqrt(fit.sse / fit.dof);
  const tq = tQuantile(0.975, fit.dof);
  const names = five ? ['a', 'b', 'c', 'd', 'g'] : ['a', 'b', 'c', 'd'];
  const back = unknowns.map((u) => {
    const xh = inverse5(u, a, b, c, d, g);
    const lo = inverse5(u - tq * s, a, b, c, d, g);
    const hi = inverse5(u + tq * s, a, b, c, d, g);
    return [u, xh, Math.min(lo, hi), Math.max(lo, hi)];
  });
  const xs = logSpace(Math.min(...x) / 2, Math.max(...x) * 2);
  return {
    rows: [
      { label: 'curves.r.a', value: a },
      { label: 'curves.r.b', value: b },
      { label: 'curves.r.c', value: c },
      { label: 'curves.r.d', value: d },
      ...(five ? [{ label: 'curves.r.g' as const, value: g }] : []),
      { label: 'curves.r.residualSd', value: s },
    ],
    steps: [
      { key: five ? 'curves.s.fit5' : 'curves.s.fit4', vars: { n: data.length, s } },
      ...(back.length ? [{ key: 'curves.s.backCalc' as const, vars: { t: tq, s } }] : []),
    ],
    latex: five ? 'y = d + \\frac{a - d}{\\left(1 + (x/c)^b\\right)^g}' : 'y = d + \\frac{a - d}{1 + (x/c)^b}',
    notes: [{ key: 'curves.n.backCalc' }],
    table: back.length
      ? {
          header: [
            { key: 'curves.t.response' },
            { key: 'curves.t.xBack' },
            { key: 'curves.t.low' },
            { key: 'curves.t.high' },
          ],
          rows: back.map((r) => r.map((v) => (Number.isFinite(v) ? v : '—'))),
        }
      : {
          header: [{ key: 'curves.t.parameter' }, { key: 'curves.t.estimate' }, { key: 'curves.t.se' }],
          rows: names.map((n, i) => [n, i === 2 ? c : fit.params[i], fit.se[i]]),
        },
    plots: [
      {
        title: 'curves.p.standard',
        x: { label: 'curves.p.x', log: true },
        y: { label: 'curves.p.response' },
        series: [
          { name: 'curves.p.data', style: 'points', points: x.map((v, i) => [v, y[i]] as Point) },
          { name: 'curves.p.fit', points: xs.map((v) => [v, logistic5(v, a, b, c, d, g)] as Point) },
        ],
      },
    ],
  };
}

// ---- Dose response ----------------------------------------------------------------------------------------------

/** Log-logistic dose response y = bottom + (top − bottom) / (1 + 10^((log EC50 − log x) h)). */
export const logLogistic = (x: number, bottom: number, top: number, logEc: number, h: number): number =>
  bottom + (top - bottom) / (1 + 10 ** ((logEc - Math.log10(x)) * h));

export function doseResponseResult(rows: Rows): CalcResult {
  const data = columns(rows, 2, 5);
  data.forEach((r) => positive(r[0], 'dose'));
  const x = data.map((r) => r[0]);
  const y = data.map((r) => r[1]);
  const lo = x.indexOf(Math.min(...x));
  const hi = x.indexOf(Math.max(...x));
  const mid = (y[lo] + y[hi]) / 2;
  const near = y.reduce((best, v, i) => (Math.abs(v - mid) < Math.abs(y[best] - mid) ? i : best), 0);
  const fit = levenberg(
    ([v], [b, t, l, h]) => logLogistic(v, b, t, l, h),
    x.map((v) => [v]),
    y,
    [Math.min(y[lo], y[hi]), Math.max(y[lo], y[hi]), Math.log10(x[near]), y[hi] >= y[lo] ? 1 : -1],
  );
  const [bottom, top, logEc, h] = fit.params;
  const ec = 10 ** logEc;
  const half = fit.ci95[2];
  const falling = h < 0;
  const xs = logSpace(Math.min(...x) / 3, Math.max(...x) * 3);
  return {
    rows: [
      { label: falling ? 'curves.r.ic50' : 'curves.r.ec50', value: ec },
      {
        label: 'curves.r.ec50Ci',
        value: '',
        word: 'curves.r.range',
        wordVars: { low: 10 ** (logEc - half), high: 10 ** (logEc + half) },
      },
      { label: 'curves.r.logEc50', value: logEc },
      { label: 'curves.r.hillSlope', value: h },
      { label: 'curves.r.bottom', value: bottom },
      { label: 'curves.r.top', value: top },
    ],
    steps: [
      { key: 'curves.s.doseFit', vars: { n: data.length, l: logEc, se: fit.se[2], h } },
      { key: 'curves.s.doseCi', vars: { l: logEc, w: half, low: 10 ** (logEc - half), high: 10 ** (logEc + half) } },
    ],
    latex: 'y = \\text{bottom} + \\frac{\\text{top} - \\text{bottom}}{1 + 10^{(\\log EC_{50} - \\log x) h}}',
    notes: [{ key: 'curves.n.doseCi' }],
    plots: [
      {
        title: 'curves.p.dose',
        x: { label: 'curves.p.dose', log: true },
        y: { label: 'curves.p.response' },
        series: [
          { name: 'curves.p.data', style: 'points', points: x.map((v, i) => [v, y[i]] as Point) },
          { name: 'curves.p.fit', points: xs.map((v) => [v, logLogistic(v, bottom, top, logEc, h)] as Point) },
        ],
      },
    ],
  };
}

/** Schild regression: log(DR − 1) against log[B]; pA2 is where the line crosses zero. */
export function schildResult(rows: Rows): CalcResult {
  const data = columns(rows, 2, 3);
  data.forEach((r) => {
    positive(r[0], '[B]');
    if (!(r[1] > 1)) throw new LsError('curves.e.doseRatio');
  });
  const xs = data.map((r) => Math.log10(r[0]));
  const ys = data.map((r) => Math.log10(r[1] - 1));
  const line = lineFit(xs, ys);
  const pA2 = line.intercept / line.slope;
  const t = data.length > 2 ? tQuantile(0.975, data.length - 2) : NaN;
  return {
    rows: [
      { label: 'curves.r.pA2', value: pA2 },
      { label: 'curves.r.schildSlope', value: line.slope },
      {
        label: 'curves.r.slopeCi',
        value: Number.isFinite(t) ? '' : '—',
        ...(Number.isFinite(t)
          ? {
              word: 'curves.r.range' as const,
              wordVars: { low: line.slope - t * line.seSlope, high: line.slope + t * line.seSlope },
            }
          : {}),
      },
      { label: 'curves.r.kb', value: 10 ** -pA2, unit: 'M' },
    ],
    steps: [
      { key: 'curves.s.schild', vars: { n: data.length, m: line.slope, c: line.intercept } },
      {
        key: 'curves.s.pA2',
        vars: { c: line.intercept, m: line.slope, p: pA2 },
        math: 'pA_2 = \\frac{\\text{intercept}}{\\text{slope}}',
      },
    ],
    latex: '\\log(DR - 1) = \\log[B] - \\log K_B',
    notes: [
      {
        key:
          Math.abs(line.slope - 1) <= 2 * line.seSlope || data.length < 3 ? 'curves.n.schildOne' : 'curves.n.schildNot',
      },
    ],
    plots: [
      {
        title: 'curves.p.schild',
        x: { label: 'curves.p.logB' },
        y: { label: 'curves.p.logDr' },
        series: [
          { name: 'curves.p.data', style: 'points', points: xs.map((x, i) => [x, ys[i]] as Point) },
          {
            name: 'curves.p.fitLine',
            style: 'dashed',
            points: [Math.min(...xs, -pA2), Math.max(...xs)].map((x) => [x, line.intercept + line.slope * x] as Point),
          },
        ],
      },
    ],
  };
}
