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
} from '../geometry/shapes';
import type { Shape } from '../geometry/shapes';
import { pagePoints } from '../geometry/strokeIndex';
import { strokeBounds } from '../geometry/bounds';
import type { Matrix, Vec } from '../geometry/types';
import type { InkStroke } from '../model/types';
import type { InkHost, InkPointerTool } from './host';
import type { Follow, InkSurface } from './surface';
import type { Store } from '../../../state/store';

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
  return recognizeShape(points, { minSize: 1, width: stroke.width * scale, extra: true })?.shape ?? null;
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
  drag: { id: string; pointerId: number } | null = null;

  constructor(
    private readonly host: InkHost,
    private readonly surface: InkSurface,
  ) {
    this.stops = [host.selection.subscribe(() => this.refresh()), surface.onChange(() => this.place())];
    this.refresh();
  }

  buttonOf(target: EventTarget | null): HTMLButtonElement | null {
    return this.buttons.find((button) => target instanceof Node && button.contains(target)) ?? null;
  }

  private refresh(): void {
    if (this.drag) return;
    this.buttons.splice(0).forEach((button) => button.remove());
    this.editing = null;
    const selection = this.host.selection.get();
    if (!isEnabled('ink.shapeTools') || this.surface.readOnly || selection.strokes.length !== 1) return;
    const stroke = this.surface.strokes(selection.strokes)[0];
    const shape = stroke ? shapeOfStroke(stroke) : null;
    if (!stroke || !shape) return;
    this.editing = { stroke, shape };
    const doc = this.surface.chrome.ownerDocument;
    for (const handle of handlesOf(shape)) {
      const button = doc.createElement('button');
      button.type = 'button';
      button.dataset.inkShapeHandle = handle.id;
      button.setAttribute('aria-label', t('ink.library.handle'));
      Object.assign(button.style, {
        position: 'absolute',
        width: `${HANDLE_PX}px`,
        height: `${HANDLE_PX}px`,
        borderRadius: '50%',
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
    this.place();
  }

  place(): void {
    if (!this.editing) return;
    const { zoom, scrollX, scrollY } = this.surface.cameraNow();
    const handles = handlesOf(this.editing.shape);
    this.buttons.forEach((button, i) => {
      const at = handles[i]?.at;
      if (!at) return;
      button.style.left = `${at.x * zoom - scrollX - HANDLE_PX / 2}px`;
      button.style.top = `${at.y * zoom - scrollY - HANDLE_PX / 2}px`;
    });
  }

  /** Drags a handle to a page point: the reshaped stroke shows, and the connectors on its outline follow it. */
  moveTo(id: string, to: Vec): void {
    if (!this.editing) return;
    const { stroke, shape } = this.editing;
    const next = restroke(stroke, dragHandle(shape, id, to), `${stroke.id}`);
    const followers = this.followers(stroke, next);
    this.surface.preview([stroke.id, ...followers.remove], [next, ...followers.add]);
    this.place();
  }

  private followers(old: InkStroke, next: InkStroke): Follow {
    const outline = pagePoints(next);
    return connectorFollowers(this.surface, [old], (end) => nearestOnOutline(outline, end, Infinity) ?? end);
  }

  async commit(id: string, to: Vec): Promise<void> {
    if (!this.editing) return;
    const { stroke, shape } = this.editing;
    const made = restroke(stroke, dragHandle(shape, id, to));
    const followers = this.followers(stroke, made);
    this.surface.endPreview();
    const ok = await this.surface.replace({ remove: [stroke.id, ...followers.remove], add: [made, ...followers.add] });
    this.drag = null;
    if (ok) this.host.select({ strokes: [made.id], blocks: [] });
    else this.refresh();
  }

  cancel(): void {
    this.drag = null;
    this.surface.endPreview();
    this.refresh();
  }

  destroy(): void {
    this.stops.forEach((stop) => stop());
    this.buttons.forEach((button) => button.remove());
  }
}

/** The pointer tool for shape handles. */
export function installShapeHandles(host: InkHost, surfaces: Store<InkSurface | null>): () => void {
  let layer: HandleLayer | null = null;
  let last: Vec | null = null;
  const sync = () => {
    layer?.destroy();
    const surface = surfaces.get();
    layer = surface ? new HandleLayer(host, surface) : null;
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
      ctx.capture(event.pointerId);
      layer.drag = { id: button.dataset.inkShapeHandle, pointerId: event.pointerId };
      last = ctx.toWorld(event.clientX, event.clientY);
      return 'claim';
    },
    move(events, ctx) {
      const event = events.at(-1);
      if (layer?.drag && event) {
        last = ctx.toWorld(event.clientX, event.clientY);
        layer.moveTo(layer.drag.id, last);
      }
      return 'claim';
    },
    up() {
      if (layer?.drag && last) void layer.commit(layer.drag.id, last);
    },
    cancel() {
      layer?.cancel();
    },
  };
  const stopTool = host.registerPointerTool(tool);
  return () => {
    stopTool();
    stopSurface();
    layer?.destroy();
    layer = null;
  };
}
