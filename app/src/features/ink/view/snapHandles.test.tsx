// The ruler's and the protractor's turn handles grow with the target size, so touch density gets 44 px (VA-21).
import { afterEach, describe, expect, it } from 'vitest';
import { createStore } from '../../../state/store';
import type { InkHost } from './host';
import { installSnapTools } from './snapTools';
import type { InkSurface } from './surface';

afterEach(() => document.body.replaceChildren());

function handles(targetSize: string): HTMLElement[] {
  const chrome = document.createElement('div');
  chrome.style.setProperty('--target-size', targetSize);
  document.body.append(chrome);
  const surface = {
    chrome,
    cameraNow: () => ({ zoom: 1, scrollX: 0, scrollY: 0, dpr: 1, viewport: { w: 800, h: 600 } }),
    onChange: () => () => {},
  } as unknown as InkSurface;
  const host = { registerPointerTool: () => () => {} } as unknown as InkHost;
  installSnapTools(host, createStore<InkSurface | null>(surface, 'surfaces'));
  return [...chrome.querySelectorAll<HTMLElement>('[data-ink-turn]')];
}

describe('the turn handles of the ruler and the protractor', () => {
  it('are a touch target wide in touch density', () => {
    const found = handles('44px');
    expect(found).toHaveLength(2);
    for (const handle of found) {
      expect(getComputedStyle(handle).width).toBe('44px');
      expect(getComputedStyle(handle).height).toBe('44px');
    }
  });

  it('never get smaller than 28 px', () => {
    for (const handle of handles('24px')) expect(getComputedStyle(handle).width).toBe('28px');
  });
});
