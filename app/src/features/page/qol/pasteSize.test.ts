import { describe, expect, it } from 'vitest';
import { sizeFor, sizingFor } from './pasteSize';

describe('screenshot paste size', () => {
  const screenshot = { width: 1800, height: 900 };

  it('fits the column when the screenshot is wider than it', () => {
    expect(sizeFor(screenshot, { dpr: 1.5, maxWidth: 600, sizing: 'fit' })).toEqual({ w: 600, h: 300 });
  });

  it('keeps the actual size, counting the display scaling, even past the column', () => {
    expect(sizeFor(screenshot, { dpr: 1.5, maxWidth: 600, sizing: 'actual' })).toEqual({ w: 1200, h: 600 });
    expect(sizeFor({ width: 300, height: 150 }, { dpr: 2, maxWidth: 600, sizing: 'actual' })).toEqual({
      w: 150,
      h: 75,
    });
  });

  it('asks by fitting first', () => {
    expect(sizingFor('ask')).toBe('fit');
    expect(sizingFor('fit')).toBe('fit');
    expect(sizingFor('actual')).toBe('actual');
  });
});
