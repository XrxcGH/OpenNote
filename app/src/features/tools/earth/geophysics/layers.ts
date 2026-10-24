// Layered earth: isostasy by Airy and Pratt, the conductive geotherm with radiogenic heat, half-space cooling of
// oceanic lithosphere, and apparent resistivity for the common electrode arrays. SI units throughout.
import { check } from '../core/problem';

/** The Airy root under topography of height h: r = h ρc / (ρm − ρc). */
export function airyRoot(height: number, crust: number, mantle: number): number {
  check(mantle > crust && crust > 0, 'densities');
  return (height * crust) / (mantle - crust);
}

/** The Airy antiroot under water of depth d: r′ = d (ρc − ρw) / (ρm − ρc). */
export function airyAntiroot(depth: number, crust: number, mantle: number, water: number): number {
  check(mantle > crust && crust > water, 'densities');
  return (depth * (crust - water)) / (mantle - crust);
}

/** The Pratt density of a column of height h above a compensation depth D: ρ = ρref D / (D + h). */
export function prattDensity(height: number, reference: number, compensation: number): number {
  check(compensation > 0 && compensation + height > 0, 'compensation');
  return (reference * compensation) / (compensation + height);
}

export interface Geotherm {
  /** Surface temperature (K or °C, as given), heat flow (W/m²), conductivity (W/(m·K)), heat production (W/m³). */
  surface: number;
  heatFlow: number;
  conductivity: number;
  production: number;
}

/** T(z) = T0 + (q0/k) z − (A / 2k) z², with uniform heat production A. */
export function geotherm(g: Geotherm, depth: number): number {
  check(g.conductivity > 0, 'conductivity');
  check(depth >= 0, 'depth');
  return g.surface + (g.heatFlow / g.conductivity) * depth - (g.production / (2 * g.conductivity)) * depth * depth;
}

/** The heat flow at depth z: q(z) = q0 − A z. */
export const heatFlowAt = (g: Geotherm, depth: number): number => g.heatFlow - g.production * depth;

export interface Cooling {
  mantle: number;
  surface: number;
  diffusivity: number;
  conductivity: number;
  expansion: number;
  mantleDensity: number;
  waterDensity: number;
  ridgeDepth: number;
}

/** Half-space cooling at age t (s): seafloor depth, surface heat flow, and the thermal thickness 2.32 √(κt). */
export function halfSpace(c: Cooling, age: number): { depth: number; heatFlow: number; thickness: number } {
  check(age > 0, 'age');
  check(c.diffusivity > 0 && c.mantleDensity > c.waterDensity && c.mantle > c.surface, 'cooling');
  const dT = c.mantle - c.surface;
  const kt = c.diffusivity * age;
  const subsidence =
    ((2 * c.mantleDensity * c.expansion * dT) / (c.mantleDensity - c.waterDensity)) * Math.sqrt(kt / Math.PI);
  return {
    depth: c.ridgeDepth + subsidence,
    heatFlow: (c.conductivity * dT) / Math.sqrt(Math.PI * kt),
    thickness: 2.32 * Math.sqrt(kt),
  };
}

export type ArrayKind = 'wenner' | 'schlumberger' | 'dipole';

/** The geometric factor K of an array, so that ρa = K V/I. */
export function geometricFactor(kind: ArrayKind, a: number, b: number, n: number): number {
  check(a > 0, 'spacing');
  if (kind === 'wenner') return 2 * Math.PI * a;
  if (kind === 'schlumberger') {
    // Here the first spacing is half the current electrode spacing (AB/2), the second half the potential one (MN/2).
    check(b > 0 && b < a, 'schlumberger');
    return (Math.PI * (a * a - b * b)) / (2 * b);
  }
  check(n >= 1, 'separation');
  return Math.PI * n * (n + 1) * (n + 2) * a;
}

/**
 * The apparent resistivity of a two-layer earth for a Wenner spacing a, by the image series:
 * ρa = ρ1 [1 + 4 Σ kⁿ (1/√(1 + (2nh/a)²) − 1/√(4 + (2nh/a)²))], with k = (ρ2 − ρ1)/(ρ2 + ρ1).
 */
export function twoLayerWenner(
  rho1: number,
  rho2: number,
  thickness: number,
  a: number,
): { rho: number; terms: number } {
  check(rho1 > 0 && rho2 > 0, 'resistivity');
  check(thickness > 0 && a > 0, 'spacing');
  const k = (rho2 - rho1) / (rho2 + rho1);
  let sum = 0;
  let terms = 0;
  for (let n = 1; n <= 20000; n++) {
    const u = (2 * n * thickness) / a;
    const term = k ** n * (1 / Math.sqrt(1 + u * u) - 1 / Math.sqrt(4 + u * u));
    sum += term;
    terms = n;
    if (Math.abs(term) < 1e-12 * Math.max(1, Math.abs(sum))) break;
  }
  return { rho: rho1 * (1 + 4 * sum), terms };
}
