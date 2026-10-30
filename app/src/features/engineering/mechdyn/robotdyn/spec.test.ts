import { describe, expect, it } from 'vitest';
import { MechError } from '../kit/errors';
import { readLinks } from './spec';

describe('typed links', () => {
  it('reads SI rows as they are and US rows from ft, lb, and lb ft^2', () => {
    expect(readLinks('1 2 0.5 0.1', 'si')).toEqual([{ length: 1, mass: 2, com: 0.5, inertia: 0.1 }]);
    const [us] = readLinks('1 1 1 1', 'us');
    expect(us.length).toBeCloseTo(0.3048, 12);
    expect(us.mass).toBeCloseTo(0.45359237, 12);
    expect(us.inertia).toBeCloseTo(0.45359237 * 0.3048 ** 2, 12);
  });

  it('refuses more than three links and short rows', () => {
    expect(() => readLinks('1 1 1 0\n1 1 1 0\n1 1 1 0\n1 1 1 0', 'si')).toThrow(MechError);
    expect(() => readLinks('1 1 1', 'si')).toThrow(MechError);
  });
});
