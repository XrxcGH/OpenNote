// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createStore } from '../../../state/store';
import type { InkHost, InkPointerTool, InkRouterContext } from './host';
import { snapGeometry, installSnapTools } from './snapTools';
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
