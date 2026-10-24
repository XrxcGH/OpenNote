// T3-4: the lasso's actions exist only while something is selected; with nothing selected the frame (and so every
// action in it) is not displayed, which also takes it out of the accessibility tree. With a selection the actions show.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeStroke } from '../geometry/fixtures';
import type { InkHost, InkSelection } from './host';
import { attachSelectionFrame, createFrameTool } from './selection';
import { chooseTool } from './state';
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
  parts: { viewport: { viewport: chrome, world: chrome } },
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
    // Some actions need more than one stroke or a made group, a link, a table-shaped selection, or a curve.
    const needsMore = new Set(['table', 'group', 'ungroup', 'unlink', 'curveAdd', 'curveRemove', 'curveToggle']);
    for (const action of actions) {
      const shown = action.getBoundingClientRect().width > 0;
      expect(shown, action.dataset.inkAction).toBe(!needsMore.has(action.dataset.inkAction ?? ''));
    }
    expect(chrome.querySelector('[data-ink-action="delete"]')).not.toBeNull();
    frame.stop();
    chrome.remove();
  });
});

describe('the lasso bar and the page title', () => {
  it('goes below a selection that sits under the title, so the bar does not cover it', () => {
    document.body.append(chrome);
    const low = makeStroke('low', [
      { x: 10, y: 1000 },
      { x: 60, y: 1030 },
    ]);
    const lowSurface = {
      ...surface,
      strokes: (ids: readonly string[]) => (ids.includes('low') ? [low] : []),
    } as unknown as InkSurface;
    const bar = () => chrome.querySelector<HTMLElement>('[data-ink-selection-bar]');
    selection = { blocks: [], strokes: ['low'] };
    const frame = attachSelectionFrame(host, lowSurface);
    expect(bar()?.hasAttribute('data-below')).toBe(false);
    const band = document.createElement('div');
    band.style.cssText = 'position:absolute;inset-block-start:0;block-size:1010px';
    const heading = document.createElement('h1');
    heading.dataset.pageTitle = '';
    band.append(heading);
    chrome.append(band);
    listeners.forEach((fn) => fn());
    expect(bar()?.hasAttribute('data-below')).toBe(true);
    frame.stop();
    chrome.remove();
    selection = { blocks: [], strokes: [] };
  });
});

describe('a text box selected alone (Beta 6, owner bugs 5 and 8)', () => {
  const box = document.createElement('div');
  const boxHost = {
    ...host,
    viewport: { get: () => null },
    layer: {
      get: () => ({
        blocks: () => [{ id: 'b', type: 'text', frame: { x: 20, y: 20 } }],
        block: () => ({ id: 'b', type: 'text', frame: { x: 20, y: 20 } }),
        view: () => ({ element: box, measure: () => ({ x: 20, y: 20, w: 120, h: 40 }) }),
      }),
      subscribe: () => () => undefined,
    },
  } as unknown as InkHost;
  const shown = (name: string) =>
    chrome.querySelector<HTMLElement>(`[data-ink-action="${name}"]`)!.getBoundingClientRect().width > 0;
  const group = () => chrome.querySelector<HTMLElement>('[data-ink-selection]')!;

  afterEach(() => {
    chooseTool('select');
    selection = { blocks: [], strokes: [] };
  });

  it('gets the frame while a draw tool is active, with Delete and without the ink-only actions', () => {
    document.body.append(chrome);
    chooseTool('pen');
    selection = { blocks: ['b'], strokes: [] };
    const frame = attachSelectionFrame(boxHost, surface);
    expect(group().style.display).toBe('');
    expect(shown('delete')).toBe(true);
    expect(shown('recolor')).toBe(false);
    expect(shown('thicker')).toBe(false);
    // Select and type keeps Phase 4's own chrome for a block it selected.
    chooseTool('select');
    expect(group().style.display).toBe('none');
    frame.stop();
    chrome.remove();
  });

  it('hands a finger the frame to drag, and the bar and a palm to the palm filter', () => {
    document.body.append(chrome);
    chooseTool('pen');
    selection = { blocks: ['b'], strokes: [] };
    const frame = attachSelectionFrame(boxHost, surface);
    const mover = chrome.querySelector<HTMLElement>('[data-ink-move]')!;
    const remove = chrome.querySelector<HTMLElement>('[data-ink-action="delete"]')!;
    chrome.dataset.inkChrome = '';
    const tool = createFrameTool(() => frame);
    const press = (target: Element, pointerType: string, width = 10) =>
      ({
        target,
        pointerType,
        width,
        height: width,
        button: 0,
        pointerId: 1,
        clientX: 30,
        clientY: 30,
      }) as unknown as PointerEvent;
    expect(tool.priority).toBeGreaterThan(100);
    expect(tool.accepts(press(mover, 'touch'), {} as never)).toBe(true);
    expect(tool.accepts(press(mover, 'touch', 40), {} as never)).toBe(false);
    expect(tool.accepts(press(remove, 'touch'), {} as never)).toBe(false);
    expect(tool.accepts(press(remove, 'pen'), {} as never)).toBe(true);
    // A press on the bar leaves the pointer with its button; a drag keeps it.
    const capture = vi.fn();
    tool.down(press(remove, 'pen'), { capture } as never);
    expect(capture).not.toHaveBeenCalled();
    tool.down(press(mover, 'pen'), { capture } as never);
    expect(capture).toHaveBeenCalledWith(1);
    frame.stop();
    delete chrome.dataset.inkChrome;
    chrome.remove();
  });
});
