// The beam solver against textbook cases with known answers (Hibbeler, Mechanics of Materials, and Gere's beam
// tables): reactions, the largest shear and moment, and where they happen.
import { describe, expect, it } from 'vitest';
import { readBeam, solveBeam, starterBeam } from './beam';
import type { BeamLoad, BeamModel, BeamSupport } from './beam';

const beam = (length: number, supports: BeamSupport[], loads: BeamLoad[]): BeamModel => ({
  length,
  supports,
  loads,
  forceUnit: 'kN',
  lengthUnit: 'm',
});
const pin = (x: number, id = `s${x}`): BeamSupport => ({ id, kind: 'pin', x });
const roller = (x: number, id = `r${x}`): BeamSupport => ({ id, kind: 'roller', x });
const fixed = (x: number, id = `f${x}`): BeamSupport => ({ id, kind: 'fixed', x });
const hinge = (x: number, id = `h${x}`): BeamSupport => ({ id, kind: 'hinge', x });

describe('beam solver: textbook cases', () => {
  it('1. simply supported, central point load: R = P/2, Mmax = PL/4', () => {
    const result = solveBeam(beam(4, [pin(0), roller(4)], [{ id: 'p', kind: 'point', x: 2, value: 10 }]));
    expect(result.status).toBe('determinate');
    expect(result.reactions.map((r) => r.force)).toEqual([5, 5]);
    expect(result.maxMoment).toEqual({ x: 2, value: 10 });
    expect(result.shear(1)).toBe(5);
    expect(result.shear(3)).toBe(-5);
  });

  it('2. simply supported, uniform load: R = wL/2, Mmax = wL²/8 at midspan', () => {
    const result = solveBeam(
      beam(6, [pin(0), roller(6)], [{ id: 'w', kind: 'distributed', x1: 0, x2: 6, w1: 2, w2: 2 }]),
    );
    expect(result.reactions.map((r) => r.force)).toEqual([6, 6]);
    expect(result.maxMoment.value).toBeCloseTo(9, 9);
    expect(result.maxMoment.x).toBeCloseTo(3, 6);
    expect(result.zeroShear[0]).toBeCloseTo(3, 9);
  });

  it('3. cantilever, end load: R = P, M at the wall = −PL', () => {
    const result = solveBeam(beam(3, [fixed(0)], [{ id: 'p', kind: 'point', x: 3, value: 5 }]));
    expect(result.reactions[0]).toMatchObject({ force: 5, moment: 15 });
    expect(result.moment(0)).toBe(-15);
    expect(result.maxMoment).toEqual({ x: 0, value: -15 });
    expect(result.moment(3, true)).toBe(0);
  });

  it('4. cantilever, uniform load: M at the wall = −wL²/2', () => {
    const result = solveBeam(beam(2, [fixed(0)], [{ id: 'w', kind: 'distributed', x1: 0, x2: 2, w1: 4, w2: 4 }]));
    expect(result.reactions[0]).toMatchObject({ force: 8, moment: 8 });
    expect(result.moment(0)).toBe(-8);
    expect(result.moment(1)).toBe(-2);
  });

  it('5. overhanging beam, load at the free end: the far support pulls down', () => {
    const result = solveBeam(beam(6, [pin(0), roller(4)], [{ id: 'p', kind: 'point', x: 6, value: 6 }]));
    expect(result.reactions.map((r) => r.force)).toEqual([-3, 9]);
    expect(result.moment(4)).toBe(-12);
    expect(result.maxMoment).toEqual({ x: 4, value: -12 });
  });

  it('6. propped cantilever, uniform load (indeterminate): RB = 3wL/8, RA = 5wL/8, MA = wL²/8', () => {
    const result = solveBeam(
      beam(8, [fixed(0), roller(8)], [{ id: 'w', kind: 'distributed', x1: 0, x2: 8, w1: 1, w2: 1 }]),
    );
    expect(result.status).toBe('indeterminate');
    expect(result.reactions[0]).toMatchObject({ force: 5, moment: 8 });
    expect(result.reactions[1].force).toBe(3);
    expect(result.moment(0)).toBe(-8);
    // The span moment peaks where the shear is zero, 3L/8 from the roller: 9wL²/128.
    expect(result.zeroShear[0]).toBeCloseTo(5, 9);
    expect(result.moment(5)).toBeCloseTo(4.5, 9);
  });

  it('7. simply supported, triangular load: RA = w₀L/6, RB = w₀L/3, Mmax = w₀L²/(9√3) at L/√3', () => {
    const result = solveBeam(
      beam(9, [pin(0), roller(9)], [{ id: 'w', kind: 'distributed', x1: 0, x2: 9, w1: 0, w2: 6 }]),
    );
    expect(result.reactions[0].force).toBeCloseTo(9, 9);
    expect(result.reactions[1].force).toBeCloseTo(18, 9);
    expect(result.zeroShear[0]).toBeCloseTo(9 / Math.sqrt(3), 8);
    expect(result.maxMoment.value).toBeCloseTo((6 * 81) / (9 * Math.sqrt(3)), 6);
  });

  it('8. simply supported, couple at midspan: R = ±M/L and the moment jumps by M', () => {
    const result = solveBeam(beam(4, [pin(0), roller(4)], [{ id: 'm', kind: 'moment', x: 2, value: 8 }]));
    expect(result.reactions.map((r) => r.force)).toEqual([2, -2]);
    expect(result.moment(2, true)).toBe(4);
    expect(result.moment(2)).toBe(-4);
  });

  it('9. two-span continuous beam, uniform load: middle reaction 5wL/4', () => {
    const result = solveBeam(
      beam(8, [pin(0), roller(4), roller(8)], [{ id: 'w', kind: 'distributed', x1: 0, x2: 8, w1: 1, w2: 1 }]),
    );
    expect(result.reactions.map((r) => r.force)).toEqual([1.5, 5, 1.5]);
    expect(result.moment(4)).toBe(-2);
  });
});

describe('beam solver: hinges and changing EI', () => {
  it('10. Gerber beam: fixed end, hinge at 4 m, roller at 6 m, uniform 2 kN/m', () => {
    // Right of the hinge, 2 m on a hinge and a roller: 2 kN each. Left, a 4 m cantilever with 8 kN of load and the
    // hinge's 2 kN at its tip: 10 kN and 8·2 + 2·4 = 24 kN·m at the wall. The hinge carries no moment.
    const result = solveBeam(
      beam(6, [fixed(0), hinge(4), roller(6)], [{ id: 'w', kind: 'distributed', x1: 0, x2: 6, w1: 2, w2: 2 }]),
    );
    expect(result.status).toBe('determinate');
    expect(result.reactions).toEqual([
      { support: 'f0', x: 0, force: 10, moment: 24 },
      { support: 'r6', x: 6, force: 2 },
    ]);
    expect(result.moment(4)).toBe(0);
    expect(result.moment(0)).toBe(-24);
  });

  it('11. fixed-fixed beam with a hinge at midspan under a load there: two cantilevers sharing P', () => {
    const result = solveBeam(beam(8, [fixed(0), hinge(4), fixed(8)], [{ id: 'p', kind: 'point', x: 4, value: 10 }]));
    expect(result.status).toBe('indeterminate');
    expect(result.reactions).toEqual([
      { support: 'f0', x: 0, force: 5, moment: 20 },
      { support: 'f8', x: 8, force: 5, moment: -20 },
    ]);
    expect(result.moment(4)).toBe(0);
  });

  it('12. two-span beam, load on span 1, span 2 three times as stiff (three-moment equation)', () => {
    // M_B·2(L/I1 + L/(3 I1)) = −wL³/(4 I1), so M_B = −3wL²/32: −3 for w = 32, L = 1. R_A = 16 − 3 = 13, R_C = −3.
    const model = beam(
      2,
      [pin(0), roller(1), roller(2)],
      [{ id: 'w', kind: 'distributed', x1: 0, x2: 1, w1: 32, w2: 32 }],
    );
    const stiff = solveBeam({ ...model, segments: [{ id: 'e', x1: 1, x2: 2, factor: 3 }] });
    expect(stiff.reactions.map((r) => r.force)).toEqual([13, 22, -3]);
    expect(stiff.moment(1)).toBe(-3);
    // The same beam with one EI: M_B = −wL²/16 = −2.
    expect(solveBeam(model).moment(1)).toBe(-2);
  });

  it('says a hinge between two pins makes a mechanism', () => {
    const loads: BeamLoad[] = [{ id: 'p', kind: 'point', x: 1, value: 1 }];
    expect(solveBeam(beam(4, [pin(0), hinge(2), roller(4)], loads)).status).toBe('unstable');
  });

  it('says when the supports cannot hold the beam', () => {
    expect(solveBeam(beam(4, [roller(2)], [{ id: 'p', kind: 'point', x: 1, value: 1 }])).status).toBe('unstable');
    expect(solveBeam(beam(4, [], [])).status).toBe('none');
  });

  it('reads stored data and solves the starter beam in equilibrium', () => {
    const start = solveBeam(readBeam(starterBeam()));
    const total = start.reactions.reduce((sum, r) => sum + r.force, 0);
    expect(total).toBeCloseTo(10 + 12, 9);
    expect(readBeam({ length: -3, supports: [{ kind: 'spring' }], loads: [{ kind: 'point', x: 1 }] })).toMatchObject({
      length: 0.1,
      supports: [],
      loads: [{ kind: 'point', x: 1, value: 0 }],
    });
  });
});
