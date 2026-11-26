import '../text';
import { describe, expect, it } from 'vitest';
import { MechError } from '../kit/errors';
import { readDh } from './spec';

const d2r = (d: number) => (d * Math.PI) / 180;

describe('a typed Denavit-Hartenberg table', () => {
  it('reads revolute and prismatic rows, angles in degrees and limits in the joint’s own units', () => {
    const [r, p] = readDh('R 1 90 0.5 30 -90 90\nP 0 0 0.2 0 0 0.4', 'si');
    expect(r).toEqual({ type: 'R', a: 1, alpha: d2r(90), d: 0.5, theta: d2r(30), min: d2r(-90), max: d2r(90) });
    expect(p).toEqual({ type: 'P', a: 0, alpha: 0, d: 0.2, theta: 0, min: 0, max: 0.4 });
  });

  it('reads lengths in feet in US units and takes R when the type is left out', () => {
    const [row] = readDh('2 0 1 45', 'us');
    expect(row.type).toBe('R');
    expect(row.a).toBeCloseTo(0.6096, 12);
    expect(row.d).toBeCloseTo(0.3048, 12);
    expect(row.theta).toBeCloseTo(d2r(45), 12);
  });

  it('refuses an unknown joint type, a single limit, and short rows', () => {
    expect(() => readDh('Q 1 0 0 0', 'si')).toThrow(MechError);
    expect(() => readDh('R 1 0 0 0 5', 'si')).toThrow(MechError);
    expect(() => readDh('R 1 0 0', 'si')).toThrow(MechError);
  });
});
