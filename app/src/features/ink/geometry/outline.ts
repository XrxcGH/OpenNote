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

/** The polygon a stroke fills, in the points' own space. Strokes without pressure get a uniform width. */
export function strokeOutline(points: readonly InkPoint[], options: OutlineOptions): Vec[] {
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
 * Every polygon a stroke fills. Most tools fill one outline. The dashed pen fills one for each dash and the dotted pen
 * one for each dot, so the line breaks where the gaps are. The full outline (`strokeOutline`) still bounds them all.
 */
export function strokeShapes(points: readonly InkPoint[], options: OutlineOptions): Vec[][] {
  const width = options.width * (options.scale ?? 1);
  if ((options.tool !== 'dashed' && options.tool !== 'dotted') || points.length < 2) {
    return [strokeOutline(points, options)];
  }
  const total = lineLength(points);
  const shapes: Vec[][] = [];
  if (options.tool === 'dotted') {
    const step = width * DOT_SPACING;
    for (let d = 0; d <= total + 1e-9; d += step) {
      const [p] = slice(points, d, d);
      if (p) shapes.push(dotAt(p.x, p.y, width / 2));
    }
  } else {
    const dash = width * DASH_LENGTH;
    const period = dash + width * DASH_GAP;
    for (let d = 0; d < total; d += period) {
      const part = slice(points, d, Math.min(total, d + dash));
      if (part.length > 1) shapes.push(strokeOutline(part, options));
    }
  }
  return shapes.length > 0 ? shapes : [strokeOutline(points, options)];
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
