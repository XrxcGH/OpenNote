// The measure: while it is chosen, the pen, the mouse, or a finger marks two points and the page shows the distance
// between them, in the ruler's units, and the angle of the line. A drag measures from where it starts to where it
// lifts; a tap marks one point, and a second tap the other. Nothing is drawn or saved. The points snap to the ruler's
// edge and to the paper's lines like a shape's do. "Measure the selected line" reads the length along drawn lines.
import { createStore } from '../../../state/store';
import type { Store } from '../../../state/store';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { pagePoints } from '../geometry/strokeIndex';
import type { Vec } from '../geometry/types';
import { distance, lineAngle, polylineLength } from '../snap';
import { createContactRule, geometryLayer, svgNode, toScreen } from './geometryLayer';
import type { InkHost, InkPointerTool } from './host';
import { formatLength, geometryOn, geometryTool, snapMark } from './snapTools';
import type { InkSurface } from './surface';

/** A drag shorter than this many screen pixels is a tap. */
const TAP_PX = 6;

export interface Measurement {
  readonly a: Vec;
  /** Null after the first tap, while the second point is still to come. */
  readonly b: Vec | null;
}

export const measurement = createStore<Measurement | null>(null, 'ink measurement');

/** What a measurement reads, such as "4.3 cm at 30 degrees". */
export function measureText(m: Measurement & { b: Vec }): string {
  return t('ink.measure.readout', { length: formatLength(distance(m.a, m.b)), degrees: lineAngle(m.a, m.b) });
}

function draw(svg: SVGSVGElement, surface: InkSurface): void {
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
  if (!m.b) return;
  const b = toScreen(camera, m.b);
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
  label.textContent = measureText({ a: m.a, b: m.b });
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

export function installMeasure(host: InkHost, surfaces: Store<InkSurface | null>): () => void {
  let layer: { svg: SVGSVGElement; stop: () => void } | null = null;
  const redraw = () => {
    const surface = surfaces.get();
    if (layer && surface) draw(layer.svg, surface);
  };
  const sync = () => {
    layer?.stop();
    layer?.svg.remove();
    const surface = surfaces.get();
    if (!surface) {
      layer = null;
      return;
    }
    const svg = geometryLayer(surface, 'measure');
    layer = { svg, stop: surface.onChange(redraw) };
    redraw();
  };
  const stops = [
    surfaces.subscribe(sync),
    measurement.subscribe(redraw),
    geometryTool.subscribe(() => {
      if (geometryTool.get() !== 'measure') measurement.set(null);
      redraw();
    }),
  ];
  sync();

  const rule = createContactRule();
  let drag: { pointerId: number; start: { x: number; y: number }; moved: boolean; second: boolean } | null = null;
  const tool: InkPointerTool = {
    id: 'ink.measure',
    // Above the selection (95) and the palm filter (100), below the snap widgets (105), so the ruler still moves.
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
    layer = null;
    measurement.set(null);
  };
}
