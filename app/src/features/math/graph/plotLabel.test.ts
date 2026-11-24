import { describe, expect, it } from 'vitest';
import { plotLabel } from './plotLabel';

const view = { xMin: -10, xMax: 10, yMin: -7.5, yMax: 7.5 };

describe('plotLabel', () => {
  it('names the function and the visible range', () => {
    expect(plotLabel(['y = x^2'], view)).toBe('Graph of y = x^2, x from -10 to 10, y from -7.5 to 7.5.');
  });

  it('names up to three functions and counts the rest', () => {
    expect(plotLabel(['a', 'b', 'c', 'd', 'e'], view)).toBe(
      'Graph of a; b; c and 2 more, x from -10 to 10, y from -7.5 to 7.5.',
    );
  });

  it('says so when there is no function yet', () => {
    expect(plotLabel(['', '  '], view)).toBe('Empty graph, x from -10 to 10, y from -7.5 to 7.5.');
  });
});
