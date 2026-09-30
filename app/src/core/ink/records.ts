// Records of an ink segment (spec 9.2, 9.3, and 9.5): a 12-byte frame with its own CRC-32, then a body.
// The TypeScript twin of crates/core/src/format/segment/records.rs.

import { crc32, idBytes, idText, readI64, writeI64 } from './bytes';
import { boxOf, decodePoints, MAX_POINTS } from './points';
import type { BBox } from './points';

export const KIND_STROKE = 1;
export const KIND_PROPS = 2;
export const KIND_REMOVE = 3;
export const FRAME_BYTES = 12;

const KNOWN_STROKE_FLAGS = 0x3f;
const KNOWN_PROPS_MASK = 0x7;
const STROKE_FIXED = 72;
const TIME_MIN = -62_135_596_800_000;
const TIME_MAX = 253_402_300_799_999;
const IDENTITY = [1, 0, 0, 1, 0, 0];

/** Tool, palette slot, color, and width (spec 8.2). */
export interface StrokeStyle {
  tool: number;
  palette: number;
  color: [number, number, number, number];
  width: number;
}

/** A stroke with its point data still encoded. */
export interface Stroke {
  id: string;
  block: string;
  start: number;
  startUnknown: boolean;
  style: StrokeStyle;
  bbox: BBox;
  channels: number;
  pointCount: number;
  transform: number[] | null;
  origin: string | null;
  points: Uint8Array;
}

/** A property record: `transform` is `'remove'` to remove one, and null fields stay as they are. */
export interface StrokeProps {
  id: string;
  style: StrokeStyle | null;
  transform: number[] | 'remove' | null;
  block: string | null;
}

export type InkRecord =
  { kind: 'stroke'; stroke: Stroke } | { kind: 'props'; props: StrokeProps } | { kind: 'remove'; id: string };

/** What a record's body turned out to be: a record, one from a newer version, or a failure with its reason. */
export type Parsed = { record: InkRecord } | { unknown: true } | { bad: 'body' | 'points' };

function strokeFlags(stroke: Stroke): number {
  let flags = stroke.channels & 7;
  if (stroke.transform) flags |= 1 << 3;
  if (stroke.origin) flags |= 1 << 4;
  if (stroke.startUnknown) flags |= 1 << 5;
  return flags;
}

function strokeBody(stroke: Stroke): Uint8Array {
  const extra = (stroke.transform ? 24 : 0) + (stroke.origin ? 16 : 0);
  const body = new Uint8Array(STROKE_FIXED + extra + stroke.points.length);
  const view = new DataView(body.buffer);
  body.set(idBytes(stroke.id), 0);
  body.set(idBytes(stroke.block), 16);
  writeI64(view, 32, stroke.start);
  body[40] = stroke.style.tool;
  body[41] = stroke.style.palette;
  view.setUint16(42, strokeFlags(stroke), true);
  body.set(stroke.style.color, 44);
  view.setFloat32(48, stroke.style.width, true);
  [stroke.bbox.minX, stroke.bbox.minY, stroke.bbox.maxX, stroke.bbox.maxY].forEach((v, i) =>
    view.setInt32(52 + i * 4, v, true),
  );
  view.setUint32(68, stroke.pointCount, true);
  let at = STROKE_FIXED;
  if (stroke.transform) {
    stroke.transform.forEach((v, i) => view.setFloat32(at + i * 4, v, true));
    at += 24;
  }
  if (stroke.origin) {
    body.set(idBytes(stroke.origin), at);
    at += 16;
  }
  body.set(stroke.points, at);
  return body;
}

function propsBody(props: StrokeProps): Uint8Array {
  const mask = (props.style ? 1 : 0) | (props.transform ? 2 : 0) | (props.block ? 4 : 0);
  const size = 20 + (props.style ? 12 : 0) + (props.transform ? 24 : 0) + (props.block ? 16 : 0);
  const body = new Uint8Array(size);
  const view = new DataView(body.buffer);
  body.set(idBytes(props.id), 0);
  view.setUint16(16, mask, true);
  let at = 20;
  if (props.style) {
    body[at] = props.style.tool;
    body[at + 1] = props.style.palette;
    body.set(props.style.color, at + 4);
    view.setFloat32(at + 8, props.style.width, true);
    at += 12;
  }
  if (props.transform) {
    const values = props.transform === 'remove' ? IDENTITY : props.transform;
    values.forEach((v, i) => view.setFloat32(at + i * 4, v, true));
    at += 24;
  }
  if (props.block) body.set(idBytes(props.block), at);
  return body;
}

/** Encodes one record: its frame, then its body. */
export function encodeRecord(record: InkRecord): Uint8Array {
  const [kind, body] =
    record.kind === 'stroke'
      ? [KIND_STROKE, strokeBody(record.stroke)]
      : record.kind === 'props'
        ? [KIND_PROPS, propsBody(record.props)]
        : [KIND_REMOVE, idBytes(record.id)];
  const out = new Uint8Array(FRAME_BYTES + body.length);
  const view = new DataView(out.buffer);
  out[4] = kind;
  view.setUint32(8, body.length, true);
  out.set(body, FRAME_BYTES);
  view.setUint32(0, crc32(out, 4), true);
  return out;
}

function float32(view: DataView, at: number): number | null {
  const value = view.getFloat32(at, true);
  return Number.isFinite(value) ? value : null;
}

function affineAt(view: DataView, at: number): number[] | null {
  const values = [0, 1, 2, 3, 4, 5].map((i) => float32(view, at + i * 4));
  return values.every((v) => v !== null) ? (values as number[]) : null;
}

/** Parses a record's body. `frameFlags` are the frame's flag and reserved bytes, which must be zero. */
export function parseBody(kind: number, frameFlags: number, body: Uint8Array): Parsed {
  if (frameFlags !== 0) return { unknown: true };
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  if (kind === KIND_STROKE) return parseStroke(body, view);
  if (kind === KIND_PROPS) return parseProps(body, view);
  if (kind === KIND_REMOVE) {
    return body.length === 16 ? { record: { kind: 'remove', id: idText(body, 0) } } : { bad: 'body' };
  }
  return { unknown: true };
}

function parseStroke(body: Uint8Array, view: DataView): Parsed {
  // The same order of checks as the Rust decoder, so both report the same for every body.
  if (body.length < 44) return { bad: 'body' };
  const flags = view.getUint16(42, true);
  if (flags & ~KNOWN_STROKE_FLAGS) return { unknown: true };
  if (body.length < STROKE_FIXED) return { bad: 'body' };
  const start = readI64(view, 32);
  const width = float32(view, 48);
  if (start < TIME_MIN || start > TIME_MAX || width === null) return { bad: 'body' };
  let at = STROKE_FIXED;
  let transform: number[] | null = null;
  if (flags & (1 << 3)) {
    transform = body.length >= at + 24 ? affineAt(view, at) : null;
    if (!transform) return { bad: 'body' };
    at += 24;
  }
  let origin: string | null = null;
  if (flags & (1 << 4)) {
    if (body.length < at + 16) return { bad: 'body' };
    origin = idText(body, at);
    at += 16;
  }
  const bbox = { minX: view.getInt32(52, true), minY: view.getInt32(56, true), maxX: 0, maxY: 0 };
  bbox.maxX = view.getInt32(60, true);
  bbox.maxY = view.getInt32(64, true);
  const pointCount = view.getUint32(68, true);
  const points = body.subarray(at);
  const channels = flags & 7;
  if (pointCount > MAX_POINTS || !pointsMatch(points, pointCount, channels, bbox)) return { bad: 'points' };
  const style: StrokeStyle = {
    tool: body[40],
    palette: body[41],
    color: [body[44], body[45], body[46], body[47]],
    width,
  };
  const stroke: Stroke = {
    id: idText(body, 0),
    block: idText(body, 16),
    start,
    startUnknown: (flags & (1 << 5)) !== 0,
    style,
    bbox,
    channels,
    pointCount,
    transform,
    origin,
    points,
  };
  return { record: { kind: 'stroke', stroke } };
}

function pointsMatch(points: Uint8Array, count: number, channels: number, bbox: BBox): boolean {
  try {
    const box = boxOf(decodePoints(points, count, channels));
    return box.minX === bbox.minX && box.minY === bbox.minY && box.maxX === bbox.maxX && box.maxY === bbox.maxY;
  } catch {
    return false;
  }
}

function parseProps(body: Uint8Array, view: DataView): Parsed {
  if (body.length < 20) return { bad: 'body' };
  const mask = view.getUint16(16, true);
  if (mask & ~KNOWN_PROPS_MASK || view.getUint16(18, true) !== 0) return { unknown: true };
  const props: StrokeProps = { id: idText(body, 0), style: null, transform: null, block: null };
  let at = 20;
  if (mask & 1) {
    const width = body.length >= at + 12 ? float32(view, at + 8) : null;
    if (width === null) return { bad: 'body' };
    if (view.getUint16(at + 2, true) !== 0) return { unknown: true };
    const color: [number, number, number, number] = [body[at + 4], body[at + 5], body[at + 6], body[at + 7]];
    props.style = { tool: body[at], palette: body[at + 1], color, width };
    at += 12;
  }
  if (mask & 2) {
    const affine = body.length >= at + 24 ? affineAt(view, at) : null;
    if (!affine) return { bad: 'body' };
    const identity = [...body.subarray(at, at + 24)].every((b, i) => b === identityBytes[i]);
    props.transform = identity ? 'remove' : affine;
    at += 24;
  }
  if (mask & 4) {
    if (body.length < at + 16) return { bad: 'body' };
    props.block = idText(body, at);
    at += 16;
  }
  return at === body.length ? { record: { kind: 'props', props } } : { bad: 'body' };
}

/** The identity transform's exact bytes: only these remove a transform, so records re-encode the same. */
const identityBytes = (() => {
  const bytes = new Uint8Array(24);
  const view = new DataView(bytes.buffer);
  IDENTITY.forEach((v, i) => view.setFloat32(i * 4, v, true));
  return bytes;
})();
