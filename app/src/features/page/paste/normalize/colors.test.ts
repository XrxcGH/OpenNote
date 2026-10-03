import { describe, expect, it } from 'vitest';
import { deltaE2000, highlighterFor, parseColor, penFor } from './colors';

describe('colors from document sources', () => {
  it('reads hex, rgb, and named colors, and ignores transparent ones', () => {
    expect(parseColor('#f00')).toEqual([255, 0, 0]);
    expect(parseColor('rgb(10, 20, 30)')).toEqual([10, 20, 30]);
    expect(parseColor('rgba(10, 20, 30, 0)')).toBeNull();
    expect(parseColor('DarkYellow')).toEqual([128, 128, 0]);
    expect(parseColor('transparent')).toBeNull();
    expect(parseColor('auto')).toBeNull();
  });

  it('measures CIEDE2000 differences', () => {
    // The same color is 0 apart, and black and white about 100.
    expect(deltaE2000([47, 79, 154], [47, 79, 154])).toBe(0);
    expect(deltaE2000([0, 0, 0], [255, 255, 255])).toBeCloseTo(100, 0);
  });

  it('maps every background to the nearest highlighter', () => {
    expect(highlighterFor('yellow')).toEqual({ color: null });
    expect(highlighterFor('#00ff00')).toEqual({ color: 'mint' });
    expect(highlighterFor('magenta')).toEqual({ color: 'rose' });
    expect(highlighterFor('#ffffff')).toBeNull();
  });

  it('maps a text color to a pen within 10, to hex otherwise, and black to no color', () => {
    expect(penFor('#2F5496')).toBe('indigo');
    expect(penFor('#B0342A')).toBe('brick');
    expect(penFor('#00b050')).toBe('#00b050');
    expect(penFor('black')).toBeNull();
    expect(penFor('windowtext')).toBeNull();
  });
});
