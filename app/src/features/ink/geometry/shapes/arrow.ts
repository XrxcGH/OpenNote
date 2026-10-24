// Arrows drawn in one stroke (design 11.3): a straight shaft, then a head drawn as tip to one barb, back to the tip,
// then to the other barb. The tip and the first barb are where the path turns sharply. The return to the tip turns
// gently once a hand rounds it, so it is found as where the pen comes back nearest the tip.
// A hand rounds and hooks past turns, and lands and lifts with small hooks. Its samples carry digitizer noise. So:
// - the noise is smoothed away first;
// - turns are measured across a stretch of the path, and close turns count as one;
// - turns at the very ends do not count.
// The same head parser reads a curved arrow's head and both heads of a double arrow (extra.ts).

import { boundsOf } from '../bounds';
import { distance } from '../primitives';
import { resample, simplify } from '../simplify';
import type { Vec } from '../types';
import { fitLine, LINE_TOLERANCE, snapSegment } from './lines';
import type { Candidate } from './types';

const DEGREES = Math.PI / 180;
/**
 * Barbs lie 5 to 80 degrees off the shaft. A hand means them at 20 to 45 degrees, but places a short barb's end
 * a good share of its length off, so a drawn barb lies anywhere from nearly along the shaft to nearly across it.
 */
const MIN_BARB_ANGLE = 5 * DEGREES;
const MAX_BARB_ANGLE = 80 * DEGREES;
/** A drawn arrow's barbs may differ in length by this factor at most. */
const MAX_BARB_RATIO = 2.5;
/** The two visits to the tip may be this far apart, as a share of the barbs' mean length. */
const MAX_TIP_GAP = 0.75;
/** The head may be no longer than this share of the shaft. */
const MAX_HEAD_SHARE = 0.6;
/** Samples wander from the pen's true path by up to about this many units, or this share of the stroke's size. */
const DIGITIZER_NOISE = 1;
const NOISE_SHARE = 0.008;
/** The path is spaced out to this many points to find its sharp turns. */
const HEAD_SAMPLES = 120;
/** A turn is measured across this share of the path on each side of a point. */
const TURN_REACH = 0.025;
/** Where the path turns more than this, it has a corner of a head: the tip, a barb, or the tip again. */
const SHARP_TURN = 75 * DEGREES;
/** Sharp turns closer than this share of the path are one corner, such as one the pen hooked round. */
const SAME_TURN = 0.04;
/** Turns this near the end, as a share of the path, are the pen landing or lifting, and no corner. */
const END_HOOK = 0.04;
/** A shaft may turn sharply only this near its start, where the pen lands. */
const LANDING = 0.08;
/** Sharp turns this near the end, as a share of the path, are the pen flicking off as it lifts. */
const LIFTING = 0.06;
/** The shaft is fitted short of the tip by this share of the path, where the pen rounds the turn into the head. */
const NEAR_TIP = 0.02;
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
  return distance(tip, tipAgain) / (MAX_TIP_GAP * ((short + long) / 2));
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

/** A head drawn in the stroke: its tip, its barbs, and where the pen came back to the tip between them. */
export interface DrawnHead {
  readonly tip: Vec;
  readonly again: Vec;
  readonly barbs: readonly [Vec, Vec];
}

/** How far the path turns at each point, measured across `reach` points on each side; 0 near the ends. */
function turnsAlong(p: readonly Vec[], reach: number): number[] {
  return p.map((b, i) => {
    if (i < reach || i + reach >= p.length) return 0;
    const a = p[i - reach];
    const c = p[i + reach];
    const ux = b.x - a.x;
    const uy = b.y - a.y;
    const vx = c.x - b.x;
    const vy = c.y - b.y;
    return Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy));
  });
}

/** The path spaced out evenly, and the points where it turns sharply, in path order. */
export function sharpTurns(points: readonly Vec[]): { path: Vec[]; at: number[] } {
  // The digitizer's noise is smoothed away first. Where the pen moves slowly its samples crowd together, and the
  // noise between them zigzags. Spaced out evenly, that zigzag would read as sharp turns.
  const box = boundsOf(points);
  const noise = Math.max(DIGITIZER_NOISE, NOISE_SHARE * Math.hypot(box.maxX - box.minX, box.maxY - box.minY));
  const path = resample(simplify(points, noise), HEAD_SAMPLES);
  const n = path.length;
  const turns = turnsAlong(path, Math.max(2, Math.round(TURN_REACH * n)));
  const hook = Math.round(END_HOOK * n);
  const at: number[] = [];
  for (let i = hook; i < n - hook; i++) {
    if (turns[i] < SHARP_TURN || turns[i] < turns[i - 1] || turns[i] <= turns[i + 1]) continue;
    const last = at[at.length - 1];
    if (last !== undefined && i - last < SAME_TURN * n) {
      if (turns[i] > turns[last]) at[at.length - 1] = i;
    } else at.push(i);
  }
  return { path, at };
}

/** The index of the point of `path` from `from` to `to` (inclusive) nearest to `origin`, or farthest from it. */
function extreme(path: readonly Vec[], from: number, to: number, origin: Vec, far: boolean): number {
  let best = from;
  for (let i = from; i <= to; i++) {
    const d = distance(path[i], origin) - distance(path[best], origin);
    if (far ? d > 0 : d < 0) best = i;
  }
  return best;
}

/** A head drawn at the end of a path: its geometry, its tip's index, and how many sharp turns come before the tip. */
export interface EndHead {
  readonly head: DrawnHead;
  readonly tipAt: number;
  readonly before: number;
}

/**
 * The heads the end of `path` may hold, given its sharp turns `at`. The tip and the first barb are two sharp turns in
 * a row. After them only the return to the tip may turn sharply, wherever the hand placed it. The return turns by 180
 * degrees less both barbs' angles, which a hand rounds into a gentle turn. So it is found as where the pen comes
 * nearest the tip again.
 */
export function endHeads(path: readonly Vec[], at: readonly number[]): EndHead[] {
  const out: EndHead[] = [];
  const last = path.length - 1;
  // Turns near the end are the pen flicking off as it lifts, and no part of the head.
  const body = at.filter((i) => i < (1 - LIFTING) * path.length);
  for (let m = body.length - 2; m >= 0 && m >= body.length - 3; m--) {
    const tipAt = body[m];
    const tip = path[tipAt];
    const againAt = extreme(path, body[m + 1], last, tip, false);
    const again = path[againAt];
    const barbs: [Vec, Vec] = [
      path[extreme(path, tipAt, againAt, tip, true)],
      path[extreme(path, againAt, last, again, true)],
    ];
    out.push({ head: { tip, again, barbs }, tipAt, before: m });
  }
  return out;
}

/** How well a head fits a shaft that ends at its tip going along `shaft`: under 1 when it does, else Infinity. */
export function headFitRatio(head: DrawnHead, shaft: Vec, shaftLength: number): number {
  return headRatio(head.tip, head.again, head.barbs, shaft, shaftLength);
}

/**
 * The shaft's line, fitted to the path from `fitFrom` to the tip at `tipAt`, and running from where point `startAt`
 * lies along it to the tip; or null. Next to a tip at `startAt` (a double arrow's), `tipStart` leaves out the stretch
 * where the pen rounds the turn, as at the far tip.
 */
export function shaftLine(
  path: readonly Vec[],
  fitFrom: number,
  tipAt: number,
  startAt = fitFrom,
  tipStart = false,
): { from: Vec; to: Vec; length: number; ratio: number } | null {
  // The stretch next to a tip is left out of the fit: the pen rounds the turn into the head there.
  const trim = Math.round(NEAR_TIP * path.length);
  const first = tipStart ? fitFrom + trim : fitFrom;
  const fit = fitLine(path.slice(first, Math.max(first + 2, tipAt - trim) + 1));
  if (!fit || fit.length <= 0) return null;
  const dir = unit(fit.from, fit.to);
  const onLine = (p: Vec): Vec => {
    const along = (p.x - fit.from.x) * dir.x + (p.y - fit.from.y) * dir.y;
    return { x: fit.from.x + dir.x * along, y: fit.from.y + dir.y * along };
  };
  const start = onLine(path[startAt]);
  const end = onLine(path[tipAt]);
  const length = (end.x - start.x) * dir.x + (end.y - start.y) * dir.y;
  if (length <= 0) return null;
  return { from: start, to: end, length, ratio: fit.maxDeviation / (LINE_TOLERANCE * length) };
}

/** Whether the path turns sharply nowhere before index `before` of `at` but where the pen landed. */
export function onlyLanding(path: readonly Vec[], at: readonly number[], before: number): boolean {
  return at.slice(0, before).every((i) => i <= LANDING * path.length);
}

/** Where the pen's landing ends: at its last sharp turn, or at the start. */
export function landed(at: readonly number[], before: number): number {
  return before > 0 ? at[before - 1] : 0;
}

/** Where a shaft is fitted from, leaving out the pen's landing: after its sharp turns, and a little way in. */
export function afterLanding(at: readonly number[], before: number, tipAt: number): number {
  return Math.max(landed(at, before), Math.round(LANDING * tipAt));
}

/** How long to redraw a head's barbs: as drawn, but no shorter than a few pen widths and no longer than its share. */
export function headLength(head: DrawnHead, width: number, shaftLength: number): number {
  return Math.min(
    MAX_HEAD_SHARE * shaftLength,
    Math.max(MIN_HEAD_LENGTH, HEAD_WIDTHS * width, distance(head.tip, head.barbs[0])),
  );
}

/**
 * Looks for a single-stroke arrow. `size` is the diagonal of the stroke's box and `width` its pen width, which
 * sizes the redrawn head. Returns null when the stroke is not an arrow.
 */
export function arrowCandidate(points: readonly Vec[], _size: number, width: number): Candidate | null {
  const { path, at } = sharpTurns(points);
  let best: Candidate | null = null;
  for (const { head, tipAt, before } of endHeads(path, at)) {
    // The shaft turns sharply nowhere but where the pen landed, and is fitted without that first stretch.
    if (!onlyLanding(path, at, before)) continue;
    const shaftFit = shaftLine(path, afterLanding(at, before, tipAt), tipAt, landed(at, before));
    if (!shaftFit) continue;
    const ratio = Math.max(shaftFit.ratio, headFitRatio(head, unit(shaftFit.from, shaftFit.to), shaftFit.length));
    if (!(ratio < 1) || (best && best.ratio <= ratio)) continue;
    const [from, end] = snapSegment(shaftFit.from, shaftFit.to);
    const barbs = drawnBarbs(end, unit(from, end), headLength(head, width, shaftFit.length));
    best = { shape: { kind: 'arrow', from, tip: end, barbs }, ratio };
  }
  return best;
}
