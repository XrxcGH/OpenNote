// Stroke shaping: raw points with pressure and tilt become the outline polygon a canvas fills (design 6.3). The
// shaping itself is perfect-freehand's (MIT, steveruizok/perfect-freehand); this file picks its options for each tool.

import { getStroke } from 'perfect-freehand';
import type { InkPoint, InkTool, Vec } from './types';

export interface OutlineOptions {
  readonly tool: InkTool;
  /** The stroke's nominal diameter in page units, before any transform. */
  readonly width: number;
  /** The transform's width scale (`widthScale`), so resizing a stroke scales its width. Defaults to 1. */
  readonly scale?: number;
  /** True for a finished stroke, false while the pen is still down. Defaults to true. */
  readonly complete?: boolean;
}

interface Preset {
  readonly thinning: number;
  readonly smoothing: number;
  readonly streamline: number;
}

// Width from pressure per tool. The smoothing lag stays 0, so the ink never trails the pen.
const PRESETS: Record<InkTool, Preset> = {
  pen: { thinning: 0.5, smoothing: 0.5, streamline: 0 },
  pencil: { thinning: 0.3, smoothing: 0.5, streamline: 0 },
  highlighter: { thinning: 0, smoothing: 0.5, streamline: 0 },
  marker: { thinning: 0, smoothing: 0.5, streamline: 0 },
  brush: { thinning: 0.6, smoothing: 0.5, streamline: 0 },
};

/** Pencil width grows up to this many times as the pencil lies down toward the page. */
export const PENCIL_MAX_TILT_WIDTH = 2.2;
/** Pencil opacity falls from the first to the second as it lies down. */
export const PENCIL_OPACITY_UPRIGHT = 0.9;
export const PENCIL_OPACITY_FLAT = 0.55;

const MAX_TILT = 90;
const DEFAULT_PRESSURE = 0.5;

/** How far the pencil leans from upright, 0 (upright) to 1 (lying flat), from its Pointer Events tilt in degrees. */
export function tiltFraction(point: InkPoint): number {
  return Math.min(1, Math.hypot(point.tiltX ?? 0, point.tiltY ?? 0) / MAX_TILT);
}

/** The pencil's width multiplier at a point: 1 upright, up to 2.2 flat. */
export function pencilWidthFactor(point: InkPoint): number {
  return 1 + (PENCIL_MAX_TILT_WIDTH - 1) * tiltFraction(point);
}

/** The pencil's opacity for a stroke, from its mean tilt: 0.9 upright down to 0.55 flat. */
export function pencilOpacity(points: readonly InkPoint[]): number {
  if (points.length === 0) return PENCIL_OPACITY_UPRIGHT;
  const mean = points.reduce((sum, p) => sum + tiltFraction(p), 0) / points.length;
  return PENCIL_OPACITY_UPRIGHT + (PENCIL_OPACITY_FLAT - PENCIL_OPACITY_UPRIGHT) * mean;
}

/**
 * perfect-freehand takes one width per stroke and varies it only by pressure. Tilt therefore rides in the pressure
 * channel: this is the pressure that gives the radius the pencil would have at this tilt.
 */
function pressureWithTilt(point: InkPoint, thinning: number, tilted: boolean): number {
  const pressure = point.pressure ?? DEFAULT_PRESSURE;
  if (!tilted || thinning === 0) return pressure;
  const radius = (0.5 - thinning * (0.5 - pressure)) * pencilWidthFactor(point);
  return 0.5 - (0.5 - radius) / thinning;
}

/** The polygon a stroke fills, in the points' own space. Strokes without pressure get a uniform width. */
export function strokeOutline(points: readonly InkPoint[], options: OutlineOptions): Vec[] {
  const hasPressure = points.some((p) => p.pressure !== undefined);
  const preset = PRESETS[options.tool] ?? PRESETS.pen;
  const thinning = hasPressure ? preset.thinning : 0;
  const tilted = options.tool === 'pencil';
  const input = points.map((p) => ({ x: p.x, y: p.y, pressure: pressureWithTilt(p, thinning, tilted) }));
  const outline = getStroke(input, {
    size: options.width * (options.scale ?? 1),
    thinning,
    smoothing: preset.smoothing,
    streamline: preset.streamline,
    simulatePressure: false,
    last: options.complete ?? true,
  });
  return outline.map(([x, y]) => ({ x, y }));
}

/** An SVG or Path2D path through an outline, smoothed with quadratic curves between midpoints. */
export function outlinePath(outline: readonly Vec[]): string {
  const n = outline.length;
  if (n < 2) return '';
  const fixed = (v: number) => Math.round(v * 100) / 100;
  let path = `M${fixed(outline[0].x)},${fixed(outline[0].y)}Q`;
  for (let i = 0; i < n; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % n];
    path += `${fixed(a.x)},${fixed(a.y)} ${fixed((a.x + b.x) / 2)},${fixed((a.y + b.y) / 2)} `;
  }
  return `${path}Z`;
}
