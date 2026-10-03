// The filter's state and its primitive operations: presence, scoring, verdicts, role changes, holds, and learning.
// `decide.ts` holds the role rules and `filter.ts` the public API.

import { Cls as Cls_, ContactTable, F as F_, SizeMode as SizeMode_ } from './contacts';
import { EffectQueue, End as End_, Fx as Fx_, Role as Role_ } from './effects';
import { HandRegion } from './handRegion';
import { Holds, RecentCommits } from './holds';
import { P as P_, PenSlots, penContext as penContext_ } from './presence';
import {
  E as E_,
  HARD as HARD_,
  inPenHand as inPenHand_,
  isGrip as isGrip_,
  ScoreContext,
  scoreContact as scoreContact_,
} from './score';
import { DEFAULT_PALM_SETTINGS, UNKNOWN_PROFILE } from './settings';
import type { DeviceProfile, HandShape, LearnedState, PalmSettings } from './settings';
import * as thresholds from './thresholds';
import type { PresenceCode } from './presence';
import type { RoleCode } from './effects';

/** Local copies, so event paths call and read them directly rather than through module bindings. */
const Cls = { ...Cls_ };
const F = { ...F_ };
const SizeMode = { ...SizeMode_ };
const End = { ...End_ };
const Fx = { ...Fx_ };
const Role = { ...Role_ };
const P = { ...P_ };
const penContext = penContext_;
const E = { ...E_ };
const HARD = HARD_;
const inPenHand = inPenHand_;
const isGrip = isGrip_;
const scoreContact = scoreContact_;

/** A plain copy, so hot loops read fields rather than module bindings. */
const K = { ...thresholds };

const mirror = (s: HandShape, left: boolean): HandShape => (left ? { ox: -s.ox, oy: s.oy, r: s.r } : s);

/**
 * A palm latched on this evidence alone rests only on where and when it landed: in the hand region (E5), beside the
 * resting palm (E12), just after the pen (E8), with finger evidence besides.
 */
const SOFT =
  E.HandRegion |
  E.AfterPen |
  E.NearPalm |
  E.Fingertip |
  E.Tap |
  E.Swipe |
  E.FarSide |
  E.StylusTip |
  E.OwnPalm |
  E.Sensitivity;

/** A swipe that has left the hand region, or runs on the far side of the tip. */
const swipedAway = (why: number): boolean =>
  (why & E.Swipe) !== 0 && ((why & E.FarSide) !== 0 || (why & E.HandRegion) === 0);

export class Core {
  settings: PalmSettings = DEFAULT_PALM_SETTINGS;
  profile: DeviceProfile = UNKNOWN_PROFILE;
  readonly c = new ContactTable();
  readonly pens = new PenSlots();
  readonly hand = new HandRegion(K.PEN_HAND);
  readonly touchHand = new HandRegion(K.TOUCH_HAND, K.TOUCH_FALLOFF_MM);
  readonly x = new ScoreContext(this.hand, this.touchHand);
  readonly fx = new EffectQueue();
  readonly holds = new Holds();
  readonly commits = new RecentCommits();
  pxPerMm = K.DEFAULT_PX_PER_MM;
  inkTool = false;
  viewW = 0;
  viewH = 0;
  /** Latched palms down while a pen is about, and when the last one lifted. */
  handLive = 0;
  handLift = -Infinity;
  drawSlot = -1;
  shadowSlot = -1;
  /** Finger drawing: the earlier contact of the pending pair, or -1. */
  pendA = -1;
  /** The start of the line being written, the last lift, and the way the line runs (+1 right, -1 left, 0 unknown). */
  lineX = 0;
  lineY = 0;
  lineValid = false;
  private upX = 0;
  private upY = 0;
  private upValid = false;
  private lineDir = 0;
  /** Votes for the side of the writing hand from contacts that rested while the pen was down: + right, - left. */
  sideVotes = 0;
  /** Votes for the side of the drawing hand in finger drawing, from palms that lay on the side not yet assumed. */
  touchVotes = 0;
  /** The earliest time a live contact reaches its next checkpoint. */
  dueAt = Infinity;
  /** Learned passive stylus tip: running sum and count of committed stroke sizes. */
  tipSum = 0;
  tipN = 0;
  learnedIn: LearnedState | null = null;

  presenceAt(t: number): PresenceCode {
    this.pens.graceMs = this.settings.graceMs;
    this.pens.handHeld = this.handLive > 0 || t - this.handLift < this.settings.graceMs;
    return this.pens.presence(t, this.profile.penDigitizer === false);
  }

  fingerDrawOn(): boolean {
    const mode = this.settings.fingerDraw;
    if (this.settings.penOnly || this.profile.pencilOnly) return false;
    // A pen that reports as a mouse writes with a hand on the glass, so fingers draw only when asked to.
    if (this.profile.id === 'windows-pen-as-mouse') return mode === 'on';
    return mode === 'on' || (mode === 'auto' && !this.pens.penSeen);
  }

  managed(): boolean {
    return this.pens.penSeen || this.profile.penDigitizer === true || (this.fingerDrawOn() && this.inkTool);
  }

  /** Fills the score context for time t and presence p. */
  prepare(t: number, p: PresenceCode): void {
    const x = this.x;
    x.t = t;
    x.presence = p;
    x.penCtx = penContext(p);
    x.drawMode = this.inkTool && p <= P.Away && this.fingerDrawOn();
    x.drawSlot = this.drawSlot >= 0 ? this.drawSlot : this.pendA;
    this.anchors();
    x.sinceEvidence = t - this.pens.lastEvidence;
    x.sensitivity = this.settings.sensitivity === 'low' ? -1 : this.settings.sensitivity === 'high' ? 1 : 0;
    x.edgeGrip = this.profile.edgeGrip;
    x.stylusTip = this.stylusTip();
  }

  /** Copies the pen anchors into the score context. */
  anchors(): void {
    const x = this.x;
    x.tipValid = this.pens.tipValid;
    x.tipX = this.pens.tipX;
    x.tipY = this.pens.tipY;
    // The line anchors matter once the pen has left: the hand comes back where the next line starts.
    x.lineValid = this.lineValid && x.presence === P.Recent;
    x.lineX = this.lineX;
    x.lineY = this.lineY;
  }

  /**
   * Whether a point (mm) lies in the writing hand of the last pen position or of the line being written. `anySide`
   * tries both sides while the side is unknown, for taking ink or a gesture back.
   */
  inPenHand(px: number, py: number, anySide = false): boolean {
    if (!this.pens.tipValid) return false;
    this.anchors();
    this.x.lineValid = this.lineValid;
    return inPenHand(this.x, px, py, anySide);
  }

  /** A pen touched down at (x, y) mm: a jump back along the line, or to another line, starts a new line. */
  penDownAt(x: number, y: number): void {
    const back = this.lineDir !== 0 && (x - this.upX) * this.lineDir < -K.LINE_JUMP_MM;
    if (!this.lineValid || !this.upValid || back || Math.abs(y - this.upY) > K.LINE_JUMP_MM) {
      this.lineX = x;
      this.lineY = y;
      this.lineValid = true;
      this.lineDir = 0;
    }
  }

  penUpAt(x: number, y: number): void {
    this.upX = x;
    this.upY = y;
    this.upValid = true;
    if (Math.abs(x - this.lineX) > K.LINE_JUMP_MM / 2) this.lineDir = Math.sign(x - this.lineX);
  }

  /**
   * A contact that rested while the pen was down votes for the side of the hand: once at 300 ms, and again at 600 ms. Two
   * votes set a side that was unknown, or flip one that was only guessed, at once.
   */
  vote(i: number): void {
    const c = this.c;
    if ((c.flags[i] & (F.Voted | F.Edge | F.Chrome)) !== 0 || c.penDownMs[i] < K.PEN_DOWN_HELD_MS || c.sumN[i] < 3)
      return;
    if (c.penDownMs[i] >= K.SIDE_LONG_MS) c.flags[i] |= F.Voted;
    else if (c.flags[i] & F.VotedOnce) return;
    else c.flags[i] |= F.VotedOnce;
    this.voteSide(c.sumDx[i] / c.sumN[i], c.sumDy[i] / c.sumN[i], 1);
  }

  /** Votes for the side of the hand from a resting contact's mean offset (mm) from the tip. */
  private voteSide(mx: number, my: number, weight: number): void {
    if (Math.abs(mx) < 10 || Math.abs(mx) > K.SIDE_REACH_MM || Math.abs(my) > K.SIDE_REACH_MM) return;
    this.sideVotes = K.clamp(this.sideVotes + weight * Math.sign(mx), -K.SIDE_VOTES, K.SIDE_VOTES);
    const hand = this.hand;
    if (Math.abs(this.sideVotes) < K.SIDE_VOTES) return;
    if (Math.sign(this.sideVotes) === Math.sign(hand.ox)) hand.seeded = true;
    else if (!hand.pinned) hand.flip();
  }

  stylusTip(): number {
    if (this.learnedIn && this.learnedIn.touchStylusTipMm > 0 && this.tipN < K.TIP_LEARN_STROKES) {
      return this.learnedIn.touchStylusTipMm;
    }
    const mean = this.tipN > 0 ? this.tipSum / this.tipN : 0;
    return this.tipN >= K.TIP_LEARN_STROKES && mean <= K.TIP_STYLUS_MAX_MM ? mean : 0;
  }

  setRole(i: number, role: RoleCode, fx: number): void {
    const c = this.c;
    c.role[i] = role;
    this.fx.push(c.id[i], role, fx, c.why[i]);
  }

  /** Scores a contact and applies the verdict with hysteresis. */
  rescore(i: number): void {
    const c = this.c;
    const s = scoreContact(c, i, this.x);
    if (!Number.isNaN(c.tAction[i]) && this.x.t - c.tAction[i] >= K.CONFIRM_MS) c.confirmed[i] = 1;
    if (c.cls[i] === Cls.Palm) {
      // Any palm evidence beyond where and when it landed settles the verdict for good.
      if ((c.flags[i] & F.SoftLatch) === 0) return;
      if ((c.why[i] & ~SOFT) !== 0) c.flags[i] &= ~F.SoftLatch;
      else if (swipedAway(c.why[i]) && s <= K.FINGER_SCORE) this.reopen(i);
      return;
    }
    const judged = this.x.penCtx || this.x.drawMode || (c.why[i] & (E.OsPalm | E.PalmSize)) !== 0;
    if (!judged) return;
    const role = c.role[i];
    const inked = role === Role.Draw || role === Role.Shadow || role === Role.Pend;
    const grip = (c.why[i] & E.Grip) !== 0 && inked;
    // Ink whose contact grew like a palm and never moved on like a stroke: a palm that showed before its size told.
    const grown = (c.why[i] & E.Growth) !== 0 && inked && !c.movedOn(i);
    if (s >= K.PALM_SCORE || grip || grown) {
      if (c.confirmed[i] === 1 && (c.why[i] & HARD) === 0) return;
      this.latchPalm(i);
    } else {
      c.cls[i] = s <= K.FINGER_SCORE ? Cls.Finger : Cls.Unsure;
    }
  }

  /**
   * A palm latched on soft evidence alone (where and when it landed) that then swipes out of the hand region or on the
   * far side of the tip: the other hand's scroll landed where the hand might have been. It may scroll after all.
   */
  private reopen(i: number): void {
    const c = this.c;
    c.cls[i] = Cls.Unsure;
    c.flags[i] &= ~F.SoftLatch;
    if (c.flags[i] & F.HandHeld) {
      c.flags[i] &= ~F.HandHeld;
      this.handLive--;
      if (this.x.t > this.handLift) this.handLift = this.x.t;
    }
    const managed = !this.x.drawMode && this.x.presence !== P.Down && (c.flags[i] & F.Chrome) === 0;
    if (managed && c.role[i] === Role.Ignore && c.started[i] === 0) this.setRole(i, Role.Scroll, 0);
  }

  rescoreAll(): void {
    const c = this.c;
    for (let i = 0; i < K.MAX_CONTACTS; i++) if (c.used[i] === 1) this.rescore(i);
  }

  /** Scores each live contact that has reached its next age checkpoint. */
  checkpoints(t: number): void {
    if (t < this.dueAt) return;
    const c = this.c;
    const marks = K.CHECKPOINTS_MS;
    let next = Infinity;
    for (let i = 0; i < K.MAX_CONTACTS; i++) {
      if (c.used[i] === 0 || c.checkpoint[i] >= marks.length) continue;
      if (t - c.t0[i] >= marks[c.checkpoint[i]]) {
        while (c.checkpoint[i] < marks.length && t - c.t0[i] >= marks[c.checkpoint[i]]) c.checkpoint[i]++;
        this.rescore(i);
      }
      if (c.used[i] === 1 && c.checkpoint[i] < marks.length) next = Math.min(next, c.t0[i] + marks[c.checkpoint[i]]);
    }
    this.dueAt = next;
  }

  /** True when some contact has reached its next checkpoint, so the pen path can skip scoring otherwise. */
  due(t: number): boolean {
    return t >= this.dueAt;
  }

  /**
   * A palm verdict: final for the contact's life. Its ink goes, its camera move reverts, and its tap is swallowed.
   * When it held the draw slot, a shadow takes the slot unless `promote` is false.
   */
  latchPalm(i: number, promote = true): void {
    const c = this.c;
    if (c.cls[i] === Cls.Palm) return;
    c.cls[i] = Cls.Palm;
    c.flags[i] |= F.Suppress;
    if ((c.why[i] & ~SOFT) === 0 && this.x.penCtx) c.flags[i] |= F.SoftLatch;
    if (this.x.penCtx && (c.flags[i] & F.HandHeld) === 0) {
      c.flags[i] |= F.HandHeld;
      this.handLive++;
    }
    const role = c.role[i];
    let fx: number = Fx.SuppressTap;
    if (role === Role.Draw || role === Role.Shadow || role === Role.Pend) fx |= Fx.Retract;
    if ((role === Role.Scroll || role === Role.Nav) && c.started[i] === 1) fx |= Fx.Revert;
    const held = i === this.drawSlot;
    if (held) this.drawSlot = -1;
    if (i === this.shadowSlot) this.shadowSlot = -1;
    this.unpair(i, true);
    this.setRole(i, Role.Ignore, fx);
    if (held && promote && this.drawSlot < 0) this.promoteShadow();
  }

  /**
   * Ends a pair. In finger drawing the survivor keeps its stroke and draws, since the pair never became a pan;
   * otherwise it is ignored, and its camera move reverts when `revert` is set and it had started.
   */
  unpair(i: number, revert: boolean): void {
    const c = this.c;
    const j = c.pairWith[i];
    c.pairWith[i] = -1;
    if (i === this.pendA || j === this.pendA) this.pendA = -1;
    if (j < 0 || c.used[j] === 0) return;
    c.pairWith[j] = -1;
    const role = c.role[j];
    if (role === Role.Pend || role === Role.Draw) {
      this.drawFrom(j);
      return;
    }
    const fx = revert && c.started[j] === 1 ? Fx.Revert : 0;
    c.started[j] = 0;
    this.setRole(j, Role.Ignore, fx);
  }

  /**
   * A contact with a stroke takes the draw slot and shows its whole path once it may show, or gives its ink up when the
   * slot is held.
   */
  drawFrom(j: number): void {
    const c = this.c;
    if (this.drawSlot >= 0 && this.drawSlot !== j) {
      this.setRole(j, Role.Ignore, Fx.Retract);
      return;
    }
    if (j === this.shadowSlot) this.shadowSlot = -1;
    this.drawSlot = j;
    c.tAction[j] = c.t0[j];
    if (c.role[j] !== Role.Draw) this.setRole(j, Role.Draw, 0);
    this.showIfReady(j);
  }

  promoteShadow(): void {
    const s = this.shadowSlot;
    if (s < 0) return;
    this.shadowSlot = -1;
    this.drawSlot = s;
    this.c.tAction[s] = this.c.t0[s];
    this.setRole(s, Role.Draw, 0);
    this.showIfReady(s);
  }

  /**
   * Whether a contact has moved like a stroke or a scroll rather than like a palm that drifts while it settles: it has
   * traveled further than a palm drifts, or it moved on from where it was once a palm would have settled.
   */
  movesOn(i: number): boolean {
    return this.c.movedOn(i);
  }

  /** A drawing contact's ink shows, with its whole path, once it has moved and cannot be a palm settling. */
  showIfReady(i: number): void {
    const c = this.c;
    if ((c.flags[i] & F.Shown) !== 0 || c.disp[i] < K.SHOW_MM) return;
    // A contact that grows as it moves is a palm settling, however far it slides: its size tells before it shows.
    const grew = c.majorMax[i] - c.major0[i];
    if ((c.why[i] & E.Growth) !== 0 || (grew >= K.SETTLE_GROW_MM && this.x.t - c.t0[i] < K.SETTLED_AT_MS)) return;
    const tip =
      c.sizeMode === SizeMode.Real &&
      (c.flags[i] & F.Sized) !== 0 &&
      this.x.t - c.t0[i] >= K.SHOW_TIP_MS &&
      c.majorMax[i] <= K.FINGERTIP_MAJOR_MM &&
      c.majorMax[i] - c.major0[i] < K.SHOW_GROW_MM;
    if (!tip && !this.movesOn(i)) return;
    c.flags[i] |= F.Shown;
    this.setRole(i, Role.Draw, Fx.Promote);
  }

  /** Real pen evidence at t drops every live touch stroke and every held stroke that began at or before t. */
  dropTouchInk(t: number): void {
    const c = this.c;
    if (this.drawSlot >= 0 || this.shadowSlot >= 0 || this.pendA >= 0) {
      for (let i = 0; i < K.MAX_CONTACTS; i++) {
        const role = c.role[i];
        if (c.used[i] === 0 || (role !== Role.Draw && role !== Role.Shadow && role !== Role.Pend)) continue;
        c.pairWith[i] = -1;
        this.setRole(i, Role.Ignore, Fx.Retract);
      }
      this.drawSlot = this.shadowSlot = this.pendA = -1;
    }
    const h = this.holds;
    if (h.count === 0) return;
    for (let k = 0; k < K.MAX_HOLDS; k++) {
      if (h.used[k] === 1 && h.start[k] <= t && t <= h.until[k]) {
        this.fx.push(h.id[k], Role.Ignore, Fx.Retract, 0);
        h.remove(k);
      }
    }
  }

  /** Commits held strokes whose hold ended, with slack for late pen events. */
  settle(t: number): void {
    const h = this.holds;
    if (h.count === 0) return;
    for (let k = 0; k < K.MAX_HOLDS; k++) {
      if (h.used[k] === 1 && t >= h.until[k] + K.COMMIT_SLACK_MS) this.commitHold(k, t);
    }
  }

  commitHold(k: number, t: number): void {
    const h = this.holds;
    this.fx.push(h.id[k], Role.Ignore, Fx.Commit, 0);
    this.commits.add(h.id[k], t, h.x[k], h.y[k]);
    h.remove(k);
  }

  /**
   * Holds or commits a touch stroke that ended at t. Returns End.Held when it was held, with End.Hidden when it stays
   * hidden until it commits, or 0 when it committed now.
   */
  endStroke(i: number, t: number): number {
    const c = this.c;
    this.learnTip(i);
    const pens = this.pens;
    // With no pen ever seen on this device, only a pen that arrives within a second takes the stroke back.
    if (this.presenceAt(t) === P.Absent || !pens.penSeen) {
      this.fx.push(c.id[i], Role.Ignore, Fx.Commit, c.why[i]);
      this.commits.add(c.id[i], t, c.x0[i], c.y0[i]);
      return 0;
    }
    // A dot (a contact that never moved) is the most ambiguous ink: a palm that bounces before the pen arrives looks
    // the same. With the pen used in the last 20 s, or without real sizes to tell a palm, it stays unseen until it
    // commits; a pen that arrives within a second after that still takes it back (late retract). Every stroke commits
    // `graceMs` after its lift.
    const dot = c.disp[i] < K.WEAK_TRAVEL_MM;
    const penLately = t - pens.lastEvidence < K.RECENT_MS;
    const hidden = dot && (penLately || c.sizeMode !== SizeMode.Real);
    if (this.holds.add(c.id[i], c.t0[i], t + this.settings.graceMs, c.x0[i], c.y0[i]) >= 0)
      return hidden ? End.Held | End.Hidden : End.Held;
    this.fx.push(c.id[i], Role.Ignore, Fx.Commit, c.why[i]);
    return 0;
  }

  /** Commits made under a second before a pen arrives, inside its hand region, are taken back. */
  lateRetract(t: number): void {
    const m = this.commits;
    const p = this.pens;
    for (let k = 0; k < K.MAX_COMMITS; k++) {
      if (t - m.t[k] >= K.LATE_RETRACT_MS) continue;
      if (this.hand.membershipAny(m.x[k], m.y[k], p.tipX, p.tipY) < 0.5) continue;
      this.fx.push(m.id[k], Role.Ignore, Fx.Uncommit, 0);
      m.forget(k);
    }
  }

  private learnTip(i: number): void {
    const c = this.c;
    if (c.sizeMode !== SizeMode.Real || (c.flags[i] & F.Sized) === 0) return;
    if (this.tipN >= 20) {
      this.tipSum -= this.tipSum / this.tipN;
      this.tipN--;
    }
    this.tipSum += c.majorMax[i];
    this.tipN++;
  }

  /** Learns the hand region from a palm that ends: its mean offset from the pen tip, or from the drawing contact. */
  learnHand(i: number, t: number): void {
    const c = this.c;
    if (c.cls[i] !== Cls.Palm || c.sumN[i] < 3) return;
    const hard = (c.why[i] & (E.PalmSize | E.OsPalm)) !== 0;
    if (!hard && t - c.t0[i] < K.LEARN_HOLD_MS) return;
    const mx = c.sumDx[i] / c.sumN[i];
    const my = c.sumDy[i] / c.sumN[i];
    if ((c.flags[i] & F.RelValid) === 0) {
      this.learnTouchHand(mx, my);
      return;
    }
    // A palm the size or the system confirmed tells the side of the hand at once; any other votes once.
    if ((c.flags[i] & F.Voted) === 0) this.voteSide(mx, my, hard ? K.SIDE_VOTES : 1);
    this.hand.learn(mx, my);
  }

  /**
   * Learns the drawing hand from a palm's mean offset from the drawing contact. A palm on the side not assumed votes,
   * and two votes flip the region, unless the setting pins it.
   */
  private learnTouchHand(mx: number, my: number): void {
    const h = this.touchHand;
    if (Math.abs(mx) > 10 && Math.sign(mx) !== Math.sign(h.ox) && !h.pinned) {
      this.touchVotes = K.clamp(this.touchVotes + Math.sign(mx), -K.SIDE_VOTES, K.SIDE_VOTES);
      if (Math.abs(this.touchVotes) >= K.SIDE_VOTES) {
        h.flip();
        this.touchVotes = 0;
      }
      return;
    }
    h.learn(mx, my);
  }

  /** Releases a contact's slot and its bookkeeping. */
  release(i: number, t: number): void {
    const c = this.c;
    if (c.flags[i] & F.HandHeld) {
      this.handLive--;
      if (t > this.handLift) this.handLift = t;
    }
    if (i === this.drawSlot) this.drawSlot = -1;
    if (i === this.shadowSlot) this.shadowSlot = -1;
    const j = c.pairWith[i];
    if (i === this.pendA || (j >= 0 && j === this.pendA)) this.pendA = -1;
    if (j >= 0 && c.pairWith[j] === i) c.pairWith[j] = -1;
    c.pairWith[i] = -1;
    c.free(i);
  }

  /**
   * Seeds the hand regions from learned state, the setting, and the system handedness. The system's handedness is only
   * a prior for the side: Windows always reports one, right unless changed, so it never counts as knowing the side.
   * Only the setting or learned state does; until a lean, side votes, or learning confirm it, both sides count.
   */
  seedHands(): void {
    const set = this.settings.handedness;
    const left = set === 'left' || (set === 'auto' && this.profile.systemHandedness === 'left');
    const explicit = set !== 'auto';
    const saved = this.learnedIn ? (left ? this.learnedIn.hand.left : this.learnedIn.hand.right) : null;
    this.hand.set(saved ?? mirror(K.PEN_HAND, left), explicit);
    this.hand.seeded = saved !== null || explicit;
    const touch = this.learnedIn?.touchHand ?? mirror(K.TOUCH_HAND, left);
    this.touchHand.set(touch, explicit);
    this.touchHand.either = !explicit && !this.learnedIn?.touchHand;
    this.sideVotes = this.touchVotes = 0;
  }

  learned(): LearnedState {
    const before = this.learnedIn;
    const shape = this.hand.shape();
    const left = shape.ox < 0;
    return {
      penSeen: this.pens.penSeen,
      hand: {
        right: left ? (before?.hand.right ?? null) : shape,
        left: left ? shape : (before?.hand.left ?? null),
      },
      touchHand: this.touchHand.shape(),
      touchStylusTipMm: this.stylusTip(),
      pxPerMmCalibrated: before?.pxPerMmCalibrated ?? 0,
    };
  }

  /** Whether a contact is grip by E15 right now. */
  grip(i: number): boolean {
    return isGrip(this.c, i, this.x);
  }
}
