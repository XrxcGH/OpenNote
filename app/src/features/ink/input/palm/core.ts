// The filter's state and its primitive operations: presence, scoring, verdicts, role changes, holds, and learning.
// `decide.ts` holds the role rules and `filter.ts` the public API.

import { Cls, ContactTable, F, SizeMode } from './contacts';
import { EffectQueue, Fx, Role } from './effects';
import { HandRegion } from './handRegion';
import { Holds, RecentCommits } from './holds';
import { P, PenSlots, penContext } from './presence';
import { E, HARD, isGrip, ScoreContext, scoreContact } from './score';
import { DEFAULT_PALM_SETTINGS, UNKNOWN_PROFILE } from './settings';
import type { DeviceProfile, HandShape, LearnedState, PalmSettings } from './settings';
import * as thresholds from './thresholds';

/** A plain copy, so hot loops read fields rather than module bindings. */
const K = { ...thresholds };

const mirror = (s: HandShape, left: boolean): HandShape => (left ? { ox: -s.ox, oy: s.oy, r: s.r } : s);

export class Core {
  settings: PalmSettings = DEFAULT_PALM_SETTINGS;
  profile: DeviceProfile = UNKNOWN_PROFILE;
  readonly c = new ContactTable();
  readonly pens = new PenSlots();
  readonly hand = new HandRegion(K.PEN_HAND);
  readonly touchHand = new HandRegion(K.TOUCH_HAND);
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
  /** The earliest time a live contact reaches its next checkpoint. */
  dueAt = Infinity;
  /** Learned passive stylus tip: running sum and count of committed stroke sizes. */
  tipSum = 0;
  tipN = 0;
  learnedIn: LearnedState | null = null;

  presenceAt(t: number): P {
    this.pens.graceMs = this.settings.graceMs;
    this.pens.handHeld = this.handLive > 0 || t - this.handLift < this.settings.graceMs;
    return this.pens.presence(t, this.profile.penDigitizer === false);
  }

  fingerDrawOn(): boolean {
    const mode = this.settings.fingerDraw;
    if (this.settings.penOnly || this.profile.pencilOnly) return false;
    return mode === 'on' || (mode === 'auto' && !this.pens.penSeen);
  }

  managed(): boolean {
    return this.pens.penSeen || this.profile.penDigitizer === true || (this.fingerDrawOn() && this.inkTool);
  }

  /** Fills the score context for time t and presence p. */
  prepare(t: number, p: P): void {
    const x = this.x;
    x.t = t;
    x.presence = p;
    x.penCtx = penContext(p);
    x.drawMode = this.inkTool && p <= P.Away && this.fingerDrawOn();
    x.drawSlot = this.drawSlot;
    x.tipValid = this.pens.tipValid;
    x.tipX = this.pens.tipX;
    x.tipY = this.pens.tipY;
    x.sinceEvidence = t - this.pens.lastEvidence;
    x.sensitivity = this.settings.sensitivity === 'low' ? -1 : this.settings.sensitivity === 'high' ? 1 : 0;
    x.edgeGrip = this.profile.edgeGrip;
    x.stylusTip = this.stylusTip();
  }

  stylusTip(): number {
    if (this.learnedIn && this.learnedIn.touchStylusTipMm > 0 && this.tipN < K.TIP_LEARN_STROKES) {
      return this.learnedIn.touchStylusTipMm;
    }
    const mean = this.tipN > 0 ? this.tipSum / this.tipN : 0;
    return this.tipN >= K.TIP_LEARN_STROKES && mean <= K.TIP_STYLUS_MAX_MM ? mean : 0;
  }

  setRole(i: number, role: Role, fx: number): void {
    const c = this.c;
    c.role[i] = role;
    this.fx.push(c.id[i], role, fx, c.why[i]);
  }

  /** Scores a contact and applies the verdict with hysteresis. */
  rescore(i: number): void {
    const c = this.c;
    const s = scoreContact(c, i, this.x);
    if (!Number.isNaN(c.tAction[i]) && this.x.t - c.tAction[i] >= K.CONFIRM_MS) c.confirmed[i] = 1;
    if (c.cls[i] === Cls.Palm) return;
    const judged = this.x.penCtx || this.x.drawMode || (c.flags[i] & F.OsPalm) !== 0;
    if (!judged) return;
    const role = c.role[i];
    const grip = (c.why[i] & E.Grip) !== 0 && (role === Role.Draw || role === Role.Shadow);
    if (s >= K.PALM_SCORE || grip) {
      if (c.confirmed[i] === 1 && (c.why[i] & HARD) === 0) return;
      this.latchPalm(i);
    } else {
      c.cls[i] = s <= K.FINGER_SCORE ? Cls.Finger : Cls.Unsure;
    }
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

  /** A palm verdict: final for the contact's life. Its ink goes, its camera move reverts, and its tap is swallowed. */
  latchPalm(i: number): void {
    const c = this.c;
    if (c.cls[i] === Cls.Palm) return;
    c.cls[i] = Cls.Palm;
    c.flags[i] |= F.Suppress;
    if (this.x.penCtx && (c.flags[i] & F.HandHeld) === 0) {
      c.flags[i] |= F.HandHeld;
      this.handLive++;
    }
    const role = c.role[i];
    let fx: number = Fx.SuppressTap;
    if (role === Role.Draw || role === Role.Shadow) fx |= Fx.Retract;
    if ((role === Role.Scroll || role === Role.Nav) && c.started[i] === 1) fx |= Fx.Revert;
    this.unpair(i, true);
    this.setRole(i, Role.Ignore, fx);
    if (i === this.shadowSlot) this.shadowSlot = -1;
    if (i === this.drawSlot) {
      this.drawSlot = -1;
      this.promoteShadow();
    }
  }

  /** Ends a pair: the partner is ignored, and its camera move reverts when `revert` is set and it had started. */
  unpair(i: number, revert: boolean): void {
    const c = this.c;
    const j = c.pairWith[i];
    c.pairWith[i] = -1;
    if (j < 0 || c.used[j] === 0) return;
    c.pairWith[j] = -1;
    const fx = revert && c.started[j] === 1 ? Fx.Revert : 0;
    c.started[j] = 0;
    this.setRole(j, Role.Ignore, fx);
  }

  promoteShadow(): void {
    const s = this.shadowSlot;
    if (s < 0) return;
    this.shadowSlot = -1;
    this.drawSlot = s;
    this.c.tAction[s] = this.c.t0[s];
    this.setRole(s, Role.Draw, Fx.Promote);
  }

  /** Real pen evidence at t drops every live touch stroke and every held stroke that began at or before t. */
  dropTouchInk(t: number): void {
    const c = this.c;
    if (this.drawSlot >= 0 || this.shadowSlot >= 0) {
      for (let i = 0; i < K.MAX_CONTACTS; i++) {
        const role = c.role[i];
        if (c.used[i] === 1 && (role === Role.Draw || role === Role.Shadow)) this.setRole(i, Role.Ignore, Fx.Retract);
      }
      this.drawSlot = this.shadowSlot = -1;
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

  /** Holds or commits a touch stroke that ended at t. Returns true when it was held. */
  endStroke(i: number, t: number): boolean {
    const c = this.c;
    this.learnTip(i);
    if (this.presenceAt(t) === P.Absent) {
      this.fx.push(c.id[i], Role.Ignore, Fx.Commit, c.why[i]);
      this.commits.add(c.id[i], t, c.x0[i], c.y0[i]);
      return false;
    }
    // A dot (a contact that never moved) is the most ambiguous ink: a palm that bounces before the pen arrives
    // looks the same. It waits the late-retract window, so a pen that arrives in that time drops it unseen.
    const hold =
      c.disp[i] < K.WEAK_TRAVEL_MM ? Math.max(this.settings.graceMs, K.LATE_RETRACT_MS) : this.settings.graceMs;
    if (this.holds.add(c.id[i], c.t0[i], t + hold, c.x0[i], c.y0[i]) >= 0) return true;
    this.fx.push(c.id[i], Role.Ignore, Fx.Commit, c.why[i]);
    return false;
  }

  /** Commits made under a second before a pen arrives, inside its hand region, are taken back. */
  lateRetract(t: number): void {
    const m = this.commits;
    const p = this.pens;
    for (let k = 0; k < K.MAX_COMMITS; k++) {
      if (t - m.t[k] >= K.LATE_RETRACT_MS) continue;
      if (this.hand.membership(m.x[k], m.y[k], p.tipX, p.tipY) < 0.5) continue;
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
    if (c.flags[i] & F.RelValid) this.hand.learn(mx, my);
    else this.touchHand.learn(mx, my);
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
    c.free(i);
  }

  /** Seeds the hand regions from learned state, the setting, and the system handedness. */
  seedHands(): void {
    const set = this.settings.handedness;
    const left = set === 'left' || (set === 'auto' && this.profile.systemHandedness === 'left');
    const explicit = set !== 'auto';
    const saved = this.learnedIn ? (left ? this.learnedIn.hand.left : this.learnedIn.hand.right) : null;
    this.hand.set(saved ?? mirror(K.PEN_HAND, left), explicit);
    this.hand.seeded = saved !== null || explicit || this.profile.systemHandedness !== null;
    const touch = this.learnedIn?.touchHand ?? mirror(K.TOUCH_HAND, left);
    this.touchHand.set(touch, explicit);
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
