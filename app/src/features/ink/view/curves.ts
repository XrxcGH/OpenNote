// Editable curves on the page: Make curve turns the one selected line, connector, shape, or ink stroke into a curve
// along the same path, and the curve commands add a point, remove one, and make one smooth or a corner. Each is one
// undo step. The selection bar, its right-click menu, the command palette, the Draw tab, and the keys on a focused
// curve point all come here (shapeEdit.ts draws the points and handles).
import { isEnabled } from '../../../app/flags';
import { t } from '../../../strings/t';
import { announce } from '../../../ui';
import { strokeKind } from '../edits/filters';
import {
  insertNode,
  isSmooth,
  nodeCount,
  removeNode,
  segmentCount,
  setSmooth,
  splineFromInk,
  toSpline,
} from '../geometry/shapes';
import type { Spline } from '../geometry/shapes';
import { pagePoints } from '../geometry/strokeIndex';
import { distance } from '../geometry/primitives';
import type { InkStroke } from '../model/types';
import type { InkHost } from './host';
import { activeCurvePoint, restroke, shapeHandles, shapeOfStroke } from './shapeEdit';
import type { InkSurface } from './surface';

export type CurveEdit = 'add' | 'remove' | 'toggle' | 'smooth' | 'corner';

/** The one selected stroke, when exactly one is and the page can be edited. */
function selectedStroke(host: InkHost, surface: InkSurface | null): InkStroke | null {
  if (!surface || surface.readOnly || !isEnabled('ink.splines')) return null;
  const ids = host.selection.get().strokes;
  if (ids.length !== 1 || host.selection.get().blocks.length > 0) return null;
  return surface.strokes(ids)[0] ?? null;
}

/** The selected curve, or null when the selection is not one curve. */
export function selectedCurve(host: InkHost, surface: InkSurface | null): { stroke: InkStroke; shape: Spline } | null {
  const stroke = selectedStroke(host, surface);
  const shape = stroke ? shapeOfStroke(stroke) : null;
  return stroke && shape?.kind === 'spline' ? { stroke, shape } : null;
}

/** True when Make curve has something to work on: one line, connector, shape, or ink stroke that is not a curve yet. */
export function canMakeCurve(host: InkHost, surface: InkSurface | null): boolean {
  const stroke = selectedStroke(host, surface);
  if (!stroke || stroke.tool === 'highlighter') return false;
  if (strokeKind(stroke) === 'ink') return stroke.points.length >= 2;
  const shape = shapeOfStroke(stroke);
  return shape !== null && shape.kind !== 'spline';
}

/** Swaps a stroke for its new form in one undo step and keeps it selected. */
async function swap(host: InkHost, surface: InkSurface, old: InkStroke, made: InkStroke): Promise<boolean> {
  const layer = shapeHandles();
  if (layer?.current()?.stroke.id === old.id) return layer.replaceWith(old, made, focusedHandle(surface));
  const ok = await surface.replace({ remove: [old.id], add: [made] });
  if (ok) host.select({ strokes: [made.id], blocks: [] });
  return ok;
}

/** The curve point handle that has focus, so focus comes back to it after the edit. */
function focusedHandle(surface: InkSurface): string | undefined {
  const active = surface.chrome.ownerDocument.activeElement as HTMLElement | null;
  return active?.dataset?.inkShapeHandle;
}

/** Make curve: the selection as a curve along the same path. Freehand ink keeps its path to within its width. */
export async function makeCurve(host: InkHost, surface: InkSurface | null): Promise<void> {
  const stroke = selectedStroke(host, surface);
  if (!surface || !stroke || !canMakeCurve(host, surface)) {
    announce(t('ink.curves.cannot'));
    return;
  }
  const shape = strokeKind(stroke) === 'ink' ? null : shapeOfStroke(stroke);
  const curve = shape ? toSpline(shape) : splineFromInk(pagePoints(stroke));
  if (!curve) {
    announce(t('ink.curves.cannot'));
    return;
  }
  const made = restroke(stroke, curve);
  activeCurvePoint.set({ stroke: made.id, index: 0 });
  if (await swap(host, surface, stroke, made)) announce(t('ink.curves.made'));
}

/** The point the commands act on: the one last pressed or focused, or else the middle one. */
function activeIndex(stroke: InkStroke, shape: Spline): number {
  const active = activeCurvePoint.get();
  const n = nodeCount(shape);
  return active && active.stroke === stroke.id && active.index < n ? active.index : Math.floor((n - 1) / 2);
}

/** The segment a new point goes on: the one after the active point, or the longest when none was chosen. */
function segmentForNew(stroke: InkStroke, shape: Spline): number {
  const active = activeCurvePoint.get();
  const count = segmentCount(shape);
  if (active && active.stroke === stroke.id) return Math.min(active.index, count - 1);
  let best = 0;
  let longest = -1;
  for (let s = 0; s < count; s++) {
    const length = distance(shape.controls[3 * s], shape.controls[3 * s + 3]);
    if (length > longest) [best, longest] = [s, length];
  }
  return best;
}

/** Adds, removes, or changes a point of the selected curve. */
export async function editCurve(host: InkHost, surface: InkSurface | null, what: CurveEdit): Promise<void> {
  const selected = selectedCurve(host, surface);
  if (!surface || !selected) {
    announce(t('ink.curves.cannot'));
    return;
  }
  const { stroke, shape } = selected;
  const k = activeIndex(stroke, shape);
  let next: Spline;
  let index = k;
  let message: string;
  if (what === 'add') {
    const s = segmentForNew(stroke, shape);
    next = insertNode(shape, s, 0.5);
    index = s + 1;
    message = t('ink.curves.added', { count: nodeCount(next) });
  } else if (what === 'remove') {
    next = removeNode(shape, k);
    if (next === shape) {
      announce(t('ink.curves.lastPoints'));
      return;
    }
    index = Math.max(0, Math.min(k, nodeCount(next) - 1) - (k > 0 ? 1 : 0));
    message = t('ink.curves.removed', { count: nodeCount(next) });
  } else {
    const smooth = what === 'toggle' ? !isSmooth(shape, k) : what === 'smooth';
    next = setSmooth(shape, k, smooth);
    message = t(smooth ? 'ink.curves.nowSmooth' : 'ink.curves.nowCorner', { index: k + 1 });
  }
  if (next === shape) return;
  const made = restroke(stroke, next);
  activeCurvePoint.set({ stroke: made.id, index });
  const layer = shapeHandles();
  const refocus = focusedHandle(surface) !== undefined ? `n${index}` : undefined;
  const ok =
    layer?.current()?.stroke.id === stroke.id
      ? await layer.replaceWith(stroke, made, refocus)
      : await swap(host, surface, stroke, made);
  if (ok) announce(message);
}
