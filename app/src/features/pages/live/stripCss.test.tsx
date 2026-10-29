import { afterEach, describe, expect, it } from 'vitest';
import { createStrip } from './strip';

let parent: HTMLElement | null = null;
afterEach(() => parent?.remove());

describe('the sheet strip in a real browser', () => {
  it('is not drawn while hidden, and is drawn once shown', () => {
    parent = document.body.appendChild(document.createElement('div'));
    const strip = createStrip(parent, {
      sheets: () => 2,
      current: () => 0,
      paper: () => '<svg viewBox="0 0 8 10"></svg>',
      aspect: () => 0.8,
      goTo() {},
      add() {},
    });
    const root = parent.querySelector('nav') as HTMLElement;
    expect(getComputedStyle(root).display).toBe('none');
    strip.show(true, false);
    expect(getComputedStyle(root).display).not.toBe('none');
  });

  it('ends beside the scroll bars the viewport reports, never over them', () => {
    parent = document.body.appendChild(document.createElement('div'));
    parent.style.cssText = 'position:relative;width:400px;height:300px;--scrollbar-inline:15px;--scrollbar-block:15px';
    const strip = createStrip(parent, {
      sheets: () => 2,
      current: () => 0,
      paper: () => '',
      aspect: () => 0.8,
      goTo() {},
      add() {},
    });
    strip.show(true, false);
    const rail = (parent.querySelector('nav') as HTMLElement).getBoundingClientRect();
    const box = parent.getBoundingClientRect();
    expect(rail.right, 'the strip covers the vertical scroll bar').toBeLessThanOrEqual(box.right - 15);
    expect(rail.bottom, 'the strip covers the horizontal scroll bar').toBeLessThanOrEqual(box.bottom - 15);
  });
});
