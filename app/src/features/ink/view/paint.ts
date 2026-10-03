// Painting strokes on a canvas. A finished stroke's outline is built once, in page space, and kept as a Path2D for
// as long as the stroke object lives; strokes never change, so a new object means new ink. Highlighters go below the
// other strokes, as the format says, and carry their 40 percent alpha in their color.
import { applyToPoint, widthScale } from '../geometry/matrix';
import { pencilOpacity, strokeOutline } from '../geometry/outline';
import type { InkPoint, InkTool } from '../geometry/types';
import type { InkStroke } from '../model/types';
import { resolveColor, toCss } from '../pens/palette';
import type { ColorScheme, Rgba } from '../pens/palette';

const paths = new WeakMap<InkStroke, Path2D>();

/** A stroke's points in page space, with pressure and tilt kept. */
export function pagePointsOf(stroke: InkStroke): readonly InkPoint[] {
  const m = stroke.transform;
  if (!m) return stroke.points;
  return stroke.points.map((point) => ({ ...point, ...applyToPoint(m, point) }));
}

/**
 * The filled outline of points as a Path2D, built point by point: a string path would be built and parsed again for
 * every stroke, which dominated opening a page of 10,000 strokes. The outline is dense enough that straight edges
 * between its points look as smooth as the curves of `outlinePath` at any zoom the page has.
 */
export function outlineOf(points: readonly InkPoint[], tool: InkTool, width: number, complete = true): Path2D {
  const outline = strokeOutline(points, { tool, width, complete });
  const path = new Path2D();
  if (outline.length < 2) return path;
  path.moveTo(outline[0].x, outline[0].y);
  for (let i = 1; i < outline.length; i++) path.lineTo(outline[i].x, outline[i].y);
  path.closePath();
  return path;
}

export function strokePath(stroke: InkStroke): Path2D {
  let path = paths.get(stroke);
  if (!path) {
    const scale = stroke.transform ? widthScale(stroke.transform) : 1;
    path = outlineOf(pagePointsOf(stroke), stroke.tool, stroke.width * scale);
    paths.set(stroke, path);
  }
  return path;
}

export function fillOf(style: { slot: number; color: Rgba }, scheme: ColorScheme): string {
  return toCss(resolveColor(style, scheme));
}

/** Highlighters first, then the rest; each group in drawing order (start time, then ID). */
export function paintOrder(strokes: InkStroke[]): InkStroke[] {
  const key = (s: InkStroke) => (s.tool === 'highlighter' ? 0 : 1);
  return strokes.sort((a, b) => key(a) - key(b) || a.startTime - b.startTime || (a.id < b.id ? -1 : 1));
}

/** Paints strokes with the context's current transform, which maps page units to pixels. */
export function paintStrokes(ctx: CanvasRenderingContext2D, strokes: InkStroke[], scheme: ColorScheme): void {
  for (const stroke of paintOrder(strokes)) {
    ctx.globalAlpha = stroke.tool === 'pencil' ? pencilOpacity(stroke.points) : 1;
    ctx.fillStyle = fillOf(stroke, scheme);
    ctx.fill(strokePath(stroke));
  }
  ctx.globalAlpha = 1;
}
