import { describe, expect, it } from 'vitest';
import { CHIP_INSET, chipLimit } from './placement';

const base = { left: 0, right: 1000, panes: [], windowWidth: 1000, chip: 120 };

describe('where the properties chip sits', () => {
  it('stands at the end edge of the page area', () => {
    expect(chipLimit(base)).toBe(1000);
  });

  it('stays left of a pane that opens over the page', () => {
    expect(chipLimit({ ...base, panes: [{ left: 700, right: 1000, width: 300 }] })).toBe(700);
  });

  it('never leaves the window when a pane edge reaches the window start (the Markdown source view, Beta 8 walk B-B02-7)', () => {
    const right = chipLimit({ ...base, panes: [{ left: -40, right: 1000, width: 1040 }] });
    // The chip's right edge is its limit less the inset; its left edge must still be inside the window.
    expect(right - CHIP_INSET - base.chip).toBeGreaterThanOrEqual(0);
  });

  it('keeps a page area that starts past the window start from pushing the chip out of the window', () => {
    const right = chipLimit({ ...base, left: -200, right: 100, windowWidth: 400 });
    expect(right - CHIP_INSET - base.chip).toBeGreaterThanOrEqual(0);
    expect(right).toBeLessThanOrEqual(400);
  });

  it('never passes the window end', () => {
    expect(chipLimit({ ...base, right: 1400 })).toBe(1000);
  });
});
