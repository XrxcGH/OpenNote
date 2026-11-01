import '../text';
import { describe, expect, it } from 'vitest';
import { CalcError } from '../numeric';
import {
  barge,
  bernoulli,
  buoyancy,
  curvedForce,
  manometer,
  manometerDifference,
  pitot,
  planeForce,
  venturi,
} from './engine';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('plane surface force', () => {
  it('vertical rectangular gate 2 m by 3 m, top at the surface', () => {
    const r = planeForce({
      shape: 'rectangle',
      width: 2,
      height: 3,
      topDepth: 0,
      angleDeg: 90,
      density: 1000,
      g: 9.81,
    });
    expect(rel(r.force, 88290)).toBeLessThan(1e-6);
    expect(r.pressureCenterDepth).toBeCloseTo(2, 9);
  });
  it('vertical circular gate D = 2 m with its top 1 m down', () => {
    const r = planeForce({ shape: 'circle', width: 2, height: 0, topDepth: 1, angleDeg: 90, density: 1000, g: 9.81 });
    expect(rel(r.force, 61638)).toBeLessThan(1e-5);
    expect(rel(r.pressureCenterDepth, 2.125)).toBeLessThan(1e-5);
  });
  it('independent numerical integration of a 60 degree inclined triangle', () => {
    const rho = 998;
    const g = 9.81;
    const b = 1.2;
    const H = 2;
    const top = 0.7;
    const th = (60 * Math.PI) / 180;
    // integrate p dA and the moment over the plate, apex up: width grows linearly from 0 at the top
    let F = 0;
    let M = 0;
    const n = 200000;
    for (let i = 0; i < n; i++) {
      const s = ((i + 0.5) / n) * H;
      const w = (b * s) / H;
      const depth = top + s * Math.sin(th);
      const dF = rho * g * depth * w * (H / n);
      F += dF;
      M += dF * depth;
    }
    const r = planeForce({
      shape: 'triangleApexUp',
      width: b,
      height: H,
      topDepth: top,
      angleDeg: 60,
      density: rho,
      g,
    });
    expect(rel(r.force, F)).toBeLessThan(1e-6);
    expect(rel(r.pressureCenterDepth, M / F)).toBeLessThan(1e-6);
  });
  it('a surface pressure raises the force and moves the center of pressure to the centroid', () => {
    const base = planeForce({
      shape: 'rectangle',
      width: 1,
      height: 1,
      topDepth: 0,
      angleDeg: 90,
      density: 1000,
      g: 9.81,
    });
    const pressed = planeForce({
      shape: 'rectangle',
      width: 1,
      height: 1,
      topDepth: 0,
      angleDeg: 90,
      density: 1000,
      g: 9.81,
      surfacePressure: 1e6,
    });
    expect(pressed.force).toBeCloseTo(base.force + 1e6, 3);
    expect(Math.abs(pressed.pressureCenterDepth - 0.5)).toBeLessThan(Math.abs(base.pressureCenterDepth - 0.5));
  });
  it('rejects impossible input', () => {
    expect(() =>
      planeForce({ shape: 'rectangle', width: -1, height: 1, topDepth: 0, angleDeg: 90, density: 1000 }),
    ).toThrow(CalcError);
    expect(() =>
      planeForce({ shape: 'rectangle', width: 1, height: 1, topDepth: -1, angleDeg: 90, density: 1000 }),
    ).toThrow(CalcError);
    expect(() =>
      planeForce({ shape: 'rectangle', width: 1, height: 1, topDepth: 0, angleDeg: 0, density: 1000 }),
    ).toThrow(CalcError);
    expect(() =>
      planeForce({ shape: 'rectangle', width: 1, height: 1, topDepth: 0, angleDeg: 90, density: 0 }),
    ).toThrow(CalcError);
  });
});

describe('curved surface', () => {
  it('quarter circle R = 2, width 3, top at the surface, fluid over the quarter disk', () => {
    const r = curvedForce({ orientation: 'quarterDisk', radius: 2, width: 3, topDepth: 0, density: 1000, g: 9.81 });
    expect(r.horizontal).toBeCloseTo(1000 * 9.81 * 1 * 6, 6);
    expect(r.vertical).toBeCloseTo(1000 * 9.81 * 3 * (Math.PI / 4) * 4, 6);
  });
  it('the two orientations of the same arc add up to the full column', () => {
    const a = curvedForce({ orientation: 'quarterDisk', radius: 1, width: 1, topDepth: 2, density: 1000, g: 9.81 });
    const b = curvedForce({
      orientation: 'quarterComplement',
      radius: 1,
      width: 1,
      topDepth: 2,
      density: 1000,
      g: 9.81,
    });
    expect(a.volume + b.volume).toBeCloseTo(2 * (1 * 2) + 1, 12);
  });
});

describe('manometer', () => {
  it('mercury U-tube: 0.3 m of mercury down from a water pipe', () => {
    const r = manometer(
      0,
      [
        { density: 1000, down: 0.5 },
        { density: 13600, down: -0.3 },
      ],
      9.81,
    );
    expect(r.pressure).toBeCloseTo(1000 * 9.81 * 0.5 - 13600 * 9.81 * 0.3, 6);
  });
  it('differential reading', () => {
    expect(manometerDifference(13600, 1000, 0.1, 9.81)).toBeCloseTo(12600 * 9.81 * 0.1, 9);
  });
  it('rejects an empty chain', () => {
    expect(() => manometer(0, [])).toThrow(CalcError);
  });
});

describe('buoyancy and stability', () => {
  it('barge B = 6 m, draft 1.5 m, KG = 2 m', () => {
    const r = barge({ beam: 6, length: 20, draft: 1.5, kg: 2, density: 1000 });
    expect(r.bm).toBeCloseTo(2, 9);
    expect(r.kb).toBeCloseTo(0.75, 9);
    expect(r.gm).toBeCloseTo(0.75, 9);
    expect(r.stable).toBe(true);
    expect(r.displacement).toBeCloseTo(1000 * 6 * 20 * 1.5, 6);
  });
  it('a high center of gravity is unstable', () => {
    expect(barge({ beam: 6, length: 20, draft: 1.5, kg: 4, density: 1000 }).stable).toBe(false);
  });
  it('ice floats 91.7 percent submerged, a rock sinks', () => {
    const ice = buoyancy({ fluidDensity: 1000, objectDensity: 917, volume: 2, g: 9.81 });
    expect(ice.floats).toBe(true);
    expect(ice.fractionSubmerged).toBeCloseTo(0.917, 9);
    expect(ice.buoyantForce).toBeCloseTo(ice.weight, 9);
    const rock = buoyancy({ fluidDensity: 1000, objectDensity: 2700, volume: 0.01, g: 9.81 });
    expect(rock.floats).toBe(false);
    expect(rock.holdingForce).toBeCloseTo(1700 * 9.81 * 0.01, 9);
  });
});

describe('Bernoulli, pitot and venturi', () => {
  it('pitot-static tube in air', () => {
    expect(rel(pitot({ density: 1.225, dp: 500 }).value, 28.571)).toBeLessThan(1e-4);
  });
  it('pitot with zero dp is zero speed, negative dp is rejected', () => {
    expect(pitot({ density: 1.2, dp: 0 }).value).toBe(0);
    expect(() => pitot({ density: 1.2, dp: -1 })).toThrow(CalcError);
  });
  it('Torricelli: speed from a tank 5 m deep', () => {
    const r = bernoulli({ density: 1000, g: 9.81, one: { p: 0, V: 0, z: 5 }, two: { p: 0, z: 0 }, headLoss: 0 });
    expect(r.unknown).toBe('V2');
    expect(r.value).toBeCloseTo(Math.sqrt(2 * 9.81 * 5), 9);
  });
  it('pressure downstream of a contraction', () => {
    const r = bernoulli({ density: 1000, g: 9.81, one: { p: 200000, V: 2, z: 0 }, two: { V: 8, z: 0 }, headLoss: 0 });
    expect(r.unknown).toBe('p2');
    expect(r.value).toBeCloseTo(200000 + 0.5 * 1000 * (4 - 64), 6);
  });
  it('solves for head loss and for an elevation', () => {
    const hl = bernoulli({ density: 1000, g: 9.81, one: { p: 300000, V: 3, z: 0 }, two: { p: 100000, V: 3, z: 10 } });
    expect(hl.unknown).toBe('hL');
    expect(hl.value).toBeCloseTo(200000 / 9810 - 10, 9);
    const z = bernoulli({
      density: 1000,
      g: 9.81,
      one: { p: 300000, V: 3, z: 0 },
      two: { p: 100000, V: 3 },
      headLoss: 2,
      pumpHead: 1,
    });
    expect(z.unknown).toBe('z2');
    expect(z.value).toBeCloseTo(200000 / 9810 + 1 - 2, 9);
  });
  it('pump head is added on the upstream side', () => {
    const r = bernoulli({
      density: 1000,
      g: 9.81,
      one: { p: 0, V: 0, z: 0 },
      two: { p: 0, V: 0 },
      headLoss: 0,
      pumpHead: 12,
    });
    expect(r.value).toBeCloseTo(12, 12);
  });
  it('reports impossible and ambiguous problems', () => {
    expect(() => bernoulli({ density: 1000, one: { p: 0, V: 0, z: 0 }, two: { p: 1e5, z: 0 }, headLoss: 0 })).toThrow(
      /No real speed/,
    );
    expect(() =>
      bernoulli({ density: 1000, one: { p: 0, V: 0, z: 0 }, two: { p: 0, V: 0, z: 0 }, headLoss: 0 }),
    ).toThrow(CalcError);
    expect(() => bernoulli({ density: 1000, one: { V: 0, z: 0 }, two: { z: 0 } })).toThrow(CalcError);
    expect(() => bernoulli({ density: 1000, one: { p: 0, V: 0, z: 0 }, two: { p: 0, V: 0, z: 5 } })).toThrow(
      /negative/,
    );
  });
  it('venturi matches continuity plus Bernoulli', () => {
    const r = venturi({ density: 1000, dp: 20000, upstreamDiameter: 0.1, throatDiameter: 0.05 });
    const A1 = Math.PI * 0.05 ** 2;
    const A2 = Math.PI * 0.025 ** 2;
    const q = A2 * Math.sqrt((2 * 20000) / 1000 / (1 - (A2 / A1) ** 2));
    expect(rel(r.flow, q)).toBeLessThan(1e-12);
    expect(() => venturi({ density: 1000, dp: 10, upstreamDiameter: 0.05, throatDiameter: 0.1 })).toThrow(CalcError);
  });
});
