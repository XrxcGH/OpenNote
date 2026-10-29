// Binding, enzyme, and dose-response curves: Michaelis-Menten fits with the classic linear plots for comparison,
// inhibition models fitted across inhibitor levels, the Hill equation, receptor binding and Cheng-Prusoff, adsorption
// isotherms, 4PL and 5PL standard curves, log-logistic EC50, Schild analysis, probit LD50 by maximum likelihood with a
// Fieller interval, and linear-quadratic cell survival. Concentrations stay in the unit the student types.
import { LsError, nonNegative, positive, whole, within } from '../num/errors';
import { levenberg, lineFit, type Model, type NonlinearFit } from '../num/fit';
import { solveLinear } from '../num/linalg';
import { betaInc, normalCdf, tQuantile } from '../num/special';
import type { CalcResult, PlotData, ResultRow, Step } from '../types';

type Point = [number, number];
type Rows = readonly (readonly number[])[];

const logSpace = (low: number, high: number, n = 120): number[] =>
  Array.from({ length: n + 1 }, (_, i) => low * (high / low) ** (i / n));
const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Rows with at least `columns` numbers; an optional extra column is a standard deviation used as a weight. */
function columns(rows: Rows, count: number, min: number): number[][] {
  if (rows.some((r) => r.length < count)) throw new LsError('curves.e.columns', { n: count });
  if (rows.length < min) throw new LsError('errors.points', { min });
  return rows.map((r) => [...r]);
}

/** Weights 1/SD² when every row has a positive SD in column `col`, otherwise none. */
function weightsFrom(rows: readonly number[][], col: number): number[] | undefined {
  if (!rows.every((r) => r.length > col)) return undefined;
  return rows.map((r) => 1 / positive(r[col], 'SD') ** 2);
}

/** The probability of an F statistic this large or larger on d1 and d2 degrees of freedom. */
export function fSurvival(f: number, d1: number, d2: number): number {
  if (!(f > 0)) return 1;
  return 1 - betaInc((d1 * f) / (d1 * f + d2), d1 / 2, d2 / 2);
}

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

// ---- Receptor binding -------------------------------------------------------------------------------------------

export type Binding = 'one' | 'oneNs' | 'two';
const BINDING: Record<Binding, Model> = {
  one: ([l], [b, kd]) => (b * l) / (kd + l),
  oneNs: ([l], [b, kd, ns]) => (b * l) / (kd + l) + ns * l,
  two: ([l], [b1, k1, b2, k2]) => (b1 * l) / (k1 + l) + (b2 * l) / (k2 + l),
};

export function bindingResult(rows: Rows, type: Binding): CalcResult {
  const data = columns(rows, 2, type === 'two' ? 6 : 4);
  data.forEach((r) => {
    positive(r[0], 'L');
    nonNegative(r[1], 'B');
  });
  const l = data.map((r) => r[0]);
  const b = data.map((r) => r[1]);
  const w = weightsFrom(data, 2);
  const bTop = Math.max(...b);
  const lMid = median(l);
  const p0 =
    type === 'one'
      ? [bTop * 1.2, lMid]
      : type === 'oneNs'
        ? [bTop, lMid, (0.1 * bTop) / Math.max(...l)]
        : [bTop * 0.5, lMid / 10, bTop * 0.7, lMid * 3];
  const fit = levenberg(
    BINDING[type],
    l.map((x) => [x]),
    b,
    p0,
    w,
  );
  // The nonspecific slope may come out a hair below 0 when there is none; the saturable terms may not.
  if (!fit.params.every((p, i) => p >= 0 || (type === 'oneNs' && i === 2))) throw new LsError('curves.e.binding');
  const p = fit.params;
  const out: ResultRow[] =
    type === 'two'
      ? [
          { label: 'curves.r.bmaxSite', vars: { n: 1 }, value: Math.min(p[1], p[3]) === p[1] ? p[0] : p[2] },
          { label: 'curves.r.kdSite', vars: { n: 1 }, value: Math.min(p[1], p[3]) },
          { label: 'curves.r.bmaxSite', vars: { n: 2 }, value: Math.min(p[1], p[3]) === p[1] ? p[2] : p[0] },
          { label: 'curves.r.kdSite', vars: { n: 2 }, value: Math.max(p[1], p[3]) },
        ]
      : [
          { label: 'curves.r.bmax', value: p[0] },
          { label: 'curves.r.bmaxSe', value: fit.se[0] },
          { label: 'curves.r.kd', value: p[1] },
          { label: 'curves.r.kdSe', value: fit.se[1] },
        ];
  if (type === 'oneNs') out.push({ label: 'curves.r.ns', value: p[2] });
  // Scatchard: bound over free against bound, using the specific part of the fit.
  const specific = type === 'oneNs' ? b.map((y, i) => y - p[2] * l[i]) : b;
  const sc = specific.map((y, i) => [y, y / l[i]] as Point).filter(([x, y]) => x > 0 && y > 0);
  const steps: Step[] = [
    { key: `curves.s.binding.${type}`, vars: { n: data.length, sse: fit.sse }, math: bindingLatex[type] },
  ];
  if (type !== 'two' && sc.length >= 2) {
    const line = lineFit(
      sc.map((q) => q[0]),
      sc.map((q) => q[1]),
    );
    steps.push({ key: 'curves.s.scatchard', vars: { kd: -1 / line.slope, b: -line.intercept / line.slope } });
  }
  const xs = logSpace(Math.min(...l) / 3, Math.max(...l) * 3);
  return {
    rows: out,
    steps,
    latex: bindingLatex[type],
    notes: [{ key: 'curves.n.scatchard' }],
    plots: [
      {
        title: 'curves.p.binding',
        x: { label: 'curves.p.l', log: true },
        y: { label: 'curves.p.bound', min: 0 },
        series: [
          { name: 'curves.p.data', style: 'points', points: l.map((x, i) => [x, b[i]] as Point) },
          { name: 'curves.p.fit', points: xs.map((x) => [x, BINDING[type]([x], p)] as Point) },
        ],
      },
      {
        title: 'curves.p.scatchard',
        x: { label: 'curves.p.bound' },
        y: { label: 'curves.p.boundFree' },
        series: [{ name: 'curves.p.data', style: 'points', points: sc }],
      },
    ],
  };
}

const bindingLatex: Record<Binding, string> = {
  one: 'B = \\frac{B_{max} L}{K_d + L}',
  oneNs: 'B = \\frac{B_{max} L}{K_d + L} + NS \\cdot L',
  two: 'B = \\frac{B_1 L}{K_1 + L} + \\frac{B_2 L}{K_2 + L}',
};

/** Ki = IC50 / (1 + [L]/Kd). */
export const chengPrusoff = (ic50: number, l: number, kd: number): number => ic50 / (1 + l / kd);

export function chengPrusoffResult(ic50: number, l: number, kd: number): CalcResult {
  positive(ic50, 'IC50');
  nonNegative(l, '[L]');
  positive(kd, 'Kd');
  const ki = chengPrusoff(ic50, l, kd);
  // Molar inputs arrive in M; show nM, the usual scale for binding constants.
  return {
    rows: [{ label: 'curves.r.ki', value: ki * 1e9, unit: 'nM' }],
    steps: [
      {
        key: 'curves.s.chengPrusoff',
        vars: { ic: ic50 * 1e9, l: l * 1e9, kd: kd * 1e9, ki: ki * 1e9 },
        math: 'K_i = \\frac{IC_{50}}{1 + [L]/K_d}',
      },
    ],
    latex: 'K_i = \\frac{IC_{50}}{1 + [L]/K_d}',
    notes: [{ key: 'curves.n.chengPrusoff' }],
  };
}

// ---- Adsorption isotherms -----------------------------------------------------------------------------------------

export function isothermResult(rows: Rows): CalcResult {
  const data = columns(rows, 2, 3);
  data.forEach((r) => {
    positive(r[0], 'C');
    positive(r[1], 'q');
  });
  const c = data.map((r) => r[0]);
  const q = data.map((r) => r[1]);
  const fr = lineFit(c.map(Math.log10), q.map(Math.log10));
  const freundlich = levenberg(
    ([x], [k, inv]) => k * x ** inv,
    c.map((x) => [x]),
    q,
    [10 ** fr.intercept, fr.slope],
  );
  const lang0 = lineFit(
    c,
    c.map((x, i) => x / q[i]),
  );
  const qm0 = 1 / lang0.slope;
  const langmuir = levenberg(
    ([x], [qm, k]) => (qm * k * x) / (1 + k * x),
    c.map((x) => [x]),
    q,
    qm0 > 0 && lang0.intercept > 0 ? [qm0, lang0.slope / lang0.intercept] : [Math.max(...q) * 1.5, 1 / median(c)],
  );
  const r2 = (fit: NonlinearFit) => {
    const mean = q.reduce((s, v) => s + v, 0) / q.length;
    const sst = q.reduce((s, v) => s + (v - mean) ** 2, 0);
    return sst > 0 ? 1 - fit.sse / sst : 1;
  };
  const [qm, kl] = langmuir.params;
  const [kf, inv] = freundlich.params;
  const top = Math.max(...c) * 1.1;
  const grid = Array.from({ length: 101 }, (_, i) => (top * (i + 0.01)) / 100);
  return {
    rows: [
      { label: 'curves.r.qmax', value: qm },
      { label: 'curves.r.kL', value: kl },
      { label: 'curves.r.kF', value: kf },
      { label: 'curves.r.nF', value: 1 / inv },
    ],
    steps: [
      {
        key: 'curves.s.langmuir',
        vars: { q: qm, k: kl, r: r2(langmuir) },
        math: 'q = \\frac{q_{max} K_L C}{1 + K_L C}',
      },
      { key: 'curves.s.freundlich', vars: { k: kf, n: 1 / inv, r: r2(freundlich) }, math: 'q = K_F C^{1/n}' },
    ],
    latex: 'q = \\frac{q_{max} K_L C}{1 + K_L C}',
    notes: [{ key: 'curves.n.isotherm' }],
    table: {
      header: [{ key: 'curves.t.model' }, { key: 'curves.t.r2' }, { key: 'curves.t.aic' }],
      rows: [
        [{ key: 'curves.o.langmuir' }, r2(langmuir), langmuir.aic],
        [{ key: 'curves.o.freundlich' }, r2(freundlich), freundlich.aic],
      ],
    },
    plots: [
      {
        title: 'curves.p.isotherm',
        x: { label: 'curves.p.ce' },
        y: { label: 'curves.p.q', min: 0 },
        series: [
          { name: 'curves.p.data', style: 'points', points: c.map((x, i) => [x, q[i]] as Point) },
          { name: 'curves.o.langmuir', points: grid.map((x) => [x, (qm * kl * x) / (1 + kl * x)] as Point) },
          { name: 'curves.o.freundlich', style: 'dashed', points: grid.map((x) => [x, kf * x ** inv] as Point) },
        ],
      },
    ],
  };
}

/** BET on relative pressures 0.05 to 0.35: x/(v(1 − x)) = 1/(vm c) + (c − 1) x/(vm c). */
export function betResult(rows: Rows): CalcResult {
  const data = columns(rows, 2, 3);
  data.forEach((r) => {
    within(r[0], 'P/P₀', 0, 1);
    positive(r[1], 'v');
  });
  const used = data.filter((r) => r[0] >= 0.05 && r[0] <= 0.35);
  if (used.length < 3) throw new LsError('curves.e.betRange');
  const xs = used.map((r) => r[0]);
  const ys = used.map((r) => r[0] / (r[1] * (1 - r[0])));
  const line = lineFit(xs, ys);
  const vm = 1 / (line.slope + line.intercept);
  const cBet = line.slope / line.intercept + 1;
  if (!(vm > 0 && cBet > 0)) throw new LsError('curves.e.bet');
  return {
    rows: [
      { label: 'curves.r.vm', value: vm },
      { label: 'curves.r.cBet', value: cBet },
      { label: 'curves.r.r2', value: line.r2 },
    ],
    steps: [
      { key: 'curves.s.betRange', vars: { n: used.length, m: data.length } },
      {
        key: 'curves.s.bet',
        vars: { s: line.slope, i: line.intercept, vm, c: cBet },
        math: '\\frac{x}{v(1 - x)} = \\frac{1}{v_m c} + \\frac{c - 1}{v_m c} x',
      },
    ],
    latex: '\\frac{x}{v(1 - x)} = \\frac{1}{v_m c} + \\frac{c - 1}{v_m c} x',
    notes: [{ key: 'curves.n.bet' }],
    plots: [
      {
        title: 'curves.p.bet',
        x: { label: 'curves.p.relP' },
        y: { label: 'curves.p.betY' },
        series: [
          { name: 'curves.p.data', style: 'points', points: xs.map((x, i) => [x, ys[i]] as Point) },
          {
            name: 'curves.p.fitLine',
            style: 'dashed',
            points: [0.05, 0.35].map((x) => [x, line.intercept + line.slope * x] as Point),
          },
        ],
      },
    ],
  };
}

// ---- 4PL and 5PL standard curves -------------------------------------------------------------------------------

/** y = d + (a − d) / (1 + (x/c)^b)^g; g = 1 is the 4PL curve. a is the response at 0 and d at infinity. */
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

// ---- Probit -------------------------------------------------------------------------------------------------------

const normalPdf = (z: number): number => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);

export interface Probit {
  a: number;
  b: number;
  cov: [[number, number], [number, number]];
  logLd50: number;
  /** The Fieller 95% limits on log10 dose, or null when the slope is not clearly above 0 (g ≥ 1). */
  fieller: [number, number] | null;
  g: number;
  iterations: number;
}

/** Probit regression P(dead) = Φ(a + b log10 dose) by maximum likelihood (Fisher scoring), as in Finney. */
export function probit(dose: readonly number[], n: readonly number[], dead: readonly number[]): Probit {
  const x = dose.map((d) => Math.log10(d));
  // Start from a least-squares line through the empirical probits.
  const emp = dead.map((r, i) => Math.min(Math.max(r / n[i], 0.5 / n[i]), 1 - 0.5 / n[i]));
  const start = lineFit(
    x,
    emp.map((p) => normalQuantileSafe(p)),
  );
  let a = start.intercept;
  let b = start.slope;
  let info: number[][] = [
    [0, 0],
    [0, 0],
  ];
  let iterations = 0;
  for (; iterations < 100; iterations += 1) {
    let ga = 0;
    let gb = 0;
    info = [
      [0, 0],
      [0, 0],
    ];
    for (let i = 0; i < x.length; i += 1) {
      const z = a + b * x[i];
      const p = Math.min(Math.max(normalCdf(z), 1e-12), 1 - 1e-12);
      const phi = normalPdf(z);
      const score = (phi * (dead[i] - n[i] * p)) / (p * (1 - p));
      const w = (n[i] * phi * phi) / (p * (1 - p));
      ga += score;
      gb += score * x[i];
      info[0][0] += w;
      info[0][1] += w * x[i];
      info[1][1] += w * x[i] * x[i];
    }
    info[1][0] = info[0][1];
    const [da, db] = solveLinear(info, [ga, gb]);
    a += da;
    b += db;
    if (Math.abs(da) + Math.abs(db) < 1e-12 * (1 + Math.abs(a) + Math.abs(b))) break;
  }
  if (!(b > 0) || !Number.isFinite(a)) throw new LsError('curves.e.probitSlope');
  const det = info[0][0] * info[1][1] - info[0][1] * info[0][1];
  const vaa = info[1][1] / det;
  const vbb = info[0][0] / det;
  const vab = -info[0][1] / det;
  const m = -a / b;
  const z = 1.959963984540054;
  const g = (z * z * vbb) / (b * b);
  let fieller: [number, number] | null = null;
  if (g < 1) {
    const centre = m + (g / (1 - g)) * (m + vab / vbb);
    const root = (z / (b * (1 - g))) * Math.sqrt(vaa + 2 * m * vab + m * m * vbb - g * (vaa - (vab * vab) / vbb));
    fieller = [centre - root, centre + root];
  }
  return {
    a,
    b,
    cov: [
      [vaa, vab],
      [vab, vbb],
    ],
    logLd50: m,
    fieller,
    g,
    iterations,
  };
}

function normalQuantileSafe(p: number): number {
  // Φ⁻¹ by bisection on normalCdf, accurate enough for a starting value.
  let lo = -10;
  let hi = 10;
  for (let i = 0; i < 80; i += 1) {
    const mid = (lo + hi) / 2;
    if (normalCdf(mid) < p) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function probitResult(rows: Rows): CalcResult {
  const data = columns(rows, 3, 3);
  data.forEach((r) => {
    positive(r[0], 'dose');
    whole(r[1], 'n', 1);
    whole(r[2], 'r', 0);
    if (r[2] > r[1]) throw new LsError('curves.e.moreDead');
  });
  const dose = data.map((r) => r[0]);
  const n = data.map((r) => r[1]);
  const dead = data.map((r) => r[2]);
  const pr = probit(dose, n, dead);
  const chi = data.reduce((s, r, i) => {
    const p = normalCdf(pr.a + pr.b * Math.log10(dose[i]));
    const e = n[i] * p;
    return s + (r[2] - e) ** 2 / Math.max(e * (1 - p), 1e-12);
  }, 0);
  const ld = 10 ** pr.logLd50;
  const rowsOut: ResultRow[] = [
    { label: 'curves.r.ld50', value: ld },
    {
      label: 'curves.r.fieller',
      value: pr.fieller ? '' : '—',
      ...(pr.fieller
        ? { word: 'curves.r.range' as const, wordVars: { low: 10 ** pr.fieller[0], high: 10 ** pr.fieller[1] } }
        : {}),
    },
    { label: 'curves.r.probitA', value: pr.a },
    { label: 'curves.r.probitB', value: pr.b },
    { label: 'curves.r.probitBSe', value: Math.sqrt(pr.cov[1][1]) },
    { label: 'curves.r.chi', vars: { df: data.length - 2 }, value: chi },
  ];
  const xs = dose.map((d) => Math.log10(d));
  const span = [Math.min(...xs) - 0.3, Math.max(...xs) + 0.3];
  return {
    rows: rowsOut,
    steps: [
      {
        key: 'curves.s.probit',
        vars: { n: data.length, it: pr.iterations, a: pr.a, b: pr.b },
        math: 'P = \\Phi(a + b \\log_{10} d)',
      },
      { key: 'curves.s.ld50', vars: { a: pr.a, b: pr.b, m: pr.logLd50, ld } },
      pr.fieller
        ? { key: 'curves.s.fieller', vars: { g: pr.g, low: 10 ** pr.fieller[0], high: 10 ** pr.fieller[1] } }
        : { key: 'curves.s.noFieller', vars: { g: pr.g } },
    ],
    latex: 'P = \\Phi(a + b \\log_{10} d),\\quad \\log_{10} LD_{50} = -a/b',
    notes: [{ key: 'curves.n.probit' }],
    plots: [
      {
        title: 'curves.p.probit',
        x: { label: 'curves.p.logDose' },
        y: { label: 'curves.p.mortality', min: 0, max: 1 },
        series: [
          { name: 'curves.p.data', style: 'points', points: xs.map((x, i) => [x, dead[i] / n[i]] as Point) },
          {
            name: 'curves.p.fit',
            points: Array.from({ length: 101 }, (_, i) => {
              const x = span[0] + ((span[1] - span[0]) * i) / 100;
              return [x, normalCdf(pr.a + pr.b * x)] as Point;
            }),
          },
        ],
      },
    ],
  };
}

// ---- Linear-quadratic survival ----------------------------------------------------------------------------------

export const lqSurvival = (alpha: number, beta: number, d: number): number => Math.exp(-alpha * d - beta * d * d);

export function lqResult(alpha: number, beta: number, d: number, fractions: number): CalcResult {
  positive(alpha, 'α');
  positive(beta, 'β');
  positive(d, 'd');
  whole(fractions, 'n', 1);
  const ab = alpha / beta;
  const s = lqSurvival(alpha, beta, d);
  const bed = fractions * d * (1 + d / ab);
  const eqd2 = bed / (1 + 2 / ab);
  const top = Math.max(10, d * 2);
  const plot: PlotData = {
    title: 'curves.p.lq',
    x: { label: 'curves.p.doseGy' },
    y: { label: 'curves.p.survival', log: true },
    series: [
      {
        name: 'curves.p.lqCurve',
        points: Array.from({ length: 101 }, (_, i) => {
          const x = (top * i) / 100;
          return [x, lqSurvival(alpha, beta, x)] as Point;
        }),
      },
    ],
  };
  return {
    rows: [
      { label: 'curves.r.survival', vars: { d }, value: s },
      { label: 'curves.r.survivalCourse', value: s ** fractions },
      { label: 'curves.r.alphaBeta', value: ab, unit: 'Gy' },
      { label: 'curves.r.bed', value: bed, unit: 'Gy' },
      { label: 'curves.r.eqd2', value: eqd2, unit: 'Gy' },
    ],
    steps: [
      { key: 'curves.s.lq', vars: { a: alpha, b: beta, d, s }, math: 'S = e^{-\\alpha D - \\beta D^2}' },
      {
        key: 'curves.s.bed',
        vars: { n: fractions, d, ab, bed },
        math: 'BED = n d \\left(1 + \\frac{d}{\\alpha/\\beta}\\right)',
      },
      { key: 'curves.s.eqd2', vars: { bed, ab, eqd2 }, math: 'EQD_2 = \\frac{BED}{1 + 2/(\\alpha/\\beta)}' },
    ],
    latex: 'S = e^{-\\alpha D - \\beta D^2}',
    notes: [{ key: 'curves.n.lq' }],
    plots: [plot],
  };
}
