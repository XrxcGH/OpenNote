// AC power: complex power, power factor correction, balanced three-phase circuits, and the per-unit system.
// Everything is in SI units; voltages are rms, angles are in degrees at the edges and radians inside.
import { fail } from '../shared';
import type { Cx } from '../shared';
import { cAbs, cArg, cConj, cMul, cPolar, toDegrees, toRadians } from '../shared';

export type Lag = 'lagging' | 'leading';

export interface LoadPower {
  /** Real power (W). */
  p: number;
  /** Reactive power (var); positive for an inductive (lagging) load. */
  q: number;
  /** Apparent power (VA). */
  s: number;
  pf: number;
  /** The angle of the voltage ahead of the current, in degrees: positive for a lagging load. */
  angle: number;
}

function checkPf(pf: number): void {
  if (!(pf > 0 && pf <= 1)) fail('powerFactor');
}

/** Power from real power and a power factor. A lagging load draws positive reactive power. */
export function fromPowerFactor(p: number, pf: number, lag: Lag): LoadPower {
  checkPf(pf);
  const angle = Math.acos(pf);
  const s = Math.abs(p) / pf;
  const q = (lag === 'lagging' ? 1 : -1) * Math.abs(p) * Math.tan(angle);
  return { p, q, s, pf, angle: (lag === 'lagging' ? 1 : -1) * toDegrees(angle) };
}

/** Power from voltage and current phasors: S = V I*. */
export function fromPhasors(v: Cx, i: Cx): LoadPower {
  const s = cMul(v, cConj(i));
  const apparent = cAbs(s);
  return {
    p: s.re,
    q: s.im,
    s: apparent,
    pf: apparent === 0 ? 1 : Math.abs(s.re) / apparent,
    angle: toDegrees(cArg(s)),
  };
}

export interface Correction {
  /** Reactive power the correcting element must supply (var); negative when the load leads and needs an inductor. */
  qc: number;
  /** The capacitor, one of `parts`, across its own voltage (F); 0 when an inductor is needed. */
  c: number;
  /** The inductor, one of `parts` (H); null when a capacitor is needed. */
  l: number | null;
  /** The voltage across each correcting element (V): the line voltage over √3 for a wye bank. */
  vElement: number;
  q1: number;
  q2: number;
  s1: number;
  s2: number;
  /** Line current before and after (A) for the voltage given. */
  i1: number;
  i2: number;
}

export interface CorrectionOptions {
  /** 1 for a single-phase load, 3 for a balanced three-phase load; the voltage is then the line voltage. */
  phases?: 1 | 3;
  /** How the three equal elements of a three-phase bank are connected. */
  bank?: Connection;
  /** Whether the load's current lags (inductive) or leads (capacitive) the voltage. */
  lag?: Lag;
}

/**
 * Qc = P (tan φ1 − tan φ2) for a parallel element that moves the load to the target power factor (lagging, or
 * (of the same kind as the load, or unity). A lagging load takes a capacitor; a leading load takes an
 * inductor. Single phase: `voltage` is across the
 * element. Three phase: `voltage` is line to line, and three equal elements each carry Qc/3 across the line voltage
 * (delta) or the line voltage over √3 (wye).
 */
export function correction(
  p: number,
  pf1: number,
  pf2: number,
  voltage: number,
  hz: number,
  options: CorrectionOptions = {},
): Correction {
  const { phases = 1, bank = 'delta', lag = 'lagging' } = options;
  checkPf(pf1);
  checkPf(pf2);
  if (!(p > 0)) fail('positive', { field: 'realPower' });
  if (pf2 < pf1) fail('targetBelow');
  if (!(voltage > 0)) fail('positive', { field: 'voltage' });
  if (!(hz > 0)) fail('positive', { field: 'frequency' });
  const sign = lag === 'lagging' ? 1 : -1;
  const q1 = sign * p * Math.tan(Math.acos(pf1));
  const q2 = sign * p * Math.tan(Math.acos(pf2));
  const qc = q1 - q2;
  const s1 = p / pf1;
  const s2 = p / pf2;
  const parts = phases === 3 ? 3 : 1;
  const vElement = phases === 3 && bank === 'wye' ? voltage / Math.sqrt(3) : voltage;
  const omega = 2 * Math.PI * hz;
  const each = Math.abs(qc) / parts;
  const phase = phases === 3 ? Math.sqrt(3) : 1;
  return {
    qc,
    c: qc >= 0 ? each / (omega * vElement * vElement) : 0,
    l: qc < 0 ? (vElement * vElement) / (omega * each) : null,
    vElement,
    q1,
    q2,
    s1,
    s2,
    i1: s1 / (phase * voltage),
    i2: s2 / (phase * voltage),
  };
}

export type Connection = 'wye' | 'delta';

export interface ThreePhase {
  vPhase: number;
  vLine: number;
  iPhase: number;
  iLine: number;
  /** Complex power of the whole load (VA). */
  s: Cx;
  /** Power factor and the impedance angle in degrees. */
  pf: number;
  angle: number;
}

/**
 * A balanced three-phase load of the same impedance Z in each phase, fed at line voltage `vLine`
 * (rms, line to line). Z = |Z| ∠ angle, with a positive angle inductive.
 */
export function threePhase(vLine: number, zMagnitude: number, angleDeg: number, connection: Connection): ThreePhase {
  if (!(vLine > 0)) fail('positive', { field: 'lineVoltage' });
  if (!(zMagnitude > 0)) fail('positive', { field: 'impedance' });
  const vPhase = connection === 'wye' ? vLine / Math.sqrt(3) : vLine;
  const iPhase = vPhase / zMagnitude;
  const iLine = connection === 'wye' ? iPhase : Math.sqrt(3) * iPhase;
  // S per phase = V_ph I_ph* = |V||I| ∠ θ with θ the impedance angle.
  const sPhase = cPolar(vPhase * iPhase, toRadians(angleDeg));
  const s = { re: 3 * sPhase.re, im: 3 * sPhase.im };
  return { vPhase, vLine, iPhase, iLine, s, pf: Math.cos(toRadians(angleDeg)), angle: angleDeg };
}

export interface PerUnit {
  zBase: number;
  iBase: number;
  /** The impedance in per unit when ohms were given. */
  zPu: number;
}

/** Zbase = Vbase² / Sbase, Ibase = Sbase / (√3 Vbase) for a three-phase base with the line voltage. */
export function perUnitBase(sBase: number, vBase: number, ohms: number): PerUnit {
  if (!(sBase > 0)) fail('positive', { field: 'baseApparent' });
  if (!(vBase > 0)) fail('positive', { field: 'baseVoltage' });
  const zBase = (vBase * vBase) / sBase;
  return { zBase, iBase: sBase / (Math.sqrt(3) * vBase), zPu: ohms / zBase };
}

/** Changes an impedance in per unit from an old base to a new one: Z_new = Z_old (S_new / S_old)(V_old / V_new)². */
export function changeBase(zPu: number, sOld: number, vOld: number, sNew: number, vNew: number): number {
  if (!(sOld > 0 && sNew > 0)) fail('positive', { field: 'baseApparent' });
  if (!(vOld > 0 && vNew > 0)) fail('positive', { field: 'baseVoltage' });
  return zPu * (sNew / sOld) * (vOld / vNew) ** 2;
}

export interface Transformer {
  /** Turns ratio a = high-side rated voltage over low-side rated voltage. */
  ratio: number;
  /** The series equivalent impedance referred to the low side (Ω). */
  reqLow: number;
  xeqLow: number;
  /** Load current on the low side (A). */
  iLoad: number;
  /** The source voltage that holds the rated low-side voltage, referred to the low side and on the high side (V). */
  vSourceLow: number;
  vSourceHigh: number;
  /** (V_source − V_load) / V_load in percent: positive when the voltage falls under load. */
  regulation: number;
  pOut: number;
  copper: number;
  core: number;
  efficiency: number;
  /** The load fraction of maximum efficiency, where copper loss equals core loss. */
  bestLoad: number;
}

/**
 * A transformer by its series equivalent circuit, referred to the low side, loaded at `load` times its rating at a
 * power factor. The load voltage is the rated low-side voltage; the source voltage is V2 + I2 (Req + jXeq).
 */
export function transformer(args: {
  sRated: number;
  vHigh: number;
  vLow: number;
  reqHigh: number;
  xeqHigh: number;
  core: number;
  load: number;
  pf: number;
  lag: Lag;
}): Transformer {
  const { sRated, vHigh, vLow, reqHigh, xeqHigh, core, load, pf, lag } = args;
  checkPf(pf);
  if (!(sRated > 0)) fail('positive', { field: 'ratedApparent' });
  if (!(vHigh > 0 && vLow > 0)) fail('positive', { field: 'voltage' });
  if (!(load > 0)) fail('positive', { field: 'loadFraction' });
  if (reqHigh < 0 || core < 0) fail('positive', { field: 'equivalentR' });
  const ratio = vHigh / vLow;
  const reqLow = reqHigh / (ratio * ratio);
  const xeqLow = xeqHigh / (ratio * ratio);
  const iLoad = (load * sRated) / vLow;
  // I2 = I (cos φ ∓ j sin φ): a lagging current has a negative imaginary part, so sin is signed +1 for lagging.
  const sin = (lag === 'lagging' ? 1 : -1) * Math.sqrt(1 - pf * pf);
  const re = vLow + iLoad * (pf * reqLow + sin * xeqLow);
  const im = iLoad * (pf * xeqLow - sin * reqLow);
  const vSourceLow = Math.hypot(re, im);
  const pOut = load * sRated * pf;
  const copper = iLoad * iLoad * reqLow;
  const copperRated = (sRated / vLow) ** 2 * reqLow;
  return {
    ratio,
    reqLow,
    xeqLow,
    iLoad,
    vSourceLow,
    vSourceHigh: vSourceLow * ratio,
    regulation: ((vSourceLow - vLow) / vLow) * 100,
    pOut,
    copper,
    core,
    efficiency: pOut / (pOut + copper + core),
    bestLoad: copperRated > 0 ? Math.sqrt(core / copperRated) : Infinity,
  };
}
