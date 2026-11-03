// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createStore } from '../../../state/store';
import type { InkHost, InkPointerTool, InkRouterContext } from './host';
import { DEFAULT_PROTRACTOR, DEFAULT_RULER } from '../snap';
import { drawState } from './state';
import { installSnapTools, protractorInView, rulerInView, snapGeometry } from './snapTools';
import type { InkSurface } from './surface';

const ctx = {
  capture: () => {},
  toWorld: (x: number, y: number) => ({ x, y }),
} as unknown as InkRouterContext;

describe('the snap widgets', () => {
  afterEach(() => document.body.replaceChildren());

  it('follow the pointer that took them; a second contact on a widget moves nothing and ends nothing', () => {
    const chrome = document.createElement('div');
    document.body.append(chrome);
    const surface = {
      chrome,
      cameraNow: () => ({ zoom: 1, scrollX: 0, scrollY: 0, dpr: 1, viewport: { w: 800, h: 600 } }),
      onChange: () => () => {},
    } as unknown as InkSurface;
    let tool: InkPointerTool | null = null;
    const host = {
      registerPointerTool: (def: InkPointerTool) => {
        tool = def;
        return () => {};
      },
    } as unknown as InkHost;
    const stop = installSnapTools(host, createStore<InkSurface | null>(surface, 'surfaces'));
    const ruler = chrome.querySelector('[data-ink-widget="ruler"]');
    const at = (pointerId: number, x: number, y: number) =>
      ({ pointerId, clientX: x, clientY: y, target: ruler }) as unknown as PointerEvent;
    const from = snapGeometry.get().ruler;
    const widgets = tool!;
    expect(widgets.accepts(at(1, 0, 0), ctx)).toBe(true);
    widgets.down(at(1, 100, 100), ctx);
    widgets.move?.([at(1, 110, 100)], ctx);
    // The heel of the hand lands on the ruler and slides, then lifts.
    expect(widgets.down(at(2, 400, 400), ctx)).toBe('claim');
    widgets.move?.([at(1, 120, 100), at(2, 480, 470)], ctx);
    widgets.up?.(at(2, 480, 470), ctx);
    widgets.cancel?.(ctx, at(2, 480, 470));
    expect(snapGeometry.get().ruler.cx - from.cx).toBe(20);
    // The finger that took the ruler still moves it.
    widgets.move?.([at(1, 130, 100)], ctx);
    expect(snapGeometry.get().ruler.cx - from.cx).toBe(30);
    widgets.up?.(at(1, 130, 100), ctx);
    stop();
  });
});

describe('placing the ruler and protractor in the view (full walk 2, A1-A10-7, A2-A11-6)', () => {
  const wide = { x: 0, y: 0, w: 2000, h: 1200 };
  const narrow = { x: 0, y: 0, w: 420, h: 900 };
  const ends = (r: typeof DEFAULT_RULER) => [r.cx - r.length / 2, r.cx + r.length / 2];

  it('moves the default ruler, whose left end is off the page, into the view with room for its handle', () => {
    const placed = rulerInView(DEFAULT_RULER, wide, 48);
    const [left, right] = ends(placed);
    expect(left).toBeGreaterThanOrEqual(48);
    expect(right).toBeLessThanOrEqual(2000 - 48);
  });

  it('shortens the ruler to fit a narrow view, and leaves one that fits alone', () => {
    const placed = rulerInView(DEFAULT_RULER, narrow, 48);
    const [left, right] = ends(placed);
    expect(left).toBeGreaterThanOrEqual(48);
    expect(right).toBeLessThanOrEqual(420 - 48);
    expect(rulerInView(placed, narrow, 48)).toBe(placed);
  });

  it('brings the protractor into a narrow view', () => {
    const placed = protractorInView({ ...DEFAULT_PROTRACTOR, cx: -500 }, narrow, 48);
    expect(placed.cx - placed.radius).toBeGreaterThanOrEqual(48);
    expect(placed.cx + placed.radius).toBeLessThanOrEqual(420 - 48);
  });
});

describe('a pen at the ruler edge (full walk 2, A1-A10-8)', () => {
  afterEach(() => drawState.set({ tool: 'select', previous: 'select', slot: 'p1' }));

  it('draws along the edge from inside the ruler, while a finger and the body still move it', () => {
    const chrome = document.createElement('div');
    document.body.append(chrome);
    const surface = {
      chrome,
      cameraNow: () => ({ zoom: 1, scrollX: 0, scrollY: 0, dpr: 1, viewport: { w: 2000, h: 1200 } }),
      onChange: () => () => {},
    } as unknown as InkSurface;
    let tool: InkPointerTool | null = null;
    const host = {
      registerPointerTool: (def: InkPointerTool) => {
        tool = def;
        return () => {};
      },
    } as unknown as InkHost;
    const stop = installSnapTools(host, createStore<InkSurface | null>(surface, 'surfaces'));
    const ruler = chrome.querySelector('[data-ink-widget="ruler"]');
    const r = snapGeometry.get().ruler;
    const top = r.cy - r.width / 2;
    const press = (pointerType: string, y: number) =>
      ({ pointerId: 1, pointerType, clientX: r.cx, clientY: y, target: ruler }) as unknown as PointerEvent;
    drawState.set({ tool: 'pen', previous: 'select', slot: 'p1' });
    expect(tool!.accepts(press('pen', top + 4), ctx)).toBe(false);
    expect(tool!.accepts(press('mouse', top + 4), ctx)).toBe(false);
    expect(tool!.accepts(press('touch', top + 4), ctx)).toBe(true);
    expect(tool!.accepts(press('pen', r.cy), ctx)).toBe(true);
    drawState.set({ tool: 'select', previous: 'select', slot: 'p1' });
    expect(tool!.accepts(press('pen', top + 4), ctx)).toBe(true);
    stop();
  });
});
