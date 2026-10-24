// The partial eraser: cuts a stroke at the eraser circle and keeps the contiguous slices outside it (design 8.4,
// spec 8.2). Each cut end gets one interpolated point on the circle's boundary, so cuts are clean at any pen speed.

import { boundsOf, intersects } from './bounds';
import { capsuleBounds, hitCapsules } from './hitTest';
import { applyToPoints } from './matrix';
import { halfWidth, pagePoints } from './strokeIndex';
import type { StrokeIndex } from './strokeIndex';
import { polylineLength, segmentCapsuleInterval } from './primitives';
import type { Interval } from './primitives';
import type { Capsule, InkPoint, Stroke } from './types';

/** Kept slices shorter than this many page units are dropped, or half the stroke's width when that is more. */
export const MIN_SLICE_LENGTH = 0.5;

const EPSILON = 1e-9;

export interface PartialEraseResult<S extends Stroke> {
  /** Ids of the strokes the eraser cut or wiped out. */
  readonly removed: string[];
  /** The slices that replace them, each with a new id and `origin` set to the stroke it came from. */
  readonly added: S[];
}

/** The path parameters of the stroke's centerline inside the capsules. Parameter `i + t` is segment `i` at `t`. */
function cutIntervals(points: readonly { x: number; y: number }[], capsules: readonly Capsule[]): Interval[] {
  const cuts: Interval[] = [];
  const reach = capsules.map(capsuleBounds);
  for (let i = 0; i + 1 < points.length; i++) {
    const box = boundsOf([points[i], points[i + 1]]);
    capsules.forEach((capsule, k) => {
      if (!intersects(box, reach[k])) return;
      const cut = segmentCapsuleInterval(points[i], points[i + 1], capsule);
      if (cut) cuts.push([i + cut[0], i + cut[1]]);
    });
  }
  return cuts;
}

/** The ranges of the path outside every cut: what remains after the eraser passes. */
function keptRanges(cuts: readonly Interval[], last: number): Interval[] {
  const sorted = [...cuts].sort((a, b) => a[0] - b[0]);
  const kept: Interval[] = [];
  let cursor = 0;
  for (const [start, end] of sorted) {
    if (start > cursor + EPSILON) kept.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (cursor < last - EPSILON) kept.push([cursor, last]);
  return kept;
}

function blend(a: number | undefined, b: number | undefined, t: number): number | undefined {
  return a === undefined || b === undefined ? a : a + (b - a) * t;
}

/** The raw point at path parameter `s`, interpolating every channel by the same fraction. */
function pointAt(raw: readonly InkPoint[], s: number): InkPoint {
  const i = Math.min(raw.length - 2, Math.floor(s));
  const t = s - i;
  if (t < EPSILON) return raw[i];
  if (t > 1 - EPSILON) return raw[i + 1];
  const [a, b] = [raw[i], raw[i + 1]];
  const point: { -readonly [K in keyof InkPoint]: InkPoint[K] } = {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
  for (const key of ['pressure', 'tiltX', 'tiltY', 'time'] as const) {
    const value = blend(a[key], b[key], t);
    if (value !== undefined) point[key] = value;
  }
  return point;
}

/** The raw points of the slice from parameter `a` to `b`: two interpolated ends and the original points between. */
function sliceRaw(raw: readonly InkPoint[], [a, b]: Interval): InkPoint[] {
  const slice = [pointAt(raw, a)];
  for (let k = Math.floor(a) + 1; k < Math.ceil(b) && k < raw.length; k++) {
    if (k > a + EPSILON && k < b - EPSILON) slice.push(raw[k]);
  }
  slice.push(pointAt(raw, b));
  return slice;
}

/** A slice as a stroke. Its start time moves to its first point, so point times start near zero (spec 9.4). */
function sliceStroke<S extends Stroke>(stroke: S, points: InkPoint[], id: string): S {
  const first = points[0].time;
  if (first === undefined) return { ...stroke, id, points, origin: stroke.id };
  const shifted = points.map((p) => (p.time === undefined ? p : { ...p, time: p.time - first }));
  return { ...stroke, id, points: shifted, startTime: stroke.startTime + first, origin: stroke.id };
}

/**
 * Cuts one stroke at the capsules. Returns null when the eraser misses it, and an empty list when it wipes it out.
 * The test runs on the stroke's transformed centerline; the slices cut the raw points at the same fractions, which an
 * affine transform preserves, so they keep the stroke's transform.
 */
export function splitStroke<S extends Stroke>(
  stroke: S,
  capsules: readonly Capsule[],
  newId: () => string,
): S[] | null {
  const page = pagePoints(stroke);
  if (page.length === 1) {
    return capsules.some((c) => hitsDot(page[0], c)) ? [] : null;
  }
  const cuts = cutIntervals(page, capsules);
  if (cuts.length === 0) return null;
  const minLength = Math.max(MIN_SLICE_LENGTH, halfWidth(stroke));
  const parts: S[] = [];
  for (const range of keptRanges(cuts, page.length - 1)) {
    const raw = sliceRaw(stroke.points, range);
    if (polylineLength(applyToPoints(stroke.transform, raw)) < minLength) continue;
    parts.push(sliceStroke(stroke, raw, newId()));
  }
  return parts;
}

function hitsDot(p: { x: number; y: number }, c: Capsule): boolean {
  return segmentCapsuleInterval(p, p, c) !== null;
}

/** Runs the partial eraser over every stroke the capsules reach. The index is not changed. */
export function partialErase<S extends Stroke>(
  index: StrokeIndex,
  capsules: readonly Capsule[],
  newId: () => string,
): PartialEraseResult<S> {
  const removed: string[] = [];
  const added: S[] = [];
  for (const candidate of hitCapsules(index, capsules)) {
    const parts = splitStroke(candidate as S, capsules, newId);
    if (!parts) continue;
    removed.push(candidate.id);
    added.push(...parts);
  }
  return { removed, added };
}
