// Snapping shapes to the lines of the page's paper. The lattice comes from the paper renderer's own description of
// where ruled, grid, and dot paper draw their lines (core/paperLattice.ts), so a snapped point lies on a drawn line.
// Lines, arrows, every recognized and library shape, and the handles that move and resize them snap; freehand ink
// never does. This is pure geometry on page units, so a Node test drives it.
import { nearestRow, snapReach, snapToLattice, stepToLine } from '../../../core/paperLattice';
import type { PaperLattice } from '../../../core/paperLattice';
import { dragHandle } from '../geometry/shapes';
import type { Shape } from '../geometry/shapes';
import type { Bounds, Vec } from '../geometry/types';

export type { PaperLattice } from '../../../core/paperLattice';

/** What shapes snap to now: the paper's lattice and how far a point reaches for a line, in page units. */
export interface PaperSnap {
  readonly lattice: PaperLattice;
  readonly reach: number;
}

/**
 * Paper snapping for the page as it is: null when the paper has no lines, when snapping is off, or while Alt is held,
 * which turns it off for one stroke or drag.
 */
export function paperSnapFor(
  lattice: PaperLattice | null,
  zoom: number,
  options: { readonly on: boolean; readonly alt: boolean },
): PaperSnap | null {
  if (!lattice || !options.on || options.alt) return null;
  return { lattice, reach: snapReach(lattice.step, zoom) };
}

export interface Snapped {
  readonly point: Vec;
  readonly x: boolean;
  readonly y: boolean;
}

/** A point on the paper's nearest line or lines within reach, or where it was. */
export function snapPoint(snap: PaperSnap, p: Vec): Snapped {
  return snapToLattice(snap.lattice, p, snap.reach);
}

/** A shape and the points of it that landed on a line, where the interface shows that they snapped. */
export interface SnappedShape {
  readonly shape: Shape;
  readonly marks: readonly Vec[];
}

/** A line within this slope of horizontal or vertical is drawn level and stays level when it snaps (5 degrees). */
const LEVEL = Math.tan((5 * Math.PI) / 180);
/** A rectangle or an ellipse turned less than this from square to the page snaps its box (about 0.6 degrees). */
const SQUARE = 0.02;
const TINY = 1e-6;

const isVec = (value: unknown): value is Vec =>
  typeof value === 'object' && value !== null && 'x' in value && 'y' in value && !Array.isArray(value);

/** Every point of a shape moved by `f`, and its numbers kept. */
function mapShape(shape: Shape, f: (p: Vec) => Vec): Shape {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(shape)) {
    if (isVec(value)) out[key] = f(value);
    else if (Array.isArray(value)) out[key] = value.map((item: unknown) => (isVec(item) ? f(item) : item));
    else out[key] = value;
  }
  return out as unknown as Shape;
}

const moved = (shape: Shape, dx: number, dy: number): Shape =>
  dx === 0 && dy === 0 ? shape : mapShape(shape, (p) => ({ x: p.x + dx, y: p.y + dy }));

/** The two ends of a straight line, snapped. A level line stays level, and on ruled paper it lies on a rule. */
export function snapEnds(snap: PaperSnap, a: Vec, b: Vec): { a: Vec; b: Vec; marks: Vec[] } {
  const flat = Math.abs(b.y - a.y) <= Math.abs(b.x - a.x) * LEVEL;
  const upright = Math.abs(b.x - a.x) <= Math.abs(b.y - a.y) * LEVEL;
  const sa = snapPoint(snap, a);
  const sb = snapPoint(snap, b);
  let A = { ...sa.point };
  let B = { ...sb.point };
  let onA = sa.x || sa.y;
  let onB = sb.x || sb.y;
  if (flat) {
    const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    // On ruled paper a line drawn close to level lies on the rule nearest it, however far that is.
    const rule = snap.lattice.kind === 'ruled' ? nearestRow(snap.lattice, middle) : null;
    const y = rule ?? (sa.y ? A.y : sb.y ? B.y : null);
    if (y !== null) {
      A = { ...A, y };
      B = { ...B, y };
      onA = onB = true;
    }
  } else if (upright && snap.lattice.kind !== 'ruled') {
    const x = sa.x ? A.x : sb.x ? B.x : null;
    if (x !== null) {
      A = { ...A, x };
      B = { ...B, x };
    }
  }
  return { a: A, b: B, marks: [...(onA ? [A] : []), ...(onB ? [B] : [])] };
}

/**
 * A box snapped to the paper. When both its corners reach lines it takes them, so its size is whole spacings; when one
 * does, the box moves onto it and keeps its size.
 */
export function snapBox(snap: PaperSnap, box: Bounds): { box: Bounds; marks: Vec[] } {
  const lo = snapPoint(snap, { x: box.minX, y: box.minY });
  const hi = snapPoint(snap, { x: box.maxX, y: box.maxY });
  const axis = (from: number, to: number, a: number, b: number, snapA: boolean, snapB: boolean): [number, number] => {
    if (snapA && snapB && b - a > TINY) return [a, b];
    if (snapA && (!snapB || Math.abs(a - from) <= Math.abs(b - to))) return [a, to + a - from];
    if (snapB) return [from + b - to, b];
    return [from, to];
  };
  const [minX, maxX] = axis(box.minX, box.maxX, lo.point.x, hi.point.x, lo.x, hi.x);
  const [minY, maxY] = axis(box.minY, box.maxY, lo.point.y, hi.point.y, lo.y, hi.y);
  const next = { minX, minY, maxX, maxY };
  const marks = [
    { x: minX, y: minY },
    { x: maxX, y: maxY },
    { x: maxX, y: minY },
    { x: minX, y: maxY },
  ].filter((p) => onLine(snap, p));
  return { box: next, marks };
}

/** The affine map that takes one box onto another, for points. */
function boxMap(from: Bounds, to: Bounds): (p: Vec) => Vec {
  const sx = from.maxX - from.minX > TINY ? (to.maxX - to.minX) / (from.maxX - from.minX) : 1;
  const sy = from.maxY - from.minY > TINY ? (to.maxY - to.minY) / (from.maxY - from.minY) : 1;
  return (p) => ({ x: to.minX + (p.x - from.minX) * sx, y: to.minY + (p.y - from.minY) * sy });
}

function boundsOf(points: readonly Vec[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** True when an angle is within SQUARE of a multiple of 90 degrees. */
const square = (angle: number) => Math.abs(Math.sin(2 * angle)) < SQUARE;

/** A point snapped, and the shape moved so that point lands where it snapped. */
function moveOnto(snap: PaperSnap, shape: Shape, at: Vec): SnappedShape {
  const hit = snapPoint(snap, at);
  if (!hit.x && !hit.y) return { shape, marks: [] };
  return { shape: moved(shape, hit.point.x - at.x, hit.point.y - at.y), marks: [hit.point] };
}

/** True when a point lies on one of the paper's lines. */
function onLine(snap: PaperSnap, p: Vec): boolean {
  const at = snapPoint(snap, p);
  return (at.x && Math.abs(at.point.x - p.x) < TINY) || (at.y && Math.abs(at.point.y - p.y) < TINY);
}

/** A circle snapped by its box: whole spacings across when its box reaches lines, and placed on them. */
function snapCircle(snap: PaperSnap, shape: Extract<Shape, { kind: 'circle' }>): SnappedShape {
  const { center: c, radius: r } = shape;
  const lo = snapPoint(snap, { x: c.x - r, y: c.y - r });
  const hi = snapPoint(snap, { x: c.x + r, y: c.y + r });
  // A circle stays round: it takes the size of a side whose ends both snapped, the larger when both did.
  const sizes: number[] = [];
  if (lo.x && hi.x && hi.point.x - lo.point.x > TINY) sizes.push(hi.point.x - lo.point.x);
  if (lo.y && hi.y && hi.point.y - lo.point.y > TINY) sizes.push(hi.point.y - lo.point.y);
  const size = sizes.length > 0 ? Math.max(...sizes) : 2 * r;
  const place = (snapLo: boolean, at: number, snapHi: boolean, end: number, middle: number) =>
    snapLo ? at : snapHi ? end - size : middle - size / 2;
  const minX = place(lo.x, lo.point.x, hi.x, hi.point.x, c.x);
  const minY = place(lo.y, lo.point.y, hi.y, hi.point.y, c.y);
  const corners = [
    { x: minX, y: minY },
    { x: minX + size, y: minY + size },
  ];
  return {
    shape: { ...shape, center: { x: minX + size / 2, y: minY + size / 2 }, radius: size / 2 },
    marks: corners.filter((p) => onLine(snap, p)),
  };
}

/**
 * A shape snapped to the paper. Lines and arrows snap their ends; rectangles, ellipses, and circles square to the
 * page snap their boxes, so their sides lie on lines and their sizes are whole spacings; triangles snap each corner;
 * polygons and stars snap their middles and a corner; arcs and anything turned move onto the paper by one point.
 */
export function snapShape(snap: PaperSnap, shape: Shape): SnappedShape {
  switch (shape.kind) {
    case 'line': {
      const { a, b, marks } = snapEnds(snap, shape.from, shape.to);
      return { shape: { kind: 'line', from: a, to: b }, marks };
    }
    case 'arrow':
    case 'doubleArrow': {
      const end = shape.kind === 'arrow' ? shape.tip : shape.to;
      const { a, b, marks } = snapEnds(snap, shape.from, end);
      return { shape: dragHandle(dragHandle(shape, 'from', a), 'to', b), marks };
    }
    case 'rectangle': {
      const [c0, c1] = shape.corners;
      if (!square(Math.atan2(c1.y - c0.y, c1.x - c0.x))) return moveOnto(snap, shape, c0);
      const from = boundsOf(shape.corners);
      const { box, marks } = snapBox(snap, from);
      return { shape: mapShape(shape, boxMap(from, box)), marks };
    }
    case 'triangle': {
      const hits = shape.corners.map((corner) => snapPoint(snap, corner));
      if (!hits.some((hit) => hit.x || hit.y)) return { shape, marks: [] };
      const corners = hits.map((hit) => hit.point) as unknown as typeof shape.corners;
      return {
        shape: { ...shape, corners, variant: 'general' },
        marks: hits.filter((h) => h.x || h.y).map((h) => h.point),
      };
    }
    case 'circle':
      return snapCircle(snap, shape);
    case 'ellipse': {
      if (!square(shape.rotation)) return moveOnto(snap, shape, shape.center);
      const across = Math.abs(Math.cos(shape.rotation)) > 0.5;
      const halfW = across ? shape.rx : shape.ry;
      const halfH = across ? shape.ry : shape.rx;
      const from = {
        minX: shape.center.x - halfW,
        minY: shape.center.y - halfH,
        maxX: shape.center.x + halfW,
        maxY: shape.center.y + halfH,
      };
      const { box, marks } = snapBox(snap, from);
      const w = (box.maxX - box.minX) / 2;
      const h = (box.maxY - box.minY) / 2;
      return {
        shape: {
          ...shape,
          center: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 },
          rx: across ? w : h,
          ry: across ? h : w,
        },
        marks,
      };
    }
    case 'polygon':
    case 'star': {
      const centered = moveOnto(snap, shape, shape.center);
      const s = centered.shape as typeof shape;
      const radius = s.kind === 'polygon' ? s.radius : s.outer;
      const corner = { x: s.center.x + radius * Math.cos(s.rotation), y: s.center.y + radius * Math.sin(s.rotation) };
      const hit = snapPoint(snap, corner);
      if (!hit.x || !hit.y) return centered;
      return {
        shape: dragHandle(s, s.kind === 'polygon' ? 'radius' : 'outer', hit.point),
        marks: [...centered.marks, hit.point],
      };
    }
    case 'arc':
    case 'curvedArrow':
      return moveOnto(snap, shape, shape.center);
  }
}

/**
 * Several strokes snapped as one, by the box around all their points: the shapes a library adds. Returns the points
 * moved and scaled onto the paper.
 */
export function snapPolylines(snap: PaperSnap, lines: readonly (readonly Vec[])[]): { lines: Vec[][]; marks: Vec[] } {
  const all = lines.flat();
  if (all.length === 0) return { lines: lines.map((line) => [...line]), marks: [] };
  const from = boundsOf(all);
  const { box, marks } = snapBox(snap, from);
  const f = boxMap(from, box);
  return { lines: lines.map((line) => line.map(f)), marks };
}

/** The points of a shape that a move snaps by: its ends, its corners, the box of a round shape, or its middle. */
export function anchorsOf(shape: Shape): Vec[] {
  switch (shape.kind) {
    case 'line':
    case 'doubleArrow':
      return [shape.from, shape.to];
    case 'arrow':
      return [shape.from, shape.tip];
    case 'rectangle':
    case 'triangle':
      return [...shape.corners];
    case 'circle': {
      const { center: c, radius: r } = shape;
      return [
        { x: c.x - r, y: c.y - r },
        { x: c.x + r, y: c.y + r },
      ];
    }
    case 'ellipse': {
      if (!square(shape.rotation)) return [shape.center];
      const across = Math.abs(Math.cos(shape.rotation)) > 0.5;
      const w = across ? shape.rx : shape.ry;
      const h = across ? shape.ry : shape.rx;
      return [
        { x: shape.center.x - w, y: shape.center.y - h },
        { x: shape.center.x + w, y: shape.center.y + h },
      ];
    }
    case 'polygon':
    case 'star':
    case 'arc':
    case 'curvedArrow':
      return [shape.center];
  }
}

/**
 * A move of shapes by `delta`, snapped: each axis takes the smallest correction that puts one of the anchors on a line
 * (on dot paper, the one that puts an anchor on a dot). Returns the snapped move and the anchors that landed.
 */
export function snapMove(snap: PaperSnap, anchors: readonly Vec[], delta: Vec): { delta: Vec; marks: Vec[] } {
  let cx: number | null = null;
  let cy: number | null = null;
  for (const anchor of anchors) {
    const p = { x: anchor.x + delta.x, y: anchor.y + delta.y };
    const hit = snapPoint(snap, p);
    if (snap.lattice.kind === 'dots') {
      if (hit.x && (cx === null || Math.hypot(hit.point.x - p.x, hit.point.y - p.y) < Math.hypot(cx, cy ?? 0))) {
        cx = hit.point.x - p.x;
        cy = hit.point.y - p.y;
      }
      continue;
    }
    if (hit.x && (cx === null || Math.abs(hit.point.x - p.x) < Math.abs(cx))) cx = hit.point.x - p.x;
    if (hit.y && (cy === null || Math.abs(hit.point.y - p.y) < Math.abs(cy))) cy = hit.point.y - p.y;
  }
  const next = { x: delta.x + (cx ?? 0), y: delta.y + (cy ?? 0) };
  const marks = anchors.map((a) => ({ x: a.x + next.x, y: a.y + next.y })).filter((p) => onLine(snap, p));
  return { delta: next, marks };
}

/**
 * A keyboard nudge of shapes with snapping on: one spacing in the arrow's direction, or, for shapes between two lines,
 * as far as the line they move toward, so they land on the paper.
 */
export function nudge(snap: PaperSnap, anchors: readonly Vec[], direction: readonly [number, number]): Vec {
  const anchor = anchors[0];
  if (!anchor) return { x: direction[0] * snap.lattice.step, y: direction[1] * snap.lattice.step };
  const along = (axis: 'x' | 'y', d: number) =>
    d === 0 ? 0 : stepToLine(snap.lattice, anchor[axis], axis, d > 0 ? 1 : -1, anchor.y);
  return { x: along('x', direction[0]), y: along('y', direction[1]) };
}
