// Shape recognition (design 11.2): a stroke's points in, exact geometry and a confidence out, or null when the stroke
// is not clearly a line, arrow, rectangle, triangle, circle, or ellipse. It is pure, so it runs in the engine worker.

import { boundsOf } from '../bounds';
import { distance, polylineLength } from '../primitives';
import { resample, simplify } from '../simplify';
import type { Vec } from '../types';
import { arrowCandidate } from './arrow';
import { arcCandidate, closedExtras, curvedArrowCandidate, doubleArrowCandidate } from './extra';
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
/** The pen held still at the end trembles within this share of the stroke's box diagonal. */
const HOLD_REACH = 0.01;
/** Strokes that turn more than this, in total, are handwriting. */
const MAX_TURNING = 8 * Math.PI;
/** Turning is measured on the stroke simplified to this share of its box diagonal, so pen jitter does not add up. */
const TURNING_SIMPLIFY = 0.02;
/** A line's ends must be at least this share of its skeleton's length apart, so a scribble along a line is no line. */
const MIN_CHORD_SHARE = 0.8;
/** The loop of a closed stroke is looked for on the stroke spaced out to this many points. */
const LOOP_SAMPLES = 128;
/** A loop's ends may overlap by up to this share of the stroke at each end: a circle drawn on past its start. */
const OVERLAP_SHARE = 0.3;
/** Where the ends overlap, the later pass runs within this share of the box diagonal of the earlier one. */
const OVERLAP_REACH = 0.06;
/** The first and last points may hook away, up to this share of the stroke, where the pen lands and lifts. */
const HOOK_SHARE = 0.06;
/** A fit within this factor of the best counts as a tie, and the simpler shape wins. */
const TIE_FACTOR = 1.1;
/** A polygon with more corners must fit this much better than a simpler shape to win over it. */
const MANY_CORNERS_MARGIN = 0.6;
/**
 * And this much better than a round shape fits: a wobbly circle fits a pentagon or a hexagon well, but a drawn one
 * fits it several times better than any circle. A regular polygon must beat even a round fit too loose to accept; an
 * irregular one only a round shape that is accepted, since an irregular pentagon is often roundish.
 */
const ROUND_MARGIN = 0.4;
const DEFAULT_MIN_SIZE = 16;
const DEFAULT_WIDTH = 2;

/** The stroke's points without repeats, since pen samples at rest pile up at one spot. */
function withoutRepeats(points: readonly Vec[]): Vec[] {
  return points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
}

/**
 * The stroke without the pen's tremble while it is held still at the end, to ask for a shape: the last points that
 * stay within `reach` of where the pen stopped become that one point.
 */
function withoutHold(points: readonly Vec[], reach: number): Vec[] {
  const end = points[points.length - 1];
  let keep = points.length - 1;
  while (keep > 1 && distance(points[keep - 1], end) <= reach) keep--;
  return [...points.slice(0, keep), end];
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

/**
 * Whether a stroke's ends overlap as a loop drawn past its start would, for the loop from point `i` to point `j`.
 * After `j` the stroke runs on alongside the loop's start, and before `i` alongside its end. It runs point for point,
 * in the same direction. Only a short hook at either end may stray. A letter's tail or lead-in strays from the loop.
 */
function overlapsAt(p: readonly Vec[], i: number, j: number, reach: number, hook: number): boolean {
  const n = p.length;
  for (let k = 1; j + k < n - hook; k++) if (distance(p[j + k], p[i + k]) > reach) return false;
  for (let k = 1; i - k >= hook; k++) if (distance(p[i - k], p[j - k]) > reach) return false;
  return true;
}

/**
 * The stroke as `SAMPLES` points evenly spaced around a closed outline, or null when its ends are far apart. A stroke
 * that runs on past its start, or starts before where it closes, is cut to the loop where its ends come closest.
 */
export function closedOutline(points: readonly Vec[], size: number): Vec[] | null {
  const p = resample(points, LOOP_SAMPLES + 1);
  const n = p.length;
  const reach = OVERLAP_REACH * size;
  const hook = Math.round(HOOK_SHARE * n);
  const window = Math.round(OVERLAP_SHARE * n);
  let best: { i: number; j: number; gap: number } | null = null;
  for (let i = 0; i <= window; i++) {
    for (let j = n - 1 - window; j < n; j++) {
      const gap = distance(p[i], p[j]);
      if ((best && gap >= best.gap) || !overlapsAt(p, i, j, reach, hook)) continue;
      best = { i, j, gap };
    }
  }
  if (!best) return null;
  const loop = p.slice(best.i, best.j + 1);
  if (best.gap >= CLOSE_GAP * polylineLength(loop)) return null;
  return resample([...loop, loop[0]], SAMPLES + 1).slice(0, SAMPLES);
}

/** The closed outline's candidates, and how badly a round shape fits it (under 1 is a candidate), or Infinity. */
function closedCandidates(outline: readonly Vec[]): { candidates: Candidate[]; roundRatio: number } {
  const candidates = polygonCandidates(outline);
  const fit = fitEllipse(outline);
  if (fit && fit.error < ELLIPSE_TOLERANCE) {
    candidates.push({ shape: ellipseShape(fit), ratio: fit.error / ELLIPSE_TOLERANCE });
  }
  return { candidates, roundRatio: fit ? fit.error / ELLIPSE_TOLERANCE : Infinity };
}

/**
 * Drops the many-cornered shapes (regular polygons and irregular ones) that do not fit clearly better than a simpler
 * shape already found. More corners always fit a little better, and a wobbly circle fits a hexagon about as well,
 * but a triangle, a rectangle, or a circle is what was meant.
 */
function withoutLookalikes(extras: readonly Candidate[], found: readonly Candidate[], roundRatio: number): Candidate[] {
  const simpler = Math.min(...found.map((c) => c.ratio));
  const beatsRound = (c: Candidate) =>
    (c.shape.kind === 'freeform' && roundRatio >= 1) || c.ratio < ROUND_MARGIN * roundRatio;
  const wins = (c: Candidate) => c.ratio < MANY_CORNERS_MARGIN * simpler && beatsRound(c);
  return extras.filter((c) => (c.shape.kind !== 'polygon' && c.shape.kind !== 'freeform') || wins(c));
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
  const { minSize = DEFAULT_MIN_SIZE, width = DEFAULT_WIDTH, extra = false } = options;
  const drawn = withoutRepeats(points);
  const box = boundsOf(drawn);
  const diagonal = Math.hypot(box.maxX - box.minX, box.maxY - box.minY);
  const clean = drawn.length > 2 ? withoutHold(drawn, HOLD_REACH * diagonal) : drawn;
  if (clean.length < 3 || diagonal < minSize) return null;
  if (totalTurning(simplify(clean, TURNING_SIMPLIFY * diagonal)) > MAX_TURNING) return null;
  const outline = closedOutline(clean, diagonal);
  const closed = outline ? closedCandidates(outline) : null;
  const candidates = closed
    ? closed.candidates
    : [lineCandidate(clean, resample(clean, SAMPLES)), arrowCandidate(clean, diagonal, width)].filter(
        (c) => c !== null,
      );
  if (extra) {
    if (outline)
      candidates.push(...withoutLookalikes(closedExtras(outline), candidates, closed?.roundRatio ?? Infinity));
    else {
      const more = [
        doubleArrowCandidate(clean, diagonal, width),
        curvedArrowCandidate(clean, diagonal, width),
        arcCandidate(clean),
      ];
      candidates.push(...more.filter((c) => c !== null));
    }
  }
  const best = pickBest(candidates);
  if (!best) return null;
  return { shape: best.shape, points: shapePoints(best.shape), confidence: 1 - Math.min(1, best.ratio) / 2 };
}
