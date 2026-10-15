// T3-4: the lasso's actions exist only while something is selected; with nothing selected the frame (and so every
// action in it) is not displayed, which also takes it out of the accessibility tree. With a selection the actions show.
import { afterEach, describe, expect, it } from 'vitest';
import { makeStroke } from '../geometry/fixtures';
import type { InkHost, InkSelection } from './host';
import { attachSelectionFrame } from './selection';
import type { InkSurface } from './surface';

let selection: InkSelection = { blocks: [], strokes: [] };
const listeners = new Set<() => void>();
const stroke = makeStroke('s1', [
  { x: 10, y: 10 },
  { x: 60, y: 40 },
]);
const chrome = document.createElement('div');

const host = {
  selection: {
    get: () => selection,
    subscribe: (fn: () => void) => (listeners.add(fn), () => listeners.delete(fn)),
  },
  layer: { get: () => null, subscribe: () => () => undefined },
  handwriting: { recognize: () => Promise.resolve(null), tidy: () => Promise.resolve(null) },
} as unknown as InkHost;
const surface = {
  chrome,
  parts: { viewport: { viewport: chrome } },
  strokes: (ids: readonly string[]) => (ids.includes('s1') ? [stroke] : []),
  cameraNow: () => ({ zoom: 1, scrollX: 0, scrollY: 0 }),
  onChange: () => () => undefined,
} as unknown as InkSurface;

afterEach(() => chrome.replaceChildren());

describe('the lasso frame', () => {
  it('shows no action while nothing is selected, and the actions once something is', () => {
    document.body.append(chrome);
    selection = { blocks: [], strokes: [] };
    const frame = attachSelectionFrame(host, surface);
    const actions = [...chrome.querySelectorAll<HTMLElement>('[data-ink-action]')];
    expect(actions.length).toBeGreaterThan(3);
    for (const action of actions) expect(action.checkVisibility()).toBe(false);
    selection = { blocks: [], strokes: ['s1'] };
    listeners.forEach((fn) => fn());
    for (const action of actions) expect(action.getBoundingClientRect().width).toBeGreaterThan(0);
    expect(chrome.querySelector('[data-ink-action="delete"]')).not.toBeNull();
    frame.stop();
    chrome.remove();
  });
});
