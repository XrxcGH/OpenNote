import { describe, expect, it } from 'vitest';
import { ASTRO, C, MASS_JUPITER, MASS_SUN } from '../shared/constants';
import { PhysicsError } from '../shared/errors';
import {
  SIGMA_T,
  blackbody,
  bolometric,
  compact,
  distanceFromMagnitudes,
  distanceFromParallax,
  equilibrium,
  fluxRatio,
  fractionBelow,
  habitableZone,
  hrDiagram,
  jeans,
  luminosity,
  parseStars,
  radialVelocity,
  saha,
  transit,
} from './engine';

const rel = (got: number, want: number) => Math.abs(got / want - 1);
const item = (calc: { items: readonly { key: string; value: number }[] }, key: string) =>
  calc.items.find((one) => one.key === key)!.value;

describe('magnitudes and distances', () => {
  it('gives 100 pc for m 10 and M 5, and 63.0957 pc with one magnitude of extinction', () => {
    expect(item(distanceFromMagnitudes(10, 5), 'distance')).toBeCloseTo(100, 6);
    expect(item(distanceFromMagnitudes(10, 5, 1), 'distance')).toBeCloseTo(63.0957, 4);
  });

  it('turns a parallax into a distance and an absolute magnitude', () => {
    const calc = distanceFromParallax(0.1, 5);
    expect(item(calc, 'distance')).toBeCloseTo(10, 12);
    expect(item(calc, 'absolute')).toBeCloseTo(5, 12);
    expect(() => distanceFromParallax(0)).toThrow(PhysicsError);
  });

  it('gives a flux ratio of 100 for five magnitudes', () => {
    expect(item(fluxRatio(1, 6), 'fluxRatio')).toBeCloseTo(100, 9);
  });

  it('gives one solar luminosity for the Sun’s bolometric magnitude', () => {
    expect(item(bolometric(4.81, -0.07), 'luminositySun')).toBeCloseTo(1, 9);
  });
});

describe('blackbodies', () => {
  it('gives the Sun’s Wien peak and nominal luminosity', () => {
    expect(rel(item(blackbody(5772, 400e-9, 700e-9), 'wien'), 502.039e-9)).toBeLessThan(1e-4);
    expect(rel(item(luminosity(6.957e8, 5772), 'luminosity'), 3.828e26)).toBeLessThan(1e-4);
  });

  it('gives the visible-band fraction from the exact series', () => {
    // Independent value from numerical integration of the Planck function (SciPy quad).
    expect(item(blackbody(5772, 400e-9, 700e-9), 'bandFraction')).toBeCloseTo(0.366383171, 7);
    expect(fractionBelow(1e-3, 5772)).toBeGreaterThan(0.9999);
    expect(fractionBelow(1e-9, 5772)).toBeLessThan(1e-12);
  });

  it('refuses a band that ends before it starts', () => {
    expect(() => blackbody(5772, 700e-9, 400e-9)).toThrow(PhysicsError);
  });
});

describe('HR diagrams', () => {
  it('reads a star list and estimates main-sequence masses and lifetimes', () => {
    const stars = parseStars('Sun, 5772, 1\nSirius A, 9940, 25.4');
    expect(stars).toHaveLength(2);
    const calc = hrDiagram(stars);
    expect(calc.items[0]!.value).toBeCloseTo(1, 12);
    expect(calc.items[1]!.value).toBeCloseTo(10, 12);
    expect(calc.plot?.reverseX).toBe(true);
    expect(() => parseStars('Sun, hot, bright')).toThrow(PhysicsError);
  });

  it('reads rows typed with single spaces, with or without a name', () => {
    expect(parseStars('9940 25.4\nSirius A 9940 25.4')).toEqual([
      { name: '1', temperature: 9940, luminosity: 25.4 },
      { name: 'Sirius A', temperature: 9940, luminosity: 25.4 },
    ]);
    expect(() => parseStars('Sirius 9940')).toThrow(PhysicsError);
  });
});

describe('stellar atmospheres', () => {
  it('gives the Saha ratio for hydrogen at 10 000 K and 1e20 electrons per cubic metre', () => {
    expect(rel(item(saha(1e4, 1e20), 'sahaRatio'), 3.3849)).toBeLessThan(1e-3);
    // Independent value: 4 exp(−10.1988 eV / kT) at 10 000 K.
    expect(rel(item(saha(1e4, 1e20), 'boltzmannRatio'), 2.897865e-5)).toBeLessThan(1e-5);
  });
});

describe('compact objects and clouds', () => {
  it('gives the Sun’s Schwarzschild radius, surface redshift, and Eddington luminosity', () => {
    const calc = compact(MASS_SUN, ASTRO.rSun);
    expect(rel(item(calc, 'schwarzschild'), 2953.2500761)).toBeLessThan(1e-9);
    expect(rel(item(calc, 'redshift'), 2.1225093e-6)).toBeLessThan(1e-6);
    expect(rel(item(calc, 'eddington'), 1.2570652e31)).toBeLessThan(1e-6);
    expect(rel(SIGMA_T, 6.6524587051e-29)).toBeLessThan(1e-9);
  });

  it('gives the Jeans mass of a cold molecular cloud', () => {
    const calc = jeans(10, 1e10, 2.33);
    expect(rel(item(calc, 'jeansMass'), 5.3756132)).toBeLessThan(1e-4);
    expect(rel(item(calc, 'freeFall'), 337097.45)).toBeLessThan(1e-4);
  });
});

describe('exoplanets', () => {
  it('gives the transit depth of a Jupiter-size planet across the Sun', () => {
    const calc = transit(69911e3, 695700e3, 4332.589 * 86400, MASS_SUN);
    expect(item(calc, 'depth')).toBeCloseTo(0.010098, 6);
    expect(() => transit(69911e3, 695700e3, 86400, MASS_SUN, 1.2)).toThrow(PhysicsError);
  });

  it('gives the Sun’s reflex velocity from Jupiter', () => {
    const calc = radialVelocity(MASS_JUPITER, MASS_SUN, 4332.589 * 86400);
    expect(rel(item(calc, 'semiAmplitude'), 12.47)).toBeLessThan(1e-3);
    expect(rel(item(calc, 'semiAmplitude'), 12.4590801)).toBeLessThan(1e-6);
    expect(rel(item(calc, 'massFunction'), 1.72636879e21)).toBeLessThan(1e-6);
    expect(() => radialVelocity(MASS_JUPITER, MASS_SUN, 1, 1)).toThrow(PhysicsError);
  });

  it('gives the Earth’s equilibrium temperature with albedo 0.3', () => {
    expect(item(equilibrium(5772, 6.957e8, ASTRO.au, 0.3), 'equilibrium')).toBeCloseTo(254.59, 2);
  });

  it('gives the habitable zone of the Sun and a cool star from the published fit', () => {
    expect(item(habitableZone(5772, 1), 'hzMoist')).toBeCloseTo(0.99339, 4);
    expect(item(habitableZone(3800, 0.05), 'hzMoist')).toBeCloseTo(0.238078, 5);
    expect(() => habitableZone(9000, 10)).toThrow(PhysicsError);
  });

  it('uses CODATA constants', () => {
    expect(C.c).toBe(299792458);
  });
});
