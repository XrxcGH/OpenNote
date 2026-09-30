// Point data (spec 9.4): quantized points as zigzag and LEB128 varints of first-order deltas.
// The TypeScript twin of crates/core/src/format/points.rs. Both pass the fixtures in docs/format/fixtures/ink.

/** Stroke flag bit 0: points carry pressure. */
export const CHANNEL_PRESSURE = 1;
/** Stroke flag bit 1: points carry tilt. */
export const CHANNEL_TILT = 2;
/** Stroke flag bit 2: points carry time. */
export const CHANNEL_TIME = 4;
/** The most points in one stroke (spec 9.3). */
export const MAX_POINTS = 200_000;

const MAX_COORD = 2 ** 29;
const MAX_TILT = 9_000;
const MAX_FIRST_TIME = 9;

/** One point as stored: x and y in 1/64 page units, tilt in 1/100 degree, and time in 100 microseconds. */
export interface Point {
  x: number;
  y: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  t: number;
}

/** A stroke's points as typed arrays, the form the renderer draws from. Absent channels are null. */
export interface PointArrays {
  x: Int32Array;
  y: Int32Array;
  pressure: Uint16Array | null;
  tiltX: Int16Array | null;
  tiltY: Int16Array | null;
  t: Uint32Array | null;
}

/** A bounding box in 1/64 page units. */
export interface BBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Point data that breaks spec 9.4. */
export class PointError extends Error {}

/** Appends an unsigned LEB128 varint. */
export function putVarint(out: number[], value: number): void {
  let v = value >>> 0;
  while (v >= 0x80) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v);
}

function putZigzag(out: number[], value: number): void {
  putVarint(out, ((value << 1) ^ (value >> 31)) >>> 0);
}

function checkPoint(p: Point, previous: Point | null, index: number, channels: number): void {
  const bad = (channel: string) => new PointError(`point ${index} has ${channel} out of range`);
  if (Math.abs(p.x) > MAX_COORD) throw bad('x');
  if (Math.abs(p.y) > MAX_COORD) throw bad('y');
  if (channels & CHANNEL_TILT && (Math.abs(p.tiltX) > MAX_TILT || Math.abs(p.tiltY) > MAX_TILT)) throw bad('tilt');
  if (channels & CHANNEL_TIME && (previous === null ? p.t > MAX_FIRST_TIME : p.t < previous.t)) throw bad('time');
}

/** Encodes points, and returns the bytes and the bounding box. Channels left out of `channels` are not written. */
export function encodePoints(points: Point[], channels: number): { bytes: Uint8Array; bbox: BBox } {
  if (points.length === 0 || points.length > MAX_POINTS) throw new PointError(`${points.length} points`);
  const out: number[] = [];
  const bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  let previous: Point | null = null;
  points.forEach((p, index) => {
    checkPoint(p, previous, index, channels);
    const delta = (now: number, before: number) => (previous === null ? now : now - before);
    putZigzag(out, delta(p.x, previous?.x ?? 0));
    putZigzag(out, delta(p.y, previous?.y ?? 0));
    if (channels & CHANNEL_PRESSURE) {
      if (previous === null) putVarint(out, p.pressure);
      else putZigzag(out, p.pressure - previous.pressure);
    }
    if (channels & CHANNEL_TILT) {
      putZigzag(out, delta(p.tiltX, previous?.tiltX ?? 0));
      putZigzag(out, delta(p.tiltY, previous?.tiltY ?? 0));
    }
    if (channels & CHANNEL_TIME) putVarint(out, previous === null ? p.t : p.t - previous.t);
    bbox.minX = Math.min(bbox.minX, p.x);
    bbox.minY = Math.min(bbox.minY, p.y);
    bbox.maxX = Math.max(bbox.maxX, p.x);
    bbox.maxY = Math.max(bbox.maxY, p.y);
    previous = p;
  });
  return { bytes: Uint8Array.from(out), bbox };
}

/** What each of a varint's five bytes is worth, as 7 bits at a time: `2 ** (7 * i)`. */
const VARINT_UNITS = [1, 128, 16_384, 2_097_152, 268_435_456];

/** Reads varints from point data, checking that each is at most 5 bytes and in its shortest form. */
class Reader {
  pos = 0;
  constructor(private readonly bytes: Uint8Array) {}

  varint(): number {
    const bytes = this.bytes;
    const first = this.pos < bytes.length ? bytes[this.pos] : 0x80;
    if (first < 0x80) {
      this.pos++;
      return first;
    }
    return this.longVarint();
  }

  /** A varint that takes more than one byte, or that is cut off. */
  private longVarint(): number {
    const start = this.pos;
    const bytes = this.bytes;
    let value = 0;
    for (let i = 0; i < 5; i++) {
      if (this.pos >= bytes.length) throw new PointError('the point data ended early');
      const byte = bytes[this.pos++];
      if (i === 4 && byte > 0x0f) throw new PointError(`a malformed varint at byte ${start}`);
      value += (byte & 0x7f) * VARINT_UNITS[i];
      if ((byte & 0x80) === 0) {
        if (byte === 0 && i > 0) throw new PointError(`an overlong varint at byte ${start}`);
        return value;
      }
    }
    throw new PointError(`a malformed varint at byte ${start}`);
  }

  zigzag(): number {
    const z = this.varint();
    return (z >>> 1) ^ -(z & 1);
  }
}

function checkCount(bytes: Uint8Array, count: number): void {
  if (!Number.isInteger(count) || count < 1 || count > MAX_POINTS) throw new PointError(`${count} points`);
  if (bytes.length < count * 2) throw new PointError('the point data ended early');
}

function inRange(value: number, limit: number, index: number, channel: string): number {
  if (Math.abs(value) > limit) throw new PointError(`point ${index} has ${channel} out of range`);
  return value;
}

/** The typed arrays for `total` points in one buffer, since a buffer for each array costs more than decoding. */
function allocate(total: number, channels: number): PointArrays {
  const pressure = (channels & CHANNEL_PRESSURE) !== 0;
  const tilt = (channels & CHANNEL_TILT) !== 0;
  const time = (channels & CHANNEL_TIME) !== 0;
  const buffer = new ArrayBuffer(total * (8 + (time ? 4 : 0) + (pressure ? 2 : 0) + (tilt ? 4 : 0)));
  const x = new Int32Array(buffer, 0, total);
  const y = new Int32Array(buffer, total * 4, total);
  let at = total * 8;
  const t = time ? new Uint32Array(buffer, at, total) : null;
  at += time ? total * 4 : 0;
  const p = pressure ? new Uint16Array(buffer, at, total) : null;
  at += pressure ? total * 2 : 0;
  return {
    x,
    y,
    pressure: p,
    tiltX: tilt ? new Int16Array(buffer, at, total) : null,
    tiltY: tilt ? new Int16Array(buffer, at + total * 2, total) : null,
    t,
  };
}

/** Decodes exactly `count` points that use up exactly `bytes`, into typed arrays. */
export function decodePoints(bytes: Uint8Array, count: number, channels: number): PointArrays {
  checkCount(bytes, count);
  const out = allocate(count, channels & 7);
  const { x: xs, y: ys, pressure: ps, tiltX: txs, tiltY: tys, t: ts } = out;
  const reader = new Reader(bytes);
  let x = 0;
  let y = 0;
  let p = 0;
  let tx = 0;
  let ty = 0;
  let t = 0;
  for (let i = 0; i < count; i++) {
    const base = i === 0 ? 0 : 1;
    x = inRange(x * base + reader.zigzag(), MAX_COORD, i, 'x');
    y = inRange(y * base + reader.zigzag(), MAX_COORD, i, 'y');
    xs[i] = x;
    ys[i] = y;
    if (ps) {
      p = i === 0 ? reader.varint() : p + reader.zigzag();
      if (p < 0 || p > 0xffff) throw new PointError(`point ${i} has pressure out of range`);
      ps[i] = p;
    }
    if (txs && tys) {
      tx = inRange(tx * base + reader.zigzag(), MAX_TILT, i, 'tilt');
      ty = inRange(ty * base + reader.zigzag(), MAX_TILT, i, 'tilt');
      txs[i] = tx;
      tys[i] = ty;
    }
    if (ts) {
      const dt = reader.varint();
      t = i === 0 ? dt : t + dt;
      if (i === 0 ? t > MAX_FIRST_TIME : t > 0xffffffff) throw new PointError(`point ${i} has time out of range`);
      ts[i] = t;
    }
  }
  if (reader.pos !== bytes.length) throw new PointError(`${bytes.length - reader.pos} bytes after the last point`);
  return out;
}

/** The bounding box of decoded points. */
export function boxOf(points: PointArrays): BBox {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (let i = 0; i < points.x.length; i++) {
    box.minX = Math.min(box.minX, points.x[i]);
    box.minY = Math.min(box.minY, points.y[i]);
    box.maxX = Math.max(box.maxX, points.x[i]);
    box.maxY = Math.max(box.maxY, points.y[i]);
  }
  return box;
}

/** Point `i` of decoded points, with 0 for absent channels. */
export function pointAt(points: PointArrays, i: number): Point {
  return {
    x: points.x[i],
    y: points.y[i],
    pressure: points.pressure?.[i] ?? 0,
    tiltX: points.tiltX?.[i] ?? 0,
    tiltY: points.tiltY?.[i] ?? 0,
    t: points.t?.[i] ?? 0,
  };
}
