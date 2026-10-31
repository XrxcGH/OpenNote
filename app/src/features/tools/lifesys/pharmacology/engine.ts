// Pharmacokinetics for coursework: one-compartment models (IV bolus, infusion, and oral by the Bateman function).
// It also covers multiple dosing, 2-compartment models, non-compartmental analysis, Michaelis-Menten elimination,
// and dose scaling; release and drug response are in response.ts. Doses in mg, concentrations in mg/L, volumes in
// L, and time in h. No dosing advice is given: every result is a textbook calculation.
import { LsError, nonNegative, positive, whole, within } from '../num/errors';
import { levenberg, lineFit } from '../num/fit';
import { dopri } from '../num/ode';
import type { CalcResult, Step } from '../types';
import { type Point, curve, COURSEWORK } from './shared';

export interface OneCompartment {
  route: 'bolus' | 'infusion' | 'oral';
  dose: number;
  V: number;
  k: number;
  ka: number;
  F: number;
  /** Infusion duration (h). */
  tinf: number;
  t: number;
}

/** Concentration at time t for an IV bolus, a constant infusion over tinf, or a first-order oral dose. */
export function concentration(p: OneCompartment, t: number): number {
  if (t < 0) return 0;
  if (p.route === 'bolus') return (p.dose / p.V) * Math.exp(-p.k * t);
  if (p.route === 'infusion') {
    const rate = p.dose / p.tinf;
    const atEnd = (rate / (p.k * p.V)) * (1 - Math.exp(-p.k * Math.min(t, p.tinf)));
    return t <= p.tinf ? atEnd : atEnd * Math.exp(-p.k * (t - p.tinf));
  }
  // ka = k is the limit of the Bateman function: F D k t e^(−kt) / V.
  if (Math.abs(p.ka - p.k) < 1e-12 * p.k) return ((p.F * p.dose) / p.V) * p.k * t * Math.exp(-p.k * t);
  return ((p.F * p.dose * p.ka) / (p.V * (p.ka - p.k))) * (Math.exp(-p.k * t) - Math.exp(-p.ka * t));
}

/** tmax = ln(ka/k)/(ka − k) and Cmax for an oral dose. */
export function oralPeak(p: OneCompartment): { tmax: number; cmax: number } {
  const tmax = Math.abs(p.ka - p.k) < 1e-12 * p.k ? 1 / p.k : Math.log(p.ka / p.k) / (p.ka - p.k);
  return { tmax, cmax: concentration(p, tmax) };
}

export function oneCompartmentResult(p: OneCompartment): CalcResult {
  positive(p.dose, 'D');
  positive(p.V, 'V');
  positive(p.k, 'k');
  positive(p.t, 't');
  const half = Math.LN2 / p.k;
  const CL = p.k * p.V;
  const C = concentration(p, p.t);
  const rows: CalcResult['rows'] = [
    { label: 'pharmacology.r.conc', vars: { t: p.t }, value: C, unit: 'mg/L' },
    { label: 'pharmacology.r.half', value: half, unit: 'h' },
    { label: 'pharmacology.r.CL', value: CL, unit: 'L/h' },
  ];
  const steps: Step[] = [
    {
      key: 'pharmacology.s.derived',
      vars: { k: p.k, V: p.V, h: half, CL },
      math: 't_{1/2} = \\frac{\\ln 2}{k},\\quad CL = kV',
    },
  ];
  let latex = 'C(t) = \\frac{D}{V} e^{-kt}';
  if (p.route === 'bolus') {
    rows.push(
      { label: 'pharmacology.r.c0', value: p.dose / p.V, unit: 'mg/L' },
      { label: 'pharmacology.r.auc', value: p.dose / CL, unit: 'mg·h/L' },
    );
    steps.push({
      key: 'pharmacology.s.bolus',
      vars: { D: p.dose, V: p.V, k: p.k, t: p.t, C, auc: p.dose / CL },
      math: latex,
    });
  } else if (p.route === 'infusion') {
    positive(p.tinf, 'T');
    const R = p.dose / p.tinf;
    const css = R / CL;
    rows.push(
      { label: 'pharmacology.r.css', value: css, unit: 'mg/L' },
      { label: 'pharmacology.r.endInfusion', value: concentration(p, p.tinf), unit: 'mg/L' },
      { label: 'pharmacology.r.auc', value: p.dose / CL, unit: 'mg·h/L' },
    );
    latex = 'C(t) = \\frac{R_0}{CL}\\left(1 - e^{-kt}\\right)';
    steps.push({ key: 'pharmacology.s.infusion', vars: { D: p.dose, T: p.tinf, R, CL, css }, math: latex });
    steps.push({ key: 'pharmacology.s.infusionAt', vars: { t: p.t, C } });
  } else {
    positive(p.ka, 'ka');
    positive(within(p.F, 'F', 0, 1), 'F');
    const { tmax, cmax } = oralPeak(p);
    rows.push(
      { label: 'pharmacology.r.tmax', value: tmax, unit: 'h' },
      { label: 'pharmacology.r.cmax', value: cmax, unit: 'mg/L' },
      { label: 'pharmacology.r.auc', value: (p.F * p.dose) / CL, unit: 'mg·h/L' },
    );
    latex = 'C(t) = \\frac{F D k_a}{V(k_a - k)}\\left(e^{-kt} - e^{-k_a t}\\right)';
    steps.push(
      { key: 'pharmacology.s.oral', vars: { t: p.t, C }, math: latex },
      {
        key: 'pharmacology.s.tmax',
        vars: { ka: p.ka, k: p.k, tmax, cmax },
        math: 't_{max} = \\frac{\\ln(k_a/k)}{k_a - k}',
      },
    );
  }
  const span = Math.max(p.t, 5 * half, p.route === 'infusion' ? p.tinf + 3 * half : 0);
  const points = curve(span, (t) => concentration(p, t));
  return {
    rows,
    steps,
    latex,
    notes: [COURSEWORK],
    plots: [
      {
        title: 'pharmacology.p.conc',
        x: { label: 'pharmacology.p.time' },
        y: { label: 'pharmacology.p.c' },
        series: [{ name: 'pharmacology.p.cSeries', points }],
      },
      {
        title: 'pharmacology.p.concLog',
        x: { label: 'pharmacology.p.time' },
        y: { label: 'pharmacology.p.c', log: true },
        series: [{ name: 'pharmacology.p.cSeries', points: points.filter(([, c]) => c > 0) }],
      },
    ],
  };
}

export interface MultipleDose {
  /** Accumulation factor 1/(1 − e^(−kτ)). */
  R: number;
  CL: number;
  avg: number;
  max: number;
  min: number;
  /** Time of the steady-state peak after each dose (0 for an IV bolus). */
  tmaxSs: number;
  loading: number;
  /** Time to reach 90% of steady state, ln 10 / k. */
  tss90: number;
}

/** Multiple IV bolus doses (ka null) or oral doses every tau: accumulation, steady-state levels, and a loading dose. */
export function multipleDose(
  dose: number,
  tau: number,
  k: number,
  V: number,
  F: number,
  ka: number | null,
): MultipleDose {
  positive(dose, 'D');
  positive(tau, 'τ');
  positive(k, 'k');
  positive(V, 'V');
  positive(within(F, 'F', 0, 1), 'F');
  const R = 1 / (1 - Math.exp(-k * tau));
  const CL = k * V;
  const avg = (F * dose) / (CL * tau);
  let max: number;
  let min: number;
  let tmaxSs = 0;
  if (ka === null) {
    max = ((F * dose) / V) * R;
    min = max * Math.exp(-k * tau);
  } else {
    positive(ka, 'ka');
    if (Math.abs(ka - k) < 1e-9 * k) throw new LsError('pharmacology.e.kaEqualsK');
    // Steady state within an interval: F D ka/(V(ka − k)) [e^(−kt)/(1 − e^(−kτ)) − e^(−ka t)/(1 − e^(−ka τ))].
    const scale = (F * dose * ka) / (V * (ka - k));
    const Ra = 1 / (1 - Math.exp(-ka * tau));
    const css = (t: number) => scale * (Math.exp(-k * t) * R - Math.exp(-ka * t) * Ra);
    tmaxSs = Math.log((ka * Ra) / (k * R)) / (ka - k);
    max = css(tmaxSs);
    min = css(0);
  }
  return { R, CL, avg, max, min, tmaxSs, loading: (avg * V) / F, tss90: Math.log(10) / k };
}

export function multipleDoseResult(
  dose: number,
  tau: number,
  k: number,
  V: number,
  F: number,
  ka: number | null,
  doses: number,
): CalcResult {
  const m = multipleDose(dose, tau, k, V, F, ka);
  whole(doses, 'n', 1);
  if (doses > 60) throw new LsError('errors.range', { name: 'n', low: 1, high: 60 });
  const single: OneCompartment =
    ka === null
      ? { route: 'bolus', dose: F * dose, V, k, ka: 0, F: 1, tinf: 0, t: 0 }
      : { route: 'oral', dose, V, k, ka, F, tinf: 0, t: 0 };
  const level = (t: number) => {
    let total = 0;
    for (let i = 0; i < doses && i * tau <= t; i += 1) total += concentration(single, t - i * tau);
    return total;
  };
  const rows: CalcResult['rows'] = [
    { label: 'pharmacology.r.accumulation', value: m.R },
    { label: 'pharmacology.r.cssAvg', value: m.avg, unit: 'mg/L' },
    { label: 'pharmacology.r.cssMax', value: m.max, unit: 'mg/L' },
    { label: 'pharmacology.r.cssMin', value: m.min, unit: 'mg/L' },
    { label: 'pharmacology.r.loading', value: m.loading, unit: 'mg' },
    { label: 'pharmacology.r.tss', value: m.tss90, unit: 'h' },
  ];
  if (ka !== null) rows.splice(4, 0, { label: 'pharmacology.r.tmaxSs', value: m.tmaxSs, unit: 'h' });
  const latex = '\\bar C_{ss} = \\frac{F D}{CL\\,\\tau}';
  return {
    rows,
    steps: [
      { key: 'pharmacology.s.accumulation', vars: { k, tau, R: m.R }, math: 'R = \\frac{1}{1 - e^{-k\\tau}}' },
      { key: 'pharmacology.s.cssAvg', vars: { F, D: dose, CL: m.CL, tau, c: m.avg }, math: latex },
      ka === null
        ? { key: 'pharmacology.s.peakBolus', vars: { max: m.max, min: m.min } }
        : { key: 'pharmacology.s.peakOral', vars: { t: m.tmaxSs, max: m.max, min: m.min } },
      {
        key: 'pharmacology.s.loading',
        vars: { c: m.avg, V, F, L: m.loading },
        math: 'D_L = \\frac{\\bar C_{ss} V}{F}',
      },
      { key: 'pharmacology.s.tss', vars: { k, t: m.tss90 } },
    ],
    notes: [COURSEWORK],
    latex,
    plots: [
      {
        title: 'pharmacology.p.multiple',
        x: { label: 'pharmacology.p.time' },
        y: { label: 'pharmacology.p.c' },
        series: [
          { name: 'pharmacology.p.cSeries', points: curve(doses * tau, level, Math.min(1200, 60 * doses)) },
          {
            name: 'pharmacology.p.average',
            style: 'dashed',
            points: [
              [0, m.avg],
              [doses * tau, m.avg],
            ],
          },
        ],
      },
    ],
  };
}

/** α and β of a 2-compartment model: the roots of s² − (k10 + k12 + k21) s + k10 k21 = 0. */
export function hybrid(k10: number, k12: number, k21: number): { alpha: number; beta: number } {
  const sum = k10 + k12 + k21;
  const root = Math.sqrt(Math.max(sum * sum - 4 * k10 * k21, 0));
  return { alpha: (sum + root) / 2, beta: (sum - root) / 2 };
}

/** Micro-constants from a fitted biexponential C = A e^(−αt) + B e^(−βt) after an IV bolus. */
export function microFromMacro(A: number, alpha: number, B: number, beta: number) {
  const k21 = (A * beta + B * alpha) / (A + B);
  const k10 = (alpha * beta) / k21;
  return { k21, k10, k12: alpha + beta - k21 - k10 };
}

export function twoCompartmentResult(dose: number, V1: number, k10: number, k12: number, k21: number): CalcResult {
  positive(dose, 'D');
  positive(V1, 'V₁');
  positive(k10, 'k₁₀');
  positive(k12, 'k₁₂');
  positive(k21, 'k₂₁');
  const { alpha, beta } = hybrid(k10, k12, k21);
  const A = ((dose / V1) * (alpha - k21)) / (alpha - beta);
  const B = ((dose / V1) * (k21 - beta)) / (alpha - beta);
  const c = (t: number) => A * Math.exp(-alpha * t) + B * Math.exp(-beta * t);
  const latex = 'C(t) = A e^{-\\alpha t} + B e^{-\\beta t}';
  return {
    rows: [
      { label: 'pharmacology.r.alpha', value: alpha, unit: '/h' },
      { label: 'pharmacology.r.beta', value: beta, unit: '/h' },
      { label: 'pharmacology.r.A', value: A, unit: 'mg/L' },
      { label: 'pharmacology.r.B', value: B, unit: 'mg/L' },
      { label: 'pharmacology.r.halfAlpha', value: Math.LN2 / alpha, unit: 'h' },
      { label: 'pharmacology.r.halfBeta', value: Math.LN2 / beta, unit: 'h' },
      { label: 'pharmacology.r.auc', value: dose / (k10 * V1), unit: 'mg·h/L' },
      { label: 'pharmacology.r.vss', value: V1 * (1 + k12 / k21), unit: 'L' },
    ],
    steps: [
      {
        key: 'pharmacology.s.hybrid',
        vars: { s: k10 + k12 + k21, p: k10 * k21, a: alpha, b: beta },
        math: 's^2 - (k_{10} + k_{12} + k_{21})s + k_{10}k_{21} = 0',
      },
      {
        key: 'pharmacology.s.coefficients',
        vars: { A, B },
        math:
          'A = \\frac{D}{V_1}\\frac{\\alpha - k_{21}}{\\alpha - \\beta},' +
          '\\quad B = \\frac{D}{V_1}\\frac{k_{21} - \\beta}{\\alpha - \\beta}',
      },
      { key: 'pharmacology.s.vss', vars: { V: V1, k12, k21, vss: V1 * (1 + k12 / k21) } },
    ],
    notes: [COURSEWORK],
    latex,
    plots: [
      {
        title: 'pharmacology.p.twoCompartment',
        x: { label: 'pharmacology.p.time' },
        y: { label: 'pharmacology.p.c', log: true },
        series: [{ name: 'pharmacology.p.cSeries', points: curve(6 * (Math.LN2 / beta), c) }],
      },
    ],
  };
}

/** Fits A e^(−αt) + B e^(−βt) to IV bolus data and derives the micro-constants. */
export function biexponentialResult(rows: readonly (readonly number[])[], dose: number | null): CalcResult {
  const data = rows.filter(([t, c]) => t > 0 && c > 0);
  if (data.length < 5) throw new LsError('errors.points', { min: 5 });
  // Starting values by curve stripping: the later half gives β and B, the residual gives α and A.
  const half = Math.floor(data.length / 2);
  const late = lineFit(
    data.slice(half).map((r) => r[0]),
    data.slice(half).map((r) => Math.log(r[1])),
  );
  const b0 = Math.max(-late.slope, 1e-6);
  const B0 = Math.exp(late.intercept);
  const early = data
    .slice(0, half)
    .map(([t, c]) => [t, c - B0 * Math.exp(-b0 * t)])
    .filter(([, r]) => r > 0);
  const strip =
    early.length >= 2
      ? lineFit(
          early.map((r) => r[0]),
          early.map((r) => Math.log(r[1])),
        )
      : { slope: -5 * b0, intercept: Math.log(B0) };
  const p0 = [Math.exp(strip.intercept), Math.max(-strip.slope, 2 * b0), B0, b0];
  const fit = levenberg(
    ([t], [A, a, B, b]) => A * Math.exp(-a * t) + B * Math.exp(-b * t),
    data.map((r) => [r[0]]),
    data.map((r) => r[1]),
    p0,
  );
  let [A, alpha, B, beta] = fit.params;
  if (alpha < beta) [A, alpha, B, beta] = [B, beta, A, alpha];
  if (!(alpha > 0 && beta > 0 && A > 0 && B > 0)) throw new LsError('pharmacology.e.biexponential');
  const micro = microFromMacro(A, alpha, B, beta);
  const out: CalcResult['rows'] = [
    { label: 'pharmacology.r.A', value: A, unit: 'mg/L' },
    { label: 'pharmacology.r.alpha', value: alpha, unit: '/h' },
    { label: 'pharmacology.r.B', value: B, unit: 'mg/L' },
    { label: 'pharmacology.r.beta', value: beta, unit: '/h' },
    { label: 'pharmacology.r.k10', value: micro.k10, unit: '/h' },
    { label: 'pharmacology.r.k12', value: micro.k12, unit: '/h' },
    { label: 'pharmacology.r.k21', value: micro.k21, unit: '/h' },
  ];
  if (dose !== null) out.push({ label: 'pharmacology.r.V1', value: positive(dose, 'D') / (A + B), unit: 'L' });
  const tEnd = Math.max(...data.map((r) => r[0]));
  const latex = 'C(t) = A e^{-\\alpha t} + B e^{-\\beta t}';
  return {
    rows: out,
    steps: [
      { key: 'pharmacology.s.strip', vars: { b: b0, B: B0 } },
      { key: 'pharmacology.s.biFit', vars: { n: data.length, sse: fit.sse }, math: latex },
      {
        key: 'pharmacology.s.micro',
        vars: { k21: micro.k21, k10: micro.k10, k12: micro.k12 },
        math: 'k_{21} = \\frac{A\\beta + B\\alpha}{A + B},\\quad k_{10} = \\frac{\\alpha\\beta}{k_{21}}',
      },
    ],
    notes: [COURSEWORK],
    latex,
    table: {
      header: [{ key: 'pharmacology.t.parameter' }, { key: 'pharmacology.t.estimate' }, { key: 'pharmacology.t.se' }],
      rows: ['A', 'α', 'B', 'β'].map((name, i) => [name, fit.params[i], fit.se[i]]),
    },
    plots: [
      {
        title: 'pharmacology.p.fit',
        x: { label: 'pharmacology.p.time' },
        y: { label: 'pharmacology.p.c', log: true },
        series: [
          { name: 'pharmacology.p.data', points: data.map((r) => [r[0], r[1]] as Point), style: 'points' },
          {
            name: 'pharmacology.p.model',
            points: curve(tEnd, (t) => A * Math.exp(-alpha * t) + B * Math.exp(-beta * t)).slice(1),
          },
        ],
      },
    ],
  };
}

export interface Nca {
  auc: number;
  aumc: number;
  lambdaZ: number;
  aucInf: number;
  aumcInf: number;
  mrt: number;
  half: number;
  cmax: number;
  tmax: number;
}

/** Non-compartmental analysis with linear or linear-up log-down trapezoids and λz from the last `terminal` points. */
export function nca(
  times: readonly number[],
  conc: readonly number[],
  terminal: number,
  method: 'linear' | 'logDown',
): Nca {
  if (times.length < 3) throw new LsError('errors.points', { min: 3 });
  times.forEach((t) => nonNegative(t, 't'));
  for (let i = 1; i < times.length; i += 1) if (!(times[i] > times[i - 1])) throw new LsError('pharmacology.e.times');
  conc.forEach((c) => nonNegative(c, 'C'));
  whole(terminal, 'n', 2);
  if (terminal > times.length) throw new LsError('pharmacology.e.terminal', { n: times.length });
  let auc = 0;
  let aumc = 0;
  for (let i = 1; i < times.length; i += 1) {
    const dt = times[i] - times[i - 1];
    const [c0, c1] = [conc[i - 1], conc[i]];
    if (method === 'logDown' && c1 < c0 && c1 > 0) {
      const k = Math.log(c0 / c1) / dt;
      auc += (c0 - c1) / k;
      aumc += (times[i - 1] * c0 - times[i] * c1) / k + (c0 - c1) / (k * k);
    } else {
      auc += (dt * (c0 + c1)) / 2;
      aumc += (dt * (times[i - 1] * c0 + times[i] * c1)) / 2;
    }
  }
  const tail = times.slice(-terminal);
  const cTail = conc.slice(-terminal);
  if (cTail.some((c) => !(c > 0))) throw new LsError('pharmacology.e.terminalZero');
  const fit = lineFit(tail, cTail.map(Math.log));
  const lambdaZ = -fit.slope;
  if (!(lambdaZ > 0)) throw new LsError('pharmacology.e.lambdaZ');
  const cLast = conc[conc.length - 1];
  const tLast = times[times.length - 1];
  const aucInf = auc + cLast / lambdaZ;
  const aumcInf = aumc + (cLast * tLast) / lambdaZ + cLast / (lambdaZ * lambdaZ);
  const peak = conc.indexOf(Math.max(...conc));
  return {
    auc,
    aumc,
    lambdaZ,
    aucInf,
    aumcInf,
    mrt: aumcInf / aucInf,
    half: Math.LN2 / lambdaZ,
    cmax: conc[peak],
    tmax: times[peak],
  };
}

export function ncaResult(
  rows: readonly (readonly number[])[],
  terminal: number,
  method: 'linear' | 'logDown',
  dose: number | null,
  route: 'iv' | 'extravascular',
): CalcResult {
  if (rows.some((r) => r.length < 2)) throw new LsError('pharmacology.e.columns');
  const times = rows.map((r) => r[0]);
  const conc = rows.map((r) => r[1]);
  const r = nca(times, conc, terminal, method);
  const out: CalcResult['rows'] = [
    { label: 'pharmacology.r.aucLast', value: r.auc, unit: 'mg·h/L' },
    { label: 'pharmacology.r.lambdaZ', value: r.lambdaZ, unit: '/h' },
    { label: 'pharmacology.r.aucInf', value: r.aucInf, unit: 'mg·h/L' },
    { label: 'pharmacology.r.extrapolated', value: (100 * (r.aucInf - r.auc)) / r.aucInf, unit: '%' },
    { label: 'pharmacology.r.aumcInf', value: r.aumcInf, unit: 'mg·h²/L' },
    { label: 'pharmacology.r.half', value: r.half, unit: 'h' },
    { label: 'pharmacology.r.mrt', value: r.mrt, unit: 'h' },
    { label: 'pharmacology.r.cmax', value: r.cmax, unit: 'mg/L' },
    { label: 'pharmacology.r.tmax', value: r.tmax, unit: 'h' },
  ];
  const latex = 'AUC_{0-\\infty} = AUC_{0-t} + \\frac{C_{last}}{\\lambda_z}';
  const steps: Step[] = [
    { key: method === 'linear' ? 'pharmacology.s.trapezoid' : 'pharmacology.s.logDown', vars: { auc: r.auc } },
    { key: 'pharmacology.s.lambdaZ', vars: { n: terminal, l: r.lambdaZ, h: r.half } },
    {
      key: 'pharmacology.s.aucInf',
      vars: { auc: r.auc, c: conc[conc.length - 1], l: r.lambdaZ, inf: r.aucInf },
      math: latex,
    },
    {
      key: 'pharmacology.s.mrt',
      vars: { aumc: r.aumcInf, auc: r.aucInf, mrt: r.mrt },
      math: 'MRT = \\frac{AUMC_{0-\\infty}}{AUC_{0-\\infty}}',
    },
  ];
  const notes: Step[] = [COURSEWORK];
  if (r.aucInf - r.auc > 0.2 * r.aucInf) notes.unshift({ key: 'pharmacology.n.extrapolated' });
  if (dose !== null) {
    const CL = positive(dose, 'D') / r.aucInf;
    const iv = route === 'iv';
    out.push(
      { label: iv ? 'pharmacology.r.CL' : 'pharmacology.r.CLF', value: CL, unit: 'L/h' },
      { label: iv ? 'pharmacology.r.Vz' : 'pharmacology.r.VzF', value: CL / r.lambdaZ, unit: 'L' },
    );
    if (iv) out.push({ label: 'pharmacology.r.vss', value: CL * r.mrt, unit: 'L' });
    steps.push({
      key: 'pharmacology.s.clearance',
      vars: { D: dose, auc: r.aucInf, CL, l: r.lambdaZ, V: CL / r.lambdaZ },
    });
  }
  const points = rows.map((row) => [row[0], row[1]] as Point);
  const tail = lineFit(times.slice(-terminal), conc.slice(-terminal).map(Math.log));
  return {
    rows: out,
    steps,
    notes,
    latex,
    plots: [
      {
        title: 'pharmacology.p.nca',
        x: { label: 'pharmacology.p.time' },
        y: { label: 'pharmacology.p.c' },
        series: [{ name: 'pharmacology.p.data', points }],
      },
      {
        title: 'pharmacology.p.ncaLog',
        x: { label: 'pharmacology.p.time' },
        y: { label: 'pharmacology.p.c', log: true },
        series: [
          { name: 'pharmacology.p.data', points: points.filter(([, c]) => c > 0), style: 'points' },
          {
            name: 'pharmacology.p.terminal',
            style: 'dashed',
            points: times.slice(-terminal).map((t) => [t, Math.exp(tail.intercept + tail.slope * t)] as Point),
          },
        ],
      },
    ],
  };
}

/** Time for Michaelis-Menten elimination to bring C0 down to C1: (Km ln(C0/C1) + C0 − C1) / Vmax. */
export const mmTime = (c0: number, c1: number, vmax: number, km: number): number =>
  (km * Math.log(c0 / c1) + c0 - c1) / vmax;

export function michaelisResult(c0: number, vmax: number, km: number, c1: number | null, t: number): CalcResult {
  positive(c0, 'C₀');
  positive(vmax, 'Vmax');
  positive(km, 'Km');
  positive(t, 't');
  const sol = dopri((_, [c]) => [(-vmax * Math.max(c, 0)) / (km + Math.max(c, 0))], [c0], 0, t, { maxStep: t / 200 });
  const end = Math.max(sol.y[sol.y.length - 1][0], 0);
  const latex = '\\frac{dC}{dt} = -\\frac{V_{max} C}{K_m + C}';
  const rows: CalcResult['rows'] = [
    { label: 'pharmacology.r.conc', vars: { t }, value: end, unit: 'mg/L' },
    { label: 'pharmacology.r.rateStart', value: (vmax * c0) / (km + c0), unit: 'mg/L/h' },
  ];
  const steps: Step[] = [{ key: 'pharmacology.s.mm', vars: { t, C: end }, math: latex }];
  if (c1 !== null) {
    positive(c1, 'C₁');
    if (!(c1 < c0)) throw new LsError('pharmacology.e.c1');
    const time = mmTime(c0, c1, vmax, km);
    rows.push({ label: 'pharmacology.r.timeTo', vars: { c: c1 }, value: time, unit: 'h' });
    steps.push({
      key: 'pharmacology.s.mmTime',
      vars: { c0, c1, km, v: vmax, t: time },
      math: 't = \\frac{K_m \\ln(C_0/C_1) + C_0 - C_1}{V_{max}}',
    });
  }
  return {
    rows,
    steps,
    notes: [{ key: 'pharmacology.n.mm' }, COURSEWORK],
    latex,
    plots: [
      {
        title: 'pharmacology.p.conc',
        x: { label: 'pharmacology.p.time' },
        y: { label: 'pharmacology.p.c' },
        series: [{ name: 'pharmacology.p.cSeries', points: sol.t.map((tt, i) => [tt, sol.y[i][0]] as Point) }],
      },
    ],
  };
}

/** Mosteller body-surface area √(height cm × weight kg / 3600) in m². */
export const mosteller = (heightCm: number, weightKg: number): number => Math.sqrt((heightCm * weightKg) / 3600);

export function scalingResult(
  heightCm: number,
  weightKg: number,
  perKg: number | null,
  perM2: number | null,
): CalcResult {
  positive(heightCm, 'h');
  positive(weightKg, 'w');
  const bsa = mosteller(heightCm, weightKg);
  const rows: CalcResult['rows'] = [{ label: 'pharmacology.r.bsa', value: bsa, unit: 'm²' }];
  const latex = '\\mathrm{BSA} = \\sqrt{\\frac{h\\,(\\mathrm{cm}) \\times w\\,(\\mathrm{kg})}{3600}}';
  const steps: Step[] = [{ key: 'pharmacology.s.bsa', vars: { h: heightCm, w: weightKg, b: bsa }, math: latex }];
  if (perKg !== null) {
    rows.push({ label: 'pharmacology.r.byWeight', value: positive(perKg, 'mg/kg') * weightKg, unit: 'mg' });
    steps.push({ key: 'pharmacology.s.byWeight', vars: { d: perKg, w: weightKg, D: perKg * weightKg } });
  }
  if (perM2 !== null) {
    rows.push({ label: 'pharmacology.r.byArea', value: positive(perM2, 'mg/m²') * bsa, unit: 'mg' });
    steps.push({ key: 'pharmacology.s.byArea', vars: { d: perM2, b: bsa, D: perM2 * bsa } });
  }
  return { rows, steps, latex, notes: [COURSEWORK] };
}

export * from './response';
