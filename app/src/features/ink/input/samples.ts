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

function tiltOf(raw: RawSample): { tiltX: number; tiltY: number } | null {
  if (Number.isFinite(raw.tiltX) || Number.isFinite(raw.tiltY)) {
    return { tiltX: clamp(raw.tiltX ?? 0, -90, 90), tiltY: clamp(raw.tiltY ?? 0, -90, 90) };
  }
  if (Number.isFinite(raw.altitudeAngle) && Number.isFinite(raw.azimuthAngle)) {
    const { tiltX, tiltY } = tiltFromAngles(raw.altitudeAngle!, raw.azimuthAngle!);
    return { tiltX: clamp(tiltX, -90, 90), tiltY: clamp(tiltY, -90, 90) };
  }
  return null;
}

/**
 * The stroke point for a sample, or null when the sample has a value that is not a number. Positions are clamped to
 * the range a record holds. A pen that reports zero pressure while touching gets the middle pressure. A pen's
 * pressure goes through the curve table when one is given. Touch and mouse samples carry no pressure and no tilt.
 */
export function normalizeSample(raw: RawSample, table?: Float32Array): InkPoint | null {
  if (!Number.isFinite(raw.x) || !Number.isFinite(raw.y) || !Number.isFinite(raw.time)) return null;
  const point: { -readonly [K in keyof InkPoint]: InkPoint[K] } = {
    x: clamp(raw.x, -MAX_COORDINATE, MAX_COORDINATE),
    y: clamp(raw.y, -MAX_COORDINATE, MAX_COORDINATE),
    time: raw.time,
  };
  if (raw.pointerType !== 'pen') return point;
  const reported = Number.isFinite(raw.pressure) ? clamp(raw.pressure!, 0, 1) : NEUTRAL_PRESSURE;
  const pressure = reported === 0 ? NEUTRAL_PRESSURE : reported;
  point.pressure = table ? mapPressure(table, pressure) : pressure;
  const tilt = tiltOf(raw);
  if (tilt) {
    point.tiltX = tilt.tiltX;
    point.tiltY = tilt.tiltY;
  }
  return point;
}
