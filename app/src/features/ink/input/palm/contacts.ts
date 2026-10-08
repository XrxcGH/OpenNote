// The contact table: a struct of typed arrays with 12 slots, so tracking a touch allocates nothing. Positions and
// sizes are millimeters. Each slot keeps the features the score reads, updated on every event of its contact.

import type { Role } from './effects';
import * as thresholds from './thresholds';

/** A plain copy, so hot loops read fields rather than module bindings. */
const { len, MAX_CONTACTS, MOVE_ON_MM, MOVE_STEP_MM, SETTLE_TRAVEL_MM, SETTLED_AT_MS, SIZE_MODE_CONTACTS, SWIPE_MS } =
  thresholds;

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
  /** Finger drawing: the other contact of its pending pair rests inside this one's hand, so this one writes. */
  Writer: 1024,
  /** Its offset from the pen tip is tracked. */
  RelValid: 2048,
  /** Finger drawing: one contact of its pending pair lies inside the other's hand. */
  HandPair: 4096,
  /** It has voted for the side of the writing hand, once at 300 ms and for good at 600 ms. */
  VotedOnce: 16384,
  Voted: 8192,
  /** Its touch ink shows: it moved like a stroke rather than like a palm settling. */
  Shown: 32768,
  /** Latched palm on where and when it landed alone (E5, E8): a far-side swipe may reopen it. */
  SoftLatch: 65536,
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
  /** Time spent down while the pen was down, and when that was last counted. */
  readonly penDownMs = f64();
  readonly tTrack = f64();
  /** When it last moved 1 mm from where it last moved, and that point; the same for its offset from the pen tip. */
  readonly tMoved = f64();
  readonly mx = f64();
  readonly my = f64();
  readonly tRelMoved = f64();
  readonly rmx = f64();
  readonly rmy = f64();
  /** The last size reported and when it last changed. */
  readonly lastMajor = f64();
  readonly lastMinor = f64();
  readonly tResized = f64();
  /** Where it was once a palm would have settled (NaN before), and the farthest it went from there since. */
  readonly sx = f64();
  readonly sy = f64();
  readonly onDisp = f64();
  readonly score = new Int8Array(MAX_CONTACTS);
  readonly why = new Uint32Array(MAX_CONTACTS);
  readonly cls = new Uint8Array(MAX_CONTACTS);
  readonly confirmed = new Uint8Array(MAX_CONTACTS);
  readonly role = new Uint8Array(MAX_CONTACTS);
  readonly started = new Uint8Array(MAX_CONTACTS);
  readonly pairWith = new Int8Array(MAX_CONTACTS).fill(-1);
  readonly flags = new Uint32Array(MAX_CONTACTS);
  /** The next age checkpoint to score at, as an index. */
  readonly checkpoint = new Uint8Array(MAX_CONTACTS);
  live = 0;
  sizeMode: SizeMode = SizeMode.Unknown;
  /** Some contact reported a width different from its height. iPadOS reports one radius, so width equals height. */
  asym = false;
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
    this.pairD0[i] = this.relX0[i] = this.relY0[i] = this.relDisp[i] = this.penDownMs[i] = 0;
    this.tTrack[i] = this.tMoved[i] = this.tRelMoved[i] = this.tResized[i] = t;
    this.mx[i] = x;
    this.my[i] = y;
    this.lastMajor[i] = this.lastMinor[i] = 0;
    this.sx[i] = this.sy[i] = Number.NaN;
    this.onDisp[i] = 0;
    this.score[i] = 0;
    this.why[i] = 0;
    this.cls[i] = this.confirmed[i] = this.role[i] = this.started[i] = this.flags[i] = this.checkpoint[i] = 0;
    this.pairWith[i] = -1;
    return i;
  }

  /** Moves a contact and updates its motion features. */
  moveTo(i: number, t: number, x: number, y: number): void {
    const step = len(x - this.x[i], y - this.y[i]);
    const disp = len(x - this.x0[i], y - this.y0[i]);
    this.path[i] += step;
    if (disp > this.disp[i]) this.disp[i] = disp;
    if (t - this.t0[i] <= SWIPE_MS) {
      this.path200[i] = this.path[i];
      if (disp > this.disp200[i]) this.disp200[i] = disp;
    }
    this.x[i] = x;
    this.y[i] = y;
    if (t > this.tLast[i]) this.tLast[i] = t;
    if (Number.isNaN(this.sx[i])) {
      if (t - this.t0[i] >= SETTLED_AT_MS) {
        this.sx[i] = x;
        this.sy[i] = y;
      }
    } else {
      const on = len(x - this.sx[i], y - this.sy[i]);
      if (on > this.onDisp[i]) this.onDisp[i] = on;
    }
    if (len(x - this.mx[i], y - this.my[i]) >= MOVE_STEP_MM) {
      this.mx[i] = x;
      this.my[i] = y;
      if (t > this.tMoved[i]) this.tMoved[i] = t;
    }
  }

  /** How long it has not moved at t: on the glass, or against the pen tip when that is longer. */
  stillFor(i: number, t: number): number {
    const own = t - this.tMoved[i];
    if ((this.flags[i] & F.RelValid) === 0) return own;
    const rel = t - this.tRelMoved[i];
    return rel > own ? rel : own;
  }

  /** Tracks the offset from the pen tip, which stays put for a hand that moves with the pen. */
  relTo(i: number, tipX: number, tipY: number, t: number): void {
    const rx = this.x[i] - tipX;
    const ry = this.y[i] - tipY;
    if ((this.flags[i] & F.RelValid) === 0) {
      this.flags[i] |= F.RelValid;
      this.relX0[i] = this.rmx[i] = rx;
      this.relY0[i] = this.rmy[i] = ry;
      this.tRelMoved[i] = t;
      return;
    }
    const d = len(rx - this.relX0[i], ry - this.relY0[i]);
    if (d > this.relDisp[i]) this.relDisp[i] = d;
    if (len(rx - this.rmx[i], ry - this.rmy[i]) >= MOVE_STEP_MM) {
      this.rmx[i] = rx;
      this.rmy[i] = ry;
      if (t > this.tRelMoved[i]) this.tRelMoved[i] = t;
    }
  }

  /**
   * Whether it has moved like a stroke or a scroll rather than like a palm that drifts while it settles: further than
   * a palm drifts, or on from where it was once a palm would have settled.
   */
  movedOn(i: number): boolean {
    return this.disp[i] >= SETTLE_TRAVEL_MM || this.onDisp[i] >= MOVE_ON_MM;
  }

  /** How far it moved, or how far it moved against the pen when that is less. */
  motion(i: number): number {
    return (this.flags[i] & F.RelValid) !== 0 ? Math.min(this.disp[i], this.relDisp[i]) : this.disp[i];
  }

  /** Records a size in mm and the raw CSS px, which teach the session's size mode. */
  sizeTo(i: number, t: number, wPx: number, hPx: number, major: number, minor: number, pressure: number): void {
    if (pressure > this.pressureMax[i]) this.pressureMax[i] = pressure;
    if (wPx <= 1 && hPx <= 1) return;
    if (wPx !== hPx) this.asym = true;
    if (major !== this.lastMajor[i] || minor !== this.lastMinor[i]) {
      this.lastMajor[i] = major;
      this.lastMinor[i] = minor;
      this.tResized[i] = t;
    }
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
    return len(this.x[i] - this.x[j], this.y[i] - this.y[j]);
  }

  roleOf(i: number): Role {
    return this.role[i] as Role;
  }
}
