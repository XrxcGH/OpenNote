// Pointer input for ink: the pen and mouse tool that draws, erases, and lassos, and the touch tool that runs the
// palm filter. Both join the page view's pointer router. A claimed pointer never reaches the blocks, so a pen
// stroke never moves a caret. Samples come from `pointerrawupdate` where the browser has it, for the shortest path
// to the screen, and from the router's coalesced moves otherwise; predicted samples draw but are never stored.
import { newId } from '../../../editor/ids';
import { isEnabled } from '../../../app/flags';
import { getSettings } from '../../../state/settings';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { createPartialEraseSession, createStrokeEraseSession } from '../edits/eraseSession';
import type { PartialEraseSession, StrokeEraseSession } from '../edits/eraseSession';
import { eraserSkip, ERASE_ALL } from '../edits/filters';
import type { EraserFilter } from '../edits/filters';
import { recognizeShape } from '../geometry/shapes';
import type { ShapeMatch } from '../geometry/shapes';
import type { InkPoint, Vec } from '../geometry/types';
import { DEFAULT_PEN_BUTTONS, resolvePenAction, suppressContextMenu } from './../input/buttons';
import type { PenAction } from '../input/buttons';
import type { InkPipeline, PointerRecord, TouchInk } from '../input/pipeline';
import { createStrokeBuilder } from '../input/strokeBuilder';
import type { StrokeBuilder } from '../input/strokeBuilder';
import type { RawSample } from '../input/samples';
import type { InkStroke } from '../model/types';
import { mmToPage } from '../pens/tools';
import type { InkHost, InkPointerTool, InkRouterContext } from './host';
import { finishLasso, startLasso } from './lasso';
import type { LassoGesture } from './lasso';
import { activeSlot, drawState, styleOf } from './state';
import type { PenStyle } from './state';
import type { InkSurface } from './surface';

/** The stroke eraser's reach, in screen pixels. */
const STROKE_ERASER_PX = 6;
/** Moving less than this, in screen pixels, counts as holding still for hold-to-shape. */
const HOLD_SLOP_PX = 3;

type Mode = 'ink' | 'erase' | 'partial' | 'lasso';

interface InkGesture {
  readonly mode: Mode;
  readonly pointerId: number;
  readonly style: PenStyle;
  readonly release: () => void;
  lastTime: number;
  builder?: StrokeBuilder;
  erase?: StrokeEraseSession;
  partial?: PartialEraseSession<InkStroke>;
  lasso?: LassoGesture;
  radius: number;
  hold?: { x: number; y: number; at: number; timer: ReturnType<typeof setInterval> | null; shape: ShapeMatch | null };
  last?: Vec;
}

const DRAW_TOOLS = new Set(['pen', 'eraser', 'partialEraser', 'lasso']);

function modeFor(action: PenAction | null): Mode | null {
  if (action === null) {
    const tool = drawState.get().tool;
    if (tool === 'pen') return 'ink';
    if (tool === 'eraser') return 'erase';
    if (tool === 'partialEraser') return 'partial';
    if (tool === 'lasso') return 'lasso';
    return null;
  }
  if (action === 'strokeEraser' || action === 'highlighterEraser') return 'erase';
  if (action === 'partialEraser') return 'partial';
  if (action === 'lasso') return 'lasso';
  return null;
}

function eraserFilter(action: PenAction | null): EraserFilter {
  if (action === 'highlighterEraser') return { kind: 'highlighter' };
  const erases = getSettings().ink.eraser.erases;
  if (erases === 'all') return ERASE_ALL;
  if (erases === 'highlighter' || erases === 'pens') return { kind: erases };
  return { kind: 'tool', tool: erases };
}

function sampleOf(event: PointerEvent, ctx: { toWorld(x: number, y: number): Vec }): RawSample {
  const at = ctx.toWorld(event.clientX, event.clientY);
  const pen = event.pointerType === 'pen';
  return {
    x: at.x,
    y: at.y,
    time: event.timeStamp,
    pointerType: pen ? 'pen' : event.pointerType === 'touch' ? 'touch' : 'mouse',
    pressure: pen ? event.pressure : undefined,
    tiltX: pen ? event.tiltX : undefined,
    tiltY: pen ? event.tiltY : undefined,
    altitudeAngle: pen ? (event as PointerEvent & { altitudeAngle?: number }).altitudeAngle : undefined,
    azimuthAngle: pen ? (event as PointerEvent & { azimuthAngle?: number }).azimuthAngle : undefined,
  };
}

/** The pen and mouse tool: ink, the erasers, and the lasso, by the active tool and the pen's buttons. */
export function createPenTool(
  host: InkHost,
  surfaceOf: () => InkSurface | null,
): {
  tool: InkPointerTool;
  destroy(): void;
} {
  let gesture: InkGesture | null = null;
  let lastEnd = 0;
  let lastAction: PenAction | null = null;
  const target = () => host.viewport.get()?.viewport ?? null;

  const take = (events: readonly PointerEvent[], ctx: { toWorld(x: number, y: number): Vec }) => {
    const g = gesture;
    const surface = surfaceOf();
    if (!g || !surface) return;
    const samples: RawSample[] = [];
    for (const event of events) {
      if (event.pointerId !== g.pointerId || event.timeStamp <= g.lastTime) continue;
      g.lastTime = event.timeStamp;
      samples.push(sampleOf(event, ctx));
    }
    if (samples.length === 0) return;
    const predicted = events.at(-1)?.getPredictedEvents?.() ?? [];
    step(
      g,
      surface,
      samples,
      predicted.map((e) => sampleOf(e, ctx)),
    );
  };

  const onRaw = (event: Event) => {
    const viewport = host.viewport.get();
    const pointer = event as PointerEvent;
    if (!gesture || !viewport || pointer.pointerId !== gesture.pointerId) return;
    const coalesced = pointer.getCoalescedEvents?.() ?? [];
    take(coalesced.length > 0 ? coalesced : [pointer], viewport);
  };

  const end = (commit: boolean) => {
    const g = gesture;
    const surface = surfaceOf();
    gesture = null;
    lastEnd = performance.now();
    target()?.removeEventListener('pointerrawupdate', onRaw);
    if (!g) return;
    if (g.hold?.timer) clearInterval(g.hold.timer);
    g.release();
    if (!surface) return;
    surface.setPenDown(false);
    if (commit) void finish(g, surface, host);
    else cancel(g, surface);
  };

  const onContextMenu = (event: Event) => {
    const pointer = event as PointerEvent;
    const state = {
      pointerType: pointer.pointerType ?? 'mouse',
      gestureActive: gesture !== null,
      holdTimerRunning: gesture?.hold?.timer != null,
      sinceGestureEnd: performance.now() - lastEnd,
      action: lastAction,
    };
    if (suppressContextMenu(state)) event.preventDefault();
  };
  document.addEventListener('contextmenu', onContextMenu, { capture: true });

  const tool: InkPointerTool = {
    id: 'ink.pen',
    priority: 80,
    accepts(event, ctx) {
      const surface = surfaceOf();
      if (!surface || surface.readOnly || event.pointerType === 'touch' || !isEnabled('ink.core')) return false;
      if (event.pointerType === 'mouse' && event.button !== 0) return false;
      const buttons = isEnabled('ink.penButtons') ? resolvePenAction(event, DEFAULT_PEN_BUTTONS) : null;
      if (buttons && buttons.action !== null) return modeFor(buttons.action) !== null;
      return DRAW_TOOLS.has(drawState.get().tool) && ctx.activeTool !== 'select';
    },
    down(event, ctx) {
      const surface = surfaceOf()!;
      const buttons = isEnabled('ink.penButtons') ? resolvePenAction(event, DEFAULT_PEN_BUTTONS) : null;
      const action = buttons?.action ?? null;
      lastAction = action;
      const mode = modeFor(action) ?? 'ink';
      ctx.capture(event.pointerId);
      const viewport = host.viewport.get();
      focusPage(viewport?.viewport);
      const release = viewport?.holdCamera('pen') ?? (() => undefined);
      gesture = begin(mode, event, ctx, surface, release, eraserFilter(action));
      surface.setPenDown(true);
      target()?.addEventListener('pointerrawupdate', onRaw);
      take([event], ctx);
      return 'claim';
    },
    move(events, ctx) {
      take(events, ctx);
      return 'claim';
    },
    up(event, ctx) {
      take([event], ctx);
      end(true);
    },
    cancel() {
      end(false);
    },
  };
  return {
    tool,
    destroy() {
      end(false);
      document.removeEventListener('contextmenu', onContextMenu, { capture: true });
    },
  };
}

/** Drawing puts the keyboard on the page, so Ctrl+Z undoes the stroke just drawn, not the last thing typed elsewhere. */
function focusPage(scroller: HTMLElement | undefined): void {
  const active = scroller?.ownerDocument.activeElement;
  if (scroller && !(active instanceof Node && scroller.contains(active))) scroller.focus({ preventScroll: true });
}

function begin(
  mode: Mode,
  event: PointerEvent,
  ctx: InkRouterContext,
  surface: InkSurface,
  release: () => void,
  filter: EraserFilter,
): InkGesture {
  const zoom = ctx.camera.zoom;
  const style = styleOf(activeSlot());
  const g: InkGesture = { mode, pointerId: event.pointerId, style, release, lastTime: -Infinity, radius: 0 };
  const skip = eraserSkip(filter);
  if (mode === 'ink') {
    g.builder = createStrokeBuilder({
      tool: style.tool,
      width: style.width,
      slot: style.slot,
      color: style.color,
      block: surface.layerFor(),
      newId: () => newId(),
      timeOrigin: Date.now() - performance.now(),
    });
    const shapes = getSettings().ink.shapes;
    if (isEnabled('ink.shapes') && shapes.hold && style.tool !== 'highlighter') {
      g.hold = { x: 0, y: 0, at: performance.now(), timer: null, shape: null };
      g.hold.timer = setInterval(() => holdCheck(g, surface, shapes.holdMs), 50);
    }
  } else if (mode === 'erase') {
    g.erase = createStrokeEraseSession(surface.index, { skip });
    g.radius = STROKE_ERASER_PX / zoom;
  } else if (mode === 'partial') {
    g.partial = createPartialEraseSession<InkStroke>(surface.index, () => newId(), { skip });
    g.radius = mmToPage(getSettings().ink.eraser.size) / 2;
  } else {
    g.lasso = startLasso();
  }
  return g;
}

function step(g: InkGesture, surface: InkSurface, samples: RawSample[], predicted: RawSample[]): void {
  const last = samples[samples.length - 1];
  if (g.builder) {
    for (const sample of samples) g.builder.push(sample);
    if (g.hold) {
      const zoom = surface.cameraNow().zoom;
      if (Math.hypot(last.x - g.hold.x, last.y - g.hold.y) * zoom > HOLD_SLOP_PX) {
        g.hold = { ...g.hold, x: last.x, y: last.y, at: performance.now(), shape: null };
      }
    }
    if (g.hold?.shape) return drawShape(g, surface);
    const ahead: InkPoint[] = predicted.map((p) => ({ x: p.x, y: p.y, pressure: p.pressure }));
    surface.drawLive([...g.builder.points, ...ahead], g.style);
    return;
  }
  const points: Vec[] = samples.map((s) => ({ x: s.x, y: s.y }));
  if (g.erase) {
    const gone = g.erase.move(points, g.radius);
    if (gone.length > 0) surface.preview(gone, []);
  } else if (g.partial) {
    const change = g.partial.move(points, g.radius);
    if (change.removed.length + change.added.length > 0) surface.preview(change.removed, change.added);
  } else if (g.lasso) {
    g.lasso.points.push(...points);
    g.lasso.draw(surface);
  }
  g.last = last;
  if (g.erase || g.partial) drawEraser(surface, last, g.radius);
}

function drawEraser(surface: InkSurface, at: Vec, radius: number): void {
  const ctx = surface.liveContext();
  if (!ctx) return;
  const zoom = surface.cameraNow().zoom;
  ctx.lineWidth = 1 / zoom;
  ctx.strokeStyle = surface.scheme() === 'dark' ? '#f0e9de' : '#2b2521';
  ctx.beginPath();
  ctx.arc(at.x, at.y, Math.max(radius, 2 / zoom), 0, Math.PI * 2);
  ctx.stroke();
}

/** Hold-to-shape: the pen held still at the end of a stroke snaps it to the shape that fits. */
function holdCheck(g: InkGesture, surface: InkSurface, holdMs: number): void {
  const hold = g.hold;
  if (!hold || hold.shape || !g.builder || performance.now() - hold.at < holdMs) return;
  const points = g.builder.points;
  if (points.length < 4) return;
  const zoom = surface.cameraNow().zoom;
  const match = recognizeShape(points, { minSize: 16 / zoom, width: g.style.width });
  if (!match) return;
  hold.shape = match;
  drawShape(g, surface);
  announce(t('ink.shapes.made', { shape: match.shape.kind }));
}

function drawShape(g: InkGesture, surface: InkSurface): void {
  const shape = g.hold?.shape;
  if (shape) surface.drawLive(shape.points, g.style, true);
}

/** The stroke a shape makes: the shape's exact points, with no pressure, so the width stays even. */
function asShape(stroke: InkStroke, match: ShapeMatch): InkStroke {
  return { ...stroke, points: match.points.map((p) => ({ x: p.x, y: p.y })) };
}

async function finish(g: InkGesture, surface: InkSurface, host: InkHost): Promise<void> {
  if (g.builder) {
    let strokes = g.builder.finish();
    const shapes = getSettings().ink.shapes;
    const held = g.hold?.shape ?? null;
    if (strokes.length === 1 && isEnabled('ink.shapes')) {
      const zoom = surface.cameraNow().zoom;
      const match =
        held ??
        (shapes.inkToShape && g.style.tool !== 'highlighter'
          ? recognizeShape(strokes[0].points, { minSize: 16 / zoom, width: g.style.width })
          : null);
      if (match) strokes = [asShape(strokes[0], match)];
    }
    const pending = surface.add(strokes);
    surface.clearLive();
    await pending;
    return;
  }
  surface.clearLive();
  if (g.erase) {
    const ids = g.erase.commit();
    const gone = surface.strokes(ids);
    surface.endPreview();
    if (ids.length === 0) return;
    surface.hide(ids);
    const ok = await surface.send(
      { edits: [{ edit: 'removeStrokes', strokes: ids }], coalesce: { kind: 'erase', target: 'ink' } },
      () => surface.show(gone),
    );
    if (ok) announce(t('ink.announce.erased', { count: ids.length }));
  } else if (g.partial) {
    const tx = g.partial.commit();
    const gone = surface.strokes(tx.removed);
    surface.endPreview();
    if (tx.removed.length === 0 && tx.added.length === 0) return;
    surface.hide(tx.removed);
    surface.show(tx.added);
    const batch = {
      edits: tx.removed.length > 0 ? [{ edit: 'removeStrokes' as const, strokes: tx.removed }] : [],
      strokes: tx.added.length > 0 ? surface.records(tx.added) : undefined,
      coalesce: { kind: 'erase' as const, target: 'ink' },
    };
    await surface.send(batch, () => {
      surface.hide(tx.added.map((s) => s.id));
      surface.show(gone);
    });
  } else if (g.lasso) {
    finishLasso(g.lasso, surface, host);
  }
}

function cancel(g: InkGesture, surface: InkSurface): void {
  surface.clearLive();
  if (g.erase) g.erase.cancel();
  if (g.partial) g.partial.cancel();
  surface.endPreview();
}

// ---- touch ----

type Palm = typeof import('./palm');

/** The palm filter's settings: the stored ink settings, with the writing hand and finger choice as Settings sets them. */
function palmSettings(palm: Palm) {
  const ink = getSettings().ink;
  return { ...palm.palmSettingsFromInk(ink), handedness: ink.handedness, fingerDraw: ink.touch.finger };
}
const loadPalm = (): Promise<Palm> => import('./palm');

/** The touch tool: every touch on the page goes through the palm filter while an ink tool is active. */
export function createTouchTool(host: InkHost, surfaceOf: () => InkSurface | null) {
  const record: PointerRecord = {
    type: 'down',
    id: 0,
    kind: 'touch',
    t: 0,
    x: 0,
    y: 0,
    w: 0,
    h: 0,
    p: 0,
    tiltX: 0,
    tiltY: 0,
    buttons: 0,
    surface: 'page',
  };
  const snapshots = new Map<number, { left: number; top: number; zoom: number }>();
  const shown = new Map<number, TouchInk>();
  let pipeline: InkPipeline | null = null;
  let tick: ReturnType<typeof setInterval> | null = null;

  const fill = (event: PointerEvent, type: PointerRecord['type']) => {
    record.type = type;
    record.id = event.pointerId;
    record.kind = event.pointerType === 'pen' ? 'pen' : event.pointerType === 'touch' ? 'touch' : 'mouse';
    record.t = event.timeStamp;
    record.x = event.clientX;
    record.y = event.clientY;
    record.w = event.width;
    record.h = event.height;
    record.p = event.pressure;
    record.tiltX = event.tiltX;
    record.tiltY = event.tiltY;
    record.buttons = event.buttons;
    return record;
  };

  const redrawTouch = () => {
    const surface = surfaceOf();
    if (!surface) return;
    const ctx = surface.liveContext();
    if (!ctx) return;
    const style = styleOf(activeSlot());
    for (const ink of shown.values()) surface.drawLive(ink.builder.points, style);
  };

  // The palm filter is the largest part of ink input, so it loads in its own chunk, right after the ink view.
  let palm: Palm | null = null;
  void loadPalm().then((loaded) => (palm = loaded));
  const ensure = (): InkPipeline => {
    if (pipeline) return pipeline;
    const made = palm!.createInkPipeline(
      {
        penSample: () => undefined,
        touchBuilder: () => {
          const style = styleOf(activeSlot());
          return createStrokeBuilder({
            tool: style.tool,
            width: style.width,
            slot: style.slot,
            color: style.color,
            block: surfaceOf()?.layerFor() ?? '',
            newId: () => newId(),
            timeOrigin: Date.now() - performance.now(),
          });
        },
        toPage(r, out) {
          const at = host.viewport.get()?.toWorld(r.x, r.y) ?? { x: 0, y: 0 };
          out.x = at.x;
          out.y = at.y;
        },
        touchStroke(id, phase, ink) {
          const surface = surfaceOf();
          if (!surface) return;
          if (phase === 'show' || phase === 'point' || phase === 'hold') shown.set(id, ink);
          if (phase === 'retract') shown.delete(id);
          if (phase === 'commit') {
            shown.delete(id);
            if (ink.strokes) void surface.add(ink.strokes);
          }
          if (phase === 'uncommit' && ink.strokes) void surface.remove(ink.strokes.map((s) => s.id));
          redrawTouch();
        },
        camera(op, id, a, b, c) {
          const viewport = host.viewport.get();
          if (!viewport) return;
          const scroller = viewport.viewport;
          if (op === 'snapshot') {
            snapshots.set(id, { left: scroller.scrollLeft, top: scroller.scrollTop, zoom: viewport.camera().zoom });
          } else if (op === 'panBy') scroller.scrollBy({ left: -a, top: -b, behavior: 'instant' });
          else if (op === 'zoomAt') viewport.setZoom(viewport.camera().zoom * c, { x: a, y: b });
          else if (op === 'revert') {
            const at = snapshots.get(id);
            if (at) {
              viewport.setZoom(at.zoom);
              scroller.scrollTo({ left: at.left, top: at.top, behavior: 'instant' });
            }
          } else if (op === 'release') snapshots.delete(id);
        },
        tap: () => undefined,
        contextMenu: () => undefined,
        gesture(kind) {
          if (!isEnabled('ink.gestures')) return;
          const queue = host.queue.get();
          void (kind === 'undo' ? queue?.undo() : queue?.redo());
        },
        touchPolicy: () => undefined,
      },
      palmSettings(palm!),
      { platform: 'windows' },
    );
    made.setInkToolActive(true);
    pipeline = made;
    tick = setInterval(() => {
      if (made.needsTick()) made.tick(performance.now());
    }, 100);
    return made;
  };

  const inkActive = () => drawState.get().tool === 'pen' && isEnabled('ink.core');

  const tool: InkPointerTool = {
    id: 'ink.palm',
    priority: 100,
    accepts(event) {
      const surface = surfaceOf();
      return (
        event.pointerType === 'touch' &&
        !!surface &&
        !surface.readOnly &&
        inkActive() &&
        isEnabled('ink.palm') &&
        !!palm
      );
    },
    down(event, ctx) {
      ctx.capture(event.pointerId);
      focusPage(host.viewport.get()?.viewport);
      ensure().handle(fill(event, 'down'));
      return 'claim';
    },
    move(events) {
      const p = ensure();
      for (const event of events) p.handle(fill(event, 'move'));
      return 'claim';
    },
    up(event) {
      ensure().handle(fill(event, 'up'));
    },
    cancel() {
      pipeline?.system('blur', performance.now());
    },
  };

  /** Pen hover and contact tell the palm filter a pen is near, so touch under the hand never draws. */
  const onPen = (event: PointerEvent) => {
    if (event.pointerType !== 'pen' || !pipeline) return;
    const type =
      event.type === 'pointerdown'
        ? 'down'
        : event.type === 'pointerup'
          ? 'up'
          : event.type === 'pointerleave'
            ? 'leave'
            : 'move';
    pipeline.handle(fill(event, type));
  };
  const events = ['pointermove', 'pointerdown', 'pointerup'] as const;
  for (const type of events) window.addEventListener(type, onPen, { capture: true, passive: true });
  const onBlur = () => pipeline?.system('blur', performance.now());
  window.addEventListener('blur', onBlur);

  return {
    tool,
    /** Settings changed: the next touch builds a filter with the new ones. */
    reset() {
      pipeline = null;
      if (tick) clearInterval(tick);
      tick = null;
    },
    destroy() {
      for (const type of events) window.removeEventListener(type, onPen, { capture: true });
      window.removeEventListener('blur', onBlur);
      if (tick) clearInterval(tick);
      pipeline = null;
    },
  };
}
