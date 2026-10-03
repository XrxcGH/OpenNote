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
import { createStrokeBuilder } from '../input/strokeBuilder';
import type { StrokeBuilder } from '../input/strokeBuilder';
import type { RawSample } from '../input/samples';
import type { InkStroke } from '../model/types';
import { mmToPage } from '../pens/tools';
import { brandColor } from './paint';
import type { InkHost, InkPointerTool, InkRouterContext } from './host';
import { finishLasso, startLasso } from './lasso';
import type { LassoGesture } from './lasso';
import { activeSlot, drawState, styleOf } from './state';
import type { PenStyle } from './state';
import type { InkSurface } from './surface';
import { focusPage } from './touch';

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
  lastX: number;
  lastY: number;
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
      // pointerrawupdate and the router's moves bring the same samples: skip what came already, by time and place.
      const seen = event.timeStamp === g.lastTime && event.clientX === g.lastX && event.clientY === g.lastY;
      if (event.pointerId !== g.pointerId || event.timeStamp < g.lastTime || seen) continue;
      g.lastTime = event.timeStamp;
      g.lastX = event.clientX;
      g.lastY = event.clientY;
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
  const g: InkGesture = {
    mode,
    pointerId: event.pointerId,
    style,
    release,
    lastTime: -Infinity,
    lastX: NaN,
    lastY: NaN,
    radius: 0,
  };
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
  ctx.strokeStyle = brandColor('ink', surface.scheme());
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
