// The geometry compass on the page (snap/compass.ts has its geometry).
// While it is chosen it takes the pen, the mouse, and a lone finger.
//
// - A tap sets the center.
// - A drag out from the center opens the compass. The radius snaps to whole spacings of the paper's lines or the grid.
// - A sweep around the center draws an arc, and a full turn draws a circle.
//   Either is saved as an ordinary shape stroke, so its handles edit it like any other circle or arc.
// - Arrow keys move the center, and plus and minus open and close the compass.
// - [ and ] sweep the pencil 15 degrees at a time (Shift, 1 degree), and Enter draws the arc swept, or a circle.
// - Once the compass is open, a press away from the center sweeps, and a press on the needle changes the radius.
//   A hint under the needle says so.
import { newId } from '../../../editor/ids';
import { createStore } from '../../../state/store';
import type { Store } from '../../../state/store';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { shapePoints } from '../geometry/shapes';
import type { Shape } from '../geometry/shapes';
import type { Vec } from '../geometry/types';
import type { InkStroke } from '../model/types';
import { resolveColor, toCss } from '../pens/palette';
import {
  COMPASS_START,
  compassShape,
  distance,
  extendSweep,
  MIN_RADIUS,
  pencilAt,
  startSweep,
  sweepDegrees,
  unitStep,
} from '../snap';
import type { CompassState, Sweep } from '../snap';
import { createContactRule, geometryLayer, svgNode, toScreen } from './geometryLayer';
import type { InkHost, InkPointerTool } from './host';
import { formatLength, geometryOn, geometryTool, rulerUnitsNow, snapMark, snapRadius } from './snapTools';
import { activeSlot, drawState, styleOf } from './state';
import type { InkSurface } from './surface';

/** How near the center a press must be to open the compass, in screen pixels. */
const CENTER_PX = 16;
/** A drag shorter than this many screen pixels is a tap. */
const TAP_PX = 6;
/** How far [ and ] sweep the pencil, in radians: 15 degrees, or 1 with Shift. */
const KEY_SWEEP = Math.PI / 12;
const KEY_SWEEP_FINE = Math.PI / 180;
/** Where the pencil rests before a sweep: up and to the right of the needle. */
const REST_ANGLE = -Math.PI / 4;

export const compassState = createStore<CompassState>(COMPASS_START, 'ink compass');

type Drag =
  | { readonly kind: 'place' | 'open'; readonly pointerId: number; readonly start: Vec; moved: boolean }
  | { readonly kind: 'sweep'; readonly pointerId: number; readonly start: Vec; moved: boolean; sweep: Sweep };

/** The stroke a compass shape is saved as: exact points in the current pen's color and width, so it is a shape. */
export function compassStroke(surface: InkSurface, shape: Shape): InkStroke {
  const pen = styleOf(activeSlot());
  return {
    id: newId(),
    // A highlighter's wide, see-through line is no good for a construction, so the compass draws with a pen's tool.
    tool: pen.tool === 'highlighter' ? 'pen' : pen.tool,
    width: pen.width,
    startTime: Date.now(),
    points: shapePoints(shape).map((p) => ({ x: p.x, y: p.y })),
    block: surface.layerFor(),
    slot: pen.slot,
    color: pen.color,
  };
}

/** Saves what a sweep drew and says what it was. */
async function commit(surface: InkSurface, shape: Shape, degrees: number): Promise<void> {
  if (surface.readOnly) {
    announce(t('ink.compass.readOnly'));
    return;
  }
  const radius = shape.kind === 'circle' || shape.kind === 'arc' ? shape.radius : 0;
  const length = formatLength(radius);
  if (await surface.add([compassStroke(surface, shape)])) {
    announce(shape.kind === 'circle' ? t('ink.compass.circle', { length }) : t('ink.compass.arc', { degrees, length }));
  } else {
    announce(t('ink.compass.notSaved'));
  }
}

class CompassLayer {
  readonly svg: SVGSVGElement;
  readonly needle: HTMLButtonElement;
  private readonly stops: (() => void)[] = [];
  sweep: Sweep | null = null;

  constructor(private readonly surface: InkSurface) {
    this.svg = geometryLayer(surface, 'compass');
    const doc = surface.chrome.ownerDocument;
    this.needle = doc.createElement('button');
    this.needle.type = 'button';
    this.needle.dataset.inkCompass = '';
    this.needle.setAttribute('aria-label', t('ink.compass.label'));
    Object.assign(this.needle.style, {
      position: 'absolute',
      left: '0',
      top: '0',
      width: '24px',
      height: '24px',
      margin: '-12px 0 0 -12px',
      borderRadius: '50%',
      border: '2px solid var(--color-accent-primary)',
      background: 'color-mix(in srgb, var(--color-surface-page) 70%, transparent)',
      padding: '0',
      // The needle shows where the center is; the compass tool, not the button, takes the pointer.
      pointerEvents: 'none',
    });
    this.needle.addEventListener('keydown', this.onKey);
    surface.chrome.append(this.needle);
    this.stops.push(
      surface.onChange(() => this.draw()),
      compassState.subscribe(() => this.draw()),
      geometryTool.subscribe(() => this.draw()),
    );
    this.draw();
  }

  draw(): void {
    const on = geometryTool.get() === 'compass' && geometryOn();
    const { center, radius } = compassState.get();
    this.svg.replaceChildren();
    this.svg.style.display = on && center ? '' : 'none';
    this.needle.style.display = on && center ? '' : 'none';
    if (!on || !center) return;
    const camera = this.surface.cameraNow();
    const doc = this.svg.ownerDocument;
    const c = toScreen(camera, center);
    this.needle.style.transform = `translate(${c.x}px, ${c.y}px)`;
    const r = radius * camera.zoom;
    if (radius >= MIN_RADIUS) {
      // The circle the compass would draw, faint, so the sweep can be aimed.
      this.svg.append(
        svgNode(doc, 'circle', {
          cx: c.x,
          cy: c.y,
          r,
          fill: 'none',
          stroke: 'currentColor',
          'stroke-opacity': 0.3,
          'stroke-dasharray': '4 6',
        }),
      );
      const angle = this.sweep?.last ?? REST_ANGLE;
      const pencil = toScreen(camera, pencilAt(center, radius, angle));
      this.svg.append(
        svgNode(doc, 'line', {
          x1: c.x,
          y1: c.y,
          x2: pencil.x,
          y2: pencil.y,
          stroke: 'currentColor',
          'stroke-width': 1.5,
        }),
        svgNode(doc, 'circle', { cx: pencil.x, cy: pencil.y, r: 4, fill: 'currentColor' }),
      );
      const label = svgNode(doc, 'text', {
        x: (c.x + pencil.x) / 2,
        y: (c.y + pencil.y) / 2 - 8,
        'text-anchor': 'middle',
        fill: 'var(--color-text-primary)',
        stroke: 'var(--color-surface-page)',
        'stroke-width': 4,
        'paint-order': 'stroke',
        'font-size': 13,
      });
      label.dataset.inkCompassRadius = '';
      label.textContent = this.sweep
        ? `${t('ink.compass.radius', { length: formatLength(radius) })} · ${t('ink.snap.angle', { degrees: sweepDegrees(this.sweep) })}`
        : t('ink.compass.radius', { length: formatLength(radius) });
      this.svg.append(label);
    }
    // What a press does next, under the needle, so changing the radius is not a guess.
    const hint = svgNode(doc, 'text', {
      x: c.x,
      y: c.y + 30,
      'text-anchor': 'middle',
      fill: 'var(--color-text-secondary)',
      stroke: 'var(--color-surface-page)',
      'stroke-width': 4,
      'paint-order': 'stroke',
      'font-size': 12,
    });
    hint.dataset.inkCompassHint = '';
    hint.textContent = t(radius >= MIN_RADIUS ? 'ink.compass.hintOpen' : 'ink.compass.hintClosed');
    if (!this.sweep) this.svg.append(hint);
    const shape = this.sweep ? compassShape(center, radius, this.sweep) : null;
    if (shape) {
      const points = shapePoints(shape).map((p) => toScreen(camera, p));
      const d =
        points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join('') + (shape.kind === 'circle' ? 'Z' : '');
      const pen = styleOf(activeSlot());
      this.svg.append(
        svgNode(doc, 'path', {
          d,
          fill: 'none',
          stroke: toCss(resolveColor(pen, this.surface.scheme())),
          'stroke-width': Math.max(1, pen.width * camera.zoom),
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round',
        }),
      );
    }
  }

  private readonly onKey = (event: KeyboardEvent) => {
    const state = compassState.get();
    if (!state.center) return;
    const step = unitStep(rulerUnitsNow()) * (event.shiftKey ? 10 : 1);
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const arrow = arrows[event.key];
    let next: CompassState | null = null;
    if (arrow)
      next = { ...state, center: { x: state.center.x + arrow[0] * step, y: state.center.y + arrow[1] * step } };
    else if (event.key === '+' || event.key === '=') next = { ...state, radius: state.radius + step };
    else if (event.key === '-' || event.key === '_') next = { ...state, radius: Math.max(0, state.radius - step) };
    else if (event.key === '[' || event.key === ']') {
      event.preventDefault();
      event.stopPropagation();
      if (state.radius < MIN_RADIUS) {
        announce(t('ink.compass.needsRadius'));
        return;
      }
      const turn = (event.key === ']' ? 1 : -1) * (event.shiftKey ? KEY_SWEEP_FINE : KEY_SWEEP);
      const from = this.sweep ?? { start: REST_ANGLE, last: REST_ANGLE, total: 0 };
      const total = Math.max(-2 * Math.PI, Math.min(2 * Math.PI, from.total + turn));
      this.sweep = { start: from.start, last: from.start + total, total };
      this.draw();
      announce(t('ink.snap.angle', { degrees: sweepDegrees(this.sweep) }));
      return;
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const swept = this.sweep;
      this.sweep = null;
      const shape = swept ? compassShape(state.center, state.radius, swept) : null;
      if (state.radius < MIN_RADIUS) announce(t('ink.compass.needsRadius'));
      else if (shape && swept) void commit(this.surface, shape, sweepDegrees(swept));
      else void commit(this.surface, { kind: 'circle', center: state.center, radius: state.radius }, 360);
      this.draw();
      return;
    } else if (event.key === 'Escape') {
      event.preventDefault();
      // Escape first lets go of a sweep, then puts the compass away.
      if (this.sweep) {
        this.sweep = null;
        this.draw();
      } else geometryTool.set('none');
      return;
    }
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    compassState.set(next);
    if (next.radius !== state.radius) announce(t('ink.compass.radius', { length: formatLength(next.radius) }));
  };

  destroy(): void {
    this.stops.forEach((stop) => stop());
    this.svg.remove();
    this.needle.remove();
  }
}

/** Puts the needle in the middle of the view when the compass is chosen and has no center yet. */
function centerInView(surface: InkSurface): void {
  if (compassState.get().center) return;
  const camera = surface.cameraNow();
  const middle = {
    x: (camera.scrollX + camera.viewport.w / 2) / camera.zoom,
    y: (camera.scrollY + camera.viewport.h / 2) / camera.zoom,
  };
  compassState.set({ center: snapMark(middle, camera.zoom), radius: 0 });
}

export function installCompass(host: InkHost, surfaces: Store<InkSurface | null>): () => void {
  let layer: CompassLayer | null = null;
  const sync = () => {
    layer?.destroy();
    const surface = surfaces.get();
    layer = surface ? new CompassLayer(surface) : null;
    if (surface && geometryTool.get() === 'compass') centerInView(surface);
  };
  let lastTool = drawState.get().tool;
  const stops = [
    surfaces.subscribe(sync),
    geometryTool.subscribe(() => {
      const surface = surfaces.get();
      if (geometryTool.get() !== 'compass') {
        if (layer) layer.sweep = null;
        return;
      }
      if (surface) centerInView(surface);
      // The needle takes the keyboard, so the compass can be used without a pointer.
      requestAnimationFrame(() => layer?.needle.focus({ preventScroll: true }));
    }),
    // Choosing a pen, the eraser, or the lasso puts the compass and the measure away.
    drawState.subscribe(() => {
      const tool = drawState.get().tool;
      if (tool !== lastTool && geometryTool.get() !== 'none') geometryTool.set('none');
      lastTool = tool;
    }),
  ];
  sync();

  const rule = createContactRule();
  let drag: Drag | null = null;
  const tool: InkPointerTool = {
    id: 'ink.compass',
    // Above the selection (101) and the palm filter (100), below the snap widgets (105), so the ruler still moves.
    priority: 104,
    accepts: (event) =>
      geometryTool.get() === 'compass' && geometryOn() && surfaces.get() !== null && rule.takes(event),
    down(event, ctx) {
      if (drag) return 'claim';
      ctx.capture(event.pointerId);
      const zoom = ctx.camera.zoom;
      const raw = ctx.toWorld(event.clientX, event.clientY);
      const state = compassState.get();
      const start = { x: event.clientX, y: event.clientY };
      const nearCenter = state.center !== null && distance(raw, state.center) * zoom <= CENTER_PX;
      if (state.center && nearCenter) drag = { kind: 'open', pointerId: event.pointerId, start, moved: false };
      else if (!state.center || state.radius < MIN_RADIUS) {
        drag = { kind: 'place', pointerId: event.pointerId, start, moved: false };
        compassState.set({ center: snapMark(raw, zoom, event.altKey), radius: 0 });
      } else {
        drag = { kind: 'sweep', pointerId: event.pointerId, start, moved: false, sweep: startSweep(state.center, raw) };
        if (layer) layer.sweep = drag.sweep;
        layer?.draw();
      }
      return 'claim';
    },
    move(events, ctx) {
      const last = events.filter((one) => one.pointerId === drag?.pointerId).at(-1);
      const state = compassState.get();
      if (!drag || !last || !state.center) return 'claim';
      if (!drag.moved && Math.hypot(last.clientX - drag.start.x, last.clientY - drag.start.y) < TAP_PX) return 'claim';
      drag.moved = true;
      const at = ctx.toWorld(last.clientX, last.clientY);
      if (drag.kind === 'sweep') {
        for (const one of events) {
          if (one.pointerId !== drag.pointerId) continue;
          drag.sweep = extendSweep(drag.sweep, state.center, ctx.toWorld(one.clientX, one.clientY));
        }
        if (layer) layer.sweep = drag.sweep;
        layer?.draw();
      } else {
        // The radius snaps to whole spacings of the paper's lines or the grid, so it opens to whole squares.
        compassState.set({ ...state, radius: snapRadius(distance(state.center, at), ctx.camera.zoom, last.altKey) });
      }
      return 'claim';
    },
    up(event, ctx) {
      rule.release(event);
      if (!drag || drag.pointerId !== event.pointerId) return;
      const done = drag;
      drag = null;
      const state = compassState.get();
      if (layer) layer.sweep = null;
      if (!state.center) return;
      if (done.kind === 'sweep') {
        const shape = compassShape(state.center, state.radius, done.sweep);
        const surface = surfaces.get();
        if (shape && surface) void commit(surface, shape, sweepDegrees(done.sweep));
        else if (!done.moved) {
          // A tap away from the center moves the needle there and keeps the compass open.
          compassState.set({
            ...state,
            center: snapMark(ctx.toWorld(event.clientX, event.clientY), ctx.camera.zoom, event.altKey),
          });
          announce(t('ink.compass.center'));
        }
        layer?.draw();
        return;
      }
      if (state.radius >= MIN_RADIUS) announce(t('ink.compass.radius', { length: formatLength(state.radius) }));
      else announce(t('ink.compass.center'));
    },
    cancel(_ctx, event) {
      if (event) rule.release(event);
      if (drag && (!event || event.pointerId === drag.pointerId)) {
        drag = null;
        if (layer) layer.sweep = null;
        layer?.draw();
      }
    },
  };
  const stopTool = host.registerPointerTool(tool);
  return () => {
    stopTool();
    stops.forEach((stop) => stop());
    layer?.destroy();
    layer = null;
  };
}
