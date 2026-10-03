// Shared pieces of the scenarios: the scenario type, the device helpers, and the tip strokes, dots, and taps that pen
// and touch scenarios both draw.

import type { PalmSettings } from '../palm/index';
import type { SimProfile } from './profiles';
import type { Grip } from './session';
import { between } from './writer';
import type { Rand, SessionWriter, Vec2, WriterOptions } from './writer';

export interface Scenario {
  readonly name: string;
  readonly kind: 'pen' | 'touch';
  /** A fixed hand; pen scenarios without one run with each hand. */
  readonly hand?: 'right' | 'left';
  readonly grip?: Grip;
  readonly settings?: Partial<PalmSettings>;
  /** Whether this device has used a pen before the session. Pen scenarios default to yes. */
  readonly penSeen?: boolean;
  /** Writer options beyond the hand: pen rate, zero pressure at stroke ends. */
  readonly writer?: Pick<WriterOptions, 'rateHz' | 'zeroPressureEnds'>;
  /** Only these profiles, when the scenario needs a property of the device. */
  readonly only?: readonly string[];
  /** Only profiles with this property, for a contact whose one tell some digitizers do not report. */
  readonly when?: (p: SimProfile) => boolean;
  readonly build: (w: SessionWriter, r: Rand) => void;
}

export const lead = (w: SessionWriter) => (w.profile.hover === 'none' ? 0 : w.profile.hoverLeadMs);

export const side = (w: SessionWriter) => w.options.handedness;

export const screen = (w: SessionWriter): Vec2 => [w.profile.screenMm[0], w.profile.screenMm[1]];

/** The pen reports neither lean nor contact size: nothing tells the side of the hand before a palm rests. */
export const unknownSide = (w: SessionWriter) => w.profile.tilt === 'none' && w.profile.device.touchSize !== true;

export const pen = (name: string, build: Scenario['build'], extra: Partial<Scenario> = {}): Scenario => ({
  name,
  kind: 'pen',
  build,
  ...extra,
});

export const touch = (name: string, build: Scenario['build'], extra: Partial<Scenario> = {}): Scenario => ({
  name,
  kind: 'touch',
  build,
  ...extra,
});

/** A finger or stylus tip stroke: lands at t0 and draws a short word. */
export function tipStroke(w: SessionWriter, r: Rand, t0: number, at: Vec2, ms = 400, cutAt?: number): number {
  const stylus = w.profile.stylus === 'touch';
  const tip = stylus ? between(r, 3.5, 6) : between(r, 7, 10);
  const len = between(r, 15, 30);
  return w.touch({
    t0,
    t1: t0 + ms,
    at: (t) => {
      const f = (t - t0) / ms;
      return [at[0] + len * f, at[1] + 2.5 * Math.sin(f * 6)];
    },
    size: () => [tip, tip * 0.9],
    cls: stylus ? 'pen' : 'finger',
    intent: 'ink',
    cancelAt: cutAt,
    stepMs: 10,
  });
}

/** A dot: the tip lands, stays, and lifts within 60 to 120 ms. */
export function dot(w: SessionWriter, r: Rand, t0: number, at: Vec2): number {
  const stylus = w.profile.stylus === 'touch';
  const tip = stylus ? between(r, 3.5, 6) : between(r, 7, 10);
  return w.touch({
    t0,
    t1: t0 + between(r, 60, 120),
    at: () => at,
    size: () => [tip, tip * 0.9],
    cls: stylus ? 'pen' : 'finger',
    intent: 'ink',
    stepMs: 10,
  });
}

/** Words of tip strokes from t0, with a dot after the second word. Returns when the last one ends. */
export const words = (w: SessionWriter, r: Rand, t0: number, n: number, y = 60): number => {
  const cols = Math.max(1, Math.floor((screen(w)[0] - 20) / 30));
  let t = t0;
  for (let i = 0; i < n; i++) {
    const at: Vec2 = [Math.min(30, screen(w)[0] - 45) + (i % cols) * 30, y + Math.floor(i / cols) * 15];
    tipStroke(w, r, t, at);
    t += 400 + between(r, 150, 400);
    if (i === 1) {
      dot(w, r, t, [at[0] + 20, at[1] - 6]);
      t += 120 + between(r, 150, 300);
    }
  }
  return t;
};

/** A multi-finger double tap: `fingers` fingers `gap` mm apart along x land 15 ms apart and lift after 120 ms, twice. */
export function doubleTap(
  w: SessionWriter,
  r: Rand,
  t0: number,
  at: Vec2,
  gap: number,
  fingers: number,
  limit?: 'side-unknown',
): void {
  for (let hop = 0; hop < 2; hop++) {
    const t = t0 + hop * between(r, 200, 300);
    for (let k = 0; k < fingers; k++) {
      const spot: Vec2 = [at[0] + k * gap, at[1]];
      const finger = { t0: t + k * 15, t1: t + 120, at: () => spot, size: (): Vec2 => [9, 8] } as const;
      w.touch({ ...finger, cls: 'finger', intent: 'gesture', limit });
    }
  }
}
