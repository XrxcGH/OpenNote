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
  /** Reactive power the capacitor must supply (var). */
  qc: number;
  /** The capacitor, per phase for the voltage and connection given (F). */
  c: number;
  q1: number;
  q2: number;
  s1: number;
  s2: number;
  /** Line current before and after (A) for the voltage given. */
  i1: number;
  i2: number;
}

/**
 * Qc = P (tan φ1 − tan φ2) for a parallel capacitor that raises a lagging power factor to the target.
 * `voltage` is the voltage across the capacitor and `parts` the number of equal capacitors sharing Qc
 * (1 for single phase, 3 for a three-phase bank).
 */
export function correction(p: number, pf1: number, pf2: number, voltage: number, hz: number, parts = 1): Correction {
  checkPf(pf1);
  checkPf(pf2);
  if (!(p > 0)) fail('positive', { field: 'realPower' });
  if (pf2 < pf1) fail('targetBelow');
  if (!(voltage > 0)) fail('positive', { field: 'voltage' });
  if (!(hz > 0)) fail('positive', { field: 'frequency' });
  const q1 = p * Math.tan(Math.acos(pf1));
  const q2 = p * Math.tan(Math.acos(pf2));
  const qc = q1 - q2;
  const s1 = p / pf1;
  const s2 = p / pf2;
  const c = qc / parts / (2 * Math.PI * hz * voltage * voltage);
  const phase = parts === 3 ? Math.sqrt(3) : 1;
  return { qc, c, q1, q2, s1, s2, i1: s1 / (phase * voltage), i2: s2 / (phase * voltage) };
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
