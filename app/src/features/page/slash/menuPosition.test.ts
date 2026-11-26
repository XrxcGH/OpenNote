import { describe, expect, it } from 'vitest';
import { menuPosition } from './menuPosition';

const win = { width: 300, height: 450 };

describe('where the slash menu goes', () => {
  it('opens under the slash when it fits', () => {
    expect(menuPosition({ left: 40, top: 100, bottom: 120 }, { width: 200, height: 200 }, win)).toMatchObject({
      left: 40,
      top: 124,
    });
  });

  it('opens above the slash when the room below is too small (Beta 8 walk VA-16)', () => {
    const at = menuPosition({ left: 32, top: 300, bottom: 320 }, { width: 240, height: 224 }, win);
    expect(at.top + 224).toBeLessThanOrEqual(300);
    expect(at.top).toBeGreaterThanOrEqual(0);
  });

  it('shrinks to the larger side and scrolls when neither side holds it', () => {
    const at = menuPosition({ left: 0, top: 200, bottom: 220 }, { width: 240, height: 500 }, win);
    expect(at.maxHeight).toBeLessThan(500);
    expect(at.top + at.maxHeight).toBeLessThanOrEqual(win.height);
  });

  it('keeps the menu inside the window sideways', () => {
    const at = menuPosition({ left: 280, top: 100, bottom: 120 }, { width: 240, height: 100 }, win);
    expect(at.left + 240).toBeLessThanOrEqual(win.width);
    expect(at.left).toBeGreaterThanOrEqual(0);
  });
});
