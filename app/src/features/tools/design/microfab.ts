// Micro and nano fabrication process numbers. Each function states its units; the UI picks the display units.
import { bad, finite, fmt } from './types';
import type { Outcome, Step } from './types';

/** Lithography: resolution R = k1 lambda / NA and depth of focus DOF = k2 lambda / NA^2 (lambda and results in nm). */
export function lithography(
  wavelength: number,
  na: number,
  k1: number,
  k2: number,
): Outcome<{ resolution: number; dof: number; steps: Step[] }> {
  if (!finite(wavelength, na, k1, k2)) return bad('notNumber');
  if (wavelength <= 0) return bad('wavelengthPositive');
  if (na <= 0 || na > 1.6) return bad('naRange');
  if (k1 <= 0 || k2 <= 0) return bad('kPositive');
  const resolution = (k1 * wavelength) / na;
  const dof = (k2 * wavelength) / (na * na);
  return {
    ok: true,
    resolution,
    dof,
    steps: [
      {
        key: 'resolution',
        latex: `R=\\dfrac{k_1\\lambda}{NA}=\\dfrac{(${fmt(k1)})(${fmt(wavelength)})}{${fmt(na)}}=${fmt(resolution)}\\ \\mathrm{nm}`,
      },
      { key: 'dof', latex: `\\mathrm{DOF}=\\dfrac{k_2\\lambda}{NA^2}=${fmt(dof)}\\ \\mathrm{nm}` },
    ],
  };
}

export interface EtchResult {
  depth: number;
  undercut: number;
  /** Anisotropy A = 1 - lateral rate / vertical rate (1 is perfectly vertical, 0 is isotropic). */
  anisotropy: number;
  steps: Step[];
}

/** Etching with a vertical and a lateral rate (any one length unit per time unit) for a time in the same time unit. */
export function etch(vertical: number, lateral: number, time: number): Outcome<EtchResult> {
  if (!finite(vertical, lateral, time)) return bad('notNumber');
  if (vertical <= 0) return bad('rateVerticalPositive');
  if (lateral < 0) return bad('rateLateralNegative');
  if (time < 0) return bad('timeNegative');
  const a = 1 - lateral / vertical;
  return {
    ok: true,
    depth: vertical * time,
    undercut: lateral * time,
    anisotropy: a,
    steps: [
      { key: 'depth', latex: `d=r_v\\,t=${fmt(vertical * time)}` },
      { key: 'undercut', latex: `u=r_\\ell\\,t=${fmt(lateral * time)}` },
      { key: 'anisotropy', latex: `A=1-\\dfrac{r_\\ell}{r_v}=${fmt(a)}` },
    ],
  };
}

/** Selectivity: the ratio of the etch rate of the target film to the rate of the mask or stop layer below. */
export function selectivity(target: number, mask: number): Outcome<{ selectivity: number }> {
  if (!finite(target, mask)) return bad('notNumber');
  if (target < 0 || mask <= 0) return bad('rateMaskPositive');
  return { ok: true, selectivity: target / mask };
}

export interface StoneyInput {
  /** Substrate Young's modulus in Pa, Poisson ratio, thickness in m. */
  es: number;
  nus: number;
  hs: number;
  /** Film thickness in m and substrate radius of curvature in m (positive: convex film side). */
  hf: number;
  radius: number;
}

/** Stoney's equation: sigma_f = E_s h_s^2 / (6 (1 - nu_s) R h_f), in Pa. */
export function stoney(i: StoneyInput): Outcome<{ stress: number; steps: Step[] }> {
  if (!finite(i.es, i.nus, i.hs, i.hf, i.radius)) return bad('notNumber');
  if (i.es <= 0) return bad('modulusPositive');
  if (i.nus <= -1 || i.nus >= 0.5) return bad('poissonRange');
  if (i.hs <= 0 || i.hf <= 0) return bad('thicknessPositive');
  if (i.radius === 0) return bad('radiusNonZero');
  if (i.hf > i.hs / 10) return bad('filmNotThin');
  const stress = (i.es * i.hs * i.hs) / (6 * (1 - i.nus) * i.radius * i.hf);
  return {
    ok: true,
    stress,
    steps: [
      {
        key: 'stress',
        latex: `\\sigma_f=\\dfrac{E_s h_s^2}{6(1-\\nu_s)R\\,h_f}=${fmt(stress / 1e6)}\\ \\mathrm{MPa}`,
      },
    ],
  };
}

/**
 * Film thickness from a surface (Knudsen cosine-law) evaporation source on a flat substrate facing it at height h:
 * t(x) = t0 / (1 + (x/h)^2)^2, with t0 = m / (pi rho h^2) straight above the source. m in kg, rho in kg/m3, h in m.
 */
export function evaporation(
  mass: number,
  density: number,
  height: number,
  offset: number,
): Outcome<{ center: number; at: number }> {
  if (!finite(mass, density, height, offset)) return bad('notNumber');
  if (mass <= 0) return bad('massPositive');
  if (density <= 0) return bad('densityPositive');
  if (height <= 0) return bad('heightPositive');
  const center = mass / (Math.PI * density * height * height);
  return { ok: true, center, at: center / (1 + (offset / height) ** 2) ** 2 };
}

export interface DiesResult {
  dies: number;
  steps: Step[];
}

/**
 * Gross dies per wafer by the usual estimate N = pi (d/2)^2 / S - pi d / sqrt(2 S), with the wafer diameter d and
 * die area S in consistent units (mm and mm2). `edge` is an edge exclusion in mm (subtracted from the radius).
 */
export function diesPerWafer(diameter: number, dieArea: number, edge = 0): Outcome<DiesResult> {
  if (!finite(diameter, dieArea, edge)) return bad('notNumber');
  if (diameter <= 0) return bad('diameterPositive');
  if (dieArea <= 0) return bad('dieAreaPositive');
  if (edge < 0 || 2 * edge >= diameter) return bad('edgeRange');
  const d = diameter - 2 * edge;
  const n = (Math.PI * (d / 2) ** 2) / dieArea - (Math.PI * d) / Math.sqrt(2 * dieArea);
  if (n <= 0) return bad('dieTooLarge');
  return {
    ok: true,
    dies: n,
    steps: [
      {
        key: 'dies',
        latex: `N=\\dfrac{\\pi (d/2)^2}{S}-\\dfrac{\\pi d}{\\sqrt{2S}}=\\dfrac{\\pi(${fmt(d / 2)})^2}{${fmt(dieArea)}}-\\dfrac{\\pi(${fmt(d)})}{\\sqrt{2(${fmt(dieArea)})}}=${fmt(n, 5)}`,
      },
    ],
  };
}

export type YieldModel = 'poisson' | 'murphy' | 'seeds';

/** Yield from defect density D0 (per cm2) and die area A (cm2): Poisson e^-AD, Murphy ((1-e^-AD)/AD)^2, Seeds 1/(1+AD). */
export function dieYield(model: YieldModel, areaCm2: number, defectsPerCm2: number): Outcome<{ yield: number }> {
  if (!finite(areaCm2, defectsPerCm2)) return bad('notNumber');
  if (areaCm2 <= 0) return bad('dieAreaPositive');
  if (defectsPerCm2 < 0) return bad('defectsNegative');
  const x = areaCm2 * defectsPerCm2;
  if (x === 0) return { ok: true, yield: 1 };
  const y = model === 'poisson' ? Math.exp(-x) : model === 'murphy' ? ((1 - Math.exp(-x)) / x) ** 2 : 1 / (1 + x);
  return { ok: true, yield: y };
}

/** Langmuir equilibrium: fraction bound = c / (c + KD); both in the same concentration unit. */
export function fractionBound(conc: number, kd: number): Outcome<{ theta: number }> {
  if (!finite(conc, kd)) return bad('notNumber');
  if (conc < 0) return bad('concNegative');
  if (kd <= 0) return bad('kdPositive');
  return { ok: true, theta: conc / (conc + kd) };
}

export interface BindingResult {
  kd: number;
  /** Equilibrium fraction bound and the observed rate constant k_obs = kon c + koff (per second). */
  theta: number;
  kobs: number;
  /** Time to reach 95 percent of equilibrium, 3 / kobs ln-based: ln(20)/kobs. */
  t95: number;
  /** Fraction bound at the given time starting from an empty surface. */
  at: number;
  steps: Step[];
}

/** Langmuir kinetics: theta(t) = theta_eq (1 - e^(-k_obs t)); kon in 1/(M s), koff in 1/s, c in M, t in s. */
export function binding(kon: number, koff: number, conc: number, time: number): Outcome<BindingResult> {
  if (!finite(kon, koff, conc, time)) return bad('notNumber');
  if (kon <= 0 || koff <= 0) return bad('rateConstantPositive');
  if (conc < 0) return bad('concNegative');
  if (time < 0) return bad('timeNegative');
  const kd = koff / kon;
  const kobs = kon * conc + koff;
  const theta = (kon * conc) / kobs;
  return {
    ok: true,
    kd,
    theta,
    kobs,
    t95: Math.log(20) / kobs,
    at: theta * (1 - Math.exp(-kobs * time)),
    steps: [
      { key: 'kd', latex: `K_D=\\dfrac{k_{off}}{k_{on}}=${fmt(kd)}\\ \\mathrm{M}` },
      { key: 'theta', latex: `\\theta_{eq}=\\dfrac{c}{c+K_D}=${fmt(theta)}` },
      { key: 'kobs', latex: `k_{obs}=k_{on}c+k_{off}=${fmt(kobs)}\\ \\mathrm{s^{-1}}` },
    ],
  };
}
