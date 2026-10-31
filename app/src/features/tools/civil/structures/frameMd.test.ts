import { describe, expect, it } from 'vitest';
import { CivilError } from '../core/types';
import { frameMomentDistribution, type FrameJoint } from './frameMd';

const within = (actual: number, expected: number, tol: number) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
const key = (run: () => unknown): string => {
  try {
    run();
  } catch (error) {
    if (error instanceof CivilError) return error.key;
    throw error;
  }
  throw new Error('expected a CivilError');
};

// A single-bay portal: columns 4 m, beam 6 m, all members the same EI.
const portal = (base: number): FrameJoint[] => [
  { x: 0, y: 0, support: base },
  { x: 0, y: 4, support: 0 },
  { x: 6, y: 4, support: 0 },
  { x: 6, y: 0, support: base },
];
const bare = [
  { a: 1, b: 2, EI: 1, w: 0 },
  { a: 2, b: 3, EI: 1, w: 0 },
  { a: 4, b: 3, EI: 1, w: 0 },
];

describe('frame moment distribution', () => {
  it('matches slope-deflection for a braced portal under a beam load', () => {
    // Symmetry: θ (2 K_b + 4 K_c) = w L² / 12 with K_b = 1/6, K_c = 1/4, so θ = 22.5 and M_BA = 4 K_c θ = 22.5.
    const members = bare.map((m, i) => (i === 1 ? { ...m, w: 10 } : m));
    const r = frameMomentDistribution(portal(1), members, [], false);
    within(r.moments[0]![0], 11.25, 1e-6);
    within(r.moments[0]![1], 22.5, 1e-6);
    within(r.moments[1]![0], -22.5, 1e-6);
    within(r.moments[1]![1], 22.5, 1e-6);
    within(r.brace, 0, 1e-6);
    within(r.df[1]![0], 4 / 6 / (4 / 6 + 1), 1e-12);
  });

  it('gives the closed-form fixed-base portal under a sway load', () => {
    // Slope-deflection with k = K_b / K_c = 2/3: M_top = (P h / 2) 3k / (6k + 1) = 16, M_base = (P h / 2)(3k + 1) /
    // (6k + 1) = 24 kN·m for P = 20 kN at the beam.
    const r = frameMomentDistribution(portal(1), bare, [{ joint: 2, H: 20 }], true);
    within(r.moments[0]![0], -24, 1e-6);
    within(r.moments[0]![1], -16, 1e-6);
    within(r.moments[1]![0], 16, 1e-6);
    within(r.moments[2]![0], -24, 1e-6);
    within(r.brace, -20, 1e-6);
    // The held frame has no moments at all, so the whole answer is the scaled sway correction.
    within(r.sway!.factor * r.sway!.brace, 20, 1e-6);
  });

  it('gives the statics answer for a pinned-base portal', () => {
    // Each column carries P/2 = 10 kN of shear with no base moment, so its top moment is 10 x 4 = 40 kN·m.
    const r = frameMomentDistribution(portal(2), bare, [{ joint: 2, H: 20 }], true);
    within(r.moments[0]![0], 0, 1e-6);
    within(r.moments[0]![1], -40, 1e-6);
    within(r.moments[2]![1], -40, 1e-6);
  });

  it('refuses sway in a frame that is not one level story', () => {
    const leaning = portal(1).map((j, i) => (i === 1 ? { ...j, x: 1 } : j));
    expect(key(() => frameMomentDistribution(leaning, bare, [{ joint: 2, H: 20 }], true))).toBe(
      'structures.errors.swayShape',
    );
    expect(frameMomentDistribution(leaning, bare, [], false).moments).toHaveLength(3);
    expect(key(() => frameMomentDistribution(portal(1), [{ a: 1, b: 9, EI: 1, w: 0 }], [], false))).toBe(
      'structures.errors.memberJoints',
    );
  });
});
