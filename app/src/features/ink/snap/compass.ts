// The geometry compass: a center, a radius, and a sweep around that center that becomes a circle or an arc. It works
// as a real compass does. A tap sets the center, a drag out from it opens the compass to a radius, and a sweep around
// draws. Pure geometry on page units, so a Node test drives it; the page view (view/compass.ts) draws the compass and
// stores the result as an ordinary editable shape.
import type { Shape } from '../geometry/shapes';
import type { Vec } from '../geometry/types';

export interface CompassState {
  /** Where the needle is, in page units, or null before the first tap. */
  readonly center: Vec | null;
  /** How far the compass is open, in page units. 0 until it is opened. */
  readonly radius: number;
}

export const COMPASS_START: CompassState = { center: null, radius: 0 };

/** A sweep this near a whole turn closes into a circle (2 degrees). */
const FULL = 2 * Math.PI - (2 * Math.PI) / 180;
/** A sweep shorter than this draws nothing, so a tap never leaves a dot (3 degrees). */
export const MIN_SWEEP = (3 * Math.PI) / 180;
/** The compass opens no smaller than this, in page units (about a millimeter). */
export const MIN_RADIUS = 4;

/** The angle around a sweep: where it began, where the pencil is now, and the signed total turned so far. */
export interface Sweep {
  readonly start: number;
  readonly last: number;
  readonly total: number;
}

const angleOf = (center: Vec, p: Vec): number => Math.atan2(p.y - center.y, p.x - center.x);

export function startSweep(center: Vec, p: Vec): Sweep {
  const a = angleOf(center, p);
  return { start: a, last: a, total: 0 };
}

/** The sweep carried on to `p`. Each step adds the short way around, so a sweep can go past a whole turn. */
export function extendSweep(sweep: Sweep, center: Vec, p: Vec): Sweep {
  if (p.x === center.x && p.y === center.y) return sweep;
  const a = angleOf(center, p);
  let delta = a - sweep.last;
  while (delta > Math.PI) delta -= 2 * Math.PI;
  while (delta <= -Math.PI) delta += 2 * Math.PI;
  return { start: sweep.start, last: a, total: sweep.total + delta };
}

/** Where the compass's pencil is for a radius and an angle. */
export function pencilAt(center: Vec, radius: number, angle: number): Vec {
  return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
}

/** What a sweep draws: a circle once it goes all the way around, an arc before that, and nothing for a tap. */
export function compassShape(center: Vec, radius: number, sweep: Sweep): Shape | null {
  if (!(radius >= MIN_RADIUS) || Math.abs(sweep.total) < MIN_SWEEP) return null;
  if (Math.abs(sweep.total) >= FULL) return { kind: 'circle', center, radius };
  return { kind: 'arc', center, radius, start: sweep.start, sweep: sweep.total };
}

/** The sweep in whole degrees, for the readout. */
export function sweepDegrees(sweep: Sweep): number {
  return Math.min(360, Math.round((Math.abs(sweep.total) * 180) / Math.PI));
}
