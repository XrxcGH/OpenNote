// The lasso gesture: a path drawn on the live canvas that selects the ink and the blocks it holds. The page's
// selection store takes the result, so Phase 4's object commands and the ink selection frame both see it.
import { getSettings } from '../../../state/settings';
import { LASSO_EVERYTHING } from '../edits/filters';
import type { LassoFilter } from '../edits/filters';
import type { Bounds, Vec } from '../geometry/types';
import { lassoAll } from '../selection/lassoItems';
import type { BlockItem, BlockKind } from '../selection/lassoItems';
import type { InkHost } from './host';
import { brandColor } from './paint';
import type { InkSurface } from './surface';

export interface LassoGesture {
  /** Every point the pen gave. */
  readonly points: Vec[];
  /** Adds the pen's points. */
  add(points: readonly Vec[]): void;
  /** The shape the lasso selects by: the free path, or the rectangle from the first point to the last. */
  path(): Vec[];
  draw(surface: InkSurface): void;
}

/** The rectangle from one corner to the opposite one. */
export function rectangleOf(a: Vec, b: Vec): Vec[] {
  return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
}

export function startLasso(shape: 'free' | 'rectangle' = 'free'): LassoGesture {
  const points: Vec[] = [];
  const path = () => (shape === 'rectangle' && points.length > 1 ? rectangleOf(points[0], points.at(-1)!) : points);
  return {
    points,
    add: (more) => void points.push(...more),
    path,
    draw(surface) {
      const outline = path();
      const ctx = surface.liveContext();
      if (!ctx || outline.length < 2) return;
      const zoom = surface.cameraNow().zoom;
      ctx.lineWidth = 1.5 / zoom;
      ctx.setLineDash([6 / zoom, 4 / zoom]);
      ctx.strokeStyle = brandColor('indigo', surface.scheme());
      ctx.beginPath();
      ctx.moveTo(outline[0].x, outline[0].y);
      for (const p of outline) ctx.lineTo(p.x, p.y);
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
    },
  };
}

const kindOf = (type: string): BlockKind =>
  type === 'text' || type === 'table' ? 'text' : type === 'image' ? 'image' : 'other';

/** The page's blocks as the lasso sees them: every rendered block but ink, with its frame in page units. */
export function blockItems(host: InkHost): BlockItem[] {
  const layer = host.layer.get();
  if (!layer) return [];
  return layer.blocks().flatMap((block) => {
    if (block.type === 'ink') return [];
    const rect = layer.view(block.id)?.measure();
    if (!rect || rect.w <= 0 || rect.h <= 0) return [];
    const frame: Bounds = { minX: rect.x, minY: rect.y, maxX: rect.x + rect.w, maxY: rect.y + rect.h };
    return [{ id: block.id, frame, kind: kindOf(block.type), locked: block.lock !== undefined }];
  });
}

function filterFromSettings(): LassoFilter {
  const picks = new Set(getSettings().ink.lasso.picks);
  if (picks.size === 0) return LASSO_EVERYTHING;
  return {
    ink: picks.has('ink'),
    highlighter: picks.has('highlighter'),
    shapes: picks.has('shapes'),
    text: picks.has('text'),
    images: picks.has('images'),
  };
}

export function finishLasso(gesture: LassoGesture, surface: InkSurface, host: InkHost): void {
  surface.clearLive();
  const path = gesture.path();
  if (path.length < 3) {
    host.select({ blocks: [], strokes: [] });
    return;
  }
  const zoom = surface.cameraNow().zoom;
  const items = lassoAll(surface.index, blockItems(host), path, {
    filter: filterFromSettings(),
    mode: getSettings().ink.lasso.inside,
    pixel: 1 / zoom,
  });
  host.select({ blocks: items.blocks, strokes: items.strokes, lasso: path }, { announce: true });
}
