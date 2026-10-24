// Editable shapes and attached connectors, on the page. A snapped shape is an ordinary stroke of exact points, so its
// handles come from reading the points back. Dragging a handle swaps the stroke for the reshaped one in one undo step.
// A connector whose end touches a shape's outline stays attached: when the shape moves, resizes, or is reshaped, the
// connector's end goes with it, in the same step.
import { newId } from '../../../editor/ids';
import { t } from '../../../strings/t';
import { isEnabled } from '../../../app/flags';
import { strokeKind } from '../edits/filters';
import { applyToPoint, widthScale } from '../geometry/matrix';
import {
  shapePoints,
  recognizeShape,
  dragHandle,
  handlesOf,
  endsOf,
  isConnector,
  moveEnd,
  nearestOnOutline,
  isSmooth,
  nodeCount,
  readSpline,
} from '../geometry/shapes';
import type { Shape, Spline } from '../geometry/shapes';
import { createStore } from '../../../state/store';
import { pagePoints } from '../geometry/strokeIndex';
import { strokeBounds } from '../geometry/bounds';
import type { Matrix, Vec } from '../geometry/types';
import type { InkStroke } from '../model/types';
import type { InkHost, InkPointerTool } from './host';
import type { Follow, InkSurface } from './surface';
import type { Store } from '../../../state/store';
import { snapPoint } from '../snap';
import { clearSnapMarks, paperSnapNow, showSnapMarks } from './paperSnap';

/** How near a connector's end must lie to a shape's outline to count as attached, in page units. */
export const ATTACH_REACH = 5;
/** How near a new connector's end must be drawn to a shape for the end to snap onto its outline, in screen pixels. */
const SNAP_PX = 14;
const HANDLE_PX = 22;

/** The shape a stroke holds, read back from its points, or null for ink and for shapes that have no handles. */
export function shapeOfStroke(stroke: InkStroke): Shape | null {
  if (strokeKind(stroke) !== 'shape') return null;
  const points = pagePoints(stroke);
  if (points.length < 2) return null;
  const [a, b] = points;
  if (points.length === 2) return { kind: 'line', from: a, to: b };
  const scale = stroke.transform ? widthScale(stroke.transform) : 1;
  // A curve is read first: it starts on a doubled point, which no other shape does.
  const curve = readSpline(points, 0.06 * Math.max(1, scale));
  if (curve) return curve;
  return recognizeShape(points, { minSize: 1, width: stroke.width * scale, extra: true })?.shape ?? null;
}

/** The point of the selected curve that its commands act on: the one last pressed or focused, by stroke. */
export const activeCurvePoint = createStore<{ stroke: string; index: number } | null>(null, 'ink active curve point');

/** The arrow keys' steps, for moving a focused curve point or handle, in page units. */
const KEY_STEPS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};
const CURVE_HANDLE_PX = 14;

/** The accessible name of a curve's point or handle. */
function curveLabel(shape: Spline, id: string): string {
  const index = Number(id.slice(1)) + 1;
  if (id.startsWith('i')) return t('ink.curves.handleIn', { index });
  if (id.startsWith('o')) return t('ink.curves.handleOut', { index });
  const kind = isSmooth(shape, index - 1) ? t('ink.curves.pointSmooth') : t('ink.curves.pointCorner');
  return t('ink.curves.point', { index, count: nodeCount(shape), kind });
}

/** The stroke for a reshaped shape, in the style of the one it replaces. */
export function restroke(old: InkStroke, shape: Shape, id: string = newId()): InkStroke {
  const scale = old.transform ? widthScale(old.transform) : 1;
  const { transform: _transform, ...rest } = old;
  return {
    ...rest,
    id,
    width: old.width * scale,
    points: shapePoints(shape).map((p) => ({ x: p.x, y: p.y })),
  };
}

/** The outline of a shape stroke, in page units. */
const outlineOf = (stroke: InkStroke): readonly Vec[] => pagePoints(stroke);

/**
 * The connectors attached to the shapes in `moved`, with the strokes that replace them. `next` says where an attached
 * end goes, given where it was and the shape it was attached to. A connector that is itself in `moved` is left alone.
 */
export function connectorFollowers(
  surface: InkSurface,
  moved: readonly InkStroke[],
  next: (end: Vec, shape: InkStroke) => Vec,
): Follow {
  const shapes = moved.filter((stroke) => strokeKind(stroke) === 'shape');
  if (shapes.length === 0) return { remove: [], add: [] };
  const ids = new Set(moved.map((stroke) => stroke.id));
  const first = shapes.map(strokeBounds).reduce((a, b) => ({
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  }));
  const reach = ATTACH_REACH;
  const near = surface.index.query({
    minX: first.minX - reach,
    minY: first.minY - reach,
    maxX: first.maxX + reach,
    maxY: first.maxY + reach,
  }) as InkStroke[];
  const remove: string[] = [];
  const add: InkStroke[] = [];
  for (const candidate of near) {
    if (ids.has(candidate.id)) continue;
    const shape = shapeOfStroke(candidate);
    const ends = shape && isConnector(shape) ? endsOf(shape) : null;
    if (!shape || !ends) continue;
    let changed: Shape = shape;
    for (const which of ['start', 'end'] as const) {
      const end = ends[which];
      const onto = shapes.find((one) => nearestOnOutline(outlineOf(one), end, reach) !== null);
      if (onto) changed = moveEnd(changed, which, next(end, onto));
    }
    if (changed !== shape) {
      remove.push(candidate.id);
      add.push(restroke(candidate, changed));
    }
  }
  return { remove, add };
}

/** Followers for strokes moved, resized, or turned by a matrix: an attached end goes where the matrix takes it. */
export function followersForMatrix(surface: InkSurface, ids: readonly string[], matrix: Matrix): Follow {
  if (!isEnabled('ink.shapeTools')) return { remove: [], add: [] };
  return connectorFollowers(surface, surface.strokes(ids), (end) => applyToPoint(matrix, end));
}

/** Snaps the ends of a new connector onto the outline of any shape they come close to. */
export function snapConnector(shape: Shape, surface: InkSurface): Shape {
  if (!isEnabled('ink.shapeTools') || !isConnector(shape)) return shape;
  const ends = endsOf(shape);
  if (!ends) return shape;
  const reach = SNAP_PX / surface.cameraNow().zoom;
  let result = shape;
  for (const which of ['start', 'end'] as const) {
    const end = ends[which];
    const box = { minX: end.x - reach, minY: end.y - reach, maxX: end.x + reach, maxY: end.y + reach };
    let best: Vec | null = null;
    let bestDistance = reach;
    for (const stroke of surface.index.query(box) as InkStroke[]) {
      if (strokeKind(stroke) !== 'shape') continue;
      const kind = shapeOfStroke(stroke);
      if (!kind || isConnector(kind)) continue;
      const hit = nearestOnOutline(outlineOf(stroke), end, bestDistance);
      if (!hit) continue;
      best = hit;
      bestDistance = Math.hypot(hit.x - end.x, hit.y - end.y);
    }
    if (best) result = moveEnd(result, which, best);
  }
  return result;
}

/** The handles of the one shape that is selected, as buttons in the page's chrome. */
class HandleLayer {
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly stops: (() => void)[];
  /** The shape being edited and the stroke it came from. */
  private editing: { stroke: InkStroke; shape: Shape } | null = null;
  /** The lines from a curve's points to their handles. */
  private arms: SVGSVGElement | null = null;
  /** Where focus goes back to after the handles are made again, by handle ID. */
  private refocus: string | null = null;
  drag: { id: string; pointerId: number } | null = null;

  constructor(
    private readonly host: InkHost,
    private readonly surface: InkSurface,
  ) {
    this.stops = [host.selection.subscribe(() => this.refresh()), surface.onChange(() => this.changed())];
    this.refresh();
  }

  /**
   * The page changed: when the selected shape was moved or nudged its stroke is a new one, so its handles are read
   * again from where it is now. Otherwise they only follow the view.
   */
  private changed(): void {
    const ids = this.host.selection.get().strokes;
    const now = !this.drag && this.editing && ids.length === 1 ? this.surface.strokes(ids)[0] : undefined;
    if (now && now !== this.editing?.stroke) this.refresh();
    else this.place();
  }

  buttonOf(target: EventTarget | null): HTMLButtonElement | null {
    return this.buttons.find((button) => target instanceof Node && button.contains(target)) ?? null;
  }

  private refresh(): void {
    if (this.drag) return;
    const focused = this.buttons.find((b) => b === b.ownerDocument.activeElement)?.dataset.inkShapeHandle;
    this.buttons.splice(0).forEach((button) => button.remove());
    this.arms?.remove();
    this.arms = null;
    this.editing = null;
    this.refocus = focused ?? this.refocus;
    const selection = this.host.selection.get();
    if (!isEnabled('ink.shapeTools') || this.surface.readOnly || selection.strokes.length !== 1) return;
    const stroke = this.surface.strokes(selection.strokes)[0];
    const shape = stroke ? shapeOfStroke(stroke) : null;
    if (!stroke || !shape || (shape.kind === 'spline' && !isEnabled('ink.splines'))) return;
    this.editing = { stroke, shape };
    const doc = this.surface.chrome.ownerDocument;
    if (shape.kind === 'spline') {
      this.arms = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
      this.arms.dataset.inkCurveArms = '';
      this.arms.setAttribute('aria-hidden', 'true');
      Object.assign(this.arms.style, {
        position: 'absolute',
        left: '0',
        top: '0',
        width: '100%',
        height: '100%',
        overflow: 'visible',
        pointerEvents: 'none',
        zIndex: 'var(--layer-page-chrome)',
      });
      this.surface.chrome.append(this.arms);
      const active = activeCurvePoint.get();
      if (active && active.stroke !== stroke.id) activeCurvePoint.set(null);
    }
    for (const handle of handlesOf(shape)) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.dataset.inkShapeHandle = handle.id;
      const curve = shape.kind === 'spline' ? shape : null;
      const node = curve !== null && handle.id.startsWith('n');
      const size = curve && !node ? CURVE_HANDLE_PX : HANDLE_PX;
      button.setAttribute('aria-label', curve ? curveLabel(curve, handle.id) : t('ink.library.handle'));
      if (node) {
        button.dataset.inkCurvePoint = handle.id.slice(1);
        button.setAttribute('aria-keyshortcuts', 'Delete Insert S');
        button.addEventListener('focus', () => this.activate(Number(handle.id.slice(1))));
      }
      if (curve) button.addEventListener('keydown', (event) => this.onCurveKey(event, handle.id));
      Object.assign(button.style, {
        position: 'absolute',
        width: `${size}px`,
        height: `${size}px`,
        borderRadius: curve && !node ? '2px' : '50%',
        transform: curve && !node ? 'rotate(45deg)' : '',
        border: '2px solid var(--color-accent-primary)',
        background: 'var(--color-surface-page)',
        pointerEvents: 'auto',
        cursor: 'crosshair',
        touchAction: 'none',
        zIndex: 'var(--layer-page-chrome)',
      });
      this.surface.chrome.append(button);
      this.buttons.push(button);
    }
    this.markActive();
    this.place();
  }

  /** Makes point `index` of the curve the one its commands act on. */
  activate(index: number): void {
    const stroke = this.editing?.stroke;
    if (!stroke || this.editing?.shape.kind !== 'spline') return;
    activeCurvePoint.set({ stroke: stroke.id, index });
    this.markActive();
  }

  /** Fills the active point's handle, so the point the commands act on shows. */
  private markActive(): void {
    const active = activeCurvePoint.get();
    for (const button of this.buttons) {
      const point = button.dataset.inkCurvePoint;
      if (point === undefined) continue;
      const on = active !== null && active.stroke === this.editing?.stroke.id && Number(point) === active.index;
      button.style.background = on ? 'var(--color-accent-primary)' : 'var(--color-surface-page)';
      button.setAttribute('aria-pressed', String(on));
    }
  }

  /** Keys on a focused curve point or handle: arrows move it, Delete removes the point, Insert adds one, S toggles. */
  private onCurveKey(event: KeyboardEvent, id: string): void {
    const shape = this.editing?.shape;
    if (!shape || shape.kind !== 'spline') return;
    const step = KEY_STEPS[event.key];
    const at = handlesOf(shape).find((h) => h.id === id)?.at;
    let run: (() => unknown) | null = null;
    if (step && at) {
      const by = event.shiftKey ? 10 : 1;
      run = () => this.commit(id, { x: at.x + step[0] * by, y: at.y + step[1] * by }, true, id);
    } else if (id.startsWith('n') && (event.key === 'Delete' || event.key === 'Backspace')) {
      run = () => curveCommand?.('remove');
    } else if (id.startsWith('n') && (event.key === 'Insert' || event.key === '+')) {
      run = () => curveCommand?.('add');
    } else if (id.startsWith('n') && event.key.toLowerCase() === 's' && !event.ctrlKey && !event.metaKey) {
      run = () => curveCommand?.('toggle');
    }
    if (!run) return;
    event.preventDefault();
    event.stopPropagation();
    void run();
  }

  place(shape: Shape | undefined = this.editing?.shape): void {
    if (!this.editing || !shape) return;
    const { zoom, scrollX, scrollY } = this.surface.cameraNow();
    const handles = handlesOf(shape);
    const curve = shape.kind === 'spline';
    this.buttons.forEach((button, i) => {
      const handle = handles.find((h) => h.id === button.dataset.inkShapeHandle) ?? handles[i];
      if (!handle) return;
      const size = curve && !handle.id.startsWith('n') ? CURVE_HANDLE_PX : HANDLE_PX;
      button.style.left = `${handle.at.x * zoom - scrollX - size / 2}px`;
      button.style.top = `${handle.at.y * zoom - scrollY - size / 2}px`;
    });
    if (this.arms && shape.kind === 'spline') {
      this.drawArms(shape, (p) => [p.x * zoom - scrollX, p.y * zoom - scrollY]);
    }
    if (this.refocus) {
      const again = this.buttons.find((b) => b.dataset.inkShapeHandle === this.refocus);
      this.refocus = null;
      again?.focus({ preventScroll: true });
    }
  }

  /** The thin lines from each curve point to its handles, in the chrome's own pixels. */
  private drawArms(shape: Spline, toScreen: (p: Vec) => [number, number]): void {
    const arms = this.arms!;
    const handles = handlesOf(shape);
    const points = new Map(handles.filter((h) => h.id.startsWith('n')).map((h) => [h.id.slice(1), h.at]));
    let d = '';
    for (const handle of handles) {
      if (handle.id.startsWith('n')) continue;
      const node = points.get(handle.id.slice(1));
      if (!node) continue;
      const [x1, y1] = toScreen(node);
      const [x2, y2] = toScreen(handle.at);
      d += `M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`;
    }
    let path = arms.firstElementChild as SVGPathElement | null;
    if (!path) {
      path = arms.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'var(--color-accent-primary)');
      path.setAttribute('stroke-width', '1.5');
      arms.append(path);
    }
    path.setAttribute('d', d);
  }

  /**
   * Where a dragged handle goes: onto the paper's lines when they are near and snapping is on, unless Alt is held. The
   * handles of arcs only turn their ends, so they are left free.
   */
  private snapped(to: Vec, alt: boolean, linger = false, id?: string): Vec {
    const snap = paperSnapNow(this.surface.cameraNow().zoom, alt);
    const kind = this.editing?.shape.kind;
    const curveHandle = kind === 'spline' && id !== undefined && !id.startsWith('n');
    if (!snap || kind === 'arc' || kind === 'curvedArrow' || curveHandle) {
      clearSnapMarks(this.surface);
      return to;
    }
    const hit = snapPoint(snap, to);
    showSnapMarks(this.surface, hit.x || hit.y ? [hit.point] : [], linger);
    return hit.point;
  }

  /** Drags a handle to a page point: the reshaped stroke shows, and the connectors on its outline follow it. */
  moveTo(id: string, at: Vec, alt = false): void {
    if (!this.editing) return;
    const { stroke, shape } = this.editing;
    const to = this.snapped(at, alt, false, id);
    const reshaped = dragHandle(shape, id, to);
    const next = restroke(stroke, reshaped, `${stroke.id}`);
    const followers = this.followers(stroke, next);
    this.surface.preview([stroke.id, ...followers.remove], [next, ...followers.add]);
    this.place(reshaped);
  }

  private followers(old: InkStroke, next: InkStroke): Follow {
    const outline = pagePoints(next);
    return connectorFollowers(this.surface, [old], (end) => nearestOnOutline(outline, end, Infinity) ?? end);
  }

  async commit(id: string, at: Vec, alt = false, refocus?: string): Promise<void> {
    if (!this.editing) return;
    const { stroke, shape } = this.editing;
    const to = this.snapped(at, alt, true, id);
    const made = restroke(stroke, dragHandle(shape, id, to));
    await this.replaceWith(stroke, made, refocus);
  }

  /** Swaps the edited stroke for `made` in one undo step, with the connectors on its outline, and selects it. */
  async replaceWith(stroke: InkStroke, made: InkStroke, refocus?: string): Promise<boolean> {
    const followers = this.followers(stroke, made);
    this.surface.endPreview();
    const ok = await this.surface.replace({ remove: [stroke.id, ...followers.remove], add: [made, ...followers.add] });
    this.drag = null;
    const active = activeCurvePoint.get();
    if (ok && active?.stroke === stroke.id) activeCurvePoint.set({ ...active, stroke: made.id });
    if (refocus) this.refocus = refocus;
    if (ok) this.host.select({ strokes: [made.id], blocks: [] });
    else this.refresh();
    return ok;
  }

  /** The stroke and shape being edited, for curve commands. */
  current(): { stroke: InkStroke; shape: Shape } | null {
    return this.editing;
  }

  cancel(): void {
    this.drag = null;
    this.surface.endPreview();
    clearSnapMarks(this.surface);
    this.refresh();
  }

  destroy(): void {
    this.stops.forEach((stop) => stop());
    this.buttons.forEach((button) => button.remove());
    this.arms?.remove();
  }
}

/** Runs a curve command on the active point, for the keys on a focused curve point (more.ts sets it). */
let curveCommand: ((what: 'add' | 'remove' | 'toggle') => unknown) | null = null;
export function setCurveCommand(run: typeof curveCommand): void {
  curveCommand = run;
}

/** The handle layer on the shown page, for the curve commands (curves.ts). */
let shown: HandleLayer | null = null;
export const shapeHandles = (): HandleLayer | null => shown;
export type { HandleLayer };

/** The pointer tool for shape handles. */
export function installShapeHandles(host: InkHost, surfaces: Store<InkSurface | null>): () => void {
  let layer: HandleLayer | null = null;
  let last: Vec | null = null;
  /** Alt held during the drag keeps the handle off the paper's lines. */
  let alt = false;
  const sync = () => {
    layer?.destroy();
    const surface = surfaces.get();
    layer = surface ? new HandleLayer(host, surface) : null;
    shown = layer;
  };
  const stopSurface = surfaces.subscribe(sync);
  sync();
  const tool: InkPointerTool = {
    id: 'ink.shapeHandles',
    // Above the palm filter (100), so a finger can drag a handle too.
    priority: 106,
    accepts: (event) => layer !== null && layer.buttonOf(event.target) !== null,
    down(event, ctx) {
      const button = layer?.buttonOf(event.target);
      if (!layer || !button?.dataset.inkShapeHandle) return 'watch';
      // One handle at a time: a second contact, such as the heel of the hand, is held but moves nothing.
      if (layer.drag) return 'claim';
      ctx.capture(event.pointerId);
      layer.drag = { id: button.dataset.inkShapeHandle, pointerId: event.pointerId };
      if (button.dataset.inkCurvePoint !== undefined) layer.activate(Number(button.dataset.inkCurvePoint));
      last = ctx.toWorld(event.clientX, event.clientY);
      alt = event.altKey;
      return 'claim';
    },
    move(events, ctx) {
      const event = events.filter((one) => one.pointerId === layer?.drag?.pointerId).at(-1);
      if (layer?.drag && event) {
        last = ctx.toWorld(event.clientX, event.clientY);
        alt ||= event.altKey;
        layer.moveTo(layer.drag.id, last, alt);
      }
      return 'claim';
    },
    up(event) {
      const drag = layer?.drag;
      if (!layer || !drag || drag.pointerId !== event.pointerId) return;
      alt ||= event.altKey;
      if (last) void layer.commit(drag.id, last, alt);
    },
    cancel(_ctx, event) {
      if (event && layer?.drag && event.pointerId !== layer.drag.pointerId) return;
      layer?.cancel();
    },
  };
  const stopTool = host.registerPointerTool(tool);
  return () => {
    stopTool();
    stopSurface();
    layer?.destroy();
    layer = null;
    shown = null;
  };
}
