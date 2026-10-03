// "Export selection" (FEATURES.md, Phase 6): lasso an area and find what it holds. A smart selection grows to take in
// the whole strokes, text boxes, and images that the lasso only touches, and trims the empty margin around them. An
// exact selection keeps the lasso's own area. Either way the result says which items are in and what area to crop.

import { inkExtent, strokeShape, type Placements } from '../export/ink';
import type { ExportBlock, ExportPage, ExportStroke } from '../export/source';
import { round2 } from '../layout/json';
import type { Rect } from '../pagination/geometry';
import { rotatedBounds } from '../print/prepare';
import type { Point } from '../zoom/transform';
import { boxOfPoints, boxesTouch, growBox, pathTouches, rectTouchesPolygon, unionBox, type Lasso } from './geometry';

export type SelectMode = 'smart' | 'exact';

export interface SelectContext {
  /**
   * The measured box of blocks on the page, in page units. Flowing blocks have no frame, and a text box has no height,
   * so the view supplies the boxes it laid out.
   */
  readonly boxes?: ReadonlyMap<string, Rect>;
  /** Where each ink block's origin sits when it is not at its frame. */
  readonly placements?: Placements;
  /** Blocks to leave out, such as ink on a hidden or locked layer. */
  readonly skip?: ReadonlySet<string>;
}

export interface SelectOptions extends SelectContext {
  /** `smart` (the default) grows to whole items and trims; `exact` keeps the lasso's box. */
  readonly mode?: SelectMode;
  /** Space around the content in the crop, in page units. Default 12. */
  readonly padding?: number;
  /** The smallest crop, in page units. Default 96 (one inch), so a selection of one dot is still a page. */
  readonly minSize?: number;
}

export interface Selection {
  readonly mode: SelectMode;
  /** The IDs of the selected blocks that are not ink, in page order. */
  readonly blocks: readonly string[];
  /** The IDs of the selected strokes. */
  readonly strokes: readonly string[];
  /** The box of the content (smart) or of the lasso (exact). */
  readonly bounds: Rect;
  /** The area to export: `bounds` with padding, at least `minSize` each way. */
  readonly crop: Rect;
  /** The lasso itself in exact mode, so a picture can be clipped to it. Null in smart mode. */
  readonly clip: Lasso | null;
}

export const DEFAULT_PADDING = 12;
export const MIN_CROP = 96;
/** The size of a floating block that has no measured box and no size in its frame. */
const UNSIZED = { w: 300, h: 24 } as const;

/** The box of a block on the page, or null when the block has no place (a flowing block that was not measured). */
export function blockBox(block: ExportBlock, boxes?: ReadonlyMap<string, Rect>): Rect | null {
  const frame = block.frame;
  const measured = boxes?.get(block.id);
  const box =
    measured ??
    (frame?.x !== undefined && frame.y !== undefined
      ? { x: frame.x, y: frame.y, w: frame.w ?? UNSIZED.w, h: frame.h ?? UNSIZED.h }
      : null);
  return box ? rotatedBounds(box, frame?.rotate ?? 0) : null;
}

/** Where an ink block's origin sits on the page. */
export function inkOrigin(page: ExportPage, block: string, placements?: Placements): Point {
  const placed = placements?.get(block);
  if (placed) return placed;
  const frame = page.blocks.find((b) => b.id === block)?.frame;
  return { x: frame?.x ?? 0, y: frame?.y ?? 0 };
}

/** The stroke's points on the page: through its transform and its block's origin. */
export function strokeLine(stroke: ExportStroke, origin: Point): Point[] {
  const [a, b, c, d, e, f] = stroke.transform ?? [1, 0, 0, 1, 0, 0];
  const out: Point[] = [];
  for (let i = 0; i < stroke.x.length && i < stroke.y.length; i += 1) {
    out.push({
      x: a * stroke.x[i] + c * stroke.y[i] + e + origin.x,
      y: b * stroke.x[i] + d * stroke.y[i] + f + origin.y,
    });
  }
  return out;
}

function roundBox(r: Rect): Rect {
  return { x: round2(r.x), y: round2(r.y), w: round2(r.w), h: round2(r.h) };
}

/** `bounds` with padding, never smaller than `min` each way, around the same center. */
export function cropOf(bounds: Rect, padding: number, min: number): Rect {
  const grown = growBox(bounds, padding);
  const w = Math.max(grown.w, min);
  const h = Math.max(grown.h, min);
  return roundBox({ x: grown.x - (w - grown.w) / 2, y: grown.y - (h - grown.h) / 2, w, h });
}

/**
 * What a lasso selects, or null when it touches nothing. A block or stroke is in when the lasso touches it at all, so
 * a stroke that only crosses the lasso's edge is taken whole.
 */
export function selectArea(page: ExportPage, lasso: Lasso, options: SelectOptions = {}): Selection | null {
  if (lasso.length < 3) return null;
  const mode = options.mode ?? 'smart';
  const lassoBox = boxOfPoints(lasso)!;
  const skip = options.skip ?? new Set<string>();
  let content: Rect | null = null;

  const blocks: string[] = [];
  for (const block of page.blocks) {
    if (block.type === 'ink' || skip.has(block.id)) continue;
    const box = blockBox(block, options.boxes);
    if (!box || !rectTouchesPolygon(box, lasso)) continue;
    blocks.push(block.id);
    content = unionBox(content, box);
  }

  const strokes: string[] = [];
  const shapes = [];
  for (const stroke of page.strokes) {
    if (skip.has(stroke.block)) continue;
    const origin = inkOrigin(page, stroke.block, options.placements);
    const line = strokeLine(stroke, origin);
    const reach = boxOfPoints(line);
    if (!reach || !boxesTouch(growBox(reach, stroke.width), lassoBox) || !pathTouches(line, lasso)) continue;
    const shape = strokeShape(stroke, origin.x, origin.y);
    if (!shape) continue;
    strokes.push(stroke.id);
    shapes.push(shape);
  }
  content = unionBox(content, inkExtent(shapes));
  if (!content) return null;

  const bounds = roundBox(mode === 'smart' ? content : lassoBox);
  const padding = options.padding ?? DEFAULT_PADDING;
  return {
    mode,
    blocks,
    strokes,
    bounds,
    crop: cropOf(bounds, padding, options.minSize ?? MIN_CROP),
    clip: mode === 'exact' ? lasso : null,
  };
}
