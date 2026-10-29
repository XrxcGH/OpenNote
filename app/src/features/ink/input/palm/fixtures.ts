// Helpers for palm filter tests: positions and sizes in millimeters at 5.2 CSS px per mm, and the effects of the
// last call as plain objects.

import { createPalmFilter } from './filter';
import type { PalmFilter, Surface } from './filter';
import { ROLE_NAMES } from './effects';
import type { DeviceProfile, LearnedState, PalmSettings } from './settings';

export const PPM = 5.2;
export const px = (mm: number): number => mm * PPM;

/** A filter at 5.2 px per mm with an ink tool active. */
export function filter(
  settings: Partial<PalmSettings> = {},
  profile: Partial<DeviceProfile> = {},
  learned?: LearnedState,
): PalmFilter {
  const f = createPalmFilter(settings, { pxPerMm: PPM, ...profile }, learned);
  f.setInkToolActive(true);
  return f;
}

export interface Contact {
  /** Size in mm; 0 means the digitizer reports none. */
  readonly size?: number;
  readonly minor?: number;
  readonly surface?: Surface;
}

export const FINGER: Contact = { size: 9, minor: 8 };
export const PALM: Contact = { size: 50, minor: 35 };
export const NO_SIZE: Contact = { size: 0 };

export function down(f: PalmFilter, id: number, t: number, x: number, y: number, c: Contact = FINGER): string {
  const size = c.size ?? 0;
  const w = size > 0 ? px(size) : 1;
  const h = size > 0 ? px(c.minor ?? size) : 1;
  return ROLE_NAMES[f.touchDown(id, t, px(x), px(y), w, h, 0, c.surface ?? 'page')];
}

export function move(f: PalmFilter, id: number, t: number, x: number, y: number, c: Contact = FINGER): string {
  const size = c.size ?? 0;
  const w = size > 0 ? px(size) : 1;
  const h = size > 0 ? px(c.minor ?? size) : 1;
  return ROLE_NAMES[f.touchMove(id, t, px(x), px(y), w, h, 0)];
}

/** Pen event at a position in mm with a right-handed lean. */
export function pen(
  f: PalmFilter,
  signal: Parameters<PalmFilter['pen']>[0],
  t: number,
  x = 100,
  y = 100,
  id = 1,
): void {
  f.pen(signal, id, t, px(x), px(y), 20, 25);
}

export interface Effect {
  readonly id: number;
  readonly role: string;
  readonly fx: number;
}

export function effects(f: PalmFilter): Effect[] {
  const e = f.effects;
  const out: Effect[] = [];
  for (let i = 0; i < e.count; i++) out.push({ id: e.id[i], role: ROLE_NAMES[e.role[i]], fx: e.fx[i] });
  return out;
}

/** The effect bits recorded for one contact in the last call, or 0. */
export function fxOf(f: PalmFilter, id: number): number {
  return effects(f).find((e) => e.id === id)?.fx ?? 0;
}
