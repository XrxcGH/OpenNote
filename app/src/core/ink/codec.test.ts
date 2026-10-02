// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CHANNEL_PRESSURE,
  CHANNEL_TILT,
  CHANNEL_TIME,
  crc32,
  decodePoints,
  decodeRecords,
  decodeSegment,
  encodePoints,
  encodeRecords,
  encodeSegment,
  idBytes,
  idText,
  pointAt,
  SegmentError,
} from './codec';
import type { DecodedSegment, InkRecord, Point, SegmentEntry, StrokeStyle } from './codec';

const FIXTURES = fileURLToPath(new URL('../../../../docs/format/fixtures/', import.meta.url));
const INK = join(FIXTURES, 'ink');

interface InkCase {
  file: string;
  page: string;
  expect: { id: string; bytes: number; records: number; crc32: string };
  result?: unknown;
  error?: string;
}

function readCase(name: string): InkCase {
  return JSON.parse(readFileSync(join(INK, name), 'utf8')) as InkCase;
}

function entry(expect: InkCase['expect']): SegmentEntry {
  return { ...expect, crc32: Number.parseInt(expect.crc32, 16) };
}

function styleJson(style: StrokeStyle) {
  return { tool: style.tool, palette: style.palette, color: style.color, width: style.width };
}

/** A record in the JSON form the fixtures use. */
function recordJson(record: InkRecord): unknown {
  if (record.kind === 'remove') return { kind: 'remove', id: record.id };
  if (record.kind === 'props') {
    const { id, style, transform, block } = record.props;
    return { kind: 'props', id, style: style && styleJson(style), transform, block };
  }
  const s = record.stroke;
  const points = decodePoints(s.points, s.pointCount, s.channels);
  return {
    kind: 'stroke',
    id: s.id,
    block: s.block,
    start: s.start,
    startUnknown: s.startUnknown,
    style: styleJson(s.style),
    bbox: [s.bbox.minX, s.bbox.minY, s.bbox.maxX, s.bbox.maxY],
    channels: s.channels,
    transform: s.transform,
    origin: s.origin,
    points: Array.from({ length: s.pointCount }, (_, i) => {
      const p = pointAt(points, i);
      return [p.x, p.y, p.pressure, p.tiltX, p.tiltY, p.t];
    }),
  };
}

function resultJson(decoded: DecodedSegment): unknown {
  return {
    header: decoded.header,
    footerOk: decoded.footerOk,
    unknownRecords: decoded.unknownRecords,
    damaged: decoded.damaged,
    records: decoded.records.map(recordJson),
  };
}

const inkCases = readdirSync(INK)
  .filter((name) => name.endsWith('.json'))
  .map((name) => [name, readCase(name)] as const);

describe('the ink fixtures', () => {
  it('are all there', () => {
    expect(inkCases.length).toBeGreaterThanOrEqual(10);
  });

  it.each(inkCases)('%s decodes as recorded', (_, testCase) => {
    const bytes = new Uint8Array(readFileSync(join(INK, testCase.file)));
    const decode = () => decodeSegment(bytes, entry(testCase.expect), testCase.page);
    if (testCase.error) {
      expect(decode).toThrow(SegmentError);
      try {
        decode();
      } catch (error) {
        expect((error as SegmentError).kind).toBe(testCase.error);
      }
      return;
    }
    const decoded = decode();
    expect(resultJson(decoded)).toEqual(testCase.result);
    if (decoded.footerOk && decoded.damaged.length === 0 && decoded.unknownRecords === 0) {
      expect(encodeSegment(decoded.header, decoded.records)).toEqual(bytes);
    }
  });

  it('match the test vector of spec Appendix B.2', () => {
    const bytes = new Uint8Array(readFileSync(join(INK, 'appendix-b2.onk')));
    expect(bytes.length).toBe(176);
    const footer = new DataView(bytes.buffer, bytes.byteOffset + 168, 4).getUint32(0, true);
    expect(footer.toString(16)).toBe('c445a2a0');
  });
});

describe('record blobs', () => {
  const testCase = readCase('every-record.json');
  const bytes = new Uint8Array(readFileSync(join(INK, testCase.file)));
  const records = decodeSegment(bytes, entry(testCase.expect), testCase.page).records;

  it('round-trip, with and without checking CRC-32 values', () => {
    const blob = encodeRecords(records);
    expect(decodeRecords(blob)).toEqual(records);
    expect(decodeRecords(blob, { verify: false })).toEqual(records);
    expect(encodeRecords(decodeRecords(blob))).toEqual(blob);
  });

  it('skip the point checks without verifying, for blobs the core has checked', () => {
    const found = records.find((record) => record.kind === 'stroke');
    if (found?.kind !== 'stroke') throw new Error('the fixture has no stroke');
    const bbox = { ...found.stroke.bbox, maxX: found.stroke.bbox.maxX + 1 };
    const wrong: InkRecord = { kind: 'stroke', stroke: { ...found.stroke, bbox } };
    const blob = encodeRecords([wrong]);
    expect(() => decodeRecords(blob)).toThrow(SegmentError);
    expect(decodeRecords(blob, { verify: false })).toEqual([wrong]);
  });

  it('are all or nothing', () => {
    const blob = encodeRecords(records);
    blob[20] ^= 1;
    expect(() => decodeRecords(blob)).toThrow(SegmentError);
    expect(() => decodeRecords(blob.subarray(0, blob.length - 3))).toThrow(SegmentError);
  });
});

describe('the fixture notebook', () => {
  it('has segments that read cleanly', () => {
    const notebook = join(FIXTURES, 'nb', 'v1');
    let decoded = 0;
    for (const section of readdirSync(notebook).filter((name) => /^[0-9a-z]{26}$/.test(name))) {
      for (const page of readdirSync(join(notebook, section)).filter((name) => /^[0-9a-z]{26}$/.test(name))) {
        const pageJson = JSON.parse(readFileSync(join(notebook, section, page, 'page.json'), 'utf8'));
        for (const segment of pageJson.ink?.segments ?? []) {
          const bytes = new Uint8Array(readFileSync(join(notebook, section, page, 'ink', `${segment.id}.onk`)));
          const result = decodeSegment(bytes, entry(segment), page);
          expect(result.footerOk && result.damaged.length === 0).toBe(true);
          decoded++;
        }
      }
    }
    expect(decoded).toBe(3);
  });
});

/** A stroke of random points with every channel, from a random number source. */
function randomStroke(next: (n: number) => number): Point[] {
  let t = next(10);
  return Array.from({ length: 1 + next(50) }, (_, i) => {
    if (i > 0) t += next(300);
    return {
      x: next(2 ** 21) - 2 ** 20,
      y: next(2 ** 21) - 2 ** 20,
      pressure: next(65536),
      tiltX: next(18001) - 9000,
      tiltY: next(18001) - 9000,
      t,
    };
  });
}

describe('points', () => {
  const worked: Point[] = [
    { x: 640, y: 1280, pressure: 32768, tiltX: 0, tiltY: 0, t: 0 },
    { x: 672, y: 1344, pressure: 34078, tiltX: 0, tiltY: 0, t: 42 },
    { x: 720, y: 1440, pressure: 36044, tiltX: 0, tiltY: 0, t: 83 },
  ];
  const channels = CHANNEL_PRESSURE | CHANNEL_TIME;

  it('encode the worked example of spec 9.7', () => {
    const { bytes, bbox } = encodePoints(worked, channels);
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(' ');
    expect(hex).toBe('80 0a 80 14 80 80 02 00 40 80 01 bc 14 2a 60 c0 01 dc 1e 29');
    expect(bbox).toEqual({ minX: 640, minY: 1280, maxX: 720, maxY: 1440 });
    const decoded = decodePoints(bytes, 3, channels);
    expect([0, 1, 2].map((i) => pointAt(decoded, i))).toEqual(worked);
  });

  it('round-trip random strokes with every channel', () => {
    let seed = 12345;
    const next = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let round = 0; round < 200; round++) {
      const points = randomStroke(next);
      const { bytes } = encodePoints(points, 7);
      const decoded = decodePoints(bytes, points.length, 7);
      expect(points.map((_, i) => pointAt(decoded, i))).toEqual(points);
    }
  });

  it('reject bad data', () => {
    const { bytes } = encodePoints(worked, channels);
    expect(() => decodePoints(bytes, 2, channels)).toThrow();
    expect(() => decodePoints(bytes.subarray(0, 19), 3, channels)).toThrow();
    expect(() => decodePoints(new Uint8Array([0x80, 0x00, 0x00]), 1, 0)).toThrow();
    expect(() => decodePoints(new Uint8Array([0, 0, 10]), 1, CHANNEL_TIME)).toThrow();
    expect(() => encodePoints([], 0)).toThrow();
  });
});

describe('point channels', () => {
  it('round-trip every combination of channels, whose arrays share one buffer', () => {
    const points = [
      { x: 70_000, y: -300_000, pressure: 65_535, tiltX: -9_000, tiltY: 9_000, t: 9 },
      { x: 5, y: 1, pressure: 0, tiltX: 12, tiltY: -3, t: 40_000 },
      { x: -(2 ** 29), y: 2 ** 29, pressure: 300, tiltX: 0, tiltY: 1, t: 40_001 },
    ];
    for (let set = 0; set < 8; set++) {
      const kept = points.map((p) => ({
        x: p.x,
        y: p.y,
        pressure: set & CHANNEL_PRESSURE ? p.pressure : 0,
        tiltX: set & CHANNEL_TILT ? p.tiltX : 0,
        tiltY: set & CHANNEL_TILT ? p.tiltY : 0,
        t: set & CHANNEL_TIME ? p.t : 0,
      }));
      const { bytes } = encodePoints(kept, set);
      const decoded = decodePoints(bytes, kept.length, set);
      expect(kept.map((_, i) => pointAt(decoded, i))).toEqual(kept);
      expect([decoded.pressure, decoded.tiltX, decoded.tiltY, decoded.t].map((a) => a !== null)).toEqual([
        (set & CHANNEL_PRESSURE) !== 0,
        (set & CHANNEL_TILT) !== 0,
        (set & CHANNEL_TILT) !== 0,
        (set & CHANNEL_TIME) !== 0,
      ]);
    }
  });
});

describe('bytes', () => {
  it('compute the CRC-32 check value', () => {
    expect(crc32(new TextEncoder().encode('123456789')).toString(16)).toBe('cbf43926');
  });

  it('turn IDs into text and back', () => {
    for (const id of ['01m3sa12426sg32pmtyffjaqcf', '7zzzzzzzzzzzzzzzzzzzzzzzzz', '00000000000000000000000000']) {
      expect(idText(idBytes(id), 0)).toBe(id);
    }
    expect(idText(idBytes('01M3SA12426SG32PMTYFFJAQCF'), 0)).toBe('01m3sa12426sg32pmtyffjaqcf');
    expect(() => idBytes('01m3sa12426sg32pmtyffjaqcu')).toThrow();
    expect(() => idBytes('81m3sa12426sg32pmtyffjaqcf')).toThrow();
  });
});
