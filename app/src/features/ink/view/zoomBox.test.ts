// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from '../../../state/store';
import type { InkStroke } from '../model/types';
import type { InkHost, InkPointerTool, InkRouterContext } from './host';
import { setPrefs } from './prefs';
import type { InkSurface } from './surface';
import { installZoomBox } from './zoomBox';

const ctx = { capture: () => {} } as unknown as InkRouterContext;

function setup() {
  const chrome = document.createElement('div');
  document.body.append(chrome);
  const added: InkStroke[][] = [];
  const surface = {
    chrome,
    readOnly: false,
    cameraNow: () => ({ zoom: 1, scrollX: 0, scrollY: 0, dpr: 1, viewport: { w: 800, h: 600 } }),
    onChange: () => () => {},
    query: () => [],
    scheme: () => 'light',
    layerFor: () => '01k6layer0000000000000000l',
    add: (strokes: readonly InkStroke[]) => {
      added.push([...strokes]);
      return Promise.resolve(true);
    },
  } as unknown as InkSurface;
  let tool: InkPointerTool | null = null;
  const host = {
    registerPointerTool: (def: InkPointerTool) => {
      tool = def;
      return () => {};
    },
    viewport: createStore(null, 'viewport'),
  } as unknown as InkHost;
  const stop = installZoomBox(host, createStore<InkSurface | null>(surface, 'surfaces'));
  const canvas = chrome.querySelector('canvas[data-ink-zoom-strip]')!;
  const pointer = (pointerId: number, pointerType: string, x: number, y = 40) =>
    ({
      pointerId,
      pointerType,
      clientX: x,
      clientY: y,
      pressure: 0.5,
      tiltX: 0,
      tiltY: 0,
      timeStamp: performance.now(),
      target: canvas,
    }) as unknown as PointerEvent;
  return { tool: tool!, added, stop, pointer };
}

describe('the zoom box strip', () => {
  beforeEach(() => setPrefs({ zoomBox: true }));
  afterEach(() => {
    setPrefs({ zoomBox: false });
    document.body.replaceChildren();
  });

  it('keeps the pen stroke when a palm touches the strip while the pen writes, and stores no stray stroke', async () => {
    const { tool, added, stop, pointer } = setup();
    const pen = 1;
    const palm = 2;
    expect(tool.accepts(pointer(pen, 'pen', 10), ctx)).toBe(true);
    tool.down(pointer(pen, 'pen', 10), ctx);
    tool.move?.([pointer(pen, 'pen', 20), pointer(pen, 'pen', 30)], ctx);
    // The heel of the hand lands on the strip: the router hands it to the strip too.
    tool.down(pointer(palm, 'touch', 300, 60), ctx);
    tool.move?.([pointer(pen, 'pen', 40), pointer(palm, 'touch', 305, 62)], ctx);
    tool.move?.([pointer(pen, 'pen', 50)], ctx);
    tool.up?.(pointer(pen, 'pen', 60), ctx);
    tool.up?.(pointer(palm, 'touch', 306, 62), ctx);
    tool.cancel?.(ctx, pointer(palm, 'touch', 306, 62));
    await vi.waitFor(() => expect(added).toHaveLength(1));
    const points = added[0].flatMap((stroke) => stroke.points);
    expect(points.length).toBeGreaterThanOrEqual(5);
    // Only the pen's samples carry pressure.
    expect(points.every((point) => point.pressure === 0.5)).toBe(true);
    stop();
  });

  it('lets a pen take over from a touch that was writing, and drops the touch', async () => {
    const { tool, added, stop, pointer } = setup();
    tool.down(pointer(2, 'touch', 300), ctx);
    tool.move?.([pointer(2, 'touch', 310)], ctx);
    tool.down(pointer(1, 'pen', 10), ctx);
    tool.move?.([pointer(1, 'pen', 20), pointer(2, 'touch', 320)], ctx);
    tool.up?.(pointer(2, 'touch', 330), ctx);
    tool.up?.(pointer(1, 'pen', 30), ctx);
    await vi.waitFor(() => expect(added).toHaveLength(1));
    expect(added[0].flatMap((stroke) => stroke.points).every((point) => point.pressure === 0.5)).toBe(true);
    stop();
  });

  // The pen as the window sees it: on the page, not on the strip.
  const pen = (type: string) =>
    window.dispatchEvent(Object.assign(new Event(type), { pointerId: 1, pointerType: 'pen' }));
  const touchStroke = (tool: InkPointerTool, pointer: ReturnType<typeof setup>['pointer']) => {
    tool.down(pointer(2, 'touch', 300), ctx);
    tool.move?.([pointer(2, 'touch', 310), pointer(2, 'touch', 320)], ctx);
    tool.up?.(pointer(2, 'touch', 330), ctx);
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  it('stores no stroke from a hand resting on the strip while the pen writes on the page', async () => {
    const { tool, added, stop, pointer } = setup();
    pen('pointerdown');
    pen('pointermove');
    touchStroke(tool, pointer);
    pen('pointerup');
    await settle();
    expect(added).toHaveLength(0);
    stop();
  });

  it('stores no stroke from a hand landing on the strip just after the pen lifted', async () => {
    const { tool, added, stop, pointer } = setup();
    pen('pointerdown');
    pen('pointerup');
    touchStroke(tool, pointer);
    await settle();
    expect(added).toHaveLength(0);
    stop();
  });

  it('drops a touch stroke in the strip when the pen comes down on the page', async () => {
    const { tool, added, stop, pointer } = setup();
    tool.down(pointer(2, 'touch', 300), ctx);
    tool.move?.([pointer(2, 'touch', 310)], ctx);
    pen('pointerdown');
    tool.move?.([pointer(2, 'touch', 320)], ctx);
    tool.up?.(pointer(2, 'touch', 330), ctx);
    pen('pointerup');
    await settle();
    expect(added).toHaveLength(0);
    stop();
  });

  it('lets a finger write in the strip when no pen is near', async () => {
    const { tool, added, stop, pointer } = setup();
    touchStroke(tool, pointer);
    await vi.waitFor(() => expect(added).toHaveLength(1));
    stop();
  });
});
