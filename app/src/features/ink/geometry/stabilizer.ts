// The steady pen (design 5.8): a One Euro filter removes jitter, then a "pulled string" lets the ink follow the pen
// only by the distance beyond a radius. Both depend only on the samples, so a recording replays to the same stroke.

import type { InkPoint, Vec } from './types';

export interface StabilizerOptions {
  /** Steady pen strength, 1 to 10. */
  readonly strength: number;
  /** Screen pixels per page unit, so the string feels the same at every zoom. */
  readonly zoom: number;
  /** The One Euro filter's lowest cutoff in hertz. Defaults to 1. */
  readonly minCutoff?: number;
  /** How much pen speed raises the cutoff. Defaults to 0.007. */
  readonly beta?: number;
  /** The gap between samples, in milliseconds, for points that carry no time. Defaults to 8. */
  readonly fallbackGapMs?: number;
}

export const PAGE_UNITS_PER_MM = 3.7795;
const STRING_MM_PER_STRENGTH = 0.6;
const DERIVATIVE_CUTOFF_HZ = 1;

/** The string's radius in page units: strength × 0.6 mm on screen. */
export function stringRadius(strength: number, zoom: number): number {
  return (strength * STRING_MM_PER_STRENGTH * PAGE_UNITS_PER_MM) / zoom;
}

function smoothingFactor(cutoffHz: number, gapSeconds: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / gapSeconds);
}

/** A One Euro filter for one axis. */
class OneEuro {
  private value = 0;
  private slope = 0;
  private started = false;

  constructor(
    private readonly minCutoff: number,
    private readonly beta: number,
  ) {}

  next(raw: number, gapSeconds: number): number {
    if (!this.started) {
      this.started = true;
      this.value = raw;
      return raw;
    }
    const rate = (raw - this.value) / gapSeconds;
    this.slope += smoothingFactor(DERIVATIVE_CUTOFF_HZ, gapSeconds) * (rate - this.slope);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.slope);
    this.value += smoothingFactor(cutoff, gapSeconds) * (raw - this.value);
    return this.value;
  }
}

/** A stabilizer for one stroke. Push each raw sample; call `finish` at pen-up for the closing segment. */
export interface Stabilizer {
  push(point: InkPoint): InkPoint;
  /** The raw last point, so the ink catches up to where the pen lifted, or null when nothing was pushed. */
  finish(): InkPoint | null;
}

export function createStabilizer(options: StabilizerOptions): Stabilizer {
  const radius = stringRadius(options.strength, options.zoom);
  const fallbackGap = (options.fallbackGapMs ?? 8) / 1000;
  const fx = new OneEuro(options.minCutoff ?? 1, options.beta ?? 0.007);
  const fy = new OneEuro(options.minCutoff ?? 1, options.beta ?? 0.007);
  let anchor: Vec | null = null;
  let lastTime: number | undefined;
  let last: InkPoint | null = null;

  return {
    push(point) {
      const gap =
        point.time !== undefined && lastTime !== undefined ? Math.max(point.time - lastTime, 0.5) / 1000 : fallbackGap;
      lastTime = point.time;
      last = point;
      const smooth = { x: fx.next(point.x, gap), y: fy.next(point.y, gap) };
      anchor = pull(anchor, smooth, radius);
      return { ...point, x: anchor.x, y: anchor.y };
    },
    finish: () => last,
  };
}

/** Moves the anchor toward the pen by the distance beyond the radius, and not at all inside it. */
function pull(anchor: Vec | null, pen: Vec, radius: number): Vec {
  if (!anchor) return pen;
  const d = Math.hypot(pen.x - anchor.x, pen.y - anchor.y);
  if (d <= radius) return anchor;
  const move = (d - radius) / d;
  return { x: anchor.x + (pen.x - anchor.x) * move, y: anchor.y + (pen.y - anchor.y) * move };
}

/** Steadies a whole stroke, then adds the raw last point so the ink reaches the lift point. */
export function stabilize(points: readonly InkPoint[], options: StabilizerOptions): InkPoint[] {
  const stabilizer = createStabilizer(options);
  const out = points.map((p) => stabilizer.push(p));
  const end = stabilizer.finish();
  const tail = out[out.length - 1];
  if (end && tail && (tail.x !== end.x || tail.y !== end.y)) out.push(end);
  return out;
}
