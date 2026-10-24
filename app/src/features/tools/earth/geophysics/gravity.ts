// Gravity: normal gravity on the WGS84 ellipsoid, the free-air and Bouguer reductions of a station, and the
// anomalies of simple buried bodies. Everything is in SI (m/s²); 1 mGal = 10⁻⁵ m/s².
import { check } from '../core/problem';

/** The Newtonian constant of gravitation, CODATA 2018 (m³ kg⁻¹ s⁻²). */
export const G = 6.6743e-11;
export const MGAL = 1e-5;

/** WGS84 constants for Somigliana's closed formula (NIMA TR8350.2). */
export const WGS84 = { gammaE: 9.7803253359, k: 0.00193185265241, e2: 0.00669437999013 };

/** The free-air gradient, 0.3086 mGal per meter. */
export const FREE_AIR = 0.3086 * MGAL;

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Normal gravity at geodetic latitude φ (degrees) on the ellipsoid, by Somigliana's formula. */
export function normalGravity(latitude: number): number {
  check(Math.abs(latitude) <= 90, 'latitude');
  const s2 = Math.sin(rad(latitude)) ** 2;
  return (WGS84.gammaE * (1 + WGS84.k * s2)) / Math.sqrt(1 - WGS84.e2 * s2);
}

/** The attraction of an infinite horizontal slab, 2πGρh. */
export const bouguerSlab = (density: number, thickness: number): number => 2 * Math.PI * G * density * thickness;

export interface Reduction {
  normal: number;
  freeAir: number;
  bouguer: number;
  freeAirAnomaly: number | null;
  simpleBouguer: number | null;
  completeBouguer: number | null;
}

/** Reduces an observed gravity value at a station; the anomalies are null when no observation is given. */
export function reduce(station: {
  observed: number | null;
  latitude: number;
  elevation: number;
  density: number;
  terrain: number;
}): Reduction {
  check(station.density >= 0, 'density');
  const normal = normalGravity(station.latitude);
  const freeAir = FREE_AIR * station.elevation;
  const bouguer = bouguerSlab(station.density, station.elevation);
  if (station.observed === null)
    return { normal, freeAir, bouguer, freeAirAnomaly: null, simpleBouguer: null, completeBouguer: null };
  const freeAirAnomaly = station.observed - normal + freeAir;
  const simpleBouguer = freeAirAnomaly - bouguer;
  return { normal, freeAir, bouguer, freeAirAnomaly, simpleBouguer, completeBouguer: simpleBouguer + station.terrain };
}

export type Body = 'sphere' | 'hcylinder' | 'vcylinder' | 'fault';

export interface BodySpec {
  body: Body;
  /** Density contrast with the surroundings (kg/m³). */
  contrast: number;
  /** Radius of a sphere or cylinder (m). */
  radius: number;
  /** Depth to the center of a sphere or horizontal cylinder, to the top of a vertical cylinder or a slab (m). */
  depth: number;
  /** Depth to the bottom of a vertical cylinder (m). */
  bottom: number;
  /** Thickness of the faulted slab (m). */
  thickness: number;
}

function checkBody(spec: BodySpec): void {
  check(spec.depth > 0, 'depth');
  if (spec.body === 'sphere' || spec.body === 'hcylinder') check(spec.radius > 0 && spec.radius < spec.depth, 'buried');
  if (spec.body === 'vcylinder') check(spec.radius > 0 && spec.bottom > spec.depth, 'cylinder');
  if (spec.body === 'fault') check(spec.thickness > 0, 'thickness');
}

/** The vertical attraction of the body at horizontal offset x (m) from its axis or edge. */
export function bodyAnomaly(spec: BodySpec, x: number): number {
  checkBody(spec);
  const { contrast: rho, radius: r, depth: z } = spec;
  if (spec.body === 'sphere') {
    const mass = (4 / 3) * Math.PI * r ** 3 * rho;
    return (G * mass * z) / (x * x + z * z) ** 1.5;
  }
  if (spec.body === 'hcylinder') return (2 * G * Math.PI * r * r * rho * z) / (x * x + z * z);
  if (spec.body === 'vcylinder') {
    // On the axis only: the attraction of a vertical cylinder from its top to its bottom.
    const length = spec.bottom - z;
    return 2 * Math.PI * G * rho * (length + Math.hypot(z, r) - Math.hypot(spec.bottom, r));
  }
  // A thin slab that ends at x = 0 and runs on under positive x: the edge of a faulted layer.
  return 2 * G * rho * spec.thickness * (Math.PI / 2 + Math.atan(x / z));
}

/** The anomaly along a profile from −half to +half, in `count` steps. */
export function bodyProfile(spec: BodySpec, half: number, count = 81): [number, number][] {
  check(half > 0, 'profile');
  return Array.from({ length: count }, (_, i) => {
    const x = -half + (2 * half * i) / (count - 1);
    return [x, bodyAnomaly(spec, x)];
  });
}

/** The distance from the peak at which the anomaly falls to half its peak, for a sphere or a horizontal cylinder. */
export function halfWidth(spec: BodySpec): number | null {
  if (spec.body === 'sphere') return spec.depth * Math.sqrt(2 ** (2 / 3) - 1);
  if (spec.body === 'hcylinder') return spec.depth;
  return null;
}
