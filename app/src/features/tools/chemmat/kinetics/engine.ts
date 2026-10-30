// Chemical kinetics: integrated rate laws and half-lives, the order from concentration-time data by three
// linearizations, orders and k from initial rates, and the Arrhenius equation from two points or a table.
import { latexNumber, plain } from '../chemText';
import { R } from '../constants';
import { lineFit } from '../num';
import type { LineFit } from '../num';
import { fail } from '../types';
import type { Failed, KitStep, Outcome, PlotData, Row } from '../types';

/** Reads lines of numbers separated by commas, spaces, tabs, or semicolons; null if any piece is not a number. */
export function parseTable(text: string): number[][] | null {
  const rows: number[][] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const cells = trimmed.split(/[\s,;]+/).filter(Boolean);
    const numbers = cells.map((c) => (/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(c) ? Number(c) : NaN));
    if (numbers.some((n) => Number.isNaN(n))) return null;
    rows.push(numbers);
  }
  return rows;
}

const unitK = (order: number, tunit: string) =>
  order === 0 ? `mol/(L ${tunit})` : order === 1 ? `1/${tunit}` : `L/(mol ${tunit})`;

export interface IntegratedInput {
  order: number;
  /** Rate constant in concentration units of mol/L and the chosen time unit. */
  k: number;
  c0: number;
  /** Time since the start, in the chosen time unit. */
  t: number;
  /** A concentration to reach, mol/L, or NaN to skip. */
  target: number;
  tunit: string;
}

/** Concentration after time t for a zero, first, or second order reaction. */
export function concentrationAt(order: number, k: number, c0: number, t: number): number {
  if (order === 0) return Math.max(0, c0 - k * t);
  if (order === 1) return c0 * Math.exp(-k * t);
  return c0 / (1 + k * c0 * t);
}

/** Time to fall from c0 to c. */
export function timeTo(order: number, k: number, c0: number, c: number): number {
  if (order === 0) return (c0 - c) / k;
  if (order === 1) return Math.log(c0 / c) / k;
  return (1 / c - 1 / c0) / k;
}

export const halfLife = (order: number, k: number, c0: number) =>
  order === 0 ? c0 / (2 * k) : order === 1 ? Math.LN2 / k : 1 / (k * c0);

const LAWS = [
  '[A]=[A]_0-kt,\\qquad t_{1/2}=\\frac{[A]_0}{2k}',
  '[A]=[A]_0e^{-kt},\\qquad t_{1/2}=\\frac{\\ln 2}{k}',
  '\\frac{1}{[A]}=\\frac{1}{[A]_0}+kt,\\qquad t_{1/2}=\\frac{1}{k[A]_0}',
];

function decayPlot(order: number, k: number, c0: number, span: number): PlotData {
  const points = Array.from({ length: 81 }, (_, i): [number, number] => {
    const t = (span * i) / 80;
    return [t, concentrationAt(order, k, c0, t)];
  });
  return {
    xLabel: 'kitChemMat.kin.plot.time',
    yLabel: 'kitChemMat.kin.plot.conc',
    series: [{ label: 'kitChemMat.kin.plot.curve', points }],
    alt: 'kitChemMat.kin.plot.alt',
  };
}

export function integrated(input: IntegratedInput): Outcome {
  const { order, k, c0, t, target, tunit } = input;
  if (![0, 1, 2].includes(order)) return fail('kitChemMat.kin.err.order');
  if (!(k > 0) || !Number.isFinite(k)) return fail('kitChemMat.kin.err.k');
  if (!(c0 > 0) || !Number.isFinite(c0)) return fail('kitChemMat.kin.err.c0');
  if (!(t >= 0) || !Number.isFinite(t)) return fail('kitChemMat.kin.err.time');
  if (!Number.isNaN(target) && (!(target > 0) || target >= c0)) return fail('kitChemMat.kin.err.target');
  const c = concentrationAt(order, k, c0, t);
  const half = halfLife(order, k, c0);
  const rows: Row[] = [
    { key: 'kitChemMat.kin.row.conc', value: c, unit: 'mol/L', digits: 5 },
    { key: 'kitChemMat.kin.row.half', value: half, unit: tunit, digits: 5 },
    { key: 'kitChemMat.kin.row.fraction', value: (c / c0) * 100, unit: '%', digits: 4 },
  ];
  const steps: KitStep[] = [
    { key: 'kitChemMat.kin.step.law', vars: { order: String(order) }, math: LAWS[order] },
    {
      key: 'kitChemMat.kin.step.half',
      math: `t_{1/2}=${latexNumber(half, 5)}\\ \\mathrm{${tunit}}`,
    },
  ];
  if (!Number.isNaN(target)) {
    const tt = timeTo(order, k, c0, target);
    rows.push({ key: 'kitChemMat.kin.row.timeTo', value: tt, unit: tunit, digits: 5 });
    steps.push({ key: 'kitChemMat.kin.step.timeTo', math: `t=${latexNumber(tt, 5)}\\ \\mathrm{${tunit}}` });
  }
  const span = order === 0 ? Math.min(c0 / k, Math.max(t, half * 2)) * 1.1 : Math.max(t, half * 4);
  return {
    ok: true,
    rows,
    steps,
    notes: [{ key: 'kitChemMat.kin.note.units', vars: { unit: unitK(order, tunit) } }],
    equation: LAWS[order],
    plot: decayPlot(order, k, c0, span),
  };
}

interface Linearization {
  order: number;
  fit: LineFit;
  /** The rate constant implied by the slope. */
  k: number;
  /** The initial concentration implied by the intercept. */
  c0: number;
}

/** Fits c against t for the three orders and returns the fits that could be made. */
export function linearizations(t: number[], c: number[]): Linearization[] {
  const out: Linearization[] = [];
  const zero = lineFit(t, c);
  if (zero) out.push({ order: 0, fit: zero, k: -zero.slope, c0: zero.intercept });
  const first = lineFit(
    t,
    c.map((v) => Math.log(v)),
  );
  if (first) out.push({ order: 1, fit: first, k: -first.slope, c0: Math.exp(first.intercept) });
  const second = lineFit(
    t,
    c.map((v) => 1 / v),
  );
  if (second) out.push({ order: 2, fit: second, k: second.slope, c0: 1 / second.intercept });
  return out;
}

function dataFailure(rows: number[][] | null, columns: number, minimum: number): Failed | null {
  if (rows === null) return fail('kitChemMat.kin.err.table');
  if (rows.some((r) => r.length !== columns)) return fail('kitChemMat.kin.err.columns', { n: String(columns) });
  if (rows.length < minimum) return fail('kitChemMat.kin.err.points', { n: String(minimum) });
  return null;
}

function dataPlot(t: number[], c: number[], best: Linearization): PlotData {
  const span = Math.max(...t);
  const curve = Array.from({ length: 61 }, (_, i): [number, number] => {
    const x = (span * i) / 60;
    return [x, concentrationAt(best.order, best.k, best.c0, x)];
  });
  return {
    xLabel: 'kitChemMat.kin.plot.time',
    yLabel: 'kitChemMat.kin.plot.conc',
    series: [
      { label: 'kitChemMat.kin.plot.data', style: 'dots', points: t.map((x, i): [number, number] => [x, c[i]]) },
      { label: 'kitChemMat.kin.plot.best', points: curve },
    ],
    alt: 'kitChemMat.kin.plot.dataAlt',
  };
}

export function orderFromData(text: string, tunit: string): Outcome {
  const table = parseTable(text);
  const bad = dataFailure(table, 2, 3);
  if (bad) return bad;
  const t = table!.map((r) => r[0]);
  const c = table!.map((r) => r[1]);
  if (c.some((v) => !(v > 0))) return fail('kitChemMat.kin.err.positive');
  if (new Set(t).size < 3) return fail('kitChemMat.kin.err.distinctTimes');
  const all = linearizations(t, c);
  const best = all.reduce((a, b) => (b.fit.r2 > a.fit.r2 + 1e-12 ? b : a));
  if (!(best.k > 0)) return fail('kitChemMat.kin.err.noDecay');
  const rows: Row[] = [
    ...all.map((l): Row => ({
      key: 'kitChemMat.kin.row.r2',
      keyVars: { order: String(l.order) },
      value: l.fit.r2,
      digits: 8,
    })),
    { key: 'kitChemMat.kin.row.order', value: best.order, digits: 2 },
    { key: 'kitChemMat.kin.row.k', value: best.k, unit: unitK(best.order, tunit), digits: 5 },
    { key: 'kitChemMat.kin.row.half', value: halfLife(best.order, best.k, best.c0), unit: tunit, digits: 5 },
  ];
  if (best.fit.n > 2) rows.splice(-2, 0, { key: 'kitChemMat.kin.row.kErr', value: best.fit.slopeSe, digits: 3 });
  const axes = ['[A]', '\\ln[A]', '1/[A]'][best.order];
  const steps: KitStep[] = [
    { key: 'kitChemMat.kin.step.fits' },
    { key: 'kitChemMat.kin.step.best', vars: { order: String(best.order) }, math: `${axes}\\ \\text{against}\\ t` },
    { key: 'kitChemMat.kin.step.slope', math: `k=${latexNumber(best.k, 5)}\\ \\mathrm{${unitK(best.order, tunit)}}` },
  ];
  return {
    ok: true,
    rows,
    steps,
    notes: [{ key: 'kitChemMat.kin.note.fit' }],
    equation: LAWS[best.order],
    plot: dataPlot(t, c, best),
  };
}

/** Least squares for y = b0 + b1 x1 + ... by the normal equations; null if the columns are dependent. */
export function multiFit(x: number[][], y: number[]): number[] | null {
  const p = x[0].length + 1;
  const a: number[][] = Array.from({ length: p }, () => new Array<number>(p + 1).fill(0));
  x.forEach((row, r) => {
    const v = [1, ...row];
    for (let i = 0; i < p; i++) {
      for (let j = 0; j < p; j++) a[i][j] += v[i] * v[j];
      a[i][p] += v[i] * y[r];
    }
  });
  for (let col = 0; col < p; col++) {
    let pivot = col;
    for (let r = col + 1; r < p; r++) if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = 0; r < p; r++) {
      if (r === col) continue;
      const f = a[r][col] / a[col][col];
      for (let j = col; j <= p; j++) a[r][j] -= f * a[col][j];
    }
  }
  return a.map((row, i) => row[p] / row[i]);
}

export function initialRates(text: string, species: number): Outcome {
  const table = parseTable(text);
  const bad = dataFailure(table, species + 1, species + 1);
  if (bad) return bad;
  if (table!.some((r) => r.some((v) => !(v > 0)))) return fail('kitChemMat.kin.err.positive');
  const x = table!.map((r) => r.slice(0, species).map((v) => Math.log10(v)));
  const y = table!.map((r) => Math.log10(r[species]));
  const beta = multiFit(x, y);
  if (!beta) return fail('kitChemMat.kin.err.vary');
  const orders = beta.slice(1);
  const rounded = orders.map((m) => Math.round(m * 2) / 2);
  const ks = table!.map((r) => r[species] / r.slice(0, species).reduce((p, c, i) => p * Math.pow(c, rounded[i]), 1));
  const k = Math.pow(10, ks.reduce((s, v) => s + Math.log10(v), 0) / ks.length);
  const names = ['A', 'B', 'C'];
  const rows: Row[] = [
    ...orders.map((m, i): Row => ({
      key: 'kitChemMat.kin.row.fitOrder',
      keyVars: { name: names[i] },
      value: m,
      digits: 4,
    })),
    ...rounded.map((m, i): Row => ({
      key: 'kitChemMat.kin.row.useOrder',
      keyVars: { name: names[i] },
      value: m,
      digits: 3,
    })),
    { key: 'kitChemMat.kin.row.overall', value: rounded.reduce((s, v) => s + v, 0), digits: 3 },
    { key: 'kitChemMat.kin.row.k', value: k, digits: 5, unit: 'mol/L, s' },
  ];
  const law = rounded.map((m, i) => `[${names[i]}]${m === 1 ? '' : `^{${m}}`}`).join('');
  return {
    ok: true,
    rows,
    steps: [
      { key: 'kitChemMat.kin.step.logFit', math: '\\log r=\\log k+m\\log[A]+n\\log[B]' },
      { key: 'kitChemMat.kin.step.rateLaw', math: `r=k${law},\\quad k=${latexNumber(k, 5)}` },
    ],
    notes: [{ key: 'kitChemMat.kin.note.rates' }],
    equation: `r=k${law}`,
  };
}

export interface ArrheniusPoint {
  T: number;
  k: number;
}

/** Two ends of the fitted line of ln k against 1000 / T. */
function fitLine(pts: ArrheniusPoint[], fit: LineFit): [number, number][] {
  const xs = pts.map((p) => 1000 / p.T);
  return [Math.min(...xs), Math.max(...xs)].map((x): [number, number] => [x, fit.intercept + (fit.slope * x) / 1000]);
}

export function arrhenius(text: string, predictT: number): Outcome {
  const table = parseTable(text);
  const bad = dataFailure(table, 2, 2);
  if (bad) return bad;
  const pts: ArrheniusPoint[] = table!.map((r) => ({ T: r[0], k: r[1] }));
  if (pts.some((p) => !(p.T > 0) || !(p.k > 0))) return fail('kitChemMat.kin.err.positive');
  const fit = lineFit(
    pts.map((p) => 1 / p.T),
    pts.map((p) => Math.log(p.k)),
  );
  if (!fit) return fail('kitChemMat.kin.err.distinctT');
  const Ea = -fit.slope * R;
  const A = Math.exp(fit.intercept);
  const rows: Row[] = [
    { key: 'kitChemMat.kin.row.Ea', value: Ea, dim: 'energyMol', digits: 5 },
    { key: 'kitChemMat.kin.row.A', value: A, digits: 5, unit: 'same as k' },
  ];
  if (pts.length > 2) {
    rows.push(
      { key: 'kitChemMat.kin.row.EaErr', value: fit.slopeSe * R, dim: 'energyMol', digits: 3 },
      { key: 'kitChemMat.kin.row.r2', keyVars: { order: 'ln k' }, value: fit.r2, digits: 8 },
    );
  }
  if (Number.isFinite(predictT) && predictT > 0)
    rows.push({
      key: 'kitChemMat.kin.row.kAt',
      value: A * Math.exp(-Ea / (R * predictT)),
      digits: 5,
      unit: 'same as k',
    });
  const plot: PlotData = {
    xLabel: 'kitChemMat.kin.plot.invT',
    yLabel: 'kitChemMat.kin.plot.lnk',
    series: [
      {
        label: 'kitChemMat.kin.plot.data',
        style: 'dots',
        points: pts.map((p): [number, number] => [1000 / p.T, Math.log(p.k)]),
      },
      { label: 'kitChemMat.kin.plot.line', points: fitLine(pts, fit) },
    ],
    alt: 'kitChemMat.kin.plot.arrAlt',
  };
  return {
    ok: true,
    rows,
    steps: [
      {
        key: 'kitChemMat.kin.step.arrhenius',
        math: 'k=Ae^{-E_a/RT}\\ \\Rightarrow\\ \\ln k=\\ln A-\\frac{E_a}{R}\\frac{1}{T}',
      },
      {
        key: 'kitChemMat.kin.step.arrSlope',
        math: `E_a=-R\\times\\text{slope}=${plain(Ea / 1000, 6)}\\ \\mathrm{kJ/mol}`,
      },
    ],
    notes: [{ key: 'kitChemMat.kin.note.arrhenius' }],
    equation: 'k=Ae^{-E_a/RT}',
    plot,
  };
}

export interface GlobalInput {
  A: number;
  /** Activation energy, J/mol. */
  Ea: number;
  T: number;
  cF: number;
  a: number;
  cO: number;
  b: number;
}

/** A one-step global rate, as used for combustion: rate = A exp(-Ea / RT) [F]^a [O]^b. */
export function globalRate(input: GlobalInput): Outcome {
  const { A, Ea, T, cF, a, cO, b } = input;
  if (!(A > 0) || !(T > 0) || !(cF >= 0) || !(cO >= 0)) return fail('kitChemMat.kin.err.global');
  if (!Number.isFinite(Ea + a + b)) return fail('kitChemMat.kin.err.global');
  const k = A * Math.exp(-Ea / (R * T));
  const rate = k * Math.pow(cF, a) * Math.pow(cO, b);
  return {
    ok: true,
    rows: [
      { key: 'kitChemMat.kin.row.k', value: k, digits: 5, unit: 'same as A' },
      { key: 'kitChemMat.kin.row.rate', value: rate, digits: 5, unit: 'mol/(L s)' },
    ],
    steps: [
      { key: 'kitChemMat.kin.step.global', math: 'r=A\\,e^{-E_a/RT}[F]^{a}[O]^{b}' },
      { key: 'kitChemMat.kin.step.globalNumbers', math: `k=${latexNumber(k, 5)},\\quad r=${latexNumber(rate, 5)}` },
    ],
    notes: [{ key: 'kitChemMat.kin.note.global' }],
    equation: 'r=A\\,e^{-E_a/RT}[F]^{a}[O]^{b}',
  };
}
