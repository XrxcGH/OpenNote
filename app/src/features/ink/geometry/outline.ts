// Stroke shaping: raw points with pressure and tilt become the outline polygon a canvas fills (design 6.3). A pen's
// samples first become the smooth curve they stand for (core/ink/path), so a fast hand's sparse samples draw no
// corners. The shaping itself is perfect-freehand's (MIT, steveruizok/perfect-freehand); this file picks its options
// for each tool. Exact geometry (a recognized shape) skips both: it draws at one even width with crisp corners.

import { getStroke } from 'perfect-freehand';
import { exactOutline, smoothPath } from '../../../core/ink/path';
import type { Mix } from '../../../core/ink/path';
import type { InkPoint, InkTool, Vec } from './types';

export interface OutlineOptions {
  readonly tool: InkTool;
  /** The stroke's nominal diameter in page units, before any transform. */
  readonly width: number;
  /** The transform's width scale (`widthScale`), so resizing a stroke scales its width. Defaults to 1. */
  readonly scale?: number;
  /** True for a finished stroke, false while the pen is still down. Defaults to true. */
  readonly complete?: boolean;
  /**
   * True for exact geometry, such as a recognized shape: one even width, crisp corners, closed when it ends where it
   * starts. False for a pen's samples, drawn as a smooth curve. Defaults to `isExactLine` of the points.
   */
  readonly exact?: boolean;
}

/** True when points are exact geometry rather than a pen's samples: none has a time or a pressure. */
export function isExactLine(points: readonly InkPoint[]): boolean {
  return points.length > 1 && points.every((p) => p.time === undefined && p.pressure === undefined);
}

/** True for a stroke of exact geometry: a shape, not imported ink whose sample times were lost. */
export function isExactStroke(stroke: {
  readonly points: readonly InkPoint[];
  readonly startUnknown?: boolean;
}): boolean {
  return stroke.startUnknown !== true && isExactLine(stroke.points);
}

type Mutable = { -readonly [K in keyof InkPoint]: InkPoint[K] };

/** A point `t` of the way between two samples, at (x, y): pressure, tilt, and time are interpolated. */
const mixInk: Mix<InkPoint> = (a, b, t, x, y) => {
  const out: Mutable = { ...a, x, y };
  if (t === 0) return out;
  if (a.pressure !== undefined && b.pressure !== undefined) out.pressure = a.pressure + (b.pressure - a.pressure) * t;
  if (a.tiltX !== undefined && b.tiltX !== undefined) out.tiltX = a.tiltX + (b.tiltX - a.tiltX) * t;
  if (a.tiltY !== undefined && b.tiltY !== undefined) out.tiltY = a.tiltY + (b.tiltY - a.tiltY) * t;
  if (a.time !== undefined && b.time !== undefined) out.time = a.time + (b.time - a.time) * t;
  return out;
};

/** The smooth curve a pen's samples stand for, as points (core/ink/path's `smoothPath`). */
export function smoothInk(points: readonly InkPoint[]): InkPoint[] {
  return smoothPath(points, mixInk);
}

interface Preset {
  readonly thinning: number;
  readonly smoothing: number;
  readonly streamline: number;
  /** True when a slow pen draws wider than a fast one (fountain pen and brush). */
  readonly speed?: boolean;
}

// Width from pressure per tool. The smoothing lag stays 0, so the ink never trails the pen.
const PRESETS: Record<InkTool, Preset> = {
  pen: { thinning: 0.5, smoothing: 0.5, streamline: 0 },
  pencil: { thinning: 0.3, smoothing: 0.5, streamline: 0 },
  highlighter: { thinning: 0, smoothing: 0.5, streamline: 0 },
  marker: { thinning: 0, smoothing: 0.5, streamline: 0 },
  brush: { thinning: 0.6, smoothing: 0.5, streamline: 0, speed: true },
  fountain: { thinning: 0.65, smoothing: 0.5, streamline: 0, speed: true },
  calligraphy: { thinning: 0, smoothing: 0.5, streamline: 0 },
  dashed: { thinning: 0, smoothing: 0.5, streamline: 0 },
  dotted: { thinning: 0, smoothing: 0.5, streamline: 0 },
};

/** The farthest apart, in page units, two points of a pen's outline may be dropped to; at most half the width. */
const MAX_OUTLINE_GAP = 0.5;

/** The calligraphy nib's angle: a flat nib held at 45 degrees, rising to the right (page y points down). */
export const NIB_ANGLE = -Math.PI / 4;
/** The nib's thickness as a share of its width, so a stroke along the nib still leaves a line. */
export const NIB_THICKNESS = 0.14;
/** Dashes are 4 widths long with gaps of 3; dots are one width across, 2.2 widths apart. */
export const DASH_LENGTH = 4;
export const DASH_GAP = 3;
export const DOT_SPACING = 2.2;
/** A pen faster than this (page units per millisecond) draws at its narrowest; a standing pen at its widest. */
export const FAST_PEN = 1.2;
const SPEED_GAIN = 0.3;

/** How strongly pressure thins the stroke for a tool: 0 for a uniform line, up to 1. */
export function toolThinning(tool: InkTool): number {
  return (PRESETS[tool] ?? PRESETS.pen).thinning;
}

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

/**
 * The pressure of each point after speed has narrowed it: a fast pen draws thinner and a slow one wider, by up to 0.3
 * of the pressure range either way. A point without a time keeps the pressure it had.
 */
export function speedPressures(points: readonly InkPoint[]): number[] {
  return points.map((p, i) => {
    const base = p.pressure ?? DEFAULT_PRESSURE;
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(points.length - 1, i + 1)];
    const dt = (b.time ?? 0) - (a.time ?? 0);
    if (a.time === undefined || b.time === undefined || dt <= 0) return base;
    const fast = Math.min(1, Math.hypot(b.x - a.x, b.y - a.y) / dt / FAST_PEN);
    return Math.min(1, Math.max(0, base + SPEED_GAIN * (0.5 - fast)));
  });
}

/** The flat nib's ribbon: both ends of the nib at every point, out along one side and back along the other. */
function nibOutline(points: readonly InkPoint[], width: number): Vec[] {
  const half = width / 2;
  const dx = Math.cos(NIB_ANGLE) * half;
  const dy = Math.sin(NIB_ANGLE) * half;
  const tx = -Math.sin(NIB_ANGLE) * half * NIB_THICKNESS * 2;
  const ty = Math.cos(NIB_ANGLE) * half * NIB_THICKNESS * 2;
  const near = points.map((p) => ({ x: p.x + dx + tx, y: p.y + dy + ty }));
  const far = points.map((p) => ({ x: p.x - dx - tx, y: p.y - dy - ty }));
  return [...near, ...far.reverse()];
}

/**
 * The polygon a pen's stroke fills, in the points' own space: the smooth curve through its samples, shaped by the
 * tool. Strokes without pressure get a uniform width. `strokeShapes` is what a renderer fills, exact geometry included.
 */
export function strokeOutline(points: readonly InkPoint[], options: OutlineOptions): Vec[] {
  return curveOutline(smoothInk(points), options);
}

/** The outline of points that are already a smooth curve. */
function curveOutline(points: readonly InkPoint[], options: OutlineOptions): Vec[] {
  const preset = PRESETS[options.tool] ?? PRESETS.pen;
  if (options.tool === 'calligraphy' && points.length > 0) {
    return nibOutline(points, options.width * (options.scale ?? 1));
  }
  const timed = preset.speed === true && points.length > 1 && points.every((p) => p.time !== undefined);
  const hasPressure = timed || points.some((p) => p.pressure !== undefined);
  const thinning = hasPressure ? preset.thinning : 0;
  const tilted = options.tool === 'pencil';
  const speeds = timed ? speedPressures(points) : null;
  const input = points.map((p, i) => ({
    x: p.x,
    y: p.y,
    pressure: pressureWithTilt(speeds ? { ...p, pressure: speeds[i] } : p, thinning, tilted),
  }));
  const size = options.width * (options.scale ?? 1);
  const outline = getStroke(input, {
    size,
    thinning,
    // perfect-freehand drops outline points closer than size times smoothing to the last; capping that gap at
    // MAX_OUTLINE_GAP keeps a wide pen's curves from showing as straight edges.
    smoothing: Math.min(preset.smoothing, MAX_OUTLINE_GAP / Math.max(size, 1e-6)),
    streamline: preset.streamline,
    simulatePressure: false,
    last: options.complete ?? true,
  });
  return outline.map(([x, y]) => ({ x, y }));
}

/** The part of a line between two distances along its length, with the ends interpolated. */
function slice(points: readonly InkPoint[], start: number, end: number): InkPoint[] {
  const out: InkPoint[] = [];
  let at = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const from = Math.max(start, at);
    const to = Math.min(end, at + len);
    if (len > 0 && from <= to) {
      const lerp = (d: number): InkPoint => {
        const k = (d - at) / len;
        return { ...a, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
      };
      if (out.length === 0) out.push(lerp(from));
      out.push(lerp(to));
    }
    at += len;
  }
  return out;
}

function lineLength(points: readonly InkPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

function dotAt(x: number, y: number, radius: number): Vec[] {
  return Array.from({ length: 16 }, (_, k) => ({
    x: x + Math.cos((k / 16) * 2 * Math.PI) * radius,
    y: y + Math.sin((k / 16) * 2 * Math.PI) * radius,
  }));
}

/**
 * Every polygon a stroke fills, filled together with the nonzero rule. A pen's stroke fills one outline around the
 * smooth curve through its samples. Exact geometry fills the pieces of an even-width line with crisp corners. The
 * dashed pen fills one polygon for each dash and the dotted pen one for each dot, so the line breaks at the gaps.
 */
export function strokeShapes(points: readonly InkPoint[], options: OutlineOptions): Vec[][] {
  const width = options.width * (options.scale ?? 1);
  const exact = options.tool !== 'calligraphy' && (options.exact ?? isExactLine(points));
  const broken = options.tool === 'dashed' || options.tool === 'dotted';
  if (exact && !broken) return exactOutline(points, width);
  const line = exact ? points : smoothInk(points);
  const whole = (): Vec[][] => (exact ? exactOutline(line, width) : [curveOutline(line, options)]);
  if (!broken || line.length < 2) return whole();
  const total = lineLength(line);
  const shapes: Vec[][] = [];
  if (options.tool === 'dotted') {
    const step = width * DOT_SPACING;
    for (let d = 0; d <= total + 1e-9; d += step) {
      const [p] = slice(line, d, d);
      if (p) shapes.push(dotAt(p.x, p.y, width / 2));
    }
  } else {
    const dash = width * DASH_LENGTH;
    const period = dash + width * DASH_GAP;
    for (let d = 0; d < total; d += period) {
      const part = slice(line, d, Math.min(total, d + dash));
      if (part.length > 1) shapes.push(...(exact ? exactOutline(part, width) : [curveOutline(part, options)]));
    }
  }
  return shapes.length > 0 ? shapes : whole();
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
