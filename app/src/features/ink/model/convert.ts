// Adapters between the codec's records and the geometry's strokes (spec 9.3 and 9.4). `strokeFromRecord` decodes a
// record's point data into page units, and `recordFromStroke` quantizes a stroke back into the bytes a writer saves.
// Quantizing twice gives the same record, so a stroke survives any number of save and load round trips.

import {
  CHANNEL_PRESSURE,
  CHANNEL_TILT,
  CHANNEL_TIME,
  decodePoints,
  encodePoints,
  MAX_POINTS,
} from '../../../core/ink/codec';
import type { Point, Stroke as StrokeRecord } from '../../../core/ink/codec';
import { grow, transformBounds } from '../geometry/bounds';
import { widthScale } from '../geometry/matrix';
import type { Bounds, InkPoint, Matrix } from '../geometry/types';
import { isKnownToolCode, toolFromCode, TOOL_CODES } from '../pens/tools';
import {
  MAX_COORDINATE,
  POSITION_STEPS_PER_UNIT,
  PRESSURE_MAX,
  TILT_STEPS_PER_DEGREE,
  TIME_STEPS_PER_MS,
} from './types';
import type { InkStroke } from './types';

const MAX_TILT_STEPS = 9_000;
const MAX_FIRST_TIME_STEPS = 9;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** Decodes a record into a stroke. Positions come out in page units, pressure from 0 to 1, tilt in degrees. */
export function strokeFromRecord(record: StrokeRecord): InkStroke {
  const { x, y, pressure, tiltX, tiltY, t } = decodePoints(record.points, record.pointCount, record.channels);
  const points = new Array<InkPoint>(x.length);
  for (let i = 0; i < x.length; i++) {
    const point: Mutable<InkPoint> = { x: x[i] / POSITION_STEPS_PER_UNIT, y: y[i] / POSITION_STEPS_PER_UNIT };
    if (pressure) point.pressure = pressure[i] / PRESSURE_MAX;
    if (tiltX && tiltY) {
      point.tiltX = tiltX[i] / TILT_STEPS_PER_DEGREE;
      point.tiltY = tiltY[i] / TILT_STEPS_PER_DEGREE;
    }
    if (t) point.time = t[i] / TIME_STEPS_PER_MS;
    points[i] = point;
  }
  const stroke: Mutable<InkStroke> = {
    id: record.id,
    tool: toolFromCode(record.style.tool),
    width: record.style.width,
    startTime: record.start,
    points,
    block: record.block,
    slot: record.style.palette,
    color: record.style.color,
  };
  if (record.transform) stroke.transform = record.transform as unknown as Matrix;
  if (record.origin) stroke.origin = record.origin;
  if (record.startUnknown) stroke.startUnknown = true;
  if (!isKnownToolCode(record.style.tool)) stroke.toolCode = record.style.tool;
  return stroke;
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function quantizePosition(value: number): number {
  return Math.round(clamp(value, -MAX_COORDINATE, MAX_COORDINATE) * POSITION_STEPS_PER_UNIT);
}

/** Which of the optional channels a stroke's points carry. */
function channelsOf(points: readonly InkPoint[]): number {
  let channels = 0;
  for (const p of points) {
    if (p.pressure !== undefined) channels |= CHANNEL_PRESSURE;
    if (p.tiltX !== undefined || p.tiltY !== undefined) channels |= CHANNEL_TILT;
    if (p.time !== undefined) channels |= CHANNEL_TIME;
  }
  return channels;
}

/**
 * The start time in whole milliseconds. With per-point times, the first point's time carries the part of a
 * millisecond (spec 9.4), so the start is the first point's absolute time, rounded down to a millisecond.
 */
function startMillis(stroke: InkStroke, channels: number): number {
  const first = stroke.points[0]?.time ?? 0;
  const absolute = channels & CHANNEL_TIME ? stroke.startTime + first : stroke.startTime;
  return Math.floor(Math.round(absolute * TIME_STEPS_PER_MS) / TIME_STEPS_PER_MS);
}

/** Quantized points, with time counted from the start in whole milliseconds and never going backward (spec 9.4). */
function quantizePoints(stroke: InkStroke, channels: number, startMs: number): Point[] {
  let lastTime = 0;
  return stroke.points.map((p, i) => {
    let t = 0;
    if (channels & CHANNEL_TIME) {
      const steps = Math.round((stroke.startTime + (p.time ?? 0)) * TIME_STEPS_PER_MS) - startMs * TIME_STEPS_PER_MS;
      t = i === 0 ? clamp(steps, 0, MAX_FIRST_TIME_STEPS) : Math.max(lastTime, steps);
      lastTime = t;
    }
    return {
      x: quantizePosition(p.x),
      y: quantizePosition(p.y),
      pressure: Math.round(clamp(p.pressure ?? 0.5, 0, 1) * PRESSURE_MAX),
      tiltX: clamp(Math.round((p.tiltX ?? 0) * TILT_STEPS_PER_DEGREE), -MAX_TILT_STEPS, MAX_TILT_STEPS),
      tiltY: clamp(Math.round((p.tiltY ?? 0) * TILT_STEPS_PER_DEGREE), -MAX_TILT_STEPS, MAX_TILT_STEPS),
      t,
    };
  });
}

/**
 * Encodes a stroke as a record. Throws a `PointError` when the stroke has no points or more than 200,000, so a
 * caller that cannot rule that out checks `canEncode` first.
 */
export function recordFromStroke(stroke: InkStroke): StrokeRecord {
  const channels = channelsOf(stroke.points);
  const start = startMillis(stroke, channels);
  const quantized = quantizePoints(stroke, channels, start);
  const { bytes, bbox } = encodePoints(quantized, channels);
  return {
    id: stroke.id,
    block: stroke.block,
    start,
    startUnknown: stroke.startUnknown === true,
    style: {
      tool: stroke.toolCode !== undefined ? stroke.toolCode : TOOL_CODES[stroke.tool],
      palette: stroke.slot,
      color: [...stroke.color],
      width: Math.fround(stroke.width),
    },
    bbox,
    channels,
    pointCount: quantized.length,
    transform: stroke.transform ? stroke.transform.map(Math.fround) : null,
    origin: stroke.origin ?? null,
    points: bytes,
  };
}

/** True when a stroke can be a record: it has points, and not more than a record holds. */
export function canEncode(stroke: InkStroke): boolean {
  return stroke.points.length >= 1 && stroke.points.length <= MAX_POINTS;
}

/**
 * The page-space box of a record from its header alone, without decoding its points: the stored box through the
 * transform, grown by half the nominal width. The engine builds its index from this at page open.
 */
export function recordBounds(record: StrokeRecord): Bounds {
  const raw: Bounds = {
    minX: record.bbox.minX / POSITION_STEPS_PER_UNIT,
    minY: record.bbox.minY / POSITION_STEPS_PER_UNIT,
    maxX: record.bbox.maxX / POSITION_STEPS_PER_UNIT,
    maxY: record.bbox.maxY / POSITION_STEPS_PER_UNIT,
  };
  const matrix = record.transform as unknown as Matrix | null;
  const placed = matrix ? transformBounds(raw, matrix) : raw;
  return grow(placed, (record.style.width * (matrix ? widthScale(matrix) : 1)) / 2);
}
