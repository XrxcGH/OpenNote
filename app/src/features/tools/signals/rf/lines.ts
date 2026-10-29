// Transmission lines: reflection at a load, input impedance along lossless and lossy lines, the standing-wave
// pattern, Smith chart geometry, matching networks, and the impedance of common line types. Impedances are in ohms,
// lengths in wavelengths unless named. Pure: no DOM.
import { SignalError } from '../shared/errors';
import { cabs, cadd, carg, cdiv, cexp, cmul, csub, cx, fmt, fmtComplex, type Complex } from '../shared/num';
import { step, type Step } from '../shared/steps';

export const SPEED_OF_LIGHT = 299_792_458;
const ONE = cx(1);

function checkZ0(z0: number): number {
  if (!(z0 > 0) || !Number.isFinite(z0)) throw new SignalError('impedance');
  return z0;
}

function checkLoad(zl: Complex): Complex {
  if (!Number.isFinite(zl.re) || !Number.isFinite(zl.im)) throw new SignalError('loadImpedance');
  if (zl.re < 0) throw new SignalError('negativeResistance');
  return zl;
}

/** Γ = (ZL − Z0)/(ZL + Z0). */
export const gammaOf = (zl: Complex, z0: number): Complex => cdiv(csub(zl, cx(z0)), cadd(zl, cx(z0)));
/** Z = Z0 (1 + Γ)/(1 − Γ). */
export const impedanceOf = (gamma: Complex, z0: number): Complex =>
  cmul(cx(z0), cdiv(cadd(ONE, gamma), csub(ONE, gamma)));

export interface Reflection {
  gamma: Complex;
  magnitude: number;
  angleDeg: number;
  vswr: number;
  returnLossDb: number;
  mismatchLossDb: number;
  steps: Step[];
}

export function reflection(zl: Complex, z0: number): Reflection {
  checkZ0(z0);
  checkLoad(zl);
  const gamma = gammaOf(zl, z0);
  const magnitude = cabs(gamma);
  const vswr = magnitude >= 1 ? Infinity : (1 + magnitude) / (1 - magnitude);
  const returnLossDb = magnitude === 0 ? Infinity : -20 * Math.log10(magnitude);
  const mismatchLossDb = magnitude >= 1 ? Infinity : -10 * Math.log10(1 - magnitude ** 2);
  return {
    gamma,
    magnitude,
    angleDeg: (carg(gamma) * 180) / Math.PI,
    vswr,
    returnLossDb,
    mismatchLossDb,
    steps: [
      step('rfGamma', `Γ = (${fmtComplex(zl)} − ${fmt(z0)})/(${fmtComplex(zl)} + ${fmt(z0)}) = ${fmtComplex(gamma)}`),
      step('rfVswr', `VSWR = (1 + ${fmt(magnitude)})/(1 − ${fmt(magnitude)}) = ${fmt(vswr)}`),
      step('rfReturnLoss', `RL = −20·log₁₀ ${fmt(magnitude)} = ${fmt(returnLossDb)} dB`),
      step('rfMismatch', `ML = −10·log₁₀(1 − ${fmt(magnitude)}²) = ${fmt(mismatchLossDb)} dB`),
    ],
  };
}

const ctanh = (z: Complex): Complex => {
  // tanh z = (e^{2z} − 1)/(e^{2z} + 1); for a large real part it is ±1.
  if (z.re > 20) return ONE;
  const e = cexp(cx(2 * z.re, 2 * z.im));
  return cdiv(csub(e, ONE), cadd(e, ONE));
};

/**
 * Input impedance of a line of length `wavelengths` ending in ZL, with loss in decibels per wavelength:
 * Zin = Z0 (ZL + Z0 tanh γl)/(Z0 + ZL tanh γl), γl = αl + jβl.
 */
export function inputImpedance(
  zl: Complex,
  z0: number,
  wavelengths: number,
  lossDbPerWavelength = 0,
): {
  zin: Complex;
  gammaIn: Complex;
  steps: Step[];
} {
  checkZ0(z0);
  checkLoad(zl);
  if (!Number.isFinite(wavelengths) || wavelengths < 0) throw new SignalError('lineLength');
  if (!(lossDbPerWavelength >= 0) || !Number.isFinite(lossDbPerWavelength)) throw new SignalError('lineLoss');
  const betaL = 2 * Math.PI * wavelengths;
  const alphaL = (lossDbPerWavelength * wavelengths) / 8.685889638;
  const t = ctanh(cx(alphaL, betaL));
  const z0c = cx(z0);
  // An open load (infinite impedance) is the limit Z0/tanh γl.
  const zin = cmul(z0c, cdiv(cadd(zl, cmul(z0c, t)), cadd(z0c, cmul(zl, t))));
  return {
    zin,
    gammaIn: gammaOf(zin, z0),
    steps: [
      step('rfElectrical', `βl = 2π·${fmt(wavelengths)} = ${fmt(betaL)} rad; αl = ${fmt(alphaL)} Np`),
      step('rfZin', `Zin = Z0 (ZL + Z0 tanh γl)/(Z0 + ZL tanh γl) = ${fmtComplex(zin)} Ω`),
    ],
  };
}

/** |V(d)|/|V⁺| = |1 + Γ e^{−j2βd}| from the load (d = 0) toward the generator, over `wavelengths`. */
export function standingWave(gamma: Complex, wavelengths: number, points = 241): { d: number[]; v: number[] } {
  const d: number[] = [];
  const v: number[] = [];
  for (let i = 0; i < points; i += 1) {
    const at = (i / (points - 1)) * wavelengths;
    const turn = -4 * Math.PI * at;
    d.push(at);
    v.push(cabs(cadd(ONE, cmul(gamma, cx(Math.cos(turn), Math.sin(turn))))));
  }
  return { d, v };
}

/** Smith chart grid: circles of constant resistance and arcs of constant reactance, as one path with NaN gaps. */
export function smithGrid(): { x: number[]; y: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  const add = (z: Complex) => {
    const g = cdiv(csub(z, ONE), cadd(z, ONE));
    x.push(g.re);
    y.push(g.im);
  };
  const gap = () => {
    x.push(Number.NaN);
    y.push(Number.NaN);
  };
  const spread = Array.from({ length: 121 }, (_, i) => Math.sinh((i - 60) / 10) * 3);
  for (const r of [0, 0.2, 0.5, 1, 2, 5]) {
    spread.forEach((reactance) => add(cx(r, reactance)));
    gap();
  }
  const resistances = Array.from({ length: 81 }, (_, i) => Math.expm1(i / 10) * 0.05);
  for (const reactance of [-5, -2, -1, -0.5, -0.2, 0, 0.2, 0.5, 1, 2, 5]) {
    resistances.forEach((r) => add(cx(r, reactance)));
    gap();
  }
  return { x, y };
}

/** A circle of radius |Γ| about the chart's center: the constant-VSWR circle. */
export function vswrCircle(magnitude: number, points = 181): { x: number[]; y: number[] } {
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < points; i += 1) {
    const a = (2 * Math.PI * i) / (points - 1);
    x.push(magnitude * Math.cos(a));
    y.push(magnitude * Math.sin(a));
  }
  return { x, y };
}

export type ElementKind = 'seriesL' | 'seriesC' | 'shuntL' | 'shuntC';

export interface LElement {
  kind: ElementKind;
  /** Henries or farads. */
  value: number;
  /** The reactance (series) or susceptance (shunt) it supplies. */
  reactance: number;
}

export interface LSolution {
  /** Which element sits next to the load: the shunt one (RL above Z0) or the series one (RL below Z0). */
  nextToLoad: 'shunt' | 'series';
  series: LElement;
  shunt: LElement;
}

const seriesElement = (x: number, omega: number): LElement =>
  x >= 0
    ? { kind: 'seriesL', value: x / omega, reactance: x }
    : { kind: 'seriesC', value: -1 / (omega * x), reactance: x };
const shuntElement = (b: number, omega: number): LElement =>
  b >= 0
    ? { kind: 'shuntC', value: b / omega, reactance: b }
    : { kind: 'shuntL', value: -1 / (omega * b), reactance: b };

/**
 * L-section matches from a Z0 source to a load, by the closed forms in Pozar's Microwave Engineering (section 5.1):
 * every topology that works, up to four. Each element's reactance becomes an inductor or a capacitor at f.
 */
export function lSection(zl: Complex, z0: number, frequency: number): { solutions: LSolution[]; steps: Step[] } {
  checkZ0(z0);
  checkLoad(zl);
  if (!(frequency > 0) || !Number.isFinite(frequency)) throw new SignalError('rfFrequency');
  if (zl.re === 0) throw new SignalError('reactiveLoad');
  const omega = 2 * Math.PI * frequency;
  const { re: r, im: x } = zl;
  const solutions: LSolution[] = [];
  const mag2 = r * r + x * x;
  // Shunt element next to the load: needs RL > Z0 (or a reactive part that brings it inside the 1 + jx circle).
  const inner = (r / z0) * (mag2 - z0 * r);
  if (inner >= 0) {
    for (const sign of [1, -1]) {
      const b = (x + sign * Math.sqrt(inner)) / mag2;
      if (Math.abs(b) < 1e-15) continue;
      const reactance = 1 / b + (x * z0) / r - z0 / (b * r);
      solutions.push({ nextToLoad: 'shunt', series: seriesElement(reactance, omega), shunt: shuntElement(b, omega) });
    }
  }
  // Series element next to the load: needs RL < Z0.
  if (r < z0) {
    for (const sign of [1, -1]) {
      const reactance = sign * Math.sqrt(r * (z0 - r)) - x;
      const b = (sign * Math.sqrt((z0 - r) / r)) / z0;
      solutions.push({ nextToLoad: 'series', series: seriesElement(reactance, omega), shunt: shuntElement(b, omega) });
    }
  }
  const q = Math.sqrt(Math.max(r, z0) / Math.min(r, z0) - 1);
  return {
    solutions,
    steps: [
      step('rfLq', `Q = √(R_high/R_low − 1) = ${fmt(q)}`),
      step('rfLValues', `ω = 2π·${fmt(frequency)} = ${fmt(omega)} rad/s; L = X/ω, C = B/ω`),
    ],
  };
}

export interface StubSolution {
  /** Distance from the load to the stub, in wavelengths. */
  d: number;
  /** Stub length in wavelengths. */
  length: number;
  /** The susceptance (shunt) or reactance (series) the line shows at d, which the stub cancels. */
  cancel: number;
}

/** Points d in [0, 0.5) where f(d) crosses 0, by a scan and bisection. */
function crossings(f: (d: number) => number): number[] {
  const found: number[] = [];
  const n = 2000;
  let a = 0;
  let fa = f(0);
  for (let i = 1; i <= n; i += 1) {
    const b = (0.5 * i) / n;
    const fb = f(b);
    if (fa === 0) found.push(a);
    else if (Number.isFinite(fa) && Number.isFinite(fb) && fa * fb < 0) {
      let lo = a;
      let hi = b;
      let flo = fa;
      for (let k = 0; k < 80; k += 1) {
        const mid = (lo + hi) / 2;
        const fm = f(mid);
        if (flo * fm <= 0) hi = mid;
        else [lo, flo] = [mid, fm];
      }
      // A pole of f (from a tan) also changes sign; keep only true zeros.
      if (Math.abs(f((lo + hi) / 2)) < 1e-6) found.push((lo + hi) / 2);
    }
    a = b;
    fa = fb;
  }
  return found;
}

const wrapLength = (turns: number) => ((turns % 0.5) + 0.5) % 0.5;

/**
 * Single-stub matches: where along the line the conductance (shunt) or resistance (series) equals the line's, and
 * the open or short stub that cancels what remains. Found numerically along half a wavelength.
 */
export function singleStub(
  zl: Complex,
  z0: number,
  placement: 'shunt' | 'series',
  end: 'open' | 'short',
): { solutions: StubSolution[]; steps: Step[] } {
  checkZ0(z0);
  checkLoad(zl);
  if (zl.re === 0) throw new SignalError('reactiveLoad');
  const at = (d: number) => inputImpedance(zl, z0, d).zin;
  const solutions: StubSolution[] = [];
  if (placement === 'shunt') {
    const y0 = 1 / z0;
    for (const d of crossings((d) => cdiv(ONE, at(d)).re - y0)) {
      const b = cdiv(ONE, at(d)).im;
      // Short stub: −jY0 cot βl = −jB, so tan βl = Y0/B. Open stub: jY0 tan βl = −jB, so tan βl = −B/Y0.
      const turns = end === 'short' ? Math.atan2(y0, b) : Math.atan(-b / y0);
      solutions.push({ d, length: wrapLength(turns / (2 * Math.PI)), cancel: b });
    }
  } else {
    for (const d of crossings((d) => at(d).re - z0)) {
      const x = at(d).im;
      // Short stub: jZ0 tan βl = −jX. Open stub: −jZ0 cot βl = −jX, so tan βl = Z0/X.
      const turns = end === 'short' ? Math.atan(-x / z0) : Math.atan2(z0, x);
      solutions.push({ d, length: wrapLength(turns / (2 * Math.PI)), cancel: x });
    }
  }
  if (!solutions.length) throw new SignalError('noStub');
  return {
    solutions,
    steps: [
      step(placement === 'shunt' ? 'rfStubShunt' : 'rfStubSeries'),
      step('rfStubLength', solutions.map((s) => `d = ${fmt(s.d, 5)}λ, ℓ = ${fmt(s.length, 5)}λ`).join('; ')),
    ],
  };
}

/** A quarter-wave transformer to a real load, and its fractional bandwidth for a largest tolerated |Γ|. */
export function quarterWave(
  rl: number,
  z0: number,
  gammaMax = 0.1,
): {
  z1: number;
  bandwidth: number;
  steps: Step[];
} {
  checkZ0(z0);
  if (!(rl > 0) || !Number.isFinite(rl)) throw new SignalError('realLoad');
  if (!(gammaMax > 0 && gammaMax < 1)) throw new SignalError('gammaMax');
  const z1 = Math.sqrt(z0 * rl);
  const argument = (gammaMax / Math.sqrt(1 - gammaMax ** 2)) * ((2 * Math.sqrt(z0 * rl)) / Math.abs(rl - z0));
  const bandwidth = rl === z0 || argument >= 1 ? Infinity : 2 - (4 / Math.PI) * Math.acos(argument);
  return {
    z1,
    bandwidth,
    steps: [
      step('rfQuarter', `Z₁ = √(Z0·RL) = √(${fmt(z0)}·${fmt(rl)}) = ${fmt(z1)} Ω`),
      step('rfQuarterBand', `Δf/f₀ = 2 − (4/π)·arccos[Γm/√(1 − Γm²) · 2√(Z0·RL)/|RL − Z0|] = ${fmt(bandwidth)}`),
    ],
  };
}

export type LineType = 'coax' | 'twoWire' | 'microstrip';

export interface LineParameters {
  z0: number;
  effectivePermittivity: number;
  velocityFactor: number;
  steps: Step[];
}

/**
 * The characteristic impedance of a line type. Coax: (60/√εr) ln(D/d). Two-wire: (120/√εr) arcosh(D/d), with D the
 * center spacing. Microstrip: the Hammerstad-Jensen closed forms for W/h at or above 1 and below 1.
 */
export function lineParameters(type: LineType, ratio: number, permittivity: number): LineParameters {
  if (!(permittivity >= 1) || !Number.isFinite(permittivity)) throw new SignalError('permittivity');
  if (!(ratio > 0) || !Number.isFinite(ratio)) throw new SignalError('lineRatio');
  if (type !== 'microstrip' && ratio <= 1) throw new SignalError('lineRatio');
  let z0: number;
  let effective = permittivity;
  const steps: Step[] = [];
  if (type === 'coax') {
    z0 = (60 / Math.sqrt(permittivity)) * Math.log(ratio);
    steps.push(step('rfCoax', `Z0 = (60/√${fmt(permittivity)})·ln ${fmt(ratio)} = ${fmt(z0)} Ω`));
  } else if (type === 'twoWire') {
    z0 = (120 / Math.sqrt(permittivity)) * Math.acosh(ratio);
    steps.push(step('rfTwoWire', `Z0 = (120/√${fmt(permittivity)})·arcosh ${fmt(ratio)} = ${fmt(z0)} Ω`));
  } else {
    const u = ratio;
    effective =
      (permittivity + 1) / 2 + ((permittivity - 1) / 2) * ((1 + 12 / u) ** -0.5 + (u < 1 ? 0.04 * (1 - u) ** 2 : 0));
    z0 =
      u >= 1
        ? (120 * Math.PI) / (Math.sqrt(effective) * (u + 1.393 + 0.667 * Math.log(u + 1.444)))
        : (60 / Math.sqrt(effective)) * Math.log(8 / u + u / 4);
    steps.push(
      step('rfMicrostripEff', `ε_eff = (εr + 1)/2 + (εr − 1)/2·(1 + 12h/W)^(−1/2) = ${fmt(effective)}`),
      step(u >= 1 ? 'rfMicrostripWide' : 'rfMicrostripNarrow', `Z0 = ${fmt(z0)} Ω`),
    );
  }
  return { z0, effectivePermittivity: effective, velocityFactor: 1 / Math.sqrt(effective), steps };
}
