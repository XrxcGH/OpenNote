// The palm filter's public API (README, "API"). It has no timers, clocks, or randomness: every call carries the
// event time, so a recorded session replays the same way. A pen never waits: `pen` does constant bookkeeping and
// gates nothing. Touch ink is provisional until its contact resolves and its hold passes.

import { Cls, F } from './contacts';
import { Core } from './core';
import { decideDown, decideEnd, afterMove, freezeNav, pressAllowed } from './decide';
import { Fx, Role } from './effects';
import type { Effects } from './effects';
import { leanOf } from './handRegion';
import { P, PRESENCE_NAMES, penContext } from './presence';
import type { PenSignal, Presence } from './presence';
import { sanitizeLearned, sanitizeProfile, sanitizeSettings } from './settings';
import type { DeviceProfile, LearnedState, PalmSettings } from './settings';
import * as thresholds from './thresholds';
import { resolvePxPerMm } from './units';

/** A plain copy, so hot loops read fields rather than module bindings. */
const K = { ...thresholds };

export type Surface = 'page' | 'chrome';
/** Window blur, the page hidden, a page switch, or a pen capture lost while the pen is still down. */
export type SystemSignal = 'blur' | 'hidden' | 'pageSwitch' | 'penCaptureLost';
export type TouchPolicy = 'native' | 'managed';

export interface PalmFilter {
  configure(settings: Partial<PalmSettings>): void;
  setProfile(profile: Partial<DeviceProfile>, learned?: LearnedState): void;
  /** The page's viewport in CSS px, for the edge-grip rule. */
  setViewport(widthPx: number, heightPx: number): void;
  setInkToolActive(active: boolean): void;
  /** Every pen event from window-level listeners, hover included. Positions are client CSS px; tilt in degrees. */
  pen(signal: PenSignal, pointerId: number, time: number, x: number, y: number, tiltX: number, tiltY: number): void;
  touchDown(
    id: number,
    time: number,
    x: number,
    y: number,
    w: number,
    h: number,
    pressure: number,
    surface: Surface,
  ): Role;
  touchMove(id: number, time: number, x: number, y: number, w: number, h: number, pressure: number): Role;
  /** End bits; a held stroke resolves later as an `Fx.Commit` or `Fx.Retract` effect. */
  touchEnd(id: number, time: number, canceled: boolean): number;
  /** Whether a still contact's long press may open the menu now. */
  pressAllowed(id: number, time: number): boolean;
  /** A native hint matched to a contact by position (2 mm) and time (20 ms). */
  hint(kind: 'palm' | 'confident', time: number, x: number, y: number): void;
  system(signal: SystemSignal, time: number): void;
  /** Call every 100 ms while `needsTick` is true, and at `nextDue`. */
  tick(time: number): void;
  needsTick(): boolean;
  /** When the next held stroke commits, so the page view can tick exactly then; Infinity when none waits. */
  nextDue(): number;
  presence(time: number): Presence;
  touchPolicy(): TouchPolicy;
  /** The effects of the last call. Read them after every call; the next call clears them. */
  readonly effects: Effects;
  /** The evidence bits behind a live contact's verdict. */
  explain(id: number): number;
  /** The live contact's role, or Ignore for an unknown id. */
  roleOf(id: number): Role;
  learned(): LearnedState;
}

class Filter implements PalmFilter {
  private readonly core = new Core();
  private readonly lean = { x: 0, y: 0 };

  constructor(settings: Partial<PalmSettings>, profile: Partial<DeviceProfile>, learned?: LearnedState) {
    this.core.settings = sanitizeSettings(settings);
    this.setProfile(profile, learned);
  }

  get effects(): Effects {
    return this.core.fx;
  }

  configure(next: Partial<PalmSettings>): void {
    const before = this.core.settings.handedness;
    this.core.settings = sanitizeSettings({ ...this.core.settings, ...next });
    if (this.core.settings.handedness !== before) this.core.seedHands();
  }

  setProfile(profile: Partial<DeviceProfile>, learned?: LearnedState): void {
    const core = this.core;
    core.profile = sanitizeProfile(profile);
    if (learned) core.learnedIn = sanitizeLearned(learned);
    core.pxPerMm = resolvePxPerMm(core.profile.pxPerMm, core.learnedIn?.pxPerMmCalibrated);
    core.pens.watchdogMs = core.profile.hoverWatchdogMs;
    if (core.learnedIn?.penSeen) core.pens.penSeen = true;
    core.seedHands();
  }

  setViewport(widthPx: number, heightPx: number): void {
    this.core.viewW = widthPx / this.core.pxPerMm;
    this.core.viewH = heightPx / this.core.pxPerMm;
  }

  setInkToolActive(active: boolean): void {
    this.core.inkTool = active;
  }

  pen(signal: PenSignal, pointerId: number, t: number, x: number, y: number, tiltX: number, tiltY: number): void {
    const core = this.core;
    const pens = core.pens;
    core.fx.count = 0;
    core.settle(t);
    const before = core.presenceAt(t);
    const evidence = pens.apply(signal, pointerId, t);
    if (signal !== 'leave' && Number.isFinite(x) && Number.isFinite(y)) {
      pens.tipX = x / core.pxPerMm;
      pens.tipY = y / core.pxPerMm;
      pens.tipValid = true;
    }
    if ((signal === 'down' || (signal === 'hover' && !core.hand.seeded)) && leanOf(tiltX, tiltY, this.lean)) {
      core.hand.lean(this.lean.x, this.lean.y);
    }
    if (!evidence) return;
    core.dropTouchInk(t);
    const after = core.presenceAt(t);
    const arrival = before <= P.Recent && after >= P.Near;
    if (arrival) core.lateRetract(t);
    if (core.c.live === 0) return;
    const wentDown = after === P.Down && before !== P.Down;
    if (!arrival && !wentDown) {
      if (!core.due(t)) return;
      core.prepare(t, after);
      core.checkpoints(t);
      return;
    }
    if (arrival) this.arrive(t);
    if (wentDown) freezeNav(core, t);
    core.prepare(t, after);
    core.rescoreAll();
  }

  /** A pen arrived: contacts that landed first and stayed still gain E9. */
  private arrive(t: number): void {
    const c = this.core.c;
    for (let i = 0; i < K.MAX_CONTACTS; i++) {
      if (c.used[i] === 0 || t - c.t0[i] >= K.PALM_FIRST_AGE_MS || c.disp[i] >= K.PALM_FIRST_TRAVEL_MM) continue;
      c.flags[i] |= F.PalmFirst;
    }
  }

  touchDown(
    id: number,
    t: number,
    x: number,
    y: number,
    w: number,
    h: number,
    pressure: number,
    surface: Surface,
  ): Role {
    const core = this.core;
    const c = core.c;
    core.fx.count = 0;
    core.settle(t);
    this.prune(t);
    const existing = c.find(id);
    if (existing >= 0) core.release(existing, t);
    const xm = x / core.pxPerMm;
    const ym = y / core.pxPerMm;
    const i = c.add(id, t, xm, ym);
    if (i < 0) return Role.Ignore;
    core.dueAt = Math.min(core.dueAt, t + K.CHECKPOINTS_MS[0]);
    this.size(i, w, h, pressure);
    const p = core.presenceAt(t);
    if (p === P.Down) c.flags[i] |= F.PenDownAtLand;
    c.sinceUp[i] = t - core.pens.lastUpOrLeave;
    if (surface === 'chrome') c.flags[i] |= F.Chrome;
    if (!penContext(p) && !(core.inkTool && core.fingerDrawOn())) c.flags[i] |= F.Unjudged;
    this.edge(i, xm, ym);
    core.x.land(t, xm, ym);
    this.track(i, p);
    core.prepare(t, p);
    core.rescoreAll();
    core.checkpoints(t);
    if (c.cls[i] === Cls.Palm) return Role.Ignore;
    const role = decideDown(core, i, p);
    core.setRole(i, role, 0);
    return role;
  }

  touchMove(id: number, t: number, x: number, y: number, w: number, h: number, pressure: number): Role {
    const core = this.core;
    const c = core.c;
    core.fx.count = 0;
    core.settle(t);
    const i = c.find(id);
    if (i < 0) return Role.Ignore;
    c.moveTo(i, t, x / core.pxPerMm, y / core.pxPerMm);
    this.size(i, w, h, pressure);
    const p = core.presenceAt(t);
    this.track(i, p);
    core.prepare(t, p);
    core.rescore(i);
    core.checkpoints(t);
    if (c.used[i] === 1) afterMove(core, i, p);
    return c.role[i] as Role;
  }

  touchEnd(id: number, t: number, canceled: boolean): number {
    const core = this.core;
    const c = core.c;
    core.fx.count = 0;
    core.settle(t);
    const i = c.find(id);
    if (i < 0) return 0;
    if (canceled && core.managed()) c.flags[i] |= F.OsPalm;
    if (t - c.t0[i] <= K.TAP_MS && c.disp[i] < K.STILL_MM) c.flags[i] |= F.Tap;
    const p = core.presenceAt(t);
    core.prepare(t, p);
    core.rescore(i);
    const bits = decideEnd(core, i, t, p);
    core.learnHand(i, t);
    core.release(i, t);
    if (c.live > 0) {
      core.prepare(t, p);
      core.rescoreAll();
    }
    return bits;
  }

  pressAllowed(id: number, t: number): boolean {
    const core = this.core;
    const i = core.c.find(id);
    if (i < 0) return false;
    const p = core.presenceAt(t);
    core.prepare(t, p);
    return pressAllowed(core, i, p);
  }

  hint(kind: 'palm' | 'confident', t: number, x: number, y: number): void {
    const core = this.core;
    const c = core.c;
    core.fx.count = 0;
    if (kind !== 'palm') return;
    const xm = x / core.pxPerMm;
    const ym = y / core.pxPerMm;
    for (let i = 0; i < K.MAX_CONTACTS; i++) {
      if (c.used[i] === 0 || t < c.t0[i] - K.HINT_MS || t > c.tLast[i] + K.HINT_MS) continue;
      if (K.len(c.x[i] - xm, c.y[i] - ym) > K.HINT_MM) continue;
      c.flags[i] |= F.OsPalm;
      core.prepare(t, core.presenceAt(t));
      core.rescore(i);
    }
  }

  system(signal: SystemSignal, t: number): void {
    const core = this.core;
    core.fx.count = 0;
    core.settle(t);
    if (signal === 'penCaptureLost') {
      core.pens.release(t, true);
      return;
    }
    if (signal !== 'pageSwitch') core.pens.release(t, false);
    this.endAll(t);
    if (signal !== 'pageSwitch') return;
    const h = core.holds;
    for (let k = 0; k < K.MAX_HOLDS; k++) if (h.used[k] === 1) core.commitHold(k, t);
  }

  /** Blur, hidden, or page switch: strokes end into their hold, and every live contact is ignored until it ends. */
  private endAll(t: number): void {
    const core = this.core;
    const c = core.c;
    for (let i = 0; i < K.MAX_CONTACTS; i++) {
      if (c.used[i] === 0) continue;
      const role = c.role[i];
      if (role === Role.Draw) {
        const held = core.endStroke(i, t);
        core.setRole(i, Role.Ignore, held ? Fx.Hold : 0);
      } else if (role === Role.Shadow) {
        core.setRole(i, Role.Ignore, Fx.Retract);
      } else if (role !== Role.Ignore) {
        core.setRole(i, Role.Ignore, 0);
      }
      c.started[i] = 0;
      c.pairWith[i] = -1;
      c.flags[i] |= F.Suppress;
    }
    core.drawSlot = core.shadowSlot = -1;
  }

  tick(t: number): void {
    const core = this.core;
    core.fx.count = 0;
    core.settle(t);
    this.prune(t);
    if (core.c.live === 0 || !core.due(t)) return;
    core.prepare(t, core.presenceAt(t));
    core.checkpoints(t);
  }

  needsTick(): boolean {
    const core = this.core;
    return core.holds.count > 0 || core.c.live > 0;
  }

  nextDue(): number {
    const h = this.core.holds;
    let due = Infinity;
    for (let k = 0; k < K.MAX_HOLDS; k++) if (h.used[k] === 1) due = Math.min(due, h.until[k] + K.COMMIT_SLACK_MS);
    return due;
  }

  presence(t: number): Presence {
    return PRESENCE_NAMES[this.core.presenceAt(t)];
  }

  touchPolicy(): TouchPolicy {
    return this.core.managed() ? 'managed' : 'native';
  }

  explain(id: number): number {
    const i = this.core.c.find(id);
    return i < 0 ? 0 : this.core.c.why[i];
  }

  roleOf(id: number): Role {
    const i = this.core.c.find(id);
    return i < 0 ? Role.Ignore : (this.core.c.role[i] as Role);
  }

  learned(): LearnedState {
    return this.core.learned();
  }

  private size(i: number, w: number, h: number, pressure: number): void {
    const c = this.core.c;
    const ppm = this.core.pxPerMm;
    if (!(w > 1 || h > 1)) {
      if ((c.flags[i] & F.Sized) === 0) c.noSize();
      return;
    }
    const major = Math.max(w, h) / ppm;
    const minor = Math.min(w, h) / ppm;
    c.sizeTo(i, w, h, major, minor, Number.isFinite(pressure) ? pressure : 0);
  }

  /** Offsets from the pen tip (pen down) or from the drawing contact (finger drawing), for learning. */
  private track(i: number, p: P): void {
    const core = this.core;
    const c = core.c;
    const pens = core.pens;
    const dt = c.tLast[i] - c.tTrack[i];
    c.tTrack[i] = c.tLast[i];
    if (penContext(p) && pens.tipValid) {
      c.relTo(i, pens.tipX, pens.tipY);
      if (p !== P.Down) return;
      c.penDownMs[i] += Math.min(dt, K.PEN_DOWN_STEP_MS);
      c.sumDx[i] += c.x[i] - pens.tipX;
      c.sumDy[i] += c.y[i] - pens.tipY;
      c.sumN[i]++;
      return;
    }
    const d = core.drawSlot;
    if (d < 0 || d === i) return;
    c.sumDx[i] += c.x[i] - c.x[d];
    c.sumDy[i] += c.y[i] - c.y[d];
    c.sumN[i]++;
  }

  private edge(i: number, x: number, y: number): void {
    const core = this.core;
    if (core.viewW <= 0) return;
    const e = K.EDGE_MM;
    if (x <= e || y <= e || x >= core.viewW - e || y >= core.viewH - e) core.c.flags[i] |= F.Edge;
  }

  /** Forgets contacts whose end never came: silent for 10 s. A drawing one ends into its hold. */
  private prune(t: number): void {
    const core = this.core;
    const c = core.c;
    if (c.live === 0) return;
    for (let i = 0; i < K.MAX_CONTACTS; i++) {
      if (c.used[i] === 0 || t - c.tLast[i] < K.PRUNE_MS) continue;
      if (c.role[i] === Role.Draw) core.setRole(i, Role.Ignore, core.endStroke(i, t) ? Fx.Hold : 0);
      core.release(i, t);
    }
  }
}

/** One filter per page view. Settings, profile, and learned state can change later with `configure` and `setProfile`. */
export function createPalmFilter(
  settings: Partial<PalmSettings> = {},
  profile: Partial<DeviceProfile> = {},
  learned?: LearnedState,
): PalmFilter {
  return new Filter(settings, profile, learned);
}
