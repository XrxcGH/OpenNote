// Solid-earth geophysics: each case checks the engine against a value worked out independently by hand or from
// the closed form, then the documented problems for impossible input.
import { describe, expect, it } from 'vitest';
import { Problem } from '../core/problem';
import { SECONDS_PER_YEAR } from '../core/units';
import {
  MGAL,
  airyAntiroot,
  airyRoot,
  bodyAnomaly,
  bodyProfile,
  bouguerSlab,
  eulerVelocity,
  FREE_AIR,
  geometricFactor,
  geotherm,
  halfSpace,
  halfWidth,
  inclination,
  inducedSphere,
  latitudeFromInclination,
  normalGravity,
  prattDensity,
  reduce,
  spreading,
  twoLayerWenner,
  virtualPole,
} from './engine';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const sphere = { body: 'sphere' as const, contrast: 500, radius: 100, depth: 200, bottom: 0, thickness: 0 };
const problem = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof Problem ? error.code : 'other';
  }
  return null;
};

describe('gravity', () => {
  it('gives WGS84 normal gravity at 45 degrees latitude', () => {
    expect(Math.abs(normalGravity(45) - 9.806197769)).toBeLessThan(1e-9);
  });

  it('gives the Bouguer slab for 100 m at 2670 kg/m³ and the free-air correction for 100 m', () => {
    expect(rel(bouguerSlab(2670, 100) / MGAL, 11.1969)).toBeLessThan(1e-4);
    expect(rel((FREE_AIR * 100) / MGAL, 30.86)).toBeLessThan(1e-9);
  });

  it('gives the peak anomaly of a buried sphere', () => {
    expect(rel(bodyAnomaly(sphere, 0) / MGAL, 0.349466)).toBeLessThan(1e-5);
    const half = halfWidth(sphere)!;
    expect(rel(bodyAnomaly(sphere, half), bodyAnomaly(sphere, 0) / 2)).toBeLessThan(1e-12);
  });

  it('gives a horizontal cylinder half its peak at x = z, and a fault step half the slab at its edge', () => {
    const cyl = { ...sphere, body: 'hcylinder' as const };
    expect(rel(bodyAnomaly(cyl, 200), bodyAnomaly(cyl, 0) / 2)).toBeLessThan(1e-12);
    const fault = { ...sphere, body: 'fault' as const, thickness: 50 };
    expect(rel(bodyAnomaly(fault, 0), bouguerSlab(500, 50) / 2)).toBeLessThan(1e-12);
    expect(rel(bodyAnomaly(fault, 1e9), bouguerSlab(500, 50))).toBeLessThan(1e-6);
  });

  it('gives a long vertical cylinder of large radius the Bouguer slab of its length', () => {
    const cyl = { ...sphere, body: 'vcylinder' as const, radius: 1e7, depth: 10, bottom: 110 };
    expect(rel(bodyAnomaly(cyl, 0), bouguerSlab(500, 100))).toBeLessThan(1e-4);
  });

  it('reduces a station: free-air and simple Bouguer anomalies', () => {
    const r = reduce({ observed: 9.806197769 + 10 * MGAL, latitude: 45, elevation: 100, density: 2670, terrain: 0 });
    expect(rel(r.freeAirAnomaly! / MGAL, 10 + 30.86)).toBeLessThan(1e-6);
    expect(rel(r.simpleBouguer! / MGAL, 10 + 30.86 - 11.1969)).toBeLessThan(1e-4);
  });

  it('names impossible bodies and latitudes', () => {
    expect(problem(() => normalGravity(95))).toBe('latitude');
    expect(problem(() => bodyAnomaly({ ...sphere, radius: 300 }, 0))).toBe('buried');
    expect(problem(() => bodyAnomaly({ ...sphere, depth: 0 }, 0))).toBe('depth');
    expect(problem(() => bodyProfile(sphere, 0))).toBe('profile');
  });
});

describe('magnetics', () => {
  it('gives the inclination at magnetic latitude 30 and back', () => {
    expect(rel(inclination(30), 49.1066)).toBeLessThan(1e-6);
    expect(rel(latitudeFromInclination(inclination(30)), 30)).toBeLessThan(1e-12);
  });

  it('puts the virtual pole of a vertical-dipole direction at the geographic pole', () => {
    const pole = virtualPole({ latitude: 30, longitude: 20 }, 0, inclination(30));
    expect(pole.latitude).toBeCloseTo(90, 9);
    expect(pole.colatitude).toBeCloseTo(60, 9);
  });

  it('gives an induced sphere at the pole the field of its moment straight below', () => {
    const at = inducedSphere({ field: 5e-5, inc: 90, chi: 0.01, radius: 10, depth: 100 }, 0);
    // m = χVF/μ0 and the axial field is μ0 m / (2π r³) = χ F (2/3) (R/r)³.
    expect(rel(at, 0.01 * 5e-5 * (2 / 3) * 1e-3)).toBeLessThan(1e-12);
  });
});

describe('isostasy, heat, and plates', () => {
  it('gives the Airy root under 3 km of topography', () => {
    expect(rel(airyRoot(3000, 2800, 3300), 16800)).toBeLessThan(1e-12);
    expect(rel(airyAntiroot(5000, 2800, 3300, 1030), (5000 * 1770) / 500)).toBeLessThan(1e-12);
    expect(rel(prattDensity(0, 2800, 100e3), 2800)).toBeLessThan(1e-12);
  });

  it('gives the geotherm at 10 km', () => {
    const g = { surface: 10, heatFlow: 0.065, conductivity: 2.5, production: 1e-6 };
    expect(Math.abs(geotherm(g, 10e3) - 250)).toBeLessThan(1e-9);
  });

  it('gives half-space heat flow that falls as one over the root of age', () => {
    const c = {
      mantle: 1350,
      surface: 0,
      diffusivity: 1e-6,
      conductivity: 3.3,
      expansion: 3e-5,
      mantleDensity: 3300,
      waterDensity: 1000,
      ridgeDepth: 2500,
    };
    const year = SECONDS_PER_YEAR;
    const young = halfSpace(c, 25e6 * year);
    const old = halfSpace(c, 100e6 * year);
    expect(rel(young.heatFlow / old.heatFlow, 2)).toBeLessThan(1e-12);
    expect(rel(old.depth - c.ridgeDepth, 2 * (young.depth - c.ridgeDepth))).toBeLessThan(1e-12);
  });

  it('moves a site 90 degrees from a pole turning 1 degree per million years at 11.1195 cm/yr', () => {
    const v = eulerVelocity({ latitude: 90, longitude: 0 }, 1, { latitude: 0, longitude: 0 });
    expect(rel(v.speed * SECONDS_PER_YEAR * 100, 11.1195)).toBeLessThan(1e-5);
    expect(v.azimuth).toBeCloseTo(90, 9);
    expect(v.distance).toBeCloseTo(90, 9);
    expect(spreading(100e3, 2e6).full).toBe(0.1);
  });
});

describe('resistivity', () => {
  it('gives the Wenner apparent resistivity for a = 10 m and V/I = 1.5 ohm', () => {
    expect(rel(geometricFactor('wenner', 10, 0, 0) * 1.5, 94.2478)).toBeLessThan(1e-6);
  });

  it('gives the Schlumberger and dipole-dipole factors', () => {
    expect(rel(geometricFactor('schlumberger', 10, 1, 0), (Math.PI * 99) / 2)).toBeLessThan(1e-12);
    expect(rel(geometricFactor('dipole', 5, 0, 2), Math.PI * 24 * 5)).toBeLessThan(1e-12);
    expect(problem(() => geometricFactor('schlumberger', 1, 2, 0))).toBe('schlumberger');
  });

  it('runs a two-layer sounding from the top layer to the bottom one', () => {
    expect(rel(twoLayerWenner(100, 1000, 10, 0.01).rho, 100)).toBeLessThan(1e-3);
    expect(rel(twoLayerWenner(100, 1000, 10, 1e5).rho, 1000)).toBeLessThan(2e-2);
    expect(twoLayerWenner(100, 100, 10, 10).rho).toBe(100);
  });
});
