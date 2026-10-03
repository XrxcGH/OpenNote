// The evidence score (README, "Evidence"). A contact's score is the sum of the terms that hold now, recomputed from
// its features each time, never accumulated. Each term sets a bit in `why`, so a verdict can be explained.

import { ContactTable, F, SizeMode } from './contacts';
import { HandRegion } from './handRegion';
import { P } from './presence';
import * as K from './thresholds';

/** Evidence bits: bit n-1 is En. */
export const E = {
  PalmSize: 1 << 0,
  Large: 1 << 1,
  Fingertip: 1 << 2,
  Growth: 1 << 3,
  HandRegion: 1 << 4,
  FarSide: 1 << 5,
  PenDown: 1 << 6,
  AfterPen: 1 << 7,
  PalmFirst: 1 << 8,
  Still: 1 << 9,
  Swipe: 1 << 10,
  NearPalm: 1 << 11,
  Split: 1 << 12,
  Burst: 1 << 13,
  Grip: 1 << 14,
  OsPalm: 1 << 15,
  StylusTip: 1 << 16,
  OwnPalm: 1 << 17,
  Tap: 1 << 18,
  Sensitivity: 1 << 19,
} as const;

/** Evidence that may stop a confirmed action. */
export const HARD = E.PalmSize | E.Growth | E.OsPalm;

/** The names of the evidence bits, E1 to E20, for test failures and the lab overlay. */
export function explainBits(why: number): string {
  const names = Object.keys(E);
  return names.filter((_, i) => (why & (1 << i)) !== 0).join(' ');
}

/** What the score reads besides the contact itself. The filter fills it before scoring. */
export class ScoreContext {
  t = 0;
  presence: P = P.Away;
  penCtx = false;
  drawMode = false;
  /** The slot of the contact that holds the draw slot, or -1. */
  drawSlot = -1;
  tipValid = false;
  tipX = 0;
  tipY = 0;
  sinceEvidence = Infinity;
  /** -1 low, 0 standard, +1 high. */
  sensitivity = 0;
  edgeGrip = false;
  /** Learned passive stylus tip size in mm, or 0. */
  stylusTip = 0;
  readonly landT = new Float64Array(K.MAX_LANDINGS).fill(-Infinity);
  readonly landX = new Float64Array(K.MAX_LANDINGS);
  readonly landY = new Float64Array(K.MAX_LANDINGS);
  private landNext = 0;

  constructor(
    readonly hand: HandRegion,
    readonly touchHand: HandRegion,
  ) {}

  land(t: number, x: number, y: number): void {
    const i = this.landNext;
    this.landT[i] = t;
    this.landX[i] = x;
    this.landY[i] = y;
    this.landNext = (i + 1) % K.MAX_LANDINGS;
  }
}

function sizeTerms(c: ContactTable, i: number, x: ScoreContext): number {
  if ((c.flags[i] & F.Sized) === 0 || c.sizeMode === SizeMode.Constant || c.sizeMode === SizeMode.None) return 0;
  const real = c.sizeMode === SizeMode.Real;
  const major = c.majorMax[i];
  let s = 0;
  const grow = major - c.major0[i];
  if (grow >= K.GROWTH_MM || (grow >= K.GROWTH_SHARE * c.major0[i] && major > K.FINGERTIP_MAJOR_MM)) {
    s += 2;
    c.why[i] |= E.Growth;
  }
  if (!x.penCtx && !x.drawMode) return s;
  const scale = x.sensitivity < 0 ? K.LOW_SENSITIVITY_SIZE : 1;
  if (major >= K.PALM_MAJOR_MM * scale || c.minorMax[i] >= K.PALM_MINOR_MM * scale) {
    c.why[i] |= E.PalmSize;
    return s + 4;
  }
  if (major >= K.LARGE_MAJOR_MM) {
    c.why[i] |= E.Large;
    return s + 1;
  }
  if (real && major <= K.FINGERTIP_MAJOR_MM) {
    s -= 1;
    c.why[i] |= E.Fingertip;
  }
  if (real && x.stylusTip > 0 && major <= x.stylusTip + K.TIP_MARGIN_MM) {
    s -= 2;
    c.why[i] |= E.StylusTip;
  }
  return s;
}

/**
 * E5 and E6: where the contact is relative to the pen tip, or where it landed relative to the drawing contact in
 * draw mode. Against the pen it is the current position, because a resting palm slides along the line with the hand.
 */
function regionTerms(c: ContactTable, i: number, x: ScoreContext): number {
  if (x.penCtx && x.tipValid) {
    if (x.hand.membership(c.x[i], c.y[i], x.tipX, x.tipY) >= 0.5) {
      c.why[i] |= E.HandRegion;
      if (x.presence >= P.Near) return 3;
      return x.sinceEvidence < K.RECENT_STRONG_MS ? 2 : 1;
    }
    if (x.hand.farFrom(c.x[i], c.y[i], x.tipX, x.tipY)) {
      c.why[i] |= E.FarSide;
      return -2;
    }
    return 0;
  }
  const d = x.drawSlot;
  if (x.drawMode && d >= 0 && d !== i && x.touchHand.membership(c.x0[i], c.y0[i], c.x[d], c.y[d]) >= 0.5) {
    c.why[i] |= E.HandRegion;
    return 3;
  }
  return 0;
}

function timingTerms(c: ContactTable, i: number, x: ScoreContext): number {
  let s = 0;
  const flags = c.flags[i];
  const heldWhileWriting = (c.why[i] & E.HandRegion) !== 0 && c.penDownMs[i] >= K.PEN_DOWN_HELD_MS;
  if (flags & F.PenDownAtLand || heldWhileWriting) {
    s += 2;
    c.why[i] |= E.PenDown;
  } else if (c.sinceUp[i] <= K.AFTER_PEN_HOLD_MS) {
    s += c.sinceUp[i] <= K.AFTER_PEN_CANCEL_MS ? 2 : 1;
    c.why[i] |= E.AfterPen;
  }
  if (flags & F.PalmFirst) {
    s += 2;
    c.why[i] |= E.PalmFirst;
  }
  const age = x.t - c.t0[i];
  const motion = c.motion(i);
  // A palm slides with the writing hand between words, so motion in the hand region is no swipe while the pen is near.
  const handSlide = (c.why[i] & E.HandRegion) !== 0 && x.presence >= P.Near;
  if (x.penCtx && i !== x.drawSlot && motion < K.STILL_MM && age >= K.STILL_EARLY_MS) {
    s += age >= K.STILL_LATE_MS ? 2 : 1;
    c.why[i] |= E.Still;
  }
  if (!handSlide && motion >= K.LONG_SWIPE_MM && c.majorMax[i] < K.LARGE_MAJOR_MM) {
    s -= 3;
    c.why[i] |= E.Swipe;
  } else if (
    !handSlide &&
    motion >= K.SWIPE_MM &&
    c.disp200[i] >= K.SWIPE_MM &&
    c.disp200[i] >= K.SWIPE_STRAIGHTNESS * c.path200[i]
  ) {
    s -= 2;
    c.why[i] |= E.Swipe;
  }
  if (flags & F.Tap) {
    s -= 1;
    c.why[i] |= E.Tap;
  }
  return s;
}

/** E12, E13, E14, and E18: other contacts nearby. */
function neighborTerms(c: ContactTable, i: number, x: ScoreContext): number {
  let nearPalm = false;
  let split = false;
  let ownPalm = false;
  for (let j = 0; j < c.used.length; j++) {
    if (j === i || c.used[j] === 0) continue;
    if (c.cls[j] === 2 && i !== x.drawSlot && c.dist(i, j) <= K.CLUSTER_MM) nearPalm = true;
    const together = Math.abs(c.t0[i] - c.t0[j]) <= K.BURST_MS;
    if (together && Math.hypot(c.x0[i] - c.x0[j], c.y0[i] - c.y0[j]) <= K.SPLIT_MM) split = true;
    const resting = c.cls[j] === 2 || c.role[j] === 1 || c.disp[j] < K.WEAK_TRAVEL_MM;
    if (x.drawMode && resting && x.touchHand.membership(c.x[j], c.y[j], c.x[i], c.y[i]) >= 0.5) ownPalm = true;
  }
  let s = 0;
  if (nearPalm) {
    s += 2;
    c.why[i] |= E.NearPalm;
  }
  if (split) {
    s += 2;
    c.why[i] |= E.Split;
  }
  if (ownPalm) {
    s -= 2;
    c.why[i] |= E.OwnPalm;
  }
  if (x.penCtx && burst(c, i, x)) {
    s += 2;
    c.why[i] |= E.Burst;
  }
  return s;
}

function burst(c: ContactTable, i: number, x: ScoreContext): boolean {
  let n = 0;
  for (let k = 0; k < K.MAX_LANDINGS; k++) {
    if (Math.abs(x.landT[k] - c.t0[i]) > K.BURST_MS) continue;
    if (Math.hypot(x.landX[k] - c.x0[i], x.landY[k] - c.y0[i]) <= K.BURST_MM) n++;
  }
  return n >= K.BURST_COUNT;
}

/** E15: a thumb gripping the device at a screen edge. */
export function isGrip(c: ContactTable, i: number, x: ScoreContext): boolean {
  if (!x.edgeGrip || (c.flags[i] & F.Edge) === 0) return false;
  if (x.t - c.t0[i] >= K.STILL_EARLY_MS && c.disp[i] < K.STILL_MM) return true;
  const minor = c.minorMax[i];
  return c.majorMax[i] >= K.GRIP_MAJOR_MM || (minor > 0 && c.majorMax[i] / minor >= K.GRIP_ASPECT);
}

/** Scores a contact: sets its score and evidence bits, and returns the score. */
export function scoreContact(c: ContactTable, i: number, x: ScoreContext): number {
  c.why[i] = 0;
  let s = sizeTerms(c, i, x) + regionTerms(c, i, x) + timingTerms(c, i, x) + neighborTerms(c, i, x);
  if (isGrip(c, i, x)) {
    s += 3;
    c.why[i] |= E.Grip;
  }
  if ((x.penCtx || (x.drawMode && x.drawSlot >= 0 && x.drawSlot !== i)) && x.sensitivity !== 0) {
    s += x.sensitivity;
    c.why[i] |= E.Sensitivity;
  }
  if (c.flags[i] & F.OsPalm) {
    s = Math.max(s, K.PALM_SCORE);
    c.why[i] |= E.OsPalm;
  }
  s = K.clamp(s, -100, 100);
  c.score[i] = s;
  return s;
}
