// The contact table: a struct of typed arrays with 12 slots, so tracking a touch allocates nothing. Positions and
// sizes are millimeters. Each slot keeps the features the score reads, updated on every event of its contact.

import { MAX_CONTACTS, SIZE_MODE_CONTACTS, SWIPE_MS } from './thresholds';
import type { Role } from './effects';

/** Flags per contact. */
export const F = {
  /** E7: the pen was down when it landed. */
  PenDownAtLand: 1,
  /** E9: a pen arrived while it was young and still. */
  PalmFirst: 2,
  /** E16: the OS said palm. */
  OsPalm: 4,
  /** E19: lifted as a tap. */
  Tap: 8,
  /** Latched palm with a pen about: it holds the pen near while down. */
  HandHeld: 16,
  /** Started at a screen edge. */
  Edge: 32,
  /** Reported a real size. */
  Sized: 64,
  /** Its tap, long press, and multi-tap are swallowed. */
  Suppress: 128,
  /** Its size changed while down. */
  Resized: 256,
  /** Landed on a control outside the page. */
  Chrome: 512,
  /** Landed while presence was away or absent, with no judging. */
  Unjudged: 1024,
  /** Its offset from the pen tip is tracked. */
  RelValid: 2048,
} as const;

/** Verdicts. */
export const Cls = { Unsure: 0, Finger: 1, Palm: 2 } as const;

/** Size reporting, learned per session. Size evidence applies only to `real`, and growth also to `unknown`. */
export const SizeMode = { Unknown: 0, None: 1, Constant: 2, Real: 3 } as const;
export type SizeMode = (typeof SizeMode)[keyof typeof SizeMode];

const f64 = () => new Float64Array(MAX_CONTACTS);

export class ContactTable {
  readonly id = new Int32Array(MAX_CONTACTS);
  readonly used = new Uint8Array(MAX_CONTACTS);
  readonly t0 = f64();
  readonly tLast = f64();
  readonly x0 = f64();
  readonly y0 = f64();
  readonly x = f64();
  readonly y = f64();
  /** Path length, largest distance from the landing point, and both within the first 200 ms. */
  readonly path = f64();
  readonly disp = f64();
  readonly path200 = f64();
  readonly disp200 = f64();
  readonly major0 = f64();
  readonly majorMax = f64();
  readonly minorMax = f64();
  readonly pressureMax = f64();
  /** Offset from the pen tip while both are down, summed, for learning the hand region. */
  readonly sumDx = f64();
  readonly sumDy = f64();
  readonly sumN = f64();
  /** Time since the last pen lift or leave when this contact landed. */
  readonly sinceUp = f64();
  /** When its action began (draw, or a scroll or pan that started), else NaN. */
  readonly tAction = f64();
  /** Spacing to its pair partner when they paired. */
  readonly pairD0 = f64();
  /** Offset from the pen tip at landing, and the largest change of it: a palm moves with the pen. */
  readonly relX0 = f64();
  readonly relY0 = f64();
  readonly relDisp = f64();
  readonly score = new Int8Array(MAX_CONTACTS);
  readonly why = new Uint32Array(MAX_CONTACTS);
  readonly cls = new Uint8Array(MAX_CONTACTS);
  readonly confirmed = new Uint8Array(MAX_CONTACTS);
  readonly role = new Uint8Array(MAX_CONTACTS);
  readonly started = new Uint8Array(MAX_CONTACTS);
  readonly pairWith = new Int8Array(MAX_CONTACTS).fill(-1);
  readonly flags = new Uint16Array(MAX_CONTACTS);
  /** The next age checkpoint to score at, as an index. */
  readonly checkpoint = new Uint8Array(MAX_CONTACTS);
  live = 0;
  sizeMode: SizeMode = SizeMode.Unknown;
  private sameSize = 0;
  private firstW = 0;
  private firstH = 0;

  find(id: number): number {
    for (let i = 0; i < MAX_CONTACTS; i++) if (this.used[i] === 1 && this.id[i] === id) return i;
    return -1;
  }

  /** Takes a free slot, or returns -1 when 12 contacts are down. */
  add(id: number, t: number, x: number, y: number): number {
    let i = 0;
    while (i < MAX_CONTACTS && this.used[i] === 1) i++;
    if (i === MAX_CONTACTS) return -1;
    this.used[i] = 1;
    this.live++;
    this.id[i] = id;
    this.t0[i] = this.tLast[i] = t;
    this.x0[i] = this.x[i] = x;
    this.y0[i] = this.y[i] = y;
    this.path[i] = this.disp[i] = this.path200[i] = this.disp200[i] = 0;
    this.major0[i] = this.majorMax[i] = this.minorMax[i] = this.pressureMax[i] = 0;
    this.sumDx[i] = this.sumDy[i] = this.sumN[i] = 0;
    this.sinceUp[i] = Infinity;
    this.tAction[i] = Number.NaN;
    this.pairD0[i] = this.relX0[i] = this.relY0[i] = this.relDisp[i] = 0;
    this.score[i] = 0;
    this.why[i] = 0;
    this.cls[i] = this.confirmed[i] = this.role[i] = this.started[i] = this.flags[i] = this.checkpoint[i] = 0;
    this.pairWith[i] = -1;
    return i;
  }

  /** Moves a contact and updates its motion features. */
  moveTo(i: number, t: number, x: number, y: number): void {
    const step = Math.hypot(x - this.x[i], y - this.y[i]);
    const disp = Math.hypot(x - this.x0[i], y - this.y0[i]);
    this.path[i] += step;
    if (disp > this.disp[i]) this.disp[i] = disp;
    if (t - this.t0[i] <= SWIPE_MS) {
      this.path200[i] = this.path[i];
      if (disp > this.disp200[i]) this.disp200[i] = disp;
    }
    this.x[i] = x;
    this.y[i] = y;
    if (t > this.tLast[i]) this.tLast[i] = t;
  }

  /** Tracks the offset from the pen tip, which stays put for a hand that moves with the pen. */
  relTo(i: number, tipX: number, tipY: number): void {
    const rx = this.x[i] - tipX;
    const ry = this.y[i] - tipY;
    if ((this.flags[i] & F.RelValid) === 0) {
      this.flags[i] |= F.RelValid;
      this.relX0[i] = rx;
      this.relY0[i] = ry;
      return;
    }
    const d = Math.hypot(rx - this.relX0[i], ry - this.relY0[i]);
    if (d > this.relDisp[i]) this.relDisp[i] = d;
  }

  /** How far it moved, or how far it moved against the pen when that is less. */
  motion(i: number): number {
    return (this.flags[i] & F.RelValid) !== 0 ? Math.min(this.disp[i], this.relDisp[i]) : this.disp[i];
  }

  /** Records a size in mm and the raw CSS px, which teach the session's size mode. */
  sizeTo(i: number, wPx: number, hPx: number, major: number, minor: number, pressure: number): void {
    if (pressure > this.pressureMax[i]) this.pressureMax[i] = pressure;
    if (wPx <= 1 && hPx <= 1) return;
    const first = (this.flags[i] & F.Sized) === 0;
    if (first) {
      this.flags[i] |= F.Sized;
      this.major0[i] = major;
      this.observe(wPx, hPx);
    } else if (major !== this.majorMax[i] || minor !== this.minorMax[i]) {
      this.flags[i] |= F.Resized;
      this.sizeMode = SizeMode.Real;
    }
    if (major > this.majorMax[i]) this.majorMax[i] = major;
    if (minor > this.minorMax[i]) this.minorMax[i] = minor;
  }

  /** Marks a landing that reported no size. */
  noSize(): void {
    if (this.sizeMode === SizeMode.Unknown && this.sameSize === 0) this.sizeMode = SizeMode.None;
  }

  private observe(w: number, h: number): void {
    if (this.sizeMode === SizeMode.Real) return;
    if (this.sameSize === 0 || this.sizeMode === SizeMode.None) {
      this.firstW = w;
      this.firstH = h;
      this.sameSize = 1;
      this.sizeMode = SizeMode.Unknown;
    } else if (w === this.firstW && h === this.firstH) {
      if (++this.sameSize >= SIZE_MODE_CONTACTS) this.sizeMode = SizeMode.Constant;
    } else {
      this.sizeMode = SizeMode.Real;
    }
  }

  free(i: number): void {
    if (this.used[i] === 0) return;
    this.used[i] = 0;
    this.live--;
  }

  dist(i: number, j: number): number {
    return Math.hypot(this.x[i] - this.x[j], this.y[i] - this.y[j]);
  }

  roleOf(i: number): Role {
    return this.role[i] as Role;
  }
}
