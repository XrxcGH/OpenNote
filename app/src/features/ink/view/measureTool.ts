// The measure: while it is chosen, the pen, the mouse, or a finger marks two points and the page shows the distance
// between them, in the ruler's units, and the angle of the line. A drag measures from where it starts to where it
// lifts; a tap marks one point, and a second tap the other. Nothing is drawn or saved. The points snap to the ruler's
// edge and to the paper's lines like a shape's do. "Measure the selected line" reads the length along drawn lines.
// The keyboard measures too: choosing the measure focuses a crosshair in the middle of the view. Arrow keys move it a
// millimeter or a sixteenth of an inch (Shift, ten), Enter marks the first point and then the second, and Escape puts
// the measure away.
import { createStore } from '../../../state/store';
import type { Store } from '../../../state/store';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { pagePoints } from '../geometry/strokeIndex';
import type { Vec } from '../geometry/types';
import { distance, lineAngle, polylineLength, unitStep } from '../snap';
import { createContactRule, geometryLayer, svgNode, toScreen } from './geometryLayer';
import type { InkHost, InkPointerTool } from './host';
import { formatLength, geometryOn, geometryTool, rulerUnitsNow, snapMark } from './snapTools';
import type { InkSurface } from './surface';

/** A drag shorter than this many screen pixels is a tap. */
const TAP_PX = 6;

export interface Measurement {
  readonly a: Vec;
  /** Null after the first tap, while the second point is still to come. */
  readonly b: Vec | null;
}

export const measurement = createStore<Measurement | null>(null, 'ink measurement');
/** Where the keyboard's crosshair is, in page units, while the measure is chosen. */
export const measureCursor = createStore<Vec | null>(null, 'ink measure cursor');

/** What a measurement reads, such as "4.3 cm at 30 degrees". */
export function measureText(m: Measurement & { b: Vec }): string {
  return t('ink.measure.readout', { length: formatLength(distance(m.a, m.b)), degrees: lineAngle(m.a, m.b) });
}

function draw(svg: SVGSVGElement, surface: InkSurface, keyboard: boolean): void {
  const m = geometryTool.get() === 'measure' ? measurement.get() : null;
  svg.replaceChildren();
  svg.style.display = m ? '' : 'none';
  if (!m) return;
  const doc = svg.ownerDocument;
  const camera = surface.cameraNow();
  const a = toScreen(camera, m.a);
  const cross = (p: Vec) =>
    svg.append(
      svgNode(doc, 'path', {
        d: `M${p.x - 7} ${p.y}H${p.x + 7}M${p.x} ${p.y - 7}V${p.y + 7}`,
        stroke: 'currentColor',
        'stroke-width': 1.5,
      }),
    );
  cross(a);
  // While the keyboard looks for the second point, the line runs to the crosshair.
  const end = m.b ?? (keyboard ? measureCursor.get() : null);
  if (!end) return;
  const b = toScreen(camera, end);
  svg.append(
    svgNode(doc, 'line', {
      x1: a.x,
      y1: a.y,
      x2: b.x,
      y2: b.y,
      stroke: 'currentColor',
      'stroke-width': 1.5,
      'stroke-dasharray': '6 4',
    }),
  );
  cross(b);
  const label = svgNode(doc, 'text', {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2 - 10,
    'text-anchor': 'middle',
    fill: 'var(--color-text-primary)',
    stroke: 'var(--color-surface-page)',
    'stroke-width': 4,
    'paint-order': 'stroke',
    'font-size': 13,
  });
  label.dataset.inkMeasure = '';
  label.textContent = measureText({ a: m.a, b: end });
  svg.append(label);
}

/** Reads out the length along the selected strokes, corner to corner. */
export function measureSelection(host: InkHost, surface: InkSurface | null): string | null {
  const ids = host.selection.get().strokes;
  const strokes = surface ? surface.strokes(ids) : [];
  if (strokes.length === 0) {
    announce(t('ink.measure.selectLine'));
    return null;
  }
  const total = strokes.reduce((sum, stroke) => sum + polylineLength(pagePoints(stroke)), 0);
  const length = formatLength(total);
  const text =
    strokes.length === 1
      ? t('ink.measure.line', { length })
      : t('ink.measure.lines', { count: strokes.length, length });
  announce(text);
  return text;
}

/** The keyboard's crosshair: a button over the page that shows where the next point goes and takes the keys. */
function makeCursor(surface: InkSurface): HTMLButtonElement {
  const button = surface.chrome.ownerDocument.createElement('button');
  button.type = 'button';
  button.dataset.inkMeasureCursor = '';
  button.setAttribute('aria-label', t('ink.measure.keys'));
  Object.assign(button.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: '20px',
    height: '20px',
    margin: '-10px 0 0 -10px',
    borderRadius: '50%',
    border: '2px solid var(--color-accent-primary)',
    background: 'transparent',
    padding: '0',
    // The crosshair only shows the keyboard's place; the measure tool, not the button, takes the pointer.
    pointerEvents: 'none',
  });
  surface.chrome.append(button);
  return button;
}

/** What a key does to the keyboard's measurement, or false when the measure doesn't use the key. */
export function measureKey(event: Pick<KeyboardEvent, 'key' | 'shiftKey'>): boolean {
  const at = measureCursor.get();
  if (!at) return false;
  const step = unitStep(rulerUnitsNow()) * (event.shiftKey ? 10 : 1);
  const arrows: Record<string, [number, number]> = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, -1],
    ArrowDown: [0, 1],
  };
  const arrow = arrows[event.key];
  if (arrow) {
    measureCursor.set({ x: at.x + arrow[0] * step, y: at.y + arrow[1] * step });
    return true;
  }
  if (event.key === 'Enter' || event.key === ' ') {
    const pending = measurement.get();
    if (pending && pending.b === null) {
      const done = { a: pending.a, b: at };
      measurement.set(done);
      announce(t('ink.measure.measured', { length: measureText(done) }));
    } else {
      measurement.set({ a: at, b: null });
      announce(t('ink.measure.firstKey'));
    }
    return true;
  }
  if (event.key === 'Escape') {
    geometryTool.set('none');
    return true;
  }
  return false;
}

export function installMeasure(host: InkHost, surfaces: Store<InkSurface | null>): () => void {
  let layer: { svg: SVGSVGElement; cursor: HTMLButtonElement; stop: () => void } | null = null;
  const redraw = () => {
    const surface = surfaces.get();
    if (!layer || !surface) return;
    const at = geometryTool.get() === 'measure' ? measureCursor.get() : null;
    const keyboard = at !== null && surface.chrome.ownerDocument.activeElement === layer.cursor;
    draw(layer.svg, surface, keyboard);
    layer.cursor.style.display = at ? '' : 'none';
    if (at) {
      const p = toScreen(surface.cameraNow(), at);
      layer.cursor.style.transform = `translate(${p.x}px, ${p.y}px)`;
    }
  };
  const onKey = (event: KeyboardEvent) => {
    if (!measureKey(event)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  const sync = () => {
    layer?.stop();
    layer?.svg.remove();
    layer?.cursor.remove();
    const surface = surfaces.get();
    if (!surface) {
      layer = null;
      return;
    }
    const svg = geometryLayer(surface, 'measure');
    const cursor = makeCursor(surface);
    cursor.addEventListener('keydown', onKey);
    cursor.addEventListener('focus', redraw);
    cursor.addEventListener('blur', redraw);
    layer = { svg, cursor, stop: surface.onChange(redraw) };
    redraw();
  };
  const stops = [
    surfaces.subscribe(sync),
    measurement.subscribe(redraw),
    measureCursor.subscribe(redraw),
    geometryTool.subscribe(() => {
      const surface = surfaces.get();
      if (geometryTool.get() !== 'measure') {
        measurement.set(null);
        measureCursor.set(null);
      } else if (surface && !measureCursor.get()) {
        // The crosshair starts in the middle of the view and takes the keyboard.
        const camera = surface.cameraNow();
        const middle = {
          x: (camera.scrollX + camera.viewport.w / 2) / camera.zoom,
          y: (camera.scrollY + camera.viewport.h / 2) / camera.zoom,
        };
        measureCursor.set(snapMark(middle, camera.zoom));
        requestAnimationFrame(() => layer?.cursor.focus({ preventScroll: true }));
      }
      redraw();
    }),
  ];
  sync();

  const rule = createContactRule();
  let drag: { pointerId: number; start: { x: number; y: number }; moved: boolean; second: boolean } | null = null;
  const tool: InkPointerTool = {
    id: 'ink.measure',
    // Above the selection (101) and the palm filter (100), below the snap widgets (105), so the ruler still moves.
    priority: 104,
    accepts: (event) =>
      geometryTool.get() === 'measure' && geometryOn() && surfaces.get() !== null && rule.takes(event),
    down(event, ctx) {
      if (drag) return 'claim';
      ctx.capture(event.pointerId);
      const zoom = ctx.camera.zoom;
      const at = snapMark(ctx.toWorld(event.clientX, event.clientY), zoom, event.altKey);
      const pending = measurement.get();
      const second = pending !== null && pending.b === null;
      drag = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, moved: false, second };
      measurement.set(second ? { a: pending.a, b: at } : { a: at, b: null });
      measureCursor.set(at);
      return 'claim';
    },
    move(events, ctx) {
      const last = events.filter((one) => one.pointerId === drag?.pointerId).at(-1);
      if (!drag || !last) return 'claim';
      if (!drag.moved && Math.hypot(last.clientX - drag.start.x, last.clientY - drag.start.y) < TAP_PX) return 'claim';
      drag.moved = true;
      const m = measurement.get();
      if (m)
        measurement.set({ a: m.a, b: snapMark(ctx.toWorld(last.clientX, last.clientY), ctx.camera.zoom, last.altKey) });
      return 'claim';
    },
    up(event) {
      rule.release(event);
      if (!drag || drag.pointerId !== event.pointerId) return;
      const { moved, second } = drag;
      drag = null;
      const m = measurement.get();
      if (!m) return;
      if (!moved && !second) {
        announce(t('ink.measure.firstPoint'));
        return;
      }
      if (m.b) announce(t('ink.measure.measured', { length: measureText({ a: m.a, b: m.b }) }));
    },
    cancel(_ctx, event) {
      if (event) rule.release(event);
      if (drag && (!event || event.pointerId === drag.pointerId)) drag = null;
    },
  };
  const stopTool = host.registerPointerTool(tool);
  return () => {
    stopTool();
    stops.forEach((stop) => stop());
    layer?.stop();
    layer?.svg.remove();
    layer?.cursor.remove();
    layer = null;
    measurement.set(null);
    measureCursor.set(null);
  };
}
