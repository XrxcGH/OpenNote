// The gates (README, "Roles and gates"): what each presence lets a contact with a given score do, and the pair
// rules for two-finger pan and pinch. Pure functions over the contact table.

import { ContactTable } from './contacts';
import { P } from './presence';
import * as thresholds from './thresholds';

/** A plain copy, so hot loops read fields rather than module bindings. */
const K = { ...thresholds };

/** A page tap or long press. */
export function tapGate(p: P, s: number): boolean {
  if (p === P.Down) return false;
  if (p === P.Near) return s <= -2;
  if (p === P.Recent) return s <= 0;
  return true;
}

/** One-finger scroll. */
export function scrollGate(p: P, s: number): boolean {
  if (p === P.Down) return false;
  if (p === P.Near) return s <= -1;
  if (p === P.Recent) return s <= 0;
  return true;
}

/** A tap on a control outside the page. */
export function chromeGate(p: P, s: number, palm: boolean): boolean {
  if (palm) return false;
  if (p === P.Down) return s <= -1;
  if (p === P.Near) return s <= 1;
  return true;
}

/** Two-finger pan and pinch. `nearAllowed` is the setting "Scroll with two fingers while the pen is near". */
export function navGate(p: P, s1: number, s2: number, nearAllowed: boolean): boolean {
  if (p === P.Down) return false;
  if (p === P.Near) return nearAllowed && s1 <= 0 && s2 <= 0;
  if (p === P.Recent) return s1 <= 0 && s2 <= 0;
  return true;
}

/** Whether a newcomer i may pair with an earlier contact j: inside the pair window, at finger spacing. */
export function canPair(c: ContactTable, i: number, j: number): boolean {
  const window = c.disp[j] < K.PAIR_STILL_MM ? K.PAIR_WINDOW_STILL_MS : K.PAIR_WINDOW_MS;
  if (c.t0[i] - c.t0[j] > window) return false;
  const d = c.dist(i, j);
  return d >= K.PAIR_MIN_MM && d <= K.PAIR_MAX_MM;
}

/** A pan or pinch is real once both fingers pass slop and move together, or their spacing changes. */
export function panConfirmed(c: ContactTable, i: number, j: number): boolean {
  if (c.disp[i] < K.SLOP_MM || c.disp[j] < K.SLOP_MM) return false;
  if (Math.abs(c.dist(i, j) - c.pairD0[i]) >= K.PINCH_MM) return true;
  const ax = c.x[i] - c.x0[i];
  const ay = c.y[i] - c.y0[i];
  const bx = c.x[j] - c.x0[j];
  const by = c.y[j] - c.y0[j];
  const la = K.len(ax, ay);
  const lb = K.len(bx, by);
  if (la === 0 || lb === 0) return false;
  const ratio = la > lb ? la / lb : lb / la;
  return (ax * bx + ay * by) / (la * lb) >= Math.cos(K.PAN_HEADING_DEG * (Math.PI / 180)) && ratio < K.PAN_SPEED_RATIO;
}
