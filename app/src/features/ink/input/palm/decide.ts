// Role rules (README, "Roles and gates" and "Finger drawing"): what a contact does when it lands, moves, and lifts.

import { Cls as Cls_, F as F_, SizeMode as SizeMode_ } from './contacts';
import type { Core } from './core';
import { End as End_, Fx as Fx_, Role as Role_ } from './effects';
import { P as P_ } from './presence';
import {
  canPair as canPair_,
  chromeGate as chromeGate_,
  navGate as navGate_,
  panConfirmed as panConfirmed_,
  scrollGate as scrollGate_,
  tapGate as tapGate_,
} from './roles';
import { E as E_ } from './score';
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
const canPair = canPair_;
const chromeGate = chromeGate_;
const navGate = navGate_;
const panConfirmed = panConfirmed_;
const scrollGate = scrollGate_;
const tapGate = tapGate_;
const E = { ...E_ };

/** A plain copy, so hot loops read fields rather than module bindings. */
const K = { ...thresholds };

const isNav = (role: number) => role === Role.Nav;

/**
 * With the pen recent, a contact in the hand of the pen needs one point more against it to tap: a palm bounce where
 * the next line starts never taps. With the pen recent or near, a contact outside every hand region needs one point
 * less to pan or pinch, so a thumb of the other hand pinches.
 */
function handShift(core: Core, i: number, p: PresenceCode, nav: boolean): number {
  const hand = (core.c.why[i] & E.HandRegion) !== 0;
  if (hand) return p === P.Recent && !nav ? 1 : 0;
  return nav && (p === P.Recent || p === P.Near) ? -1 : 0;
}

/** The role of a contact that just landed and was scored. */
export function decideDown(core: Core, i: number, p: PresenceCode): RoleCode {
  const c = core.c;
  if (c.flags[i] & F.Chrome) return chromeGate(p, c.score[i], c.cls[i] === Cls.Palm) ? Role.Pass : Role.Ignore;
  if (c.cls[i] === Cls.Palm) return Role.Ignore;
  if (core.x.drawMode) return decideDraw(core, i);
  if (!core.managed()) return Role.Pass;
  if (p === P.Down) return Role.Ignore;
  const paired = pairWithin(core, i, p);
  if (paired !== Role.Pass) return paired;
  if (core.settings.penOnly) return Role.Ignore;
  if (p === P.Recent && core.inkTool && core.settings.fingerDraw === 'on' && core.drawSlot < 0 && c.score[i] <= -1) {
    core.drawSlot = i;
    c.tAction[i] = c.t0[i];
    return Role.Draw;
  }
  return busy(core, i) ? Role.Ignore : Role.Scroll;
}

/** True while another contact scrolls, pans, or draws, so a newcomer cannot start a scroll of its own. */
function busy(core: Core, i: number): boolean {
  const c = core.c;
  for (let j = 0; j < K.MAX_CONTACTS; j++) {
    if (j === i || c.used[j] === 0) continue;
    const role = c.role[j];
    if (isNav(role) || (role === Role.Scroll && c.started[j] === 1) || role === Role.Draw || role === Role.Pend) {
      return true;
    }
  }
  return false;
}

/**
 * Pairs a newcomer into a two-finger pan. Only contacts that are not palm and not ignored, landed inside the pair
 * window, at finger spacing, count. A third finger inside the window voids the pair; any other newcomer is ignored
 * and leaves the pair alone. Returns Pass when no pair rule applies.
 */
function pairWithin(core: Core, i: number, p: PresenceCode): RoleCode {
  const c = core.c;
  let partner = -1;
  let candidates = 0;
  for (let j = 0; j < K.MAX_CONTACTS; j++) {
    if (j === i || c.used[j] === 0 || c.cls[j] === Cls.Palm || (c.flags[j] & F.Chrome) !== 0) continue;
    const role = c.role[j];
    if (isNav(role)) {
      const k = c.pairWith[j];
      const first = k >= 0 && c.t0[k] < c.t0[j] ? k : j;
      if (c.t0[i] - c.t0[first] <= K.PAIR_WINDOW_MS) {
        core.unpair(j, true);
        core.setRole(j, Role.Ignore, c.started[j] === 1 ? Fx.Revert : 0);
        c.started[j] = 0;
      }
      return Role.Ignore;
    }
    if ((role === Role.Scroll || role === Role.Draw) && c.pairWith[j] < 0 && canPair(c, i, j)) {
      partner = j;
      candidates++;
    }
  }
  if (candidates !== 1) return candidates > 1 ? Role.Ignore : Role.Pass;
  if (p === P.Near && !core.settings.twoFingerNavNearPen) return Role.Ignore;
  pair(core, i, partner);
  return Role.Nav;
}

function pair(core: Core, i: number, j: number): void {
  const c = core.c;
  c.pairWith[i] = j;
  c.pairWith[j] = i;
  c.pairD0[i] = c.pairD0[j] = c.dist(i, j);
  const wasDrawing = c.role[j] === Role.Draw;
  if (j === core.drawSlot) core.drawSlot = -1;
  core.setRole(j, Role.Nav, wasDrawing ? Fx.Retract : 0);
  if (core.shadowSlot >= 0) {
    core.setRole(core.shadowSlot, Role.Ignore, Fx.Retract);
    core.shadowSlot = -1;
  }
}

/** A drawing contact is weak when it has not moved in the last 150 ms, has grown, or scores as a likely palm. */
function weak(core: Core, d: number): boolean {
  const c = core.c;
  const t = core.x.t;
  const still = t - c.t0[d] >= K.WEAK_AGE_MS && c.stillFor(d, t) >= K.RECENT_STILL_MS;
  return still || (c.why[d] & E.Growth) !== 0 || c.score[d] >= K.WEAK_SCORE;
}

/** Whether contact a lies inside the hand of contact b, on either side while the side of the hand is unknown. */
const inHandOf = (core: Core, a: number, b: number): boolean =>
  core.touchHand.holds(core.c.x[a], core.c.y[a], core.c.x[b], core.c.y[b]);

/** Finger drawing: one draw slot, chosen by geometry, recent motion, and classification rather than by arrival. */
function decideDraw(core: Core, i: number): RoleCode {
  const c = core.c;
  if (!tipAllowed(core, i)) return Role.Ignore;
  const a = core.pendA;
  if (a >= 0) {
    // A third contact inside the pair window voids the pair, as in a three-finger tap; a later one is ignored.
    const b = c.pairWith[a];
    if (b >= 0 && c.t0[i] - c.t0[a] <= K.PAIR_WINDOW_STILL_MS) voidPend(core, a, b);
    return Role.Ignore;
  }
  const h = core.drawSlot;
  const d = h >= 0 ? h : core.shadowSlot;
  // Any newcomer that is not a palm and lands in the pair window may be a pinch, a knuckle, or the real tip: both
  // strokes build hidden until motion tells which.
  if (d >= 0 && c.pairWith[d] < 0 && canPair(c, i, d)) return pend(core, i, d);
  if (h < 0) return edgeStart(core, i) ? shadow(core, i) : takeSlot(core, i);
  // The holder rests inside the newcomer's hand: it is that hand, and the newcomer writes (E18).
  const t = core.x.t;
  const handRests = c.stillFor(h, t) >= K.RECENT_STILL_MS && t - c.t0[h] >= K.WEAK_AGE_MS;
  if ((handRests && inHandOf(core, h, i)) || (weak(core, h) && c.score[i] < c.score[h])) {
    yieldSlot(core, h);
    return takeSlot(core, i);
  }
  return c.score[i] <= 0 ? shadow(core, i) : Role.Ignore;
}

const edgeStart = (core: Core, i: number): boolean => core.x.edgeGrip && (core.c.flags[i] & F.Edge) !== 0;

function takeSlot(core: Core, i: number): RoleCode {
  core.drawSlot = i;
  core.c.tAction[i] = core.c.t0[i];
  return Role.Draw;
}

function shadow(core: Core, i: number): RoleCode {
  if (core.shadowSlot >= 0) return Role.Ignore;
  core.shadowSlot = i;
  return Role.Shadow;
}

/**
 * The holder gives the draw slot up. One that stopped moving soon after it landed settled like a palm: it is latched
 * and its ink goes. One that wrote first keeps its stroke, which ends where it is.
 */
function yieldSlot(core: Core, h: number): void {
  const c = core.c;
  const wrote = core.movesOn(h) && (c.why[h] & E.Growth) === 0 && c.score[h] < K.WEAK_SCORE;
  if (!wrote) {
    core.latchPalm(h, false);
    return;
  }
  core.drawSlot = -1;
  const bits = core.endStroke(h, core.x.t);
  core.setRole(h, Role.Ignore, bits & End.Held ? Fx.Hold : 0);
}

/** Pairs a newcomer with the holder or an edge stroke. Both build their strokes hidden until the pair resolves. */
function pend(core: Core, i: number, d: number): RoleCode {
  const c = core.c;
  c.pairWith[i] = d;
  c.pairWith[d] = i;
  c.pairD0[i] = c.pairD0[d] = c.dist(i, d);
  // When one rests inside the other's hand, the other is the writer, and only a spread or a squeeze is a pinch.
  if (inHandOf(core, d, i)) c.flags[i] |= F.Writer;
  else if (inHandOf(core, i, d)) c.flags[d] |= F.Writer;
  if ((c.flags[i] | c.flags[d]) & F.Writer) {
    c.flags[i] |= F.HandPair;
    c.flags[d] |= F.HandPair;
  }
  core.pendA = d;
  if (d === core.shadowSlot) core.shadowSlot = -1;
  // A stroke that already shows keeps drawing; one that does not yet show waits hidden with its partner.
  if (c.role[d] !== Role.Draw || (c.flags[d] & F.Shown) === 0) {
    if (d === core.drawSlot) core.drawSlot = -1;
    core.setRole(d, Role.Pend, 0);
  }
  if (core.shadowSlot >= 0) {
    core.setRole(core.shadowSlot, Role.Ignore, Fx.Retract);
    core.shadowSlot = -1;
  }
  return Role.Pend;
}

function voidPend(core: Core, a: number, b: number): void {
  const c = core.c;
  c.pairWith[a] = c.pairWith[b] = -1;
  core.pendA = -1;
  if (core.drawSlot === a || core.drawSlot === b) core.drawSlot = -1;
  core.setRole(a, Role.Ignore, Fx.Retract);
  core.setRole(b, Role.Ignore, Fx.Retract);
}

/**
 * A pinch in the hand: the spacing changes and the two contacts move apart or together rather than along with each
 * other, as a hand that slides with its writing finger does.
 */
function squeeze(core: Core, i: number, j: number): boolean {
  const c = core.c;
  if (c.disp[i] < K.SLOP_MM || c.disp[j] < K.SLOP_MM) return false;
  const grow = c.dist(i, j) - c.pairD0[i];
  if (Math.abs(grow) < K.PINCH_MM) return false;
  const ax = c.x[i] - c.x0[i];
  const ay = c.y[i] - c.y0[i];
  const bx = c.x[j] - c.x0[j];
  const by = c.y[j] - c.y0[j];
  // Neither moves against the pinch: apart for a spread, together for a squeeze. A writer that heads toward its
  // drifting palm changes the spacing too, but the palm does not come to meet it.
  const ux = c.x[j] - c.x[i];
  const uy = c.y[j] - c.y[i];
  const s = grow > 0 ? 1 : -1;
  if (s * (ax * ux + ay * uy) > 0 || s * (bx * ux + by * uy) < 0) return false;
  return ax * bx + ay * by < K.SQUEEZE_COS * K.len(ax, ay) * K.len(bx, by);
}

/**
 * One contact writes while the other rests: it has gone 3 mm and moved like a stroke rather than a palm settling, and
 * the other is under slop and has gone a quarter as far.
 */
function writes(core: Core, mover: number, rest: number): boolean {
  const c = core.c;
  const m = c.disp[mover];
  const r = c.disp[rest];
  return m >= K.PEND_WRITE_MM && r < K.SLOP_MM && r * K.PEND_REST_SHARE <= m && core.movesOn(mover);
}

/**
 * The contact of a pending pair that writes, or -1. In a hand pair it is the one whose hand the other rests in, once it
 * has written 3 mm while its hand rests or slides along; the hand writes only when it moves like a stroke. Otherwise
 * it is one that writes while the other rests.
 */
function writerOf(core: Core, i: number, j: number): number {
  const c = core.c;
  if (c.flags[i] & F.HandPair) {
    const w = c.flags[i] & F.Writer ? i : j;
    const o = w === i ? j : i;
    if (c.disp[w] >= K.PEND_WRITE_MM) return w;
    return writes(core, o, w) ? o : -1;
  }
  if (writes(core, i, j)) return i;
  return writes(core, j, i) ? j : -1;
}

/** Moves a pending pair on: a pan or pinch starts the camera, a writer draws, or the pair waits. */
function settlePend(core: Core, i: number, p: PresenceCode): void {
  const c = core.c;
  const j = c.pairWith[i];
  if (j < 0) {
    // Alone after its partner lifted: a stroke once it writes.
    if (c.disp[i] >= K.PEND_WRITE_MM && c.stillFor(i, core.x.t) < K.RECENT_STILL_MS) core.drawFrom(i);
    return;
  }
  const hand = (c.flags[i] & F.HandPair) !== 0;
  if (hand ? squeeze(core, i, j) : panConfirmed(c, i, j)) {
    if (!navGate(p, c.score[i], c.score[j], core.settings.twoFingerNavNearPen)) return;
    core.pendA = -1;
    if (core.drawSlot === i || core.drawSlot === j) core.drawSlot = -1;
    c.started[i] = c.started[j] = 1;
    c.tAction[i] = c.tAction[j] = core.x.t;
    core.setRole(i, Role.Nav, Fx.Retract | Fx.Start);
    core.setRole(j, Role.Nav, Fx.Retract | Fx.Start);
    return;
  }
  const w = writerOf(core, i, j);
  if (w < 0) return;
  const o = w === i ? j : i;
  c.pairWith[i] = c.pairWith[j] = -1;
  core.pendA = -1;
  if (core.drawSlot === o) core.drawSlot = -1;
  core.setRole(o, Role.Ignore, Fx.Retract);
  core.drawFrom(w);
}

/** "High" sensitivity with a learned stylus tip: only contacts the size of the tip draw. */
function tipAllowed(core: Core, i: number): boolean {
  const tip = core.x.stylusTip;
  if (core.settings.sensitivity !== 'high' || tip <= 0 || (core.c.flags[i] & F.Sized) === 0) return true;
  return core.c.majorMax[i] <= tip + K.TIP_STRICT_MARGIN_MM;
}

/**
 * On a device that has seen a pen, a one-finger scroll starts once its contact is 100 ms old with a steady size, or
 * has traveled 4.5 mm, so a palm that grows and drifts as it settles never moves the page. Without real sizes a
 * palm's growth cannot be seen, so the scroll waits until the contact moves like a scroll rather than a palm settling.
 */
function settled(core: Core, i: number): boolean {
  const c = core.c;
  if (!core.pens.penSeen) return true;
  if (c.sizeMode !== SizeMode.Real || (c.flags[i] & F.Sized) === 0) return core.movesOn(i);
  if (c.disp[i] >= K.SCROLL_SETTLE_MM) return true;
  const t = core.x.t;
  return t - c.t0[i] >= K.SCROLL_SETTLE_MS && t - c.tResized[i] >= K.SIZE_STEADY_MS;
}

/** After a move: starts a pending scroll or pan that passed its gate, and moves finger drawing's strokes on. */
export function afterMove(core: Core, i: number, p: PresenceCode): void {
  const c = core.c;
  const role = c.role[i];
  if (role === Role.Draw) core.showIfReady(i);
  if (role === Role.Scroll && c.started[i] === 0) {
    const s = c.score[i] + handShift(core, i, p, false);
    if (c.disp[i] >= K.SLOP_MM && scrollGate(p, s) && !busy(core, i) && settled(core, i)) start(core, i);
  } else if (role === Role.Nav && c.started[i] === 0) {
    const j = c.pairWith[i];
    if (j < 0 || !panConfirmed(c, i, j)) return;
    // Two contacts that spread or squeeze are a pinch; the parts of a palm drift together.
    const pinch = squeeze(core, i, j) ? K.PINCH_BONUS : 0;
    const si = c.score[i] + handShift(core, i, p, true) + pinch;
    const sj = c.score[j] + handShift(core, j, p, true) + pinch;
    if (!navGate(p, si, sj, core.settings.twoFingerNavNearPen)) return;
    start(core, i);
    start(core, j);
  } else if (role === Role.Pend || (role === Role.Draw && c.pairWith[i] >= 0)) {
    settlePend(core, i, p);
  } else if (role === Role.Shadow) {
    const h = core.drawSlot;
    if (h < 0) {
      // An edge stroke shows with its whole path once it travels away from where it landed.
      if (c.disp[i] >= K.EDGE_TRAVEL_MM) core.promoteShadow();
    } else if (c.disp[i] >= K.WEAK_TRAVEL_MM && weak(core, h) && !inHandOf(core, i, h)) {
      // The shadow writes while the holder rests, and the shadow is no part of the holder's hand.
      core.shadowSlot = -1;
      yieldSlot(core, h);
      core.drawFrom(i);
    }
  }
}

function start(core: Core, i: number): void {
  const c = core.c;
  c.started[i] = 1;
  c.tAction[i] = core.x.t;
  core.setRole(i, c.role[i] as RoleCode, Fx.Start);
}

/**
 * The pen went down: a scroll or pan in progress stops. It reverts when it began under 500 ms ago, and at any age when
 * its contact lies in the pen's hand or was never judged a finger.
 */
export function freezeNav(core: Core, t: number): void {
  const c = core.c;
  for (let i = 0; i < K.MAX_CONTACTS; i++) {
    if (c.used[i] === 0) continue;
    if (c.started[i] === 0) {
      // A scroll or pan that has not started never starts: the contact was down when the pen wrote.
      const role = c.role[i];
      if (role === Role.Scroll || isNav(role)) {
        c.pairWith[i] = -1;
        core.setRole(i, Role.Ignore, 0);
      }
      continue;
    }
    const hand = c.cls[i] !== Cls.Finger || core.inPenHand(c.x[i], c.y[i]);
    const fx = hand || t - c.tAction[i] < K.NAV_REVERT_MS ? Fx.Revert : 0;
    c.started[i] = 0;
    c.pairWith[i] = -1;
    core.setRole(i, Role.Ignore, fx);
  }
}

/** Ends a contact: holds or retracts its stroke, ends its pair, and says whether its lift may click. */
export function decideEnd(core: Core, i: number, t: number, p: PresenceCode): number {
  const c = core.c;
  let bits = 0;
  const role = c.role[i];
  if (role === Role.Pend || (role === Role.Draw && c.pairWith[i] >= 0)) {
    bits |= endPend(core, i, t);
  } else if (role === Role.Draw) {
    bits |= endDraw(core, i, t);
  } else if (role === Role.Shadow) {
    bits |= endShadow(core, i, t);
  } else if (isNav(role)) {
    core.unpair(i, false);
  }
  if (tapAllowed(core, i, t, p)) bits |= End.TapAllowed;
  return bits;
}

/** A drawing contact lifts: its stroke is held or committed, unless it scores as a palm now. */
function endDraw(core: Core, i: number, t: number): number {
  const c = core.c;
  let bits = 0;
  if (c.score[i] >= K.RETRACT_AT_LIFT) core.setRole(i, Role.Ignore, Fx.Retract);
  else {
    if (c.role[i] !== Role.Draw) core.setRole(i, Role.Draw, 0);
    bits = core.endStroke(i, t);
  }
  if (core.drawSlot === i) {
    core.drawSlot = -1;
    afterDrawEnd(core, i);
  }
  return bits;
}

/**
 * A contact of a pending pair lifts. The writer of a hand pair, or a stroke that already showed, ends as a stroke;
 * anything else is a tap or a resting hand and its ink goes. The partner keeps its stroke.
 */
function endPend(core: Core, a: number, t: number): number {
  const c = core.c;
  const b = c.pairWith[a];
  c.pairWith[a] = -1;
  let writes = (c.flags[a] & F.Writer) !== 0;
  if (b >= 0) {
    c.pairWith[b] = -1;
    core.pendA = -1;
    if (writes) {
      if (core.drawSlot === b) core.drawSlot = -1;
      core.setRole(b, Role.Ignore, Fx.Retract);
    } else if (c.flags[b] & F.Writer) {
      core.drawFrom(b);
    } else {
      writes = c.role[a] === Role.Draw;
    }
  }
  if (writes) return endDraw(core, a, t);
  if (core.drawSlot === a) core.drawSlot = -1;
  core.setRole(a, Role.Ignore, Fx.Retract);
  return 0;
}

/**
 * A shadow lifts. When the holder never moved while the shadow drew, the shadow was the stroke and the holder a
 * resting hand: the stroke is kept and the holder gives the slot up. Otherwise the shadow's ink goes.
 */
function endShadow(core: Core, s: number, t: number): number {
  const c = core.c;
  const h = core.drawSlot;
  core.shadowSlot = -1;
  const wrote = c.disp[s] >= K.WEAK_TRAVEL_MM || (h >= 0 && inHandOf(core, h, s));
  if (h >= 0 && c.tMoved[h] <= c.t0[s] && wrote) {
    yieldSlot(core, h);
    return endDraw(core, s, t);
  }
  core.setRole(s, Role.Ignore, Fx.Retract);
  return 0;
}

/** When the drawing contact lifts, a shadow that has moved takes the draw slot. */
function afterDrawEnd(core: Core, d: number): void {
  const s = core.shadowSlot;
  if (s < 0) return;
  const c = core.c;
  if (c.disp[s] >= K.WEAK_TRAVEL_MM || c.disp[d] < K.WEAK_TRAVEL_MM) core.promoteShadow();
}

function tapAllowed(core: Core, i: number, t: number, p: PresenceCode): boolean {
  const c = core.c;
  if ((c.flags[i] & F.Suppress) !== 0 || c.cls[i] === Cls.Palm || c.started[i] === 1) return false;
  if (t - c.t0[i] >= K.LONG_PRESS_MS || c.disp[i] >= K.SLOP_MM) return false;
  return mayTap(core, i, p);
}

/** Whether a still contact's long press may open the menu now. */
export function pressAllowed(core: Core, i: number, p: PresenceCode): boolean {
  const c = core.c;
  if ((c.flags[i] & F.Suppress) !== 0 || c.cls[i] === Cls.Palm || c.started[i] === 1) return false;
  if (c.disp[i] >= K.SLOP_MM) return false;
  return mayTap(core, i, p);
}

function mayTap(core: Core, i: number, p: PresenceCode): boolean {
  const c = core.c;
  const role = c.role[i];
  if (c.flags[i] & F.Chrome) return role === Role.Pass && chromeGate(p, c.score[i], false);
  const s = c.score[i] + handShift(core, i, p, false);
  return (role === Role.Scroll || role === Role.Pass) && tapGate(p, s);
}
