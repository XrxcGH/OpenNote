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
});
