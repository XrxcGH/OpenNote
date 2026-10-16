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
  // "Draw with finger: on" with the pen recent: a finger draws provisionally, hidden until it moves like a stroke and
  // held after its lift, so pen evidence or a palm verdict takes it back. With the pen near it is ignored. One finger
  // never scrolls the page instead.
  if (core.inkTool && core.settings.fingerDraw === 'on' && core.fingerDrawOn()) {
    return p === P.Recent ? decideDraw(core, i) : Role.Ignore;
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

/**
 * A drawing contact is weak when it has not moved in the last 150 ms, has grown, or scores as a likely palm. A stroke
 * that shows and moved on is weak only when it grew: one that pauses mid-stroke is still the stroke.
 */
function weak(core: Core, d: number): boolean {
  const c = core.c;
  if ((c.why[d] & E.Growth) !== 0) return true;
  if (writing(core, d)) return false;
  return rests(core, d) || c.score[d] >= K.WEAK_SCORE;
}

/** A stroke in progress: its ink shows, it moved on like a stroke, and it never grew like a palm. */
const writing = (core: Core, d: number): boolean =>
  (core.c.flags[d] & F.Shown) !== 0 && core.movesOn(d) && (core.c.why[d] & E.Growth) === 0;

/** A contact rests: it is older than 150 ms and has not moved in the last 150 ms. */
function rests(core: Core, i: number): boolean {
  const c = core.c;
  const t = core.x.t;
  return c.stillFor(i, t) >= K.RECENT_STILL_MS && t - c.t0[i] >= K.WEAK_AGE_MS;
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
    const b = c.pairWith[a];
    // A third contact inside the pair window voids the pair, as in a three-finger tap.
    if (b >= 0 && c.t0[i] - c.t0[a] <= K.PAIR_WINDOW_STILL_MS) {
      voidPend(core, a, b);
      return Role.Ignore;
    }
    // Later, a pair that rests inside the newcomer's hand is that hand, as a holder would be (E18): the newcomer
    // writes. Any other later contact is ignored.
    if (b >= 0 && ((rests(core, a) && inHandOf(core, a, i)) || (rests(core, b) && inHandOf(core, b, i)))) {
      latchPend(core, a, b);
      return takeSlot(core, i);
    }
    return Role.Ignore;
  }
  const h = core.drawSlot;
  const d = h >= 0 ? h : core.shadowSlot;
  // Any newcomer that is not a palm and lands in the pair window may be a pinch, a knuckle, or the real tip: both
  // strokes build hidden until motion tells which.
  if (d >= 0 && c.pairWith[d] < 0 && canPair(c, i, d)) return pend(core, i, d);
  if (h < 0) return edgeStart(core, i) ? shadow(core, i) : takeSlot(core, i);
  // A stroke in progress keeps the slot through a pause as well: a later contact is ignored, never drawn.
  if (writing(core, h)) return Role.Ignore;
  // The holder rests inside the newcomer's hand: it is that hand, and the newcomer writes (E18).
  if ((rests(core, h) && inHandOf(core, h, i)) || (weak(core, h) && c.score[i] < c.score[h])) {
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

/** A pending pair that never moved on: both are the resting hand. Their ink goes and the pair ends. */
export function latchPend(core: Core, a: number, b: number): void {
  const c = core.c;
  c.pairWith[a] = c.pairWith[b] = -1;
  core.pendA = -1;
  core.latchPalm(a, false);
  core.latchPalm(b, false);
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
  // Both move now: a palm part that drifted as it settled and then rests is no finger of a pinch.
  const t = core.x.t;
  if (c.stillFor(i, t) >= K.RECENT_STILL_MS || c.stillFor(j, t) >= K.RECENT_STILL_MS) return false;
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
  // A contact that grows as it moves is a palm settling, never the writer.
  const grows = c.majorMax[mover] - c.major0[mover] >= K.SHOW_GROW_MM;
  return m >= K.PEND_WRITE_MM && r < K.SLOP_MM && r * K.PEND_REST_SHARE <= m && core.movesOn(mover) && !grows;
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

/**
 * A pending pair whose later contact landed over `PAIR_WINDOW_STILL_MS + SETTLED_AT_MS` ago, and neither contact moved
 * on: a pinch or a stroke would have by then, so both are a resting hand.
 */
export function stalePend(core: Core, i: number, j: number): boolean {
  const c = core.c;
  const t0 = c.t0[i] > c.t0[j] ? c.t0[i] : c.t0[j];
  if (core.x.t - t0 < K.PAIR_WINDOW_STILL_MS + K.SETTLED_AT_MS) return false;
  return !core.movesOn(i) && !core.movesOn(j);
}

/** Ends a pending pair that went stale while no event of its contacts arrived. */
export function expirePend(core: Core): void {
  const a = core.pendA;
  const b = a >= 0 ? core.c.pairWith[a] : -1;
  if (b >= 0 && stalePend(core, a, b)) latchPend(core, a, b);
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
  if (stalePend(core, i, j)) {
    latchPend(core, i, j);
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
 * On a device that has seen a pen, a one-finger scroll starts once its contact moves like a scroll rather than a palm
 * settling (it moved on), and has stopped growing as a palm does when it lands. Where the hand last rested, without
 * real sizes, a palm may slide 10 mm or more as it lands: there the scroll waits until the contact moves on after.
 */
function settled(core: Core, i: number): boolean {
  const c = core.c;
  if (!core.pens.penSeen) return true;
  if (settling(core, i)) return false;
  const sized = c.sizeMode === SizeMode.Real && (c.flags[i] & F.Sized) !== 0;
  if (!sized && core.inPenHand(c.x0[i], c.y0[i], true)) return c.onDisp[i] >= K.MOVE_ON_MM;
  return core.movesOn(i);
}

/** After a move: starts a pending scroll or pan that passed its gate, and moves finger drawing's strokes on. */
export function afterMove(core: Core, i: number, p: PresenceCode): void {
  const c = core.c;
  const role = c.role[i];
  if (role === Role.Draw) core.showIfReady(i);
  if (role === Role.Scroll && c.started[i] === 0) {
    const s = c.score[i] + handShift(core, i, p, false);
    const grew = (c.why[i] & E.Growth) !== 0;
    if (
      c.disp[i] >= K.SLOP_MM &&
      !grew &&
      scrollGate(p, s) &&
      quietGate(core, p, s) &&
      !busy(core, i) &&
      settled(core, i)
    ) {
      start(core, i);
    }
  } else if (role === Role.Nav && c.started[i] === 0) {
    const j = c.pairWith[i];
    if (j < 0 || !panConfirmed(c, i, j)) return;
    // Two contacts that spread or squeeze are a pinch; the parts of a palm drift together.
    const squeezes = squeeze(core, i, j);
    // On a device that has seen a pen, the parts of a palm that settle look like a pan: a pan waits until both contacts
    // move on, as a settling palm does not, and neither is still growing as it lands.
    if (settling(core, i) || settling(core, j)) return;
    if (!squeezes && core.pens.penSeen && !(core.movesOn(i) && core.movesOn(j))) return;
    const pinch = squeezes ? K.PINCH_BONUS : 0;
    if ((c.why[i] | c.why[j]) & E.Growth) return;
    const si = c.score[i] + handShift(core, i, p, true) + pinch;
    const sj = c.score[j] + handShift(core, j, p, true) + pinch;
    if (!navGate(p, si, sj, core.settings.twoFingerNavNearPen) || !quietGate(core, p, si) || !quietGate(core, p, sj)) {
      return;
    }
    start(core, i);
    start(core, j);
  } else if (role === Role.Pend || (role === Role.Draw && c.pairWith[i] >= 0)) {
    settlePend(core, i, p);
  } else if (role === Role.Shadow) {
    const h = core.drawSlot;
    if (h < 0) {
      // An edge stroke shows with its whole path once it travels away from where it landed.
      if (c.disp[i] >= K.EDGE_TRAVEL_MM) core.promoteShadow();
    } else if (c.disp[i] >= K.WEAK_TRAVEL_MM && !writing(core, h) && weak(core, h) && !inHandOf(core, i, h)) {
      // The shadow writes while the holder rests, and the shadow is no part of the holder's hand.
      core.shadowSlot = -1;
      yieldSlot(core, h);
      core.drawFrom(i);
    }
  }
}

/**
 * With the pen away on a device that has seen one, the gates are open, but a contact with palm evidence of 2 or more
 * (growth, a palm beside it, a split blob) moves no camera unless a swipe outweighs it.
 */
const quietGate = (core: Core, p: PresenceCode, s: number): boolean =>
  p > P.Away || !core.pens.penSeen || s < K.WEAK_SCORE;

/** A contact that grows as it lands is a palm settling until it has settled; its size tells then. */
function settling(core: Core, i: number): boolean {
  const c = core.c;
  return c.majorMax[i] - c.major0[i] >= K.SETTLE_GROW_MM && core.x.t - c.t0[i] < K.SETTLED_AT_MS;
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

/**
 * A drawing contact lifts: its stroke is held or committed, unless it scores as a palm now or rested like a hand.
 */
function endDraw(core: Core, i: number, t: number): number {
  const c = core.c;
  let bits = 0;
  if (c.score[i] >= K.RETRACT_AT_LIFT || rested(core, i, t)) core.setRole(i, Role.Ignore, Fx.Retract);
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
  // A dot or a short mark at an edge: quick, small, and round, where a gripping thumb stays and is long.
  if (h < 0 && edgeDot(core, s, t)) {
    core.drawFrom(s);
    return endDraw(core, s, t);
  }
  core.setRole(s, Role.Ignore, Fx.Retract);
  return 0;
}

/**
 * Ink that never showed commits only as a dot or a quick short mark. A contact that stayed down past a long press, or
 * drifted 2 mm and stopped once a palm would have settled, never moved like a stroke: it is a hand that rested.
 */
function rested(core: Core, i: number, t: number): boolean {
  const c = core.c;
  if ((c.flags[i] & F.Shown) !== 0) return false;
  const age = t - c.t0[i];
  if (age >= K.LONG_PRESS_MS) return true;
  return age >= K.SETTLED_AT_MS && c.disp[i] >= K.WEAK_TRAVEL_MM && !core.movesOn(i);
}

/** An edge contact that lifted quickly, barely moved, and is neither large nor long, as a gripping thumb is. */
function edgeDot(core: Core, s: number, t: number): boolean {
  const c = core.c;
  if ((c.flags[s] & F.Edge) === 0 || t - c.t0[s] >= K.LONG_PRESS_MS || c.disp[s] >= K.EDGE_TRAVEL_MM) return false;
  if ((c.flags[s] & F.Sized) === 0) return true;
  const minor = c.minorMax[s];
  return c.majorMax[s] < K.LARGE_MAJOR_MM && (minor <= 0 || c.majorMax[s] / minor < K.GRIP_ASPECT);
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
  // On a device that has seen a pen, a long press where the hand last rested, or beside another contact, is a hand.
  if (core.pens.penSeen && (core.inPenHand(c.x[i], c.y[i], true) || neighbor(core, i))) return false;
  return mayTap(core, i, p);
}

function neighbor(core: Core, i: number): boolean {
  const c = core.c;
  for (let j = 0; j < K.MAX_CONTACTS; j++) {
    if (j !== i && c.used[j] === 1 && c.dist(i, j) <= K.CLUSTER_MM) return true;
  }
  return false;
}

function mayTap(core: Core, i: number, p: PresenceCode): boolean {
  const c = core.c;
  const role = c.role[i];
  if (c.flags[i] & F.Chrome) return role === Role.Pass && chromeGate(p, c.score[i], false);
  const s = c.score[i] + handShift(core, i, p, false);
  return (role === Role.Scroll || role === Role.Pass) && tapGate(p, s);
}
