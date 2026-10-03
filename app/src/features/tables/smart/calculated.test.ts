// The check behind the Calculated column dialog: a formula for a whole column reads, or the problem comes in words.
import { describe, expect, it } from 'vitest';
import { EN_US } from '../engine';
import { calculatedProblem } from './ops';

describe('a calculated column formula', () => {
  it('is accepted when it reads', () => {
    expect(calculatedProblem('[Price] * [Quantity]', EN_US)).toBeNull();
    expect(calculatedProblem('=ROUND([Price] * 1.2, 2)', EN_US)).toBeNull();
  });
  it('is refused with a problem in words when it is empty or cannot be read', () => {
    expect(calculatedProblem('   ', EN_US)).toMatch(/formula/i);
    expect(calculatedProblem('=', EN_US)).toMatch(/formula/i);
    expect(calculatedProblem('[Price] *', EN_US)).toMatch(/cannot be read/i);
  });
});
