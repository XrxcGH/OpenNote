// The truss solver against problems worked by the method of joints and of sections (the kind in Hibbeler's
// Statics, chapter 6). Tension is positive.
import { describe, expect, it } from 'vitest';
import { readTruss, solveTruss, starterTruss } from './truss';
import type { Joint, Member, TrussModel } from './truss';

const truss = (joints: Joint[], pairs: [string, string][]): TrussModel => ({
  joints,
  members: pairs.map(([a, b]): Member => ({ id: `${a}${b}`, a, b })),
  forceUnit: 'kN',
  lengthUnit: 'm',
});

describe('truss solver: textbook cases', () => {
  it('1. a triangle with a load at the apex: legs in compression, tie in tension', () => {
    const result = solveTruss(
      truss(
        [
          { id: 'A', label: 'A', x: 0, y: 0, support: 'pin' },
          { id: 'B', label: 'B', x: 4, y: 0, support: 'roller', angle: 90 },
          { id: 'C', label: 'C', x: 2, y: 2, fy: -10 },
        ],
        [
          ['A', 'B'],
          ['B', 'C'],
          ['C', 'A'],
        ],
      ),
    );
    expect(result.status).toBe('determinate');
    expect(result.forces.get('CA')).toBeCloseTo(-10 / Math.SQRT2, 9);
    expect(result.forces.get('BC')).toBeCloseTo(-10 / Math.SQRT2, 9);
    expect(result.forces.get('AB')).toBeCloseTo(5, 9);
    expect(result.reactions).toEqual([
      { joint: 'A', component: 'x', value: 0 },
      { joint: 'A', component: 'y', value: 5 },
      { joint: 'B', component: 'n', value: 5, angle: 90 },
    ]);
  });

  it('2. a braced 3-4-5 panel with a sideways load: zero-force members and a diagonal in tension', () => {
    const result = solveTruss(
      truss(
        [
          { id: 'A', label: 'A', x: 0, y: 0, support: 'pin' },
          { id: 'B', label: 'B', x: 3, y: 0, support: 'roller', angle: 90 },
          { id: 'C', label: 'C', x: 3, y: 4 },
          { id: 'D', label: 'D', x: 0, y: 4, fx: 600 },
        ],
        [
          ['A', 'B'],
          ['B', 'C'],
          ['C', 'D'],
          ['D', 'A'],
          ['A', 'C'],
        ],
      ),
    );
    expect(result.forces.get('CD')).toBeCloseTo(-600, 9);
    expect(result.forces.get('DA')).toBeCloseTo(0, 9);
    expect(result.forces.get('AC')).toBeCloseTo(1000, 9);
    expect(result.forces.get('BC')).toBeCloseTo(-800, 9);
    expect(result.forces.get('AB')).toBeCloseTo(0, 9);
    expect(result.reactions.map((r) => r.value)).toEqual([-600, -800, 800]);
  });
});

describe('truss solver: larger and inclined cases', () => {
  it('3. a Pratt truss with two panel loads (method of sections)', () => {
    const result = solveTruss(
      truss(
        [
          { id: 'L0', label: 'L0', x: 0, y: 0, support: 'pin' },
          { id: 'L1', label: 'L1', x: 4, y: 0, fy: -10 },
          { id: 'L2', label: 'L2', x: 8, y: 0, fy: -10 },
          { id: 'L3', label: 'L3', x: 12, y: 0, support: 'roller', angle: 90 },
          { id: 'U1', label: 'U1', x: 4, y: 3 },
          { id: 'U2', label: 'U2', x: 8, y: 3 },
        ],
        [
          ['L0', 'L1'],
          ['L1', 'L2'],
          ['L2', 'L3'],
          ['U1', 'U2'],
          ['L0', 'U1'],
          ['U1', 'L1'],
          ['U1', 'L2'],
          ['U2', 'L2'],
          ['U2', 'L3'],
        ],
      ),
    );
    expect(result.status).toBe('determinate');
    expect(result.forces.get('U1U2')).toBeCloseTo(-40 / 3, 9);
    expect(result.forces.get('L1L2')).toBeCloseTo(40 / 3, 9);
    expect(result.forces.get('L0U1')).toBeCloseTo(-50 / 3, 9);
    expect(result.forces.get('L0L1')).toBeCloseTo(40 / 3, 9);
    expect(result.forces.get('U1L1')).toBeCloseTo(10, 9);
    expect(result.forces.get('U1L2')).toBeCloseTo(0, 9);
  });

  it('4. an inclined roller pushes along its normal', () => {
    // The triangle of case 1, with the roller on a 45° slope: the pin now takes a sideways reaction.
    const result = solveTruss(
      truss(
        [
          { id: 'A', label: 'A', x: 0, y: 0, support: 'pin' },
          { id: 'B', label: 'B', x: 4, y: 0, support: 'roller', angle: 135 },
          { id: 'C', label: 'C', x: 2, y: 2, fy: -10 },
        ],
        [
          ['A', 'B'],
          ['B', 'C'],
          ['C', 'A'],
        ],
      ),
    );
    const roller = result.reactions.find((r) => r.component === 'n')!.value;
    // ΣM about A: 4 × R sin135° = 2 × 10
    expect(roller).toBeCloseTo(5 * Math.SQRT2, 9);
    expect(result.reactions.find((r) => r.component === 'x')!.value).toBeCloseTo(5, 9);
  });
});

describe('truss solver: stability', () => {
  it('says when a truss is a mechanism or has redundant members', () => {
    const square: Joint[] = [
      { id: 'A', label: 'A', x: 0, y: 0, support: 'pin' },
      { id: 'B', label: 'B', x: 3, y: 0, support: 'roller', angle: 90 },
      { id: 'C', label: 'C', x: 3, y: 3, fx: 1 },
      { id: 'D', label: 'D', x: 0, y: 3 },
    ];
    const sides: [string, string][] = [
      ['A', 'B'],
      ['B', 'C'],
      ['C', 'D'],
      ['D', 'A'],
    ];
    expect(solveTruss(truss(square, sides)).status).toBe('unstable');
    const both = solveTruss(truss(square, [...sides, ['A', 'C'], ['B', 'D']]));
    expect(both.status).toBe('indeterminate');
    expect(
      solveTruss(
        truss(
          square.map((j) => ({ ...j, support: undefined })),
          sides,
        ),
      ).status,
    ).toBe('none');
  });

  it('reads stored data and solves the starter Warren truss', () => {
    const result = solveTruss(readTruss(starterTruss()));
    expect(result.status).toBe('determinate');
    // A symmetric load of 10 kN: each support takes 5 kN.
    expect(result.reactions.filter((r) => r.component !== 'x').map((r) => r.value)).toEqual([5, 5]);
    expect(readTruss({ joints: [{ id: 'a' }], members: [{ a: 'a', b: 'zz' }] }).members).toEqual([]);
  });
});
