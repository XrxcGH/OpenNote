// Significant figures and scientific notation for the calculator's answers.
import { describe, expect, it } from 'vitest';
import { countSigFigs, formatAnswer, leastSigFigs, restoreAnswerFormat, roundSigFigs } from './sigfigs';

describe('significant figures', () => {
  it('counts them as a science class does', () => {
    expect(countSigFigs('123')).toBe(3);
    expect(countSigFigs('0.0050')).toBe(2);
    expect(countSigFigs('1200')).toBe(2);
    expect(countSigFigs('1200.')).toBe(4);
    expect(countSigFigs('1.200e3')).toBe(4);
    expect(countSigFigs('101')).toBe(3);
    expect(countSigFigs('2.50')).toBe(3);
    expect(countSigFigs('-4.0')).toBe(2);
    expect(countSigFigs('abc')).toBeNull();
  });

  it('finds the fewest figures typed in an expression', () => {
    expect(leastSigFigs('2.50 * 3.1')).toBe(2);
    expect(leastSigFigs('sin(30) * 4.000')).toBe(1);
    expect(leastSigFigs('pi')).toBeNull();
  });

  it('rounds to a number of figures', () => {
    expect(roundSigFigs(123456, 3)).toBe(123000);
    expect(roundSigFigs(0.0012345, 2)).toBe(0.0012);
    expect(roundSigFigs(0, 3)).toBe(0);
  });

  it('writes an answer in the chosen notation and figures, keeping significant zeros', () => {
    expect(formatAnswer(7.75, '2.50 * 3.1', { notation: 'auto', figures: 'match' })).toBe('7.8');
    expect(formatAnswer(2, '2.0 * 1.00', { notation: 'auto', figures: 'match' })).toBe('2.0');
    expect(formatAnswer(12345.678, '', { notation: 'scientific', figures: 3 })).toMatch(/^1\.23.*4$/);
    expect(formatAnswer(12345.678, '', { notation: 'engineering', figures: 4 })).toMatch(/^12\.35/);
    expect(formatAnswer(0.5, '1/2', { notation: 'auto', figures: 'auto' })).toBe('0.5');
  });

  it('reads a saved choice back defensively', () => {
    expect(restoreAnswerFormat({ notation: 'scientific', figures: 3 })).toEqual({ notation: 'scientific', figures: 3 });
    expect(restoreAnswerFormat({ notation: 'odd', figures: 99 })).toEqual({ notation: 'auto', figures: 'auto' });
    expect(restoreAnswerFormat(null)).toEqual({ notation: 'auto', figures: 'auto' });
  });
});
