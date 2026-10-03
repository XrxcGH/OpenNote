// Pen samples become stroke points (architecture 5.2). A pointer event reaches this code as a plain `RawSample`, so
// nothing here needs a browser, and a recorded pen session replays to the same points. The page view converts
// client coordinates to page units with the camera it cached at contact, then calls `normalizeSample`.

import { mapPressure } from '../geometry/pressure';
import type { InkPoint } from '../geometry/types';
import { MAX_COORDINATE } from '../model/types';
import { NEUTRAL_PRESSURE } from '../pens/width';

export type PointerKind = 'pen' | 'touch' | 'mouse';

export interface RawSample {
  /** Page units, through the camera cached at contact. */
  readonly x: number;
  readonly y: number;
  /** The event's `timeStamp` in milliseconds on the page's clock. */
  readonly time: number;
  readonly pointerType: PointerKind;
  /** The device's pressure, 0 to 1. Touch and mouse pressure is ignored, because it means nothing. */
  readonly pressure?: number;
  /** Tilt in degrees from the Pointer Events `tiltX` and `tiltY`. */
  readonly tiltX?: number;
  readonly tiltY?: number;
  /** The same tilt as angles in radians, for devices that report these and not the two above. */
  readonly altitudeAngle?: number;
  readonly azimuthAngle?: number;
}

const RAD_TO_DEG = 180 / Math.PI;

/**
 * Tilt in degrees from altitude and azimuth in radians, by the conversion in the Pointer Events specification.
 * A pen lying flat (altitude 0) tilts a full 90 degrees along the axis it points toward.
 */
export function tiltFromAngles(altitude: number, azimuth: number): { tiltX: number; tiltY: number } {
  const tan = Math.tan(altitude);
  if (tan < 1e-9) {
    return {
      tiltX: Math.round(Math.cos(azimuth) * 90 * 1e6) / 1e6,
      tiltY: Math.round(Math.sin(azimuth) * 90 * 1e6) / 1e6,
    };
  }
  return {
    tiltX: Math.atan(Math.cos(azimuth) / tan) * RAD_TO_DEG,
    tiltY: Math.atan(Math.sin(azimuth) / tan) * RAD_TO_DEG,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** A sample being normalized, reused across samples so a stroke allocates only the points it stores. */
export interface SampleScratch {
  x: number;
  y: number;
  time: number;
  /** -1 when the sample carries no pressure (touch and mouse). */
  pressure: number;
  /** True when the pen reported exactly 0, which the stroke builder resolves per stroke. */
  zero: boolean;
  hasTilt: boolean;
  tiltX: number;
  tiltY: number;
}

export const newScratch = (): SampleScratch => ({
  x: 0,
  y: 0,
  time: 0,
  pressure: -1,
  zero: false,
  hasTilt: false,
  tiltX: 0,
  tiltY: 0,
});

function tiltInto(raw: RawSample, out: SampleScratch): void {
  out.hasTilt = false;
  if (Number.isFinite(raw.tiltX) || Number.isFinite(raw.tiltY)) {
    out.hasTilt = true;
    out.tiltX = clamp(raw.tiltX ?? 0, -90, 90);
    out.tiltY = clamp(raw.tiltY ?? 0, -90, 90);
  } else if (Number.isFinite(raw.altitudeAngle) && Number.isFinite(raw.azimuthAngle)) {
    const { tiltX, tiltY } = tiltFromAngles(raw.altitudeAngle!, raw.azimuthAngle!);
    out.hasTilt = true;
    out.tiltX = clamp(tiltX, -90, 90);
    out.tiltY = clamp(tiltY, -90, 90);
  }
}

/**
 * Normalizes a sample into `out`, or returns false when it has a value that is not a number. Positions are clamped to
 * the range a record holds. A pen's pressure goes through the curve table when one is given. A pen that reports no
 * pressure gets the middle pressure; one that reports exactly 0 is flagged `zero`, because whether that 0 is real
 * depends on the rest of the stroke. Touch and mouse samples carry no pressure and no tilt.
 */
export function normalizeInto(raw: RawSample, out: SampleScratch, table?: Float32Array): boolean {
  if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y) || !Number.isFinite(raw.time)) return false;
  out.x = clamp(raw.x, -MAX_COORDINATE, MAX_COORDINATE);
  out.y = clamp(raw.y, -MAX_COORDINATE, MAX_COORDINATE);
  out.time = raw.time;
  out.zero = false;
  out.hasTilt = false;
  if (raw.pointerType !== 'pen') {
    out.pressure = -1;
    return true;
  }
  const reported = Number.isFinite(raw.pressure) ? clamp(raw.pressure!, 0, 1) : NEUTRAL_PRESSURE;
  out.zero = reported === 0;
  const pressure = out.zero ? NEUTRAL_PRESSURE : reported;
  out.pressure = table ? mapPressure(table, pressure) : pressure;
  tiltInto(raw, out);
  return true;
}

/**
 * The stroke point for a sample on its own, or null when the sample has a value that is not a number. A pen that
 * reports zero pressure gets the middle pressure here; the stroke builder decides zeros per stroke instead.
 */
export function normalizeSample(raw: RawSample, table?: Float32Array): InkPoint | null {
  const s = newScratch();
  if (!normalizeInto(raw, s, table)) return null;
  const point: { -readonly [K in keyof InkPoint]: InkPoint[K] } = { x: s.x, y: s.y, time: s.time };
  if (s.pressure < 0) return point;
  point.pressure = s.pressure;
  if (s.hasTilt) {
    point.tiltX = s.tiltX;
    point.tiltY = s.tiltY;
  }
  return point;
}
