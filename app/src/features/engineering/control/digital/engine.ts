// Digital control. A continuous plant or controller is discretized by zero-order hold, Tustin with optional
// prewarping, or matched pole-zero. A discrete transfer function is analyzed: poles and zeros against the unit
// circle, the Jury test, the difference equation, step and impulse responses, and the inverse z-transform. Also
// here: the gains that keep a sampled loop stable, aliasing, and the digital PID in velocity form.

import { ControlError } from '../lib/errors';
import { zohPair } from '../lib/linalg';
import { boundaryCrossings, stableRanges, trackLocus, type Crossing, type Locus } from '../lib/locus';
import { step, type Step } from '../lib/steps';
import {
  cabs,
  cdiv,
  complexText,
  cx,
  evalTF,
  fmt,
  fmtTex,
  isProper,
  makeTF,
  order,
  polyFromRoots,
  poles,
  ssToTF,
  tfTex,
  tfToSS,
  zerosOf,
  type Complex,
  type Poly,
  type TF,
} from '../lib/tf';
import { pmul, padd, trim } from '../lib/poly';

export type Method = 'zoh' | 'tustin' | 'prewarp' | 'matched';

export interface DiscretizeResult {
  readonly hz: TF;
  readonly steps: readonly Step[];
}

/** (z − 1)^a (z + 1)^b, lowest power first. */
function binomials(a: number, b: number): Poly {
  let p: Poly = [1];
  for (let i = 0; i < a; i += 1) p = pmul(p, [-1, 1]);
  for (let i = 0; i < b; i += 1) p = pmul(p, [1, 1]);
  return p;
}

/** Discretizes G(s) with sample period T. ω₀ is the prewarping frequency (rad/s) for 'prewarp'. */
export function discretize(g: TF, T: number, method: Method, w0?: number): DiscretizeResult {
  if (!(T > 0) || !Number.isFinite(T)) throw new ControlError('periodPositive');
  if (!isProper(g)) throw new ControlError('improper');
  const steps: Step[] = [];
  if (method === 'zoh') {
    const ss = tfToSS(g);
    if (!ss.a.length) return { hz: g, steps: [step('dig.static')] };
    const { phi, gamma } = zohPair(ss.a, ss.b, T);
    const hz = ssToTF({ a: phi, b: gamma, c: ss.c, d: ss.d });
    steps.push(step('dig.zohFormula', {}, 'H(z) = (1 - z^{-1})\\,\\mathcal{Z}\\left\\{\\frac{G(s)}{s}\\right\\}'));
    steps.push(
      step(
        'dig.zohMethod',
        {},
        `\\Phi = e^{AT},\\quad \\Gamma = \\int_0^T e^{A\\tau}\\,d\\tau\\,B,\\quad T = ${fmtTex(T)}`,
      ),
    );
    steps.push(step('dig.resultTF', {}, `H(z) = ${tfTex(hz, 'z')}`));
    return { hz, steps };
  }
  if (method === 'tustin' || method === 'prewarp') {
    let c = 2 / T;
    if (method === 'prewarp') {
      if (!(w0 !== undefined && w0 > 0 && w0 * T < Math.PI))
        throw new ControlError('prewarpRange', { max: fmt(Math.PI / T) });
      c = w0 / Math.tan((w0 * T) / 2);
    }
    const nOrder = order(g.den);
    const map = (p: Poly): Poly =>
      trim(p).reduce<Poly>(
        (acc, coef, k) =>
          padd(
            acc,
            binomials(k, nOrder - k).map((x) => x * coef * c ** k),
          ),
        [0],
      );
    const hz = makeTF(map(g.num), map(g.den));
    steps.push(
      step(
        method === 'tustin' ? 'dig.tustin' : 'dig.prewarp',
        { c: fmt(c) },
        method === 'tustin'
          ? `s \\leftarrow \\frac{2}{T}\\,\\frac{z - 1}{z + 1} = ${fmtTex(c)}\\,\\frac{z - 1}{z + 1}`
          : `s \\leftarrow \\frac{\\omega_0}{\\tan(\\omega_0 T/2)}\\,\\frac{z - 1}{z + 1} ` +
              `= ${fmtTex(c)}\\,\\frac{z - 1}{z + 1}`,
      ),
    );
    steps.push(step('dig.resultTF', {}, `H(z) = ${tfTex(hz, 'z')}`));
    return { hz, steps };
  }
  // Matched pole-zero: map every pole and finite zero by z = e^{sT}; zeros at infinity go to z = −1, except one
  // that stays at infinity so the controller can compute in one sample period.
  const ps = poles(g);
  const zs = zerosOf(g);
  const mapz = (s: Complex) => {
    const m = Math.exp(s.re * T);
    return cx(m * Math.cos(s.im * T), m * Math.sin(s.im * T));
  };
  const extra = Math.max(0, ps.length - zs.length - 1);
  const numZ = pmul(polyFromRoots(zs.map(mapz)), binomials(0, extra));
  const denZ = polyFromRoots(ps.map(mapz));
  const unit = makeTF(numZ, denZ);
  // Match the gain at a low frequency (DC when there is no pole or zero at s = 0).
  const atOrigin = [...ps, ...zs].some((z) => cabs(z) < 1e-12);
  const w = atOrigin ? (1e-3 * Math.PI) / T : 0;
  const gs = evalTF(g, cx(0, w));
  const hs = evalTF(unit, cx(Math.cos(w * T), Math.sin(w * T)));
  const ratio = cdiv(gs, hs);
  const k = Math.sign(ratio.re || 1) * cabs(ratio);
  const hz = makeTF(
    numZ.map((x) => x * k),
    denZ,
  );
  steps.push(step('dig.matched', { extra: String(extra) }, 'z_i = e^{s_i T}'));
  steps.push(step(atOrigin ? 'dig.matchedGainLow' : 'dig.matchedGainDc', { k: fmt(k) }));
  steps.push(step('dig.resultTF', {}, `H(z) = ${tfTex(hz, 'z')}`));
  return { hz, steps };
}

// ---------------------------------------------------------------------------------------------------------------
// Discrete analysis

export interface JuryRow {
  readonly coeffs: readonly number[];
}

export interface JuryResult {
  readonly stable: boolean;
  readonly rows: readonly JuryRow[];
  readonly conditions: readonly {
    readonly key: string;
    readonly vars: Readonly<Record<string, string>>;
    readonly ok: boolean;
  }[];
}

/** The Jury stability test for P(z) = aₙzⁿ + … + a₀ (coefficients lowest power first). */
export function jury(pIn: Poly): JuryResult {
  let p = trim(pIn);
  const n = p.length - 1;
  if (n < 1) throw new ControlError('juryOrder');
  if (p[n] < 0) p = p.map((c) => -c);
  const value = (z: number) => p.reduce((s, c, k) => s + c * z ** k, 0);
  const conditions: { key: string; vars: Record<string, string>; ok: boolean }[] = [];
  const p1 = value(1);
  const pm1 = value(-1);
  conditions.push({ key: 'dig.juryP1', vars: { value: fmt(p1) }, ok: p1 > 0 });
  conditions.push({ key: 'dig.juryPm1', vars: { value: fmt((-1) ** n * pm1), n: String(n) }, ok: (-1) ** n * pm1 > 0 });
  conditions.push({ key: 'dig.juryA0', vars: { a0: fmt(Math.abs(p[0])), an: fmt(p[n]) }, ok: Math.abs(p[0]) < p[n] });
  const rows: JuryRow[] = [{ coeffs: [...p] }];
  // Each new row b_k = det[[a₀, a_{m−k}], [a_m, a_k]] = a₀a_k − a_m a_{m−k}; it has one term fewer.
  let row = [...p];
  while (row.length > 3) {
    const m = row.length - 1;
    const next = Array.from({ length: m }, (_, k) => row[0] * row[k] - row[m] * row[m - k]);
    rows.push({ coeffs: next });
    conditions.push({
      key: 'dig.juryRow',
      vars: { first: fmt(Math.abs(next[0])), last: fmt(Math.abs(next[m - 1])) },
      ok: Math.abs(next[0]) > Math.abs(next[m - 1]),
    });
    row = next;
  }
  return { stable: conditions.every((c) => c.ok), rows, conditions };
}

export interface DiscreteAnalysis {
  readonly poles: readonly Complex[];
  readonly zeros: readonly Complex[];
  readonly magnitudes: readonly number[];
  readonly stable: boolean;
  readonly jury: JuryResult;
  /** y[k] = Σ bᵢ u[k−i] − Σ aᵢ y[k−i], coefficients of z⁻ⁱ with a₀ = 1. */
  readonly difference: { readonly b: readonly number[]; readonly a: readonly number[]; readonly delay: number };
  readonly step: readonly number[];
  readonly impulse: readonly number[];
  readonly dcGain: number;
  /** Inverse z-transform of the impulse response as Σ rᵢ pᵢᵏ (distinct poles only, k ≥ 1). */
  readonly partialFractions?: readonly { readonly r: Complex; readonly p: Complex }[];
  readonly steps: readonly Step[];
}

/** The difference equation of H(z) and its response to an input sequence. */
function filter(b: readonly number[], a: readonly number[], u: readonly number[]): number[] {
  const y: number[] = [];
  for (let k = 0; k < u.length; k += 1) {
    let s = 0;
    for (let i = 0; i < b.length; i += 1) if (k - i >= 0) s += b[i] * u[k - i];
    for (let i = 1; i < a.length; i += 1) if (k - i >= 0) s -= a[i] * y[k - i];
    y.push(s);
  }
  return y;
}

export function analyzeDiscrete(h: TF, samples = 40, T?: number): DiscreteAnalysis {
  if (!isProper(h)) throw new ControlError('improperDiscrete');
  if (!(samples >= 2 && samples <= 5000)) throw new ControlError('samplesRange');
  const nd = order(h.den);
  // In powers of z⁻¹: divide num and den by z^{nd}. den is monic, so a₀ = 1.
  const a = [...h.den].reverse();
  const numPadded = [...h.num];
  while (numPadded.length < nd + 1) numPadded.push(0);
  const b = numPadded.slice(0, nd + 1).reverse();
  const delay = b.findIndex((x) => Math.abs(x) > 1e-15);
  const ps = poles(h);
  const zs = zerosOf(h);
  const magnitudes = ps.map(cabs);
  const stable = magnitudes.every((m) => m < 1 - 1e-12);
  const juryResult = nd >= 1 ? jury(h.den) : { stable: true, rows: [], conditions: [] };
  const ones = new Array<number>(samples).fill(1);
  const delta = ones.map((_, k) => (k === 0 ? 1 : 0));
  const stepResp = filter(b, a, ones);
  const impulse = filter(b, a, delta);
  const den1 = h.den.reduce((s, c) => s + c, 0);
  const dcGain = Math.abs(den1) < 1e-14 ? Number.POSITIVE_INFINITY : h.num.reduce((s, c) => s + c, 0) / den1;
  const steps: Step[] = [];
  steps.push(
    step('dig.poles', {
      poles: ps.map((p) => complexText(p)).join(', '),
      mags: magnitudes.map((m) => fmt(m)).join(', '),
    }),
  );
  steps.push(step(stable ? 'dig.stable' : 'dig.unstable'));
  const termsB = b
    .map((x, i) => (Math.abs(x) < 1e-15 ? '' : `${x < 0 ? '-' : '+'} ${fmtTex(Math.abs(x))}\\,u[k${i ? `-${i}` : ''}]`))
    .filter(Boolean);
  const termsA = a
    .slice(1)
    .map((x, i) => (Math.abs(x) < 1e-15 ? '' : `${x > 0 ? '-' : '+'} ${fmtTex(Math.abs(x))}\\,y[k-${i + 1}]`))
    .filter(Boolean);
  const rhs = [...termsB, ...termsA].join(' ').replace(/^\+ /, '');
  steps.push(step('dig.difference', {}, `y[k] = ${rhs || '0'}`));
  // Partial fractions for distinct poles: H(z) = d + Σ rᵢ/(z − pᵢ) ⇒ h[k] = Σ rᵢ pᵢ^{k−1} for k ≥ 1.
  let partialFractions: { r: Complex; p: Complex }[] | undefined;
  const distinct = ps.every((p, i) => ps.every((q, j) => i === j || cabs({ re: p.re - q.re, im: p.im - q.im }) > 1e-6));
  if (distinct && nd >= 1) {
    partialFractions = ps.map((p) => {
      // rᵢ = N(pᵢ)/D′(pᵢ) for the strictly proper part; the feedthrough adds only at k = 0.
      const dprime = ps
        .filter((q) => q !== p)
        .reduce<Complex>(
          (acc, q) => ({
            re: acc.re * (p.re - q.re) - acc.im * (p.im - q.im),
            im: acc.re * (p.im - q.im) + acc.im * (p.re - q.re),
          }),
          cx(1),
        );
      const nv = h.num.reduce<Complex>((acc, c, k) => {
        let zk = cx(1);
        for (let i = 0; i < k; i += 1) zk = { re: zk.re * p.re - zk.im * p.im, im: zk.re * p.im + zk.im * p.re };
        return { re: acc.re + c * zk.re, im: acc.im + c * zk.im };
      }, cx(0));
      return { r: cdiv(nv, dprime), p };
    });
    steps.push(step('dig.partialFractions', {}, `h[k] = \\sum_i r_i\\,p_i^{\\,k-1},\\ k \\ge 1`));
  }
  if (T !== undefined) steps.push(step('dig.samplePeriod', { T: fmt(T), fs: fmt(1 / T), nyquist: fmt(1 / (2 * T)) }));
  return {
    poles: ps,
    zeros: zs,
    magnitudes,
    stable,
    jury: juryResult,
    difference: { b, a, delay: Math.max(0, delay) },
    step: stepResp,
    impulse,
    dcGain,
    partialFractions,
    steps,
  };
}

/** First terms of the inverse z-transform by long division of N(z⁻¹)/D(z⁻¹). */
export function longDivision(h: TF, count: number): number[] {
  const a = [...h.den].reverse();
  const nd = order(h.den);
  const num = [...h.num];
  while (num.length < nd + 1) num.push(0);
  const b = num.slice(0, nd + 1).reverse();
  return filter(
    b,
    a,
    Array.from({ length: count }, (_, k) => (k === 0 ? 1 : 0)),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Sampled loops, aliasing, and digital PID

export interface ZLocusResult {
  readonly locus: Locus;
  readonly crossings: readonly Crossing[];
  readonly ranges: readonly [number, number][];
  readonly steps: readonly Step[];
}

/** The z-plane root locus of 1 + K H(z) and the gains that keep every closed-loop pole inside the unit circle. */
export function zLocus(h: TF, kMax?: number): ZLocusResult {
  const crossings = boundaryCrossings(h.num, h.den, 'z');
  const ranges = stableRanges(h.num, h.den, 'z');
  const top = kMax ?? Math.max(10, 3 * Math.max(0, ...crossings.map((c) => c.k)));
  const locus = trackLocus(h.num, h.den, top, 2);
  const steps: Step[] = [step('dig.unitCircle', {}, '1 + K\\,H(z) = 0,\\quad |z| < 1')];
  crossings.forEach((c) =>
    steps.push(step('dig.crossing', { k: fmt(c.k), theta: fmt(c.at), point: complexText(c.point) })),
  );
  steps.push(step('dig.ranges', { ranges: ranges.map(([lo, hi]) => `${fmt(lo)} < K < ${fmt(hi)}`).join('; ') || '—' }));
  return { locus, crossings, ranges, steps };
}

/** The frequency an f-Hz signal appears at after sampling at fs Hz. */
export function alias(
  f: number,
  fs: number,
): { readonly apparent: number; readonly nyquist: number; readonly aliased: boolean; readonly steps: readonly Step[] } {
  if (!(fs > 0) || !(f >= 0)) throw new ControlError('frequencyPositive');
  const apparent = Math.abs(f - fs * Math.round(f / fs));
  const nyquist = fs / 2;
  return {
    apparent,
    nyquist,
    aliased: f > nyquist,
    steps: [
      step(
        'dig.alias',
        { f: fmt(f), fs: fmt(fs), apparent: fmt(apparent), nyquist: fmt(nyquist) },
        `f_a = \\left|f - f_s\\,\\mathrm{round}(f/f_s)\\right| = ${fmtTex(apparent)}`,
      ),
    ],
  };
}

export interface PidResult {
  readonly cz: TF;
  /** u[k] = u[k−1] + q₀e[k] + q₁e[k−1] + q₂e[k−2] */
  readonly q: readonly [number, number, number];
  readonly steps: readonly Step[];
}

/**
 * Digital PID with backward-difference derivative and either backward-rectangle or trapezoidal integration:
 * C(z) = Kp + Ki T z/(z − 1) + Kd (z − 1)/(T z)  (or Ki T (z + 1)/(2(z − 1)) for the trapezoid).
 */
export function digitalPid(
  kp: number,
  ki: number,
  kd: number,
  T: number,
  integral: 'backward' | 'trapezoid',
): PidResult {
  if (![kp, ki, kd].every(Number.isFinite)) throw new ControlError('numbersNeeded');
  if (!(T > 0)) throw new ControlError('periodPositive');
  const kdT = kd / T;
  // Velocity form: (1 − z⁻¹) C(z) = q₀ + q₁z⁻¹ + q₂z⁻²
  const q: [number, number, number] =
    integral === 'backward'
      ? [kp + ki * T + kdT, -kp - 2 * kdT, kdT]
      : [kp + (ki * T) / 2 + kdT, -kp + (ki * T) / 2 - 2 * kdT, kdT];
  // C(z) = (q₀z² + q₁z + q₂)/(z² − z)
  const cz = makeTF([q[2], q[1], q[0]], [0, -1, 1]);
  return {
    cz,
    q,
    steps: [
      step(
        integral === 'backward' ? 'dig.pidBackward' : 'dig.pidTrapezoid',
        {},
        integral === 'backward'
          ? 'C(z) = K_p + K_i T\\,\\frac{z}{z - 1} + \\frac{K_d}{T}\\,\\frac{z - 1}{z}'
          : 'C(z) = K_p + \\frac{K_i T}{2}\\,\\frac{z + 1}{z - 1} + \\frac{K_d}{T}\\,\\frac{z - 1}{z}',
      ),
      step(
        'dig.pidVelocity',
        {},
        `u[k] = u[k-1] + ${fmtTex(q[0])}\\,e[k] ` +
          `${q[1] < 0 ? '-' : '+'} ${fmtTex(Math.abs(q[1]))}\\,e[k-1] ` +
          `${q[2] < 0 ? '-' : '+'} ${fmtTex(Math.abs(q[2]))}\\,e[k-2]`,
      ),
      step('dig.resultTF', {}, `C(z) = ${tfTex(cz, 'z')}`),
    ],
  };
}
