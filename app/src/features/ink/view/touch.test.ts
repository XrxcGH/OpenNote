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
  touchStroke(id: number, phase: string, ink: object): void;
  contacts: Map<number, { t0: number; t1: number; x0: number; y0: number; travel: number }>;
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

function setup(extra: object = {}) {
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
    // A page with no text boxes or pictures, and nothing selected: a still finger's lift asks what it landed on.
    layer: { get: () => null },
    selection: { get: () => ({ blocks: [], strokes: [] }) },
    select: () => undefined,
    ...extra,
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
  return { tool, ctx, priv: tool as unknown as Priv, surface };
}

async function ready(tool: TouchTool): Promise<void> {
  await vi.waitFor(() => expect(tool.tool.accepts(touch(1), {} as never)).toBe(true));
}

beforeEach(() => {
  chooseTool('pen');
  // What a test's filter learned (a pen seen) is not carried into the next test.
  localStorage.removeItem('opennote.ink.palmLearned');
});
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

describe('text boxes under a finger while a pen tool is active', () => {
  const block = { id: 'box', type: 'text', frame: { x: 100, y: 100 } };
  const element = document.createElement('div');
  const layer = {
    blocks: () => [block],
    block: (id: string) => (id === 'box' ? block : null),
    view: () => ({ element, measure: () => ({ x: 100, y: 100, w: 200, h: 50 }) }),
  };

  function withBox(selected: string[] = []) {
    const select = vi.fn();
    const parts = setup({
      layer: { get: () => layer },
      selection: { get: () => ({ blocks: selected, strokes: [] }) },
      select,
    });
    return { ...parts, select };
  }

  it('selects the text box a tap lands on, and lets go of the selection on empty page', async () => {
    const { tool, ctx, priv, select } = withBox(['box']);
    await ready(tool);
    const inside = document.createElement('p');
    document.body.append(inside);
    document.elementsFromPoint = () => [inside];
    tool.tool.down(touch(6, 150, 120), ctx);
    priv.tapAt(6, true);
    expect(select).toHaveBeenLastCalledWith({ blocks: ['box'], strokes: [] }, { announce: true });
    tool.tool.down(touch(7, 400, 400), ctx);
    priv.tapAt(7, true);
    expect(select).toHaveBeenLastCalledWith({ blocks: [], strokes: [] });
    tool.destroy();
  });

  it('leaves the grip of a selected box to the objects tool for a finger, and keeps a palm', async () => {
    const { tool } = withBox(['box']);
    await ready(tool);
    const grip = document.createElement('div');
    grip.dataset.handle = 'grip';
    grip.dataset.block = 'box';
    const on = (width: number) => ({ ...touch(8), width, height: width, target: grip }) as unknown as PointerEvent;
    expect(tool.tool.accepts(on(20), {} as never)).toBe(false);
    expect(tool.tool.accepts(on(40), {} as never)).toBe(true);
    tool.destroy();
  });

  it('selects a box a drawing finger tapped, quick or held, instead of adding a dot', async () => {
    const { tool, priv, select, surface } = withBox();
    await ready(tool);
    const ink = { id: 9, builder: { points: [] }, strokes: [{ id: 's9' }] };
    for (const [id, t1] of [
      [9, 400],
      [10, 80],
    ] as const) {
      select.mockClear();
      priv.contacts.set(id, { t0: 0, t1, x0: 150, y0: 120, travel: 0 });
      priv.touchStroke(id, 'commit', { ...ink, id });
      expect(select).toHaveBeenCalledWith({ blocks: ['box'], strokes: [] }, { announce: true });
      // Taking it back removes nothing, since nothing was added.
      priv.touchStroke(id, 'uncommit', { ...ink, id });
    }
    expect(surface.add).not.toHaveBeenCalled();
    expect(surface.remove).not.toHaveBeenCalled();
    // A dot on empty page, and a stroke that moved across the box, are ink.
    priv.contacts.set(11, { t0: 0, t1: 80, x0: 400, y0: 400, travel: 0 });
    priv.touchStroke(11, 'commit', { ...ink, id: 11 });
    priv.contacts.set(12, { t0: 0, t1: 300, x0: 150, y0: 120, travel: 40 });
    priv.touchStroke(12, 'commit', { ...ink, id: 12 });
    expect(surface.add).toHaveBeenCalledTimes(2);
    tool.destroy();
  });
});

describe('the selection frame bar under a finger', () => {
  it('is a control outside the page to the filter, so a tap presses its button while fingers draw', async () => {
    const { tool, ctx, priv } = setup();
    await ready(tool);
    const bar = document.createElement('div');
    bar.dataset.inkSelectionBar = '';
    const button = document.createElement('button');
    bar.append(button);
    document.body.append(bar);
    tool.tool.down(touch(1), ctx);
    const pipeline = priv.pipeline as unknown as { handle(r: { type: string; surface: string }): void };
    const handle = pipeline.handle.bind(pipeline);
    const seen: string[] = [];
    vi.spyOn(pipeline, 'handle').mockImplementation((r) => {
      seen.push(`${r.type}:${r.surface}`);
      handle(r);
    });
    tool.tool.down(Object.assign(touch(2), { target: button }), ctx);
    tool.tool.up?.(Object.assign(touch(2, 300, 300, 'pointerup'), { target: button }), ctx);
    tool.tool.down(touch(3), ctx);
    expect(seen).toEqual(['down:chrome', 'up:page', 'down:page']);
    bar.remove();
    tool.destroy();
  });
});

describe('what the palm filter learned', () => {
  const pen = () => {
    const event = new Event('pointermove');
    return Object.assign(event, { pointerType: 'pen', pointerId: 2, clientX: 50, clientY: 50, buttons: 0 });
  };
  const filter = (priv: Priv) => (priv.pipeline as unknown as { filter: { penSeen(): boolean } }).filter;

  it('remembers a pen once it is seen, and starts the next filter knowing it', async () => {
    const first = setup();
    await ready(first.tool);
    first.tool.tool.down(touch(1), first.ctx);
    expect(filter(first.priv).penSeen()).toBe(false);
    window.dispatchEvent(pen());
    expect(filter(first.priv).penSeen()).toBe(true);
    expect(JSON.parse(localStorage.getItem('opennote.ink.palmLearned') ?? '{}')).toMatchObject({ penSeen: true });
    first.tool.destroy();

    const next = setup();
    await ready(next.tool);
    next.tool.tool.down(touch(1), next.ctx);
    expect(filter(next.priv).penSeen()).toBe(true);
    next.tool.destroy();
  });

  it('starts without a pen on a device that never used one, and survives a damaged value', async () => {
    localStorage.setItem('opennote.ink.palmLearned', '{not json');
    const { tool, ctx, priv } = setup();
    await ready(tool);
    tool.tool.down(touch(1), ctx);
    expect(filter(priv).penSeen()).toBe(false);
    tool.destroy();
  });
});
