// The hand region (Vogel et al. [S30]): a circle plus a forearm strip, anchored to the pen tip, or to the drawing
// contact in finger and passive stylus drawing. It is seeded from what is known, set from the pen's lean, and learned
// from where confirmed palms land. A left hand mirrors a right one.

import type { HandShape } from './settings';
import { clamp, FAR_OUTSIDE_MM, FAR_SIDE_MM, FOREARM_HALF_MM, LEAN_FLIP_STROKES, LEAN_MIN_DEG } from './thresholds';
import { LEAN_OFFSET_MM, LEAN_WEIGHT, LEARN_RATE, RADIUS_MAX_MM, RADIUS_MIN_MM } from './thresholds';
import { REGION_FALLOFF_MM, TIP_GRIP_MM } from './thresholds';

const DEG = Math.PI / 180;

/** The lean of a pen as a unit vector from the tip toward the hand, or false when it leans under 15 degrees. */
export function leanOf(tiltX: number, tiltY: number, out: { x: number; y: number }): boolean {
  if (!Number.isFinite(tiltX) || !Number.isFinite(tiltY)) return false;
  const lx = Math.tan(clamp(tiltX, -89, 89) * DEG);
  const ly = Math.tan(clamp(tiltY, -89, 89) * DEG);
  const len = Math.hypot(lx, ly);
  if (len < Math.tan(LEAN_MIN_DEG * DEG)) return false;
  out.x = lx / len;
  out.y = ly / len;
  return true;
}

export class HandRegion {
  ox: number;
  oy: number;
  r: number;
  /** An explicit setting pins the side of the hand unless the lean says otherwise for 5 strokes running. */
  pinned = false;
  private contrary = 0;
  /** True once set from a lean, a setting, or learning, rather than the default. */
  seeded = false;

  constructor(base: HandShape) {
    this.ox = base.ox;
    this.oy = base.oy;
    this.r = base.r;
  }

  set(shape: HandShape, pinned: boolean): void {
    this.ox = shape.ox;
    this.oy = shape.oy;
    this.r = clamp(shape.r, RADIUS_MIN_MM, RADIUS_MAX_MM);
    this.pinned = pinned;
    this.contrary = 0;
  }

  shape(): HandShape {
    return { ox: this.ox, oy: this.oy, r: this.r };
  }

  /** How much a point (mm) is in the hand of a pen at the tip: 1 inside, falling to 0 over 25 mm outside. */
  membership(cx: number, cy: number, tipX: number, tipY: number): number {
    const dx = cx - tipX;
    const dy = cy - tipY;
    if (dx * dx + dy * dy <= TIP_GRIP_MM * TIP_GRIP_MM) return 1;
    const outside = this.outside(cx, cy, tipX, tipY);
    return outside <= 0 ? 1 : Math.max(0, 1 - outside / REGION_FALLOFF_MM);
  }

  /** How far outside the region a point lies; inside the circle or the forearm strip it is 0. */
  outside(cx: number, cy: number, tipX: number, tipY: number): number {
    const ex = cx - tipX - this.ox;
    const ey = cy - tipY - this.oy;
    const dist = Math.hypot(ex, ey);
    if (dist <= this.r) return 0;
    const len = Math.hypot(this.ox, this.oy) || 1;
    const along = (ex * this.ox + ey * this.oy) / len;
    const across = Math.abs(ex * -this.oy + ey * this.ox) / len;
    if (along > 0 && across <= FOREARM_HALF_MM) return 0;
    return dist - this.r;
  }

  /** E6: on the far side of the tip from the hand, or well outside the region. */
  farFrom(cx: number, cy: number, tipX: number, tipY: number): boolean {
    const len = Math.hypot(this.ox, this.oy) || 1;
    const along = ((cx - tipX) * this.ox + (cy - tipY) * this.oy) / len;
    return along < -FAR_SIDE_MM || this.outside(cx, cy, tipX, tipY) > FAR_OUTSIDE_MM;
  }

  /** Blends in a stroke's lean. Unseeded, the lean sets the offset at once. */
  lean(ux: number, uy: number): void {
    const tx = ux * LEAN_OFFSET_MM;
    const ty = uy * LEAN_OFFSET_MM;
    if (!this.seeded) {
      this.ox = tx;
      this.oy = ty;
      this.seeded = true;
      return;
    }
    if (this.pinned && Math.sign(tx) !== Math.sign(this.ox) && Math.abs(tx) > 10) {
      if (++this.contrary < LEAN_FLIP_STROKES) return;
      this.pinned = false;
    } else {
      this.contrary = 0;
    }
    this.ox += LEAN_WEIGHT * (tx - this.ox);
    this.oy += LEAN_WEIGHT * (ty - this.oy);
  }

  /** Learns from a palm's mean offset from the anchor while both were down. */
  learn(mx: number, my: number): void {
    if (this.pinned && Math.sign(mx) !== Math.sign(this.ox) && Math.abs(mx) > 10) return;
    const miss = Math.hypot(mx - this.ox, my - this.oy);
    this.ox += LEARN_RATE * (mx - this.ox);
    this.oy += LEARN_RATE * (my - this.oy);
    this.r = clamp(this.r + LEARN_RATE * (miss + REGION_FALLOFF_MM - this.r), RADIUS_MIN_MM, RADIUS_MAX_MM);
    this.seeded = true;
  }
}
