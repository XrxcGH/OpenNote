// The hand region (Vogel et al. [S30]): a circle plus a forearm strip, anchored to the pen tip, or to the drawing
// contact in finger and passive stylus drawing. It is seeded from what is known, set from the pen's lean, and learned
// from where confirmed palms land. A left hand mirrors a right one.

import type { HandShape } from './settings';
import * as thresholds from './thresholds';

/** A plain copy, so hot loops read fields rather than module bindings. */
const {
  clamp,
  len,
  FAR_OUTSIDE_MM,
  FAR_SIDE_MM,
  FOREARM_HALF_MM,
  LEAN_FLIP_STROKES,
  LEAN_MIN_DEG,
  LEAN_OFFSET_MM,
  LEAN_WEIGHT,
  LEARN_RATE,
  RADIUS_MAX_MM,
  RADIUS_MIN_MM,
  REGION_FALLOFF_MM,
  TIP_GRIP_MM,
} = thresholds;

const DEG = Math.PI / 180;

/** The lean of a pen as a unit vector from the tip toward the hand, or false when it leans under 15 degrees. */
export function leanOf(tiltX: number, tiltY: number, out: { x: number; y: number }): boolean {
  if (!Number.isFinite(tiltX) || !Number.isFinite(tiltY)) return false;
  const lx = Math.tan(clamp(tiltX, -89, 89) * DEG);
  const ly = Math.tan(clamp(tiltY, -89, 89) * DEG);
  const norm = len(lx, ly);
  if (norm < Math.tan(LEAN_MIN_DEG * DEG)) return false;
  out.x = lx / norm;
  out.y = ly / norm;
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
  /** While the side is unknown, `holds` also tries the mirror image, for decisions that only need some hand. */
  either = false;

  constructor(
    base: HandShape,
    private readonly falloff = REGION_FALLOFF_MM,
  ) {
    this.ox = base.ox;
    this.oy = base.oy;
    this.r = base.r;
  }

  /** Mirrors the region to the other side at once, for a side learned from resting contacts. */
  flip(): void {
    this.ox = -this.ox;
    this.contrary = 0;
    this.seeded = true;
    this.either = false;
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
    const outside = this.outside(cx, cy, tipX, tipY, this.ox);
    return outside <= 0 ? 1 : Math.max(0, 1 - outside / this.falloff);
  }

  /** Membership on either side while the side is unknown: for taking back ink or a gesture, never for scoring. */
  membershipAny(cx: number, cy: number, tipX: number, tipY: number): number {
    const m = this.membership(cx, cy, tipX, tipY);
    if (this.seeded || m >= 1) return m;
    const outside = this.outside(cx, cy, tipX, tipY, -this.ox);
    return Math.max(m, outside <= 0 ? 1 : Math.max(0, 1 - outside / this.falloff));
  }

  /** Whether a point lies inside the circle or forearm strip, on either side while the side is unknown. */
  holds(cx: number, cy: number, tipX: number, tipY: number): boolean {
    if (this.outside(cx, cy, tipX, tipY, this.ox) <= 0) return true;
    return this.either && this.outside(cx, cy, tipX, tipY, -this.ox) <= 0;
  }

  /** How far outside the region a point lies; inside the circle or the forearm strip it is 0. */
  outside(cx: number, cy: number, tipX: number, tipY: number, ox = this.ox): number {
    const ex = cx - tipX - ox;
    const ey = cy - tipY - this.oy;
    const dist = len(ex, ey);
    if (dist <= this.r) return 0;
    const norm = len(ox, this.oy) || 1;
    const along = (ex * ox + ey * this.oy) / norm;
    const across = Math.abs(ex * -this.oy + ey * ox) / norm;
    if (along > 0 && across <= FOREARM_HALF_MM) return 0;
    return dist - this.r;
  }

  /** E6: on the far side of the tip from the hand, or well outside the region. */
  farFrom(cx: number, cy: number, tipX: number, tipY: number): boolean {
    const norm = len(this.ox, this.oy) || 1;
    const along = ((cx - tipX) * this.ox + (cy - tipY) * this.oy) / norm;
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
    // A palm on the other side does not move the region: side votes flip it whole.
    if (Math.sign(mx) !== Math.sign(this.ox) && Math.abs(mx) > 10) return;
    const miss = len(mx - this.ox, my - this.oy);
    this.ox += LEARN_RATE * (mx - this.ox);
    this.oy += LEARN_RATE * (my - this.oy);
    this.r = clamp(this.r + LEARN_RATE * (miss + REGION_FALLOFF_MM - this.r), RADIUS_MIN_MM, RADIUS_MAX_MM);
    this.seeded = true;
    this.either = false;
  }
}
