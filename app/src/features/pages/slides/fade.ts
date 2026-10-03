// Ink that fades, for presenting a page: strokes drawn over the page with a finger, a pen, or a mouse that dim and go
// after a moment, and the trail a laser pointer leaves. The marks are never part of the note. This is the pure part:
// a trail is points with times, and what is drawn at a moment follows from the times alone.

export interface TrailPoint {
  readonly x: number;
  readonly y: number;
  /** Milliseconds on the clock the caller reads, such as `performance.now()`. */
  readonly t: number;
}

export interface Trail {
  readonly points: readonly TrailPoint[];
  /** False while the pointer is still down and the trail is growing. */
  readonly done: boolean;
}

/** How long drawn ink stays, and how long a laser's trail lasts, in milliseconds. */
export const INK_LIFE = 2800;
export const LASER_LIFE = 380;
/** Ink holds at full strength for this share of its life, then fades out. */
const HOLD = 0.35;

/** How strong a mark that is `age` milliseconds old is, from 1 down to 0 at the end of its `life`. */
export function strength(age: number, life: number): number {
  if (age <= 0) return 1;
  if (age >= life) return 0;
  const held = life * HOLD;
  return age <= held ? 1 : 1 - (age - held) / (life - held);
}

export interface Segment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  readonly alpha: number;
}

/** The segments of a trail that are still visible at `now`, each as strong as its newer end. */
export function segments(trail: Trail, now: number, life: number): Segment[] {
  const out: Segment[] = [];
  const { points } = trail;
  for (let i = 1; i < points.length; i += 1) {
    const alpha = strength(now - points[i].t, life);
    if (alpha <= 0) continue;
    out.push({ x1: points[i - 1].x, y1: points[i - 1].y, x2: points[i].x, y2: points[i].y, alpha });
  }
  return out;
}

/** The trails that still show something at `now`. A trail that is growing always stays. */
export function alive(trails: readonly Trail[], now: number, life: number): Trail[] {
  return trails.filter((trail) => {
    const last = trail.points.at(-1);
    return last !== undefined && (!trail.done || now - last.t < life);
  });
}

/** Adds a point to the last trail, which a pointer move does. Points closer than `gap` to the last one are dropped. */
export function extend(trails: readonly Trail[], point: TrailPoint, gap = 1.5): Trail[] {
  const last = trails.at(-1);
  if (!last || last.done) return [...trails, { points: [point], done: false }];
  const end = last.points.at(-1)!;
  if (Math.hypot(point.x - end.x, point.y - end.y) < gap) return trails as Trail[];
  return [...trails.slice(0, -1), { points: [...last.points, point], done: false }];
}

/** Marks the last trail finished, which lifting the pointer does. */
export function finish(trails: readonly Trail[]): Trail[] {
  const last = trails.at(-1);
  if (!last || last.done) return trails as Trail[];
  return [...trails.slice(0, -1), { ...last, done: true }];
}
