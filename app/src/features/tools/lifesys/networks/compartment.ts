// Compartment models of infection (SI, SIS, SIR, SEIR, and SIRS) with births, deaths, and vaccination, solved as
// ODEs. They give R0, the effective reproduction number, the SIR final size, the herd-immunity threshold, and the
// peak. The Reed-Frost chain binomial is here too, as its expected course and as seeded stochastic runs.
import { LsError, nonNegative, positive, whole, within } from '../num/errors';
import { dopri } from '../num/ode';
import { createRng } from '../num/rng';
import { brent } from '../num/roots';
import type { CalcResult, ResultRow, Step } from '../types';

type Point = [number, number];
export type Compartment = 'si' | 'sis' | 'sir' | 'seir' | 'sirs';

/** The SIR final size: the root z in (0, 1) of z = 1 − e^(−R0 z), or 0 when R0 ≤ 1. */
export function finalSize(r0: number): number {
  if (r0 <= 1) return 0;
  return brent((z) => z - (1 - Math.exp(-r0 * z)), 1e-9, 1);
}

export const herdImmunity = (r0: number): number => (r0 > 1 ? 1 - 1 / r0 : 0);

export interface EpiParams {
  model: Compartment;
  n: number;
  i0: number;
  beta: number;
  gamma: number;
  /** 1 / latent period (SEIR). */
  sigma: number;
  /** Waning rate of immunity (SIRS). */
  omega: number;
  /** Birth and death rate per person (births balance deaths, so N stays fixed). */
  mu: number;
  /** Fraction vaccinated at the start and at birth. */
  vacc: number;
  t: number;
}

/** R0 for each model, counting deaths as a way out of the infectious and latent states. */
export function basicR0(p: EpiParams): number {
  if (p.model === 'si') return Infinity;
  const out = p.gamma + p.mu;
  if (p.model === 'seir') return (p.beta * p.sigma) / ((p.sigma + p.mu) * out);
  return p.beta / out;
}

export function simulateEpi(p: EpiParams) {
  const v0 = p.vacc * (p.n - p.i0);
  const s0 = p.n - p.i0 - v0;
  const latent = p.model === 'seir';
  const recovers = p.model !== 'si';
  const immune = p.model === 'sir' || p.model === 'seir' || p.model === 'sirs';
  const sol = dopri(
    (_, [S, E, I, R]) => {
      const force = (p.beta * S * I) / p.n;
      const births = p.mu * p.n;
      const dS =
        births * (1 - p.vacc) -
        force -
        p.mu * S +
        (immune ? p.omega * R : 0) +
        (immune ? 0 : recovers ? p.gamma * I : 0);
      const dE = latent ? force - (p.sigma + p.mu) * E : 0;
      const dI = (latent ? p.sigma * E : force) - (recovers ? p.gamma : 0) * I - p.mu * I;
      const dR = births * p.vacc + (immune ? p.gamma * I : 0) - (immune ? p.omega * R : 0) - p.mu * R;
      return [dS, dE, dI, dR];
    },
    [s0, 0, p.i0, v0],
    0,
    p.t,
    { maxStep: p.t / 400 },
  );
  return sol;
}

export function epidemicResult(p: EpiParams): CalcResult {
  positive(p.n, 'N');
  positive(p.i0, 'I₀');
  if (!(p.i0 < p.n)) throw new LsError('networks.e.i0');
  positive(p.beta, 'β');
  if (p.model !== 'si') positive(p.gamma, 'γ');
  if (p.model === 'seir') positive(p.sigma, 'σ');
  nonNegative(p.omega, 'ω');
  nonNegative(p.mu, 'μ');
  within(p.vacc, 'p', 0, 1);
  positive(p.t, 't');
  const sol = simulateEpi(p);
  const r0 = basicR0(p);
  const I = sol.y.map((y) => y[2]);
  const peak = I.indexOf(Math.max(...I));
  const last = sol.y[sol.y.length - 1];
  const rEnd = Number.isFinite(r0) ? (r0 * last[0]) / p.n : Infinity;
  const rows: ResultRow[] = [];
  const steps: Step[] = [];
  if (Number.isFinite(r0)) {
    rows.push(
      { label: 'networks.r.r0', value: r0 },
      { label: 'networks.r.hit', value: 100 * herdImmunity(r0), unit: '%' },
    );
    steps.push({
      key: `networks.s.r0.${p.model as Exclude<Compartment, 'si'>}`,
      vars: { b: p.beta, g: p.gamma, s: p.sigma, m: p.mu, r: r0 },
    });
    steps.push({ key: 'networks.s.hit', vars: { r: r0, h: 100 * herdImmunity(r0) } });
  } else steps.push({ key: 'networks.s.si' });
  rows.push(
    { label: 'networks.r.peakI', value: I[peak] },
    { label: 'networks.r.peakTime', value: sol.t[peak] },
    { label: 'networks.r.rEnd', vars: { t: p.t }, value: Number.isFinite(rEnd) ? rEnd : '—' },
  );
  steps.push({ key: 'networks.s.peak', vars: { i: I[peak], t: sol.t[peak] } });
  if ((p.model === 'sir' || p.model === 'seir') && p.mu === 0 && p.omega === 0) {
    const reff = r0 * (1 - p.vacc);
    const z = finalSize(reff);
    rows.push({ label: 'networks.r.finalSize', value: 100 * z, unit: '%' });
    steps.push({ key: 'networks.s.finalSize', vars: { r: reff, z: 100 * z }, math: 'z = 1 - e^{-R_0 z}' });
  }
  const names = ['networks.p.S', 'networks.p.E', 'networks.p.I', 'networks.p.R'] as const;
  const styles = ['line', 'dashed', 'line', 'outline'] as const;
  const shown = p.model === 'seir' ? [0, 1, 2, 3] : p.model === 'si' || p.model === 'sis' ? [0, 2] : [0, 2, 3];
  return {
    rows,
    steps,
    latex: latexFor(p.model),
    notes: [{ key: 'networks.n.compartment' }],
    plots: [
      {
        title: 'networks.p.epidemic',
        x: { label: 'networks.p.time' },
        y: { label: 'networks.p.people', min: 0 },
        series: shown.map((k) => ({
          name: names[k],
          style: styles[k],
          points: sol.t.map((t, i) => [t, sol.y[i][k]] as Point),
        })),
      },
    ],
  };
}

function latexFor(model: Compartment): string {
  if (model === 'seir')
    return '\\dot S = -\\beta S I/N,\\ \\dot E = \\beta S I/N - \\sigma E,\\ \\dot I = \\sigma E - \\gamma I,\\ \\dot R = \\gamma I';
  if (model === 'si') return '\\dot S = -\\beta S I/N,\\ \\dot I = \\beta S I/N';
  if (model === 'sis') return '\\dot S = -\\beta S I/N + \\gamma I,\\ \\dot I = \\beta S I/N - \\gamma I';
  return '\\dot S = -\\beta S I/N,\\ \\dot I = \\beta S I/N - \\gamma I,\\ \\dot R = \\gamma I';
}

export function r0Result(r0: number, efficacy: number | null): CalcResult {
  positive(r0, 'R₀');
  const z = finalSize(r0);
  const hit = herdImmunity(r0);
  const rows: ResultRow[] = [
    { label: 'networks.r.finalSize', value: 100 * z, unit: '%' },
    { label: 'networks.r.hit', value: 100 * hit, unit: '%' },
  ];
  const steps: Step[] = [
    { key: 'networks.s.finalSize', vars: { r: r0, z: 100 * z }, math: 'z = 1 - e^{-R_0 z}' },
    { key: 'networks.s.hit', vars: { r: r0, h: 100 * hit }, math: 'p_c = 1 - 1/R_0' },
  ];
  if (efficacy !== null) {
    within(efficacy, 'efficacy', 0, 100);
    const coverage = hit / (efficacy / 100);
    rows.push({
      label: 'networks.r.coverage',
      vars: { e: efficacy },
      value: coverage <= 1 ? 100 * coverage : '—',
      unit: coverage <= 1 ? '%' : '',
    });
    steps.push({
      key: coverage <= 1 ? 'networks.s.coverage' : 'networks.s.noCoverage',
      vars: { h: 100 * hit, e: efficacy, c: 100 * coverage },
    });
  }
  const grid = Array.from({ length: 101 }, (_, i) => 0.5 + (4.5 * i) / 100);
  return {
    rows,
    steps,
    latex: 'z = 1 - e^{-R_0 z}',
    plots: [
      {
        title: 'networks.p.finalSize',
        x: { label: 'networks.p.r0' },
        y: { label: 'networks.p.share', min: 0, max: 100 },
        series: [
          { name: 'networks.p.final', points: grid.map((r) => [r, 100 * finalSize(r)] as Point) },
          {
            name: 'networks.p.threshold',
            style: 'dashed',
            points: grid.map((r) => [r, 100 * herdImmunity(r)] as Point),
          },
        ],
      },
    ],
  };
}

/** The expected Reed-Frost course: C_{t+1} = S_t (1 − (1 − p)^{I_t}), with cases infectious for one generation. */
export function reedFrostExpected(n: number, i0: number, p: number, generations: number) {
  let s = n - i0;
  let i = i0;
  const out: { s: number; i: number }[] = [{ s, i }];
  for (let g = 0; g < generations; g += 1) {
    const c = s * (1 - (1 - p) ** i);
    s -= c;
    i = c;
    out.push({ s, i });
  }
  return out;
}

export function reedFrostResult(
  n: number,
  i0: number,
  p: number,
  generations: number,
  runs: number,
  seed: number,
): CalcResult {
  whole(n, 'N', 2);
  whole(i0, 'I₀', 1);
  if (!(i0 < n)) throw new LsError('networks.e.i0');
  within(p, 'p', 0, 1);
  whole(generations, 'g', 1);
  within(generations, 'g', 1, 200);
  whole(runs, 'runs', 1);
  within(runs, 'runs', 1, 5000);
  const expected = reedFrostExpected(n, i0, p, generations);
  const rng = createRng(seed);
  const sizes: number[] = new Array(n - i0 + 1).fill(0);
  for (let r = 0; r < runs; r += 1) {
    let s = n - i0;
    let i = i0;
    for (let g = 0; g < generations && i > 0; g += 1) {
      const q = 1 - (1 - p) ** i;
      let c = 0;
      for (let k = 0; k < s; k += 1) if (rng.next() < q) c += 1;
      s -= c;
      i = c;
    }
    sizes[n - i0 - s] += 1;
  }
  const meanSize = sizes.reduce((sum, count, k) => sum + k * count, 0) / runs;
  const minor = sizes.slice(0, Math.max(1, Math.round(0.1 * (n - i0)))).reduce((a, b) => a + b, 0) / runs;
  const final = n - i0 - expected[expected.length - 1].s;
  return {
    rows: [
      { label: 'networks.r.expectedFinal', value: final },
      { label: 'networks.r.meanFinal', vars: { runs }, value: meanSize },
      { label: 'networks.r.minor', value: 100 * minor, unit: '%' },
      { label: 'networks.r.seed', value: seed },
    ],
    steps: [
      { key: 'networks.s.reedFrost', vars: { p, n }, math: 'C_{t+1} = S_t\\left(1 - (1 - p)^{I_t}\\right)' },
      { key: 'networks.s.reedFrostExpected', vars: { g: generations, f: final } },
      { key: 'networks.s.reedFrostRuns', vars: { runs, seed, m: meanSize, minor: 100 * minor } },
    ],
    latex: 'C_{t+1} = S_t\\left(1 - (1 - p)^{I_t}\\right)',
    notes: [{ key: 'networks.n.reedFrost' }],
    plots: [
      {
        title: 'networks.p.reedFrost',
        x: { label: 'networks.p.generation' },
        y: { label: 'networks.p.cases', min: 0 },
        series: [{ name: 'networks.p.expected', style: 'bars', points: expected.map((e, g) => [g, e.i] as Point) }],
      },
      {
        title: 'networks.p.finalSizes',
        x: { label: 'networks.p.totalCases' },
        y: { label: 'networks.p.runs', min: 0 },
        series: [{ name: 'networks.p.runsSeries', style: 'bars', points: sizes.map((c, k) => [k, c] as Point) }],
      },
    ],
  };
}
