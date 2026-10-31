import { describe, expect, it } from 'vitest';
import { CivilError } from '../core/types';
import { dmdArea, helmert, trigLevel, tripGeneration } from './survey';

const within = (actual: number, expected: number, tol: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);

describe('trip generation and surveying', () => {
  it('adds trips by typed rates and splits them', () => {
    // 120 x 9.44 + 40 x 6.65 + 15 x 3.7 = 1132.8 + 266 + 55.5.
    const t = tripGeneration(
      [
        [120, 9.44],
        [40, 6.65],
        [15, 3.7],
      ],
      60,
    );
    within(t.total, 1454.3, 1e-9);
    within(t.entering, 872.58, 1e-9);
    expect(() => tripGeneration([[1, 1]], 120)).toThrow(CivilError);
  });

  it('finds a 100 m by 50 m rectangle by double meridian distances', () => {
    const r = dmdArea([
      { lat: 100, dep: 0 },
      { lat: 0, dep: 50 },
      { lat: -100, dep: 0 },
      { lat: 0, dep: -50 },
    ]);
    expect(r.dmd).toEqual([0, 50, 100, 50]);
    within(r.area, 5000, 1e-9);
  });

  it('levels trigonometrically with curvature and refraction', () => {
    // S cos z = 500 x 0.087156 = 43.578; H = 498.10; (1 - 0.13) H² / 2R = 0.01694; ΔH = 43.578 + 1.5 - 1.8 + 0.017.
    const r = trigLevel(500, 85, 1.5, 1.8, 0.13);
    within(r.H, 498.097, 0.001);
    within(r.cr, 0.01694, 0.00001);
    within(r.dH, 43.2948, 0.0002);
    within(trigLevel(500, 85, 1.5, 1.8, null).dH, 43.2779, 0.0002);
    expect(() => trigLevel(500, 190, 1.5, 1.8, null)).toThrow(CivilError);
  });

  it('recovers a known Helmert transformation and its residuals', () => {
    // Scale 1.0002, rotation 1.5°, shifts 1000 and 2000 m applied by hand to three points.
    const s = 1.0002;
    const t = (1.5 * Math.PI) / 180;
    const fwd = ([x, y]: number[]) => [
      x!,
      y!,
      1000 + s * (x! * Math.cos(t) - y! * Math.sin(t)),
      2000 + s * (x! * Math.sin(t) + y! * Math.cos(t)),
    ];
    const pts = [
      [100, 100],
      [300, 120],
      [220, 330],
    ].map(fwd);
    const h = helmert(pts);
    within(h.scale, 1.0002, 1e-12);
    within(h.rotation, 1.5, 1e-10);
    within(h.tx, 1000, 1e-8);
    within(h.ty, 2000, 1e-8);
    within(h.rms, 0, 1e-8);
    // Moving one target 0.03 m east leaves residuals that sum to zero, as a fit with free shifts must.
    pts[0]![2]! += 0.03;
    const r = helmert(pts);
    within(
      r.residuals.reduce((a, [u]) => a + u, 0),
      0,
      1e-9,
    );
    expect(r.rms).toBeGreaterThan(0);
    expect(() =>
      helmert([
        [1, 1, 2, 2],
        [1, 1, 3, 3],
      ]),
    ).toThrow(CivilError);
  });
});
