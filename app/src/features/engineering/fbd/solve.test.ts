// Free-body sums and reactions against statics problems worked by hand (the kind in Hibbeler's Statics, chapter 5).
import { describe, expect, it } from 'vitest';
import type { FbdModel, FbdPart } from './model';
import { readFbd, starterFbd } from './model';
import { solveFbd } from './solve';

const model = (parts: FbdPart[], origin = { x: 0, y: 0 }): FbdModel => ({
  parts,
  origin,
  forceUnit: 'kN',
  lengthUnit: 'm',
});

const value = (result: ReturnType<typeof solveFbd>, name: string) =>
  result.reactions.find((reaction) => reaction.name === name)?.value;

describe('free-body sums', () => {
  it('adds force components and moments about the chosen point', () => {
    const result = solveFbd(
      model([
        { id: 'a', kind: 'force', x: 2, y: 0, angle: 270, magnitude: 10, label: 'F1' },
        { id: 'b', kind: 'force', x: 0, y: 1, angle: 0, magnitude: 5, label: 'F2' },
        { id: 'c', kind: 'moment', x: 3, y: 0, magnitude: 4, label: 'M1' },
      ]),
    );
    expect(result.sumFx).toBe(5);
    expect(result.sumFy).toBe(-10);
    // 2 × (−10) − 1 × 5 + 4 = −21
    expect(result.sumM).toBe(-21);
    expect(result.status).toBe('none');
    expect(result.resultant.magnitude).toBeCloseTo(Math.hypot(5, 10), 9);
  });

  it('solves a simply supported beam: 10 kN at 2 m on a 6 m span gives 6.667 and 3.333 kN', () => {
    const result = solveFbd(
      model([
        { id: 'A', kind: 'support', support: 'pin', x: 0, y: 0, angle: 90, label: 'A' },
        { id: 'B', kind: 'support', support: 'roller', x: 6, y: 0, angle: 90, label: 'B' },
        { id: 'f', kind: 'force', x: 2, y: 0, angle: 270, magnitude: 10, label: 'F' },
      ]),
    );
    expect(result.status).toBe('solved');
    expect(value(result, 'Ax')).toBe(0);
    expect(value(result, 'Ay')).toBeCloseTo(20 / 3, 9);
    expect(value(result, 'B')).toBeCloseTo(10 / 3, 9);
  });

  it('solves a cantilever with an angled load: 500 N at 30° below the horizontal, 2 m out', () => {
    const result = solveFbd(
      model([
        { id: 'A', kind: 'support', support: 'fixed', x: 0, y: 0, angle: 90, label: 'A' },
        { id: 'f', kind: 'force', x: 2, y: 0, angle: -30, magnitude: 500, label: 'F' },
      ]),
    );
    expect(result.status).toBe('solved');
    expect(value(result, 'Ax')).toBeCloseTo(-433.013, 3);
    expect(value(result, 'Ay')).toBeCloseTo(250, 9);
    // The load turns the beam clockwise by 2 × 250 = 500 N·m, so the wall pushes back counterclockwise.
    expect(value(result, 'MA')).toBeCloseTo(500, 9);
  });

  it('solves a roller on an incline (Hibbeler-style): the roller pushes along its normal', () => {
    // A bar pinned at A, a roller at B on a 45° surface, and 100 N straight down halfway.
    const result = solveFbd(
      model([
        { id: 'A', kind: 'support', support: 'pin', x: 0, y: 0, angle: 90, label: 'A' },
        { id: 'B', kind: 'support', support: 'roller', x: 4, y: 0, angle: 135, label: 'B' },
        { id: 'f', kind: 'force', x: 2, y: 0, angle: 270, magnitude: 100, label: 'W' },
      ]),
    );
    const b = value(result, 'B')!;
    // ΣM_A: 4 × B sin135° − 2 × 100 = 0
    expect(b).toBeCloseTo(200 / (4 * Math.SQRT1_2), 9);
    expect(value(result, 'Ax')).toBeCloseTo(b * Math.SQRT1_2, 9);
    expect(value(result, 'Ay')).toBeCloseTo(100 - b * Math.SQRT1_2, 9);
  });

  it('says when the supports are too many or too few', () => {
    const pins: FbdPart[] = [
      { id: 'A', kind: 'support', support: 'pin', x: 0, y: 0, angle: 90, label: 'A' },
      { id: 'B', kind: 'support', support: 'pin', x: 4, y: 0, angle: 90, label: 'B' },
    ];
    expect(solveFbd(model(pins)).status).toBe('indeterminate');
    expect(solveFbd(model(pins.slice(0, 1))).status).toBe('unstable');
    // Three rollers all pushing up cannot resist a sideways push.
    const rollers: FbdPart[] = [0, 2, 4].map((x) => ({
      id: `r${x}`,
      kind: 'support',
      support: 'roller',
      x,
      y: 0,
      angle: 90,
      label: `R${x}`,
    }));
    expect(solveFbd(model(rollers)).status).toBe('unstable');
  });

  it('reads stored data and keeps only parts it knows', () => {
    const read = readFbd({ parts: [{ kind: 'force', x: 1, y: 2 }, { kind: 'spring' }, null], origin: { x: 1 } });
    expect(read.parts).toHaveLength(1);
    expect(read.origin).toEqual({ x: 1, y: starterFbd().origin.y });
    expect(solveFbd(starterFbd()).status).toBe('solved');
  });
});
