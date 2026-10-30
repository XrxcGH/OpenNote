// Frequency response of an open loop L(s) e^(−sT). The Bode plot is evaluated exactly on a log grid, with the
// straight-line magnitude asymptotes beside it. The margins come with their crossover frequencies. For unity
// feedback the closed loop's bandwidth and resonant peak follow. The Nyquist criterion counts the winding of 1 + L
// around the indented contour. The phase is the sum of each factor's angle, so it is continuous and starts where a
// textbook plot does.
import { ControlError } from '../lib/errors';
import { brent, goldenMax, rootsOnGrid } from '../lib/num';
import { step, type Step } from '../lib/steps';
import { padd } from '../lib/poly';
import { cabs, cadd, cdiv, cmul, cx, evalTF, fmt, order, rootsOf, zpk, type Complex, type TF } from '../lib/tf';

export const DEG = 180 / Math.PI;

export interface Loop {
  readonly g: TF;
  /** The time delay T in seconds (0 for none). */
  readonly delay: number;
  readonly zeros: Complex[];
  readonly poles: Complex[];
  readonly k: number;
}

export function makeLoop(g: TF, delay = 0): Loop {
  if (order(g.num) > order(g.den)) throw new ControlError('improper');
  if (g.num.every((c) => c === 0)) throw new ControlError('locusZeroGain');
  if (!(delay >= 0) || !Number.isFinite(delay)) throw new ControlError('delayRange');
  const z = zpk(g);
  return { g, delay, zeros: z.zeros, poles: z.poles, k: z.k };
}

const expj = (theta: number): Complex => cx(Math.cos(theta), Math.sin(theta));

/** L(s) e^(−sT) at a complex s. */
export const loopAt = (l: Loop, s: Complex): Complex => {
  const g = evalTF(l.g, s);
  if (!l.delay) return g;
  return cmul(g, cmul(cx(Math.exp(-s.re * l.delay), 0), expj(-s.im * l.delay)));
};

/** The magnitude of L(jω) in dB. */
export const magDb = (l: Loop, w: number): number => 20 * Math.log10(cabs(loopAt(l, cx(0, w))));

/** The phase of L(jω) in degrees as the sum of its factors' angles, continuous in ω. */
export function phaseDeg(l: Loop, w: number): number {
  const s = cx(0, w);
  let p = l.k < 0 ? -180 : 0;
  for (const z of l.zeros) p += Math.atan2(s.im - z.im, s.re - z.re) * DEG;
  for (const q of l.poles) p -= Math.atan2(s.im - q.im, s.re - q.re) * DEG;
  return p - w * l.delay * DEG;
}

/** The corner frequencies: the size of each nonzero pole and zero. */
export function corners(l: Loop): number[] {
  const all = [...l.zeros, ...l.poles].map(cabs).filter((x) => x > 1e-12);
  return [...new Set(all.map((x) => Number(x.toPrecision(9))))].sort((a, b) => a - b);
}

/** A log grid from two decades below the lowest corner to two above the highest, or as given. */
export function grid(l: Loop, lo?: number, hi?: number, points = 600): number[] {
  const c = corners(l);
  const a = lo ?? (c.length ? c[0] / 100 : 0.01);
  const b = hi ?? Math.max(c.length ? c[c.length - 1] * 100 : 100, l.delay ? 50 / l.delay : 0);
  if (!(a > 0 && b > a)) throw new ControlError('rangeOrder');
  const la = Math.log10(a);
  const lb = Math.log10(b);
  return Array.from({ length: points }, (_, i) => 10 ** (la + ((lb - la) * i) / (points - 1)));
}

export interface Asymptote {
  /** The Bode gain K_B in L = K_B Π(1 − s/z) / (sᴺ Π(1 − s/p)). */
  readonly bodeGain: number;
  /** Poles at the origin less zeros there. */
  readonly type: number;
  readonly breaks: { readonly w: number; readonly change: number }[];
}

export function asymptote(l: Loop): Asymptote {
  const at0 = (z: Complex) => cabs(z) <= 1e-12;
  let gain: Complex = cx(l.k);
  for (const z of l.zeros) if (!at0(z)) gain = cmul(gain, cx(-z.re, -z.im));
  for (const p of l.poles) if (!at0(p)) gain = cdiv(gain, cx(-p.re, -p.im));
  const type = l.poles.filter(at0).length - l.zeros.filter(at0).length;
  const changes = new Map<number, number>();
  const add = (z: Complex, slope: number) => {
    if (at0(z)) return;
    const w = Number(cabs(z).toPrecision(9));
    changes.set(w, (changes.get(w) ?? 0) + slope);
  };
  l.zeros.forEach((z) => add(z, 20));
  l.poles.forEach((p) => add(p, -20));
  const breaks = [...changes.entries()].sort((a, b) => a[0] - b[0]).map(([w, change]) => ({ w, change }));
  return { bodeGain: gain.re, type, breaks };
}

/** The straight-line magnitude in dB at ω. */
export function asymptoteDb(a: Asymptote, w: number): number {
  let db = 20 * Math.log10(Math.abs(a.bodeGain)) - 20 * a.type * Math.log10(w);
  for (const b of a.breaks) if (w > b.w) db += b.change * Math.log10(w / b.w);
  return db;
}

/** Roots of f on the grid, refined by Brent's method on log ω. */
function crossings(f: (w: number) => number, ws: readonly number[]): number[] {
  const g = (lw: number) => f(10 ** lw);
  return rootsOnGrid(g, ws.map(Math.log10), 1e-14).map((lw) => 10 ** lw);
}

export interface Margins {
  readonly gainCrossovers: number[];
  readonly phaseCrossovers: number[];
  /** The smallest phase margin over the gain crossovers, in degrees. */
  readonly pm: number;
  readonly wgc: number;
  /** The smallest gain margin over the phase crossovers, in dB. */
  readonly gm: number;
  readonly wpc: number;
  /** The delay margin PM/ω_gc in seconds. */
  readonly delayMargin: number;
}

export function margins(l: Loop, ws: readonly number[]): Margins {
  const gainCrossovers = crossings((w) => magDb(l, w), ws);
  // The phase crosses −180° (mod 360°) where L(jω) is real and negative.
  const phaseCrossovers = crossings((w) => loopAt(l, cx(0, w)).im, ws).filter((w) => loopAt(l, cx(0, w)).re < 0);
  let pm = Infinity;
  let wgc = Number.NaN;
  for (const w of gainCrossovers) {
    const v = normalizePm(phaseDeg(l, w));
    if (v < pm) {
      pm = v;
      wgc = w;
    }
  }
  let gm = Infinity;
  let wpc = Number.NaN;
  for (const w of phaseCrossovers) {
    const v = -magDb(l, w);
    if (Math.abs(v) < Math.abs(gm)) {
      gm = v;
      wpc = w;
    }
  }
  return {
    gainCrossovers,
    phaseCrossovers,
    pm,
    wgc,
    gm,
    wpc,
    delayMargin: Number.isFinite(pm) && pm > 0 ? pm / DEG / wgc : Number.NaN,
  };
}

/** PM = 180° + ∠L, brought into (−180°, 180°]. */
export function normalizePm(phase: number): number {
  const v = ((((180 + phase + 180) % 360) + 360) % 360) - 180;
  return v === -180 ? 180 : v;
}

export interface Closed {
  readonly dc: number;
  readonly peakDb: number;
  readonly wPeak: number;
  readonly bandwidth: number;
}

/** The closed loop T = L/(1 + L) with unity feedback: DC gain, resonant peak, and the −3 dB bandwidth. */
export function closedLoop(l: Loop, ws: readonly number[]): Closed {
  const t = (w: number) => {
    const v = loopAt(l, cx(0, w));
    return cabs(cdiv(v, cadd(cx(1), v)));
  };
  const lowW = ws[0] / 1e3;
  const dc = t(lowW);
  let peak = -Infinity;
  let wPeak = Number.NaN;
  let iPeak = -1;
  ws.forEach((w, i) => {
    const v = 20 * Math.log10(t(w));
    if (v > peak) {
      peak = v;
      wPeak = w;
      iPeak = i;
    }
  });
  // Refine an interior grid maximum on log ω between its neighbors; a peak at the grid's end is left as is.
  if (iPeak > 0 && iPeak < ws.length - 1) {
    const g = (lw: number) => t(10 ** lw);
    const lw = goldenMax(g, Math.log10(ws[iPeak - 1]), Math.log10(ws[iPeak + 1]), 1e-14);
    const v = 20 * Math.log10(g(lw));
    if (v >= peak) {
      peak = v;
      wPeak = 10 ** lw;
    }
  }
  const target = 20 * Math.log10(dc) - 20 * Math.log10(Math.SQRT2);
  const f = (lw: number) => 20 * Math.log10(t(10 ** lw)) - target;
  let bandwidth = Number.NaN;
  const lws = ws.map(Math.log10);
  for (let i = 1; i < lws.length; i += 1) {
    if (f(lws[i - 1]) >= 0 && f(lws[i]) < 0) {
      bandwidth = 10 ** brent(f, lws[i - 1], lws[i], 1e-14);
      break;
    }
  }
  return { dc, peakDb: peak - 20 * Math.log10(dc), wPeak, bandwidth };
}

export interface Nyquist {
  /** Open-loop poles in the right half-plane. */
  readonly p: number;
  /** Counter-clockwise encirclements of −1. */
  readonly ccw: number;
  /** Closed-loop poles in the right half-plane, Z = P − (counter-clockwise encirclements). */
  readonly z: number;
  /** L along the upper half of the contour, ω from 0⁺ to ∞, as points. */
  readonly upper: Complex[];
  readonly axisPoles: number;
  /** Without delay, the closed-loop poles, as a check; with a delay, null. */
  readonly closedPoles: Complex[] | null;
  /** A closed-loop pole lies on the imaginary axis, so the count is on the boundary. */
  readonly marginal: boolean;
}

/**
 * The winding of 1 + L around the origin as s runs up the imaginary axis, stepping round each pole on the axis by a
 * small semicircle to its right; the large semicircle adds nothing because L is proper.
 */
export function nyquist(l: Loop): Nyquist {
  const scale = Math.max(1, ...l.poles.map(cabs), ...l.zeros.map(cabs), l.delay ? 1 / l.delay : 0);
  const onAxis = l.poles.filter((p) => Math.abs(p.re) <= 1e-9 * Math.max(1, cabs(p)));
  const p = l.poles.filter((q) => q.re > 1e-9 * Math.max(1, cabs(q))).length;
  if (l.delay && order(l.g.num) === order(l.g.den)) throw new ControlError('delayProper');
  const r = 1e-4 * scale;
  const big = 1e5 * scale;
  // The path, as pieces s(u) for u in [0, 1].
  const centres = [...new Set(onAxis.map((q) => Number(q.im.toPrecision(12))))].sort((a, b) => a - b);
  const pieces: ((u: number) => Complex)[] = [];
  let from = -big;
  for (const c of centres) {
    const a = from;
    const b = c - r;
    pieces.push(logLine(a, b));
    pieces.push((u) => cadd(cx(0, c), cmul(cx(r), expj(-Math.PI / 2 + Math.PI * u))));
    from = c + r;
  }
  pieces.push(logLine(from, big));
  let total = 0;
  for (const piece of pieces) total += windingOf((u) => cadd(cx(1), loopAt(l, piece(u))), 0, 1);
  const ccw = Math.round(total / (2 * Math.PI));
  const ws = grid(l, undefined, undefined, 800);
  const closedPoles = l.delay ? null : rootsOf(padd(l.g.den, l.g.num));
  const near = (w: number) => cabs(cadd(cx(1), loopAt(l, cx(0, w)))) < 1e-7;
  const marginal = closedPoles
    ? closedPoles.some((q) => Math.abs(q.re) <= 1e-7 * Math.max(1, cabs(q)))
    : margins(l, ws).phaseCrossovers.some(near);
  return {
    closedPoles,
    marginal,
    p,
    ccw,
    z: p - ccw,
    upper: ws.map((w) => loopAt(l, cx(0, w))),
    axisPoles: onAxis.length,
  };
}

/** A straight piece of the imaginary axis from ja to jb, spaced evenly in sinh⁻¹ so both small and large ω are fine. */
function logLine(a: number, b: number): (u: number) => Complex {
  const sa = Math.asinh(a);
  const sb = Math.asinh(b);
  return (u) => cx(0, Math.sinh(sa + (sb - sa) * u));
}

/** The change of angle of f(u) over [a, b], subdividing until each step turns by less than 20°. */
function windingOf(f: (u: number) => Complex, a: number, b: number): number {
  let total = 0;
  const stack: [number, number, Complex, Complex, number][] = [];
  // Start from many even pieces, so a curve that leaves and returns to the same point is not taken as one step.
  const pieces = 512;
  let prev = f(a);
  for (let i = 1; i <= pieces; i += 1) {
    const u = a + ((b - a) * i) / pieces;
    const v = f(u);
    stack.push([a + ((b - a) * (i - 1)) / pieces, u, prev, v, 0]);
    prev = v;
  }
  while (stack.length) {
    const [u0, u1, v0, v1, depth] = stack.pop() as [number, number, Complex, Complex, number];
    const turn = Math.atan2(v0.re * v1.im - v0.im * v1.re, v0.re * v1.re + v0.im * v1.im);
    if (Math.abs(turn) < 0.35 || depth > 40) {
      total += turn;
      continue;
    }
    const um = (u0 + u1) / 2;
    const vm = f(um);
    stack.push([u0, um, v0, vm, depth + 1], [um, u1, vm, v1, depth + 1]);
  }
  return total;
}

export function marginSteps(l: Loop, m: Margins): Step[] {
  const steps: Step[] = [];
  if (Number.isFinite(m.wgc)) {
    steps.push(
      step('freq.gainCrossover', { w: fmt(m.wgc) }, `|L(j\\omega_{gc})| = 1 \\Rightarrow \\omega_{gc} = ${fmt(m.wgc)}`),
      step(
        'freq.pm',
        { phase: fmt(phaseDeg(l, m.wgc)), pm: fmt(m.pm) },
        `PM = 180^\\circ + \\angle L(j\\omega_{gc}) = ${fmt(m.pm)}^\\circ`,
      ),
    );
  } else steps.push(step('freq.noGainCrossover'));
  if (Number.isFinite(m.wpc)) {
    steps.push(
      step(
        'freq.phaseCrossover',
        { w: fmt(m.wpc) },
        `\\angle L(j\\omega_{pc}) = -180^\\circ \\Rightarrow \\omega_{pc} = ${fmt(m.wpc)}`,
      ),
      step(
        'freq.gm',
        { mag: fmt(10 ** (-m.gm / 20)), gm: fmt(m.gm) },
        `GM = -20\\log_{10}|L(j\\omega_{pc})| = ${fmt(m.gm)}\\ \\text{dB}`,
      ),
    );
  } else steps.push(step('freq.noPhaseCrossover'));
  return steps;
}
