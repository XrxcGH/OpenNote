// Fitting the SIR model's transmission rate β and recovery rate γ to case counts by Levenberg-Marquardt least
// squares. The counts are either people infectious at each time (prevalence) or people ever infected (cumulative,
// N − S). Each trial (β, γ) is solved as ODEs and compared with the data; the fit gives standard errors, 95%
// intervals, R0 = β / γ, and the final size that R0 implies.
import { levenberg } from '../num/fit';
import { LsError, positive } from '../num/errors';
import { dopri } from '../num/ode';
import type { CalcResult, ResultRow, Step } from '../types';
import { finalSize } from './compartment';

type Point = [number, number];
export type CaseKind = 'prevalence' | 'cumulative';

/** SIR counts at each time in `times` (sorted, from 0), as prevalence I(t) or cumulative N − S(t). */
export function sirCurve(
  n: number,
  i0: number,
  beta: number,
  gamma: number,
  times: readonly number[],
  kind: CaseKind,
): number[] {
  const rhs = (_: number, [s, i]: readonly number[]) => {
    const force = (beta * s * i) / n;
    return [-force, force - gamma * i];
  };
  // Solved from one time to the next, so each count is an end point of the solver, not an interpolation.
  const out: number[] = [];
  let y = [n - i0, i0];
  let at = 0;
  for (const t of times) {
    if (t > at) {
      const sol = dopri(rhs, y, at, t, { rtol: 1e-10, atol: 1e-10, maxStep: (t - at) / 20 });
      y = sol.y[sol.y.length - 1];
      at = t;
    }
    out.push(kind === 'prevalence' ? y[1] : n - y[0]);
  }
  return out;
}

function safeCurve(n: number, i0: number, beta: number, gamma: number, times: readonly number[], kind: CaseKind) {
  try {
    return sirCurve(n, i0, beta, gamma, times, kind);
  } catch {
    return times.map(() => Number.NaN);
  }
}

export interface EpiFitInput {
  n: number;
  i0: number;
  kind: CaseKind;
  /** Rows of (time, count). */
  data: readonly (readonly number[])[];
  beta0: number;
  gamma0: number;
}

export function epiFitResult(input: EpiFitInput): CalcResult {
  const { n, i0, kind } = input;
  positive(n, 'N');
  positive(i0, 'I₀');
  if (!(i0 < n)) throw new LsError('networks.e.i0');
  positive(input.beta0, 'β');
  positive(input.gamma0, 'γ');
  const rows = input.data.filter((row) => row.length >= 2);
  if (rows.length < 3) throw new LsError('errors.points', { min: 3 });
  const times = rows.map((row) => row[0]);
  const counts = rows.map((row) => row[1]);
  for (let i = 0; i < times.length; i += 1) {
    if (!(times[i] >= 0)) throw new LsError('networks.e.fitTime');
    if (i > 0 && !(times[i] > times[i - 1])) throw new LsError('networks.e.fitOrder');
    if (!(counts[i] >= 0) || counts[i] > n) throw new LsError('networks.e.fitCount', { n });
  }
  // The model is solved once per trial and read at every time; a rate at or below 0 is rejected as a bad step.
  let cacheKey = '';
  let cache: number[] = [];
  const curve = (p: readonly number[]) => {
    const key = `${p[0]},${p[1]}`;
    if (key !== cacheKey) {
      cacheKey = key;
      cache = p[0] > 0 && p[1] > 0 ? safeCurve(n, i0, p[0], p[1], times, kind) : times.map(() => Number.NaN);
    }
    return cache;
  };
  const xs = times.map((_, i) => [i]);
  const fit = levenberg((x, p) => curve(p)[x[0]], xs, counts, [input.beta0, input.gamma0]);
  const [beta, gamma] = fit.params;
  if (!(beta > 0 && gamma > 0)) throw new LsError('errors.converge');
  const [seBeta, seGamma] = fit.se;
  const ci = (value: number, half: number) =>
    Number.isFinite(half) ? `${(value - half).toPrecision(4)} – ${(value + half).toPrecision(4)}` : '—';
  const r0 = beta / gamma;
  const z = finalSize(r0);
  const resultRows: ResultRow[] = [
    { label: 'networks.r.beta', value: beta },
    { label: 'networks.r.betaCi', value: ci(beta, fit.ci95[0]) },
    { label: 'networks.r.gamma', value: gamma },
    { label: 'networks.r.gammaCi', value: ci(gamma, fit.ci95[1]) },
    { label: 'networks.r.infectious', value: 1 / gamma },
    { label: 'networks.r.r0', value: r0 },
    { label: 'networks.r.finalSize', value: 100 * z, unit: '%' },
    { label: 'networks.r.rmse', value: Math.sqrt(fit.sse / rows.length) },
  ];
  const steps: Step[] = [
    { key: `networks.s.fit.${kind}`, vars: { n: rows.length, N: n, i: i0 } },
    {
      key: 'networks.s.fitResult',
      vars: { b: beta, sb: seBeta, g: gamma, sg: seGamma, it: fit.iterations, sse: fit.sse },
    },
    { key: 'networks.s.fitR0', vars: { b: beta, g: gamma, r: r0, d: 1 / gamma, z: 100 * z } },
  ];
  const end = times[times.length - 1];
  const smooth = Array.from({ length: 121 }, (_, i) => (end * i) / 120);
  const fitted = sirCurve(n, i0, beta, gamma, smooth, kind);
  return {
    rows: resultRows,
    steps,
    latex: '\\frac{dS}{dt} = -\\frac{\\beta S I}{N},\\quad \\frac{dI}{dt} = \\frac{\\beta S I}{N} - \\gamma I',
    notes: [{ key: 'networks.n.fit' }],
    plots: [
      {
        title: 'networks.p.fit',
        x: { label: 'networks.p.time', min: 0 },
        y: { label: `networks.p.${kind}`, min: 0 },
        series: [
          { name: 'networks.p.observed', style: 'points', points: rows.map((row) => [row[0], row[1]] as Point) },
          { name: 'networks.p.fitted', points: smooth.map((t, i) => [t, fitted[i]] as Point) },
        ],
      },
    ],
  };
}
