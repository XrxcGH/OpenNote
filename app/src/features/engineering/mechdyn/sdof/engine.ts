// Single-degree-of-freedom vibration: m x'' + c x' + k x = F(t). Closed forms for the natural frequency, damping,
// logarithmic decrement, and the steady harmonic response (force, base motion, rotating unbalance); the time
// response comes from the Dormand-Prince integrator, so any forcing works (Duhamel's integral done numerically).
// Forcing is F0 sin(wt), base motion is Y sin(wt), and the unbalance force is m0 e w^2 sin(wt). SI units throughout.
import { readExpr, compileExpr } from '../expr';
import { dopri } from '../num';
import { fail, finite, fmt, type MechStep, type Outcome, type Plot } from '../types';
import { tex } from '../tex';

export type SdofForcing = 'free' | 'harmonic' | 'base' | 'unbalance' | 'impulse' | 'custom';
export type Regime = 'undamped' | 'under' | 'critical' | 'over';

export interface SdofInput {
  m: number;
  k: number;
  /** Which damping value the student gave. */
  damping: 'c' | 'zeta';
  c: number;
  zeta: number;
  x0: number;
  v0: number;
  forcing: SdofForcing;
  F0: number;
  omega: number;
  Y: number;
  /** Unbalance m0 e in kg m. */
  me: number;
  /** Impulse in N s, applied at t = 0. */
  impulse: number;
  /** F(t) in newtons, with t in seconds. */
  custom: string;
  /** Seconds to simulate; 0 picks a length from the periods. */
  duration: number;
}

export interface SdofForced {
  r: number;
  /** Steady amplitude of x, in m. */
  X: number;
  /** Phase lag of x behind the forcing, in rad. */
  phase: number;
  magnification: number;
  transmissibility: number;
  /** 1 - TR when the mount isolates (TR < 1), else null. */
  isolation: number | null;
  /** Amplitude of the force passed to the ground (harmonic and unbalance), N. */
  transmitted: number | null;
  /** Base motion only: amplitude of x - y, m. */
  relative: number | null;
  /** Base motion only: phase lag of z = x - y behind y, rad. */
  relativePhase: number | null;
}

export interface SdofResult {
  omegaN: number;
  fn: number;
  period: number;
  c: number;
  cc: number;
  zeta: number;
  regime: Regime;
  omegaD: number | null;
  logDec: number | null;
  /** From the first two peaks of the simulated free response, as a check. */
  logDecMeasured: number | null;
  forced: SdofForced | null;
  peak: number;
  response: Plot;
  frequency: Plot | null;
  steps: MechStep[];
}

export const SDOF_DEFAULTS: SdofInput = {
  m: 10,
  k: 4000,
  damping: 'c',
  c: 40,
  zeta: 0.1,
  x0: 0.01,
  v0: 0,
  forcing: 'free',
  F0: 100,
  omega: 15,
  Y: 0.005,
  me: 0.01,
  impulse: 1,
  custom: '100*sin(15*t)',
  duration: 0,
};

/** Steady harmonic magnification 1 / sqrt((1 - r^2)^2 + (2 zeta r)^2). */
export const magnification = (r: number, zeta: number) => 1 / Math.hypot(1 - r * r, 2 * zeta * r);
/** Displacement and force transmissibility sqrt(1 + (2 zeta r)^2) / sqrt((1 - r^2)^2 + (2 zeta r)^2). */
export const transmissibility = (r: number, zeta: number) => Math.hypot(1, 2 * zeta * r) * magnification(r, zeta);
/** Phase lag atan2(2 zeta r, 1 - r^2), from 0 to pi. */
export const phaseLag = (r: number, zeta: number) => Math.atan2(2 * zeta * r, 1 - r * r);

/** Phase lag of the absolute motion x behind the base motion y: atan2(2 zeta r^3, 1 - r^2 + (2 zeta r)^2). */
export const basePhaseLag = (r: number, zeta: number) =>
  Math.atan2(2 * zeta * r ** 3, 1 - r * r + (2 * zeta * r) ** 2);

interface Base {
  m: number;
  k: number;
  c: number;
  cc: number;
  zeta: number;
  omegaN: number;
  regime: Regime;
}

const regimeOf = (zeta: number): Regime =>
  zeta === 0 ? 'undamped' : Math.abs(zeta - 1) < 1e-12 ? 'critical' : zeta < 1 ? 'under' : 'over';

const REGIME_STEP = {
  undamped: 'sdofUndamped',
  under: 'sdofUnder',
  critical: 'sdofCritical',
  over: 'sdofOver',
} as const;

/** The natural frequency, the damping, and their steps. */
function freeSteps(b: Base, omegaD: number | null, logDec: number | null): MechStep[] {
  const fn = b.omegaN / (2 * Math.PI);
  const steps: MechStep[] = [
    {
      key: 'sdofNatural',
      math:
        `\\omega_n = \\sqrt{k/m} = \\sqrt{${tex(b.k)}\\ \\mathrm{N/m} / ${tex(b.m)}\\ \\mathrm{kg}} = ` +
        `${tex(b.omegaN)}\\ \\mathrm{rad/s},\\quad f_n = \\omega_n/2\\pi = ${tex(fn)}\\ \\mathrm{Hz}`,
    },
    {
      key: 'sdofDamping',
      math: `\\zeta = \\frac{c}{2\\sqrt{km}} = \\frac{${tex(b.c)}}{${tex(b.cc)}} = ${tex(b.zeta)}`,
    },
    { key: REGIME_STEP[b.regime] },
  ];
  if (omegaD !== null && b.zeta > 0)
    steps.push({
      key: 'sdofDamped',
      math: `\\omega_d = \\omega_n\\sqrt{1-\\zeta^2} = ${tex(omegaD)}\\ \\mathrm{rad/s}`,
    });
  if (logDec !== null)
    steps.push({ key: 'sdofLogDec', math: `\\delta = \\frac{2\\pi\\zeta}{\\sqrt{1-\\zeta^2}} = ${tex(logDec)}` });
  return steps;
}

type Force = (t: number) => number;
const DENOM = '\\sqrt{(1-r^2)^2+(2\\zeta r)^2}';

/** The steady harmonic response to a force, base motion, or unbalance, with its force for the simulation. */
function harmonic(input: SdofInput, b: Base, steps: MechStep[]): { forced: SdofForced; force: Force } {
  const w = input.omega;
  const { k, c, m, zeta } = b;
  const r = w / b.omegaN;
  const mag = magnification(r, zeta);
  const tr = transmissibility(r, zeta);
  const base = input.forcing === 'base';
  const phase = base ? basePhaseLag(r, zeta) : phaseLag(r, zeta);
  const relativePhase = base ? phaseLag(r, zeta) : null;
  steps.push({ key: 'sdofRatio', math: `r = \\omega/\\omega_n = ${tex(w)}/${tex(b.omegaN)} = ${tex(r)}` });
  let X: number;
  let force: Force;
  let transmitted: number | null = null;
  let relative: number | null = null;
  if (input.forcing === 'harmonic') {
    const F0 = input.F0;
    X = (F0 / k) * mag;
    transmitted = Math.abs(F0) * tr;
    force = (t) => F0 * Math.sin(w * t);
    const math = `X = \\frac{F_0/k}{${DENOM}} = \\frac{${tex(F0)}/${tex(k)}}{${tex(1 / mag)}} = ${tex(X)}\\ \\mathrm{m}`;
    steps.push({ key: 'sdofAmplitude', math });
  } else if (input.forcing === 'base') {
    const Y = input.Y;
    X = Y * tr;
    relative = Y * r * r * mag;
    force = (t) => c * Y * w * Math.cos(w * t) + k * Y * Math.sin(w * t);
    steps.push({
      key: 'sdofBase',
      math:
        `X = Y\\,\\frac{\\sqrt{1+(2\\zeta r)^2}}{${DENOM}} = ${tex(Y)} \\times ${tex(tr)} = ${tex(X)}\\ \\mathrm{m},` +
        `\\quad Z = \\frac{Y r^2}{${DENOM}} = ${tex(relative)}\\ \\mathrm{m}`,
    });
  } else {
    const me = input.me;
    X = (me / m) * r * r * mag;
    transmitted = Math.abs(me) * w * w * tr;
    force = (t) => me * w * w * Math.sin(w * t);
    steps.push({
      key: 'sdofUnbalance',
      math:
        `X = \\frac{m_0 e}{m}\\,\\frac{r^2}{${DENOM}} = \\frac{${tex(me)}}{${tex(m)}} \\times ` +
        `${tex(r * r * mag)} = ${tex(X)}\\ \\mathrm{m}`,
    });
  }
  const deg = (a: number) => tex((a * 180) / Math.PI);
  if (relativePhase === null) {
    steps.push({ key: 'sdofPhase', math: `\\phi = \\operatorname{atan2}(2\\zeta r,\\ 1-r^2) = ${deg(phase)}^\\circ` });
  } else {
    steps.push({
      key: 'sdofBasePhase',
      math: `\\phi = \\operatorname{atan2}\\left(2\\zeta r^3,\\ 1-r^2+(2\\zeta r)^2\\right) = ${deg(phase)}^\\circ`,
    });
    steps.push({
      key: 'sdofRelativePhase',
      math: `\\phi_Z = \\operatorname{atan2}(2\\zeta r,\\ 1-r^2) = ${deg(relativePhase)}^\\circ`,
    });
  }
  const isolation = tr < 1 ? 1 - tr : null;
  steps.push({
    key: isolation === null ? 'sdofNoIsolation' : 'sdofIsolation',
    vars: { tr: fmt(tr), percent: fmt(100 * (isolation ?? 0), 3) },
    math: `TR = \\frac{\\sqrt{1+(2\\zeta r)^2}}{${DENOM}} = ${tex(tr)}`,
  });
  const forced = {
    r,
    X: Math.abs(X),
    phase,
    magnification: mag,
    transmissibility: tr,
    isolation,
    transmitted,
    relative,
    relativePhase,
  };
  return { forced, force };
}

/** The magnification and transmissibility curves, with the unbalance response for a rotating unbalance. */
function frequencyPlot(forcing: SdofForcing, zeta: number, r: number): Plot {
  const rMax = Math.max(3, 1.25 * r);
  const grid = Array.from({ length: 301 }, (_, i) => (rMax * i) / 300);
  const curve = (f: (x: number) => number) => grid.map((x) => [x, f(x)] as [number, number]);
  const series: Plot['series'] = [
    { name: 'magnification', points: curve((x) => magnification(x, zeta)) },
    { name: 'transmissibility', points: curve((x) => transmissibility(x, zeta)) },
  ];
  if (forcing === 'unbalance') series.push({ name: 'unbalance', points: curve((x) => x * x * magnification(x, zeta)) });
  return { x: 'frequencyRatio', y: 'amplitudeRatio', series };
}

/** The decrement measured from the first two simulated maxima with positive displacement. */
function measuredDecrement(events: readonly { t: number; y: readonly number[] }[]): number | null {
  const maxima = events.filter((e) => e.y[0] > 1e-12);
  const tops = maxima.filter((e, i) => i === 0 || e.t - maxima[i - 1].t > 1e-9);
  return tops.length >= 2 ? Math.log(tops[0].y[0] / tops[1].y[0]) : null;
}

interface Driven {
  forced: SdofForced | null;
  force: Force;
  v0: number;
}

/** The forcing as a function of time, with the steady harmonic quantities when it is harmonic. */
function forcingOf(input: SdofInput, b: Base, steps: MechStep[]): Outcome<Driven> {
  const { forcing, v0 } = input;
  if (forcing === 'harmonic' || forcing === 'base' || forcing === 'unbalance') {
    if (!finite(input.omega, input.F0, input.Y, input.me)) return fail('notNumber');
    if (input.omega <= 0) return fail('positiveFrequency');
    return { ok: true, value: { ...harmonic(input, b, steps), v0 } };
  }
  if (forcing === 'impulse') {
    if (!finite(input.impulse)) return fail('notNumber');
    const dv = input.impulse / b.m;
    const math = `\\Delta v = \\hat F/m = ${tex(input.impulse)}/${tex(b.m)} = ${tex(dv)}\\ \\mathrm{m/s}`;
    steps.push({ key: 'sdofImpulse', math });
    return { ok: true, value: { forced: null, force: () => 0, v0: v0 + dv } };
  }
  if (forcing === 'custom') {
    const read = readExpr(input.custom, ['t']);
    if (!read.ok) return fail(read.error, read.name ? { name: read.name } : undefined);
    const f = compileExpr(read.node, ['t']);
    steps.push({ key: 'sdofCustom' });
    return { ok: true, value: { forced: null, force: (t) => f([t]), v0 } };
  }
  return { ok: true, value: { forced: null, force: () => 0, v0 } };
}

export function solveSdof(input: SdofInput): Outcome<SdofResult> {
  const { m, k, x0, v0, forcing } = input;
  if (!finite(m, k, input.c, input.zeta, x0, v0, input.duration)) return fail('notNumber');
  if (m <= 0) return fail('positiveMass');
  if (k <= 0) return fail('positiveStiffness');
  const cc = 2 * Math.sqrt(k * m);
  const c = input.damping === 'c' ? input.c : input.zeta * cc;
  if (c < 0) return fail('negativeDamping');
  const zeta = c / cc;
  const omegaN = Math.sqrt(k / m);
  const b: Base = { m, k, c, cc, zeta, omegaN, regime: regimeOf(zeta) };
  const fn = omegaN / (2 * Math.PI);
  const omegaD = zeta < 1 ? omegaN * Math.sqrt(1 - zeta * zeta) : null;
  const logDec = zeta > 0 && zeta < 1 ? (2 * Math.PI * zeta) / Math.sqrt(1 - zeta * zeta) : null;
  const steps = freeSteps(b, omegaD, logDec);
  const driven = forcingOf(input, b, steps);
  if (!driven.ok) return driven;
  const { forced, force, v0: v0eff } = driven.value;

  // Time response.
  const span =
    input.duration > 0 ? input.duration : Math.max((20 * Math.PI) / omegaN, forced ? (20 * Math.PI) / input.omega : 0);
  if (!(span <= (1e4 * (2 * Math.PI)) / omegaN)) return fail('tooLong');
  const run = dopri((t, y) => [y[1], (force(t) - c * y[1] - k * y[0]) / m], 0, [x0, v0eff], span, {
    rtol: 1e-9,
    atol: 1e-12 * Math.max(1e-6, Math.abs(x0), Math.abs(v0eff) / omegaN, forced?.X ?? 0),
    hmax: span / 800,
    events: [(_, y) => y[1]],
  });
  if (!run.ok || run.y.some((y) => !finite(y[0]))) return fail('noConvergence');
  const points: [number, number][] = run.t.map((t, i) => [t, run.y[i][0]]);
  const peak = Math.max(...points.map(([, x]) => Math.abs(x)));
  const logDecMeasured = forcing === 'free' && logDec !== null ? measuredDecrement(run.events) : null;
  return {
    ok: true,
    value: {
      omegaN,
      fn,
      period: 1 / fn,
      c,
      cc,
      zeta,
      regime: b.regime,
      omegaD,
      logDec,
      logDecMeasured,
      forced,
      peak,
      response: { x: 'time', y: 'displacement', series: [{ name: 'displacement', points }] },
      frequency: forced ? frequencyPlot(forcing, zeta, forced.r) : null,
      steps,
    },
  };
}
