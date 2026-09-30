// Ink segment files and record blobs (spec 9.1, 9.2, and 9.6): the TypeScript twin of
// crates/core/src/format/segment.rs. Both pass the fixtures in docs/format/fixtures/ink.
//
// The interface decodes the record blobs of the page envelope, which the core has already checked, with
// `decodeRecords(bytes, { verify: false })`. Whole segment files are decoded with the checks of spec 9.6.

import { crc32, idBytes, idText, readI64, writeI64 } from './bytes';
import { encodeRecord, FRAME_BYTES, KIND_PROPS, KIND_REMOVE, KIND_STROKE, parseBody } from './records';
import type { InkRecord } from './records';

export * from './points';
export * from './records';
export { crc32, idBytes, idText } from './bytes';

const MAGIC = [0x89, 0x4f, 0x4e, 0x4b, 0x0d, 0x0a, 0x1a, 0x0a];
const FOOTER_MAGIC = [0x4f, 0x4e, 0x4b, 0x45];
const HEADER_BYTES = 64;
const FOOTER_BYTES = 8;
const TIME_MIN = -62_135_596_800_000;
const TIME_MAX = 253_402_300_799_999;

/** Why a segment can't be read at all, as the fixtures name it. */
export type SegmentErrorKind = 'syntax' | 'newerVersion' | 'unknownRecord' | 'checksum' | 'validation' | 'truncated';

/** A segment or record blob that can't be read. */
export class SegmentError extends Error {
  constructor(
    readonly kind: SegmentErrorKind,
    message: string,
  ) {
    super(message);
  }
}

/** The header fields a writer chooses: IDs as text, and the time in Unix milliseconds. */
export interface SegmentHeader {
  id: string;
  page: string;
  created: number;
}

/** A segment's entry in page.json (spec 8.3). */
export interface SegmentEntry {
  id: string;
  bytes: number;
  records: number;
  crc32: number;
}

/** A record that failed its checks. */
export interface DamagedRecord {
  index: number;
  offset: number;
  stroke: string | null;
  reason: string;
}

/** A decoded segment, with any damage it had. */
export interface DecodedSegment {
  header: SegmentHeader;
  records: InkRecord[];
  damaged: DamagedRecord[];
  unknownRecords: number;
  footerOk: boolean;
}

/** A frame whose body fits: its start, stored CRC-32, kind, flag and reserved bytes, and body range. */
interface Frame {
  start: number;
  crc: number;
  kind: number;
  flags: number;
  bodyStart: number;
  bodyEnd: number;
}

function concat(parts: Uint8Array[], extra = 0): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0) + extra);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Encodes records without a header or footer, for journal blobs and the page envelope. */
export function encodeRecords(records: InkRecord[]): Uint8Array {
  return concat(records.map(encodeRecord));
}

/** Encodes a segment file: header, records, and footer. */
export function encodeSegment(header: SegmentHeader, records: InkRecord[]): Uint8Array {
  const head = new Uint8Array(HEADER_BYTES);
  const view = new DataView(head.buffer);
  head.set(MAGIC, 0);
  view.setUint16(8, 1, true);
  view.setUint32(12, records.length, true);
  head.set(idBytes(header.id), 16);
  head.set(idBytes(header.page), 32);
  writeI64(view, 48, header.created);
  view.setUint32(60, crc32(head, 0, 60), true);
  const out = concat([head, ...records.map(encodeRecord)], FOOTER_BYTES);
  const footer = new DataView(out.buffer, out.length - FOOTER_BYTES);
  footer.setUint32(0, crc32(out, 0, out.length - FOOTER_BYTES), true);
  out.set(FOOTER_MAGIC, out.length - 4);
  return out;
}

function readFrame(bytes: Uint8Array, view: DataView, pos: number, end: number): Frame | 'truncated' | 'length' {
  if (pos + FRAME_BYTES > end) return 'truncated';
  const length = view.getUint32(pos + 8, true);
  const bodyEnd = pos + FRAME_BYTES + length;
  if (bodyEnd > end) return 'length';
  const flags = bytes[pos + 5] | (bytes[pos + 6] << 8) | (bytes[pos + 7] << 16);
  const crc = view.getUint32(pos, true);
  return { start: pos, crc, kind: bytes[pos + 4], flags, bodyStart: pos + FRAME_BYTES, bodyEnd };
}

function crcOk(bytes: Uint8Array, frame: Frame): boolean {
  return crc32(bytes, frame.start + 4, frame.bodyEnd) === frame.crc;
}

/**
 * Decodes records without a header or footer. Every record must be intact and of a known kind. With
 * `verify: false`, neither the records' CRC-32 values nor their points are checked, for blobs the core has
 * already checked. The renderer decodes the points anyway.
 */
export function decodeRecords(bytes: Uint8Array, options: { verify?: boolean } = {}): InkRecord[] {
  const verify = options.verify ?? true;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const records: InkRecord[] = [];
  let pos = 0;
  while (pos < bytes.length) {
    const frame = readFrame(bytes, view, pos, bytes.length);
    if (typeof frame === 'string') throw new SegmentError('truncated', `a damaged record at byte ${pos}: ${frame}`);
    if (verify && !crcOk(bytes, frame)) throw new SegmentError('checksum', `a damaged record at byte ${pos}`);
    const parsed = parseBody(frame.kind, frame.flags, bytes.subarray(frame.bodyStart, frame.bodyEnd), verify);
    if ('unknown' in parsed) throw new SegmentError('unknownRecord', `a record from a newer version at byte ${pos}`);
    if ('bad' in parsed) throw new SegmentError('validation', `a damaged record at byte ${pos}: ${parsed.bad}`);
    records.push(parsed.record);
    pos = frame.bodyEnd;
  }
  return records;
}

function startsWith(bytes: Uint8Array, at: number, magic: number[]): boolean {
  return magic.every((b, i) => bytes[at + i] === b);
}

function readHeader(bytes: Uint8Array, view: DataView): { header: SegmentHeader; count: number } {
  if (bytes.length < HEADER_BYTES + FOOTER_BYTES || !startsWith(bytes, 0, MAGIC)) {
    throw new SegmentError('syntax', 'not an ink segment');
  }
  const version = view.getUint16(8, true);
  if (version === 0) throw new SegmentError('syntax', 'segment version 0');
  if (version > 1) throw new SegmentError('newerVersion', `segment version ${version}`);
  if (crc32(bytes, 0, 60) !== view.getUint32(60, true)) throw new SegmentError('checksum', 'a damaged header');
  if (view.getUint16(10, true) !== 0 || view.getUint32(56, true) !== 0) {
    throw new SegmentError('unknownRecord', 'header flags from a newer version');
  }
  const created = readI64(view, 48);
  if (created < TIME_MIN || created > TIME_MAX) throw new SegmentError('validation', 'the time is out of range');
  const header = { id: idText(bytes, 16), page: idText(bytes, 32), created };
  return { header, count: view.getUint32(12, true) };
}

function footerOk(bytes: Uint8Array, view: DataView): boolean {
  const at = bytes.length - FOOTER_BYTES;
  return startsWith(bytes, bytes.length - 4, FOOTER_MAGIC) && view.getUint32(at, true) === crc32(bytes, 0, at);
}

/** Decodes a segment file, checking it against its entry and page (spec 9.6). */
export function decodeSegment(bytes: Uint8Array, expect: SegmentEntry, page: string): DecodedSegment {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { header, count } = readHeader(bytes, view);
  if (header.id !== expect.id || header.page !== page) {
    throw new SegmentError('validation', "the segment's IDs don't match its entry and page");
  }
  const footerAt = bytes.length - FOOTER_BYTES;
  const intact = footerOk(bytes, view);
  if (intact) {
    const crc = view.getUint32(footerAt, true);
    if (expect.bytes !== bytes.length || expect.crc32 !== crc || expect.records !== count) {
      throw new SegmentError('checksum', "the segment doesn't match its entry");
    }
    const exact = readExact(bytes, view, footerAt, count);
    if (exact) return { header, ...exact, damaged: [], footerOk: true };
  }
  const end = startsWith(bytes, bytes.length - 4, FOOTER_MAGIC) ? footerAt : bytes.length;
  return { header, ...walk(bytes, view, end), footerOk: intact };
}

function readExact(
  bytes: Uint8Array,
  view: DataView,
  end: number,
  count: number,
): { records: InkRecord[]; unknownRecords: number } | null {
  const records: InkRecord[] = [];
  let unknownRecords = 0;
  let pos = HEADER_BYTES;
  for (let i = 0; i < count; i++) {
    const frame = readFrame(bytes, view, pos, end);
    if (typeof frame === 'string') return null;
    const parsed = parseBody(frame.kind, frame.flags, bytes.subarray(frame.bodyStart, frame.bodyEnd));
    if ('bad' in parsed) return null;
    if ('unknown' in parsed) unknownRecords++;
    else records.push(parsed.record);
    pos = frame.bodyEnd;
  }
  return pos === end ? { records, unknownRecords } : null;
}

function damaged(bytes: Uint8Array, index: number, pos: number, frame: Frame | null, reason: string): DamagedRecord {
  const known = frame !== null && [KIND_STROKE, KIND_PROPS, KIND_REMOVE].includes(frame.kind);
  const stroke = known && frame.bodyStart + 16 <= bytes.length ? idText(bytes, frame.bodyStart) : null;
  return { index, offset: pos, stroke, reason };
}

/** The next offset from `from` where a frame fits, has zero flags, and has a matching CRC-32. */
function resync(bytes: Uint8Array, view: DataView, from: number, end: number): number | null {
  for (let pos = from; pos < end; pos++) {
    const frame = readFrame(bytes, view, pos, end);
    if (typeof frame !== 'string' && frame.flags === 0 && crcOk(bytes, frame)) return pos;
  }
  return null;
}

function walk(bytes: Uint8Array, view: DataView, end: number) {
  const out = { records: [] as InkRecord[], damaged: [] as DamagedRecord[], unknownRecords: 0 };
  let pos = HEADER_BYTES;
  for (let index = 0; pos < end; index++) {
    const frame = readFrame(bytes, view, pos, end);
    if (typeof frame === 'string') {
      out.damaged.push(damaged(bytes, index, pos, null, frame));
      const next = resync(bytes, view, pos + 1, end);
      if (next === null) break;
      pos = next;
      continue;
    }
    const body = bytes.subarray(frame.bodyStart, frame.bodyEnd);
    const parsed = crcOk(bytes, frame) ? parseBody(frame.kind, frame.flags, body) : { bad: 'checksum' as const };
    if ('record' in parsed) out.records.push(parsed.record);
    else if ('unknown' in parsed) out.unknownRecords++;
    else out.damaged.push(damaged(bytes, index, pos, frame, parsed.bad));
    pos = frame.bodyEnd;
  }
  return out;
}
