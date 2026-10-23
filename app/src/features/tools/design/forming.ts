// Forming, casting, joining and additive geometry. Metric units: mm, N, MPa (N/mm2), min, J/mm, rev/s.
import { bad, finite, fmt } from './types';
import type { Outcome, Step } from './types';

/** Average flow stress of a strain-hardening metal, Yf = K e^n / (1 + n), for a final true strain e. */
export function averageFlowStress(k: number, n: number, strain: number): Outcome<{ yf: number }> {
  if (!finite(k, n, strain)) return bad('notNumber');
  if (k <= 0) return bad('strengthCoefPositive');
  if (n < 0 || n > 1) return bad('hardeningRange');
  if (strain < 0) return bad('strainNegative');
  return { ok: true, yf: (k * strain ** n) / (1 + n) };
}

export interface RollingResult {
  contact: number;
  force: number;
  maxDraft: number;
  /** Total power for the pair of rolls, in W, when the roll speed is given. */
  power: number | null;
  draft: number;
  steps: Step[];
}

/**
 * Flat rolling. `yf` is the average flow stress (MPa). Contact length L = sqrt(R dh), force F = Yf w L, the largest
 * draft the friction can pull in is mu^2 R. Power uses both rolls: P = 2 pi N F L with N in rev/s.
 */
export function rolling(
  radius: number,
  h0: number,
  hf: number,
  width: number,
  yf: number,
  mu: number,
  rollRevPerS: number | null,
): Outcome<RollingResult> {
  if (!finite(radius, h0, hf, width, yf, mu)) return bad('notNumber');
  if (radius <= 0) return bad('radiusPositive');
  if (h0 <= 0 || hf <= 0) return bad('thicknessPositive');
  if (hf > h0) return bad('thicknessIncrease');
  if (width <= 0) return bad('widthPositive');
  if (yf <= 0) return bad('flowStressPositive');
  if (mu < 0) return bad('frictionNegative');
  const draft = h0 - hf;
  const contact = Math.sqrt(radius * draft);
  const force = yf * width * contact;
  const maxDraft = mu * mu * radius;
  const power = rollRevPerS === null ? null : 2 * Math.PI * rollRevPerS * force * contact;
  const steps: Step[] = [
    { key: 'draft', latex: `\\Delta h=h_0-h_f=${fmt(draft)}\\ \\mathrm{mm}` },
    { key: 'contact', latex: `L=\\sqrt{R\\,\\Delta h}=\\sqrt{(${fmt(radius)})(${fmt(draft)})}=${fmt(contact)}\\ \\mathrm{mm}` },
    { key: 'force', latex: `F=Y_f\\,w\\,L=(${fmt(yf)})(${fmt(width)})(${fmt(contact)})=${fmt(force)}\\ \\mathrm{N}` },
    { key: 'maxDraft', latex: `\\Delta h_{\\max}=\\mu^2R=${fmt(maxDraft)}\\ \\mathrm{mm}` },
  ];
  return { ok: true, contact, force, maxDraft, power, draft, steps };
}

export interface ForgingResult {
  area: number;
  frictionFactor: number;
  force: number;
  steps: Step[];
}

/** Open-die forging of a cylinder: F = Kf Yf A with Kf = 1 + 0.4 mu D / h (D and h at the end of the stroke). */
export function forging(diameter: number, height: number, yf: number, mu: number): Outcome<ForgingResult> {
  if (!finite(diameter, height, yf, mu)) return bad('notNumber');
  if (diameter <= 0 || height <= 0) return bad('dimensionPositive');
  if (yf <= 0) return bad('flowStressPositive');
  if (mu < 0) return bad('frictionNegative');
  const area = (Math.PI * diameter * diameter) / 4;
  const kf = 1 + (0.4 * mu * diameter) / height;
  const force = kf * yf * area;
  return {
    ok: true,
    area,
    frictionFactor: kf,
    force,
    steps: [
      { key: 'area', latex: `A=\\dfrac{\\pi D^2}{4}=${fmt(area)}\\ \\mathrm{mm^2}` },
      { key: 'kf', latex: `K_f=1+0.4\\,\\mu\\,\\dfrac{D}{h}=${fmt(kf)}` },
      { key: 'force', latex: `F=K_f\\,Y_f\\,A=${fmt(force)}\\ \\mathrm{N}` },
    ],
  };
}

export interface ExtrusionResult {
  ratio: number;
  trueStrain: number;
  extrusionStrain: number;
  pressureIndirect: number;
  pressureDirect: number;
  steps: Step[];
}

/**
 * Extrusion pressure by Johnson's formula, eps_x = a + b ln(Ar) (a about 0.8, b 1.2 to 1.5 for steel and
 * aluminium). Indirect: p = Yf eps_x; direct adds container friction: p = Yf (eps_x + 2L/D0).
 */
export function extrusion(
  a0: number,
  af: number,
  yf: number,
  billetLength: number,
  billetDiameter: number,
  johnsonA = 0.8,
  johnsonB = 1.4,
): Outcome<ExtrusionResult> {
  if (!finite(a0, af, yf, billetLength, billetDiameter, johnsonA, johnsonB)) return bad('notNumber');
  if (a0 <= 0 || af <= 0) return bad('areaPositive');
  if (af > a0) return bad('areaIncrease');
  if (yf <= 0) return bad('flowStressPositive');
  if (billetLength < 0 || billetDiameter <= 0) return bad('dimensionPositive');
  const ratio = a0 / af;
  const e = Math.log(ratio);
  const ex = johnsonA + johnsonB * e;
  const pi = yf * ex;
  const pd = yf * (ex + (2 * billetLength) / billetDiameter);
  return {
    ok: true,
    ratio,
    trueStrain: e,
    extrusionStrain: ex,
    pressureIndirect: pi,
    pressureDirect: pd,
    steps: [
      { key: 'ratio', latex: `r=\\dfrac{A_0}{A_f}=${fmt(ratio)},\\quad \\ln r=${fmt(e)}` },
      { key: 'epsX', latex: `\\varepsilon_x=a+b\\ln r=${fmt(johnsonA)}+${fmt(johnsonB)}(${fmt(e)})=${fmt(ex)}` },
      { key: 'pIndirect', latex: `p=Y_f\\,\\varepsilon_x=${fmt(pi)}\\ \\mathrm{MPa}` },
      { key: 'pDirect', latex: `p=Y_f\\left(\\varepsilon_x+\\dfrac{2L}{D_0}\\right)=${fmt(pd)}\\ \\mathrm{MPa}` },
    ],
  };
}

export interface DrawingResult {
  strain: number;
  stress: number;
  /** Largest reduction a perfectly plastic metal allows is where the stress reaches Yf; this is the ratio. */
  stressRatio: number;
  steps: Step[];
}

/** Wire or rod drawing, ideal plus die friction: sigma_d = Yf (1 + mu / tan(alpha)) ln(A0/Af), alpha the die half-angle. */
export function drawing(a0: number, af: number, yf: number, mu: number, halfAngleDeg: number): Outcome<DrawingResult> {
  if (!finite(a0, af, yf, mu, halfAngleDeg)) return bad('notNumber');
  if (a0 <= 0 || af <= 0) return bad('areaPositive');
  if (af >= a0) return bad('areaNotReduced');
  if (yf <= 0) return bad('flowStressPositive');
  if (mu < 0) return bad('frictionNegative');
  if (halfAngleDeg <= 0 || halfAngleDeg >= 45) return bad('dieAngleRange');
  const e = Math.log(a0 / af);
  const stress = yf * (1 + mu / Math.tan((halfAngleDeg * Math.PI) / 180)) * e;
  return {
    ok: true,
    strain: e,
    stress,
    stressRatio: stress / yf,
    steps: [
      { key: 'strain', latex: `\\varepsilon=\\ln\\dfrac{A_0}{A_f}=${fmt(e)}` },
      { key: 'stress', latex: `\\sigma_d=Y_f\\left(1+\\dfrac{\\mu}{\\tan\\alpha}\\right)\\varepsilon=${fmt(stress)}\\ \\mathrm{MPa}` },
    ],
  };
}

export interface BendResult {
  allowance: number;
  outsideSetback: number;
  deduction: number;
  steps: Step[];
}

/** Sheet-metal bend of `angle` degrees (the angle the sheet turns): BA = angle (R + K t), BD = 2 OSSB - BA. */
export function bend(angleDeg: number, radius: number, thickness: number, k: number): Outcome<BendResult> {
  if (!finite(angleDeg, radius, thickness, k)) return bad('notNumber');
  if (angleDeg <= 0 || angleDeg >= 180) return bad('bendAngleRange');
  if (radius < 0) return bad('radiusNegative');
  if (thickness <= 0) return bad('thicknessPositive');
  if (k < 0 || k > 0.5) return bad('kFactorRange');
  const a = (angleDeg * Math.PI) / 180;
  const ba = a * (radius + k * thickness);
  const ossb = Math.tan(a / 2) * (radius + thickness);
  return {
    ok: true,
    allowance: ba,
    outsideSetback: ossb,
    deduction: 2 * ossb - ba,
    steps: [
      { key: 'allowance', latex: `BA=\\alpha(R+Kt)=${fmt(a)}(${fmt(radius)}+${fmt(k)}\\cdot${fmt(thickness)})=${fmt(ba)}\\ \\mathrm{mm}` },
      { key: 'setback', latex: `OSSB=\\tan\\dfrac{\\alpha}{2}(R+t)=${fmt(ossb)}\\ \\mathrm{mm}` },
      { key: 'deduction', latex: `BD=2\\,OSSB-BA=${fmt(2 * ossb - ba)}\\ \\mathrm{mm}` },
    ],
  };
}

/** Blanking or punching force F = 0.7 UTS t L for the cut edge length L (a circle's is pi D). */
export function blanking(edgeLength: number, thickness: number, uts: number): Outcome<{ force: number; steps: Step[] }> {
  if (!finite(edgeLength, thickness, uts)) return bad('notNumber');
  if (edgeLength <= 0 || thickness <= 0) return bad('dimensionPositive');
  if (uts <= 0) return bad('strengthPositive');
  const force = 0.7 * uts * thickness * edgeLength;
  return {
    ok: true,
    force,
    steps: [{ key: 'force', latex: `F=0.7\\,S_{ut}\\,t\\,L=0.7(${fmt(uts)})(${fmt(thickness)})(${fmt(edgeLength)})=${fmt(force)}\\ \\mathrm{N}` }],
  };
}

/** Chvorinov's rule t = B (V/A)^n; n is 2 for the usual form. V in cm3, A in cm2, B in min/cm2. */
export function chvorinov(b: number, volume: number, area: number, n = 2): Outcome<{ time: number; modulus: number; steps: Step[] }> {
  if (!finite(b, volume, area, n)) return bad('notNumber');
  if (b <= 0) return bad('moldConstantPositive');
  if (volume <= 0 || area <= 0) return bad('dimensionPositive');
  if (n <= 0) return bad('exponentPositive');
  const modulus = volume / area;
  const time = b * modulus ** n;
  return {
    ok: true,
    time,
    modulus,
    steps: [
      { key: 'modulus', latex: `M=\\dfrac{V}{A}=\\dfrac{${fmt(volume)}}{${fmt(area)}}=${fmt(modulus)}\\ \\mathrm{cm}` },
      { key: 'time', latex: `t_s=B\\,M^n=${fmt(b)}(${fmt(modulus)})^{${fmt(n)}}=${fmt(time)}\\ \\mathrm{min}` },
    ],
  };
}

export interface RiserResult {
  castingModulus: number;
  riserModulus: number;
  diameter: number;
  height: number;
  volume: number;
  steps: Step[];
}

/**
 * Cylindrical riser, closed (a top that cools like the sides), height to diameter ratio k = H/D. With the same
 * mold constant and n = 2 the riser must freeze later: its modulus is at least sqrt(factor) times the casting's,
 * the factor being 1.25 in common practice. Riser modulus is D k / (4k + 2).
 */
export function riser(castingVolume: number, castingArea: number, hOverD: number, factor = 1.25): Outcome<RiserResult> {
  if (!finite(castingVolume, castingArea, hOverD, factor)) return bad('notNumber');
  if (castingVolume <= 0 || castingArea <= 0) return bad('dimensionPositive');
  if (hOverD <= 0) return bad('ratioPositive');
  if (factor < 1) return bad('riserFactorRange');
  const mc = castingVolume / castingArea;
  const mr = Math.sqrt(factor) * mc;
  const d = (mr * (4 * hOverD + 2)) / hOverD;
  const h = hOverD * d;
  return {
    ok: true,
    castingModulus: mc,
    riserModulus: mr,
    diameter: d,
    height: h,
    volume: (Math.PI * d * d * h) / 4,
    steps: [
      { key: 'castingModulus', latex: `M_c=\\dfrac{V}{A}=${fmt(mc)}\\ \\mathrm{cm}` },
      { key: 'riserModulus', latex: `M_r=\\sqrt{${fmt(factor)}}\\,M_c=${fmt(mr)}\\ \\mathrm{cm}` },
      { key: 'diameter', latex: `M_r=\\dfrac{D\\,k}{4k+2}\\Rightarrow D=${fmt(d)}\\ \\mathrm{cm},\\ H=kD=${fmt(h)}\\ \\mathrm{cm}` },
    ],
  };
}

/** Pattern dimension that allows for a linear shrinkage fraction s: L_pattern = L_final (1 + s). */
export function patternSize(finalLength: number, shrinkage: number): Outcome<{ pattern: number }> {
  if (!finite(finalLength, shrinkage)) return bad('notNumber');
  if (finalLength <= 0) return bad('dimensionPositive');
  if (shrinkage < 0 || shrinkage >= 0.2) return bad('shrinkageRange');
  return { ok: true, pattern: finalLength * (1 + shrinkage) };
}

/** Arc weld heat input per unit length, HI = eta V I / v, in J/mm with the travel speed in mm/s. */
export function weldHeat(volts: number, amps: number, travel: number, efficiency: number): Outcome<{ heatInput: number; steps: Step[] }> {
  if (!finite(volts, amps, travel, efficiency)) return bad('notNumber');
  if (volts <= 0 || amps <= 0) return bad('electricalPositive');
  if (travel <= 0) return bad('travelPositive');
  if (efficiency <= 0 || efficiency > 1) return bad('efficiencyRange');
  const hi = (efficiency * volts * amps) / travel;
  return {
    ok: true,
    heatInput: hi,
    steps: [{ key: 'heat', latex: `HI=\\dfrac{\\eta VI}{v}=\\dfrac{(${fmt(efficiency)})(${fmt(volts)})(${fmt(amps)})}{${fmt(travel)}}=${fmt(hi)}\\ \\mathrm{J/mm}` }],
  };
}

export interface LayerResult {
  layers: number;
  /** Height the layers actually reach (layers x thickness). */
  built: number;
  cusp: number;
  steps: Step[];
}

/**
 * Layer count and the stair-step (cusp) height of a surface whose normal is `angleDeg` from the build direction:
 * cusp = t |cos(angle)|. A flat top (0 degrees) has the full layer thickness as its step; a vertical wall (90) has none.
 */
export function layers(height: number, layer: number, angleDeg: number): Outcome<LayerResult> {
  if (!finite(height, layer, angleDeg)) return bad('notNumber');
  if (height <= 0 || layer <= 0) return bad('dimensionPositive');
  if (height / layer > 1e7) return bad('tooLarge');
  const n = Math.ceil(height / layer - 1e-9);
  const cusp = layer * Math.abs(Math.cos((angleDeg * Math.PI) / 180));
  return {
    ok: true,
    layers: n,
    built: n * layer,
    cusp,
    steps: [
      { key: 'layers', latex: `n=\\left\\lceil \\dfrac{H}{t}\\right\\rceil=\\left\\lceil \\dfrac{${fmt(height)}}{${fmt(layer)}}\\right\\rceil=${n}` },
      { key: 'cusp', latex: `c=t\\,|\\cos\\theta|=${fmt(layer)}\\,|\\cos ${fmt(angleDeg)}^\\circ|=${fmt(cusp)}\\ \\mathrm{mm}` },
    ],
  };
}
