// Arrows drawn in one stroke (design 11.3): a straight shaft, then a head drawn as tip to one barb, back to the tip,
// then to the other barb. Simplified, the stroke has the vertices shaft..., tip, barb, tip, barb.

import { distance } from '../primitives';
import { simplify } from '../simplify';
import type { Vec } from '../types';
import { fitLine, LINE_TOLERANCE, snapSegment } from './lines';
import type { Candidate } from './types';

const DEGREES = Math.PI / 180;
/** Barbs lie 15 to 60 degrees off the shaft. */
const MIN_BARB_ANGLE = 15 * DEGREES;
const MAX_BARB_ANGLE = 60 * DEGREES;
/** A drawn arrow's barbs may differ in length by this factor at most. */
const MAX_BARB_RATIO = 2.5;
/** The two visits to the tip may be this far apart, as a share of the shorter barb. */
const MAX_TIP_GAP = 0.5;
/** The head may be no longer than this share of the shaft. */
const MAX_HEAD_SHARE = 0.6;
/** The stroke is simplified to this share of its box diagonal before looking for the head. */
const SIMPLIFY_SHARE = 0.03;
/** The drawn head has barbs at this angle from the shaft. */
const HEAD_ANGLE = 30 * DEGREES;
const MIN_HEAD_LENGTH = 10;
const HEAD_WIDTHS = 4;

function unit(from: Vec, to: Vec): Vec {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
}

/** The angle between a barb and the way back along the shaft, or Infinity when the barb has no length. */
function barbAngle(tip: Vec, barb: Vec, shaft: Vec): number {
  const length = Math.hypot(barb.x - tip.x, barb.y - tip.y);
  if (length === 0) return Infinity;
  return Math.acos(Math.max(-1, Math.min(1, (-(barb.x - tip.x) * shaft.x - (barb.y - tip.y) * shaft.y) / length)));
}

function side(tip: Vec, barb: Vec, shaft: Vec): number {
  return Math.sign(shaft.x * (barb.y - tip.y) - shaft.y * (barb.x - tip.x));
}

/** How well the head looks like two barbs at a tip, as a ratio under 1 when it does, or Infinity when it does not. */
function headRatio(tip: Vec, tipAgain: Vec, barbs: readonly [Vec, Vec], shaft: Vec, shaftLength: number): number {
  const first = barbAngle(tip, barbs[0], shaft);
  const second = barbAngle(tipAgain, barbs[1], shaft);
  if ([first, second].some((a) => a < MIN_BARB_ANGLE || a > MAX_BARB_ANGLE)) return Infinity;
  if (side(tip, barbs[0], shaft) * side(tipAgain, barbs[1], shaft) >= 0) return Infinity;
  const arms = [distance(tip, barbs[0]), distance(tipAgain, barbs[1])];
  const [short, long] = [Math.min(...arms), Math.max(...arms)];
  if (short === 0 || long / short > MAX_BARB_RATIO || long > MAX_HEAD_SHARE * shaftLength) return Infinity;
  return distance(tip, tipAgain) / (MAX_TIP_GAP * short);
}

/** The two barbs of a head at `tip` on an arrow that points along the unit vector `shaft`, `length` long. */
export function headBarbs(tip: Vec, shaft: Vec, length: number): readonly [Vec, Vec] {
  return drawnBarbs(tip, shaft, length);
}

/** The arrow's polyline-ready geometry: shaft end to end, and barbs at 30 degrees, sized to the stroke width. */
function drawnBarbs(tip: Vec, shaft: Vec, length: number): readonly [Vec, Vec] {
  const back = (sign: number): Vec => {
    const cos = Math.cos(HEAD_ANGLE);
    const sin = Math.sin(HEAD_ANGLE) * sign;
    return {
      x: tip.x - length * (shaft.x * cos - shaft.y * sin),
      y: tip.y - length * (shaft.x * sin + shaft.y * cos),
    };
  };
  return [back(1), back(-1)];
}

/**
 * Looks for a single-stroke arrow. `size` is the diagonal of the stroke's box and `width` its pen width, which
 * sizes the redrawn head. Returns null when the stroke is not an arrow.
 */
export function arrowCandidate(points: readonly Vec[], size: number, width: number): Candidate | null {
  const vertices = simplify(points, SIMPLIFY_SHARE * size);
  if (vertices.length < 5) return null;
  const [tip, barb1, tipAgain, barb2] = vertices.slice(-4);
  const shaftPoints = points.slice(0, points.indexOf(tip) + 1);
  const shaftFit = fitLine(shaftPoints);
  if (!shaftFit || shaftFit.length <= 0) return null;
  const lineRatio = shaftFit.maxDeviation / (LINE_TOLERANCE * shaftFit.length);
  const shaft = unit(shaftFit.from, shaftFit.to);
  const ratio = Math.max(lineRatio, headRatio(tip, tipAgain, [barb1, barb2], shaft, shaftFit.length));
  if (!(ratio < 1)) return null;
  const [from, end] = snapSegment(shaftFit.from, shaftFit.to);
  const direction = unit(from, end);
  const armLength = Math.min(
    MAX_HEAD_SHARE * shaftFit.length,
    Math.max(MIN_HEAD_LENGTH, HEAD_WIDTHS * width, distance(tip, barb1)),
  );
  return { shape: { kind: 'arrow', from, tip: end, barbs: drawnBarbs(end, direction, armLength) }, ratio };
}
