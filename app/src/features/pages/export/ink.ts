// Ink as vector shapes for print and export. Each stroke becomes one closed, filled path in its pen color, so ink
// prints sharp at any size, selects as graphics, and stays small (ADR 0006: "ink stays vector"). The outline follows
// the stored points and pressure. Rendering can improve later without changing the data.

import type { Rect } from '../pagination/geometry';
import type { ExportStroke } from './source';

export interface InkShape {
  /** The outline as closed path data, in page coordinates. */
  readonly d: string;
  /** `#rrggbb`. */
  readonly fill: string;
  /** 1 for opaque ink, less for highlighters and translucent pens. */
  readonly opacity: number;
  readonly bbox: Rect;
  /** True for a highlighter, which draws below the text of a page. */
  readonly highlighter: boolean;
}

/** Where an ink block's origin sits on the page. Blocks not listed sit at the page origin. */
export type Placements = ReadonlyMap<string, { readonly x: number; readonly y: number }>;

const CAP_STEPS = 8;
/** Points closer than this, in page units, are dropped. The outline keeps the last point. */
const MIN_STEP = 0.25;
/** The thinnest a pressure-sensitive stroke gets, as a share of its width. */
const MIN_PRESSURE = 0.1;

const HIGHLIGHTER = 2;
const MARKER = 3;

/** The tools whose width does not follow pressure. */
const FLAT_TOOLS: readonly number[] = [HIGHLIGHTER, MARKER];

const tenth = (v: number): number => Math.round(v * 10) / 10;
const hex = (n: number): string => Math.max(0, Math.min(255, n)).toString(16).padStart(2, '0');

export function colorOf(color: ExportStroke['color']): { fill: string; opacity: number } {
  return {
    fill: `#${hex(color[0])}${hex(color[1])}${hex(color[2])}`,
    opacity: Math.round((color[3] / 255) * 100) / 100,
  };
}

interface Pt {
  x: number;
  y: number;
  r: number;
}

/** The stroke's points on the page: transformed, offset, with each radius. */
function pointsOf(stroke: ExportStroke, dx: number, dy: number): Pt[] {
  const [a, b, c, d, e, f] = stroke.transform ?? [1, 0, 0, 1, 0, 0];
  const scale = Math.sqrt(Math.abs(a * d - b * c));
  const flat = FLAT_TOOLS.includes(stroke.tool);
  const out: Pt[] = [];
  for (let i = 0; i < stroke.x.length; i += 1) {
    const x = stroke.x[i];
    const y = stroke.y[i];
    const p = flat || !stroke.pressure ? 1 : Math.max(MIN_PRESSURE, stroke.pressure[i]);
    out.push({ x: a * x + c * y + e + dx, y: b * x + d * y + f + dy, r: (stroke.width * scale * p) / 2 });
  }
  return out;
}

/** Drops points that are too close to the last kept one, but never the last point of the stroke. */
function thin(points: readonly Pt[]): Pt[] {
  const kept: Pt[] = [];
  points.forEach((p, i) => {
    const last = kept.at(-1);
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) >= MIN_STEP) kept.push(p);
    else if (i === points.length - 1) kept[kept.length - 1] = { ...last, r: Math.max(last.r, p.r) };
  });
  return kept;
}

type Side = readonly [x: number, y: number];

function circle(p: Pt): Side[] {
  const out: Side[] = [];
  for (let k = 0; k < CAP_STEPS * 2; k += 1) {
    const t = (k / (CAP_STEPS * 2)) * 2 * Math.PI;
    out.push([p.x + p.r * Math.cos(t), p.y + p.r * Math.sin(t)]);
  }
  return out;
}

/** The unit tangent at point i, from its neighbors. */
function tangent(points: readonly Pt[], i: number): Side {
  const a = points[Math.max(0, i - 1)];
  const b = points[Math.min(points.length - 1, i + 1)];
  const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  return [(b.x - a.x) / len, (b.y - a.y) / len];
}

/** A cap: the half circle around `p` from the left normal over `forward` to the right normal. */
function cap(p: Pt, t: Side, forward: 1 | -1): Side[] {
  const n: Side = [-t[1], t[0]];
  const out: Side[] = [];
  for (let k = 1; k < CAP_STEPS; k += 1) {
    const angle = (k / CAP_STEPS) * Math.PI;
    const side = Math.cos(angle) * forward;
    const ahead = Math.sin(angle) * forward;
    out.push([p.x + p.r * (side * n[0] + ahead * t[0]), p.y + p.r * (side * n[1] + ahead * t[1])]);
  }
  return out;
}

function outline(points: readonly Pt[]): Side[] {
  if (points.length === 1) return circle(points[0]);
  const tangents = points.map((_, i) => tangent(points, i));
  const left = points.map((p, i): Side => [p.x - tangents[i][1] * p.r, p.y + tangents[i][0] * p.r]);
  const right = points.map((p, i): Side => [p.x + tangents[i][1] * p.r, p.y - tangents[i][0] * p.r]);
  const end = points.length - 1;
  return [...left, ...cap(points[end], tangents[end], 1), ...right.reverse(), ...cap(points[0], tangents[0], -1)];
}

function pathData(ring: readonly Side[]): string {
  return `M${ring.map(([x, y]) => `${tenth(x)} ${tenth(y)}`).join('L')}Z`;
}

function boxOf(ring: readonly Side[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** One stroke as a filled shape in page coordinates, with its ink block's origin at (dx, dy). Null for no points. */
export function strokeShape(stroke: ExportStroke, dx = 0, dy = 0): InkShape | null {
  if (stroke.x.length === 0 || stroke.x.length !== stroke.y.length) return null;
  const points = thin(pointsOf(stroke, dx, dy));
  const ring = outline(points);
  return { d: pathData(ring), bbox: boxOf(ring), highlighter: stroke.tool === HIGHLIGHTER, ...colorOf(stroke.color) };
}

/**
 * The strokes in drawing order: ink blocks in the order of `blockOrder`, and in each block highlighters first, then
 * by start time and ID (format spec 8.2). Strokes of unknown blocks draw last.
 */
export function drawingOrder(strokes: readonly ExportStroke[], blockOrder: readonly string[]): ExportStroke[] {
  const rank = new Map(blockOrder.map((id, i) => [id, i]));
  const rankOf = (s: ExportStroke) => rank.get(s.block) ?? blockOrder.length;
  const flat = (s: ExportStroke) => (s.tool === HIGHLIGHTER ? 0 : 1);
  return [...strokes].sort(
    (a, b) =>
      rankOf(a) - rankOf(b) || flat(a) - flat(b) || a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** Every stroke as a shape, in drawing order. */
export function inkShapes(strokes: readonly ExportStroke[], blockOrder: readonly string[], at: Placements): InkShape[] {
  return drawingOrder(strokes, blockOrder).flatMap((s) => {
    const origin = at.get(s.block);
    return strokeShape(s, origin?.x ?? 0, origin?.y ?? 0) ?? [];
  });
}

/** The shapes that touch the band of page from `top` to `top + height`. */
export function shapesInBand(shapes: readonly InkShape[], top: number, height: number): InkShape[] {
  return shapes.filter((s) => s.bbox.y < top + height && s.bbox.y + s.bbox.h > top);
}

/**
 * An `<svg>` for the band of the page from `top`, `width` by `height` page units. Shapes keep their page coordinates
 * inside a translated group, and the svg clips at its edges, so a stroke across a sheet edge shows on both sheets.
 * With a `label` the drawing is announced as an image. Without one it is hidden from assistive technology.
 */
export function inkSvg(
  shapes: readonly InkShape[],
  top: number,
  width: number,
  height: number,
  label?: string,
): string {
  const paths = shapes
    .map((s) => `<path d="${s.d}" fill="${s.fill}"${s.opacity < 1 ? ` fill-opacity="${s.opacity}"` : ''}/>`)
    .join('');
  const role =
    label === undefined
      ? 'aria-hidden="true"'
      : `role="img" aria-label="${label.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)}"`;
  const box = `viewBox="0 0 ${width} ${height}" width="${width}" height="${height}"`;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="ink" ${box} ${role} focusable="false"><g transform="translate(0 ${-top})">${paths}</g></svg>`;
}

/** The smallest box around the strokes, or null when none has points. */
export function inkExtent(shapes: readonly InkShape[]): Rect | null {
  if (shapes.length === 0) return null;
  // A loop, not Math.min(...shapes): a spread of a long page's shapes passes the engine's argument limit and throws.
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { bbox } of shapes) {
    x0 = Math.min(x0, bbox.x);
    y0 = Math.min(y0, bbox.y);
    x1 = Math.max(x1, bbox.x + bbox.w);
    y1 = Math.max(y1, bbox.y + bbox.h);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
