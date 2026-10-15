// The check behind the Calculated column dialog: a formula for a whole column reads, or the problem comes in words.
import { describe, expect, it } from 'vitest';
import { EN_US } from '../engine';
import { bracketNames, calculatedProblem } from './ops';

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

describe('bare column names', () => {
  it('are put in brackets when they match a header', () => {
    expect(bracketNames('Price * Qty', ['Price', 'Qty'])).toBe('[Price] * [Qty]');
    expect(bracketNames('ROUND(price, 2) + [Qty] + "Qty"', ['Price', 'Qty'])).toBe('ROUND([price], 2) + [Qty] + "Qty"');
    expect(calculatedProblem('Price * Qty', EN_US, ['Price', 'Qty'])).toBeNull();
    expect(calculatedProblem('Price * Qty', EN_US)).not.toBeNull();
  });
});
