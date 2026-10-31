// Digital filter design. FIR filters by the window method; IIR filters from Butterworth and Chebyshev analog
// prototypes by the bilinear transform with prewarping or by impulse invariance; and the simple filters (moving
// average, notch). A filter is its coefficients b and a, highest power of z⁻¹ last. Pure: no DOM.
import { makeWindow, type WindowName } from '../shared/fft';
import { SignalError } from '../shared/errors';
import { cabs, cadd, cdiv, cexp, cmul, cpolar, cscale, csub, cx, fmt, type Complex } from '../shared/num';
import { step, type Step } from '../shared/steps';
import { ellipticPrototype } from './elliptic';

export type Band = 'lowpass' | 'highpass' | 'bandpass' | 'bandstop';
export type FirKind = Band | 'differentiator' | 'hilbert';
export const FIR_KINDS: readonly FirKind[] = [
  'lowpass',
  'highpass',
  'bandpass',
  'bandstop',
  'differentiator',
  'hilbert',
];
export const BANDS: readonly Band[] = ['lowpass', 'highpass', 'bandpass', 'bandstop'];

export interface Filter {
  b: number[];
  a: number[];
  /** Second-order sections [b0, b1, b2, a0, a1, a2], when the design makes them. */
  sos?: number[][];
  steps: Step[];
}

const sinc = (x: number) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x));

function checkRate(fs: number): number {
  if (!(fs > 0) || !Number.isFinite(fs)) throw new SignalError('sampleRate');
  return fs;
}

/** Checks band edges in hertz: inside (0, fs/2), and increasing for a band. */
function edges(band: Band | FirKind, f1: number, f2: number, fs: number): [number, number] {
  const nyquist = fs / 2;
  const inside = (f: number) => f > 0 && f < nyquist;
  if (!inside(f1)) throw new SignalError('cutoff', { nyquist: fmt(nyquist) });
  if ((band === 'bandpass' || band === 'bandstop') && !(inside(f2) && f2 > f1)) {
    throw new SignalError('bandEdges', { nyquist: fmt(nyquist) });
  }
  return [f1, f2];
}

/**
 * Kaiser's estimates for a window design: β from the attenuation A in dB, and the number of taps from A and the
 * transition width (a fraction of the Nyquist frequency): N = ⌈(A − 7.95)/(2.285 π Δ) + 1⌉.
 */
export function kaiserEstimate(attenuationDb: number, width: number): { taps: number; beta: number; steps: Step[] } {
  if (!(attenuationDb > 0) || !Number.isFinite(attenuationDb)) throw new SignalError('attenuation');
  if (!(width > 0 && width < 1)) throw new SignalError('transition');
  const a = attenuationDb;
  const beta = a > 50 ? 0.1102 * (a - 8.7) : a >= 21 ? 0.5842 * (a - 21) ** 0.4 + 0.07886 * (a - 21) : 0;
  const taps = Math.ceil((a - 7.95) / (2.285 * Math.PI * width) + 1);
  return {
    taps,
    beta,
    steps: [
      step(
        'filterKaiserBeta',
        `β = ${a > 50 ? `0.1102·(${fmt(a)} − 8.7)` : '0.5842(A − 21)^0.4 + 0.07886(A − 21)'} = ${fmt(beta)}`,
      ),
      step('filterKaiserTaps', `N = ⌈(${fmt(a)} − 7.95)/(2.285·π·${fmt(width)}) + 1⌉ = ${taps}`),
    ],
  };
}

/**
 * A linear-phase FIR filter by the window method. Cutoffs are in hertz; the ideal response is a sum of windowed
 * sincs, scaled to unit gain at DC (lowpass, bandstop), at the Nyquist frequency (highpass), or at the band center.
 */
export function firWindow(
  kind: FirKind,
  taps: number,
  f1: number,
  f2: number,
  fs: number,
  window: WindowName,
  beta = 5,
): Filter {
  checkRate(fs);
  if (!Number.isInteger(taps) || taps < 3 || taps > 4097) throw new SignalError('taps');
  if ((kind === 'highpass' || kind === 'bandstop') && taps % 2 === 0) throw new SignalError('oddTaps');
  if (kind !== 'differentiator' && kind !== 'hilbert') edges(kind, f1, f2, fs);
  const w = makeWindow(window, taps, true, beta);
  const middle = (taps - 1) / 2;
  const c1 = f1 / fs;
  const c2 = f2 / fs;
  const ideal = (m: number): number => {
    switch (kind) {
      case 'lowpass':
        return 2 * c1 * sinc(2 * c1 * m);
      case 'highpass':
        return sinc(m) - 2 * c1 * sinc(2 * c1 * m);
      case 'bandpass':
        return 2 * c2 * sinc(2 * c2 * m) - 2 * c1 * sinc(2 * c1 * m);
      case 'bandstop':
        return sinc(m) - 2 * c2 * sinc(2 * c2 * m) + 2 * c1 * sinc(2 * c1 * m);
      case 'differentiator':
        // The ideal differentiator H = jω: h[m] = cos(πm)/m, and 0 at the center.
        return m === 0 ? 0 : Math.cos(Math.PI * m) / m;
      case 'hilbert':
        return m === 0 ? 0 : (1 - Math.cos(Math.PI * m)) / (Math.PI * m);
    }
  };
  const b = Array.from({ length: taps }, (_, n) => ideal(n - middle) * w[n]!);
  const steps: Step[] = [
    step('filterFirIdeal', `h[n] = h_ideal[n − ${fmt(middle)}]·w[n], n = 0…${taps - 1}`),
    step('filterFirWindow', undefined, { window }),
  ];
  if (kind !== 'differentiator' && kind !== 'hilbert') {
    const at = kind === 'highpass' ? 0.5 : kind === 'bandpass' ? (c1 + c2) / 2 : 0;
    const gain = cabs(response(b, [1], at * 2 * Math.PI));
    for (let i = 0; i < taps; i += 1) b[i] = b[i]! / gain;
    steps.push(step('filterFirNormalize', `÷ ${fmt(gain)}`, { at: fmt(at * fs) }));
  }
  return { b, a: [1], steps };
}

/** H(e^{jω}) = B/A at a normalized angular frequency ω (radians per sample). */
export function response(b: readonly number[], a: readonly number[], omega: number): Complex {
  const at = (c: readonly number[]) => {
    let re = 0;
    let im = 0;
    c.forEach((value, k) => {
      re += value * Math.cos(omega * k);
      im -= value * Math.sin(omega * k);
    });
    return cx(re, im);
  };
  const den = at(a);
  // A pole exactly on the unit circle at this frequency: the gain is unbounded there.
  if (den.re === 0 && den.im === 0) return cx(Infinity, 0);
  return cdiv(at(b), den);
}

/** Group delay in samples: Re(Σ k c_k e^{−jωk} / Σ c_k e^{−jωk}) for B, less the same for A. */
export function groupDelay(b: readonly number[], a: readonly number[], omega: number): number {
  const part = (c: readonly number[]) => {
    let re = 0;
    let im = 0;
    let dre = 0;
    let dim = 0;
    c.forEach((value, k) => {
      re += value * Math.cos(omega * k);
      im -= value * Math.sin(omega * k);
      dre += k * value * Math.cos(omega * k);
      dim -= k * value * Math.sin(omega * k);
    });
    // At a zero on the unit circle the phase jumps and the delay is undefined.
    if (re * re + im * im < 1e-300) return Number.NaN;
    return cdiv(cx(dre, dim), cx(re, im)).re;
  };
  return part(b) - part(a);
}

export type Prototype = 'butterworth' | 'chebyshev1' | 'chebyshev2' | 'elliptic';
export const PROTOTYPES: readonly Prototype[] = ['butterworth', 'chebyshev1', 'chebyshev2', 'elliptic'];

interface Zpk {
  z: Complex[];
  p: Complex[];
  k: number;
  /** An elliptic prototype's passband edge over its stopband edge. */
  selectivity?: number;
}

/** The normalized analog lowpass prototype (edge at 1 rad/s) with its gain. */
function analogPrototype(type: Prototype, order: number, rippleDb: number, stopDb: number): Zpk {
  const p: Complex[] = [];
  const z: Complex[] = [];
  if (type === 'butterworth') {
    for (let k = 0; k < order; k += 1) p.push(cpolar(1, Math.PI / 2 + ((2 * k + 1) * Math.PI) / (2 * order)));
    return { z, p, k: 1 };
  }
  if (type === 'chebyshev1') {
    const eps = Math.sqrt(10 ** (rippleDb / 10) - 1);
    const mu = Math.asinh(1 / eps) / order;
    for (let k = 0; k < order; k += 1) {
      const theta = (Math.PI * (2 * k + 1)) / (2 * order);
      p.push(cx(-Math.sinh(mu) * Math.sin(theta), Math.cosh(mu) * Math.cos(theta)));
    }
    // DC gain 1 for odd orders and 1/√(1 + ε²) for even ones: k = Π(−p), scaled for even orders.
    let k = p.reduce((acc, pole) => cmul(acc, cscale(pole, -1)), cx(1)).re;
    if (order % 2 === 0) k /= Math.sqrt(1 + eps * eps);
    return { z, p, k };
  }
  if (type === 'elliptic') return ellipticPrototype(order, rippleDb, stopDb);
  // Chebyshev II: equiripple stopband from the edge at 1 rad/s, with the poles of the type I filter inverted.
  const eps = 1 / Math.sqrt(10 ** (stopDb / 10) - 1);
  const mu = Math.asinh(1 / eps) / order;
  for (let k = 0; k < order; k += 1) {
    const theta = (Math.PI * (2 * k + 1)) / (2 * order);
    const pole = cx(-Math.sinh(mu) * Math.sin(theta), Math.cosh(mu) * Math.cos(theta));
    p.push(cdiv(cx(1), pole));
    if (2 * k + 1 !== order) z.push(cx(0, 1 / Math.cos(theta)));
  }
  const prod = (roots: Complex[]) => roots.reduce((acc, r) => cmul(acc, cscale(r, -1)), cx(1));
  return { z, p, k: cdiv(prod(p), prod(z)).re };
}

/** Moves a lowpass prototype (edge 1 rad/s) to the band asked for, with edges in rad/s. */
function transform(proto: Zpk, band: Band, w1: number, w2: number): Zpk {
  const { z, p, k } = proto;
  const degree = p.length - z.length;
  if (band === 'lowpass') {
    return { z: z.map((r) => cscale(r, w1)), p: p.map((r) => cscale(r, w1)), k: k * w1 ** degree };
  }
  if (band === 'highpass') {
    const inv = (r: Complex) => cdiv(cx(w1), r);
    const zs = [...z.map(inv), ...Array.from({ length: degree }, () => cx(0))];
    const minus = (rs: Complex[]) => rs.reduce((acc, r) => cmul(acc, cscale(r, -1)), cx(1));
    return { z: zs, p: p.map(inv), k: k * cdiv(minus(z), minus(p)).re };
  }
  const w0 = Math.sqrt(w1 * w2);
  const bw = w2 - w1;
  const split = (r: Complex): Complex[] => {
    // s → (s² + w0²)/(s·bw) for a bandpass; each root r gives the two roots of s² − r·bw·s + w0² = 0.
    const half = cscale(r, bw / 2);
    const root = csqrtc(csub(cmul(half, half), cx(w0 * w0)));
    return [cadd(half, root), csub(half, root)];
  };
  if (band === 'bandpass') {
    return {
      z: [...z.flatMap(split), ...Array.from({ length: degree }, () => cx(0))],
      p: p.flatMap(split),
      k: k * bw ** degree,
    };
  }
  // Bandstop: s → s·bw/(s² + w0²); a root r becomes the roots of s² − (bw/r)s + w0² = 0.
  const splitStop = (r: Complex): Complex[] => {
    const half = cscale(cdiv(cx(1), r), bw / 2);
    const root = csqrtc(csub(cmul(half, half), cx(w0 * w0)));
    return [cadd(half, root), csub(half, root)];
  };
  const minus = (rs: Complex[]) => rs.reduce((acc, r) => cmul(acc, cscale(r, -1)), cx(1));
  return {
    z: [...z.flatMap(splitStop), ...Array.from({ length: 2 * degree }, (_, i) => cx(0, i % 2 ? -w0 : w0))],
    p: p.flatMap(splitStop),
    k: k * cdiv(minus(z), minus(p)).re,
  };
}

function csqrtc(a: Complex): Complex {
  const r = cabs(a);
  const re = Math.sqrt(Math.max(0, (r + a.re) / 2));
  const im = Math.sqrt(Math.max(0, (r - a.re) / 2));
  return cx(re, a.im < 0 ? -im : im);
}

/** Real polynomial coefficients (highest power first) of Π(x − r). */
function poly(roots: readonly Complex[]): number[] {
  let c: Complex[] = [cx(1)];
  for (const r of roots) {
    const next = [...c, cx(0)];
    for (let i = 1; i < next.length; i += 1) next[i] = csub(next[i]!, cmul(r, c[i - 1]!));
    c = next;
  }
  return c.map((v) => v.re);
}

/** Pairs complex-conjugate roots (and leftover real ones) into quadratics, highest power first. */
function quadratics(roots: readonly Complex[]): number[][] {
  const left = [...roots];
  const out: number[][] = [];
  while (left.length) {
    const r = left.shift()!;
    if (Math.abs(r.im) > 1e-10) {
      const j = left.findIndex((o) => Math.abs(o.re - r.re) < 1e-8 && Math.abs(o.im + r.im) < 1e-8);
      if (j >= 0) left.splice(j, 1);
      out.push(poly([r, cx(r.re, -r.im)]));
    } else {
      const j = left.findIndex((o) => Math.abs(o.im) <= 1e-10);
      if (j >= 0) out.push(poly([r, left.splice(j, 1)[0]!]));
      else out.push([0, ...poly([r])]);
    }
  }
  return out;
}

/** Second-order sections from digital zeros, poles, and gain; the gain goes in the first section. */
function toSos(z: Complex[], p: Complex[], k: number): number[][] {
  const pole = quadratics([...p].sort((x, y) => cabs(y) - cabs(x)));
  const zero = quadratics([...z].sort((x, y) => cabs(y) - cabs(x)));
  return pole.map((den, i) => {
    const num = (zero[i] ?? [0, 0, 1]).map((v) => (i === 0 ? v * k : v));
    const pad = (c: number[]) => (c[0] === 0 && c.length === 3 ? [c[1]!, c[2]!, 0] : c);
    return [...pad(num), ...pad(den)];
  });
}

/**
 * An IIR filter from an analog prototype by the bilinear transform s = 2fs (z − 1)/(z + 1), with each edge
 * prewarped (Ω = 2fs tan(πf/fs)) so it lands exactly where asked.
 */
export function iirBilinear(
  type: Prototype,
  band: Band,
  order: number,
  f1: number,
  f2: number,
  fs: number,
  rippleDb = 1,
  stopDb = 40,
): Filter {
  checkRate(fs);
  if (!Number.isInteger(order) || order < 1 || order > 12) throw new SignalError('order', { min: 1, max: 12 });
  const elliptic = type === 'elliptic';
  if ((type === 'chebyshev1' || elliptic) && !(rippleDb > 0 && rippleDb < 10)) throw new SignalError('ripple');
  if ((type === 'chebyshev2' || elliptic) && !(stopDb > 0 && stopDb < 200)) throw new SignalError('attenuation');
  if (elliptic && !(stopDb > rippleDb)) throw new SignalError('ellipticSpec');
  edges(band, f1, f2, fs);
  const warp = (f: number) => 2 * fs * Math.tan((Math.PI * f) / fs);
  const proto = analogPrototype(type, order, rippleDb, stopDb);
  const analog = transform(proto, band, warp(f1), warp(f2));
  const c = cx(2 * fs);
  const map = (r: Complex) => cdiv(cadd(c, r), csub(c, r));
  const zd = [...analog.z.map(map), ...Array.from({ length: analog.p.length - analog.z.length }, () => cx(-1))];
  const pd = analog.p.map(map);
  const gain = analog.z.reduce((acc, r) => cmul(acc, csub(c, r)), cx(analog.k));
  const kd = cdiv(
    gain,
    analog.p.reduce((acc, r) => cmul(acc, csub(c, r)), cx(1)),
  ).re;
  const b = poly(zd).map((v) => v * kd);
  const a = poly(pd);
  return {
    b,
    a,
    sos: toSos(zd, pd, kd),
    steps: [
      step(
        'filterPrewarp',
        `Ω = 2fs·tan(πf/fs) = ${fmt(warp(f1))}${band === 'bandpass' || band === 'bandstop' ? `, ${fmt(warp(f2))}` : ''} rad/s`,
      ),
      step(`filterProto_${type}`, undefined, { order }),
      ...(proto.selectivity
        ? [step('filterEllipticEdge', `k = ${fmt(proto.selectivity)}, Ωs/Ωp = 1/k = ${fmt(1 / proto.selectivity)}`)]
        : []),
      step('filterBilinear', `s = 2·${fmt(fs)}·(z − 1)/(z + 1)`),
      step('filterSos', undefined, { count: Math.ceil(pd.length / 2) }),
    ],
  };
}

/**
 * A lowpass IIR filter by impulse invariance: each analog pole p with residue r becomes T·r/(1 − e^{pT} z⁻¹), so
 * the digital impulse response is T times the sampled analog one. No prewarping; aliasing shows near Nyquist.
 */
export function iirImpulseInvariant(
  type: 'butterworth' | 'chebyshev1',
  order: number,
  fc: number,
  fs: number,
  rippleDb = 1,
): Filter {
  checkRate(fs);
  if (!Number.isInteger(order) || order < 1 || order > 12) throw new SignalError('order', { min: 1, max: 12 });
  edges('lowpass', fc, 0, fs);
  const analog = transform(analogPrototype(type, order, rippleDb, 40), 'lowpass', 2 * Math.PI * fc, 0);
  const T = 1 / fs;
  const residues = analog.p.map((pi, i) =>
    cdiv(
      cx(analog.k),
      analog.p.reduce((acc, pj, j) => (j === i ? acc : cmul(acc, csub(pi, pj))), cx(1)),
    ),
  );
  const poles = analog.p.map((pi) => cexp(cscale(pi, T)));
  // Σ T r_i / (1 − q_i z⁻¹) over a common denominator Π(1 − q_j z⁻¹).
  let num: Complex[] = Array.from({ length: poles.length }, () => cx(0));
  residues.forEach((r, i) => {
    let term: Complex[] = [cscale(r, T)];
    poles.forEach((q, j) => {
      if (j === i) return;
      const next = [...term, cx(0)];
      for (let n = 1; n < next.length; n += 1) next[n] = csub(next[n]!, cmul(q, term[n - 1]!));
      term = next;
    });
    num = num.map((v, n) => cadd(v, term[n] ?? cx(0)));
  });
  const b = num.map((v) => v.re);
  const a = poly(poles);
  return {
    b,
    a,
    steps: [
      step('filterImpulseInvariance', `p → e^{pT}, T = 1/${fmt(fs)} s`),
      step(`filterProto_${type}`, undefined, { order }),
    ],
  };
}

/** A moving average of m points: b = 1/m each. */
export function movingAverage(m: number): Filter {
  if (!Number.isInteger(m) || m < 1 || m > 1024) throw new SignalError('taps');
  return { b: Array<number>(m).fill(1 / m), a: [1], steps: [step('filterMovingAverage', `b = 1/${m}`, { m })] };
}

/** A second-order notch at f0 with a −3 dB width of bw: zeros on the unit circle, poles at radius 1 − π·bw/fs. */
export function notch(f0: number, bw: number, fs: number): Filter {
  checkRate(fs);
  edges('lowpass', f0, 0, fs);
  if (!(bw > 0 && bw < fs / 2)) throw new SignalError('notchWidth');
  const w0 = (2 * Math.PI * f0) / fs;
  const r = 1 - (Math.PI * bw) / fs;
  const b = [1, -2 * Math.cos(w0), 1];
  const a = [1, -2 * r * Math.cos(w0), r * r];
  const dc = (1 - 2 * r * Math.cos(w0) + r * r) / (2 - 2 * Math.cos(w0));
  return {
    b: b.map((v) => v * dc),
    a,
    steps: [
      step('filterNotchZeros', `z = e^{±jω₀}, ω₀ = 2π·${fmt(f0)}/${fmt(fs)} = ${fmt(w0)}`),
      step('filterNotchPoles', `r = 1 − π·${fmt(bw)}/${fmt(fs)} = ${fmt(r)}`),
    ],
  };
}

/** Rounds coefficients to signed fixed point with `bits` bits, the integer bits just enough for the largest. */
export function quantizeCoefficients(c: readonly number[], bits: number): { values: number[]; fraction: number } {
  if (!Number.isInteger(bits) || bits < 2 || bits > 32) throw new SignalError('coefficientBits');
  const largest = Math.max(...c.map(Math.abs), 1e-300);
  const integer = Math.max(0, Math.ceil(Math.log2(largest + 1e-15)));
  const fraction = bits - 1 - integer;
  const scale = 2 ** fraction;
  const top = 2 ** (bits - 1) - 1;
  return {
    values: c.map((v) => Math.max(-top - 1, Math.min(top, Math.round(v * scale))) / scale),
    fraction,
  };
}
