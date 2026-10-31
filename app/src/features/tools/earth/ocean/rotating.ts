// Rotating-fluid balances for the ocean and atmosphere: the Coriolis parameter and β, geostrophic, gradient, and
// thermal winds or currents, Ekman layers and pumping, Sverdrup transport, the deformation radius, and Rossby and
// Kelvin waves. SI units; latitudes in degrees.
import { check } from '../core/problem';

/** Earth's rotation rate (rad/s), IERS conventions. */
export const OMEGA = 7.292115e-5;
export const G0 = 9.80665;
export const EARTH_RADIUS = 6371e3;
/** The gas constant of dry air (J kg⁻¹ K⁻¹). */
export const RD = 287.05;

const rad = (deg: number) => (deg * Math.PI) / 180;

export function coriolis(latitude: number): { f: number; beta: number; period: number } {
  check(Math.abs(latitude) <= 90, 'latitude');
  const f = 2 * OMEGA * Math.sin(rad(latitude));
  return {
    f,
    beta: (2 * OMEGA * Math.cos(rad(latitude))) / EARTH_RADIUS,
    period: f === 0 ? Infinity : (2 * Math.PI) / Math.abs(f),
  };
}

/** f must not vanish where a balance divides by it. */
function needF(f: number): void {
  check(Math.abs(f) > 1e-12, 'equator');
}

export const rossbyNumber = (speed: number, length: number, f: number): number => {
  needF(f);
  check(length > 0, 'length');
  return speed / (Math.abs(f) * length);
};

/** The geostrophic speed from a change in height (geopotential height or sea surface) over a distance. */
export function geostrophicFromHeight(dz: number, distance: number, f: number, g = G0): number {
  needF(f);
  check(distance > 0, 'length');
  return (g / f) * (dz / distance);
}

/** The geostrophic speed from a pressure change over a distance, in fluid of density ρ. */
export function geostrophicFromPressure(dp: number, distance: number, f: number, density: number): number {
  needF(f);
  check(distance > 0 && density > 0, 'length');
  return dp / (density * f * distance);
}

/**
 * The gradient wind around a center of radius R for a geostrophic speed Vg (northern hemisphere, f > 0): the
 * root of V²/R + fV = fVg. Cyclones take R > 0, anticyclones R < 0; anticyclones have no balance when the
 * pressure gradient is too strong.
 */
export function gradientWind(vg: number, radius: number, f: number): number {
  needF(f);
  check(radius !== 0, 'radius');
  const a = (f * radius) / 2;
  const disc = a * a + f * radius * vg;
  check(disc >= 0, 'anticyclone');
  return -a + Math.sign(radius) * Math.sqrt(disc);
}

/** The thermal wind across a layer from p1 to p2 (p1 > p2) for a mean temperature change ΔT over a distance. */
export function thermalWind(p1: number, p2: number, dT: number, distance: number, f: number): number {
  needF(f);
  check(p1 > p2 && p2 > 0, 'layer');
  check(distance > 0, 'length');
  return ((RD / f) * Math.log(p1 / p2) * dT) / distance;
}

export interface Ekman {
  depth: number;
  /** Volume transport per unit width (m²/s), at right angles to the stress. */
  transport: number;
  /** Mass transport per unit width (kg m⁻¹ s⁻¹). */
  mass: number;
}

/** The Ekman depth π √(2Az/|f|) and the transport τ/(ρf) for a surface stress τ. */
export function ekman(stress: number, density: number, f: number, viscosity: number): Ekman {
  needF(f);
  check(density > 0 && viscosity > 0, 'ekman');
  return {
    depth: Math.PI * Math.sqrt((2 * viscosity) / Math.abs(f)),
    transport: stress / (density * f),
    mass: stress / f,
  };
}

/** Ekman pumping w = curl τ / (ρf), and the Sverdrup transport curl τ / (ρβ) per unit width. */
export function pumping(curl: number, density: number, f: number, beta: number): { w: number; sverdrup: number } {
  needF(f);
  check(density > 0 && beta > 0, 'ekman');
  return { w: curl / (density * f), sverdrup: curl / (density * beta) };
}

/** Deformation radii: barotropic √(gH)/|f| and baroclinic NH/|f|, with the Kelvin-wave speeds √(gH) and NH. */
export function deformation(n: number, depth: number, f: number, g = G0) {
  needF(f);
  check(depth > 0 && n >= 0, 'depth');
  const barotropicSpeed = Math.sqrt(g * depth);
  const baroclinicSpeed = n * depth;
  return {
    barotropic: barotropicSpeed / Math.abs(f),
    baroclinic: baroclinicSpeed / Math.abs(f),
    barotropicSpeed,
    baroclinicSpeed,
  };
}

/** A Rossby wave of wavenumbers k, l (rad/m) with deformation radius L: ω = −βk / (k² + l² + L⁻²). */
export function rossbyWave(beta: number, k: number, l: number, radius: number) {
  check(radius > 0, 'radius');
  check(k !== 0, 'wavenumber');
  const s = k * k + l * l + 1 / (radius * radius);
  const omega = (-beta * k) / s;
  return {
    omega,
    phaseX: omega / k,
    groupX: (beta * (k * k - l * l - 1 / (radius * radius))) / (s * s),
    groupY: (2 * beta * k * l) / (s * s),
    longWave: -beta * radius * radius,
    period: (2 * Math.PI) / Math.abs(omega),
  };
}
