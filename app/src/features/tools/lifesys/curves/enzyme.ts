// Enzyme kinetics: Michaelis-Menten fits beside the 3 classic linear plots, inhibition models fitted across inhibitor
// levels, apparent constants, and the Hill equation.
import { LsError, nonNegative, positive, within } from '../num/errors';
import { levenberg, lineFit, type Model, type NonlinearFit } from '../num/fit';
import type { CalcResult, ResultRow, Step } from '../types';
import { type Point, type Rows, logSpace, median, columns, weightsFrom, fSurvival } from './shared';

// ---- Michaelis-Menten -------------------------------------------------------------------------------------------

export interface MmEstimates {
  vmax: number;
  km: number;
}

/** Lineweaver-Burk, Eadie-Hofstee, and Hanes-Woolf estimates by ordinary least squares on the transformed data. */
export function linearizations(s: readonly number[], v: readonly number[]) {
  const lb = lineFit(
    s.map((x) => 1 / x),
    v.map((y) => 1 / y),
  );
  const eh = lineFit(
    s.map((x, i) => v[i] / x),
    v,
  );
  const hw = lineFit(
    s,
    s.map((x, i) => x / v[i]),
  );
  return {
    lineweaver: { vmax: 1 / lb.intercept, km: lb.slope / lb.intercept },
    eadie: { vmax: eh.intercept, km: -eh.slope },
    hanes: { vmax: 1 / hw.slope, km: hw.intercept / hw.slope },
  };
}

const mmModel: Model = ([s], [vmax, km]) => (vmax * s) / (km + s);

export function fitMichaelis(rows: Rows): { fit: NonlinearFit; s: number[]; v: number[]; w?: number[] } {
  const data = columns(rows, 2, 3);
  data.forEach((r) => {
    positive(r[0], 'S');
    positive(r[1], 'v');
  });
  const s = data.map((r) => r[0]);
  const v = data.map((r) => r[1]);
  const w = weightsFrom(data, 2);
  let p0 = [Math.max(...v) * 1.2, median(s)];
  try {
    const lb = linearizations(s, v).lineweaver;
    if (lb.vmax > 0 && lb.km > 0) p0 = [lb.vmax, lb.km];
  } catch {
    // Fall back to the rough start.
  }
  const fit = levenberg(
    mmModel,
    s.map((x) => [x]),
    v,
    p0,
    w,
  );
  if (!(fit.params[0] > 0 && fit.params[1] > 0)) throw new LsError('curves.e.noSaturation');
  return { fit, s, v, w };
}

export function michaelisResult(rows: Rows, enzyme: number | null): CalcResult {
  const { fit, s, v, w } = fitMichaelis(rows);
  const [vmax, km] = fit.params;
  const lin = linearizations(s, v);
  const out: ResultRow[] = [
    { label: 'curves.r.vmax', value: vmax },
    { label: 'curves.r.vmaxSe', value: fit.se[0] },
    { label: 'curves.r.km', value: km },
    { label: 'curves.r.kmSe', value: fit.se[1] },
  ];
  const steps: Step[] = [
    {
      key: w ? 'curves.s.mmWeighted' : 'curves.s.mmFit',
      vars: { n: s.length, v: vmax, k: km, sse: fit.sse },
      math: 'v = \\frac{V_{max} S}{K_m + S}',
    },
    lin.lineweaver.vmax > 0
      ? { key: 'curves.s.lineweaver', vars: { v: lin.lineweaver.vmax, k: lin.lineweaver.km } }
      : { key: 'curves.s.lineweaverBad' },
  ];
  if (enzyme !== null) {
    const kcat = vmax / positive(enzyme, '[E]');
    out.push({ label: 'curves.r.kcat', value: kcat }, { label: 'curves.r.efficiency', value: kcat / km });
    steps.push({ key: 'curves.s.kcat', vars: { v: vmax, e: enzyme, kcat, k: km, eff: kcat / km } });
  }
  const top = Math.max(...s) * 1.2;
  const sMin = Math.min(...s);
  return {
    rows: out,
    steps,
    latex: 'v = \\frac{V_{max} S}{K_m + S}',
    notes: [{ key: 'curves.n.linearBias' }],
    table: {
      header: [{ key: 'curves.t.method' }, { key: 'curves.t.vmax' }, { key: 'curves.t.km' }],
      rows: [
        [{ key: 'curves.o.nonlinear' }, vmax, km],
        [{ key: 'curves.o.lineweaver' }, lin.lineweaver.vmax, lin.lineweaver.km],
        [{ key: 'curves.o.eadie' }, lin.eadie.vmax, lin.eadie.km],
        [{ key: 'curves.o.hanes' }, lin.hanes.vmax, lin.hanes.km],
      ],
    },
    plots: [
      {
        title: 'curves.p.mm',
        x: { label: 'curves.p.s' },
        y: { label: 'curves.p.v', min: 0 },
        series: [
          { name: 'curves.p.data', points: s.map((x, i) => [x, v[i]] as Point), style: 'points' },
          {
            name: 'curves.p.fit',
            points: Array.from({ length: 121 }, (_, i) => {
              const x = (top * i) / 120;
              return [x, mmModel([x], fit.params)] as Point;
            }),
          },
        ],
      },
      {
        title: 'curves.p.lb',
        x: { label: 'curves.p.invS' },
        y: { label: 'curves.p.invV' },
        series: [
          { name: 'curves.p.data', points: s.map((x, i) => [1 / x, 1 / v[i]] as Point), style: 'points' },
          {
            name: 'curves.p.fitLine',
            style: 'dashed',
            points: [0, 1 / sMin].map((x) => [x, (km / vmax) * x + 1 / vmax] as Point),
          },
        ],
      },
    ],
  };
}

// ---- Inhibition ---------------------------------------------------------------------------------------------------

export type Inhibition = 'competitive' | 'uncompetitive' | 'noncompetitive' | 'mixed';
const INHIBITION: Record<Inhibition, { model: Model; latex: string }> = {
  competitive: {
    model: ([s, i], [vm, km, ki]) => (vm * s) / (km * (1 + i / ki) + s),
    latex: 'v = \\frac{V_{max} S}{K_m(1 + I/K_i) + S}',
  },
  uncompetitive: {
    model: ([s, i], [vm, km, ki]) => (vm * s) / (km + s * (1 + i / ki)),
    latex: 'v = \\frac{V_{max} S}{K_m + S(1 + I/K_i)}',
  },
  noncompetitive: {
    model: ([s, i], [vm, km, ki]) => (vm * s) / ((km + s) * (1 + i / ki)),
    latex: 'v = \\frac{V_{max} S}{(K_m + S)(1 + I/K_i)}',
  },
  mixed: {
    model: ([s, i], [vm, km, ki, a]) => (vm * s) / (km * (1 + i / ki) + s * (1 + i / (a * ki))),
    latex: 'v = \\frac{V_{max} S}{K_m(1 + I/K_i) + S(1 + I/(\\alpha K_i))}',
  },
};

/** Apparent Vmax and Km at inhibitor level I for each inhibition type. */
export function apparent(type: Inhibition, vmax: number, km: number, ki: number, i: number, alpha = 1) {
  const a = 1 + i / ki;
  const b = type === 'competitive' ? 1 : type === 'mixed' ? 1 + i / (alpha * ki) : a;
  const kmFactor = type === 'uncompetitive' ? 1 : a;
  return { vmax: vmax / b, km: (km * kmFactor) / b };
}

export function apparentResult(
  type: Inhibition,
  vmax: number,
  km: number,
  ki: number,
  i: number,
  alpha: number,
): CalcResult {
  positive(vmax, 'Vmax');
  positive(km, 'Km');
  positive(ki, 'Ki');
  nonNegative(i, 'I');
  positive(alpha, 'α');
  const app = apparent(type, vmax, km, ki, i, alpha);
  const top = Math.max(km, app.km) * 10;
  const curve = (vm: number, k: number) =>
    Array.from({ length: 121 }, (_, n) => {
      const x = (top * n) / 120;
      return [x, (vm * x) / (k + x)] as Point;
    });
  return {
    rows: [
      { label: 'curves.r.kmApp', value: app.km },
      { label: 'curves.r.vmaxApp', value: app.vmax },
    ],
    steps: [{ key: `curves.s.app.${type}`, vars: { i, ki, a: alpha, km: app.km, v: app.vmax } }],
    latex: INHIBITION[type].latex,
    plots: [
      {
        title: 'curves.p.inhibited',
        x: { label: 'curves.p.s' },
        y: { label: 'curves.p.v', min: 0 },
        series: [
          { name: 'curves.p.without', points: curve(vmax, km) },
          { name: 'curves.p.with', style: 'dashed', points: curve(app.vmax, app.km) },
        ],
      },
    ],
  };
}

export function fitInhibition(rows: Rows) {
  const data = columns(rows, 3, 6);
  data.forEach((r) => {
    positive(r[0], 'S');
    nonNegative(r[1], 'I');
    positive(r[2], 'v');
  });
  const levels = new Set(data.map((r) => r[1]));
  if (levels.size < 2 || !levels.has(0)) throw new LsError('curves.e.levels');
  const free = data.filter((r) => r[1] === 0);
  const start =
    free.length >= 3
      ? fitMichaelis(free.map((r) => [r[0], r[2]])).fit.params
      : [Math.max(...data.map((r) => r[2])), median(data.map((r) => r[0]))];
  const ki0 = median(data.filter((r) => r[1] > 0).map((r) => r[1]));
  const xs = data.map((r) => [r[0], r[1]]);
  const ys = data.map((r) => r[2]);
  const fits = (Object.keys(INHIBITION) as Inhibition[]).map((type) => {
    const p0 = type === 'mixed' ? [...start, ki0, 1] : [...start, ki0];
    try {
      const fit = levenberg(INHIBITION[type].model, xs, ys, p0);
      return fit.params.every((p) => p > 0) ? { type, fit } : { type, fit: null };
    } catch {
      return { type, fit: null };
    }
  });
  return { fits, n: data.length, data };
}

export function inhibitionResult(rows: Rows): CalcResult {
  const { fits, n, data } = fitInhibition(rows);
  const ok = fits.filter((f) => f.fit !== null) as { type: Inhibition; fit: NonlinearFit }[];
  if (ok.length === 0) throw new LsError('errors.converge');
  const best = ok.reduce((a, b) => (b.fit.aic < a.fit.aic ? b : a));
  const mixed = ok.find((f) => f.type === 'mixed');
  const steps: Step[] = [{ key: 'curves.s.inhibitionFit', vars: { n, m: ok.length } }];
  const out: ResultRow[] = [
    { label: 'curves.r.best', value: '', word: `curves.o.${best.type}` },
    { label: 'curves.r.vmax', value: best.fit.params[0] },
    { label: 'curves.r.km', value: best.fit.params[1] },
    { label: 'curves.r.ki', value: best.fit.params[2] },
    { label: 'curves.r.kiSe', value: best.fit.se[2] },
  ];
  if (best.type === 'mixed') out.push({ label: 'curves.r.alpha', value: best.fit.params[3] });
  if (mixed) {
    for (const f of ok.filter((x) => x.type !== 'mixed')) {
      // A mixed fit that stops short of a simpler model's optimum counts as no improvement.
      const F = Math.max(0, (f.fit.sse - mixed.fit.sse) / (mixed.fit.sse / mixed.fit.dof));
      const p = fSurvival(F, 1, mixed.fit.dof);
      steps.push({ key: `curves.s.fTest.${f.type as Exclude<Inhibition, 'mixed'>}`, vars: { F, p, d: mixed.fit.dof } });
    }
  }
  steps.push({ key: 'curves.s.aicBest', vars: { aic: best.fit.aic } });
  const levels = [...new Set(data.map((r) => r[1]))].sort((a, b) => a - b);
  const sMax = Math.max(...data.map((r) => r[0])) * 1.1;
  const model = INHIBITION[best.type].model;
  return {
    rows: out,
    steps,
    latex: INHIBITION[best.type].latex,
    notes: [{ key: 'curves.n.inhibition' }],
    table: {
      header: [
        { key: 'curves.t.model' },
        { key: 'curves.t.vmax' },
        { key: 'curves.t.km' },
        { key: 'curves.t.ki' },
        { key: 'curves.t.alpha' },
        { key: 'curves.t.sse' },
        { key: 'curves.t.aic' },
      ],
      rows: fits.map((f) =>
        f.fit
          ? [
              { key: `curves.o.${f.type}` as const },
              f.fit.params[0],
              f.fit.params[1],
              f.fit.params[2],
              f.fit.params[3] ?? '—',
              f.fit.sse,
              f.fit.aic,
            ]
          : [{ key: `curves.o.${f.type}` as const }, '—', '—', '—', '—', '—', '—'],
      ),
    },
    plots: [
      {
        title: 'curves.p.inhibition',
        x: { label: 'curves.p.s' },
        y: { label: 'curves.p.v', min: 0 },
        series: levels.flatMap((i) => [
          {
            name: 'curves.p.level' as const,
            vars: { i },
            style: 'points' as const,
            points: data.filter((r) => r[1] === i).map((r) => [r[0], r[2]] as Point),
          },
          {
            name: 'curves.p.levelFit' as const,
            vars: { i },
            points: Array.from({ length: 81 }, (_, k) => {
              const x = (sMax * k) / 80;
              return [x, model([x, i], best.fit.params)] as Point;
            }),
          },
        ]),
      },
    ],
  };
}

// ---- Hill ---------------------------------------------------------------------------------------------------------

/** The Hill fraction Lⁿ / (K₀.₅ⁿ + Lⁿ). */
export const hillFraction = (l: number, k: number, n: number): number => (l === 0 ? 0 : 1 / (1 + (k / l) ** n));

export function hillResult(l: number, k: number, n: number): CalcResult {
  nonNegative(l, 'L');
  positive(k, 'K₀.₅');
  positive(n, 'n');
  const y = hillFraction(l, k, n);
  const xs = logSpace(k / 100, k * 100);
  return {
    rows: [{ label: 'curves.r.fraction', value: y }],
    steps: [{ key: 'curves.s.hill', vars: { l, k, n, y }, math: 'Y = \\frac{L^n}{K_{0.5}^n + L^n}' }],
    latex: 'Y = \\frac{L^n}{K_{0.5}^n + L^n}',
    notes: [{ key: 'curves.n.hill' }],
    plots: [
      {
        title: 'curves.p.hill',
        x: { label: 'curves.p.l', log: true },
        y: { label: 'curves.p.y', min: 0, max: 1 },
        series: [
          { name: 'curves.p.hillCurve', vars: { n }, points: xs.map((x) => [x, hillFraction(x, k, n)] as Point) },
          { name: 'curves.p.noCoop', style: 'dashed', points: xs.map((x) => [x, hillFraction(x, k, 1)] as Point) },
        ],
      },
    ],
  };
}

export function hillFitResult(rows: Rows): CalcResult {
  const data = columns(rows, 2, 4);
  data.forEach((r) => {
    positive(r[0], 'L');
    within(r[1], 'Y', 0, 1);
  });
  const inner = data.filter((r) => r[1] > 0 && r[1] < 1);
  if (inner.length < 2) throw new LsError('curves.e.hillRange');
  const lin = lineFit(
    inner.map((r) => Math.log10(r[0])),
    inner.map((r) => Math.log10(r[1] / (1 - r[1]))),
  );
  const fit = levenberg(
    ([l], [k, n]) => hillFraction(l, k, n),
    data.map((r) => [r[0]]),
    data.map((r) => r[1]),
    [Math.max(10 ** (-lin.intercept / lin.slope), 1e-12), Math.max(lin.slope, 0.1)],
  );
  const [k, n] = fit.params;
  const xs = logSpace(Math.min(...data.map((r) => r[0])) / 2, Math.max(...data.map((r) => r[0])) * 2);
  return {
    rows: [
      { label: 'curves.r.hillN', value: n },
      { label: 'curves.r.hillNSe', value: fit.se[1] },
      { label: 'curves.r.k05', value: k },
      { label: 'curves.r.k05Se', value: fit.se[0] },
    ],
    steps: [
      { key: 'curves.s.hillPlot', vars: { n: lin.slope, k: 10 ** (-lin.intercept / lin.slope) } },
      { key: 'curves.s.hillFit', vars: { m: data.length, n, k }, math: 'Y = \\frac{L^n}{K_{0.5}^n + L^n}' },
    ],
    latex: '\\log\\frac{Y}{1 - Y} = n \\log L - n \\log K_{0.5}',
    notes: [{ key: 'curves.n.hill' }],
    plots: [
      {
        title: 'curves.p.hillPlot',
        x: { label: 'curves.p.logL' },
        y: { label: 'curves.p.logit' },
        series: [
          {
            name: 'curves.p.data',
            style: 'points',
            points: inner.map((r) => [Math.log10(r[0]), Math.log10(r[1] / (1 - r[1]))] as Point),
          },
          {
            name: 'curves.p.fitLine',
            style: 'dashed',
            points: [xs[0], xs[xs.length - 1]].map(
              (x) => [Math.log10(x), n * (Math.log10(x) - Math.log10(k))] as Point,
            ),
          },
        ],
      },
    ],
  };
}
