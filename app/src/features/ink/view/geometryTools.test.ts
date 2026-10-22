// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from '../../../state/store';
import { shapeOfStroke } from './shapeEdit';
import type { InkStroke } from '../model/types';
import type { InkHost, InkPointerTool, InkRouterContext } from './host';
import { compassState, installCompass } from './compass';
import { installMeasure, measurement, measureSelection } from './measureTool';
import { setPrefs } from './prefs';
import { formatLength, geometryTool, installSnapTools, snapGeometry, snapMark } from './snapTools';
import type { InkSurface } from './surface';
import { PAGE_UNITS_PER_MM } from '../geometry/stabilizer';

const camera = { zoom: 1, scrollX: 0, scrollY: 0, dpr: 1, viewport: { x: 0, y: 0, w: 800, h: 600 } };
const ctx = {
  camera,
  capture: () => {},
  toWorld: (x: number, y: number) => ({ x, y }),
} as unknown as InkRouterContext;

function setup(install: (host: InkHost, surfaces: ReturnType<typeof createStore<InkSurface | null>>) => () => void) {
  const chrome = document.createElement('div');
  document.body.append(chrome);
  const added: InkStroke[] = [];
  const surface = {
    chrome,
    readOnly: false,
    cameraNow: () => camera,
    onChange: () => () => {},
    scheme: () => 'light',
    layerFor: () => 'ink-1',
    strokes: (ids: readonly string[]) => added.filter((s) => ids.includes(s.id)),
    add: vi.fn(async (strokes: readonly InkStroke[]) => {
      added.push(...strokes);
      return true;
    }),
  } as unknown as InkSurface;
  const tools: InkPointerTool[] = [];
  let selected: string[] = [];
  const host = {
    registerPointerTool: (def: InkPointerTool) => {
      tools.push(def);
      return () => {};
    },
    selection: { get: () => ({ strokes: selected, blocks: [] }), subscribe: () => () => {} },
  } as unknown as InkHost;
  const stop = install(host, createStore<InkSurface | null>(surface, 'surfaces'));
  return { chrome, tools, added, stop, select: (ids: string[]) => (selected = ids) };
}

let id = 0;
const pen = (x: number, y: number, extra: Partial<PointerEvent> = {}) =>
  ({
    pointerId: 1,
    pointerType: 'pen',
    button: 0,
    clientX: x,
    clientY: y,
    timeStamp: (id += 10),
    ...extra,
  }) as unknown as PointerEvent;

describe('the geometry tools', () => {
  beforeEach(() => {
    setPrefs({ rulerUnits: 'metric', ruler: false, gridSnap: false });
    geometryTool.set('none');
    compassState.set({ center: null, radius: 0 });
    measurement.set(null);
  });
  afterEach(() => document.body.replaceChildren());

  it('shows the ruler in centimeters or inches by the units setting', () => {
    setPrefs({ ruler: true });
    const { chrome, stop } = setup(installSnapTools);
    expect(chrome.querySelector('[data-ink-ticks]')?.getAttribute('data-ink-ticks')).toBe('metric');
    expect(chrome.querySelector('[data-ink-widget="ruler"]')?.getAttribute('aria-label')).toContain('centimeters');
    setPrefs({ rulerUnits: 'imperial' });
    expect(chrome.querySelector('[data-ink-ticks]')?.getAttribute('data-ink-ticks')).toBe('imperial');
    expect(formatLength(PAGE_UNITS_PER_MM * 25.4 * 1.5)).toBe('1.5 in');
    setPrefs({ rulerUnits: 'metric' });
    expect(formatLength(43 * PAGE_UNITS_PER_MM)).toBe('4.3 cm');
    stop();
  });

  it('puts a marked point on the ruler edge when it is near it', () => {
    setPrefs({ ruler: true });
    const ruler = snapGeometry.get().ruler;
    const edgeY = ruler.cy - ruler.width / 2;
    expect(snapMark({ x: ruler.cx, y: edgeY - 5 }, 1)).toEqual({ x: ruler.cx, y: edgeY });
    expect(snapMark({ x: ruler.cx, y: edgeY - 200 }, 1)).toEqual({ x: ruler.cx, y: edgeY - 200 });
  });

  it('measures between two tapped points, or along a drag, and draws nothing', () => {
    const { tools, chrome, stop } = setup(installMeasure);
    const [measure] = tools;
    expect(measure!.accepts(pen(10, 10), ctx)).toBe(false);
    geometryTool.set('measure');
    expect(measure!.accepts(pen(10, 10), ctx)).toBe(true);
    measure!.down(pen(100, 100), ctx);
    measure!.up?.(pen(100, 100), ctx);
    expect(measurement.get()).toEqual({ a: { x: 100, y: 100 }, b: null });
    measure!.down(pen(100 + 30 * PAGE_UNITS_PER_MM, 100), ctx);
    measure!.up?.(pen(100 + 30 * PAGE_UNITS_PER_MM, 100), ctx);
    expect(chrome.querySelector('[data-ink-measure]')?.textContent).toBe('3.0 cm at 0 degrees');
    // A drag starts a new measurement.
    measure!.down(pen(0, 0), ctx);
    measure!.move?.([pen(0, -20 * PAGE_UNITS_PER_MM)], ctx);
    measure!.up?.(pen(0, -20 * PAGE_UNITS_PER_MM), ctx);
    expect(chrome.querySelector('[data-ink-measure]')?.textContent).toBe('2.0 cm at 90 degrees');
    geometryTool.set('none');
    expect(measurement.get()).toBeNull();
    stop();
  });

  it('a finger is not taken right after the pen, so a palm never measures', () => {
    const { tools, stop } = setup(installMeasure);
    geometryTool.set('measure');
    const [measure] = tools;
    expect(measure!.accepts(pen(10, 10, { timeStamp: 1000 }), ctx)).toBe(true);
    measure!.down(pen(10, 10, { timeStamp: 1000 }), ctx);
    measure!.up?.(pen(10, 10, { timeStamp: 1010 }), ctx);
    const touch = (t: number) => pen(50, 50, { pointerType: 'touch', pointerId: 7, timeStamp: t });
    expect(measure!.accepts(touch(1200), ctx)).toBe(false);
    expect(measure!.accepts(touch(3000), ctx)).toBe(true);
    stop();
  });

  it('a tap sets the center, a drag opens it, and a sweep draws an arc that edits as an arc', async () => {
    const { tools, added, stop } = setup(installCompass);
    const [compass] = tools;
    geometryTool.set('compass');
    // Choosing the compass puts the needle in the view, and a tap moves it.
    expect(compassState.get().center).toEqual({ x: 400, y: 300 });
    compass!.down(pen(200, 200), ctx);
    compass!.up?.(pen(200, 200), ctx);
    expect(compassState.get()).toEqual({ center: { x: 200, y: 200 }, radius: 0 });
    // Open from the center to 100 page units.
    compass!.down(pen(202, 200), ctx);
    compass!.move?.([pen(250, 200), pen(300, 200)], ctx);
    compass!.up?.(pen(300, 200), ctx);
    expect(compassState.get().radius).toBe(100);
    // Sweep a quarter turn.
    compass!.down(pen(300, 200), ctx);
    compass!.move?.([pen(290, 250), pen(270, 270), pen(250, 290), pen(200, 300)], ctx);
    compass!.up?.(pen(200, 300), ctx);
    await vi.waitFor(() => expect(added).toHaveLength(1));
    const shape = shapeOfStroke(added[0]!);
    expect(shape?.kind).toBe('arc');
    stop();
  });

  it('draws a full circle from the keyboard, and the radius snaps to the grid', async () => {
    setPrefs({ gridSnap: true, gridMm: 5 });
    const { tools, chrome, added, stop } = setup(installCompass);
    geometryTool.set('compass');
    const [compass] = tools;
    compass!.down(pen(100, 100), ctx);
    compass!.move?.([pen(100 + 9.6 * PAGE_UNITS_PER_MM, 100)], ctx);
    compass!.up?.(pen(100 + 9.6 * PAGE_UNITS_PER_MM, 100), ctx);
    const { center, radius } = compassState.get();
    // The center and the pencil both landed on 5 mm grid crossings.
    expect(radius / PAGE_UNITS_PER_MM).toBeCloseTo(10);
    expect(center!.x / (5 * PAGE_UNITS_PER_MM)).toBeCloseTo(5);
    const needle = chrome.querySelector<HTMLButtonElement>('[data-ink-compass]')!;
    needle.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
    expect(compassState.get().radius).toBeCloseTo(radius + PAGE_UNITS_PER_MM);
    needle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(added).toHaveLength(1));
    expect(shapeOfStroke(added[0]!)?.kind).toBe('circle');
    needle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(geometryTool.get()).toBe('none');
    setPrefs({ gridSnap: false });
    stop();
  });

  it('measures the length along a selected line', () => {
    const { select, added, stop } = setup(installMeasure);
    added.push({
      id: 's1',
      tool: 'pen',
      width: 1,
      startTime: 0,
      block: 'ink-1',
      slot: 1,
      color: [0, 0, 0, 255],
      points: [
        { x: 0, y: 0 },
        { x: 30 * PAGE_UNITS_PER_MM, y: 0 },
        { x: 30 * PAGE_UNITS_PER_MM, y: 40 * PAGE_UNITS_PER_MM },
      ],
    } as InkStroke);
    const host = { selection: { get: () => ({ strokes: ['s1'], blocks: [] }) } } as unknown as InkHost;
    select(['s1']);
    const surface = { strokes: () => added } as unknown as InkSurface;
    expect(measureSelection(host, surface)).toBe('The selected line is 7.0 cm long');
    stop();
  });
});
