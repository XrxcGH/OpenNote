// Time responses of a transfer function and the specifications read from them. The step response is exact: at any
// time t it comes from the matrix exponential of [[A, B], [0, 0]] t, so the rise, peak, and settling times are found
// by root finding on the true response rather than read off a grid. The second-order formulas are shown beside the
// measured values. Steady-state errors come from the system type and the error constants.
import { ControlError } from '../lib/errors';
import { compile1, read } from '../lib/expr';
import { expm, mul, zeros, type Mat } from '../lib/linalg';
import { brent } from '../lib/num';
import { simulate } from '../lib/sim';
import { step, type Step } from '../lib/steps';
import {
  dcGain,
  errorConstants,
  feedback,
  fmt,
  isProper,
  poles as polesOf,
  tfTex,
  tfToSS,
  zerosOf,
  type Complex,
  type SS,
  type TF,
} from '../lib/tf';

export const SAMPLES = 1000;

export function checkSystem(g: TF): SS {
  if (!isProper(g)) throw new ControlError('improper');
  return tfToSS(g);
}

/** The exact unit step response at time t: C ∫₀ᵗ e^(Aτ) dτ B + D. */
export function stepAt(ss: SS, t: number): number {
  const n = ss.a.length;
  if (!n) return ss.d[0][0];
  const m: Mat = zeros(n + 1, n + 1);
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) m[i][j] = ss.a[i][j] * t;
    m[i][n] = ss.b[i][0] * t;
  }
  const e = expm(m);
  let y = ss.d[0][0];
  for (let i = 0; i < n; i += 1) y += ss.c[0][i] * e[i][n];
  return y;
}

/** The exact unit impulse response at time t > 0: C e^(At) B (the impulse in D is left out). */
export function impulseAt(ss: SS, t: number): number {
  const n = ss.a.length;
  if (!n) return 0;
  const e = expm(ss.a.map((row) => row.map((x) => x * t)));
  return mul(mul(ss.c, e), ss.b)[0][0];
}

/** A span that shows the slowest pole settle, or 10 s. */
export function spanOf(g: TF): number {
  const decay = polesOf(g)
    .map((p) => -p.re)
    .filter((x) => x > 1e-9);
  const slow = decay.length ? Math.min(...decay) : 0.8;
  const osc = Math.max(0, ...polesOf(g).map((p) => Math.abs(p.im)));
  return Math.min(Math.max(8 / slow, osc ? (4 * Math.PI) / osc : 0, 1e-3), 1e5);
}

export type Input = 'step' | 'impulse' | 'ramp' | 'custom';

export interface Response {
  readonly t: number[];
  readonly y: number[];
  readonly u: number[];
}

/** The response to a unit step, impulse, or ramp, or to u(t) typed as an expression in t. */
export function respond(g: TF, input: Input, span: number, custom = ''): Response {
  const ss = checkSystem(g);
  if (!(span > 0) || !Number.isFinite(span)) throw new ControlError('spanPositive');
  const t = Array.from({ length: SAMPLES + 1 }, (_, k) => (span * k) / SAMPLES);
  if (input === 'step') return { t, y: stepSamples(ss, span), u: t.map(() => 1) };
  if (input === 'impulse') {
    if (Math.abs(ss.d[0][0]) > 1e-12) throw new ControlError('impulseProper');
    return { t, y: t.map((tt) => impulseAt(ss, tt)), u: t.map(() => 0) };
  }
  if (input === 'ramp') {
    // The ramp response is the step response of G(s)/s.
    const integ = tfToSS({ num: g.num, den: [0, ...g.den] });
    return { t, y: stepSamples(integ, span), u: t };
  }
  let f: (x: number) => number;
  try {
    f = compile1(read(custom), 't');
  } catch {
    throw new ControlError('inputExpr');
  }
  const u = t.map(f);
  if (!u.every(Number.isFinite)) throw new ControlError('inputFinite');
  const sim = simulate(ss, (tt) => [f(tt)], span, SAMPLES, undefined, true);
  return { t, y: sim.y.map((v) => v[0]), u };
}

/** The step response on the grid, exact at each sample (the zero-order hold of a constant input is exact). */
function stepSamples(ss: SS, span: number): number[] {
  if (!ss.a.length) return Array.from({ length: SAMPLES + 1 }, () => ss.d[0][0]);
  return simulate(ss, () => [1], span, SAMPLES).y.map((v) => v[0]);
}

export interface Specs {
  readonly final: number;
  readonly peak: number;
  readonly tPeak: number;
  readonly overshoot: number;
  readonly rise: number;
  readonly settling: number;
  readonly t10: number;
  readonly t90: number;
}

/** Rise (10-90%), peak, overshoot, and 2% settling time of a stable step response, by root finding. */
export function stepSpecs(g: TF, band = 0.02): Specs {
  const ss = checkSystem(g);
  if (polesOf(g).some((p) => p.re >= -1e-12)) throw new ControlError('specsUnstable');
  const final = dcGain(g);
  if (!Number.isFinite(final) || Math.abs(final) < 1e-14) throw new ControlError('specsZeroFinal');
  const span = spanOf(g) * 1.5;
  const t = Array.from({ length: 4001 }, (_, k) => (span * k) / 4000);
  const ys = simulate(ss, () => [1], span, 4000).y.map((v) => v[0] / final);
  const r = (x: number) => stepAt(ss, x) / final;
  const first = (level: number) => {
    const i = ys.findIndex((y) => y >= level);
    if (i <= 0) return i === 0 ? 0 : Number.NaN;
    return brent((x) => r(x) - level, t[i - 1], t[i]);
  };
  const t10 = first(0.1);
  const t90 = first(0.9);
  let iMax = 0;
  ys.forEach((y, i) => {
    if (y > ys[iMax]) iMax = i;
  });
  let tPeak = Number.NaN;
  let peak = 1;
  if (ys[iMax] > 1 + 1e-9 && iMax > 0 && iMax < ys.length - 1) {
    tPeak = brent((x) => impulseAt(ss, x), t[iMax - 1], t[iMax + 1]);
    if (!Number.isFinite(tPeak)) tPeak = t[iMax];
    peak = r(tPeak);
  }
  let last = -1;
  ys.forEach((y, i) => {
    if (Math.abs(y - 1) > band) last = i;
  });
  const settling =
    last < 0 ? 0 : last >= ys.length - 1 ? Number.NaN : brent((x) => Math.abs(r(x) - 1) - band, t[last], t[last + 1]);
  return {
    final,
    peak: peak * final,
    tPeak,
    overshoot: Math.max(0, (peak - 1) * 100),
    rise: t90 - t10,
    settling,
    t10,
    t90,
  };
}

export interface SecondOrder {
  readonly zeta: number;
  readonly wn: number;
  readonly overshoot: number;
  readonly tPeak: number;
  readonly settling: number;
  readonly rise: number;
}

/** ζ and ωₙ of a second-order system with no zeros, and the textbook formulas for its step response. */
export function secondOrder(g: TF): SecondOrder | null {
  if (g.den.length !== 3 || g.num.length !== 1 || zerosOf(g).length) return null;
  const [a0, a1, a2] = g.den;
  if (!(a0 > 0 && a1 > 0 && a2 > 0)) return null;
  const wn = Math.sqrt(a0 / a2);
  const zeta = a1 / a2 / (2 * wn);
  const under = zeta < 1;
  const wd = wn * Math.sqrt(Math.max(0, 1 - zeta * zeta));
  return {
    zeta,
    wn,
    overshoot: under ? 100 * Math.exp((-zeta * Math.PI) / Math.sqrt(1 - zeta * zeta)) : 0,
    tPeak: under ? Math.PI / wd : Number.NaN,
    settling: 4 / (zeta * wn),
    rise: (1 - 0.4167 * zeta + 2.917 * zeta * zeta) / wn,
  };
}

export function specSteps(g: TF, s: Specs, f: SecondOrder | null): Step[] {
  const out: Step[] = [
    step(
      'sys.final',
      { final: fmt(s.final) },
      `y(\\infty) = \\lim_{s \\to 0} s \\cdot G(s) \\cdot \\frac{1}{s} = G(0) = ${fmt(s.final)}`,
    ),
    step('sys.rise', { t10: fmt(s.t10), t90: fmt(s.t90), rise: fmt(s.rise) }),
    Number.isFinite(s.tPeak)
      ? step('sys.peak', { tp: fmt(s.tPeak), peak: fmt(s.peak), os: fmt(s.overshoot) })
      : step('sys.noPeak'),
    step('sys.settling', { ts: fmt(s.settling) }),
  ];
  if (f) {
    out.push(
      step(
        'sys.secondOrder',
        { zeta: fmt(f.zeta), wn: fmt(f.wn) },
        `G(s) = ${tfTex(g)},\\quad \\omega_n = ${fmt(f.wn)},\\ \\zeta = ${fmt(f.zeta)}`,
      ),
    );
    if (f.zeta < 1) {
      out.push(
        step('sys.formulaOs', { os: fmt(f.overshoot) }, '\\%OS = 100\\,e^{-\\zeta\\pi/\\sqrt{1-\\zeta^2}}'),
        step('sys.formulaTp', { tp: fmt(f.tPeak) }, 't_p = \\frac{\\pi}{\\omega_n\\sqrt{1-\\zeta^2}}'),
      );
    }
    out.push(step('sys.formulaTs', { ts: fmt(f.settling) }, 't_s \\approx \\frac{4}{\\zeta\\omega_n}'));
  }
  return out;
}

export interface SteadyState {
  readonly type: number;
  readonly kp: number;
  readonly kv: number;
  readonly ka: number;
  readonly step: number;
  readonly ramp: number;
  readonly parabola: number;
  readonly closed: TF;
  readonly stable: boolean;
  readonly steps: Step[];
}

/** Steady-state errors of the unity feedback loop around G for unit step, ramp, and parabola inputs. */
export function steadyState(g: TF): SteadyState {
  checkSystem(g);
  const closed = feedback(g);
  const stable = polesOf(closed).every((p) => p.re < -1e-12);
  const { kp, kv, ka, type } = errorConstants(g);
  const inv = (x: number) => (Number.isFinite(x) ? 1 / x : 0);
  const stepErr = Number.isFinite(kp) ? 1 / (1 + kp) : 0;
  return {
    type,
    kp,
    kv,
    ka,
    step: stepErr,
    ramp: inv(kv),
    parabola: inv(ka),
    closed,
    stable,
    steps: [
      step('sys.closed', {}, `T(s) = \\frac{G}{1 + G} = ${tfTex(closed)}`),
      step(stable ? 'sys.closedStable' : 'sys.closedUnstable'),
      step('sys.type', { type: String(type) }),
      step('sys.kp', { kp: fmt(kp) }, `K_p = \\lim_{s \\to 0} G(s) = ${fmt(kp).replace('∞', '\\infty')}`),
      step('sys.kv', { kv: fmt(kv) }, `K_v = \\lim_{s \\to 0} s\\,G(s) = ${fmt(kv).replace('∞', '\\infty')}`),
      step('sys.ka', { ka: fmt(ka) }, `K_a = \\lim_{s \\to 0} s^2 G(s) = ${fmt(ka).replace('∞', '\\infty')}`),
      step('sys.errors', { step: fmt(stepErr), ramp: fmt(inv(kv)), parabola: fmt(inv(ka)) }),
    ],
  };
}

/** Distinct poles and zeros of G for the s-plane map. */
export const polesZeros = (g: TF): { poles: Complex[]; zeros: Complex[] } => ({ poles: polesOf(g), zeros: zerosOf(g) });
