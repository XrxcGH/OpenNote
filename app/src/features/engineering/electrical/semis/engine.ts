// Bias points and small-signal gains of diode, BJT, and MOSFET circuits. Pure functions in SI units.
import { fail } from '../shared';

/** The thermal voltage kT/q at a temperature in kelvin. */
export const thermalVoltage = (kelvin: number): number => (1.380649e-23 * kelvin) / 1.602176634e-19;

export interface DiodePoint {
  /** Diode voltage and current. */
  v: number;
  i: number;
}

/**
 * The operating point of a source in series with a resistor and a diode (Shockley equation). Solves
 * Vs = V + R Is (exp(V / (n Vt)) - 1) for V by bisection; the left side minus the right is monotonic in V, so the
 * root between 0 and Vs is unique.
 */
export function diodePoint(vs: number, r: number, is: number, n: number, vt: number): DiodePoint {
  const nvt = n * vt;
  const current = (v: number): number => is * Math.expm1(v / nvt);
  let lo = Math.min(vs, 0);
  let hi = Math.max(vs, 0);
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2;
    // Positive when the diode would carry more current than the resistor can supply.
    if (current(mid) - (vs - mid) / r > 0) hi = mid;
    else lo = mid;
  }
  const v = (lo + hi) / 2;
  return { v, i: (vs - v) / r };
}

/** The curve of diode current against voltage, for the load-line plot. */
export function diodeCurve(is: number, n: number, vt: number, vMax: number, count = 80) {
  const x: number[] = [];
  const y: number[] = [];
  for (let k = 0; k < count; k++) {
    const v = (vMax * k) / (count - 1);
    x.push(v);
    y.push(is * Math.expm1(v / (n * vt)));
  }
  return { x, y };
}

export interface ZenerResult {
  regulating: boolean;
  vout: number;
  /** Current from the supply through the series resistor. */
  iSupply: number;
  iZener: number;
  iLoad: number;
  /** The smallest supply voltage at which the zener still regulates. */
  vinMin: number;
}

/** An ideal zener (a voltage source of vz once it conducts) shunting the load, fed through a series resistor. */
export function zenerRegulator(vin: number, rs: number, vz: number, rl: number): ZenerResult {
  const open = (vin * rl) / (rs + rl);
  const vinMin = vz * (1 + rs / rl);
  if (open < vz) {
    return { regulating: false, vout: open, iSupply: vin / (rs + rl), iZener: 0, iLoad: open / rl, vinMin };
  }
  const iSupply = (vin - vz) / rs;
  const iLoad = vz / rl;
  return { regulating: true, vout: vz, iSupply, iZener: iSupply - iLoad, iLoad, vinMin };
}

export interface Rectifier {
  /** The peak voltage on the capacitor, after the diode drop. */
  peak: number;
  ripple: number;
  low: number;
  dc: number;
  /** The ripple frequency in Hz. */
  rippleHz: number;
  /** An approximate peak diode current. */
  diodePeak: number;
}

/**
 * A rectifier with a smoothing capacitor, using the usual straight-line discharge: ripple = Vp / (f R C) with f the
 * ripple frequency (the line frequency for a half wave, twice it for a full wave).
 */
export function rectifier(vp: number, drop: number, hz: number, full: boolean, r: number, c: number): Rectifier {
  const peak = vp - drop;
  if (peak <= 0) fail('noConduction');
  const rippleHz = full ? 2 * hz : hz;
  const ripple = peak / (rippleHz * r * c);
  // The straight-line model gives a ripple larger than the peak when C is far too small.
  if (ripple >= peak) fail('rippleTooBig');
  const iLoad = (peak - ripple / 2) / r;
  // Sedra and Smith: half wave IL (1 + 2 pi sqrt(2 Vp / Vr)); full wave (two conduction pulses a cycle) half of the pi term.
  const diodePeak = iLoad * (1 + (full ? 1 : 2) * Math.PI * Math.sqrt((2 * peak) / ripple));
  return { peak, ripple, low: peak - ripple, dc: peak - ripple / 2, rippleHz, diodePeak };
}

export type Region = 'active' | 'saturation' | 'cutoff';

export interface BjtBias {
  vth: number;
  rth: number;
  ib: number;
  ic: number;
  ie: number;
  vce: number;
  vb: number;
  ve: number;
  vc: number;
  region: Region;
}

/** The 4-resistor (voltage-divider) bias of an NPN transistor, by the Thevenin equivalent of the base divider. */
export function bjtBias(
  vcc: number,
  r1: number,
  r2: number,
  rc: number,
  re: number,
  beta: number,
  vbe: number,
  vceSat = 0.2,
): BjtBias {
  const vth = (vcc * r2) / (r1 + r2);
  const rth = (r1 * r2) / (r1 + r2);
  const ibActive = (vth - vbe) / (rth + (beta + 1) * re);
  const finish = (ib: number, ic: number, region: Region): BjtBias => {
    const ie = ib + ic;
    const ve = ie * re;
    const vc = vcc - ic * rc;
    return { vth, rth, ib, ic, ie, vce: vc - ve, vb: ve + vbe, ve, vc, region };
  };
  if (ibActive <= 0) return finish(0, 0, 'cutoff');
  const icActive = beta * ibActive;
  if (vcc - icActive * rc - (ibActive + icActive) * re >= vceSat) return finish(ibActive, icActive, 'active');
  // Saturated: VCE is fixed at vceSat, so IB and IC come from 2 linear equations.
  // vth = IB rth + vbe + (IB + IC) re, and vcc = IC rc + (IB + IC) re + vceSat.
  const a = rth + re;
  const b = re;
  const c = re;
  const d = rc + re;
  const e1 = vth - vbe;
  const e2 = vcc - vceSat;
  const det = a * d - b * c;
  const ib = (e1 * d - b * e2) / det;
  const ic = (a * e2 - c * e1) / det;
  return finish(ib, ic, 'saturation');
}

export interface BjtGain {
  gm: number;
  rpi: number;
  re: number;
  ro: number | null;
  gain: number;
  rin: number;
  rout: number;
}

/**
 * Common-emitter small-signal gain. With the emitter resistor bypassed the gain is -gm (RC || RL || ro); unbypassed
 * it is -beta (RC || RL) / (r_pi + (beta + 1) RE), ignoring ro.
 */
export function bjtGain(
  bias: BjtBias,
  beta: number,
  vt: number,
  rc: number,
  re: number,
  rl: number | null,
  early: number | null,
  bypassed: boolean,
  r1: number,
  r2: number,
): BjtGain {
  const gm = bias.ic / vt;
  const rpi = beta / gm;
  const ro = early !== null && bias.ic > 0 ? early / bias.ic : null;
  const parallel = (...rs: (number | null)[]): number =>
    1 / rs.reduce<number>((sum, r) => sum + (r === null ? 0 : 1 / r), 0);
  const load = parallel(rc, rl, ro);
  const base = parallel(r1, r2);
  if (bypassed) {
    return { gm, rpi, re: vt / bias.ie, ro, gain: -gm * load, rin: parallel(base, rpi), rout: parallel(rc, ro) };
  }
  const loadNoRo = parallel(rc, rl);
  const inputSide = rpi + (beta + 1) * re;
  return {
    gm,
    rpi,
    re: vt / bias.ie,
    ro,
    gain: (-beta * loadNoRo) / inputSide,
    rin: parallel(base, inputSide),
    rout: rc,
  };
}

export interface MosBias {
  vg: number;
  vgs: number;
  vov: number;
  id: number;
  vds: number;
  region: Region | 'triode';
}

/**
 * The bias of an n-channel MOSFET with a gate divider and source resistor, in the square-law model
 * (ID = k/2 (VGS - Vt)^2 in saturation, k = mu Cox W/L). Checks the region, and solves the triode equation when the
 * drain voltage is too low for saturation.
 */
export function mosfetBias(
  vdd: number,
  r1: number,
  r2: number,
  rd: number,
  rs: number,
  k: number,
  vt: number,
): MosBias {
  const vg = (vdd * r2) / (r1 + r2);
  if (vg <= vt) return { vg, vgs: vg, vov: 0, id: 0, vds: vdd, region: 'cutoff' };
  const half = k / 2;
  const vov = rs === 0 ? vg - vt : (-1 + Math.sqrt(1 + 4 * half * rs * (vg - vt))) / (2 * half * rs);
  const idSat = half * vov * vov;
  const vdsSat = vdd - idSat * (rd + rs);
  if (vdsSat >= vov) return { vg, vgs: vov + vt, vov, id: idSat, vds: vdsSat, region: 'saturation' };
  // Triode: ID = k ((VGS - Vt) VDS - VDS^2 / 2), with VGS = VG - ID RS and VDS = VDD - ID (RD + RS).
  const triode = (id: number): number => {
    const vds = vdd - id * (rd + rs);
    return id - k * ((vg - id * rs - vt) * vds - (vds * vds) / 2);
  };
  // The triode equation only holds where VDS is at most the overdrive; that starts at the current where they are equal.
  let hi = Math.min(idSat, vdd / (rd + rs));
  let lo = Math.min(hi, Math.max(0, (vdd - vg + vt) / rd));
  for (let n = 0; n < 200; n++) {
    const mid = (lo + hi) / 2;
    if (triode(mid) > 0) hi = mid;
    else lo = mid;
  }
  const id = (lo + hi) / 2;
  return { vg, vgs: vg - id * rs, vov: vg - id * rs - vt, id, vds: vdd - id * (rd + rs), region: 'triode' };
}

export interface MosGain {
  gm: number;
  ro: number | null;
  gain: number;
  rout: number;
}

/** Common-source gain: -gm (RD || RL || ro) with the source bypassed, -gm (RD || RL) / (1 + gm RS) without. */
export function mosfetGain(
  bias: MosBias,
  k: number,
  rd: number,
  rs: number,
  rl: number | null,
  lambda: number,
  bypassed: boolean,
): MosGain {
  const gm = k * bias.vov;
  const ro = lambda > 0 && bias.id > 0 ? 1 / (lambda * bias.id) : null;
  const parallel = (...rs2: (number | null)[]): number =>
    1 / rs2.reduce<number>((sum, r) => sum + (r === null ? 0 : 1 / r), 0);
  if (bypassed) {
    const load = parallel(rd, rl, ro);
    return { gm, ro, gain: -gm * load, rout: parallel(rd, ro) };
  }
  const load = parallel(rd, rl);
  return { gm, ro, gain: (-gm * load) / (1 + gm * rs), rout: rd };
}

/** The smoothed output of a rectifier over some cycles, for a plot: the capacitor follows the peaks and decays between. */
export function rectifierWaveform(
  vp: number,
  drop: number,
  hz: number,
  full: boolean,
  r: number,
  c: number,
  cycles = 3,
  perCycle = 200,
): { t: number[]; vin: number[]; vout: number[] } {
  const dt = 1 / (hz * perCycle);
  const t: number[] = [];
  const vin: number[] = [];
  const vout: number[] = [];
  let vc = 0;
  for (let k = 0; k <= cycles * perCycle; k++) {
    const time = k * dt;
    const source = vp * Math.sin(2 * Math.PI * hz * time);
    const driven = (full ? Math.abs(source) : source) - drop;
    vc = driven > vc ? driven : vc * Math.exp(-dt / (r * c));
    t.push(time);
    vin.push(source);
    vout.push(vc);
  }
  return { t, vin, vout };
}
