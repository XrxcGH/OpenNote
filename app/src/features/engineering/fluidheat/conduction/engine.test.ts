import '../text';
import { describe, expect, it } from 'vitest';
import { CalcError, SIGMA } from '../numeric';
import { criticalRadius, generation, radiationCoefficient, solveWall } from './engine';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

describe('plane walls', () => {
  const wall = {
    geometry: 'plane' as const,
    extent: 1,
    layers: [
      { size: 0.2, k: 0.72, label: 'brick' },
      { size: 0.05, k: 0.04, label: 'insulation' },
    ],
    tInner: 20,
    tOuter: -10,
    hInner: 10,
    hOuter: 25,
  };
  it('brick and insulation wall: R_total = 1.66778 K/W, q = 17.988 W', () => {
    const r = solveWall(wall);
    expect(rel(r.total, 1.66778)).toBeLessThan(1e-5);
    expect(rel(r.q, 17.988)).toBeLessThan(1e-5);
    expect(r.nodes[0]).toBe(20);
    expect(r.nodes.at(-1)!).toBeCloseTo(-10, 9);
    // inner surface temperature from first principles
    expect(r.nodes[1]!).toBeCloseTo(20 - 17.988 / 10, 3);
  });
  it('profile is continuous and ends at the outer surface temperature', () => {
    const r = solveWall(wall);
    expect(r.profile[0]!.x).toBe(0);
    expect(r.profile.at(-1)!.x).toBeCloseTo(0.25, 12);
    expect(r.profile.at(-1)!.t).toBeCloseTo(-10 + r.q / 25, 9);
    for (let i = 1; i < r.profile.length; i++) expect(r.profile[i]!.t).toBeLessThanOrEqual(r.profile[i - 1]!.t + 1e-12);
  });
  it('contact resistance and fixed surface temperatures', () => {
    const r = solveWall({
      ...wall,
      layers: [{ ...wall.layers[0]!, contactAfter: 0.01 }, wall.layers[1]!],
      hInner: undefined,
      hOuter: undefined,
    });
    expect(r.total).toBeCloseTo(0.2 / 0.72 + 0.01 + 0.05 / 0.04, 12);
    expect(r.items.map((i) => i.kind)).toEqual(['conduction', 'contact', 'conduction']);
    expect(r.q).toBeCloseTo(30 / r.total, 12);
  });
  it('heat flows backwards when the outside is warmer', () => {
    expect(solveWall({ ...wall, tInner: -10, tOuter: 20 }).q).toBeCloseTo(-17.988, 3);
  });
  it('rejects impossible walls', () => {
    expect(() => solveWall({ ...wall, layers: [] })).toThrow(CalcError);
    expect(() => solveWall({ ...wall, layers: [{ size: 0, k: 1 }] })).toThrow(CalcError);
    expect(() => solveWall({ ...wall, layers: [{ size: 1, k: 0 }] })).toThrow(CalcError);
    expect(() => solveWall({ ...wall, extent: -1 })).toThrow(CalcError);
    expect(() => solveWall({ ...wall, hInner: 0 })).toThrow(CalcError);
  });
});

describe('cylinders and spheres', () => {
  it('insulated steam pipe against the textbook resistance formulas', () => {
    const r = solveWall({
      geometry: 'cylinder',
      extent: 10,
      innerRadius: 0.05,
      layers: [
        { size: 0.055, k: 45 },
        { size: 0.105, k: 0.06 },
      ],
      tInner: 180,
      tOuter: 20,
      hInner: 1000,
      hOuter: 12,
    });
    const R =
      1 / (1000 * 2 * Math.PI * 0.05 * 10) +
      Math.log(0.055 / 0.05) / (2 * Math.PI * 45 * 10) +
      Math.log(0.105 / 0.055) / (2 * Math.PI * 0.06 * 10) +
      1 / (12 * 2 * Math.PI * 0.105 * 10);
    expect(rel(r.total, R)).toBeLessThan(1e-12);
    // check the radial profile is logarithmic: temperature at the interface equals the node value
    const iface = r.profile.find((p) => Math.abs(p.x - 0.055) < 1e-12)!;
    expect(iface.t).toBeCloseTo(r.nodes[2]!, 6);
  });
  it('hollow sphere', () => {
    const r = solveWall({
      geometry: 'sphere',
      extent: 0,
      innerRadius: 0.1,
      layers: [{ size: 0.2, k: 2 }],
      tInner: 100,
      tOuter: 0,
    });
    expect(r.total).toBeCloseTo((10 - 5) / (4 * Math.PI * 2), 12);
    expect(r.q).toBeCloseTo(100 / r.total, 9);
    expect(r.profile.at(-1)!.t).toBeCloseTo(0, 9);
  });
  it('rejects a shell whose outer radius is inside its inner radius', () => {
    expect(() =>
      solveWall({
        geometry: 'cylinder',
        extent: 1,
        innerRadius: 0.1,
        layers: [{ size: 0.05, k: 1 }],
        tInner: 1,
        tOuter: 0,
      }),
    ).toThrow(CalcError);
    expect(() =>
      solveWall({ geometry: 'cylinder', extent: 1, layers: [{ size: 0.05, k: 1 }], tInner: 1, tOuter: 0 }),
    ).toThrow(CalcError);
  });
});

describe('critical radius and radiation', () => {
  it('k 0.05, h 5: 10 mm for a cylinder and 20 mm for a sphere', () => {
    expect(criticalRadius('cylinder', 0.05, 5).radius).toBeCloseTo(0.01, 12);
    expect(criticalRadius('sphere', 0.05, 5).radius).toBeCloseTo(0.02, 12);
    expect(() => criticalRadius('cylinder', 0, 5)).toThrow(CalcError);
  });
  it('adding insulation beyond the critical radius reduces the loss, below it raises it', () => {
    const loss = (rOut: number) =>
      solveWall({
        geometry: 'cylinder',
        extent: 1,
        innerRadius: 0.005,
        layers: [{ size: rOut, k: 0.05 }],
        tInner: 100,
        tOuter: 20,
        hOuter: 5,
      }).q;
    expect(loss(0.01)).toBeGreaterThan(loss(0.0051));
    expect(loss(0.05)).toBeLessThan(loss(0.01));
  });
  it('linearised radiation coefficient matches the exact flux', () => {
    const hr = radiationCoefficient(0.9, 400, 300);
    expect(hr * 100).toBeCloseTo(0.9 * SIGMA * (400 ** 4 - 300 ** 4), 6);
    expect(() => radiationCoefficient(1.5, 400, 300)).toThrow(CalcError);
    expect(() => radiationCoefficient(0.5, 0, 300)).toThrow(CalcError);
  });
});

describe('heat generation', () => {
  it('plane wall 2L = 0.02 m, k 20, q 1e6, Ts 100 C: T_max = 102.5 C', () => {
    const r = generation({ geometry: 'plane', size: 0.01, k: 20, qGen: 1e6, tSurface: 100 });
    expect(r.tMax).toBeCloseTo(102.5, 9);
    expect(r.profile[0]!.t).toBeCloseTo(102.5, 9);
    expect(r.profile.at(-1)!.t).toBeCloseTo(100, 9);
  });
  it('cylinder and sphere rises are qR^2/4k and qR^2/6k, and convection sets the surface temperature', () => {
    expect(generation({ geometry: 'cylinder', size: 0.01, k: 20, qGen: 1e6, tSurface: 0 }).rise).toBeCloseTo(1.25, 12);
    expect(generation({ geometry: 'sphere', size: 0.01, k: 20, qGen: 1e6, tSurface: 0 }).rise).toBeCloseTo(
      100 / 120,
      12,
    );
    const w = generation({ geometry: 'cylinder', size: 0.01, k: 20, qGen: 1e6, h: 100, tFluid: 25 });
    expect(w.tSurface).toBeCloseTo(25 + (1e6 * 0.01) / (2 * 100), 9);
    expect(() => generation({ geometry: 'plane', size: 0.01, k: 20, qGen: 1e6 })).toThrow(CalcError);
  });
});
