// Adaptive sampling: turns a function of x into the polylines to draw. It starts from an uneven grid of samples and
// splits any interval where the curve bends away from a straight line by more than a fraction of a pixel. A gap where
// the function is undefined, a jump, or an asymptote ends one segment and starts the next, so the graph never draws a
// line across a pole.

import type { Point, Segment, Size, Viewport } from './types';

export interface SampleOptions {
  /** How many intervals to start with across the x range. */
  readonly initialSamples?: number;
  /** How many times one interval may be halved. Also how close to a jump or a domain edge the curve gets. */
  readonly maxDepth?: number;
  /** The largest pixel gap allowed between the curve and a straight line across one interval. */
  readonly tolerancePx?: number;
  /** A jump bigger than this many pixels, left after the finest split, is a break in the curve. */
  readonly jumpPx?: number;
  /** A limit on function calls, so a wild curve such as sin(1/x) can't stall the page. */
  readonly maxEvaluations?: number;
  /** How far past each side of the view to sample, as a fraction of the width, so the line reaches the edges. */
  readonly overscan?: number;
}

const DEFAULTS: Required<SampleOptions> = {
  initialSamples: 256,
  maxDepth: 12,
  tolerancePx: 0.25,
  jumpPx: 2,
  maxEvaluations: 40000,
  overscan: 0.01,
};

/** The fraction of the golden ratio, which spreads the starting samples without a repeating pattern. */
const GOLDEN = 0.6180339887498949;

function isFinitePoint(p: Point): boolean {
  return Number.isFinite(p.y);
}

class Sampler {
  private evaluations = 0;
  private readonly segments: Point[][] = [];
  private current: Point[] = [];
  private readonly pxPerY: number;
  private readonly top: number;
  private readonly bottom: number;

  constructor(
    private readonly f: (x: number) => number,
    view: Viewport,
    size: Size,
    private readonly o: Required<SampleOptions>,
  ) {
    const height = view.yMax - view.yMin;
    this.pxPerY = size.height / height;
    this.top = view.yMax + height;
    this.bottom = view.yMin - height;
  }

  run(xMin: number, xMax: number): Segment[] {
    const xs = this.startingXs(xMin, xMax);
    let previous = this.sample(xs[0]);
    this.add(previous);
    for (let i = 1; i < xs.length; i += 1) {
      const next = this.sample(xs[i]);
      this.refine(previous, next, 0);
      previous = next;
    }
    this.endSegment();
    return this.segments;
  }

  private startingXs(xMin: number, xMax: number): number[] {
    const count = this.o.initialSamples;
    const step = (xMax - xMin) / count;
    const xs = [xMin];
    for (let i = 1; i < count; i += 1) xs.push(xMin + (i + (((i * GOLDEN) % 1) - 0.5) * 0.5) * step);
    xs.push(xMax);
    return xs;
  }

  private sample(x: number): Point {
    this.evaluations += 1;
    return { x, y: this.f(x) };
  }

  private add(p: Point): void {
    if (isFinitePoint(p)) this.current.push(p);
  }

  private endSegment(): void {
    if (this.current.length >= 2) this.segments.push(this.current);
    this.current = [];
  }

  /** Adds the points between `a` (already added) and `b`, including `b`. */
  private refine(a: Point, b: Point, depth: number): void {
    const atLimit = depth >= this.o.maxDepth || this.evaluations >= this.o.maxEvaluations;
    if (!atLimit) {
      const m = this.sample((a.x + b.x) / 2);
      if (this.needsSplit(a, m, b)) {
        this.refine(a, m, depth + 1);
        this.refine(m, b, depth + 1);
        return;
      }
    }
    this.connect(a, b, depth >= this.o.maxDepth);
  }

  private needsSplit(a: Point, m: Point, b: Point): boolean {
    const finite = [a, m, b].filter(isFinitePoint).length;
    if (finite === 0) return false;
    if (finite < 3) return true;
    const high = a.y > this.top && m.y > this.top && b.y > this.top;
    const low = a.y < this.bottom && m.y < this.bottom && b.y < this.bottom;
    if (high || low) return false;
    return Math.abs(m.y - (a.y + b.y) / 2) * this.pxPerY > this.o.tolerancePx;
  }

  /** Joins `a` to `b` unless the function is undefined on one side, or jumps at the finest split. */
  private connect(a: Point, b: Point, finest: boolean): void {
    const aOk = isFinitePoint(a);
    const bOk = isFinitePoint(b);
    if (aOk && bOk) {
      if (finest && Math.abs(b.y - a.y) * this.pxPerY > this.o.jumpPx) this.endSegment();
      this.add(b);
    } else if (aOk || bOk) {
      this.endSegment();
      this.add(b);
    }
  }
}

/**
 * The polylines of y = f(x) across the view, in graph coordinates. Points where f is NaN or infinite leave a gap.
 * Nothing is clipped to the view's y range: see `clipToView` in path.ts for that.
 */
export function sampleFunction(
  f: (x: number) => number,
  view: Viewport,
  size: Size,
  options: SampleOptions = {},
): Segment[] {
  const o = { ...DEFAULTS, ...options };
  const span = view.xMax - view.xMin;
  const validView = span > 0 && view.yMax > view.yMin && size.width > 0 && size.height > 0;
  if (!validView || !Number.isFinite(span)) return [];
  const pad = span * o.overscan;
  return new Sampler(f, view, size, o).run(view.xMin - pad, view.xMax + pad);
}
