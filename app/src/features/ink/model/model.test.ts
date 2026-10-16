// @vitest-environment node
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decodeSegment, encodeRecord } from '../../../core/ink/codec';
import type { InkRecord, SegmentEntry, Stroke as StrokeRecord } from '../../../core/ink/codec';
import { createStrokeIndex } from '../geometry/strokeIndex';
import { splitStroke } from '../geometry/partialErase';
import { translation } from '../geometry/matrix';
import { moveStrokes } from '../geometry/transform';
import { PENS, paletteEntry } from '../pens/palette';
import { canEncode, recordBounds, recordFromStroke, strokeFromRecord } from './convert';
import { inkStroke, testId } from './fixtures';
import { recolor, scaleWidths, scaledWidth, setDrawnWidth } from './restyle';
import { applyProps, applyRecord, foldRecords } from './table';
import type { InkStroke } from './types';

const INK = fileURLToPath(new URL('../../../../../docs/format/fixtures/ink/', import.meta.url));

function fixtureRecords(name: string): InkRecord[] {
  const info = JSON.parse(readFileSync(join(INK, `${name}.json`), 'utf8')) as {
    page: string;
    expect: { id: string; bytes: number; records: number; crc32: string };
  };
  const entry: SegmentEntry = { ...info.expect, crc32: Number.parseInt(info.expect.crc32, 16) };
  const bytes = new Uint8Array(readFileSync(join(INK, `${name}.onk`)));
  return decodeSegment(bytes, entry, info.page).records;
}

const strokeRecords = (records: InkRecord[]): StrokeRecord[] =>
  records.flatMap((r) => (r.kind === 'stroke' ? [r.stroke] : []));

describe('stroke records and strokes', () => {
  it('decodes the fixture strokes into page units and encodes them to the same bytes', () => {
    for (const name of ['every-record', 'appendix-b2']) {
      const records = strokeRecords(fixtureRecords(name));
      expect(records.length).toBeGreaterThan(0);
      for (const record of records) {
        const again = recordFromStroke(strokeFromRecord(record));
        expect(encodeRecord({ kind: 'stroke', stroke: again })).toEqual(
          encodeRecord({ kind: 'stroke', stroke: record }),
        );
      }
    }
  });

  it('reads positions as 1/64 units, pressure as a fraction, tilt in degrees, and time in milliseconds', () => {
    const [first] = strokeRecords(fixtureRecords('appendix-b2'));
    const stroke = strokeFromRecord(first);
    // The appendix stroke: 3 points from (640, 1280) to (720, 1440) in steps, so (10, 20) to (11.25, 22.5).
    expect(stroke.points[0].x).toBe(first.bbox.minX / 64);
    expect(stroke.points[0].y).toBe(first.bbox.minY / 64);
    expect(stroke.points[0].pressure).toBeCloseTo(0.5, 4);
    expect(stroke.points[0].time).toBe(0);
    expect(stroke.points[2].time).toBeCloseTo(8.3, 6);
    expect(stroke.tool).toBe('pen');
    expect(stroke.slot).toBe(1);
    expect(stroke.width).toBe(2);
  });

  it('keeps the transform, the origin, and the unknown-start flag', () => {
    const records = strokeRecords(fixtureRecords('every-record'));
    const withOrigin = records.find((r) => r.origin)!;
    const stroke = strokeFromRecord(withOrigin);
    expect(stroke.origin).toBe(withOrigin.origin);
    const moved = { ...inkStroke(1), transform: [1, 0, 0, 1, 12.5, -3.25] as const, origin: testId(99) };
    const record = recordFromStroke(moved);
    expect(record.transform).toEqual([1, 0, 0, 1, 12.5, -3.25]);
    expect(record.origin).toBe(testId(99));
    expect(strokeFromRecord(record).transform).toEqual([1, 0, 0, 1, 12.5, -3.25]);
    expect(recordFromStroke({ ...inkStroke(2), startUnknown: true }).startUnknown).toBe(true);
  });
});

describe('what a record holds', () => {
  it('writes only the channels the points carry', () => {
    const bare = inkStroke(3, 5);
    const points = bare.points.map(({ x, y }) => ({ x, y }));
    expect(recordFromStroke({ ...bare, points }).channels).toBe(0);
    expect(recordFromStroke({ ...bare, points: points.map((p, i) => ({ ...p, time: i })) }).channels).toBe(4);
    expect(recordFromStroke(bare).channels).toBe(7);
  });

  it('clamps what a record cannot hold instead of failing', () => {
    const stroke = inkStroke(4, 3, {
      points: [
        { x: 1e9, y: -1e9, pressure: 2, tiltX: 120, tiltY: -120, time: 0 },
        { x: 0, y: 0, pressure: -1, tiltX: 0, tiltY: 0, time: -5 },
      ],
    });
    const decoded = strokeFromRecord(recordFromStroke(stroke));
    expect(decoded.points[0].x).toBe(2 ** 29 / 64);
    expect(decoded.points[0].y).toBe(-(2 ** 29) / 64);
    expect(decoded.points[0].pressure).toBe(1);
    expect(decoded.points[0].tiltX).toBe(90);
    expect(decoded.points[1].pressure).toBe(0);
    expect(decoded.points[1].time).toBeGreaterThanOrEqual(decoded.points[0].time!);
  });

  it('cannot encode a stroke without points', () => {
    expect(canEncode({ ...inkStroke(5), points: [] })).toBe(false);
    expect(canEncode(inkStroke(5))).toBe(true);
  });
});

describe('quantizing', () => {
  it('is stable: a stroke that went through a record encodes to the same record again', () => {
    const arbitrary = fc.record({
      n: fc.nat(1000),
      count: fc.integer({ min: 1, max: 60 }),
      transform: fc.option(
        fc.tuple(...Array.from({ length: 6 }, () => fc.double({ min: -20, max: 20, noNaN: true }))),
        { nil: undefined },
      ),
    });
    fc.assert(
      fc.property(arbitrary, ({ n, count, transform }) => {
        const stroke = { ...inkStroke(n, count), transform: transform as InkStroke['transform'] };
        const once = recordFromStroke(stroke);
        const twice = recordFromStroke(strokeFromRecord(once));
        expect(encodeRecord({ kind: 'stroke', stroke: twice })).toEqual(encodeRecord({ kind: 'stroke', stroke: once }));
      }),
      { numRuns: 60 },
    );
  });

  it('keeps a position within 1/128 unit, a pressure within 1/65535, and a time within 0.05 ms', () => {
    fc.assert(
      fc.property(fc.nat(500), fc.integer({ min: 2, max: 50 }), (n, count) => {
        const stroke = inkStroke(n, count);
        const back = strokeFromRecord(recordFromStroke(stroke));
        back.points.forEach((p, i) => {
          const q = stroke.points[i];
          expect(Math.abs(p.x - q.x)).toBeLessThanOrEqual(1 / 128 + 1e-9);
          expect(Math.abs(p.y - q.y)).toBeLessThanOrEqual(1 / 128 + 1e-9);
          expect(Math.abs(p.pressure! - q.pressure!)).toBeLessThanOrEqual(1 / 65535);
          expect(Math.abs(back.startTime + p.time! - (stroke.startTime + q.time!))).toBeLessThanOrEqual(0.05 + 1e-6);
        });
      }),
      { numRuns: 60 },
    );
  });
});

describe('start times and the first point (spec 8.2 and 9.4)', () => {
  it('moves a partial-erase slice into the start time so its first point is under a millisecond', () => {
    const stroke = inkStroke(6, 30);
    let next = 100;
    const parts = splitStroke(stroke, [{ from: { x: -1e6, y: -1e6 }, to: { x: -1e6, y: -1e6 }, radius: 1 }], () =>
      testId(next++),
    );
    expect(parts).toBeNull();
    // Cut the stroke through the middle with a wide capsule across its points.
    const mid = stroke.points[15];
    const cut = splitStroke(stroke, [{ from: mid, to: mid, radius: 3 }], () => testId(next++))!;
    expect(cut.length).toBe(2);
    for (const part of cut) {
      const record = recordFromStroke(part);
      const back = strokeFromRecord(record);
      expect(back.points[0].time).toBeLessThan(1);
      expect(back.points[0].time).toBeGreaterThanOrEqual(0);
      expect(back.origin).toBe(stroke.id);
      // The part starts where its first point was drawn.
      expect(back.startTime + back.points[0].time!).toBeCloseTo(part.startTime + part.points[0].time!, 1);
    }
  });

  it('puts a fraction of a millisecond in the first point, not in the start', () => {
    const stroke = inkStroke(7, 4, { startTime: 5_000.4 });
    const record = recordFromStroke(stroke);
    expect(record.start).toBe(5_000);
    expect(strokeFromRecord(record).points[0].time).toBeCloseTo(0.4, 6);
  });

  it('never lets a time go backward', () => {
    const stroke = inkStroke(8, 3, {
      points: [
        { x: 0, y: 0, time: 10 },
        { x: 1, y: 1, time: 4 },
        { x: 2, y: 2, time: 20 },
      ],
    });
    const times = strokeFromRecord(recordFromStroke(stroke)).points.map((p) => p.time!);
    expect(times[0]).toBeLessThanOrEqual(times[1]);
    expect(times[1]).toBeLessThanOrEqual(times[2]);
  });
});

describe('the box from a record header', () => {
  it('matches the box of the decoded stroke when the width is the only difference', () => {
    const stroke = { ...inkStroke(9, 50), transform: [1.5, 0.2, -0.2, 1.5, 30, -40] as const };
    const record = recordFromStroke(stroke);
    const header = recordBounds(record);
    const [decoded] = createStrokeIndex([strokeFromRecord(record)]).query({
      minX: -1e6,
      minY: -1e6,
      maxX: 1e6,
      maxY: 1e6,
    });
    // The header box is the stored box through the transform, so it holds every decoded point.
    for (const p of decoded.points) {
      const x = 1.5 * p.x - 0.2 * p.y + 30;
      const y = 0.2 * p.x + 1.5 * p.y - 40;
      expect(x).toBeGreaterThanOrEqual(header.minX);
      expect(x).toBeLessThanOrEqual(header.maxX);
      expect(y).toBeGreaterThanOrEqual(header.minY);
      expect(y).toBeLessThanOrEqual(header.maxY);
    }
  });
});

describe('the stroke table', () => {
  const base = recordFromStroke(inkStroke(10));
  const add = (stroke: StrokeRecord): InkRecord => ({ kind: 'stroke', stroke });

  it('adds a stroke, replaces one with the same id, and removes one', () => {
    const table = foldRecords([add(base)]);
    expect([...table.keys()]).toEqual([base.id]);
    const wider = { ...base, style: { ...base.style, width: 9 } };
    applyRecord(table, add(wider));
    expect(table.get(base.id)?.width).toBe(9);
    applyRecord(table, { kind: 'remove', id: base.id });
    expect(table.size).toBe(0);
  });

  it('applies property records to the fields they carry and nothing else', () => {
    const stroke = strokeFromRecord(base);
    const style = { tool: 2, palette: 33, color: [1, 2, 3, 4] as [number, number, number, number], width: 6 };
    const styled = applyProps(stroke, { id: stroke.id, style, transform: null, block: null });
    expect([styled.tool, styled.slot, styled.width]).toEqual(['highlighter', 33, 6]);
    expect(styled.points).toBe(stroke.points);
    const moved = applyProps(styled, { id: stroke.id, style: null, transform: [1, 0, 0, 1, 5, 6], block: null });
    expect(moved.transform).toEqual([1, 0, 0, 1, 5, 6]);
    expect(moved.slot).toBe(33);
    const home = applyProps(moved, { id: stroke.id, style: null, transform: 'remove', block: testId(777) });
    expect(home.transform).toBeUndefined();
    expect(home.block).toBe(testId(777));
  });

  it('ignores a property record or a remove for a stroke it does not have', () => {
    const table = foldRecords([add(base)]);
    applyRecord(table, { kind: 'props', props: { id: testId(5555), style: null, transform: null, block: null } });
    applyRecord(table, { kind: 'remove', id: testId(5555) });
    expect(table.size).toBe(1);
  });

  it('folds the fixture records into the strokes a reader would show', () => {
    const records = fixtureRecords('every-record');
    const table = foldRecords(records);
    const ids = new Set(
      records.map((r) => (r.kind === 'stroke' ? r.stroke.id : r.kind === 'props' ? r.props.id : r.id)),
    );
    const removed = new Set(records.flatMap((r) => (r.kind === 'remove' ? [r.id] : [])));
    for (const id of ids) expect(table.has(id)).toBe(!removed.has(id));
  });
});

describe('recoloring and width', () => {
  const pen = inkStroke(11);
  const highlighter = inkStroke(12, 10, { tool: 'highlighter', slot: 32, color: paletteEntry(32)!.light, width: 20 });
  const mint = paletteEntry(33)!;
  const brick = PENS[2];

  it('changes pens with a pen color and highlighters with a highlighter color, and leaves the rest', () => {
    const [p1, h1] = recolor([pen, highlighter], { slot: brick.slot, color: brick.light });
    expect([p1.slot, h1.slot]).toEqual([3, 32]);
    const [p2, h2] = recolor([pen, highlighter], { slot: mint.slot, color: mint.light });
    expect([p2.slot, h2.slot]).toEqual([pen.slot, 33]);
    expect(p2).toBe(pen);
  });

  it('lets the caller say what a custom color is for', () => {
    const custom = { slot: 0, color: [10, 20, 30, 255] as const };
    expect(recolor([pen, highlighter], custom)[0].color).toEqual(custom.color);
    expect(recolor([pen, highlighter], custom)[1]).toBe(highlighter);
    expect(recolor([pen, highlighter], custom, 'highlighter')[1].color).toEqual(custom.color);
  });

  it('makes strokes thicker and thinner by the steps of the menu, within the limits', () => {
    expect(scaleWidths([pen], 1.25)[0].width).toBeCloseTo(2.5, 9);
    expect(scaleWidths([pen], 0.8)[0].width).toBeCloseTo(1.6, 9);
    expect(scaleWidths([pen], 1e6)[0].width).toBeCloseTo(24 * 3.7795, 4);
    expect(scaleWidths([pen], 1e-6)[0].width).toBeCloseTo(0.1 * 3.7795, 4);
  });

  it('counts the transform in the limits and in a picked width', () => {
    const big = moveStrokes([{ ...pen, transform: [4, 0, 0, 4, 0, 0] as const }], 0, 0)[0];
    expect(scaledWidth(big, 1e6)).toBeCloseTo((24 * 3.7795) / 4, 4);
    expect(setDrawnWidth([big], 8)[0].width).toBeCloseTo(2, 9);
    expect(setDrawnWidth([pen], 5)[0].width).toBe(5);
  });

  it('keeps an identity-moved stroke equal to its record', () => {
    const stroke = moveStrokes([pen], 0, 0)[0];
    expect(stroke.transform).toEqual(translation(0, 0));
  });
});
