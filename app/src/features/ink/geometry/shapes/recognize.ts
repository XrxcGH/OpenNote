// Shape recognition (design 11.2): a stroke's points in, exact geometry and a confidence out, or null when the stroke
// is not clearly a line, arrow, rectangle, triangle, circle, or ellipse. It is pure, so it runs in the engine worker.

import { boundsOf } from '../bounds';
import { distance, pointSegmentDistanceSq, polylineLength, segmentsIntersect } from '../primitives';
import { resample, simplify } from '../simplify';
import type { Vec } from '../types';
import { arrowCandidate } from './arrow';
import { ELLIPSE_TOLERANCE, ellipseShape, fitEllipse } from './ellipse';
import { shapePoints } from './generate';
import { fitLine, LINE_TOLERANCE, snapSegment } from './lines';
import { polygonCandidates } from './polygons';
import { SIMPLICITY } from './types';
import type { Candidate, RecognizeOptions, ShapeMatch } from './types';

/** Fits work on this many points, evenly spaced along the stroke. */
const SAMPLES = 64;
/** A stroke is closed when its ends are this close, as a share of its length. */
const CLOSE_GAP = 0.1;
/** Strokes that turn more than this, in total, are handwriting. */
const MAX_TURNING = 6 * Math.PI;
/** Turning is measured on the stroke simplified to this share of its box diagonal, so pen jitter does not add up. */
const TURNING_SIMPLIFY = 0.02;
/** A line's ends must be at least this share of its skeleton's length apart, so a scribble along a line is no line. */
const MIN_CHORD_SHARE = 0.8;
/** An end that stays this close to the start, as a share of the stroke's box diagonal, retraces it. */
const RETRACE_SHARE = 0.04;
/** How far from each end of a closed stroke to look for the ends crossing, in samples. */
const OVERSHOOT_WINDOW = 10;
/** A fit within this factor of the best counts as a tie, and the simpler shape wins. */
const TIE_FACTOR = 1.1;
const DEFAULT_MIN_SIZE = 16;
const DEFAULT_WIDTH = 2;

/** The stroke's points without repeats, since pen samples at rest pile up at one spot. */
function withoutRepeats(points: readonly Vec[]): Vec[] {
  return points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
}

function totalTurning(points: readonly Vec[]): number {
  let total = 0;
  for (let i = 2; i < points.length; i++) {
    const a = Math.atan2(points[i - 1].y - points[i - 2].y, points[i - 1].x - points[i - 2].x);
    const b = Math.atan2(points[i].y - points[i - 1].y, points[i].x - points[i - 1].x);
    let turn = Math.abs(b - a);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    total += turn;
  }
  return total;
}

/** Where two segments that cross meet. */
function crossingPoint(a1: Vec, a2: Vec, b1: Vec, b2: Vec): Vec {
  const dax = a2.x - a1.x;
  const day = a2.y - a1.y;
  const t =
    ((b1.x - a1.x) * (b2.y - b1.y) - (b1.y - a1.y) * (b2.x - b1.x)) / (dax * (b2.y - b1.y) - day * (b2.x - b1.x));
  return { x: a1.x + dax * t, y: a1.y + day * t };
}

/** Cuts off an end that retraces the start of the loop: the last points that lie on the first few segments. */
function trimRetrace(points: readonly Vec[], tolerance: number): Vec[] {
  const head = points.slice(0, OVERSHOOT_WINDOW + 1);
  const onHead = (p: Vec) =>
    head.slice(1).some((q, i) => pointSegmentDistanceSq(p, head[i], q) <= tolerance * tolerance);
  let keep = points.length;
  while (keep > head.length + 1 && onHead(points[keep - 1])) keep--;
  return points.slice(0, Math.min(points.length, keep + 1));
}

/**
 * Cuts off the overshoot of a loop whose end runs past its start. Where the end crosses the start, the ends are
 * replaced by the crossing. Where it retraces the start, the retraced points are dropped.
 */
function trimOvershoot(points: readonly Vec[], tolerance: number): Vec[] {
  const n = points.length;
  for (let i = 0; i < Math.min(OVERSHOOT_WINDOW, n - 2); i++) {
    for (let j = n - 2; j > Math.max(i + 1, n - 2 - OVERSHOOT_WINDOW); j--) {
      if (!segmentsIntersect(points[i], points[i + 1], points[j], points[j + 1])) continue;
      const cross = crossingPoint(points[i], points[i + 1], points[j], points[j + 1]);
      return [cross, ...points.slice(i + 1, j + 1), cross];
    }
  }
  return trimRetrace(points, tolerance);
}

/** The stroke as `SAMPLES` points evenly spaced around a closed outline, or null when its ends are far apart. */
function closedOutline(points: readonly Vec[], size: number): Vec[] | null {
  const trimmed = trimOvershoot(resample(points, SAMPLES + 1), RETRACE_SHARE * size);
  if (distance(trimmed[0], trimmed[trimmed.length - 1]) >= CLOSE_GAP * polylineLength(trimmed)) return null;
  return resample([...trimmed, trimmed[0]], SAMPLES + 1).slice(0, SAMPLES);
}

function closedCandidates(outline: readonly Vec[]): Candidate[] {
  const candidates = polygonCandidates(outline);
  const fit = fitEllipse(outline);
  if (fit && fit.error < ELLIPSE_TOLERANCE) {
    candidates.push({ shape: ellipseShape(fit), ratio: fit.error / ELLIPSE_TOLERANCE });
  }
  return candidates;
}

function lineCandidate(points: readonly Vec[], even: readonly Vec[]): Candidate | null {
  const fit = fitLine(even);
  if (!fit || fit.length <= 0) return null;
  const skeleton = polylineLength(simplify(points, LINE_TOLERANCE * fit.length));
  if (fit.length < MIN_CHORD_SHARE * skeleton) return null;
  const ratio = fit.maxDeviation / (LINE_TOLERANCE * fit.length);
  if (!(ratio < 1)) return null;
  const [from, to] = snapSegment(fit.from, fit.to);
  return { shape: { kind: 'line', from, to }, ratio };
}

/** The best fit: the lowest error, except that a simpler shape within 10% of it wins. */
function pickBest(candidates: readonly Candidate[]): Candidate | null {
  if (candidates.length === 0) return null;
  const lowest = Math.min(...candidates.map((c) => c.ratio));
  const close = candidates.filter((c) => c.ratio <= lowest * TIE_FACTOR);
  return close.reduce((best, c) => (SIMPLICITY[c.shape.kind] < SIMPLICITY[best.shape.kind] ? c : best));
}

/**
 * Recognizes a shape in a stroke's page-space points. Returns the exact geometry, ready to store as a stroke, and a
 * confidence from 0.5 (barely accepted) to 1 (exact). Lines snap to 15 degree steps near horizontal and vertical.
 */
export function recognizeShape(points: readonly Vec[], options: RecognizeOptions = {}): ShapeMatch | null {
  const { minSize = DEFAULT_MIN_SIZE, width = DEFAULT_WIDTH } = options;
  const clean = withoutRepeats(points);
  const box = boundsOf(clean);
  const diagonal = Math.hypot(box.maxX - box.minX, box.maxY - box.minY);
  if (clean.length < 3 || diagonal < minSize) return null;
  if (totalTurning(simplify(clean, TURNING_SIMPLIFY * diagonal)) > MAX_TURNING) return null;
  const outline = closedOutline(clean, diagonal);
  const candidates = outline
    ? closedCandidates(outline)
    : [lineCandidate(clean, resample(clean, SAMPLES)), arrowCandidate(clean, diagonal, width)].filter(
        (c) => c !== null,
      );
  const best = pickBest(candidates);
  if (!best) return null;
  return { shape: best.shape, points: shapePoints(best.shape), confidence: 1 - Math.min(1, best.ratio) / 2 };
}
