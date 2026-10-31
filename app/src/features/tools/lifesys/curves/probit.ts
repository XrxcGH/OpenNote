// Probit LD50 by maximum likelihood with a Fieller interval, after Finney, and linear-quadratic cell survival.
import { LsError, positive, whole } from '../num/errors';
import { lineFit } from '../num/fit';
import { solveLinear } from '../num/linalg';
import { normalCdf } from '../num/special';
import type { CalcResult, PlotData, ResultRow } from '../types';
import { type Point, type Rows, columns } from './shared';

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
