// Receptor binding with a Scatchard plot, Ki from IC50 by Cheng-Prusoff, and the Langmuir, Freundlich, and BET
// adsorption isotherms.
import { LsError, nonNegative, positive, within } from '../num/errors';
import { levenberg, lineFit, type Model, type NonlinearFit } from '../num/fit';
import type { CalcResult, ResultRow, Step } from '../types';
import { type Point, type Rows, logSpace, median, columns, weightsFrom } from './shared';

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
