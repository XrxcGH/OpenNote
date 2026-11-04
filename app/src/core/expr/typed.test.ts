import { describe, expect, it } from 'vitest';
import { danglingExponent, evaluateTyped } from './typed';

describe('a half-typed exponent', () => {
  it('is found after a number and nowhere else', () => {
    for (const text of ['2.5e', '1e-', '3E+', '2e*4', '(2e)', '10 + 2.5e', '.5e']) {
      expect(danglingExponent(text), text).toBeGreaterThanOrEqual(0);
    }
    for (const text of ['2.5e3', '1e-3', '2e+4', '2 e', 'e', '3pi', '2exp(1)', '1.5e10*2', 'x2e', '2*e']) {
      expect(danglingExponent(text), text).toBe(-1);
    }
  });

  it('is an error, where the dialect would read 2.5 times e', () => {
    // evaluate("2.5e") is 2.5 x 2.71828... = 6.7957; a field that asks for a number must not accept that.
    expect(evaluateTyped('2.5e').ok).toBe(false);
    expect(evaluateTyped('1e-').ok).toBe(false);
  });

  it('still evaluates ordinary numbers and expressions', () => {
    const value = (text: string) => {
      const out = evaluateTyped(text);
      return out.ok ? out.value : NaN;
    };
    expect(value('2.5e3')).toBe(2500);
    expect(value('2*pi')).toBeCloseTo(2 * Math.PI, 12);
    expect(value('1/3')).toBeCloseTo(1 / 3, 12);
    expect(value('2 e')).toBeCloseTo(2 * Math.E, 12);
  });
});
