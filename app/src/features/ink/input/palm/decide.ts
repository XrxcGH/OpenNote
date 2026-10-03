// Role rules (README, "Roles and gates" and "Finger drawing"): what a contact does when it lands, moves, and lifts.

import { Cls as Cls_, F as F_ } from './contacts';
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

/** True while another contact scrolls or pans, so a newcomer cannot start a scroll of its own. */
function busy(core: Core, i: number): boolean {
  const c = core.c;
  for (let j = 0; j < K.MAX_CONTACTS; j++) {
    if (j === i || c.used[j] === 0) continue;
    if (isNav(c.role[j]) || (c.role[j] === Role.Scroll && c.started[j] === 1) || c.role[j] === Role.Draw) return true;
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

/** A drawing contact is weak when it has stayed a dot, grown, or scores as a likely palm. */
function weak(core: Core, d: number): boolean {
  const c = core.c;
  const still = core.x.t - c.t0[d] >= K.WEAK_AGE_MS && c.disp[d] < K.WEAK_TRAVEL_MM;
  return still || (c.why[d] & E.Growth) !== 0 || c.score[d] >= K.WEAK_SCORE;
}

/** Finger drawing: one draw slot, chosen by classification rather than arrival. */
function decideDraw(core: Core, i: number): RoleCode {
  const c = core.c;
  const x = core.x;
  if (core.grip(i) || !tipAllowed(core, i)) return Role.Ignore;
  const d = core.drawSlot;
  if (d < 0) {
    const paired = pairWithin(core, i, x.presence);
    if (paired !== Role.Pass) return paired;
    core.drawSlot = i;
    c.tAction[i] = c.t0[i];
    return Role.Draw;
  }
  const inHand = core.touchHand.membership(c.x0[i], c.y0[i], c.x[d], c.y[d]) >= 0.5;
  if ((!inHand || (c.why[i] & E.Fingertip) !== 0) && canPair(c, i, d)) {
    pair(core, i, d);
    return Role.Nav;
  }
  if (core.shadowSlot < 0 && weak(core, d) && c.score[i] < c.score[d]) {
    core.latchPalm(d);
    if (core.drawSlot >= 0) return Role.Ignore;
    core.drawSlot = i;
    c.tAction[i] = c.t0[i];
    return Role.Draw;
  }
  if (c.score[i] <= 0 && core.shadowSlot < 0) {
    core.shadowSlot = i;
    return Role.Shadow;
  }
  return Role.Ignore;
}

/** "High" sensitivity with a learned stylus tip: only contacts the size of the tip draw. */
function tipAllowed(core: Core, i: number): boolean {
  const tip = core.x.stylusTip;
  if (core.settings.sensitivity !== 'high' || tip <= 0 || (core.c.flags[i] & F.Sized) === 0) return true;
  return core.c.majorMax[i] <= tip + K.TIP_STRICT_MARGIN_MM;
}

/** After a move: starts a pending scroll or pan that passed its gate, and transfers the draw slot to a moving shadow. */
export function afterMove(core: Core, i: number, p: PresenceCode): void {
  const c = core.c;
  const role = c.role[i];
  if (role === Role.Scroll && c.started[i] === 0) {
    if (c.disp[i] >= K.SLOP_MM && scrollGate(p, c.score[i]) && !busy(core, i)) start(core, i);
  } else if (role === Role.Nav && c.started[i] === 0) {
    const j = c.pairWith[i];
    if (j < 0 || !panConfirmed(c, i, j)) return;
    if (!navGate(p, c.score[i], c.score[j], core.settings.twoFingerNavNearPen)) return;
    start(core, i);
    start(core, j);
  } else if (role === Role.Shadow && core.drawSlot >= 0 && c.disp[i] >= K.WEAK_TRAVEL_MM) {
    if (weak(core, core.drawSlot)) core.latchPalm(core.drawSlot);
  }
}

function start(core: Core, i: number): void {
  const c = core.c;
  c.started[i] = 1;
  c.tAction[i] = core.x.t;
  core.setRole(i, c.role[i] as RoleCode, Fx.Start);
}

/** The pen went down: a scroll or pan in progress stops, and reverts when it began under 500 ms ago. */
export function freezeNav(core: Core, t: number): void {
  const c = core.c;
  for (let i = 0; i < K.MAX_CONTACTS; i++) {
    if (c.used[i] === 0 || c.started[i] === 0) continue;
    const fx = t - c.tAction[i] < K.NAV_REVERT_MS ? Fx.Revert : 0;
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
  if (role === Role.Draw) {
    if (c.score[i] >= K.RETRACT_AT_LIFT) core.setRole(i, Role.Ignore, Fx.Retract);
    else if (core.endStroke(i, t)) bits |= End.Held;
    core.drawSlot = -1;
    afterDrawEnd(core, i);
  } else if (role === Role.Shadow) {
    core.setRole(i, Role.Ignore, Fx.Retract);
  } else if (isNav(role)) {
    core.unpair(i, false);
  }
  if (tapAllowed(core, i, t, p)) bits |= End.TapAllowed;
  return bits;
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
  const role = c.role[i];
  if (c.flags[i] & F.Chrome) return role === Role.Pass && chromeGate(p, c.score[i], false);
  return (role === Role.Scroll || role === Role.Pass) && tapGate(p, c.score[i]);
}

/** Whether a still contact's long press may open the menu now. */
export function pressAllowed(core: Core, i: number, p: PresenceCode): boolean {
  const c = core.c;
  if ((c.flags[i] & F.Suppress) !== 0 || c.cls[i] === Cls.Palm || c.started[i] === 1) return false;
  if (c.disp[i] >= K.SLOP_MM) return false;
  const role = c.role[i];
  if (c.flags[i] & F.Chrome) return role === Role.Pass && chromeGate(p, c.score[i], false);
  return (role === Role.Scroll || role === Role.Pass) && tapGate(p, c.score[i]);
}
