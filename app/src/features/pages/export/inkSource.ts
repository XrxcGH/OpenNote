// Ink for export: the live strokes of a page from its segment records (format spec 8.3), decoded into page units.

import { decodePoints, type InkRecord, type Stroke } from '../../../core/ink/codec';
import type { ExportStroke, Transform } from './source';

/**
 * The strokes left after applying every record in order: a `Stroke` record adds or replaces a stroke, a `StrokeProps`
 * record changes some of its properties, and a `Remove` record deletes it. Records for strokes that do not exist are
 * ignored, as the format says.
 */
export function liveStrokes(records: readonly InkRecord[]): Stroke[] {
  const live = new Map<string, Stroke>();
  for (const record of records) {
    if (record.kind === 'stroke') live.set(record.stroke.id, record.stroke);
    else if (record.kind === 'remove') live.delete(record.id);
    else {
      const { id, style, transform, block } = record.props;
      const stroke = live.get(id);
      if (!stroke) continue;
      live.set(id, {
        ...stroke,
        style: style ?? stroke.style,
        block: block ?? stroke.block,
        transform: transform === 'remove' ? null : (transform ?? stroke.transform),
      });
    }
  }
  return [...live.values()];
}

/** Decodes a stroke's points into page units (1/64 unit steps) and pressure from 0 to 1. */
export function toExportStroke(stroke: Stroke): ExportStroke | null {
  try {
    const points = decodePoints(stroke.points, stroke.pointCount, stroke.channels);
    const pressure = points.pressure ? Array.from(points.pressure, (p) => p / 65535) : null;
    const transform = stroke.transform?.length === 6 ? (stroke.transform as unknown as Transform) : null;
    return {
      id: stroke.id,
      block: stroke.block,
      start: stroke.start,
      tool: stroke.style.tool,
      color: stroke.style.color,
      width: stroke.style.width,
      x: Array.from(points.x, (v) => v / 64),
      y: Array.from(points.y, (v) => v / 64),
      pressure,
      transform,
    };
  } catch {
    // A stroke whose points cannot be read is left out of the export, as the page view leaves it out.
    return null;
  }
}

export function exportStrokes(records: readonly InkRecord[]): ExportStroke[] {
  return liveStrokes(records).flatMap((s) => toExportStroke(s) ?? []);
}
