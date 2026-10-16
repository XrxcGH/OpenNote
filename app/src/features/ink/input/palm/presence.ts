// Pen presence (README, "Pen presence"). Up to 4 pens, keyed by pointer id. Each is away, hovering, down, or in
// grace. Nothing latches: every state that blocks touch has a timed exit. Presence at a time is computed from the
// slots without changing them, so asking about a later time never changes what an earlier event decides.

import * as thresholds from './thresholds';

/** A plain copy, so hot loops read fields rather than module bindings. */
const { DOWN_LEAVE_MS, DOWN_SILENCE_MS, MAX_PENS, RECENT_MS } = thresholds;

export type PenSignal = 'hover' | 'down' | 'move' | 'up' | 'cancel' | 'leave';
export type Presence = 'absent' | 'away' | 'recent' | 'near' | 'down';

export const Slot = { Away: 0, Hovering: 1, Down: 2, Grace: 3 } as const;

/** Presence as a number, in order of strength. */
export const P = { Absent: 0, Away: 1, Recent: 2, Near: 3, Down: 4 } as const;
export type P = (typeof P)[keyof typeof P];
/** The same type under a name that does not clash with a local copy of the values. */
export type PresenceCode = P;
export const PRESENCE_NAMES: readonly Presence[] = ['absent', 'away', 'recent', 'near', 'down'];

/** True for presence that judges touch against the pen: down, near, or recent. */
export const penContext = (p: P): boolean => p >= P.Recent;

export class PenSlots {
  readonly pointerId = new Int32Array(MAX_PENS);
  readonly state = new Uint8Array(MAX_PENS);
  readonly tEvent = new Float64Array(MAX_PENS).fill(-Infinity);
  readonly tGrace = new Float64Array(MAX_PENS);
  /** When the pen left range while down, or NaN. */
  readonly tLeftDown = new Float64Array(MAX_PENS).fill(Number.NaN);
  /** Last real pen evidence: hover, down, move, up, or cancel. Leave and system signals never count. */
  lastEvidence = -Infinity;
  /** Last lift or leave, for E8. */
  lastUpOrLeave = -Infinity;
  /** Last contact (down or move). */
  lastContact = -Infinity;
  /** A pen has been seen on this device, in this session or before it; and in this session. */
  penSeen = false;
  sessionPen = false;
  /** The anchor: the last pen position in mm, and the lean as a unit vector toward the hand (0, 0 when unknown). */
  tipX = 0;
  tipY = 0;
  tipValid = false;
  leanX = 0;
  leanY = 0;
  graceMs = 500;
  watchdogMs = 2000;
  /** Set by the filter: true while a palm latched near the pen is down or lifted under grace ago. */
  handHeld = false;
  /** Scratch output of `stateAt`: when grace began. */
  private graceFrom = 0;

  /** A slot's state at time t, with grace and the watchdogs applied, without changing it. */
  stateAt(s: number, t: number): number {
    let state = this.state[s];
    let graceFrom = this.tGrace[s];
    const last = this.tEvent[s];
    if (state === Slot.Down) {
      const left = this.tLeftDown[s];
      const quiet = Number.isNaN(left) ? Infinity : Math.max(left, last) + DOWN_LEAVE_MS;
      const end = Math.min(quiet, last + DOWN_SILENCE_MS);
      if (t >= end) {
        state = Slot.Grace;
        graceFrom = end;
      }
    } else if (state === Slot.Hovering && !this.handHeld && t >= last + this.watchdogMs) {
      state = Slot.Grace;
      graceFrom = last + this.watchdogMs;
    }
    if (state === Slot.Grace && t >= graceFrom + this.graceMs) state = Slot.Away;
    this.graceFrom = graceFrom;
    return state;
  }

  /** Global presence at time t. `absent` needs no pen ever seen and a profile that reports no pen digitizer. */
  presence(t: number, noDigitizer: boolean): P {
    let near = this.handHeld;
    for (let s = 0; s < MAX_PENS; s++) {
      if (this.state[s] === Slot.Away) continue;
      const state = this.stateAt(s, t);
      if (state === Slot.Down) return P.Down;
      if (state !== Slot.Away) near = true;
    }
    if (near) return P.Near;
    if (t - this.lastEvidence < RECENT_MS) return P.Recent;
    return this.penSeen || !noDigitizer ? P.Away : P.Absent;
  }

  private slotFor(pointerId: number, t: number): number {
    let oldest = 0;
    for (let s = 0; s < MAX_PENS; s++) {
      if (this.state[s] !== Slot.Away && this.pointerId[s] === pointerId) return s;
    }
    for (let s = 0; s < MAX_PENS; s++) {
      if (this.state[s] === Slot.Away || this.stateAt(s, t) === Slot.Away) return s;
      if (this.tEvent[s] < this.tEvent[oldest]) oldest = s;
    }
    return oldest;
  }

  /** Applies a pen event. Returns true when it is real pen evidence. */
  apply(signal: PenSignal, pointerId: number, t: number): boolean {
    const s = this.slotFor(pointerId, t);
    const state = this.stateAt(s, t);
    const graceFrom = this.graceFrom;
    this.pointerId[s] = pointerId;
    if (signal === 'leave') {
      if (state === Slot.Away) return false;
      this.lastUpOrLeave = t;
      if (state === Slot.Down) this.tLeftDown[s] = t;
      else this.enterGrace(s, state === Slot.Grace ? graceFrom : t);
      return false;
    }
    if (t > this.tEvent[s]) this.tEvent[s] = t;
    if (t > this.lastEvidence) this.lastEvidence = t;
    this.penSeen = this.sessionPen = true;
    this.tLeftDown[s] = Number.NaN;
    if (signal === 'hover') this.state[s] = Slot.Hovering;
    else if (signal === 'down' || signal === 'move') {
      this.state[s] = Slot.Down;
      this.lastContact = t;
    } else {
      this.lastUpOrLeave = t;
      this.enterGrace(s, t);
    }
    return true;
  }

  /** Window blur or hidden: a hovering or down pen enters grace. A capture lost with the pen down does too. */
  release(t: number, downOnly: boolean): void {
    for (let s = 0; s < MAX_PENS; s++) {
      const state = this.stateAt(s, t);
      if (state === Slot.Down || (!downOnly && state === Slot.Hovering)) this.enterGrace(s, t);
    }
  }

  /** True when some pen is hovering or down at t, so the hover watchdog matters. */
  inRange(t: number): boolean {
    for (let s = 0; s < MAX_PENS; s++) {
      const state = this.state[s] === Slot.Away ? Slot.Away : this.stateAt(s, t);
      if (state === Slot.Hovering || state === Slot.Down) return true;
    }
    return false;
  }

  private enterGrace(s: number, from: number): void {
    this.state[s] = Slot.Grace;
    this.tGrace[s] = from;
    this.tLeftDown[s] = Number.NaN;
  }
}
