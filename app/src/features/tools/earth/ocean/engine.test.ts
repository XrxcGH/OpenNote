// Physical oceanography and geophysical fluid dynamics: each case checks the engine against a value computed
// independently or published as a check value, then the documented problems for impossible input.
import { describe, expect, it } from 'vitest';
import { Problem } from '../core/problem';
import { printed } from '../core/testing';
import {
  breaking,
  coriolis,
  deepWater,
  deformation,
  density,
  dispersion,
  ekman,
  freezingPoint,
  geostrophicFromHeight,
  gradientWind,
  isopycnalTemperature,
  lapseRate,
  mackenzie,
  potentialTemperature,
  pumping,
  rossbyWave,
  shallowSpeed,
  shoal,
  sigmaTheta,
  soundSpeed,
  thermalWind,
} from './engine';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
const problem = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    return error instanceof Problem ? error.code : 'other';
  }
  return null;
};

describe('rotating balances', () => {
  it('gives the Coriolis parameter, inertial period, and geostrophic wind at 45 N', () => {
    const c = coriolis(45);
    expect(printed(c.f, '0.000103126')).toBe(true);
    expect(printed(c.period / 3600, '16.9242')).toBe(true);
    expect(printed(geostrophicFromHeight(60, 600e3, c.f), '9.50938')).toBe(true);
  });

  it('gives the Rossby radius and the Ekman transport', () => {
    expect(rel(deformation(0.01, 1000, 1e-4).baroclinic, 100e3)).toBeLessThan(1e-12);
    expect(printed(ekman(0.1, 1025, 1e-4, 0.01).transport, '0.97561')).toBe(true);
  });

  it('balances the gradient wind equation for a cyclone and an anticyclone', () => {
    const f = 1e-4;
    for (const radius of [500e3, -2000e3]) {
      const v = gradientWind(10, radius, f);
      expect(Math.abs((v * v) / radius + f * v - f * 10)).toBeLessThan(1e-12);
    }
    expect(gradientWind(10, 500e3, f)).toBeLessThan(10);
    expect(gradientWind(10, -2000e3, f)).toBeGreaterThan(10);
    expect(problem(() => gradientWind(50, -100e3, f))).toBe('anticyclone');
  });

  it('gives the thermal wind, pumping, Sverdrup transport, and a long Rossby wave', () => {
    expect(
      rel(thermalWind(1000e2, 500e2, -10, 1000e3, 1e-4), ((287.05 / 1e-4) * Math.log(2) * -10) / 1e6),
    ).toBeLessThan(1e-12);
    const p = pumping(1e-7, 1025, 1e-4, 2e-11);
    expect(rel(p.w, 1e-7 / 0.1025)).toBeLessThan(1e-12);
    expect(rel(p.sverdrup, 1e-7 / (1025 * 2e-11))).toBeLessThan(1e-12);
    const wave = rossbyWave(2e-11, 1e-9, 0, 50e3);
    expect(rel(wave.phaseX, -2e-11 * 50e3 * 50e3)).toBeLessThan(1e-6);
  });

  it('names the equator, where f vanishes', () => {
    expect(problem(() => geostrophicFromHeight(10, 1e5, coriolis(0).f))).toBe('equator');
    expect(problem(() => coriolis(91))).toBe('latitude');
  });
});

describe('seawater by EOS-80', () => {
  it('matches the UNESCO 1983 density check values', () => {
    expect(Math.abs(density(35, 5, 0) - 1027.67547)).toBeLessThan(1e-5);
    expect(Math.abs(density(35, 25, 10000) - 1062.53817)).toBeLessThan(1e-5);
    expect(Math.abs(density(0, 5, 0) - 999.96675)).toBeLessThan(1e-5);
    expect(Math.abs(density(35, 5, 10000) - 1069.48914)).toBeLessThan(1e-5);
  });

  it('matches the lapse rate, potential temperature, sound speed, and freezing point check values', () => {
    expect(rel(lapseRate(40, 40, 10000), 3.255976e-4)).toBeLessThan(1e-6);
    expect(Math.abs(potentialTemperature(40, 40, 10000) - 36.89073)).toBeLessThan(1e-5);
    expect(Math.abs(soundSpeed(40, 40, 10000) - 1731.995)).toBeLessThan(1e-3);
    expect(Math.abs(freezingPoint(40, 500) - -2.588567)).toBeLessThan(1e-6);
  });

  it('gives the Mackenzie sound speed at 10 C, 35, and 1000 m', () => {
    expect(printed(mackenzie(10, 35, 1000), '1506.264')).toBe(true);
  });

  it('finds the temperature on an isopycnal', () => {
    const t = isopycnalTemperature(35, 26)!;
    expect(Math.abs(sigmaTheta(35, t) - 26)).toBeLessThan(1e-9);
    expect(isopycnalTemperature(35, 40)).toBeNull();
  });

  it('names salinity, temperature, and pressure out of range', () => {
    expect(problem(() => density(50, 5, 0))).toBe('salinity');
    expect(problem(() => density(35, 50, 0))).toBe('temperature');
    expect(problem(() => density(35, 5, 12000))).toBe('pressure');
  });
});

describe('surface gravity waves', () => {
  it('gives deep-water length and speed for a 10 s wave, and the shallow-water speed at 10 m', () => {
    const d = deepWater(10);
    expect(printed(d.length, '156.078')).toBe(true);
    expect(printed(d.phase, '15.6078')).toBe(true);
    expect(printed(shallowSpeed(10), '9.90285')).toBe(true);
  });

  it('solves the dispersion relation for a 10 s wave in 20 m of water', () => {
    const w = dispersion(10, 20);
    expect(printed(w.length, '121.21')).toBe(true);
    const omega = (2 * Math.PI) / 10;
    expect(rel(omega * omega, 9.80665 * w.k * Math.tanh(w.k * 20))).toBeLessThan(1e-12);
    expect(w.regime).toBe('intermediate');
  });

  it('converges from very shallow to very deep water', () => {
    for (const depth of [0.01, 1, 100, 10000]) {
      const w = dispersion(8, depth);
      const omega = (2 * Math.PI) / 8;
      expect(rel(omega * omega, 9.80665 * w.k * Math.tanh(w.k * depth))).toBeLessThan(1e-10);
    }
  });

  it('shoals, refracts, and breaks a swell', () => {
    const s = shoal(10, 1, 0, 1000);
    expect(rel(s.ks, 1)).toBeLessThan(1e-6);
    const near = shoal(10, 1, 30, 5);
    expect(near.angle).toBeLessThan(30);
    const b = breaking(2);
    expect(rel(b.setup / 2, 0.19)).toBeLessThan(0.01);
    expect(problem(() => dispersion(0, 10))).toBe('period');
  });
});
