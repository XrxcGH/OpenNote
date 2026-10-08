// Managed scroll, pan, and pinch (palm README, "Roles and gates"). Once a pen has been seen, page surfaces keep
// `touch-action: none`, so the page view moves the camera from script. This file holds the math: the delta for
// each move after a scroll or pan starts, the glide after a fling, and the total applied so a revert can undo it.
// Positions are client CSS px. It keeps no clock; every call carries the event time.

/** The last move's camera change: content moves by (dx, dy) and scales by `scale` about (cx, cy). */
export interface NavStep {
  dx: number;
  dy: number;
  scale: number;
  cx: number;
  cy: number;
}

/** Speeds below this (px per ms) end a fling at once. */
export const MIN_GLIDE_SPEED = 0.05;
/** A lift this long after the last move is a stop, not a fling. */
export const GLIDE_STALE_MS = 50;
/** Velocity kept per ms of glide, so a fling slows smoothly (about 0.6 s from 2 px/ms). */
export const GLIDE_FRICTION = 0.995;

interface Track {
  id: number;
  x: number;
  y: number;
  t: number;
  vx: number;
  vy: number;
}

const track = (): Track => ({ id: -1, x: 0, y: 0, t: 0, vx: 0, vy: 0 });

export class TouchNav {
  private readonly a = track();
  private readonly b = track();
  private pinch = false;
  /** Total pan and zoom applied since `begin`, so the page view can check a revert. */
  sumDx = 0;
  sumDy = 0;
  zoom = 1;
  readonly step: NavStep = { dx: 0, dy: 0, scale: 1, cx: 0, cy: 0 };

  /** Starts a one-finger scroll from where the finger is now, so the slop it crossed does not jump the page. */
  beginScroll(id: number, x: number, y: number, t: number): void {
    this.reset();
    this.set(this.a, id, x, y, t);
  }

  /** Starts a two-finger pan and pinch from both fingers' current positions. */
  beginPinch(
    ids: readonly [number, number],
    xs: readonly [number, number],
    ys: readonly [number, number],
    t: number,
  ): void {
    this.reset();
    this.set(this.a, ids[0], xs[0], ys[0], t);
    this.set(this.b, ids[1], xs[1], ys[1], t);
    this.pinch = true;
  }

  active(): boolean {
    return this.a.id >= 0;
  }

  owns(id: number): boolean {
    return id >= 0 && (this.a.id === id || this.b.id === id);
  }

  /** Moves one finger. Returns true with `step` filled when the camera should change. */
  move(id: number, x: number, y: number, t: number): boolean {
    const f = this.a.id === id ? this.a : this.b.id === id ? this.b : null;
    if (!f) return false;
    const s = this.step;
    if (!this.pinch) {
      s.dx = x - f.x;
      s.dy = y - f.y;
      s.scale = 1;
      s.cx = x;
      s.cy = y;
    } else {
      const o = f === this.a ? this.b : this.a;
      const before = Math.hypot(f.x - o.x, f.y - o.y);
      const after = Math.hypot(x - o.x, y - o.y);
      s.dx = (x - f.x) / 2;
      s.dy = (y - f.y) / 2;
      s.scale = before > 0 && after > 0 ? after / before : 1;
      s.cx = (x + o.x) / 2;
      s.cy = (y + o.y) / 2;
    }
    this.velocity(f, x, y, t);
    this.set(f, id, x, y, t);
    this.sumDx += s.dx;
    this.sumDy += s.dy;
    this.zoom *= s.scale;
    return s.dx !== 0 || s.dy !== 0 || s.scale !== 1;
  }

  /** The fling velocity at a lift in px per ms, or 0 when the finger had stopped. Ends the gesture. */
  end(id: number, t: number): { vx: number; vy: number } {
    const f = this.a.id === id ? this.a : this.b.id === id ? this.b : null;
    const fling = f !== null && !this.pinch && t - f.t <= GLIDE_STALE_MS && Math.hypot(f.vx, f.vy) >= MIN_GLIDE_SPEED;
    const out = fling ? { vx: f.vx, vy: f.vy } : { vx: 0, vy: 0 };
    this.reset();
    return out;
  }

  private velocity(f: Track, x: number, y: number, t: number): void {
    const dt = t - f.t;
    if (dt <= 0) return;
    const k = Math.min(1, dt / 32);
    f.vx += k * ((x - f.x) / dt - f.vx);
    f.vy += k * ((y - f.y) / dt - f.vy);
  }

  private set(f: Track, id: number, x: number, y: number, t: number): void {
    f.id = id;
    f.x = x;
    f.y = y;
    f.t = t;
  }

  private reset(): void {
    Object.assign(this.a, track());
    Object.assign(this.b, track());
    this.pinch = false;
    this.sumDx = this.sumDy = 0;
    this.zoom = 1;
  }
}

/** The distance a fling travels in `ms` from velocity `v` (px per ms) with per-ms friction, and its speed then. */
export function glide(v: number, ms: number, friction = GLIDE_FRICTION): { distance: number; speed: number } {
  const kept = friction ** ms;
  return { distance: (v * (1 - kept)) / (1 - friction), speed: v * kept };
}
