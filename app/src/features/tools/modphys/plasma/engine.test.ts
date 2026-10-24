import { describe, expect, it } from 'vitest';
import { C } from '../shared/constants';
import { PhysicsError } from '../shared/errors';
import {
  IGNITION,
  alfvenSpeed,
  coulombLog,
  debyeLength,
  dipole,
  gyroFrequency,
  lawson,
  magnetopause,
  plasmaFrequency,
  plasmaParameters,
  sheath,
} from './engine';

const EV = C.e / C.kB;
const rel = (got: number, want: number) => Math.abs(got / want - 1);
const item = (calc: { items: readonly { key: string; value: number }[] }, key: string) =>
  calc.items.find((one) => one.key === key)!.value;

describe('plasma parameters', () => {
  it('gives the Debye length and electron plasma frequency at 10 eV and 1e18 per cubic metre', () => {
    expect(rel(debyeLength(1e18, 10 * EV), 23.508e-6)).toBeLessThan(1e-4);
    expect(rel(plasmaFrequency(1e18, C.me), 8.9787e9)).toBeLessThan(1e-4);
  });

  it('gives the electron gyrofrequency at 1 T', () => {
    expect(rel(gyroFrequency(1, C.me), 27.992e9)).toBeLessThan(1e-4);
  });

  it('gives the Alfven speed for 5 nT and 5 protons per cubic centimetre', () => {
    expect(rel(alfvenSpeed(5e-9, 5e6, C.mp), 48.773e3)).toBeLessThan(1e-4);
  });

  it('picks the NRL Coulomb logarithm branch by temperature', () => {
    // 10 eV is not below 10 Z² eV, so the hot branch: 24 − ln(√(1e12) / 10).
    expect(coulombLog(1e18, 10 * EV)).toBeCloseTo(12.487074535, 8);
    // 1 eV uses the cold branch: 23 − ln(√(1e12) × 1 × 1).
    expect(coulombLog(1e18, 1 * EV)).toBeCloseTo(23 - Math.log(1e6), 9);
  });

  it('builds the full table with the Debye number, collision rate and beta', () => {
    const calc = plasmaParameters({ ne: 1e18, te: 10 * EV, ti: 0, b: 1, mi: C.mp, z: 1 });
    expect(rel(item(calc, 'debyeNumber'), 54418.443)).toBeLessThan(1e-6);
    expect(rel(item(calc, 'collisionFreq'), 1149089.07)).toBeLessThan(1e-6);
    expect(rel(item(calc, 'beta'), 4.0267091e-6)).toBeLessThan(1e-6);
    expect(calc.steps.length).toBeGreaterThan(10);
  });

  it('says why an empty plasma has no parameters', () => {
    expect(() => plasmaParameters({ ne: 0, te: 10 * EV, ti: 0, b: 1, mi: C.mp, z: 1 })).toThrow(PhysicsError);
    expect(() => debyeLength(1e18, -1)).toThrow(PhysicsError);
  });
});

describe('sheaths', () => {
  it('gives the Bohm speed, floating potential and Child-law thickness for hydrogen', () => {
    const calc = sheath(1e18, 10 * EV, C.mp);
    expect(rel(item(calc, 'bohm'), 30949.69)).toBeLessThan(1e-6);
    expect(rel(item(calc, 'floating'), 28.387753)).toBeLessThan(1e-6);
    expect(rel(item(calc, 'sheath'), 4.075995e-5)).toBeLessThan(1e-5);
  });
});

describe('magnetospheres', () => {
  it('gives the magnetopause standoff for the Earth in a typical solar wind', () => {
    const calc = magnetopause(3.12e-5, 5e6, 400e3, C.mp);
    expect(rel(item(calc, 'standoff'), 10.25)).toBeLessThan(1e-3);
    expect(item(calc, 'bowShock') / item(calc, 'standoff')).toBeCloseTo(1.275, 12);
  });

  it('gives the dipole field, invariant latitude and drift period', () => {
    const calc = dipole({
      b0: 3.12e-5,
      radius: 6.371e6,
      l: 4,
      latitude: Math.PI / 6,
      energy: 1e6 * C.e,
      mass: C.mp,
      z: 1,
    });
    expect(rel(item(calc, 'fieldAt'), 1.5286563e-6)).toBeLessThan(1e-6);
    expect(item(calc, 'invariantLatitude')).toBeCloseTo(60, 9);
    expect(rel(item(calc, 'driftPeriod'), 663.43698)).toBeLessThan(1e-6);
    expect(calc.plot?.series.length).toBeGreaterThan(2);
  });

  it('uses p v / 2 for a relativistic electron', () => {
    const calc = dipole({ b0: 3.12e-5, radius: 6.371e6, l: 6.6, latitude: 0, energy: 1e6 * C.e, mass: C.me, z: -1 });
    expect(rel(item(calc, 'driftPeriod'), 600.61744)).toBeLessThan(1e-6);
  });

  it('refuses a shell inside the planet or a latitude off the field line', () => {
    expect(() => dipole({ b0: 3e-5, radius: 6e6, l: 0.5, latitude: 0, energy: 1, mass: C.mp, z: 1 })).toThrow(
      PhysicsError,
    );
    expect(() => dipole({ b0: 3e-5, radius: 6e6, l: 2, latitude: 1.2, energy: 1, mass: C.mp, z: 1 })).toThrow(
      PhysicsError,
    );
  });
});

describe('fusion', () => {
  it('compares the triple product with the ignition value', () => {
    const calc = lawson(1e20, 15e3 * EV, 2);
    expect(item(calc, 'tripleProduct')).toBeCloseTo(3e21, -12);
    expect(item(calc, 'lawsonRatio')).toBeCloseTo(3e21 / IGNITION, 9);
  });
});
