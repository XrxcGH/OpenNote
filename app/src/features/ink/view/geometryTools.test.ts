// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore } from '../../../state/store';
import { shapeOfStroke } from './shapeEdit';
import type { InkStroke } from '../model/types';
import type { InkHost, InkPointerTool, InkRouterContext } from './host';
import { compassState, installCompass } from './compass';
import { installMeasure, measureCursor, measurement, measureSelection } from './measureTool';
import { setPrefs } from './prefs';
import {
  formatLength,
  geometryTool,
  installSnapTools,
  showRulerLength,
  snapGeometry,
  snapMark,
  snapToolsNow,
} from './snapTools';
import { applyHold, DEFAULT_PROTRACTOR, DEFAULT_RULER, fromRulerSpace, holdFor } from '../snap';
import { expectWithinBudget, measure as time } from '../bench';
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
    snapGeometry.set({ ruler: DEFAULT_RULER, protractor: DEFAULT_PROTRACTOR });
  });
  afterEach(() => document.body.replaceChildren());

  const key = (target: Element, k: string, shiftKey = false) =>
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true }));

  it('holds a wobbly line drawn along the ruler to its straight edge, and reads out its length', () => {
    setPrefs({ ruler: true });
    // A turned ruler, so the edge is not simply a row of the page.
    snapGeometry.set({ ruler: { ...DEFAULT_RULER, angle: Math.PI / 6 }, protractor: DEFAULT_PROTRACTOR });
    const { chrome, stop } = setup(installSnapTools);
    const ruler = snapGeometry.get().ruler;
    const tools = snapToolsNow(1)!;
    // Start just off the top edge and wander up to 3 page units either side of it for 40 mm.
    const wobbly = Array.from({ length: 41 }, (_, i) =>
      fromRulerSpace(ruler, -100 + i * PAGE_UNITS_PER_MM, -ruler.width / 2 - 3 * Math.sin(i)),
    );
    const hold = holdFor(tools, wobbly[0]!);
    expect(hold.kind).toBe('ruler');
    const held = wobbly.map((p) => applyHold(tools, hold, p));
    const [first, last] = [held[0]!, held.at(-1)!];
    const len = Math.hypot(last.x - first.x, last.y - first.y);
    for (const p of held) {
      // Every point lies on the line from the first point to the last.
      const off = Math.abs((last.x - first.x) * (first.y - p.y) - (first.x - p.x) * (last.y - first.y)) / len;
      expect(off).toBeLessThan(1e-9);
    }
    expect(len / PAGE_UNITS_PER_MM).toBeCloseTo(40, 6);
    showRulerLength(first, last);
    expect(chrome.querySelector('[data-ink-readout="ruler"]')?.textContent).toBe('4.0 cm along the ruler');
    setPrefs({ rulerUnits: 'imperial' });
    showRulerLength(first, { x: first.x + 25.4 * PAGE_UNITS_PER_MM, y: first.y });
    expect(chrome.querySelector('[data-ink-readout="ruler"]')?.textContent).toBe('1 in along the ruler');
    stop();
  });

  it('moves the ruler by keyboard a millimeter or a sixteenth of an inch, and turns it', () => {
    setPrefs({ ruler: true });
    const { chrome, stop } = setup(installSnapTools);
    const widget = chrome.querySelector('[data-ink-widget="ruler"]')!;
    const start = snapGeometry.get().ruler;
    key(widget, 'ArrowRight');
    expect(snapGeometry.get().ruler.cx).toBeCloseTo(start.cx + PAGE_UNITS_PER_MM);
    key(widget, 'ArrowDown', true);
    expect(snapGeometry.get().ruler.cy).toBeCloseTo(start.cy + 10 * PAGE_UNITS_PER_MM);
    setPrefs({ rulerUnits: 'imperial' });
    key(widget, 'ArrowLeft');
    expect(snapGeometry.get().ruler.cx).toBeCloseTo(start.cx + PAGE_UNITS_PER_MM - (25.4 / 16) * PAGE_UNITS_PER_MM);
    key(widget, ']');
    expect(snapGeometry.get().ruler.angle).toBeCloseTo(Math.PI / 180);
    key(widget, '[', true);
    expect(snapGeometry.get().ruler.angle).toBeCloseTo(Math.PI / 180 - (15 * Math.PI) / 180);
    stop();
  });

  it.each(['pen', 'touch', 'mouse'])('moves and turns the ruler by %s', (pointerType) => {
    setPrefs({ ruler: true });
    const { chrome, tools, stop } = setup(installSnapTools);
    const [widgets] = tools;
    const body = chrome.querySelector<HTMLElement>('[data-ink-widget="ruler"]')!;
    const handle = body.querySelector<HTMLElement>('[data-ink-turn]')!;
    const start = snapGeometry.get().ruler;
    const at = (x: number, y: number, target: Element) => pen(x, y, { pointerType, target } as Partial<PointerEvent>);
    expect(widgets!.accepts(at(start.cx, start.cy, body), ctx)).toBe(true);
    widgets!.down(at(start.cx, start.cy, body), ctx);
    widgets!.move?.([at(start.cx + 30, start.cy + 40, body)], ctx);
    widgets!.up?.(at(start.cx + 30, start.cy + 40, body), ctx);
    expect(snapGeometry.get().ruler).toMatchObject({ cx: start.cx + 30, cy: start.cy + 40, angle: 0 });
    // A drag on the round handle turns it about its center, a quarter turn here.
    const r = snapGeometry.get().ruler;
    widgets!.down(at(r.cx + 100, r.cy, handle), ctx);
    widgets!.move?.([at(r.cx, r.cy + 100, handle)], ctx);
    widgets!.up?.(at(r.cx, r.cy + 100, handle), ctx);
    expect(snapGeometry.get().ruler.angle).toBeCloseTo(Math.PI / 2);
    expect(snapGeometry.get().ruler.cx).toBe(r.cx);
    stop();
  });

  it('measures from the keyboard: arrows move the crosshair and Enter marks each point', () => {
    const { chrome, stop } = setup(installMeasure);
    geometryTool.set('measure');
    const cursor = chrome.querySelector<HTMLElement>('[data-ink-measure-cursor]')!;
    expect(cursor.style.display).toBe('');
    const start = measureCursor.get()!;
    expect(start).toEqual({ x: 400, y: 300 });
    key(cursor, 'Enter');
    expect(measurement.get()).toEqual({ a: start, b: null });
    key(cursor, 'ArrowRight', true);
    key(cursor, 'ArrowRight', true);
    key(cursor, 'ArrowUp', true);
    key(cursor, 'ArrowUp', true);
    key(cursor, 'Enter');
    expect(chrome.querySelector('[data-ink-measure]')?.textContent).toBe('2.8 cm at 45 degrees');
    key(cursor, 'Escape');
    expect(geometryTool.get()).toBe('none');
    expect(cursor.style.display).toBe('none');
    stop();
  });

  it('sweeps an arc from the keyboard with [ and ], and Escape lets go of the sweep first', async () => {
    const { chrome, added, stop } = setup(installCompass);
    geometryTool.set('compass');
    const needle = chrome.querySelector<HTMLElement>('[data-ink-compass]')!;
    expect(chrome.querySelector('[data-ink-compass-hint]')?.textContent).toBe('Drag out from the center to open');
    for (let i = 0; i < 10; i += 1) key(needle, '+', true);
    expect(chrome.querySelector('[data-ink-compass-hint]')?.textContent).toContain('drag from the center to resize');
    for (let i = 0; i < 6; i += 1) key(needle, ']');
    expect(chrome.querySelector('[data-ink-compass-radius]')?.textContent).toContain('90 degrees');
    key(needle, 'Escape');
    expect(geometryTool.get()).toBe('compass');
    for (let i = 0; i < 6; i += 1) key(needle, '[');
    key(needle, 'Enter');
    await vi.waitFor(() => expect(added).toHaveLength(1));
    const shape = shapeOfStroke(added[0]!);
    expect(shape?.kind).toBe('arc');
    if (shape?.kind === 'arc') {
      expect(Math.abs(shape.sweep)).toBeCloseTo(Math.PI / 2, 1);
      expect(shape.radius / PAGE_UNITS_PER_MM).toBeCloseTo(100, 0);
    }
    stop();
  });

  it('adds no work to normal ink: with neither tool chosen, a pen contact passes in well under a millisecond', () => {
    const measureTools = setup(installMeasure);
    const compassTools = setup(installCompass);
    const both = [...measureTools.tools, ...compassTools.tools];
    const contact = pen(100, 100);
    for (const tool of both) expect(tool.accepts(contact, ctx)).toBe(false);
    // 1,000 pen contacts each asked of both tools: what the router pays per pen down, a thousand times over.
    const timing = time(() => {
      for (let i = 0; i < 1000; i += 1) for (const tool of both) tool.accepts(contact, ctx);
    });
    expectWithinBudget(timing, 1);
    measureTools.stop();
    compassTools.stop();
  });

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
