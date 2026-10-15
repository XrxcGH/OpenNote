// @vitest-environment jsdom
// The touch tool: how it hands contacts to the palm filter and acts on what the filter allows.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InkHost } from './host';
import type { InkSurface } from './surface';
import { chooseTool, drawState } from './state';
import { TouchTool } from './touch';

type Priv = {
  pipeline: { filter: { setViewport(w: number, h: number): void; configure(s: object): void } } & Record<string, never>;
  tapAt(id: number, allowed: boolean): void;
  pressAt(id: number, allowed: boolean): void;
  at: Map<number, unknown>;
  snapshots: Map<number, unknown>;
};

const touch = (id: number, x = 300, y = 300, type = 'pointerdown') =>
  ({
    pointerId: id,
    pointerType: 'touch',
    type,
    clientX: x,
    clientY: y,
    width: 20,
    height: 20,
    pressure: 0.5,
    tiltX: 0,
    tiltY: 0,
    buttons: 1,
    timeStamp: performance.now(),
  }) as unknown as PointerEvent;

function setup() {
  const scroller = document.createElement('div');
  const viewport = {
    viewport: scroller,
    setZoom: vi.fn(),
    camera: () => ({ zoom: 1 }),
    toWorld: (x: number, y: number) => ({ x, y }),
    scroller: () => scroller,
  };
  const host = {
    registerPointerTool: () => () => undefined,
    viewport: { get: () => viewport },
  } as unknown as InkHost;
  const surface = {
    readOnly: false,
    layerFor: () => 'layer',
    add: vi.fn(() => Promise.resolve(true)),
    remove: vi.fn(() => Promise.resolve(true)),
    clearLive: () => undefined,
    drawLive: () => undefined,
  } as unknown as InkSurface;
  const tool = new TouchTool(host, () => surface);
  const ctx = { capture: () => undefined } as never;
  return { tool, ctx, priv: tool as unknown as Priv };
}

async function ready(tool: TouchTool): Promise<void> {
  await vi.waitFor(() => expect(tool.tool.accepts(touch(1), {} as never)).toBe(true));
}

beforeEach(() => chooseTool('pen'));
afterEach(() => vi.restoreAllMocks());

describe('the touch tool', () => {
  it('manages touch for every pen tool, and leaves it alone for select', async () => {
    const { tool } = setup();
    await ready(tool);
    for (const name of ['eraser', 'partialEraser', 'lasso', 'insertSpace'] as const) {
      chooseTool(name);
      expect(tool.tool.accepts(touch(1), {} as never), name).toBe(true);
    }
    chooseTool('select');
    expect(tool.tool.accepts(touch(1), {} as never)).toBe(false);
    expect(drawState.get().tool).toBe('select');
    tool.destroy();
  });

  it('tells the filter the window size on the first touch and again when the window resizes', async () => {
    const { tool, ctx, priv } = setup();
    await ready(tool);
    tool.tool.down(touch(1), ctx);
    const setViewport = vi.spyOn(priv.pipeline.filter, 'setViewport');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 777 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 555 });
    window.dispatchEvent(new Event('resize'));
    expect(setViewport).toHaveBeenLastCalledWith(777, 555);
    tool.destroy();
    setViewport.mockClear();
    window.dispatchEvent(new Event('resize'));
    expect(setViewport).not.toHaveBeenCalled();
  });

  it('ends one contact alone when the system cancels it, and all of them when the router stops', async () => {
    const { tool, ctx, priv } = setup();
    await ready(tool);
    tool.tool.down(touch(1), ctx);
    tool.tool.down(touch(2, 500, 300), ctx);
    const pipeline = priv.pipeline as unknown as {
      handle(r: { type: string; id: number }): void;
      system(s: string, t: number): void;
    };
    const handle = vi.spyOn(pipeline, 'handle');
    const system = vi.spyOn(pipeline, 'system');
    tool.tool.cancel?.(ctx, touch(2, 500, 300, 'pointercancel'));
    expect(handle).toHaveBeenCalledTimes(1);
    expect(handle.mock.calls[0][0]).toMatchObject({ type: 'cancel', id: 2 });
    expect(system).not.toHaveBeenCalled();
    expect(priv.at.has(1)).toBe(true);
    expect(priv.at.has(2)).toBe(false);
    tool.tool.cancel?.(ctx);
    expect(system).toHaveBeenCalledWith('blur', expect.any(Number));
    tool.destroy();
  });

  it('clicks what a tap the filter allows lands on, and does nothing for one it refuses', async () => {
    const { tool, ctx, priv } = setup();
    await ready(tool);
    const button = document.createElement('button');
    const canvas = document.createElement('canvas');
    document.body.append(button, canvas);
    document.elementsFromPoint = () => [canvas, button];
    const click = vi.fn();
    button.addEventListener('click', click);
    tool.tool.down(touch(3, 40, 40), ctx);
    priv.tapAt(3, false);
    expect(click).not.toHaveBeenCalled();
    priv.tapAt(3, true);
    expect(click).toHaveBeenCalledTimes(1);
    tool.destroy();
  });

  it('opens the context menu where a long press the filter allows landed', async () => {
    const { tool, ctx, priv } = setup();
    await ready(tool);
    const target = document.createElement('p');
    document.body.append(target);
    document.elementsFromPoint = () => [target];
    const menu = vi.fn();
    target.addEventListener('contextmenu', menu);
    tool.tool.down(touch(4, 12, 34), ctx);
    priv.pressAt(4, false);
    expect(menu).not.toHaveBeenCalled();
    priv.pressAt(4, true);
    expect(menu).toHaveBeenCalledTimes(1);
    expect((menu.mock.calls[0][0] as MouseEvent).clientX).toBe(12);
    tool.destroy();
  });

  it('forgets its contacts when the page changes, and takes new settings without a new filter', async () => {
    const { tool, ctx, priv } = setup();
    await ready(tool);
    tool.tool.down(touch(5), ctx);
    const before = priv.pipeline;
    const configure = vi.spyOn(priv.pipeline.filter, 'configure');
    tool.reset();
    expect(configure).toHaveBeenCalledTimes(1);
    expect(priv.pipeline).toBe(before);
    tool.pageSwitch();
    expect(priv.at.size).toBe(0);
    expect(priv.snapshots.size).toBe(0);
    tool.destroy();
  });
});
