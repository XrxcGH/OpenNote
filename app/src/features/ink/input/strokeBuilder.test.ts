// @vitest-environment node
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { buildPressureTable } from '../geometry/pressure';
import { canEncode, recordFromStroke, strokeFromRecord } from '../model';
import { testId, TEST_BLOCK } from '../model/fixtures';
import { PENS } from '../pens/palette';
import { normalizeSample, tiltFromAngles } from './samples';
import type { RawSample } from './samples';
import { createStrokeBuilder } from './strokeBuilder';
import type { StrokeBuilderOptions } from './strokeBuilder';

const ink = PENS[1];
let counter = 0;
const options = (extra: Partial<StrokeBuilderOptions> = {}): StrokeBuilderOptions => ({
  tool: 'pen',
  width: 2,
  slot: ink.slot,
  color: ink.light,
  block: TEST_BLOCK,
  newId: () => testId(++counter),
  timeOrigin: 1_700_000_000_000,
  ...extra,
});

const pen = (i: number, extra: Partial<RawSample> = {}): RawSample => ({
  x: i * 3,
  y: Math.sin(i / 3) * 10,
  time: 100 + i * 8,
  pointerType: 'pen',
  pressure: 0.3 + (i % 5) * 0.1,
  tiltX: 10,
  tiltY: -5,
  ...extra,
});

const run = (samples: RawSample[], extra: Partial<StrokeBuilderOptions> = {}) => {
  const builder = createStrokeBuilder(options(extra));
  for (const s of samples) builder.push(s);
  return builder.finish();
};

describe('sample normalization', () => {
  it('turns a pen sample into a point with pressure and tilt', () => {
    expect(normalizeSample(pen(1))).toEqual({
      x: 3,
      y: expect.any(Number),
      time: 108,
      pressure: 0.4,
      tiltX: 10,
      tiltY: -5,
    });
  });

  it('gives touch and mouse samples no pressure and no tilt', () => {
    for (const pointerType of ['touch', 'mouse'] as const) {
      expect(normalizeSample(pen(1, { pointerType }))).toEqual({ x: 3, y: expect.any(Number), time: 108 });
    }
  });

  it('gives a pen that reports zero pressure while touching the middle pressure', () => {
    expect(normalizeSample(pen(1, { pressure: 0 }))?.pressure).toBe(0.5);
    expect(normalizeSample(pen(1, { pressure: undefined }))?.pressure).toBe(0.5);
  });

  it('drops a sample with a value that is not a number, and clamps positions', () => {
    expect(normalizeSample(pen(1, { x: NaN }))).toBeNull();
    expect(normalizeSample(pen(1, { time: Infinity }))).toBeNull();
    expect(normalizeSample(pen(1, { y: 1e12 }))?.y).toBe(2 ** 29 / 64);
  });

  it('runs pressure through the pen curve', () => {
    const table = buildPressureTable({ curve: 'firm' });
    const raw = normalizeSample(pen(2, { pressure: 0.5 }))!;
    const curved = normalizeSample(pen(2, { pressure: 0.5 }), table)!;
    expect(curved.pressure).toBeLessThan(raw.pressure!);
  });

  it('derives tilt from altitude and azimuth', () => {
    const upright = tiltFromAngles(Math.PI / 2, 0);
    expect(upright.tiltX).toBeCloseTo(0, 9);
    expect(upright.tiltY).toBeCloseTo(0, 9);
    expect(tiltFromAngles(Math.PI / 4, 0).tiltX).toBeCloseTo(45, 6);
    expect(tiltFromAngles(Math.PI / 4, Math.PI / 2).tiltY).toBeCloseTo(45, 6);
    expect(tiltFromAngles(0, 0).tiltX).toBe(90);
    const sample = normalizeSample({
      x: 0,
      y: 0,
      time: 0,
      pointerType: 'pen',
      pressure: 1,
      altitudeAngle: Math.PI / 4,
      azimuthAngle: 0,
    });
    expect(sample?.tiltX).toBeCloseTo(45, 6);
  });
});

describe('the stroke builder', () => {
  it('builds one stroke with times counted from its first point and a start time from the clock', () => {
    const [stroke] = run(Array.from({ length: 20 }, (_, i) => pen(i)));
    expect(stroke.points).toHaveLength(20);
    expect(stroke.points[0].time).toBe(0);
    expect(stroke.points[19].time).toBe(152);
    expect(stroke.startTime).toBe(1_700_000_000_100);
    expect([stroke.tool, stroke.width, stroke.slot, stroke.block]).toEqual(['pen', 2, ink.slot, TEST_BLOCK]);
  });

  it('replays a recording to the same stroke every time', () => {
    const samples = Array.from({ length: 80 }, (_, i) => pen(i, { x: i * 2 + Math.sin(i) * 2 }));
    const steady = { strength: 5, zoom: 1 };
    const a = run(samples, { newId: () => testId(1), steady });
    const b = run(samples, { newId: () => testId(1), steady });
    expect(a).toEqual(b);
  });

  it('drops samples that a record could not tell apart from the one before', () => {
    const same = [pen(0), pen(0, { time: 110 }), pen(0, { time: 120, x: 0.001 }), pen(1)];
    const [stroke] = run(same);
    expect(stroke.points).toHaveLength(2);
  });

  it('keeps a lone tap as a one-point dot and builds nothing from no samples', () => {
    expect(run([pen(0)])[0].points).toHaveLength(1);
    expect(run([])).toEqual([]);
  });

  it('stores no tilt for a device that reports none that leans, and no pressure for touch', () => {
    const flat = run(Array.from({ length: 5 }, (_, i) => pen(i, { tiltX: 0, tiltY: 0 })))[0];
    expect(flat.points.every((p) => p.tiltX === undefined)).toBe(true);
    expect(flat.points.every((p) => p.pressure !== undefined)).toBe(true);
    const touch = run(Array.from({ length: 5 }, (_, i) => pen(i, { pointerType: 'touch' })))[0];
    expect(touch.points.every((p) => p.pressure === undefined && p.tiltX === undefined)).toBe(true);
  });

  it('lags the ink behind the pen with the steady pen, then catches up at the lift point', () => {
    const samples = Array.from({ length: 30 }, (_, i) => pen(i, { x: i * 2, y: i % 2 ? 1 : -1 }));
    const [raw] = run(samples);
    const [steady] = run(samples, { steady: { strength: 8, zoom: 1 } });
    const last = samples[samples.length - 1];
    expect(steady.points[steady.points.length - 1].x).toBeCloseTo(last.x, 6);
    const roughness = (points: readonly { y: number }[]) =>
      points.slice(1).reduce((sum, p, k) => sum + Math.abs(p.y - points[k].y), 0);
    expect(roughness(steady.points)).toBeLessThan(roughness(raw.points) / 2);
  });

  it('ends a stroke at the point limit and continues from the same point with a new ID', () => {
    const builder = createStrokeBuilder(options({ maxPoints: 10 }));
    for (let i = 0; i < 25; i++) builder.push(pen(i));
    const early = builder.takeCompleted();
    expect(early).toHaveLength(2);
    const rest = builder.finish();
    const all = [...early, ...rest];
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    expect(all[0].points[9]).toEqual({ ...all[1].points[0], time: all[0].points[9].time });
    expect(all[1].startTime).toBe(all[0].startTime + all[0].points[9].time!);
    expect(all[1].points[0].time).toBe(0);
    expect(all.every((s) => s.points.length <= 10)).toBe(true);
  });

  it('does not make a stroke of nothing but the point a rollover repeated', () => {
    const builder = createStrokeBuilder(options({ maxPoints: 5 }));
    for (let i = 0; i < 5; i++) builder.push(pen(i));
    expect(builder.finish()).toHaveLength(1);
  });

  it('gives a snapshot the ID the final stroke will have', () => {
    const builder = createStrokeBuilder(options());
    expect(builder.snapshot()).toBeNull();
    for (let i = 0; i < 6; i++) builder.push(pen(i));
    const progress = builder.snapshot()!;
    for (let i = 6; i < 12; i++) builder.push(pen(i));
    const [final] = builder.finish();
    expect(final.id).toBe(progress.id);
    expect(final.points.length).toBe(12);
  });

  it('builds strokes that encode as records and decode back within a quantum', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 120 }), fc.boolean(), (count, steadyOn) => {
        const samples = Array.from({ length: count }, (_, i) => pen(i, { x: i * 1.7, y: Math.cos(i) * 30 }));
        const strokes = run(samples, steadyOn ? { steady: { strength: 3, zoom: 2 } } : {});
        for (const stroke of strokes) {
          expect(canEncode(stroke)).toBe(true);
          const back = strokeFromRecord(recordFromStroke(stroke));
          expect(back.points).toHaveLength(stroke.points.length);
        }
      }),
      { numRuns: 40 },
    );
  });
});
