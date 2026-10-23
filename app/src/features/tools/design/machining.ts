// Machining calculations in metric units: lengths in mm, cutting speed in m/min, feed in mm/rev (mm/tooth for
// milling), forces in N, power in W, times in min. The UI converts US units (sfm, ipr) at its boundary.
import { bad, finite, fmt } from './types';
import type { Outcome, Step } from './types';

const DEG = Math.PI / 180;

/** Spindle speed in rev/min for a cutting speed V (m/min) on a diameter D (mm). */
export function spindleSpeed(v: number, d: number): Outcome<{ rpm: number }> {
  if (!finite(v, d)) return bad('notNumber');
  if (v <= 0) return bad('speedPositive');
  if (d <= 0) return bad('diameterPositive');
  return { ok: true, rpm: (1000 * v) / (Math.PI * d) };
}

export interface CutResult {
  rpm: number;
  /** Feed rate in mm/min. */
  feedRate: number;
  /** Material removal rate in mm3/min and mm3/s. */
  mrrMin: number;
  mrrSec: number;
  /** Cutting time in min, including approach for milling and the point allowance for drilling. */
  time: number;
  steps: Step[];
}

export interface TurningInput {
  d: number;
  v: number;
  f: number;
  /** Depth of cut in mm. */
  depth: number;
  length: number;
}

/** Straight turning: the work diameter is the diameter before the cut. */
export function turning(i: TurningInput): Outcome<CutResult> {
  if (!finite(i.d, i.v, i.f, i.depth, i.length)) return bad('notNumber');
  if (i.f <= 0) return bad('feedPositive');
  if (i.depth <= 0) return bad('depthPositive');
  if (i.length <= 0) return bad('lengthPositive');
  if (i.d <= 0) return bad('diameterPositive');
  if (i.depth >= i.d / 2) return bad('depthTooDeep');
  const s = spindleSpeed(i.v, i.d);
  if (!s.ok) return s;
  const vf = i.f * s.rpm;
  const mrrMin = 1000 * i.v * i.f * i.depth;
  const time = i.length / vf;
  return {
    ok: true,
    rpm: s.rpm,
    feedRate: vf,
    mrrMin,
    mrrSec: mrrMin / 60,
    time,
    steps: [
      { key: 'rpm', latex: `N=\\dfrac{1000V}{\\pi D}=\\dfrac{1000(${fmt(i.v)})}{\\pi(${fmt(i.d)})}=${fmt(s.rpm)}\\ \\mathrm{rpm}` },
      { key: 'mrr', latex: `\\mathrm{MRR}=1000\\,V f d=${fmt(mrrMin)}\\ \\mathrm{mm^3/min}` },
      { key: 'time', latex: `t=\\dfrac{L}{fN}=\\dfrac{${fmt(i.length)}}{(${fmt(i.f)})(${fmt(s.rpm)})}=${fmt(time)}\\ \\mathrm{min}` },
    ],
  };
}

export interface DrillingInput {
  d: number;
  v: number;
  f: number;
  /** Hole depth in mm (full-diameter depth). */
  depth: number;
  /** Included point angle in degrees (118 for a standard twist drill). */
  pointAngle: number;
}

/** Drilling: the drill point adds (D/2)/tan(half point angle) to the travel. */
export function drilling(i: DrillingInput): Outcome<CutResult> {
  if (!finite(i.d, i.v, i.f, i.depth, i.pointAngle)) return bad('notNumber');
  if (i.f <= 0) return bad('feedPositive');
  if (i.depth <= 0) return bad('depthPositive');
  if (i.pointAngle <= 0 || i.pointAngle >= 180) return bad('pointAngleRange');
  const s = spindleSpeed(i.v, i.d);
  if (!s.ok) return s;
  const vf = i.f * s.rpm;
  const tip = i.d / 2 / Math.tan((i.pointAngle / 2) * DEG);
  const mrrMin = (Math.PI * i.d * i.d * vf) / 4;
  const time = (i.depth + tip) / vf;
  return {
    ok: true,
    rpm: s.rpm,
    feedRate: vf,
    mrrMin,
    mrrSec: mrrMin / 60,
    time,
    steps: [
      { key: 'rpm', latex: `N=\\dfrac{1000V}{\\pi D}=${fmt(s.rpm)}\\ \\mathrm{rpm}` },
      { key: 'tip', latex: `A=\\dfrac{D/2}{\\tan(\\theta/2)}=${fmt(tip)}\\ \\mathrm{mm}` },
      { key: 'mrr', latex: `\\mathrm{MRR}=\\dfrac{\\pi D^2}{4}fN=${fmt(mrrMin)}\\ \\mathrm{mm^3/min}` },
      { key: 'time', latex: `t=\\dfrac{L+A}{fN}=\\dfrac{${fmt(i.depth)}+${fmt(tip)}}{${fmt(vf)}}=${fmt(time)}\\ \\mathrm{min}` },
    ],
  };
}

export type MillingKind = 'slot' | 'peripheral';

export interface MillingInput {
  /** Cutter diameter in mm. */
  d: number;
  v: number;
  /** Feed per tooth in mm. */
  fz: number;
  teeth: number;
  /** Width of cut and depth of cut in mm. */
  width: number;
  depth: number;
  length: number;
  kind: MillingKind;
}

/** Milling: slot milling approaches by D/2; peripheral (side) milling by sqrt(d(D - d)) with d the radial depth. */
export function milling(i: MillingInput): Outcome<CutResult> {
  if (!finite(i.d, i.v, i.fz, i.teeth, i.width, i.depth, i.length)) return bad('notNumber');
  if (i.fz <= 0) return bad('feedPositive');
  if (!Number.isInteger(i.teeth) || i.teeth < 1) return bad('teethPositive');
  if (i.width <= 0 || i.depth <= 0) return bad('depthPositive');
  if (i.length <= 0) return bad('lengthPositive');
  if (i.kind === 'peripheral' && i.width > i.d) return bad('widthTooBig');
  const s = spindleSpeed(i.v, i.d);
  if (!s.ok) return s;
  const vf = i.fz * i.teeth * s.rpm;
  const mrrMin = i.width * i.depth * vf;
  const approach = i.kind === 'slot' ? i.d / 2 : Math.sqrt(i.width * (i.d - i.width));
  const time = (i.length + approach) / vf;
  return {
    ok: true,
    rpm: s.rpm,
    feedRate: vf,
    mrrMin,
    mrrSec: mrrMin / 60,
    time,
    steps: [
      { key: 'rpm', latex: `N=\\dfrac{1000V}{\\pi D}=${fmt(s.rpm)}\\ \\mathrm{rpm}` },
      { key: 'feedRate', latex: `v_f=f_z\\,z\\,N=${fmt(i.fz)}(${i.teeth})(${fmt(s.rpm)})=${fmt(vf)}\\ \\mathrm{mm/min}` },
      { key: 'mrr', latex: `\\mathrm{MRR}=w\\,d\\,v_f=${fmt(mrrMin)}\\ \\mathrm{mm^3/min}` },
      { key: 'time', latex: `t=\\dfrac{L+A}{v_f}=\\dfrac{${fmt(i.length)}+${fmt(approach)}}{${fmt(vf)}}=${fmt(time)}\\ \\mathrm{min}` },
    ],
  };
}

/** Taylor tool life T = (C/V)^(1/n), V in m/min, T in min. */
export function toolLife(n: number, c: number, v: number): Outcome<{ life: number; steps: Step[] }> {
  if (!finite(n, c, v)) return bad('notNumber');
  if (n <= 0 || n > 1) return bad('taylorN');
  if (c <= 0) return bad('taylorC');
  if (v <= 0) return bad('speedPositive');
  const life = (c / v) ** (1 / n);
  if (!Number.isFinite(life)) return bad('tooLarge');
  return {
    ok: true,
    life,
    steps: [{ key: 'life', latex: `T=\\left(\\dfrac{C}{V}\\right)^{1/n}=\\left(\\dfrac{${fmt(c)}}{${fmt(v)}}\\right)^{1/${fmt(n)}}=${fmt(life)}\\ \\mathrm{min}` }],
  };
}

/** Cutting speed that gives a wanted tool life: V = C / T^n. */
export function speedForLife(n: number, c: number, life: number): Outcome<{ v: number }> {
  if (!finite(n, c, life)) return bad('notNumber');
  if (n <= 0 || n > 1) return bad('taylorN');
  if (c <= 0) return bad('taylorC');
  if (life <= 0) return bad('lifePositive');
  return { ok: true, v: c / life ** n };
}

export interface EconomicsResult {
  /** Tool life and cutting speed for minimum cost per part. */
  costLife: number;
  costSpeed: number;
  /** Tool life and cutting speed for maximum production rate. */
  rateLife: number;
  rateSpeed: number;
  steps: Step[];
}

/**
 * Taylor economics. `changeTime` is the tool change time (min), `edgeCost` the cost of one cutting edge, and
 * `rate` the machine plus operator cost per minute. Minimum cost: T = (1/n - 1)(Tc + Ce/Co); maximum production:
 * T = (1/n - 1) Tc. Both need n < 1.
 */
export function economics(n: number, c: number, changeTime: number, edgeCost: number, rate: number): Outcome<EconomicsResult> {
  if (!finite(n, c, changeTime, edgeCost, rate)) return bad('notNumber');
  if (n <= 0 || n >= 1) return bad('taylorNEconomics');
  if (c <= 0) return bad('taylorC');
  if (changeTime < 0 || edgeCost < 0) return bad('negativeCost');
  if (rate <= 0) return bad('ratePositive');
  const k = 1 / n - 1;
  const costLife = k * (changeTime + edgeCost / rate);
  const rateLife = k * changeTime;
  if (costLife <= 0 || rateLife <= 0) return bad('changeTimePositive');
  const costSpeed = c / costLife ** n;
  const rateSpeed = c / rateLife ** n;
  return {
    ok: true,
    costLife,
    costSpeed,
    rateLife,
    rateSpeed,
    steps: [
      { key: 'costLife', latex: `T_c=\\left(\\dfrac1n-1\\right)\\left(T_{ch}+\\dfrac{C_e}{C_o}\\right)=${fmt(costLife)}\\ \\mathrm{min}` },
      { key: 'costSpeed', latex: `V_c=\\dfrac{C}{T_c^{\\,n}}=${fmt(costSpeed)}\\ \\mathrm{m/min}` },
      { key: 'rateLife', latex: `T_p=\\left(\\dfrac1n-1\\right)T_{ch}=${fmt(rateLife)}\\ \\mathrm{min}` },
      { key: 'rateSpeed', latex: `V_p=\\dfrac{C}{T_p^{\\,n}}=${fmt(rateSpeed)}\\ \\mathrm{m/min}` },
    ],
  };
}

/** Merchant's shear angle: phi = 45 + alpha/2 - beta/2 (degrees), with rake alpha and friction angle beta. */
export function merchantShearAngle(rake: number, friction: number): Outcome<{ phi: number }> {
  if (!finite(rake, friction)) return bad('notNumber');
  if (Math.abs(rake) >= 90) return bad('rakeRange');
  if (friction <= 0 || friction >= 90) return bad('frictionRange');
  const phi = 45 + rake / 2 - friction / 2;
  if (phi <= 0 || phi >= 90) return bad('shearAngleRange');
  return { ok: true, phi };
}

/** Shear angle from the chip thickness ratio r = t0/tc: tan(phi) = r cos(alpha) / (1 - r sin(alpha)). */
export function shearAngleFromRatio(r: number, rake: number): Outcome<{ phi: number }> {
  if (!finite(r, rake)) return bad('notNumber');
  if (r <= 0 || r >= 1.5) return bad('ratioRange');
  if (Math.abs(rake) >= 90) return bad('rakeRange');
  const a = rake * DEG;
  const den = 1 - r * Math.sin(a);
  if (den <= 0) return bad('ratioRange');
  return { ok: true, phi: Math.atan2(r * Math.cos(a), den) / DEG };
}

export interface ForcesResult {
  friction: number;
  normal: number;
  shear: number;
  shearNormal: number;
  /** Friction coefficient mu = F/N and friction angle in degrees. */
  mu: number;
  beta: number;
  /** Shear stress on the shear plane, in the units of force over (mm x mm) = MPa when force is N. */
  shearStress: number;
  /** Cutting power Fc V in W and specific cutting energy in N/mm2 = MPa. */
  power: number;
  specificEnergy: number;
  steps: Step[];
}

/**
 * Merchant's circle from the measured cutting force Fc and thrust force Ft (N), rake alpha and shear angle phi
 * (degrees), uncut chip thickness t0 and width w (mm) and cutting speed V (m/min).
 */
export function forces(fc: number, ft: number, rake: number, phi: number, t0: number, w: number, v: number): Outcome<ForcesResult> {
  if (!finite(fc, ft, rake, phi, t0, w, v)) return bad('notNumber');
  if (fc <= 0) return bad('forcePositive');
  if (t0 <= 0 || w <= 0) return bad('depthPositive');
  if (v <= 0) return bad('speedPositive');
  if (Math.abs(rake) >= 90) return bad('rakeRange');
  if (phi <= 0 || phi >= 90) return bad('shearAngleRange');
  const a = rake * DEG;
  const p = phi * DEG;
  const friction = fc * Math.sin(a) + ft * Math.cos(a);
  const normal = fc * Math.cos(a) - ft * Math.sin(a);
  if (normal <= 0) return bad('normalForceNonPositive');
  const shear = fc * Math.cos(p) - ft * Math.sin(p);
  const shearNormal = fc * Math.sin(p) + ft * Math.cos(p);
  const mu = friction / normal;
  const area = (w * t0) / Math.sin(p);
  const power = (fc * v) / 60;
  return {
    ok: true,
    friction,
    normal,
    shear,
    shearNormal,
    mu,
    beta: Math.atan(mu) / DEG,
    shearStress: shear / area,
    power,
    specificEnergy: fc / (w * t0),
    steps: [
      { key: 'friction', latex: `F=F_c\\sin\\alpha+F_t\\cos\\alpha=${fmt(friction)}\\ \\mathrm{N}` },
      { key: 'normal', latex: `N=F_c\\cos\\alpha-F_t\\sin\\alpha=${fmt(normal)}\\ \\mathrm{N}` },
      { key: 'shear', latex: `F_s=F_c\\cos\\phi-F_t\\sin\\phi=${fmt(shear)}\\ \\mathrm{N}` },
      { key: 'mu', latex: `\\mu=\\dfrac{F}{N}=${fmt(mu)},\\quad \\beta=\\arctan\\mu=${fmt(Math.atan(mu) / DEG)}^\\circ` },
      { key: 'power', latex: `P_c=F_cV=${fmt(power)}\\ \\mathrm{W}` },
    ],
  };
}
